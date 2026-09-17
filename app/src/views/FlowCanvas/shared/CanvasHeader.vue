<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, Search } from '@element-plus/icons-vue'
import { useFlowStore } from '@/stores/flow'
import { useUiStore } from '@/stores/ui'
import { flowCenterApi, type FlowRecord } from '@/api'
import { normalizeSourceView, sourceViewFromHash, type SourceWorkspaceView } from '@/utils/url/workspaceRoute'
import { useFlowAutosave } from '@/views/FlowCanvas/canvas/useFlowAutosave'

const flow = useFlowStore()
const ui = useUiStore()
const { status: saveStatus, savedClock, lastError: saveError, flush: retryFlowSave } = useFlowAutosave()
const route = useRoute()
const router = useRouter()

const src = computed(() => flow.sourceCtx)
const view = ref<SourceWorkspaceView>(normalizeSourceView(route.query.view))
function syncView() {
  view.value = sourceViewFromHash(window.location.hash)
}
watch(() => route.query.view, (next) => {
  view.value = normalizeSourceView(next)
}, { immediate: true })
onMounted(() => window.addEventListener('hashchange', syncView))
onBeforeUnmount(() => window.removeEventListener('hashchange', syncView))

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
onMounted(() => { void loadTemplates() })

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
  if (!templateId) return '切换流程模板'
  const template = templates.value.find((item) => item.id === templateId)
  if (!template) return '切换流程模板'
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
const metaLine = computed(() => {
  const s = src.value
  if (!s) return ''
  const primary = s.kind === 'param' ? `参数源 · ${s.urlTemplate || s.baseUrl || ''} · ${s.paramRefs?.length ?? 0} 个参数占位符` : s.url
  return [primary, s.lastSuccessAt ? `上次成功 ${s.lastSuccessAt}` : ''].filter(Boolean).join(' · ')
})

