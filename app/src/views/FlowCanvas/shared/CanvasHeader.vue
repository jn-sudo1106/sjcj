<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useFlowStore } from '@/stores/flow'
import { useUiStore } from '@/stores/ui'
import { flowCenterApi, workflowBindingApi, type WorkflowBinding } from '@/api'
import { normalizeSourceView, sourceViewFromHash, type SourceWorkspaceView } from '@/utils/url/workspaceRoute'
import { toExternalHref } from '@/utils/url/externalUrl'
import { useFlowAutosave } from '@/views/FlowCanvas/canvas/useFlowAutosave'
import { flushNodeConfigs } from '../inspector/nodeConfigAutosave'
import CodeConfigButton from '../result/CodeConfigButton.vue'
import { codeTargetForNode } from '@/utils/flow/codeConfigTargets'
import { canvasFlowIdOf, useFlowVersionStore } from '@/stores/flowVersion'

const flow = useFlowStore()
const ui = useUiStore()
const flowVersion = useFlowVersionStore()
function captureCodeTargets() {
  const flowId = canvasFlowIdOf(flow)
  const ver = flowVersion.flowId === flowId ? flowVersion.viewVersionId : null
  return [codeTargetForNode(src.value?.sourceId || '', flowId, flow.selectedId || undefined, ver)]
}
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

/**
 * 数据 / 文件 / 任务三页的流程切换器（2026-10-19，方案 1019-源视图多流程切换）。
 *
 * 一个源可以关联多条流程，这三页取的节点和表都来自「当前已加载的流程」，原来只能回流程页的标签栏切。
 * 当前流程的唯一来源仍是 URL 的 workflowId / flowId（index.vue 的 loadSourceFlow 解析），这里只改 query。
 * 流程页有自己的标签栏、概览暂不改，所以只在这三页出现；只有一条流程时不显示。
 * 放在标题下「当前流程：…」那一行里替换流程名（用户 10-19：放页签右侧太突兀）。
 * flowId 的取法与 loadSourceFlow 的默认、SourceWorkflowTabs.openFlow 一致：草稿 → 发布版 → workflowId。
 */
