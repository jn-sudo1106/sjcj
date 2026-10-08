<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useFlowStore } from '@/stores/flow'
import { useUiStore } from '@/stores/ui'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, CopyDocument, Search, Switch } from '@element-plus/icons-vue'
import { applyTemplateToSource, copyFlowToSource, reloadSourceIntoCanvas, reportDetachResult } from '@/utils/flow/applyTemplateToSource'
import ReplaceFlowDialog from './ReplaceFlowDialog.vue'
import { confirmCopyFlow } from '@/utils/flow/confirmCopyFlow'
import { flowCenterApi, workflowBindingApi, type FlowRecord } from '@/api'
import { normalizeSourceView, sourceViewFromHash, type SourceWorkspaceView } from '@/utils/url/workspaceRoute'
import { toExternalHref } from '@/utils/url/externalUrl'
import { useFlowAutosave } from '@/views/FlowCanvas/canvas/useFlowAutosave'

const flow = useFlowStore()
const ui = useUiStore()
const { status: saveStatus, savedClock, lastError: saveError, flush: retryFlowSave } = useFlowAutosave()
const route = useRoute()
const router = useRouter()

const src = computed(() => flow.sourceCtx)
const view = ref<SourceWorkspaceView>(normalizeSourceView(route.query.view))
const flowMode = computed(() => route.query.flowMode === 'list' ? 'list' : 'canvas')
const isPrimaryFlow = computed(() => !src.value?.primaryFlowId || src.value.primaryFlowId === src.value.flowId)
const canStartPublishedFlow = computed(() => isPrimaryFlow.value && src.value?.workflowVersionStatus !== 'DRAFT')
const versionMeta = computed(() => {
  const s = src.value
  if (!s?.workflowVersionStatus) return null
  const version = s.workflowVersionNo ? ` v${s.workflowVersionNo}` : ''
  if (s.workflowVersionStatus === 'DRAFT') return { cls: 'draft', text: `草稿${version}` }
  if (s.workflowVersionStatus === 'ARCHIVED') return { cls: 'muted', text: `历史版本${version}` }
  return { cls: 'published', text: `已发布${version}` }
})
function syncView() {
  view.value = sourceViewFromHash(window.location.hash)
}
watch(() => route.query.view, (next) => {
  view.value = normalizeSourceView(next)
}, { immediate: true })
onMounted(() => window.addEventListener('hashchange', syncView))
onBeforeUnmount(() => window.removeEventListener('hashchange', syncView))

// 多流程接口（workflow/*）在当前后端上线前，流程的套用模板 / 更换 / 复制仍用顶栏这三个原有操作；
// 上线后改由流程标签栏负责，两套不同时出现（2026-10-08 合并 leo 分支时保留）。
const legacyFlowOps = !workflowBindingApi.available()

const templates = ref<FlowRecord[]>([])
const flowKeyword = ref('')
const flowPickerOpen = ref(false)
/**
 * 候选**只列已标记为模板的流程**（0903 Y8-24，2026-09-05 落地）。
 *
 * 这个下拉叫「切换流程模板」，之前却把 740 条流程全列出来——用户当场提出
 * 「这里的切换流程模板要展示为模板类型的流程，非模板类型不展示」。
 *
 * 原来做不了是因为 `FlowRecord` 上没有模板标记、后端也没答复能不能按它过滤（0903 H7）。
 * **两个前提都已解除**：H7 答复标记是 `templateFlag`(0/1) 且 `flowPaged` 支持服务端过滤，
 * `FlowRecord.isTemplate` 也已接上（acb2c4e）。这里改走 `flowCenterApi.templates()`
 * （后端专给的 `flowTemplateList`，不分页）。
 *
 * **仍然不做前端筛**：那条老口径没变——存量 740 条分页之后前端只能筛当前页，跨页是错的。
 */
async function loadTemplates() {
  templates.value = await flowCenterApi.templates()
}
onMounted(() => { if (legacyFlowOps) void loadTemplates() })

const visibleTemplates = computed(() => {
  const keyword = flowKeyword.value.trim().toLowerCase()
  const matched = keyword
    ? templates.value.filter((template) => template.name.toLowerCase().includes(keyword) || template.id.toLowerCase().includes(keyword))
    : templates.value
  return matched.slice(0, 10)
})
function openFlowPicker() {
  flowPickerOpen.value = true
}
function closeFlowPicker() {
  window.setTimeout(() => { flowPickerOpen.value = false }, 150)
}
function pickFlow(templateId: string) {
  flowKeyword.value = ''
  flowPickerOpen.value = false
  void onSwitchFlow(templateId)
}
function manageFlows() {
  flowKeyword.value = ''
  flowPickerOpen.value = false
  void onSwitchFlow('__manage_flows__')
}

