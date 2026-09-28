// 步骤写接口联调（2026-08-31）：节点名 / 进入条件 / 增删节点走 item/next，不走配置。
//
// 改已有步骤必须带加载时的 Step 快照（url / itemId / lastStep / mainConfig），
// 只改名称也整包提交——后端 stepModify 是 selective update（updateByPrimaryKeySelective，
// null=不修改、只更新显式值），所以整包回带快照字段是为了不丢语义，而不是怕被写成 null
//（0925 REVIEW 核对 bee-top ItemConfigService.updateItemConfig 后修正此注释）。
// 新建步骤响应不回 itemConfig，要再查 nextConfigPaged 用差集定位，并 enable?state=0
// （新建默认停用）。虚拟起点 itemConfig=0 和本地草稿 id 不写。
import { ElMessage, ElMessageBox } from 'element-plus'
import { entryApi, flowCenterApi, idFromApiResult, itemApi, sourceApi, type Ack, type Step } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { useSourceStore } from '@/stores/source'
import {
  applyStepSourceDefault,
  assertStepsPersistable,
  isWritableStepId,
  hasRealBranches,
  lastStepIdsFromCanvas,
  persistableNodeIds,
  mergeStepForWrite,
  isSyntheticRootId,
  outputTableMissing,
  validFlowIdOf,
} from '@/utils/flow/stepPersist'
import { isRuleLikeNode } from '@/views/FlowCanvas/canvas/flowModel'