// 所属流程：源上带 flowId（sourceDetail 已补，0903 §H8），流程名要单查一次 flow/detail；
// 查不到就退化成 `#<id>`。切源时按 flowId 变化重查，回来慢了也不会写串。
const owningFlowName = ref('')
watch(() => src.value?.flowId, async (fid) => {
  owningFlowName.value = ''
  if (!fid) return
  const want = String(fid)
  try {
    const rec = await flowCenterApi.detail(want)
    if (String(src.value?.flowId ?? '') === want) owningFlowName.value = rec?.name ?? ''
  } catch { /* 保留 ID 展示 */ }
}, { immediate: true })
const owningFlowLabel = computed(() => {
  const fid = src.value?.flowId
  return fid ? (owningFlowName.value || `#${fid}`) : ''
})
function openOwningFlow() {
  const fid = src.value?.flowId
  if (!fid) return
  router.push({ path: '/flows', query: { q: owningFlowName.value || String(fid) } })
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
// 产品口径是这五个视图平级——点任意节点都能停在监控视图上（非同类型节点时面板内给提示，见 MonitorConfigView）。
function switchView(target: SourceWorkspaceView) {
  if (view.value === target) {
    if (target === 'data') ui.applyViewLayoutDefault('data')
    return
  }
  const query = { ...route.query }
  if (target === 'flow') delete query.view
  else query.view = target
  void router.replace({ path: '/canvas', query })
}

// 发起抓取（0714 会议 Task 4）：唯一的完整执行入口——本组件只派发动作，
// 校验/请求/驱动运行态统一收在 index.vue（走 ui 动作总线，避免在 FlowBoard/ResultView/TaskView/FileView
// 四处宿主组件里各自转发一遍事件）。
function srcSnatch() {
  ui.fireAction('发起抓取')
}

async function onSwitchFlow(command: string) {
  if (!command) return
  if (command === '__manage_flows__') {
    void router.push('/flows')
    return
  }
  const template = templates.value.find((item) => item.id === command)
  if (!template || !src.value) return
  // 确认弹窗**恒弹**（0903 Y0-3）：原来只在 flow.dirty 时弹，等于"画布干净时静默替换全部节点"——
  // 这个动作会为本源新建一整套配置，任何情况下都该让人先看一眼再点。
  const nodeCount = flow.main.filter((id: string) => flow.configs[id]).length
  try {
    await ElMessageBox.confirm(
      [
        `将复制模板「${template.name}」的配置，生成属于本源的一套新配置。`,
        nodeCount ? `当前 ${nodeCount} 个节点会被替换。` : '',
        flow.dirty ? '当前画布有未保存改动，将一并丢弃。' : '',
        '此操作不影响该模板和其它源。',
      ].filter(Boolean).join(''),
      '切换流程模板',
      { type: 'warning', confirmButtonText: '复制并替换', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  const result = flow.applyTemplate(template)
  if (!result) return
  // 真实 cs_flow 没有版本号（见 FlowRecord.version 注释），拿不到就只说流程名，不要 `vundefined`
  const versionText = template.version == null ? '' : ` v${template.version}`
  ElMessage.success(`已复制模板「${template.name}」${versionText}${result.cleared ? `，原 ${result.cleared} 个节点已替换` : ''}`)
}

</script>

<template>
  <div v-if="src" class="rc-canvas-head">
    <button class="rc-btn ghost" type="button" @click="backToSourceView">← 返回源视图</button>
    <div class="ch-switcher">
      <button class="ch-seg" :class="{ on: view === 'flow' }" type="button" @click="switchView('flow')">流程视图</button>
      <button class="ch-seg" :class="{ on: view === 'data' }" type="button" @click="switchView('data')">数据视图</button>
      <!-- ⚠️ 「文件视图 / 任务视图」**保留**。2026-09-05 一度按 0904 I11 把这两档删掉，是**读反了**：
           产品原话「文件和任务我觉得暂时吧，因为数据视图里面是包着文件的」——"暂时吧"是
           **暂时留着**，不是暂时去掉（当时开发问的是"这块不要了"，产品没有顺着答"对"）。
           删掉后用户当场提出「不是，任务视图和文件视图呢」，已还原。0904 纪要 I11 同步订正。 -->
      <button class="ch-seg" :class="{ on: view === 'file' }" type="button" @click="switchView('file')">文件视图</button>
      <button class="ch-seg" :class="{ on: view === 'task' }" type="button" @click="switchView('task')">任务视图</button>
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
      >监控视图</button>
    </div>

    <template v-if="src">
      <div class="ch-titlewrap">
        <div class="ch-title">
          {{ src.name }}
          <span class="rc-status" :class="statusMeta.cls">{{ statusMeta.text }}</span>
          <span v-if="src.externalChanged" class="rc-status warn">外部变更待确认</span>
        </div>
        <div class="ch-sub">
          <span>{{ metaLine }}</span>
          <template v-if="src.flowId">
            <span class="ch-sub-sep">·</span>
            <button
              class="ch-flow-link"
              type="button"
              data-testid="owning-flow"
              title="在流程中心查看这个流程"
              @click="openOwningFlow"
            >所属流程：{{ owningFlowLabel }}</button>
          </template>
        </div>
      </div>
      <div v-if="view === 'flow'" class="ch-actions">
        <div class="ch-flow-picker">
          <div class="ch-flow-searchbox" :class="{ open: flowPickerOpen }">
            <el-icon class="ch-flow-search-icon"><Search /></el-icon>
            <input
              v-model="flowKeyword"
              class="ch-flow-search"
              data-testid="flow-switch-search"
              :placeholder="appliedTemplateLabel"
              :title="appliedTemplateLabel"
              aria-label="搜索并切换流程模板"
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
        <!-- 0828 W9-2/D06：步骤接口已通，拓扑/进入条件防抖自动保存；不再放手动保存按钮。 -->
        <span class="ch-save-status" data-testid="flow-save-status">
          <span v-if="saveStatus === 'pending'" class="ch-save-pending">请先保存节点配置</span>
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
      <!-- 分支流程的只读提示（0903 YB-A/YB-3，YB-B 后改文案）：画布已经能还原分支结构，
           但**分支的挂接关系还不支持在画布上调整**——自动保存对分支流程冻结 lastStep 回写
           （见 useStepWrite），拖动节点不会写回。不说这句话，用户会以为拖了就生效。 -->
      <div v-if="view === 'flow' && flow.hasBranchedSteps" class="ch-branch-note" data-testid="flow-branch-flattened">
        <span aria-hidden="true">⚠</span>
        该流程含分支。分支的挂接关系暂不支持在画布上调整——拖动节点不会写回后端，节点名称与进入条件照常保存。
      </div>
      <div v-if="view === 'flow'" class="ch-canvas-actions" aria-label="源运行操作">
        <button class="rc-btn primary" type="button" @click="srcSnatch">发起抓取</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rc-canvas-head { position: relative; z-index: 20; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; flex-wrap: wrap; }
.ch-switcher { display: inline-flex; padding: 2px; background: #f1f5f9; border: 1px solid var(--rc-border); border-radius: 7px; }
.ch-seg { height: 26px; padding: 0 12px; border: 0; background: transparent; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; border-radius: 5px; }
.ch-seg.on { background: var(--rc-primary); color: #fff; }
.ch-seg:hover:not(.on) { color: var(--rc-primary-ink); }
.ch-seg:disabled { color: var(--rc-faint); cursor: not-allowed; }
.ch-titlewrap { min-width: 0; }
.ch-title { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; color: var(--rc-text); font-size: 13px; }
.ch-sub { color: var(--rc-faint); font-size: 10px; margin-top: 1px; }
.ch-sub-sep { margin: 0 4px; }
.ch-flow-link { border: 0; background: transparent; padding: 0; color: var(--rc-primary); font-size: inherit; cursor: pointer; }
.ch-flow-link:hover { text-decoration: underline; }
.ch-actions { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; justify-content: flex-end; align-items: center; }
.ch-actions .rc-btn { height: 30px; padding: 0 11px; font-size: 12px; }
.ch-flow-picker { position: relative; width: 184px; margin-right: 4px; }
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
.ch-branch-note { display: flex; align-items: center; gap: 6px; width: 100%; margin-top: 6px; padding: 6px 9px; border: 1px solid #fde68a; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: 11.5px; }
.ch-save-status { color: var(--rc-faint); font-size: 12px; min-height: 18px; min-width: 4em; }
.ch-save-pending { color: var(--rc-warn); }
.ch-save-retry { border: 0; background: transparent; color: #b91c1c; font-size: 12px; cursor: pointer; padding: 0; }
.ch-save-retry:hover { text-decoration: underline; }
.ch-canvas-actions { position: absolute; z-index: 4; right: 32px; top: calc(100% + 18px); display: flex; gap: 6px; }
.ch-canvas-actions .rc-btn { height: 30px; padding: 0 11px; font-size: 12px; }
.rc-btn.ghost { height: 28px; padding: 0 10px; font-size: 12px; border-color: var(--rc-border); background: transparent; color: var(--rc-text-2); }
.rc-btn.ghost:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-btn.danger { border-color: #fecaca; color: #b91c1c; background: #fff; }
.rc-btn.danger:hover { border-color: #f87171; background: #fef2f2; }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
</style>
