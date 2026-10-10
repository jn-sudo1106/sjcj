<script setup lang="ts">
import { onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  configApi,
  flowCenterApi,
  workflowBindingApi,
  type FlowDefinition,
  type FlowRecord,
  type Source,
  type Step,
  type WorkflowBinding,
} from '@/api'
import { useFlowStore, stripLoginSecrets } from '@/stores/flow'
import { useSourceStore } from '@/stores/source'
import { useFlowVersionStore } from '@/stores/flowVersion'
import { useUiStore } from '@/stores/ui'
import { rootStepForSource } from '@/views/FlowCanvas/canvas/flowModel'
import FlowBoard from '@/views/FlowCanvas/canvas/FlowBoard.vue'
import NodeInspector from '@/views/FlowCanvas/inspector/NodeInspector.vue'
import { useFlowAutosave } from '@/views/FlowCanvas/canvas/useFlowAutosave'

// categories 由列表页透传（那边已经拉过一次 sourceCategories，抽屉不再重复请求）
const props = withDefaults(defineProps<{ flow: FlowRecord | null; categories?: { id: string; name: string }[] }>(), {
  categories: () => [],
})
const emit = defineEmits<{
  close: []
  saved: [flow: FlowRecord]
  apply: [flow: FlowRecord]
}>()

const canvas = useFlowStore()
const sourceStore = useSourceStore()
const ui = useUiStore()
const flowVersion = useFlowVersionStore()
/** 读步骤时的尾参：版本 store 当前就是这个流程、且有草稿时才带 versionId（防止拿别的流程的草稿 ID）；
 *  没有草稿不传，调用形状与版本对接前一致 */
function draftVersionArgs(id: string): [] | [{ versionId: string }] {
  const versionId = flowVersion.flowId === id ? flowVersion.viewVersionId : null
  return versionId ? [{ versionId }] : []
}
const autosave = useFlowAutosave()
const name = ref('')
const saving = ref(false)
const publishing = ref(false)
const workingFlow = ref<FlowRecord | null>(null)
const versionState = ref<WorkflowBinding | null>(null)
// 多流程接口（workflow/*）未上线时没有草稿 / 发布：直接编辑原流程，保存即生效（合并 leo 分支前的行为）。
// 否则打开流程第一步的 ensureDraft 必然失败，抽屉报错关闭，流程中心一个流程都打不开。
const versioned = workflowBindingApi.available()

// 流程工作区自动保存（0926「基础数据写正常」）：在抽屉里新建/改名/改条件/删除节点同样落到
// cs_item_config（步骤行），不依赖源上下文——useStepWrite 按 flow.flowIdMode 走 flowId 锚定。
// 与画布页的 autosave 是同一个模块级单例，两处路由互斥（画布页 onUnmount 时已 unbind）。
let autosaveBound = false
function ensureAutosaveBound() {
  if (!autosaveBound) {
    autosave.bind()
    autosaveBound = true
  }
}
function ensureAutosaveUnbound() {
  if (autosaveBound) {
    autosave.unbind()
    autosaveBound = false
  }
  // 0927 P1-6：抽屉卸载时复位流程工作区形态。flowIdMode 只在各源视角入口复位，抽屉关闭
  // 不复位会残留 true——画布页 autosave.bind()（onMounted）早于 loadSourceFlow 的复位，
  // 窗口期内改动会按残留的旧流程 ID 锚定落库。
  canvas.setFlowIdMode(false)
}
onBeforeUnmount(ensureAutosaveUnbound)
/** 关工作区：先把最后一批步骤改动落库（防抖窗口内的草稿换 ID 等），再关抽屉。
 *  0926 REVIEW F-R5：flush 失败（autosave 内部退避重试 + error toast，不向外抛错）不再静默
 *  关闭——那次保存失败的节点改动（新建/改名/换配置）还没落库，直接关掉就没机会再存了；
 *  停在抽屉里让用户看到头部「保存失败，点击重试」。
 *  0927 P0-1：抽屉内已补保存状态条（含「重试」按钮）；同时给「仍然关闭」显式出口——后端
 *  持续故障（502 / outEntry 校验拒绝）时用户不能被永远困在抽屉里，确认后关闭并明示改动
 *  可能丢失（这正是原实现的行为缺口：error 态 return 后抽屉关不掉，只能刷新页面）。 */