function assertOk(ack: Ack | null | undefined, fallback: string) {
  if (ack && 'ok' in ack && ack.ok === false) throw new Error(ack.message || fallback)
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * 新建步骤的模板：能从前置步骤继承的字段就继承，缺前置时按源级真值兜底。
 *
 * ⚠️ `mainConfig` **不能拿新节点自己的 configId 兜底**（2026-09-03 修）。它是"该步骤属于哪个源"
 * 的锚点——`Source.mainConfig` 的注释写得很清楚：**同一源的所有步骤 mainConfig 相同**，
 * 等于首步骤自身的 configId。`nextConfigPaged?sourceId=X` 就是靠它把步骤归到源名下的
 * （cs_item_next 的 SOURCE_ID 恒为 -1，指望不上）。
 *
 * 之前这里写的是 `prev?.mainConfig ?? configId`：没有可落库前置时（prev 为 undefined），
 * mainConfig 会被填成这个新节点自己的配置，步骤就挂在一个查不到的锚点上。
 *
 * ⚠️ **这是加固，不是已确认的故障根因。** 2026-09-03 线上报的
 * 「新建步骤后无法唯一定位（匹配到 0 条）」尚未复现成功——按本假设写的用例在改前改后都通过，
 * 说明那条路径走的是从 prev 继承，兜底分支没被触发。真正的根因还在查，别把这条当结论。
 */
function createTemplateFromPrev(
  prev: Step | undefined,
  sourceId: string,
  configId: string,
  sourceMainConfig: string | undefined,
  flowId: string,
): Pick<Step, 'sourceId' | 'mainConfig' | 'flowId' | 'url' | 'itemId' | 'flowCode' | 'nodeType'> {
  return {
    sourceId: prev?.sourceId ?? sourceId,
    mainConfig: prev?.mainConfig ?? sourceMainConfig ?? configId,
    // 0925 步骤归属切 flowId：新建步骤带画布流程 ID；prev 快照回读若已带 flowId 优先沿用
    //（同流程恒等），两者都没有时兜底 prev 的 mainConfig（存量数据 flowId===mainConfig）。
    flowId: prev?.flowId ?? (flowId || prev?.mainConfig),
    // 下游从上游数据取 URL（$VAL$）。上游是首节点（isRoot）时不能照抄它的固定地址——那样新节点
    // 每条上游数据都去抓同一个首页（0928 与后端对齐：下游采集一律 $VAL$）。
    url: prev ? (prev.isRoot ? '$VAL$' : (prev.url ?? '$VAL$')) : undefined,
    itemId: prev?.itemId,
    flowCode: prev?.flowCode,
    nodeType: prev?.nodeType ?? 'entry',
  }
}

/**
 * 规则节点写步骤要把表配置的入出参存成**物理列名**（`context`/`outContext` = "K1,K2,K3"），
 * 而 `ruleCfg.inputFields/outputFields` 存的是 itemCode，得靠表 schema 换一道。
 *
 * 表字段只能按 tableId 单独查（`entryPaged` 的 items 恒为 null，见 useEntryTableFieldsCache 头注）。
 * 这里按 tableId 记一份进程内缓存：一次保存里多个规则节点常常共用同一张输入表，
 * 不缓存就会对同一张表连查好几次。查失败不缓存，允许下次重试——换不到就原样写 itemCode，
 * 宁可写个认得出的值，也别悄悄丢字段。
 */
const columnMapCache = new Map<string, Map<string, string>>()
async function columnMapFor(tableId: string | undefined): Promise<Map<string, string> | undefined> {
  if (!tableId) return undefined
  const cached = columnMapCache.get(tableId)
  if (cached) return cached
  try {
    const detail = await entryApi.entryDetail(tableId)
    const map = new Map<string, string>()
    for (const field of detail.fields) if (field.columnName) map.set(field.prop, field.columnName)
    columnMapCache.set(tableId, map)
    return map
  } catch {
    return undefined
  }
}

/**
 * 规则节点（含翻译助手，2026-09-18）的两张列名映射：入参查**输入表**、出参查**输出表**
 * （`useRuleTableFields` 的口径：没配输出表才回退到输入表）。
 * 两者共用一张的话，输出表 ≠ 输入表时出参会全部换不到、悄悄退化成 itemCode。
 * 表/字段绑定对规则节点存 ruleCfg、对翻译助手存 execCfg（见 TableTab 头注）。
 */
async function ruleColumnMaps(cfg: {
  ruleCfg?: { inputTableId?: string; outputTableId?: string }
  execCfg?: { inputTableId?: string; outputTableId?: string }
}) {
  const orch = cfg.ruleCfg ?? cfg.execCfg
  const inputTableId = orch?.inputTableId
  const outputTableId = orch?.outputTableId || inputTableId
  const [columnByItemCode, outColumnByItemCode] = await Promise.all([
    columnMapFor(inputTableId),
    outputTableId === inputTableId ? columnMapFor(inputTableId) : columnMapFor(outputTableId),
  ])
  return { columnByItemCode, outColumnByItemCode }
}

export function useStepWrite() {
  const flow = useFlowStore()
  const sourceStore = useSourceStore()

  function sourceIdOf(): string {
    return flow.sourceCfg?.sourceId || flow.sourceCtx?.sourceId || ''
  }

  /**
   * 画布当前可写的真实流程 ID（数字串），空串表示拿不到（未绑流程 / 老后端回读无 flowId）。
   *
   * ⚠️ 不能直接拿 `flow.flowId`：`loadFromSource` 会把 FlowDef.id 设成 source.sourceId
   * （loadFromSource 注释：FlowDef.id 是 stub 源不担真源时才纠正成 flow.id）——源画布下
   * `flow.flowId` 是源 ID，源 ID 与流程 ID 都是数字，值上无法区分。必须先判画布形态：
   * - 流程管理画布（0926 显式 `flow.flowIdMode`，流程抽屉两条加载路径与模板应用重载都会置位）：
   *   `flow.flowId` 是真实流程 ID（cs_flow.id）；
   * - 源画布（sourceCtx 存续）：flowId 只能取自源记录回读的 `Source.flowId`（bee-top
   *   cs_source.FLOW_ID 列，sourceFromLegacy 已映射）。
   * 两者都没有（老后端 / 未绑流程的源）→ 空串：写 payload 不传 flowId，由后端回填 mainConfig。
   * （网站详情页内部代表源另有一层保护：它经过 loadFromSource，flowIdMode 为 false，
   *   不会把"长得像流程 ID 的源 ID"误当成流程 ID 写进步骤。）
   */
  function flowIdOf(): string {
    if (flow.flowIdMode) return validFlowIdOf(flow.flowId)
    const sourceFlow = validFlowIdOf(flow.sourceCfg?.flowId) || validFlowIdOf(flow.sourceCtx?.flowId)
    if (sourceFlow) return sourceFlow
    return ''
  }

  /** 根节点（isRoot=1 的真实根行，流程画布的第一个入口节点）。它不参与**普通步骤**写入
   *  （不建不改名不删），但 0927 G1 起**配置可换**——由 persistFlowSteps 每次保存先判断
   *  画布 configId 与快照是否一致，变化时走 ROOT 专属轻量通道 updateRootConfig。
   *  0927 P1-8：只认**真实物化 ROOT 行**（stepId 是数字）——svg 查询在未回填 ROOT 环境
   *  回退的「虚拟根」（itemConfig=0 / stepId='0'，isRoot=1 同样成立）不算：对虚拟根放行
   *  G1 会让 rootConfigUpdate('0', …) 把虚拟根物化成真根。 */
  function isRootStepStepId(nodeId: string): boolean {
    const snapshot = sourceStore.stepSnapshots[nodeId]
    return snapshot?.isRoot === true && (snapshot.stepId ?? '') !== '0'
  }

  /**
   * ROOT 配置更新（0927 G1）：流程入口（isRoot=1 真实根行）换配置。
   *
   * 后端 ROOT 编辑（ItemConfigService.validateRootUpdate）只接受 configId（>0）与流程生命周期
   * 字段：sourceId / lastStep / entryTypeId / itemId / extName / cond 传**非空**一律拒绝、
   * mainConfig 不能改、type 必须 entry——所以**不能走 mergeStepForWrite 的普通整包**（会把画布
   * 回填的输出表/输入表/条件带进去撞校验），也不走 stepModify 的反算（enabled:false → isDelete:1
   * 会被当成「删除根节点」拒绝）。API 层 `rootConfigUpdate` 只交最小集 `{ itemConfig, configId }`，
   * 其余字段保持库中值（selective update）。成功后同步快照 configId，避免下次自动保存重复写。
   */
  async function updateRootConfig(nodeId: string, configId: string): Promise<void> {
    const snapshot = sourceStore.stepSnapshots[nodeId]
    const ack = await itemApi.rootConfigUpdate(nodeId, configId)
    assertOk(ack, '修改流程入口配置失败')
    sourceStore.rememberSteps([{ ...snapshot, configId }], 'merge')
  }

  async function persistExisting(nodeId: string, lastStepFromCanvas: boolean) {
    const snapshot = sourceStore.stepSnapshots[nodeId]
    if (!snapshot) {
      throw new Error(`节点 ${nodeId} 没有步骤快照，已跳过写入以免覆盖后端字段`)
    }
    const cfg = flow.configs[nodeId]
    if (!cfg) throw new Error(`节点 ${nodeId} 不存在`)
    const step = mergeStepForWrite({
      snapshot,
      cfg,
      nodeId,
      sourceId: sourceIdOf() || snapshot.sourceId,
      flowId: flowIdOf() || snapshot.flowId,
      lastStepIds: lastStepFromCanvas ? lastStepIdsFromCanvas(flow.main, nodeId, flow.branchGroups) : undefined,
      ...(isRuleLikeNode(cfg) ? await ruleColumnMaps(cfg) : {}),
    })
    const ack = await itemApi.stepModify(step)
    assertOk(ack, '修改步骤失败')
    sourceStore.rememberSteps([step], 'merge')
  }

  async function createAndLocate(nodeId: string): Promise<string> {
    const cfg = flow.configs[nodeId]
    if (!cfg?.configId) throw new Error(`节点「${cfg?.title || nodeId}」尚未绑定配置，无法新建步骤`)
    // 0926：写锚点二选一——源画布用源 ID（步骤归源），流程工作区用 flowId（步骤归流程，
    // sourceId 恒 -1）。两者都没有的裸画布没有可写目标。
    const fid = flowIdOf()
    const sid = sourceIdOf()
    if (!sid && !fid) throw new Error('当前没有可保存的源或流程')
    // 新建步骤的「适用源」一律默认 -1（2026-09-24 从规则/监控扩到所有类型）。画布 insertAfter
    // 已经设过，这里兜住不走那条路新建的节点（套模板、AI 推荐重建）——不兜就会顺着前置步骤的
    // sourceId 把新步骤锁到当前源上。流程工作区没有源概念，天然就是 -1。
    applyStepSourceDefault(cfg)
    const lastStepIds = lastStepIdsFromCanvas(flow.main, nodeId, flow.branchGroups)
    const prevId = lastStepIds[0] !== '0' ? lastStepIds[0] : undefined
    const prev = prevId ? sourceStore.stepSnapshots[prevId] : undefined
    // 锚点优先级：已有步骤的 mainConfig（同一源全都一样）→ 流程工作区的 flowId（流程步骤
    // mainConfig === flowId===configId）→ 源自己的主配置 → 节点自己的 configId（"这个源一个
    // 步骤都还没有"的首建场景）。
    const sourceMainConfig = Object.values(sourceStore.stepSnapshots).find((snap) => snap?.mainConfig)?.mainConfig
      || fid
      || flow.sourceCfg?.configId
      || flow.sourceCtx?.configId
    // 0925：新建步骤必须带画布的 flowId（归属切 flowId）；拿不到时由后端回填 mainConfig。
    const flowId = fid
    const inherited = createTemplateFromPrev(prev, sid || '-1', cfg.configId, sourceMainConfig, flowId)
    const step = mergeStepForWrite({
      snapshot: {
        ...inherited,
        stepId: '',
        name: cfg.title.trim(),
        enabled: !cfg.disabled,
      },
      cfg,
      nodeId,
      sourceId: inherited.sourceId,
      flowId: inherited.flowId,
      lastStepIds,
      ...(isRuleLikeNode(cfg) ? await ruleColumnMaps(cfg) : {}),
    })
    const before = new Set([
      ...Object.keys(sourceStore.stepSnapshots),
      ...flow.main.filter(isWritableStepId),
    ])
    const ack = await itemApi.saveItemConfig(step)
    assertOk(ack, '新增步骤失败')

    /**
     * 认领刚建出来的那条步骤（2026-09-04 重排判据）。
     *
     * 为什么要认领：画布节点先以本地草稿 id 存在，落库后必须换成后端的 `itemConfig`，
     * 否则之后改名、改进入条件都不知道该改哪条。**旧平台没有这一步**——它的步骤是弹窗表单，
     * 提交完 `$emit('refresh')` 整表重查就完事，没有"本地草稿要跟后端 ID 对上"这回事。
     * 所以这段没有可抄的实现，判据得自己选。
     *
     * 三级，从硬到软：
     *   ① **回执直接带 ID**——最干净，连重查都省了。今天后端返不返未知（没人验过），
     *      带了就走这条；哪天开始返了会自动升级，不用改代码。
     *   ② 差集里 **itemConfig 最大的那条**。`itemConfig` 是后端自增主键，刚建的一定最大。
     *   ③ 名字**只做校验**，不当判据。名字是用户随时能改的，默认值又天生重复
     *      （同一前置下加两个规则节点都叫「1400917-规则处理」），拿它认身份本来就不牢靠——
     *      原来 `added.length !== 1` 时靠名字过滤，撞名就抛「无法唯一定位」。
     */
    const ackId = idFromApiResult(ack, ['itemConfig', 'id', 'data'])
    let created: Step | undefined
    // 0925 认领回查按 flowId：步骤归属切 flowId 后，新步骤落在 FLOW_ID 名下，按 flowId 全量
    // 回读最稳（源视角查询在后端 useFlow 下同样按源 flowId 归属，两者一致）；拿不到 flowId
    // （老后端 / 未绑流程的源）维持按源查。
    const refreshSteps = async (): Promise<Step[]> => {
      if (flowId && /^\d+$/.test(flowId)) {
        return flowCenterApi.steps(flowId, { withConfigDetails: false })
      }
      return sourceApi.sourceSteps(sid, { withConfigDetails: false })
    }
    if (ackId && isWritableStepId(ackId)) {
      const steps = await refreshSteps()
      created = steps.find((s) => s.stepId === ackId)
    }
    if (!created) {
      const steps = await refreshSteps()
      const added = steps.filter((s) => isWritableStepId(s.stepId) && !before.has(s.stepId))
      if (!added.length) {
        throw new Error('新建步骤后没查到新增的步骤，请刷新画布确认')
      }
      created = added.reduce((a, b) => (Number(b.stepId) > Number(a.stepId) ? b : a))
      const wanted = cfg.title.trim()
      if (added.length > 1 && created.name !== wanted) {
        // 不阻断：ID 最大那条就是刚建的，名字对不上多半是同名/改过名。留一行日志便于排查。
        console.warn('[step-write] 差集里有多条新增，按 itemConfig 最大认领', { wanted, added: added.map((s) => `${s.stepId}:${s.name}`) })
      }
    }
    sourceStore.rememberSteps([created], 'merge')
    try {
      const enableAck = await itemApi.enable(created.stepId, '0')
      assertOk(enableAck, '启用新步骤失败')
      sourceStore.rememberSteps([{ ...created, enabled: true }], 'merge')
    } catch (e) {
      ElMessage.warning(`步骤已创建（#${created.stepId}），但启用失败：${errorMessage(e)}`)
    }
    if (!flow.rebindNodeId(nodeId, created.stepId)) {
      throw new Error(`步骤已创建（#${created.stepId}），但画布节点未能换成新 ID`)
    }
    return created.stepId
  }

  /** 编辑节点名称弹窗：已落库步骤立刻 stepModify；本地草稿只改画布，绑定配置后由自动保存落库。 */
  async function persistNodeName(nodeId: string, name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('节点名称不能为空')
    // 0925：流程根节点名称由流程生命周期（cs_flow）管理，不能通过步骤接口改（后端校验
    // type/sourceId/lastStep 合规），画布也不改，避免"画布改了、库里没动"的误导。
    if (isRootStepStepId(nodeId)) {
      ElMessage.warning('流程根节点名称由「流程管理」维护，请到流程管理中修改')
      return
    }
    if (!isWritableStepId(nodeId)) {
      flow.setTitle(nodeId, trimmed)
      ElMessage.success(nodeId === '0'
        ? '已更新画布名称（虚拟起点不能写入步骤接口）'
        : '已更新节点名称（未绑定配置，绑定后自动落库）')
      return
    }
    if (trimmed === (flow.configs[nodeId]?.title ?? '')) {
      ElMessage.success('节点名称已保存')
      return
    }
    if (!sourceStore.stepSnapshots[nodeId]) {
      flow.setTitle(nodeId, trimmed)
      ElMessage.warning('已改画布名称，但缺少步骤快照，请刷新源后再保存，避免覆盖后端字段')
      return
    }
    // 0927 H1：存量行输出表未就绪时任何步骤编辑（含改名整包）都会被后端「节点输出表不能为空」
    // 拒绝；先改画布并提示，等用户在「表配置」补上输出表后由自动保存整批落库，避免误导性报错。
    const snapshot = sourceStore.stepSnapshots[nodeId]
    if (outputTableMissing(flow.configs[nodeId], snapshot)) {
      flow.setTitle(nodeId, trimmed)
      ElMessage.warning('已改画布名称，但该节点输出表未选择（非文件节点必填），补上输出表后自动保存才会落库')
      return
    }
    const prev = flow.configs[nodeId]?.title ?? ''
    flow.setTitle(nodeId, trimmed)
    try {
      await persistExisting(nodeId, false)
    } catch (e) {
      flow.setTitle(nodeId, prev)
      throw e
    }
    ElMessage.success('节点名称已保存')
  }

  /**
   * 自动保存：先新建缺 ID 的节点，再按画布回写已有步骤的名称/条件/lastStep。
   *
   * ⚠️ **有真实分支的流程不重算 `lastStep`**（0903 YB-A 止血）。`buildSourceSeed` 目前把
   * 子步骤一律拍成一条主链，分支流程在画布上是**假的直线**；据此重算前置会把
   * 「40620 挂在 40597 下」改写成「挂在 40598 后面」，分支被静默拍平且不可逆。
   * 名称、进入条件这些与拓扑无关的字段照常写。分支拓扑还原见 YB-B。
   */
  async function persistFlowSteps(): Promise<{ created: number; updated: number; skipped: number }> {
    // 0926：源画布与流程工作区都可写（后者无源上下文，按 flowId 锚定）；裸画布不写。
    const sid = sourceIdOf()
    if (!sid && !flow.flowIdMode) return { created: 0, updated: 0, skipped: 0 }
    // 自动保存跳过未绑定配置的草稿节点（0926），不再整体拦截；逐节点保存仍严格（缺省抛错）。
    assertStepsPersistable(flow.main, flow.configs, flow.branchGroups, { skipUnbound: true })
    const branched = hasRealBranches(sourceStore.stepSnapshots)
    let created = 0
    let updated = 0
    // 0927 P1-5：flowIdMode 下「有画布定义、没有步骤行」的历史节点（R2 遗留形态）跳过回写——
    // 但跳过要**计数上报**，autosave 据此把状态留在 pending，不再假装「已保存」（此前静默
    // continue：快照拉取失败时用户看到已保存、实际一行未写）。
    let skipped = 0

    // 0903 YB-B：遍历主链 **+ 各分支链**。只遍历 main 的话，分支里的节点改了名字会静默不保存
    // ——界面显示"已保存"、后端没动，比拍平更难发现。
    for (const id of persistableNodeIds(flow.main, flow.branchGroups)) {
      // isSyntheticRootId：画布合成的虚拟起点不落库（2026-09-04）。它对应后端现算的
      // itemConfig:0 那行，建成真实步骤会让首节点每进一次画布就多一个。
      // isRoot 真实根行（0925 切 flowId 后源画布也会带回）：由流程生命周期管理，同样不写。
      if (id === 'start' || id === 'end' || id === '0' || isSyntheticRootId(id) || isRootStepStepId(id) || isWritableStepId(id)) continue
      const cfg = flow.configs[id]
      // 未绑定配置的草稿节点留在画布上（等右侧绑定），不阻断其它节点的自动保存（0926）。
      if (!cfg || !cfg.configId) continue
      // 0927 H1：非文件节点输出表未就绪 = 配置未就绪草稿：提交必被后端「节点输出表不能为空」
      // 拒绝，这里同样跳过该节点（画布状态保留，头部提示去补输出表），不整批卡死。
      if (outputTableMissing(cfg, sourceStore.stepSnapshots[id])) continue
      await createAndLocate(id)
      created += 1
    }

    // 必须**重新取一遍**：createAndLocate 会把本地草稿 id 换成后端返回的真实 stepId
    // （flow.rebindNodeId），沿用上面那份快照会拿着已经不存在的旧 id 去回写，新节点漏保存。
    for (const id of persistableNodeIds(flow.main, flow.branchGroups)) {
      if (!isWritableStepId(id) || !flow.configs[id]) continue
      // 0927 G1：真实根节点（isRoot=1，画布第一个入口节点）不再一律跳过——**每次保存先判断**：
      // 画布 configId 没变 → 根行元数据由流程生命周期维护，不写（保持 0925 起的只读语义）；
      // 变了（右侧「更换配置」选了新配置）→ 走 ROOT 专属轻量 stepModify（普通整包会被
      // 后端 validateRootUpdate 拒：outputTable/entryTypeId/cond 传非空即报错）。
      if (isRootStepStepId(id)) {
        const cfg = flow.configs[id]
        const snapshot = sourceStore.stepSnapshots[id]
        if (snapshot && cfg.configId && snapshot.configId !== cfg.configId) {
          await updateRootConfig(id, cfg.configId)
          updated += 1
        }
        continue
      }
      const snapshot = sourceStore.stepSnapshots[id]
      // 0927 H1：存量行输出表未就绪（编辑必被后端拒）同样按草稿跳过并提示；改动留在画布、
      // markFlowSaved 被 pending 卡住，头部提示补输出表后随下一轮自动保存落库。
      if (snapshot && outputTableMissing(flow.configs[id], snapshot)) continue
      if (!snapshot) {
        // 流程工作区：flowConf 里可能带着"只有画布定义、没有步骤行"的历史节点（R2 遗留形态），
        // 没有快照可整包回写，跳过而不是报错——它们本来就不在执行集合里，报了也写不了。
        if (flow.flowIdMode) {
          skipped += 1
          continue
        }
        throw new Error(`节点「${flow.configs[id].title || id}」缺少步骤快照，请刷新源后再保存`)
      }
      await persistExisting(id, !branched)
      updated += 1
    }

    return { created, updated, skipped }
  }

  async function deleteCanvasNode(nodeId: string, opts?: { confirmed?: boolean }): Promise<boolean> {
    if (!nodeId || nodeId === 'start' || nodeId === 'end' || nodeId === '0') return false
    // 0925：流程根节点不能单独删除（后端同样拒绝），画布直接拦下。
    // 0927 P1-8 配套：虚拟根（stepId='0' 的 isRoot 行）同步受拦——isRootStepStepId 现在
    // 只认真实物化根，删除保护不能跟着一起放宽（'0' 不是真实步骤，删了后端无行可动，
    // 只会在本地把入口节点抹掉，重载又回来）。
    if (isRootStepStepId(nodeId)) {
      ElMessage.warning('流程根节点属于流程本身，不能单独删除')
      return false
    }
    if (!opts?.confirmed) {
      try {
        await ElMessageBox.confirm('删除后不可恢复。确定删除该节点？', '删除节点', {
          type: 'warning',
          confirmButtonText: '删除',
          cancelButtonText: '取消',
        })
      } catch {
        return false
      }
    }
    try {
      if (isWritableStepId(nodeId)) {
        const ack = await itemApi.deleteStep(nodeId)
        assertOk(ack, '删除步骤失败')
        sourceStore.forgetStep(nodeId)
      }
      flow.remove(nodeId)
      ElMessage.success('节点已删除')
      return true
    } catch (e) {
      ElMessage.error(`删除失败：${errorMessage(e)}`)
      return false
    }
  }

  /**
   * 修复孤儿步骤归属（0925）：把步骤的 `lastStep` 显式指向用户选定的目标节点并落库。
   *
   * 这是用户点过「关联到节点」的**显式拓扑操作**，不受 `hasRealBranches` 写回冻结限制
   * （冻结只管自动保存的重算；显式修归属是用户意图，理应落库）。写成功后由调用方重载
   * 画布（reloadSourceIntoCanvas），树按新 lastStep 重新构建，孤儿标记随之消失；
   * 该步骤的子孙 lastStep 仍指它自己，重载后自然跟着挂到目标下方。
   */
  async function relinkOrphan(nodeId: string, targetId: string): Promise<void> {
    if (targetId === nodeId) throw new Error('不能把节点关联到自己')
    // '0' 是「挂在根上」的哨兵（源视角 svg=true 的虚拟入口行）；真实入口行（isRoot=1）
    // 同样允许——后端 normalizeRootReferenceForStorage 会把流程自己的根引用归一成 '0'，
    // 与旧平台 lastStep='0' 是同一语义（2026-09-26 用户反馈：孤儿要挂回入口时下拉是空的）。
    // 合成根（source:xxx，源视图画布上的入口节点）也接受：写侧归一成 '0' 哨兵
    // （2026-09-26 REVIEW F2——源视图入口在画布上是合成根，后端收的仍是 '0'）。
    const rootTarget = targetId === '0' || isSyntheticRootId(targetId)
    if (!rootTarget && !isWritableStepId(targetId)) throw new Error('目标节点不可作为前置步骤')
    const snapshot = sourceStore.stepSnapshots[nodeId]
    if (!snapshot) throw new Error(`节点 ${nodeId} 还没有步骤快照，无法写归属（该步骤可能尚未保存）`)
    const cfg = flow.configs[nodeId]
    if (!cfg) throw new Error(`节点 ${nodeId} 不存在`)
    const step = mergeStepForWrite({
      snapshot,
      cfg,
      nodeId,
      sourceId: sourceIdOf() || snapshot.sourceId,
      flowId: flowIdOf() || snapshot.flowId,
      lastStepIds: [rootTarget && isSyntheticRootId(targetId) ? '0' : targetId],
      // 0925 REVIEW 再评：关联 = 只改归属（lastStep），不传列名映射——不引 ruleColumnMaps 的
      // 额外 entryDetail 往返，也不按当前表结构重算 context/outColumns（归属变更不该顺带改
      // 语义字段）。下面把入出参钉回快照原值：快照无值时 payload 落 null = 后端不动（selective）。
    })
    step.contextMap = snapshot.contextMap
    step.outColumns = snapshot.outColumns
    const ack = await itemApi.stepModify(step)
    assertOk(ack, '修改步骤归属失败')
    sourceStore.rememberSteps([step], 'merge')
  }

  return { persistNodeName, persistFlowSteps, deleteCanvasNode, relinkOrphan }
}
