// 步骤写接口联调（2026-08-31）：节点名 / 进入条件 / 增删节点走 item/next，不走配置。
//
// 改已有步骤必须带加载时的 Step 快照（url / itemId / lastStep / mainConfig），
// 只改名称也会整包提交——缺字段会被后端写成 null。
// 新建步骤响应不回 itemConfig，要再查 nextConfigPaged 用差集定位，并 enable?state=0
// （新建默认停用）。虚拟起点 itemConfig=0 和本地草稿 id 不写。
import { ElMessage, ElMessageBox } from 'element-plus'
import { entryApi, idFromApiResult, itemApi, sourceApi, type Ack, type Step } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { useSourceStore } from '@/stores/source'
import {
  assertStepsPersistable,
  isWritableStepId,
  hasRealBranches,
  lastStepIdsFromCanvas,
  persistableNodeIds,
  mergeStepForWrite,
} from '@/utils/flow/stepPersist'
import { isRuleNode } from '@/views/FlowCanvas/canvas/flowModel'

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
): Pick<Step, 'sourceId' | 'mainConfig' | 'url' | 'itemId' | 'flowCode' | 'nodeType'> {
  return {
    sourceId: prev?.sourceId ?? sourceId,
    mainConfig: prev?.mainConfig ?? sourceMainConfig ?? configId,
    url: prev ? (prev.url ?? '$VAL$') : undefined,
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
 * 规则节点的两张列名映射：入参查**输入表**、出参查**输出表**
 * （`useRuleTableFields` 的口径：没配输出表才回退到输入表）。
 * 两者共用一张的话，输出表 ≠ 输入表时出参会全部换不到、悄悄退化成 itemCode。
 */
async function ruleColumnMaps(cfg: { ruleCfg?: { inputTableId?: string; outputTableId?: string } }) {
  const inputTableId = cfg.ruleCfg?.inputTableId
  const outputTableId = cfg.ruleCfg?.outputTableId || inputTableId
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
      lastStepIds: lastStepFromCanvas ? lastStepIdsFromCanvas(flow.main, nodeId, flow.branchGroups) : undefined,
      ...(isRuleNode(cfg) ? await ruleColumnMaps(cfg) : {}),
    })
    const ack = await itemApi.stepModify(step)
    assertOk(ack, '修改步骤失败')
    sourceStore.rememberSteps([step], 'merge')
  }

  async function createAndLocate(nodeId: string): Promise<string> {
    const cfg = flow.configs[nodeId]
    if (!cfg?.configId) throw new Error(`节点「${cfg?.title || nodeId}」尚未绑定配置，无法新建步骤`)
    const sid = sourceIdOf()
    if (!sid) throw new Error('当前没有可保存的源')
    const lastStepIds = lastStepIdsFromCanvas(flow.main, nodeId, flow.branchGroups)
    const prevId = lastStepIds[0] !== '0' ? lastStepIds[0] : undefined
    const prev = prevId ? sourceStore.stepSnapshots[prevId] : undefined
    // 源级锚点：优先用已有步骤的 mainConfig（同一源全都一样），其次用源自己的主配置。
    // 两者都没有才退回节点自己的 configId——那是"这个源一个步骤都还没有"的首建场景。
    const sourceMainConfig = Object.values(sourceStore.stepSnapshots).find((snap) => snap?.mainConfig)?.mainConfig
      || flow.sourceCfg?.configId
      || flow.sourceCtx?.configId
    const inherited = createTemplateFromPrev(prev, sid, cfg.configId, sourceMainConfig)
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
      lastStepIds,
      ...(isRuleNode(cfg) ? await ruleColumnMaps(cfg) : {}),
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
    if (ackId && isWritableStepId(ackId)) {
      const steps = await sourceApi.sourceSteps(sid, { withConfigDetails: false })
      created = steps.find((s) => s.stepId === ackId)
    }
    if (!created) {
      const steps = await sourceApi.sourceSteps(sid, { withConfigDetails: false })
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
  async function persistFlowSteps(): Promise<{ created: number; updated: number }> {
    const sid = sourceIdOf()
    if (!sid) return { created: 0, updated: 0 }
    assertStepsPersistable(flow.main, flow.configs, flow.branchGroups)
    const branched = hasRealBranches(sourceStore.stepSnapshots)
    let created = 0
    let updated = 0

    // 0903 YB-B：遍历主链 **+ 各分支链**。只遍历 main 的话，分支里的节点改了名字会静默不保存
    // ——界面显示"已保存"、后端没动，比拍平更难发现。
    for (const id of persistableNodeIds(flow.main, flow.branchGroups)) {
      if (id === 'start' || id === 'end' || id === '0' || isWritableStepId(id)) continue
      const cfg = flow.configs[id]
      if (!cfg) continue
      await createAndLocate(id)
      created += 1
    }

    // 必须**重新取一遍**：createAndLocate 会把本地草稿 id 换成后端返回的真实 stepId
    // （flow.rebindNodeId），沿用上面那份快照会拿着已经不存在的旧 id 去回写，新节点漏保存。
    for (const id of persistableNodeIds(flow.main, flow.branchGroups)) {
      if (!isWritableStepId(id) || !flow.configs[id]) continue
      if (!sourceStore.stepSnapshots[id]) {
        throw new Error(`节点「${flow.configs[id].title || id}」缺少步骤快照，请刷新源后再保存`)
      }
      await persistExisting(id, !branched)
      updated += 1
    }

    return { created, updated }
  }

  async function deleteCanvasNode(nodeId: string, opts?: { confirmed?: boolean }): Promise<boolean> {
    if (!nodeId || nodeId === 'start' || nodeId === 'end') return false
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

  return { persistNodeName, persistFlowSteps, deleteCanvasNode }
}