async function closeWorkspace() {
  if (canvas.flowDirty || autosave.status.value === 'saving') {
    await autosave.flush()
    if (autosave.status.value === 'error') {
      try {
        await ElMessageBox.confirm(
          `画布改动尚未保存成功（${autosave.lastError.value || '保存失败'}）。\n仍然关闭将丢失这些改动，确定关闭吗？`,
          '保存失败',
          {
            confirmButtonText: '仍然关闭',
            cancelButtonText: '留在此页',
            type: 'warning',
          },
        )
      } catch {
        return
      }
    }
  }
  emit('close')
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function definitionFromCanvas(): FlowDefinition {
  const configs = clone(canvas.configs)
  // F3（0929）：与 serialize() 同一脱敏口径——登录口令不进 flowConf（曾绕过 serialize
  // 把 collectCfg.password / loginConfigs.loginPwd 明文写进 cs_flow，REVIEW F3 已修）。
  stripLoginSecrets(configs)
  return {
    main: [...canvas.main],
    branches: clone(canvas.branches),
    configs,
    branchGroups: clone(canvas.branchGroups),
  }
}

function loadIntoWorkspace(flow: FlowRecord, steps: Step[]) {
  name.value = flow.name
  canvas.clearSourceCtx()
  canvas.clearSiteCtx()
  canvas.load({
    id: flow.id,
    name: flow.name,
    // FlowDef.version 只是画布上的展示串；cs_flow 没有版本列，没有就用流程 ID 兜底，
    // 不要拼出 `flow-vundefined`（见 FlowRecord.version 注释）。
    version: flow.version == null ? `flow-${flow.id}` : `flow-v${flow.version}`,
    main: flow.definition.main,
    branches: flow.definition.branches,
    configs: flow.definition.configs,
    branchGroups: flow.definition.branchGroups,
    updatedAt: flow.updatedAt,
  })
  // 0926：流程工作区形态——节点写 / 自动保存按 flowId 锚定（见 flow store flowIdMode 注释）
  canvas.setFlowIdMode(true)
  // 步骤快照：flowConf 画布的节点改名 / 条件编辑 / 孤儿「关联」仍要整包回写步骤行，必须有快照。
  // 由 openFlowInWorkspace 并进打开窗口取回（失败走空数组，改名/关联会提示缺快照，不阻断画布）。
  sourceStore.rememberSteps(steps, 'replace')
  const firstNode = flow.definition.main.find((id) => id !== 'start' && id !== 'end' && flow.definition.configs[id])
  canvas.select(firstNode ?? '')
  canvas.markSaved()
}

/**
 * 按这个流程**自己的配置**（cs_config，configId=flowId）与**接口步骤**（nextConfigPaged
 * ?flowId=&svg=true，执行拓扑的唯一事实源）把画布还原出来。
 *
 * 0927 起这是流程工作区**默认的展示路径**：工作区画布一律按接口步骤展示（用户反馈
 * 「流程工作区未按 nextConfigPaged 返回的展示」），flowConf 只兜底步骤侧没有内容的场景；
 * 更早（09-02）它只是 flowConf 为空时的还原路径。背景：生产上 735 条流程是后端从
 * cs_config 整批灌进来的，flowConf 全是 null——但它们不是空流程，真实结构在
 * cs_config/cs_item_config 里（起点节点 1 个 + 真实子步骤 N 个）。直接显示空画布等于
 * 告诉用户"这流程没内容"，而且一旦有人点保存，就把空定义写进去了。
 *
 * 起点节点的来源（2026-09-02 起）：svg+flowId 模式的 nextConfigPaged **自带真实根行**
 * （isRoot=1，name=配置名，endpoints.ts:209-228 实测）——有真根就用真根。只有步骤里没有
 * 根行时才用 `rootStepForSource(source)` 合成兜底（旧数据 / 接口异常 / 纯配置还原）。
 * 合成根要求 `source.url`/`mainTable` 有值，否则返回 null：
 * **不能指望 `buildSourceSeed` 自己的兜底分支触发**——那条分支只在 `steps.length === 0` 时才
 * 退回 `rootStepForSource`——对"这个流程没有任何真实子步骤"的流程管用，但大多数存量流程是
 * "有真实子步骤、缺的只是起点那一行"（旧 flowId 模式不返回它），这种情况下 `steps` 非空，
 * `buildSourceSeed` 会直接跳过 stub 起点，整个起点节点凭空消失（2026-09-02 真机对比 zqrb
 * 流程 #1400832 的流程中心视图与它关联源的流程视图发现：后者靠 sourceId+svg 查询自带这一
 * 行，前者整个没有）。
 *
 * **刻意在 loadFromSource 之后清掉源上下文**：画布一旦挂上 sourceCtx，节点编辑会走步骤自动
 * 保存（item/next/*）——这个 stub Source 连 sourceId 都是假的，更不能被当成真源写。
 */
/**
 * 抽屉里可编辑的流程属性（0904 I16/I17 · Z7-5）：分类 / 标签 / 描述。
 * 与名称一样随 flow 变化重置；**业务大类只读展示**——生产里 bizType 一个值都没有，
 * 枚举无从照抄（0904 Q3），不给选。
 */
const metaForm = reactive({ categoryId: '', tags: '', description: '' })
watch(() => props.flow?.id, (id, prev) => {
  // 打开时绑定步骤自动保存、关闭时解绑（绑定的是流程工作区形态，见 ensureAutosaveBound）
  if (id && !prev) ensureAutosaveBound()
  if (!id && prev) ensureAutosaveUnbound()
  // 抽屉是独立的一块工作区，不该继承画布页上次留下的收起/展开状态（两边共用同一对 ui 标志）
  ui.resetInspectorLayout()
  metaForm.categoryId = props.flow?.categoryId ?? ''
  metaForm.tags = props.flow?.flowTags ?? ''
  metaForm.description = props.flow?.description ?? ''
  workingFlow.value = null
  versionState.value = null
}, { immediate: true })
/** 标签统一成逗号串：中英文逗号、空格分隔都收，去重去空（与新建表单同一口径） */
function normalizeTags(raw: string): string {
  return [...new Set(raw.split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean))].join(',')
}