const FLOW_PICKER_VIEWS: SourceWorkspaceView[] = ['data', 'file', 'task']
const flowBindings = ref<WorkflowBinding[]>([])
const showFlowPicker = computed(() => !!src.value && FLOW_PICKER_VIEWS.includes(view.value) && flowBindings.value.length > 1)
// 显示值以**实际已加载的流程**为准（src.flowId），不认 URL：切换后加载失败时 URL 已经改了、数据还是原来那条，
// 按 URL 显示就会和下面的数据对不上（10-19 用户截图：下拉显示 707423，当前流程和数据都是 707424）。
const activeWorkflowId = computed(() => {
  const fid = String(src.value?.flowId ?? '')
  return flowBindings.value.find((row) => [row.workflowId, row.draftFlowId, row.publishedFlowId].includes(fid))?.workflowId
    ?? String(src.value?.activeWorkflowId ?? '')
})
function flowOptionLabel(row: WorkflowBinding): string {
  const role = row.inherited && !row.own ? '来源组' : row.primary ? '主' : '辅助'
  return `${row.workflowName || '未命名流程'} #${row.workflowId}（${role}）`
}
/** 选择后先把下拉弹回实际流程（重建 select），加载成功后整个视图按 flowId 重挂、自然显示新流程；失败也不会显示错 */
const pickerRev = ref(0)
let bindingReq = 0
watch(() => [src.value?.sourceId, FLOW_PICKER_VIEWS.includes(view.value)] as const, async ([sourceId, needed]) => {
  const id = ++bindingReq
  if (!sourceId || !needed) {
    flowBindings.value = []
    return
  }
  try {
    const rows = await workflowBindingApi.list(sourceId)
    if (id === bindingReq) flowBindings.value = rows
  } catch {
    // 拉不到就不显示切换器，当前流程照旧（标题行「当前流程」仍在）
    if (id === bindingReq) flowBindings.value = []
  }
}, { immediate: true })
const switchingFlow = ref(false)
async function onPickFlow(workflowId: string) {
  const row = flowBindings.value.find((item) => item.workflowId === workflowId)
  if (!row || workflowId === activeWorkflowId.value || switchingFlow.value) return
  switchingFlow.value = true
  try {
    // 流程页留下的改动先落库，再换流程（换流程会重载画布数据）；节点配置也先自动存一次（1021-06）
    await flushNodeConfigs()
    if (flow.flowDirty || saveStatus.value === 'saving') await retryFlowSave()
    await router.replace({
      path: '/canvas',
      query: { ...route.query, workflowId, flowId: row.draftFlowId ?? row.publishedFlowId ?? row.workflowId },
    })
  } finally {
    switchingFlow.value = false
    pickerRev.value += 1
  }
}

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
watch(() => src.value?.flowId, async (fid) => {
  owningFlowName.value = ''
  owningFlowMissing.value = false
  if (!fid) return
  const want = String(fid)
  try {
    const rec = await flowCenterApi.detail(want)
    if (String(src.value?.flowId ?? '') !== want) return
    owningFlowName.value = rec?.name ?? ''
    owningFlowMissing.value = rec === null
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
        <!-- 0828 W9-2/D06：步骤接口已通，拓扑/进入条件防抖自动保存；不再放手动保存按钮。
             2026-10-10：从标题行下单独那一行（ch-actions，没状态时也占约 38px 高的空行）挪到这里，
             用户反馈「流程页面太小」。 -->
        <span v-if="flowMode === 'canvas'" class="ch-save-status" data-testid="flow-save-status">
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
        <button class="rc-btn primary" type="button" :disabled="!canStartPublishedFlow" :title="!isPrimaryFlow ? '辅助/补数据流程不能从正常抓取入口启动' : src?.workflowVersionStatus === 'DRAFT' ? '草稿发布后才能作为新的运行版本发起抓取' : ''" @click="srcSnatch">发起抓取</button>
        <CodeConfigButton data-testid="source-capture-code" :build-targets="captureCodeTargets" :node-configs="flow.configs" label="代码生成" />
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
          <template v-if="src.flowId && showFlowPicker">
            <span class="ch-sub-sep">·</span>
            <label class="ch-flow-picker" data-testid="view-flow-picker">
              当前流程：
              <select
                :key="pickerRev"
                class="ch-flow-picker-select"
                aria-label="切换流程"
                :value="activeWorkflowId"
                :disabled="switchingFlow"
                @change="onPickFlow(($event.target as HTMLSelectElement).value)"
              >
                <option v-for="row in flowBindings" :key="row.workflowId" :value="row.workflowId">{{ flowOptionLabel(row) }}</option>
              </select>
            </label>
            <span v-if="!isPrimaryFlow" class="ch-aux-flow">辅助流程，主流程 #{{ src.primaryFlowId }}</span>
            <!-- 任务列表后端不支持按流程筛（2026-10-19 在 217 实测），流程只影响节点筛选下拉 -->
            <span v-if="view === 'task'" class="ch-flow-picker-note" data-testid="view-flow-picker-task-note">任务列表含全部流程的任务，流程只影响节点筛选</span>
          </template>
          <template v-else-if="src.flowId">
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
      <!-- 「停用」0828 D24 移除：源启停统一在源视图的行操作里做，画布头只留运行入口。
           这里不做成禁用或隐藏——按钮整个删掉，避免同一能力两个入口。 -->
      <!-- 分支流程的提示（0903 YB-A/YB-3，YB-B 后改文案；0928 再改）：画布已经能还原分支结构，
           但自动保存对分支流程冻结已有步骤的 lastStep 回写（见 useStepWrite）——主链节点拖了
           画布会变、刷新就回去；分支里的节点本来就拖不动。新增节点（lastStep 按画布算）、
           改名、进入条件、配置照常保存，这里一并说清，免得用户以为分支流程整个是只读的。
           1008-BR-05：节点两侧「+」新建分支、连线上「+」插入（下游改挂到新节点）都会保存，文案随之改。 -->
      <div v-if="view === 'flow' && flowMode === 'canvas' && flow.hasBranchedSteps" class="ch-branch-note" data-testid="flow-branch-flattened">
        <span aria-hidden="true">⚠</span>
        该流程含分支：拖动节点不会保存。可以用节点两侧的「+」新建分支，或用连线上的「+」插入节点；节点名称、进入条件、配置照常保存。
      </div>
    </template>
  </div>
</template>

<style scoped>
.rc-canvas-head { position: relative; z-index: 20; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; flex-wrap: wrap; }
.ch-switcher { display: inline-flex; padding: 2px; background: #f1f5f9; border: 1px solid var(--rc-border); border-radius: 7px; }
.ch-flow-mode-row { order: 10; flex: 0 0 100%; display: flex; align-items: center; padding-top: 8px; border-top: 1px solid var(--rc-border-soft); }
.ch-flow-mode { margin-left: 0; }
.ch-flow-mode-actions { display: flex; align-items: center; gap: 10px; margin-left: auto; }
.ch-flow-mode-actions .rc-btn { height: 30px; padding: 0 11px; font-size: 12px; }
.ch-seg { height: 26px; padding: 0 12px; border: 0; background: transparent; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; border-radius: 5px; }
.ch-seg.on { background: var(--rc-primary); color: #fff; }
.ch-seg:hover:not(.on) { color: var(--rc-primary-ink); }
.ch-seg:disabled { color: var(--rc-faint); cursor: not-allowed; }
.ch-flow-picker { flex: none; display: inline-flex; align-items: center; white-space: nowrap; color: var(--rc-primary); }
.ch-flow-picker-select { height: 22px; max-width: 280px; padding: 0 4px; border: 1px solid var(--rc-border-soft); border-radius: 5px; background: #fff; color: var(--rc-primary); font-size: inherit; cursor: pointer; }
.ch-flow-picker-select:disabled { color: var(--rc-faint); cursor: progress; }
.ch-flow-picker-note { margin-left: 6px; color: var(--rc-faint); white-space: nowrap; }
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