// 顶部下拉 = **切换流程模板**（0903 H02）。
//
// 语义是「选一个模板 → 把模板里的那套配置复制出一套新的给当前源」，不是"让本源引用这个流程"。
// 0903 会上原话：「这里面东西应该选流程模板，然后你再切换……不是切换那个源里面那种」。
// 一度打算把这个下拉整个删掉（0903 设计方案初稿），后被推翻——要删的是"在已存在的源里换一个
// 流程引用"这个动作，不是这个入口本身。
const appliedTemplateLabel = computed(() => {
  const templateId = src.value?.templateId
  if (!templateId) return '套用流程模板'
  const template = templates.value.find((item) => item.id === templateId)
  if (!template) return '套用流程模板'
  // 真实 cs_flow 没有版本号（见 FlowRecord.version 注释），拿不到就只显示流程名，不要 `vundefined`
  const version = src.value?.templateVersion ?? template.version
  return version == null ? template.name : `${template.name} · v${version}`
})

const statusMeta = computed(() => {
  const s = src.value
  if (!s) return { cls: 'muted', text: '' }
  if (s.disabled) return { cls: 'muted', text: '已停用' }
  if (s.state === 'C') return { cls: 'ok', text: '成功' }
  if (s.state === 'E') return { cls: 'err', text: '出错' }
  if (s.state === 'L') return { cls: 'run', text: '运行中' }
  return { cls: 'muted', text: '未知' }
})
// 摘要头只展示运行所需信息；源 ID、分类和标签不在此处暴露。
// 参数源（0721 会议 T5）：只读摘要——普通源的 url 换成"参数源 · 模板 · N 个参数占位符"；
// 具体每个参数的真实取值数需要逐个查详情，摘要头不为此额外发请求，只读 paramRefs 数量。
const primaryMeta = computed(() => {
  const s = src.value
  if (!s) return ''
  return s.kind === 'param' ? `参数源 · ${s.urlTemplate || s.baseUrl || ''} · ${s.paramRefs?.length ?? 0} 个参数占位符` : s.url
})
// 「上次成功」单独拆出来，别再跟 URL 拼成一个字符串：公众号那类 URL 有 200+ 字符
// （`mp.weixin.qq.com/s?__biz=…&chksm=…&scene=…`），拼在一起会把时间和后面的「所属流程」
// 一起挤到换行甚至看不见（2026-09-17 走查）。拆开后 URL 单行省略，这两项始终可见。
const lastSuccessText = computed(() => (src.value?.lastSuccessAt ? `上次成功 ${src.value.lastSuccessAt}` : ''))

/**
 * 摘要行里的 URL 可点开（2026-09-17 用户提）：看到地址就想去原站核对一下，
 * 之前只能选中复制再贴到地址栏。
 *
 * 参数源的摘要是「参数源 · 模板 · N 个占位符」，不是个能打开的地址，不给链接。
 * 其余交给 toExternalHref 把关（只放行 http/https）。
 */
const openableUrl = computed(() => (src.value && src.value.kind !== 'param' ? toExternalHref(src.value.url) : ''))

// 所属流程：源上带 flowId（sourceDetail 已补，0903 §H8），流程名要单查一次 flow/detail；
// 查不到就退化成 `#<id>`。切源时按 flowId 变化重查，回来慢了也不会写串。
const owningFlowName = ref('')
/**
 * 「这个 flowId 是悬空的」——流程被删了，源还挂着它（0917 R1，方案 §21）。
 *
 * **只认 `detail()` 返回 null 这一种情况**：那个函数的语义是查不到返回 `null`、
 * 网络 / HTTP 错误抛异常（`api/index.ts:2866`）。catch 里一律不标记，
 * 否则断网时整屏的源都写着「流程已删除」，比不标更糟。
 */
const owningFlowMissing = ref(false)
/** 所属流程被多少个源共用（复制当前流程的确认框里提示影响面）；查不到为 undefined */
const owningFlowSourceCnt = ref<number | undefined>()
watch(() => src.value?.flowId, async (fid) => {
  owningFlowName.value = ''
  owningFlowMissing.value = false
  owningFlowSourceCnt.value = undefined
  if (!fid) return
  const want = String(fid)
  try {
    const rec = await flowCenterApi.detail(want)
    if (String(src.value?.flowId ?? '') !== want) return
    owningFlowName.value = rec?.name ?? ''
    owningFlowMissing.value = rec === null
    owningFlowSourceCnt.value = rec?.sourceCnt
  } catch { /* 保留 ID 展示，不标记已删除 */ }
}, { immediate: true })
const owningFlowLabel = computed(() => {
  const fid = src.value?.flowId
  if (!fid) return ''
  if (owningFlowName.value) return owningFlowName.value
  return owningFlowMissing.value ? `#${fid}（流程已删除）` : `#${fid}`
})
const owningFlowTitle = computed(() => (owningFlowMissing.value
  ? '这个流程已经被删除，源上的流程 ID 成了悬空引用'
  : '在流程中心查看这个流程'))