const derivedFromConfig = ref(false)
async function deriveFromFlowConfig(flow: FlowRecord, prefetchedSteps?: Step[]): Promise<boolean> {
  // 0927 起打开工作区先把步骤整批取回（withConfigDetails 默认 true，configType/configUrl 等
  // 已挂在步骤上），这里直接用，不再整包重拉。configDetail 只剩一个用途：步骤里**没有真实
  // 根行**时合成 stub 起点（rootStepForSource 要 url/mainTable）——svg+flowId 正常返回自带
  // isRoot=1 起点行，有这个就不查（省一次请求，也少一个失败点）。
  // 不带 prefetchedSteps 的老路径（flowConf 与步骤都空时的兜底还原）保持原语义：
  // 两者任一失败即整体失败，由调用方决定回到空白画布。
  const [config, steps] = prefetchedSteps
    ? [
        prefetchedSteps.some((step) => step.isRoot)
          ? null
          : await configApi.configDetail(flow.id).catch(() => null),
        prefetchedSteps,
      ]
    : await Promise.all([configApi.configDetail(flow.id), flowCenterApi.steps(flow.id, ...draftVersionArgs(flow.id))])
  const stubSource: Source = {
    sourceId: '',
    name: config?.name || flow.name,
    url: config?.url || '',
    configId: flow.id,
    mainTable: config?.entryTypeId || '',
    owner: '',
    state: 'C',
  }
  // 2026-09-04：`steps()` 改带 svg=true 后，后端会返回这个流程真实的根节点行（isRoot=1）。
  // 有真根就用真根——它带着正确的名字（= 配置名，旧平台拓扑图显示的就是这个）和真实
  // itemConfig；再合成一个假的只会把节点画成硬编码的「列表抓取 / 列表页」（stubSource 的
  // rootStepForSource 无条件这么命名），跟旧平台对不上。实测流程 1400979：旧平台显示
  // 「#41383 · 纽约市政府市长办公室新闻处_copy · 流程入口」，我们显示「列表抓取」。
  // 只有后端没给根节点行时才退回合成（旧数据 / 接口异常）。
  const rootStep = steps.some((step) => step.isRoot) ? null : rootStepForSource(stubSource)
  const seedSteps = rootStep ? [rootStep, ...steps] : steps
  canvas.loadFromSource(stubSource, seedSteps)
  // loadFromSource 把 FlowDef.id 设成了 source.sourceId（这里是空串，stub 源故意不担真源）——
  // 流程 ID 必须显式纠正回来，不然「流程 XML」导出（flowId 要用于导入导出）会把它显示成空。
  canvas.flowId = flow.id
  // 0926：流程工作区形态——节点写 / 自动保存按 flowId 锚定（见 flow store flowIdMode 注释）
  canvas.setFlowIdMode(true)
  // 0926：清源上下文但**保留步骤快照**——步骤重载后改名 / 删除 / 孤儿「关联」修复仍要
  // 快照整包回写，全清会让右侧面板改名变成"改完不落库"、孤儿关联下拉直接是空的。
  canvas.clearSourceCtxKeepSteps()
  canvas.clearSiteCtx()
  canvas.setFlowName(flow.name)
  name.value = flow.name
  canvas.markSaved()
  if (canvas.main.length <= 2) return false // 只有 start/end：配置和步骤都没给出任何真实节点
  derivedFromConfig.value = true
  return true
}

/**
 * 打开工作区必须**单独取一次详情**：列表走的是 flowPaged，它不返回 flowConf 这个大字段，
 * 行上的 definition 恒为空流程。直接拿列表行喂画布的话，任何已有流程点开都是一张空画布
 * ——保存下去还会把真实的 flowConf 覆盖成空。2026-09-02 联调实测撞到过。
 * loadSeq 防竞态：连着点两条流程时，先返回的那条不能盖住后点的。
 */
let loadSeq = 0
const loadingDetail = ref(false)
// 0927 P1-5：步骤快照拉取失败降级为 [] 时置位——flowIdMode 下无快照的节点会被跳过回写
// （persistFlowSteps 计 skipped、autosave 停在 pending），这里常驻警示条把「为什么没保存」
// 说清楚，不再让用户面对「已保存」的假象。
const stepsLoadFailed = ref(false)
async function openFlowInWorkspace(flow: FlowRecord) {
  const reqId = ++loadSeq
  // 先用列表行把名字/头部铺上，画布等详情回来再填，避免闪一下旧流程的节点
  name.value = flow.name
  loadingDetail.value = true
  derivedFromConfig.value = false
  stepsLoadFailed.value = false
  try {
    // 流程中心是编辑入口。先取得独立草稿工作副本，后续名称、属性、画布和步骤都只写草稿；
    // 当前发布版本继续供运行任务使用，直到用户显式点击“发布版本”。接口同时接受 workflow.id
    // 与旧 cs_flow.FLOW_ID，兼容流程中心仍以 FLOW_ID 打开流程的现状。
    let editFlowId = flow.id
    let editVersion = flow.version
    if (versioned) {
      const state = await workflowBindingApi.ensureDraft(flow.id)
      if (reqId !== loadSeq) return
      if (!state.draftFlowId) throw new Error('未取得可编辑的草稿工作副本')
      versionState.value = state
      editFlowId = state.draftFlowId
      editVersion = state.draftVersionNo
    }
    // 0926：详情先取——取不到就整窗报错关掉，**不发起后续请求**（steps 事前拉没有意义，
    // 还会把错误路径拖慢）。详情成功后再并行不迟…… 不，**串行**：steps 必须在
    // loadIntoWorkspace（工作区渲染）之前就绪——快照供改名 / 孤儿「关联」整包回写，
    // 若打开后再异步补，快照会在任何一次交互（收起/展开/编辑）途中到达，触发画布重建
    // 与留存的竞态（实测 120ms mock 延迟落到后续用例/交互里）。快照失败不阻断打开
    // （改名/关联降级为缺快照提示）。
    const full = await flowCenterApi.detail(flow.id)
    if (reqId !== loadSeq) return
    const record: FlowRecord = versioned
      ? { ...(full ?? flow), id: editFlowId, version: editVersion }
      : (full ?? flow)
    workingFlow.value = record
    // 0927：一次取回**带 configType 的完整步骤**（withConfigDetails 默认 true）——它既是
    // 快照（改名/孤儿「关联」整包回写），也是工作区画布的内容源（配合下方"有步骤行就按
    // 步骤还原"），configType 让摘要/翻译/打标签等节点一回读就是对的模板，不用再补查。
    // 流程版本（2026-10-10）：217 起发布版只读，有草稿时工作区画布显示草稿
    await flowVersion.load(editFlowId)
    const steps = await flowCenterApi.steps(editFlowId, ...draftVersionArgs(editFlowId))
      .catch((reason) => {
        console.warn('[flow-drawer] 步骤快照加载失败：改名/孤儿关联将缺少快照', reason)
        stepsLoadFailed.value = true
        return [] as Step[]
      })
    if (reqId !== loadSeq) return
    // ⚠️ 判据是"有没有**真实节点**"，不是 main 非空（2026-09-04 修）。
    // `makeBlankTemplateDefinition()` 产出的 main 是 ['start','end']——结构上非空、实际一个节点
    // 都没有。按长度判会让**我们自己新建的流程永远走不到下面的还原分支**：saveFlow 在后端
    // 自动建了一条 isRoot=1 的真实根节点（旧平台新增流程同样如此，实测 1400987/1400988/1400989
    // 各恰好 1 条），而我们拿着这份空 flowConf 把它盖掉，画布显示 0 个节点，旧平台显示 1 个。
    const hasRealNode = record.definition.main.some((id) => id !== 'start' && id !== 'end')
      || (record.definition.branchGroups ?? []).some((g) => g.branches.some((b) => b.chain.length))
    // 0927 流程工作区展示修正（用户反馈「流程工作区未按接口返回的（nextConfigPaged）展示」）：
    // 原来这里在 flowConf 有真实节点时**优先按 flowConf 展示**，而 flowConf 只是历史快照——
    // 它与步骤（cs_item_config，执行器唯一事实源）是两本账（0926 REVIEW「一套数据、两本账」）：
    // 源画布/自动保存/发布 SQL 改过步骤之后 flowConf 不会跟着变，抽屉里画出来的还是旧拓扑
    // （缺节点 / 分支被拍平 / 缺入口）。其余画布入口（源画布 loadFromSource、FlowBoard 重载
    // reloadFlowIntoCanvas）早已统一按接口步骤还原，只有抽屉还认 flowConf——本次收齐。
    // 改成：**接口步骤有内容就一律按它还原**（svg+flowId 查询就是用户看到的真实执行拓扑），
    // flowConf 只兜底「步骤侧没有内容」的场景（新建未落库流程 / 步骤接口故障）。
    const hasRealSteps = steps.some((s) => !!s.stepId)
    if (hasRealSteps) {
      const derived = await deriveFromFlowConfig(record, steps).catch(() => false)
      if (reqId !== loadSeq) return
      if (derived) return
    }
    if (hasRealNode) {
      loadIntoWorkspace(record, steps)
      return
    }
    // 存量流程走这条：flowConf 空，但这个流程自己的 config/步骤有真实内容
    const derived = await deriveFromFlowConfig(record).catch(() => false)
    if (reqId !== loadSeq) return
    if (!derived) loadIntoWorkspace(record, steps) // 配置和步骤都没给出内容，那就是一张真空白画布
  } catch (error) {
    if (reqId !== loadSeq) return
    // 取不到详情就不要拿空画布糊弄——那会让人以为流程是空的，一保存就真空了
    ElMessage.error(`流程详情加载失败：${(error as Error)?.message ?? String(error)}，请重新打开`)
    emit('close')
  } finally {
    if (reqId === loadSeq) loadingDetail.value = false
  }
}