/**
 * 去流程中心时带上「回来的路」（0917-09）。
 *
 * `/flows` 是主导航页，不挂源页签条（`SourceTabsBar.vue:31` 只认 `/collect` 和 `/canvas`），
 * 所以离开画布之后没有任何入口能回到刚才那个源——会上原话「你别让他忙了半天回不去了」。
 * 流程中心读到 `from=canvas` 就渲染一条返回条。
 *
 * `view` 要原样带走：这个头是常驻的，从数据视图点出去的人，回来也该落在数据视图。
 * `fromName` 一起带上，返回条要显示源名，而流程中心手上只有 ID——传过去就不用再查一次源详情。
 */
function flowCenterQuery(extra: Record<string, string> = {}): Record<string, string> {
  const s = src.value
  const siteId = s?.siteId || String(route.query.siteId ?? '')
  const q: Record<string, string> = { from: 'canvas', view: view.value, ...extra }
  if (s?.sourceId) q.sourceId = String(s.sourceId)
  if (siteId) q.siteId = siteId
  if (s?.name) q.fromName = s.name
  return q
}
function openOwningFlow() {
  const fid = src.value?.flowId
  // 已删除的流程点过去只会在流程中心搜出一个空列表，看着像搜索坏了——按钮已 disabled，这里再挡一道
  if (!fid || owningFlowMissing.value) return
  router.push({ path: '/flows', query: flowCenterQuery({ q: owningFlowName.value || String(fid) }) })
}
/**
 * 返回源视图（0828 W5-6/7 合并）。
 *
 * 原来是「返回列表」→ `/collect`（网站列表）。会上明确不要回网站列表：
 * 「你这个返回不要返回到网站」「我点个返回的源列表」。
 * 落点是**当前源所属网站**的源视图（单网站），不是全网站。
 * 这也把原计划里单独加一个「源视图」入口按钮那条合并掉了：一个返回按钮就够，不再多摆一个。
 *
 * 归属网站按既有优先级取：源上下文 > URL。游离源（无网站归属，见 0824-11 §1.2c-3）
 * 没有可回的源视图，退回网站列表。
 */
function backToSourceView() {
  const siteId = src.value?.siteId || String(route.query.siteId ?? '')
  if (siteId) router.push({ path: '/canvas', query: { siteId, view: 'source' } })
  else router.push('/collect')
}
// 0917：监控视图页签改为**常驻**，跟流程/数据/文件/任务四档一样，选中的是不是数据监控节点都显示。
// 之前按 `isMonitorNode(flow.selectedNode)` 显隐，还配了一条"选中非监控节点就弹回流程视图"的兜底；
// 产品口径是这五个视图平级——点任意节点都能停在监控视图上（0928 起这一档整块换成按当前源过滤的
// 「监控结果 / 监控配置」两 Tab，不再看选中节点类型，见 MonitorConfigView）。
function switchView(target: SourceWorkspaceView) {
  if (view.value === target) {
    if (target === 'data') ui.applyViewLayoutDefault('data')
    return
  }
  const query = { ...route.query }
  // 六个工作视图均显式写入 URL，刷新和深链保持当前视图。
  query.view = target
  void router.replace({ path: '/canvas', query })
}

function switchFlowMode(mode: 'canvas' | 'list') {
  if (view.value !== 'flow' || flowMode.value !== mode) {
    void router.replace({ path: '/canvas', query: { ...route.query, view: 'flow', flowMode: mode } })
  }
}

// 发起抓取（0714 会议 Task 4）：唯一的完整执行入口——本组件只派发动作，
// 校验/请求/驱动运行态统一收在 index.vue（走 ui 动作总线，避免在 FlowBoard/ResultView/TaskView/FileView
// 四处宿主组件里各自转发一遍事件）。
function srcSnatch() {
  ui.fireAction('发起抓取')
}

/**
 * 下拉的 tooltip 要把它和左边那个「所属流程」区分开（2026-09-22）。
 * 两块挨着放，一个是「套一份模板的步骤到本源」、一个是「本源挂在哪条流程下」，
 * 用户很自然会以为在这里选一下所属流程就跟着变——所以直接写出来。
 */
const flowPickerTitle = computed(() => `${appliedTemplateLabel.value}（把模板的步骤复制一套到本源；不改「所属流程」）`)