watch(() => props.flow?.id, () => {
  if (props.flow) void openFlowInWorkspace(props.flow)
}, { immediate: true })

async function persistFlow(showMessage = true, isTemplate?: boolean): Promise<FlowRecord | null> {
  if (!workingFlow.value || saving.value || publishing.value) return null
  const trimmed = name.value.trim()
  if (!trimmed) {
    ElMessage.warning('请输入流程名称')
    return null
  }
  saving.value = true
  try {
    // 0926：让画布改建**先落步骤表**（cs_item_config，由自动保存执行），再落流程定义
    // （cs_flow.FLOW_CONF）。两步的节点 ID 必须一致：自动保存会把草稿 ID 换成后端步骤 ID，
    // 不先 flush 就拿画布定义，flowConf 里存的还是草稿 ID，与真实步骤对不上（R2 半程落库的
    // 一半解法——另一半是自动保存本身，见 ensureAutosaveBound）。
    // 只在有脏改动时 flush：没有改动就不触发整批步骤回写（大流程每次点「保存流程」都重写
    // 全部步骤行是没有必要的）。
    if (canvas.flowDirty || autosave.status.value === 'saving') {
      await autosave.flush()
      // 0926 REVIEW F-R16（同 F-R5 closeWorkspace 口径）：flush 内部 catch 永不 reject，
      // 失败只置 error 状态并退避重试（还会有 error toast）。不在这里拦住的话，步骤没落库、
      // 草稿 ID 没换绑真实 ID，flowConf 却照样保存成功并弹绿——用户看到成功，实际步骤
      // 与流程定义对不上。中止保存，让用户先解决步骤落库（头部「保存失败，点击重试」）。
      if (autosave.status.value === 'error') {
        ElMessage.warning('步骤保存失败，流程尚未保存。请先重试（头部「保存失败，点击重试」）')
        return null
      }
    }
    const saved = await flowCenterApi.save({
      id: workingFlow.value.id,
      name: trimmed,
      definition: definitionFromCanvas(),
      ...(isTemplate === undefined ? {} : { isTemplate }),
      // 这三项在抽屉里可编辑，保存时一并提交。空串是有意义的（= 清空），
      // 所以这里**不做"空就不传"**——与新建表单不同，那边空表示"没填过"。
      categoryId: metaForm.categoryId,
      flowTags: normalizeTags(metaForm.tags),
      description: metaForm.description.trim(),
    })
    name.value = saved.name
    workingFlow.value = saved
    canvas.markSaved()
    if (!versioned) emit('saved', saved)
    if (showMessage) {
      ElMessage.success(versioned
        ? `草稿 v${versionState.value?.draftVersionNo ?? saved.version ?? '—'} 已保存`
        : (saved.version == null ? '流程已保存' : `流程已保存为 v${saved.version}`))
    }
    return saved
  } catch (error) {
    ElMessage.error(`流程保存失败：${(error as Error)?.message ?? String(error)}`)
    return null
  } finally {
    saving.value = false
  }
}

/**
 * 标记 / 取消标记为模板（0903 H24）。抽屉里改走 persistFlow——它已经带着 flowId 与画布定义，
 * 顺手把标记一起提交即可；**不要另发一次只带 templateFlag 的 saveFlow**，那是全量保存端点，
 * 漏掉 definition 会把画布存空。
 */
const togglingTemplate = ref(false)
async function toggleTemplate() {
  if (!workingFlow.value || togglingTemplate.value) return
  const next = !workingFlow.value.isTemplate
  togglingTemplate.value = true
  try {
    const saved = await persistFlow(false, next)
    if (saved) ElMessage.success(next ? '已标记为模板' : '已取消模板标记')
  } finally {
    togglingTemplate.value = false
  }
}