const switchingFlow = ref(false)
/** 套用中的逐条进度文案（复制配置 i/N），显示在搜索框 placeholder 上 */
const switchingLabel = ref('')
async function onSwitchFlow(command: string) {
  if (!command) return
  if (command === '__manage_flows__') {
    // 与「所属流程」同一条离开路径，同样要能回来（0917-09）
    void router.push({ path: '/flows', query: flowCenterQuery() })
    return
  }
  const template = templates.value.find((item) => item.id === command)
  const source = src.value
  if (!template || !source?.sourceId || switchingFlow.value) return
  const sourceId = source.sourceId
  const nodeCount = flow.main.filter((id: string) => flow.configs[id]).length
  // 确认弹窗**恒弹**（0903 Y0-3）：这一步会为本源新建一整套配置，任何情况下都该让人先看一眼。
  //
  // 文案 2026-09-22 重写。原来写的是「当前 N 个节点会被替换」＋按钮「复制并替换」——
  // 那是前端本地替换时代的话。现在走后端 copyTemplateSteps，它**只追加不删除**，
  // 现有节点一个不少。承诺替换却做成追加，比不说更糟。
  // 2026-09-29（F2）：后端复制**只搬步骤行**、CONFIG_ID 沿用模板（共享），前端在复制完成后
  // 立即逐步骤复制配置并换绑（detachCopiedConfigs），兑现「复制出的改动不影响模板」。
  try {
    await ElMessageBox.confirm(
      [
        `将复制模板「${template.name}」的步骤到本源的流程。`,
        nodeCount
          ? `当前 ${nodeCount} 个节点会保留，模板的步骤追加在后面——这一步不删任何现有节点。`
          : '',
        source.flowId
          ? '本源已有流程，步骤复制进这条流程里，所属流程不变。'
          : '本源还没有流程，会按模板新建一条并关联到本源。',
        '复制完成后会自动为新增节点复制一份独立配置，之后修改本源流程的节点**不会影响模板及其它源**。',
        flow.dirty ? '当前画布有未保存改动，套用后会从服务端重新加载，未保存的改动将丢弃。' : '',
      ].filter(Boolean).join(''),
      '套用流程模板',
      { type: 'warning', confirmButtonText: '复制并追加', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  switchingFlow.value = true
  switchingLabel.value = ''
  try {
    const applied = await applyTemplateToSource(
      template.id,
      sourceId,
      source.flowId,
      source.name,
      { onProgress: (done, total) => { switchingLabel.value = `（正在复制配置 ${done}/${total}）` } },
    )
    // 后端已经把步骤建好了，画布必须重新按后端拓扑加载——本地拼的 id 是草稿 id，
    // 自动保存会把同一批步骤再建一遍。
    const reloaded = await reloadSourceIntoCanvas(sourceId)
    ElMessage.success(applied.createdFlow
      ? `已按模板「${template.name}」新建流程 #${applied.flowId} 并关联到本源`
      : (applied.message || `已把模板「${template.name}」的步骤复制到本源的流程`))
    reportDetachResult(applied.detach)
    if (!reloaded) ElMessage.warning('步骤已复制，但画布重新加载失败，请刷新页面查看')
  } catch (e) {
    ElMessage.error(`套用模板失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    switchingFlow.value = false
    switchingLabel.value = ''
  }
}

/**
 * 更换流程（0930）：与「套用流程模板」同一套复制能力，但候选是全部流程（可按源查），
 * 且语义是**换**不是**追加**——把选中流程整条复制一份（节点配置各自独立）作为本源的新流程并换绑。
 * 原流程不动，共用原流程的其他源不受影响（用户 0930 拍板：复制新流程并换绑）。
 */
const replaceOpen = ref(false)
async function onReplaceFlow(picked: FlowRecord) {
  const source = src.value
  if (!source?.sourceId) return
  const newName = `${source.name || source.sourceId}-流程`
  await copyFlowIntoSource(picked, {
    title: '更换流程',
    confirmText: '复制并更换',
    lines: [
      `将把流程「${picked.name}」（#${picked.id}）整条复制一份，作为本源的新流程「${newName}」。`,
      source.flowId
        ? `本源改挂到新流程；原流程 #${source.flowId} 不动，其他使用它的源不受影响。`
        : '本源还没有流程，新流程会直接关联到本源。',
    ],
    done: (newId) => `已复制流程「${picked.name}」为新流程 #${newId} 并关联到本源`,
    fail: '更换流程失败',
  })
}

/**
 * 复制当前流程（0930）：把本源当前所属流程复制一份作为本源独有的流程并换绑——0929 F2 场景二
 * 「想改但不想影响其它使用者 → 显式复制一个流程」。与「更换流程」同一个动作，来源固定为当前流程。
 */
async function onCopyCurrentFlow() {
  const source = src.value
  const fid = source?.flowId ? String(source.flowId) : ''
  if (!source?.sourceId || !fid || owningFlowMissing.value) return
  const name = owningFlowName.value || `#${fid}`
  const newName = `${source.name || source.sourceId}-流程`
  const others = owningFlowSourceCnt.value != null ? owningFlowSourceCnt.value - 1 : undefined
  await copyFlowIntoSource({ id: fid, name }, {
    title: '复制当前流程',
    confirmText: '复制',
    lines: [
      `将把当前流程「${name}」（#${fid}）复制一份，作为本源独有的新流程「${newName}」，本源改挂到新流程。`,
      others == null
        ? '原流程不动。'
        : others > 0
          ? `原流程不动，另外 ${others} 个使用原流程的源仍挂在原流程上。`
          : '当前流程只有本源在用，直接修改也不会影响别的源；复制后原流程会变成没有源使用。',
    ],
    done: (newId) => `已复制当前流程为新流程 #${newId}，本源已改挂到新流程`,
    fail: '复制当前流程失败',
  })
}

/**
 * 更换流程 / 复制当前流程共用：确认（含「新增一套配置 / 复用原配置」二选一，0930）
 * → 复制并换绑（copyFlowToSource）→ 从后端重载画布
 */
async function copyFlowIntoSource(
  from: { id: string; name: string },
  text: { title: string; confirmText: string; lines: string[]; done: (newId: string) => string; fail: string },
) {
  const source = src.value
  if (!source?.sourceId || switchingFlow.value) return
  const sourceId = source.sourceId
  const mode = await confirmCopyFlow({
    title: text.title,
    lines: [
      text.lines.join(''),
      flow.dirty ? '当前画布有未保存改动，完成后会从服务端重新加载，未保存的改动将丢弃。' : '',
      '节点配置：',
    ],
    confirmText: text.confirmText,
  })
  if (!mode) return
  const reuseConfigs = mode === 'reuse'
  replaceOpen.value = false
  switchingFlow.value = true
  switchingLabel.value = ''
  try {
    const copied = await copyFlowToSource(from.id, sourceId, source.name, {
      sourceFlowRef: `流程「${from.name}」`,
      onProgress: (done, total) => { switchingLabel.value = `（正在复制配置 ${done}/${total}）` },
      reuseConfigs,
    })
    const reloaded = await reloadSourceIntoCanvas(sourceId)
    ElMessage.success(text.done(copied.flowId) + (reuseConfigs ? '（节点复用原配置）' : ''))
    reportDetachResult(copied.detach, '原流程')
    if (!reloaded) ElMessage.warning('流程已复制并换绑，但画布重新加载失败，请刷新页面查看')
  } catch (e) {
    ElMessage.error(`${text.fail}：${(e as Error)?.message ?? String(e)}`)
  } finally {
    switchingFlow.value = false
    switchingLabel.value = ''
  }
}


</script>

<template>
  <div v-if="src" class="rc-canvas-head">
    <button class="rc-btn ghost" type="button" @click="backToSourceView">← 返回源视图</button>
    <div class="ch-switcher">
      <button class="ch-seg" :class="{ on: view === 'overview' }" type="button" @click="switchView('overview')">概览</button>
      <button class="ch-seg" :class="{ on: view === 'flow' }" type="button" @click="switchView('flow')">流程</button>
      <button class="ch-seg" :class="{ on: view === 'data' }" type="button" @click="switchView('data')">数据</button>
      <!-- ⚠️ 「文件视图 / 任务视图」**保留**。2026-09-05 一度按 0904 I11 把这两档删掉，是**读反了**：
           产品原话「文件和任务我觉得暂时吧，因为数据视图里面是包着文件的」——"暂时吧"是
           **暂时留着**，不是暂时去掉（当时开发问的是"这块不要了"，产品没有顺着答"对"）。
           删掉后用户当场提出「不是，任务视图和文件视图呢」，已还原。0904 纪要 I11 同步订正。 -->
      <button class="ch-seg" :class="{ on: view === 'file' }" type="button" @click="switchView('file')">文件</button>
      <button class="ch-seg" :class="{ on: view === 'task' }" type="button" @click="switchView('task')">任务</button>
      <!-- 监控视图（0917 常驻）：原来按 `v-if=isMonitorNode(选中节点)` 显隐，选中普通规则节点就整档消失，
           视觉上像"页签跑到别处去了"。现在跟前面四档一样常驻，节点类型只影响面板内容。
           0917 更名：「监控配置」→「监控视图」——这一档跟流程/数据/文件/任务平级，叫"配置"会被当成
           某个节点的配置面板入口；档内实际展示的告警面板才叫配置。 -->
      <button
        class="ch-seg"
        :class="{ on: view === 'monitor-config' }"
        type="button"
        data-testid="monitor-config-view"
        @click="switchView('monitor-config')"
      >监控</button>
    </div>
    <div v-if="view === 'flow'" class="ch-flow-mode-row" data-testid="flow-mode-row">
      <div class="ch-switcher ch-flow-mode" aria-label="流程展示方式">
        <button class="ch-seg" :class="{ on: flowMode === 'canvas' }" type="button" @click="switchFlowMode('canvas')">流程图</button>
        <button class="ch-seg" :class="{ on: flowMode === 'list' }" type="button" @click="switchFlowMode('list')">流程列表</button>
      </div>
      <div class="ch-flow-mode-actions" aria-label="源运行操作">
        <button class="rc-btn primary" type="button" :disabled="!canStartPublishedFlow" :title="!isPrimaryFlow ? '辅助/补数据流程不能从正常抓取入口启动' : src?.workflowVersionStatus === 'DRAFT' ? '草稿发布后才能作为新的运行版本发起抓取' : ''" @click="srcSnatch">发起抓取</button>
      </div>
    </div>

    <template v-if="src">
      <div class="ch-titlewrap">
        <div class="ch-title">
          {{ src.name }}
          <span class="rc-status" :class="statusMeta.cls">{{ statusMeta.text }}</span>
          <span v-if="versionMeta" class="rc-status" :class="versionMeta.cls">{{ versionMeta.text }}</span>
          <span v-if="src.externalChanged" class="rc-status warn">外部变更待确认</span>
        </div>
        <div class="ch-sub">
          <!-- 用 el-tooltip 不用原生 title：URL 单行省略后，全文只能靠悬浮看，
               而原生提示要等约 1 秒才出、长 URL 还会被拉成横穿屏幕的一条（见 tokens.css）。 -->
          <el-tooltip
            v-if="primaryMeta"
            :content="primaryMeta"
            placement="bottom-start"
            :show-after="120"
            popper-class="rc-tip-longtext"
          >
            <a
              v-if="openableUrl"
              class="ch-sub-url ch-sub-link"
              :href="openableUrl"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="source-url-link"
            >{{ primaryMeta }}</a>
            <span v-else class="ch-sub-url">{{ primaryMeta }}</span>
          </el-tooltip>
          <span v-else class="ch-sub-url"></span>
          <template v-if="lastSuccessText">
            <span class="ch-sub-sep">·</span>
            <span class="ch-sub-fixed">{{ lastSuccessText }}</span>
          </template>
          <template v-if="src.flowId">
            <span class="ch-sub-sep">·</span>
            <button
              class="ch-flow-link"
              type="button"
              data-testid="owning-flow"
              :disabled="owningFlowMissing"
              :title="owningFlowTitle"
              @click="openOwningFlow"
            >当前流程：<span class="ch-flow-name">{{ owningFlowLabel }}</span><span v-if="owningFlowName" class="ch-flow-id" data-testid="owning-flow-id">#{{ src.flowId }}</span></button>
            <span v-if="!isPrimaryFlow" class="ch-aux-flow">辅助流程，主流程 #{{ src.primaryFlowId }}</span>
          </template>
        </div>
      </div>
      <div v-if="view === 'flow' && flowMode === 'canvas'" class="ch-actions">
        <template v-if="legacyFlowOps">
          <div class="ch-flow-picker">
            <div class="ch-flow-searchbox" :class="{ open: flowPickerOpen }">
              <el-icon class="ch-flow-search-icon"><Search /></el-icon>
              <input
                v-model="flowKeyword"
                class="ch-flow-search"
                data-testid="flow-switch-search"
                :placeholder="switchingFlow ? (switchingLabel || '套用中…') : appliedTemplateLabel"
                :title="flowPickerTitle"
                aria-label="搜索并套用流程模板"
                :disabled="switchingFlow"
                @focus="openFlowPicker"
                @mousedown="openFlowPicker"
                @blur="closeFlowPicker"
              />
              <el-icon class="ch-flow-chevron"><ArrowDown /></el-icon>
            </div>
            <div v-if="flowPickerOpen" class="ch-flow-options" data-testid="flow-switch-options">
              <!-- 区分两种空：一个模板都没有 vs 搜索没搜到。前者要告诉用户去哪儿标记，
                   后者只是关键词不匹配——都说「没有匹配的流程模板」会让人以为是搜错了。 -->
              <div v-if="!templates.length" class="ch-flow-empty" data-testid="flow-picker-empty">
                还没有流程被标记为模板。可在流程中心对任一流程点「标记为模板」。
              </div>
              <div v-else-if="!visibleTemplates.length" class="ch-flow-empty">没有匹配的流程模板</div>
              <button
                v-for="template in visibleTemplates"
                :key="template.id"
                type="button"
                class="ch-flow-option"
                :class="{ active: template.id === src.templateId }"
                data-testid="flow-switch-option"
                @mousedown.prevent="pickFlow(template.id)"
              >
                <span class="ch-flow-option-name">{{ template.name }}</span>
                <span v-if="template.version != null" class="ch-flow-option-version">v{{ template.version }}</span>
              </button>
              <div v-if="!flowKeyword.trim() && templates.length > 10" class="ch-flow-limit">默认展示前 10 个，输入名称或 ID 搜索</div>
              <button type="button" class="ch-flow-manage" @mousedown.prevent="manageFlows">管理流程…</button>
            </div>
          </div>
          <!-- 0930 用户要求改成图标：文案收进 tooltip / aria-label；进度照旧显示在左边搜索框的 placeholder -->
          <el-tooltip content="更换流程：从全部流程里选一条复制给本源（原流程不动）" placement="bottom" :show-after="120">
            <button
              class="ch-icon-btn"
              type="button"
              data-testid="replace-flow-open"
              aria-label="更换流程"
              :disabled="switchingFlow"
              @click="replaceOpen = true"
            ><el-icon :size="14"><Switch /></el-icon></button>
          </el-tooltip>
          <el-tooltip v-if="src.flowId && !owningFlowMissing" content="复制当前流程：复制一份作为本源独有的流程，之后修改不影响其他源" placement="bottom" :show-after="120">
            <button
              class="ch-icon-btn"
              type="button"
              data-testid="copy-current-flow"
              aria-label="复制当前流程"
              :disabled="switchingFlow"
              @click="onCopyCurrentFlow"
            ><el-icon :size="14"><CopyDocument /></el-icon></button>
          </el-tooltip>
          <ReplaceFlowDialog v-if="replaceOpen" v-model="replaceOpen" :current-flow-id="src.flowId" @pick="onReplaceFlow" />
        </template>
        <!-- 0828 W9-2/D06：步骤接口已通，拓扑/进入条件防抖自动保存；不再放手动保存按钮。 -->
        <span class="ch-save-status" data-testid="flow-save-status">
          <span v-if="saveStatus === 'pending'" class="ch-save-pending">请先补全节点配置</span>
          <template v-else-if="saveStatus === 'saving'">保存中…</template>
          <template v-else-if="saveStatus === 'saved'">已保存 {{ savedClock }}</template>
          <!-- title 带上真实报错（0903）：原来失败只显示这六个字，排查时连是哪一步抛的都不知道 -->
          <button
            v-else-if="saveStatus === 'error'"
            class="ch-save-retry"
            type="button"
            data-testid="flow-save-retry"
            :title="saveError ? `保存失败：${saveError}（点击重试）` : '点击重试'"
            @click="void retryFlowSave()"
          >保存失败，点击重试</button>
        </span>
      </div>
      <!-- 「停用」0828 D24 移除：源启停统一在源视图的行操作里做，画布头只留运行入口。
           这里不做成禁用或隐藏——按钮整个删掉，避免同一能力两个入口。 -->
      <!-- 分支流程的提示（0903 YB-A/YB-3，YB-B 后改文案；0928 再改）：画布已经能还原分支结构，
           但自动保存对分支流程冻结已有步骤的 lastStep 回写（见 useStepWrite）——主链节点拖了
           画布会变、刷新就回去；分支里的节点本来就拖不动。新增节点（lastStep 按画布算）、
           改名、进入条件、配置照常保存，这里一并说清，免得用户以为分支流程整个是只读的。 -->
      <div v-if="view === 'flow' && flowMode === 'canvas' && flow.hasBranchedSteps" class="ch-branch-note" data-testid="flow-branch-flattened">
        <span aria-hidden="true">⚠</span>
        该流程含分支：已有节点的挂接关系不能在画布上调整（拖动不会保存）。可以在分支中新增节点，节点名称、进入条件、配置照常保存。
      </div>
    </template>
  </div>
</template>

<style scoped>
.rc-canvas-head { position: relative; z-index: 20; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; flex-wrap: wrap; }
.ch-switcher { display: inline-flex; padding: 2px; background: #f1f5f9; border: 1px solid var(--rc-border); border-radius: 7px; }
.ch-flow-mode-row { order: 10; flex: 0 0 100%; display: flex; align-items: center; padding-top: 8px; border-top: 1px solid var(--rc-border-soft); }
.ch-flow-mode { margin-left: 0; }
.ch-flow-mode-actions { display: flex; align-items: center; margin-left: auto; }
.ch-flow-mode-actions .rc-btn { height: 30px; padding: 0 11px; font-size: 12px; }
.ch-seg { height: 26px; padding: 0 12px; border: 0; background: transparent; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; border-radius: 5px; }
.ch-seg.on { background: var(--rc-primary); color: #fff; }
.ch-seg:hover:not(.on) { color: var(--rc-primary-ink); }
.ch-seg:disabled { color: var(--rc-faint); cursor: not-allowed; }
.ch-titlewrap { min-width: 0; }
.ch-title { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; color: var(--rc-text); font-size: 13px; }
.rc-status.draft { background: #fef3c7; color: #92400e; }
.rc-status.published { background: #dcfce7; color: #166534; }
/* 一行放下：URL 可压缩省略，时间和「所属流程」不参与压缩（flex: none），
   这样再长的 URL 也挤不掉它们。 */
.ch-sub { display: flex; align-items: center; min-width: 0; color: var(--rc-faint); font-size: 10px; margin-top: 1px; }
.ch-sub-url { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 默认呈现为蓝色链接（2026-09-21 用户反馈） */
.ch-sub-link { color: var(--rc-primary); text-decoration: none; }
.ch-sub-link:hover { color: var(--rc-primary); text-decoration: underline; }
.ch-sub-fixed { flex: none; }
.ch-sub-sep { flex: none; margin: 0 4px; }
/* flex: none + nowrap：默认的 0 1 auto 会让它跟着被压缩，长 URL 下它会被挤到 52px 宽、
   「所属流程：振江集团-603507」折成三行，把整条摘要撑高（2026-09-17 走查）。压缩只由 URL 段承担。 */
/* 下划线是**常态**，不是 hover 才有（2026-09-20 走查）：这一行是 10px 的灰字（.ch-sub），
   同行的 URL 还是 color: inherit，只有这一处带色——但产品仍然没认出它能点。
   字号不动：URL 段要靠 flex 压缩省略，动字号会牵动整行排版。 */
.ch-flow-link { flex: none; display: inline-flex; align-items: center; white-space: nowrap; border: 0; background: transparent; padding: 0; color: var(--rc-primary); font-size: inherit; cursor: pointer; }
/* 下划线只画在流程名上，ID 标签不带——原来整段（含【流程ID: xxx】）一条下划线，又长又乱（0930） */
.ch-flow-name { text-decoration: underline; text-underline-offset: 2px; }
.ch-flow-link:hover .ch-flow-name { text-decoration-thickness: 2px; }
/* 0926 起在流程名后带流程 ID；0930 由【流程ID: xxx】改成与画布节点步骤 ID 同款的小标签 `#xxx`
   （退化 `#id（流程已删除）` 形态本身已含 id，不重复追加） */
.ch-flow-id { margin-left: 6px; padding: 0 5px; border-radius: 4px; background: var(--rc-primary-bg); color: var(--rc-primary-ink); font: 600 10px/15px ui-monospace, SFMono-Regular, Menlo, monospace; }
.ch-aux-flow { margin-left: 6px; color: #7c3aed; white-space: nowrap; }
/* 流程已删除：跳过去只会搜出空列表，不给点 */
.ch-flow-link:disabled { color: var(--rc-faint); cursor: not-allowed; }
.ch-flow-link:disabled .ch-flow-name { text-decoration: none; }
.ch-actions { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; justify-content: flex-end; align-items: center; }
.ch-actions .rc-btn { height: 30px; padding: 0 11px; font-size: 12px; }
.ch-flow-picker { position: relative; width: 184px; margin-right: 4px; }
/* 与全站工具栏图标按钮同一套（采集资产 .ca-refresh / 任务视图 .tv-icon-btn / 表选择 .sts-refresh）：
   白底 + rc-border 细边 + 6px 圆角 + 灰图标，悬停只变描边与图标色；高度 30 与左边搜索框对齐 */
.ch-icon-btn { flex: none; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; width: 30px; height: 30px; padding: 0; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-muted); cursor: pointer; transition: border-color .12s, color .12s; }
.ch-icon-btn:hover { border-color: #bfdbfe; color: var(--rc-primary); }
.ch-icon-btn:disabled { opacity: .45; cursor: not-allowed; }
.ch-flow-searchbox { display: flex; align-items: center; gap: 6px; box-sizing: border-box; height: 30px; padding: 0 8px; border: 1px solid #dbe3ee; border-radius: 7px; background: #f8fafc; color: var(--rc-faint); transition: border-color .15s, box-shadow .15s, background .15s; }
.ch-flow-searchbox:focus-within { border-color: #60a5fa; background: #fff; box-shadow: 0 0 0 3px #dbeafe; }
.ch-flow-search-icon, .ch-flow-chevron { flex: none; font-size: 13px; }
.ch-flow-search { min-width: 0; flex: 1; height: 28px; padding: 0; border: 0; background: transparent; color: var(--rc-text); font-size: 12px; outline: none; text-overflow: ellipsis; }
.ch-flow-search::placeholder { color: var(--rc-muted); opacity: 1; }
.ch-flow-chevron { transition: transform .15s; }
.ch-flow-searchbox.open .ch-flow-chevron { transform: rotate(180deg); }
.ch-flow-options { position: absolute; z-index: 12; top: 34px; right: 0; width: 300px; overflow: hidden; border: 1px solid #dbe3ee; border-radius: 8px; background: #fff; box-shadow: 0 14px 32px -12px rgba(15, 23, 42, 0.28); }
.ch-flow-option { display: flex; align-items: center; gap: 8px; width: 100%; height: 34px; padding: 0 10px; border: 0; border-bottom: 1px solid var(--rc-border-soft); background: #fff; color: var(--rc-text-2); font-size: 12px; text-align: left; cursor: pointer; }
.ch-flow-option:hover, .ch-flow-option.active { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.ch-flow-option-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.ch-flow-option-version { flex: none; color: var(--rc-faint); font-family: var(--rc-mono, monospace); font-size: 10px; }
.ch-flow-empty, .ch-flow-limit { padding: 9px 10px; color: var(--rc-faint); font-size: 11px; text-align: center; }
.ch-flow-limit { border-bottom: 1px solid var(--rc-border-soft); }
.ch-flow-manage { width: 100%; height: 32px; padding: 0 10px; border: 0; background: #fff; color: var(--rc-primary); font-size: 12px; text-align: left; cursor: pointer; }
.ch-flow-manage:hover { background: var(--rc-primary-bg); }
.ch-branch-note { order: 20; display: flex; align-items: center; gap: 6px; width: 100%; margin-top: 6px; padding: 6px 9px; border: 1px solid #fde68a; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: 11.5px; }
.ch-save-status { color: var(--rc-faint); font-size: 12px; min-height: 18px; min-width: 4em; }
.ch-save-pending { color: var(--rc-warn); }
.ch-save-retry { border: 0; background: transparent; color: #b91c1c; font-size: 12px; cursor: pointer; padding: 0; }
.ch-save-retry:hover { text-decoration: underline; }
.rc-btn.ghost { height: 28px; padding: 0 10px; font-size: 12px; border-color: var(--rc-border); background: transparent; color: var(--rc-text-2); }
.rc-btn.ghost:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-btn.danger { border-color: #fecaca; color: #b91c1c; background: #fff; }
.rc-btn.danger:hover { border-color: #f87171; background: #fef2f2; }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
</style>