async function applyToSource() {
  if (!versioned) {
    // 没有草稿概念：有未保存改动先存，再关联（合并前的行为）
    const saved = canvas.dirty || name.value.trim() !== workingFlow.value?.name
      ? await persistFlow(false)
      : workingFlow.value
    if (saved) emit('apply', saved)
    return
  }
  if (versionState.value?.draftFlowId) {
    ElMessage.warning('当前修改仍是草稿，请先发布版本后再关联到源')
    return
  }
  if (workingFlow.value) emit('apply', workingFlow.value)
}

async function publishVersion() {
  const state = versionState.value
  if (!state?.workflowId || !state.draftFlowId || publishing.value) return
  const saved = await persistFlow(false)
  if (!saved) return
  try {
    await ElMessageBox.confirm(
      `发布 v${state.draftVersionNo ?? '—'} 后，新发起的任务将使用该版本；已经运行的任务继续使用原版本。`,
      '发布流程版本',
      { confirmButtonText: '确认发布', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  publishing.value = true
  try {
    const published = await workflowBindingApi.publish(state.workflowId)
    const publishedFlow: FlowRecord = {
      ...saved,
      id: published.publishedFlowId || saved.id,
      version: published.publishedVersionNo ?? saved.version,
    }
    versionState.value = published
    workingFlow.value = publishedFlow
    emit('saved', publishedFlow)
    ElMessage.success(`流程 v${published.publishedVersionNo ?? '—'} 已发布，新任务将使用新版本`)
    emit('close')
  } catch (error) {
    ElMessage.error(`流程发布失败：${(error as Error)?.message ?? String(error)}`)
  } finally {
    publishing.value = false
  }
}
</script>

<template>
  <aside v-if="flow" class="fd-drawer" aria-label="流程工作区">
    <header class="fd-head">
      <div class="fd-title">
        <span class="fd-kicker">流程工作区</span>
        <input v-model="name" class="fd-name" aria-label="流程名称" @input="canvas.setFlowName(name)" />
        <p>
          {{ workingFlow?.id || flow.id }} · 更新于 {{ workingFlow?.updatedAt || flow.updatedAt || '—' }}
          <span v-if="versionState?.draftFlowId" class="fd-badge draft" data-testid="flow-drawer-version-status">
            草稿 v{{ versionState.draftVersionNo }}
          </span>
          <span v-if="versionState?.publishedVersionNo" class="fd-badge ghost">
            当前发布 v{{ versionState.publishedVersionNo }}
          </span>
          <span v-if="workingFlow?.isTemplate" class="fd-badge" data-testid="flow-drawer-template-badge">模板</span>
          <span v-else-if="workingFlow?.fromTemplateId" class="fd-badge ghost">来自模板 #{{ workingFlow.fromTemplateId }}</span>
        </p>
      </div>
      <!-- 0927 P0-1：抽屉内保存状态条（embedded 画布不渲染 CanvasHeader，状态/重试原来
           无处可看可点；同时把 error 态的「强关出口」显式化，见 closeWorkspace）。 -->
      <div v-if="!loadingDetail" class="fd-save-status" data-testid="flow-drawer-save-status">
        <template v-if="autosave.status.value === 'error'">
          <span class="fd-save-text is-error">步骤保存失败，将自动重试</span>
          <button
            type="button"
            class="fd-retry"
            data-testid="flow-drawer-retry"
            :title="autosave.lastError.value ? `保存失败：${autosave.lastError.value}` : '点击重试'"
            @click="void autosave.flush()"
          >重试</button>
        </template>
        <template v-else-if="autosave.status.value === 'saving'"><span class="fd-save-text">步骤保存中…</span></template>
        <template v-else-if="autosave.status.value === 'pending'"><span class="fd-save-text is-pending">待补全节点配置后自动保存（见右侧提示）</span></template>
        <template v-else-if="autosave.status.value === 'saved'"><span class="fd-save-text">步骤已保存</span></template>
      </div>
      <button class="fd-close" type="button" title="关闭" @click="void closeWorkspace()">✕</button>
    </header>

    <!-- 流程属性（0904 I16/I17 · Z7-5）：分类 / 标签 / 描述可改，随「保存流程」一起提交。
         业务大类只读——生产里 bizType 一个值都没有，枚举无从照抄（0904 Q3）。 -->
    <div class="fd-meta">
      <label class="fd-meta-item">
        <span>分类</span>
        <select v-model="metaForm.categoryId" class="fd-meta-input" data-testid="flow-meta-category">
          <option value="">不设置</option>
          <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </label>
      <label class="fd-meta-item">
        <span>标签</span>
        <input v-model="metaForm.tags" class="fd-meta-input" data-testid="flow-meta-tags" placeholder="多个用逗号或空格分隔" />
      </label>
      <label class="fd-meta-item grow">
        <span>描述</span>
        <input v-model="metaForm.description" class="fd-meta-input" data-testid="flow-meta-desc" placeholder="选填" />
      </label>
      <span v-if="flow.bizType" class="fd-meta-ro" title="业务大类（只读）">大类 {{ flow.bizType }}</span>
      <span v-if="flow.createdAt" class="fd-meta-ro">创建于 {{ flow.createdAt }}</span>
    </div>

    <div v-if="loadingDetail" class="fd-loading" data-testid="flow-workspace-loading">正在加载流程定义…</div>
    <!-- 0927 P1-5：快照拉取失败常驻警示——flowIdMode 下无快照节点会被跳过回写（autosave 留在
         pending 不再假装已保存），把「为什么没保存」说清楚，避免用户对着「已保存」干等。 -->
    <div v-if="stepsLoadFailed" class="fd-warn" data-testid="flow-drawer-steps-failed">
      步骤快照加载失败：节点改名 / 关联等改动将无法保存，请关闭后重新打开此流程。
    </div>
    <!-- 还原态必须说明白：画布上这些节点还没写进流程本身，是照这个流程自己的配置和步骤画的。
         不写这行的话，用户会以为流程里已经存着这份定义。 -->
    <div v-if="!loadingDetail && derivedFromConfig" class="fd-derived" data-testid="flow-derived-note">
      <template v-if="versioned">该草稿尚未保存画布定义，以下节点按草稿工作副本（#{{ workingFlow?.id }}）还原，点“保存草稿”后写入草稿。</template>
      <template v-else>该流程尚未保存画布定义，以下节点按这个流程自己的配置（#{{ workingFlow?.id }}）还原，点「保存流程」后才会写入流程。</template>
    </div>
    <!-- 配置区的「展开 / 收起」两个按钮在 NodeInspector 里，改的是 ui 上那对全局标志。
         抽屉原来是死的两列栅格，点了没反应（0905 反馈「这里的展开收起未生效」）——
         这里跟画布页 rc-flow-shell 用同一套口径：展开＝画布收成窄条，收起＝配置区收成窄条。 -->
    <div
      v-if="!loadingDetail"
      class="fd-workspace"
      :class="{ expanded: ui.inspectorExpanded, 'insp-collapsed': ui.inspectorCollapsed }"
    >
      <button
        v-if="ui.inspectorExpanded"
        type="button"
        class="fd-strip"
        data-testid="flow-drawer-canvas-collapsed"
        title="点击恢复画布"
        @click="ui.toggleInspectorExpanded()"
      >» 画布已收起</button>
      <section v-else class="fd-canvas" aria-label="流程节点">
        <FlowBoard embedded />
      </section>
      <button
        v-if="ui.inspectorCollapsed"
        type="button"
        class="fd-strip"
        data-testid="flow-drawer-inspector-collapsed"
        title="点击展开节点配置"
        @click="ui.toggleInspectorCollapsed()"
      >« 节点配置</button>
      <section v-else class="fd-inspector" aria-label="节点设置">
        <NodeInspector hide-ai />
      </section>
    </div>

    <footer class="fd-foot">
      <!-- 这行原来写的是「关联到源只登记归属关系，不改动源现有的配置与步骤」，与 0903 H1 的
           答复相反（「执行就按 flowID 去反选，去执行」）：绑定即生效，关联过来的源会**共用**
           这个流程的配置。说的和做的相反比不说更糟，2026-09-04 改。 -->
      <span v-if="versioned" class="fd-foot-note">修改只保存到草稿，不影响当前运行版本；发布后，新发起的任务使用新版本，运行中的任务保持原版本。</span>
      <span v-else class="fd-foot-note">节点配置在右侧直接修改；关联到源后，这些源将共用本流程的配置——此后改这里会同时影响它们。</span>
      <button
        class="fd-secondary"
        type="button"
        :disabled="saving || togglingTemplate"
        data-testid="flow-drawer-toggle-template"
        @click="toggleTemplate"
      >{{ workingFlow?.isTemplate ? '取消模板' : '标记为模板' }}</button>
      <button class="fd-secondary" type="button" :disabled="saving || publishing" data-testid="flow-apply-to-source" @click="applyToSource">关联到源</button>
      <button :class="versioned ? 'fd-secondary' : 'fd-primary'" type="button" :disabled="saving || publishing || loadingDetail" data-testid="flow-save" @click="persistFlow()">{{ saving ? '保存中…' : (versioned ? '保存草稿' : '保存流程') }}</button>
      <button v-if="versioned" class="fd-primary" type="button" :disabled="saving || publishing || loadingDetail || !versionState?.draftFlowId" data-testid="flow-publish" @click="publishVersion">{{ publishing ? '发布中…' : `发布 v${versionState?.draftVersionNo ?? '—'}` }}</button>
    </footer>
  </aside>
</template>

<style scoped>
.fd-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 8px 16px; border-bottom: 1px solid var(--rc-border-soft); }
.fd-meta-item { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--rc-text-2); }
.fd-meta-item.grow { flex: 1; min-width: 180px; }
.fd-meta-input { height: 26px; padding: 0 8px; border: 1px solid var(--rc-border); border-radius: 5px; font-size: 12px; background: #fff; }
.fd-meta-item.grow .fd-meta-input { flex: 1; min-width: 0; }
.fd-meta-ro { color: var(--rc-faint); font-size: 12px; }
.fd-badge { margin-left: 6px; padding: 0 6px; border-radius: 8px; font-size: 11px; background: var(--rc-primary-soft, #eaf2ff); color: var(--rc-primary, #2f6fed); }
.fd-badge.draft { background: #fff7ed; color: #c2410c; }
.fd-badge.ghost { background: transparent; color: var(--rc-faint); border: 1px solid var(--rc-border-soft); }
.fd-drawer { position: fixed; top: 56px; right: 0; bottom: 0; width: min(980px, calc(100vw - 256px)); max-width: 100vw; z-index: 40; display: flex; flex-direction: column; background: #fff; border-left: 1px solid var(--rc-border); box-shadow: -12px 0 32px -24px rgba(15, 23, 42, 0.48); }
.fd-head { display: flex; align-items: flex-start; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--rc-border-soft); }
.fd-title { min-width: 0; }
.fd-kicker { display: block; color: var(--rc-muted); font-size: 11px; }
.fd-name { display: block; width: min(520px, 70vw); margin: 2px 0 3px; padding: 0; border: 0; outline: 0; background: transparent; color: var(--rc-text); font-size: 15px; font-weight: 700; }
.fd-name:focus { box-shadow: inset 0 -1px 0 var(--rc-primary); }
.fd-title p { margin: 0; color: var(--rc-faint); font-size: 11px; font-variant-numeric: tabular-nums; }
.fd-save-status { display: flex; align-items: center; gap: 8px; margin-top: 20px; }
.fd-save-text { color: var(--rc-muted); font-size: 11px; white-space: nowrap; }
.fd-save-text.is-error { color: #dc2626; }
.fd-save-text.is-pending { color: #b45309; }
.fd-retry { height: 24px; padding: 0 10px; border: 1px solid #fca5a5; border-radius: 6px; background: #fff; color: #dc2626; font-size: 11px; font-weight: 600; cursor: pointer; }
.fd-retry:hover { background: #fef2f2; }
.fd-warn { padding: 8px 16px; border-bottom: 1px solid #fecaca; background: #fef2f2; color: #b91c1c; font-size: 12px; line-height: 1.5; }
.fd-close { margin-left: auto; border: 0; background: transparent; color: var(--rc-faint); font-size: 14px; cursor: pointer; }
.fd-close:hover { color: var(--rc-text); }
.fd-derived { padding: 8px 16px; border-bottom: 1px solid #fde68a; background: #fffbeb; color: #92400e; font-size: 12px; line-height: 1.5; }
.fd-loading { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--rc-faint); font-size: 12px; background: #f4f7fb; }
.fd-workspace { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(340px, 42%) minmax(420px, 1fr); gap: 10px; padding: 10px; background: #f4f7fb; }
.fd-workspace.expanded { grid-template-columns: 36px minmax(0, 1fr); }
.fd-workspace.insp-collapsed { grid-template-columns: minmax(0, 1fr) 36px; }
.fd-canvas, .fd-inspector { min-width: 0; min-height: 0; }
.fd-strip { min-width: 0; padding: 0; border: 1px solid var(--rc-border); border-radius: 8px; background: #fff; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; writing-mode: vertical-rl; }
.fd-strip:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); border-color: #93c5fd; }
.fd-foot { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--rc-border-soft); }
.fd-foot-note { flex: 1; color: var(--rc-faint); font-size: 11px; }
.fd-primary, .fd-secondary { height: 32px; padding: 0 14px; border-radius: 7px; font-size: 12px; font-weight: 600; cursor: pointer; }
.fd-primary { border: 1px solid var(--rc-primary); background: var(--rc-primary); color: #fff; }
.fd-secondary { border: 1px solid #bfdbfe; background: #fff; color: var(--rc-primary-ink); }
.fd-primary:disabled, .fd-secondary:disabled { opacity: .55; cursor: not-allowed; }
@media (max-width: 980px) {
  .fd-drawer { width: 100vw; }
  .fd-workspace:not(.expanded):not(.insp-collapsed) { grid-template-columns: minmax(320px, 44%) minmax(360px, 1fr); overflow-x: auto; }
  .fd-workspace.expanded { grid-template-columns: 36px minmax(0, 1fr); }
  .fd-workspace.insp-collapsed { grid-template-columns: minmax(0, 1fr) 36px; }
}
</style>
