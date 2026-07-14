<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFlowStore } from '../../stores/flow'
import { useUiStore } from '../../stores/ui'
import { useWorkspaceStore } from '../../stores/workspace'
import { flowApi, sourceApi, siteApi, type Source, type Site } from '../../api'
import { useRuntimeStore } from '../../stores/runtime'
import FlowBoard from './FlowBoard.vue'
import NodeInspector from './NodeInspector.vue'
import ResultView from './ResultView.vue'
import SourceTabsBar from './SourceTabsBar.vue'
import CompareSplit from './CompareSplit.vue'
import TaskView from './TaskView.vue'
import FileView from './FileView.vue'
import SiteSourceSwitcher from './SiteSourceSwitcher.vue'
import CategoryTreePicker, { type CategorySelection } from './CategoryTreePicker.vue'
import { firstSourceId, normalizeSourceView, sourceViewFromHash } from './workspaceRoute'

const route = useRoute()
const router = useRouter()
const flow = useFlowStore()
const ui = useUiStore()
const ws = useWorkspaceStore()
const runtime = useRuntimeStore()
// 三种结果视图均以当前子源为粒度。
const activeView = ref(normalizeSourceView(route.query.view))
function syncActiveView() {
  activeView.value = sourceViewFromHash(window.location.hash)
}
watch(() => route.query.view, () => {
  activeView.value = normalizeSourceView(route.query.view)
}, { immediate: true })
const isDataView = computed(() => activeView.value === 'data' && !!flow.sourceCtx)
const isTaskView = computed(() => activeView.value === 'task' && !!flow.sourceCtx)
// 文件视图只挂子源层（0711 R11：文件视图只有源才有）：网站态 URL 带 view=file 同理重定向回流程视图
const isFileView = computed(() => activeView.value === 'file' && !!flow.sourceCtx)


// 视图快照按子源页签保存，避免切换子源后丢失当前视图。
watch(
  () => [route.query.sourceId, route.query.view, flow.sourceCtx?.sourceId] as const,
  ([qSrc, v, ctxSrc]) => {
    if (!qSrc || ctxSrc !== String(qSrc)) return
    ws.saveSnapshot(ctxSrc, { view: v === 'data' ? 'data' : v === 'task' ? 'task' : v === 'file' ? 'file' : 'flow' })
  },
  { immediate: true },
)

// ---- 子源侧栏（0710 会议 B1）：页面级左列，流程/数据/任务视图共用；接线自 FlowBoard 顶部横排切换器迁入 ----
const sidebarSiteId = computed(() => flow.sourceCtx?.siteId || '')
const sidebarActiveKey = computed(() => flow.sourceCtx?.sourceId ?? '')
async function confirmDiscardIfDirty(): Promise<boolean> {
  if (!flow.dirty) return true
  try {
    await ElMessageBox.confirm('当前画布有未保存的改动，切换将丢弃，是否继续？', '切换编排对象', {
      type: 'warning', confirmButtonText: '切换', cancelButtonText: '取消',
    })
    return true
  } catch {
    return false
  }
}
// 切换只改路由，加载统一走 route watcher → enterFromRoute；视图随身携带（切子源不切视图，0710 会议第 7/10 条）
async function onSwitchTarget(target: Source) {
  if (!(await confirmDiscardIfDirty())) return
  const view = normalizeSourceView(route.query.view)
  void router.replace({ path: '/canvas', query: { sourceId: target.sourceId, view } })
}
function onSwitchAdded(s: Source) {
  onSwitchTarget(s)
}
// 侧栏 ⇔（0710 会议 B4）：左栏=当前子源，右栏=所选子源（任意网站，按 id 直接加载）
function onSidebarCompare(rightId: string) {
  const left = flow.sourceCtx?.sourceId
  if (!left) {
    ElMessage.warning('请先切到具体子源再对比')
    return
  }
  if (!ws.enterCompare(rightId, left)) ElMessage.warning('无法对比：请选择另一个子源')
}

// ---- 新建采集闸门：先填网站基础信息和首批子源，创建后默认进入首个子源的流程视图。
const isGate = computed(() => route.query.mode === 'new')
function suggestId(prefix: string): string {
  return `${prefix}${Math.floor(100000 + Math.random() * 900000)}`
}
function blankSiteDraft(): Site {
  return {
    siteId: suggestId('site-'),
    name: '',
    category: '',
    categoryPath: '',
    owner: 'admin',
    sourceCount: 0,
    errorCount: 0,
    tags: [],
  }
}
interface GateChildRow { sourceId: string; name: string; url: string }
function blankRow(): GateChildRow {
  return { sourceId: suggestId('src-'), name: '', url: '' }
}
const gateSite = ref(blankSiteDraft())
const gateRows = ref<GateChildRow[]>([blankRow()])
// 分类目录树（0711 R1）：CategoryTreePicker 单独维护 dirId/category/categoryPath 三个字段，桥接到 gateSite
const gateCategory = computed<CategorySelection>({
  get: () => ({ dirId: gateSite.value.dirId, category: gateSite.value.category, categoryPath: gateSite.value.categoryPath ?? '' }),
  set: (v) => {
    gateSite.value.dirId = v.dirId
    gateSite.value.category = v.category
    gateSite.value.categoryPath = v.categoryPath
  },
})
// 首个子源名称在未手工修改前跟随网站名称。
const firstSourceNameTouched = ref(false)
watch(
  () => gateSite.value.name,
  (name) => {
    if (!firstSourceNameTouched.value && gateRows.value[0]) gateRows.value[0].name = name
  },
)
function addGateRow() {
  gateRows.value.push(blankRow())
}
function removeGateRow(i: number) {
  if (gateRows.value.length > 1) gateRows.value.splice(i, 1)
}
function onCancelGate() {
  router.push('/collect')
}
async function onCreateAndEnter() {
  const site = gateSite.value
  if (!site.name || !site.category) {
    ElMessage.warning('请完整填写网站名称 / 分类')
    return
  }
  const rows = gateRows.value.filter((r) => r.name.trim())
  if (!rows.length) {
    ElMessage.warning('请至少填写一个子源名称')
    return
  }
  // 子源默认设置（代理/断点续爬/选用配置/登录/定时等）已随闸门收口整块移除，创建后在画布"子源信息"里配
  const sources: Source[] = rows.map((r) => ({
    sourceId: r.sourceId, name: r.name, url: r.url, configId: '', mainTable: '', owner: site.owner || 'admin', state: 'C',
  }))
  const siteForCreate: Site = { ...site, sourceCount: sources.length, errorCount: sources.filter((s) => s.state === 'E').length }
  const res = await siteApi.siteCreate(siteForCreate, sources)
  if (!res?.ok) {
    ElMessage.warning(res?.message || '创建失败，请重试')
    return
  }
  const sourceId = firstSourceId(sources)
  await router.replace({ path: '/canvas', query: { sourceId, view: 'flow' } })
  registerCanvasActions()
  ElMessage.success(`网站「${siteForCreate.name}」已创建（${sources.length} 个子源），已进入首个子源的流程视图`)
}
// ---- 配置区宽度（优化 0701 问题一）：拖拽分隔条调宽 + 一键展开 ----
const inspWidth = computed(() => `${ui.inspectorWidth ?? (flow.sourceCtx ? 480 : 372)}px`)
let splitStartX = 0
let splitStartW = 0
function onSplitMove(e: MouseEvent) {
  // 分隔条在配置区左侧：向左拖增宽；下限随模式（普通 372 / 源详情 480），与 inspWidth/onSplitStart 三元一致；
  // 上限固定值由 ui.setInspectorWidth 统一夹住（不再跟当前窗口宽度挂钩），拖到头后要更大空间用「展开」
  const minW = flow.sourceCtx ? 480 : 372
  const next = Math.max(minW, splitStartW - (e.clientX - splitStartX))
  ui.setInspectorWidth(next)
}
function onSplitEnd() {
  window.removeEventListener('mousemove', onSplitMove)
  window.removeEventListener('mouseup', onSplitEnd)
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
}
function onSplitStart(e: MouseEvent) {
  e.preventDefault()
  splitStartX = e.clientX
  splitStartW = ui.inspectorWidth ?? (flow.sourceCtx ? 480 : 372)
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  window.addEventListener('mousemove', onSplitMove)
  window.addEventListener('mouseup', onSplitEnd)
}

async function loadSourceFlow(sourceId: string) {
  // 已保存的子源流程优先于按步骤拼出的默认骨架。
  const [source, steps, persistedDef] = await Promise.all([
    sourceApi.sourceDetail(sourceId),
    sourceApi.sourceSteps(sourceId),
    flowApi.flowLoad(sourceId),
  ])
  if (!source) {
    ElMessage.error('源不存在')
    return
  }
  flow.loadFromSource(source, steps ?? [], persistedDef)
  ws.open(source.sourceId, source.name)
}

async function onSave() {
  try {
    const res = await flowApi.flowSave(flow.serialize())
    if (!res?.ok) {
      ElMessage.error(res?.message || '保存失败')
      return
    }
    flow.markSaved()
    ElMessage.success(res?.message || '流程已保存')
  } catch (e) {
    ElMessage.error(`保存失败：${(e as Error).message ?? '未知错误'}，画布未清空，请重试`)
  }
}
function onTrial() {
  // 试跑门槛（0710 会议 D3）：流程配置保存完成后才可试跑，有未保存改动先保存
  if (flow.dirty) {
    ElMessage.warning('画布有未保存的改动，请先保存流程配置再试跑')
    return
  }
  if (runtime.running) {
    ElMessage.warning('已有试跑正在进行，请稍候')
    return
  }
  const runId = runtime.trial(flow.serialize())
  if (!runId) {
    ElMessage.warning('当前画布没有可试跑的节点（已停止 / 规划中 / 缺 URL 或输出表的采集节点会被跳过）')
    return
  }
  ElMessage.success(`已发起试跑 ${runId}，画布节点状态流转中 → 运行记录 / 数据查看`)
}

// "发布"概念全删（0710 会议 C3）：默认草稿语义，保存即生效
function registerCanvasActions() {
  ui.registerAction('保存', onSave)
  ui.registerAction('试跑', onTrial)
}

async function enterFromRoute() {
  const siteId = String(route.query.siteId ?? '')
  const sourceId = String(route.query.sourceId ?? '')
  if (siteId) {
    const first = firstSourceId(await siteApi.siteSources(siteId))
    if (first) await router.replace({ path: '/canvas', query: { sourceId: first, view: 'flow' } })
    else ElMessage.warning('该网站暂无子源，请先添加子源')
  } else if (sourceId) {
    const view = normalizeSourceView(route.query.view)
    if (route.query.view !== view) await router.replace({ path: '/canvas', query: { sourceId, view } })
    else await loadSourceFlow(sourceId)
  } else {
    // 裸 /canvas 已由路由守卫导回采集资产；这里仅保留内部兜底
    flow.newFlow('blank')
  }
}
onMounted(async () => {
  window.addEventListener('hashchange', syncActiveView)
  if (isGate.value) {
    gateSite.value = blankSiteDraft()
    gateRows.value = [blankRow()]
    firstSourceNameTouched.value = false
    registerCanvasActions()
    return
  }
  await enterFromRoute()
  registerCanvasActions()
})
// sourceId / siteId 互斥，合一个 watcher 统一处理深链与子源切换。
watch(
  () => [route.query.sourceId, route.query.siteId] as const,
  async ([sid, stid], prev) => {
    if (isGate.value) return
    if (prev && sid === prev[0] && stid === prev[1]) return
    await enterFromRoute()
  },
)
// 同一路由内进入 mode=new 时回到基础信息闸门
watch(isGate, (v) => {
  if (v) {
    gateSite.value = blankSiteDraft()
    gateRows.value = [blankRow()]
    firstSourceNameTouched.value = false
    registerCanvasActions()
  }
})
onUnmounted(() => {
  window.removeEventListener('hashchange', syncActiveView)
  onSplitEnd()
  ui.inspectorExpanded = false
  ui.clearActions()
  flow.clearSourceCtx()
})
</script>

<template>
  <div v-if="isGate" class="rc-gate">
    <div class="rc-gate-card">
      <div class="rc-gate-title">新建采集 · 网站基础信息</div>
      <div class="rc-gate-hint">网站用于归属与管理；子源（语言 / 变体）才是真正的采集实体，创建后可在画布内继续增删调整。</div>
      <div class="rc-field"><label>网站名称</label><input class="rc-input" v-model="gateSite.name" placeholder="必填" /></div>
      <div class="rc-field"><label>分类</label>
        <CategoryTreePicker v-model="gateCategory" />
      </div>

      <div class="rc-gate-rows-title">子源清单（至少一个，语言 / 变体，创建后可继续增删）</div>
      <div v-for="(row, i) in gateRows" :key="row.sourceId" class="rc-gate-row">
        <input
          class="rc-input"
          v-model="row.name"
          placeholder="子源名称，必填"
          @input="i === 0 && (firstSourceNameTouched = true)"
        />
        <input class="rc-input" v-model="row.url" placeholder="子源 URL，选填" />
        <button class="rc-btn" type="button" :disabled="gateRows.length <= 1" @click="removeGateRow(i)">移除</button>
      </div>
      <button class="rc-btn" type="button" @click="addGateRow">＋ 添加子源</button>

      <div class="rc-gate-actions">
        <button class="rc-btn" type="button" @click="onCancelGate">取消</button>
        <button class="rc-btn primary" type="button" @click="onCreateAndEnter">创建并进入编排</button>
      </div>
    </div>
  </div>

  <template v-else>
    <SourceTabsBar v-if="flow.sourceCtx" />
    <!-- 两列布局（0710 会议 B1）：左列子源侧栏（页面级，在视图层之上），右列内容区随流程/数据/任务视图切换 -->
    <div class="rc-canvas-cols" :class="{ 'with-tabs': !!flow.sourceCtx }">
      <SiteSourceSwitcher
        v-if="sidebarSiteId"
        :site-id="sidebarSiteId"
        :active-key="sidebarActiveKey"
        @pick="onSwitchTarget"
        @added="onSwitchAdded"
        @compare="onSidebarCompare"
      />
      <div class="rc-canvas-main">
        <!-- key 用加载完成后的 ctx，避免切换时读到旧子源数据。 -->
        <CompareSplit v-if="ws.compareSourceId" class="rc-flow-result" />
        <ResultView v-else-if="isDataView" :key="flow.sourceCtx?.sourceId" class="rc-flow-result" />
        <TaskView v-else-if="isTaskView" :key="flow.sourceCtx?.sourceId" class="rc-flow-result" />
        <FileView v-else-if="isFileView" :key="flow.sourceCtx?.sourceId" class="rc-flow-result" />
        <div
          v-else
          class="rc-flow-shell"
          :class="{ 'source-mode': !!flow.sourceCtx, expanded: ui.inspectorExpanded }"
          :style="{ '--insp-w': inspWidth }"
        >
          <FlowBoard />
          <div
            v-if="!ui.inspectorExpanded"
            class="rc-insp-splitter"
            title="拖动调整配置区宽度"
            @mousedown="onSplitStart"
          />
          <div v-else class="rc-insp-splitter placeholder" />
          <NodeInspector />
        </div>
      </div>
    </div>
  </template>
</template>

<style scoped>
/* 两列骨架（0710 会议 B1）：高度收敛到 wrapper，一处管理页签条占位；子列全部 100% 撑满 */
.rc-canvas-cols { display: flex; gap: 8px; align-items: stretch; height: calc(100vh - 168px); min-height: 600px; }
.rc-canvas-cols.with-tabs { height: calc(100vh - 204px); min-height: 564px; }
.rc-canvas-main { flex: 1; min-width: 0; min-height: 0; }
.rc-canvas-main > * { height: 100%; }

.rc-flow-shell {
  display: grid;
  grid-template-columns: minmax(560px, 1fr) 6px var(--insp-w, 372px);
  gap: 8px;
  align-items: stretch;
}
.rc-flow-shell.source-mode { grid-template-columns: minmax(480px, 1fr) 6px var(--insp-w, 480px); }
/* 展开态：配置区约 2/3 视口宽，画布压缩为缩略列 */
.rc-flow-shell.expanded { grid-template-columns: minmax(0, 1fr) 6px minmax(0, 60vw); }

.rc-insp-splitter { cursor: col-resize; position: relative; border-radius: 3px; }
.rc-insp-splitter::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 0;
  bottom: 0;
  width: 2px;
  border-radius: 1px;
  background: var(--rc-border);
}
.rc-insp-splitter:hover::before, .rc-insp-splitter:active::before { background: var(--rc-primary); }
.rc-insp-splitter.placeholder { cursor: default; pointer-events: none; }
.rc-insp-splitter.placeholder::before { background: transparent; }

/* 新建源闸门：先填写基础信息，过闸后再进入画布 */
.rc-gate { display: flex; justify-content: center; padding: 24px 16px 40px; }
.rc-gate-card { width: min(640px, 100%); background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); padding: 20px 22px; }
.rc-gate-title { font-size: 15px; font-weight: 800; color: var(--rc-text); margin-bottom: 6px; }
.rc-gate-hint { font-size: 11px; color: var(--rc-muted); line-height: 1.6; margin-bottom: 14px; }
.rc-gate-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--rc-border-soft); }
.rc-gate-rows-title { font-size: 11px; font-weight: 700; color: var(--rc-muted); margin: 14px 0 8px; }
.rc-gate-row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; margin-bottom: 8px; align-items: center; }
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 10px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input, .rc-select { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; }
.rc-input:focus, .rc-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }

@media (max-width: 1240px) {
  .rc-canvas-cols, .rc-canvas-cols.with-tabs { height: auto; min-height: 0; }
  .rc-flow-shell,
  .rc-flow-shell.source-mode,
  .rc-flow-shell.expanded { grid-template-columns: minmax(0, 1fr); height: auto; }
  .rc-insp-splitter { display: none; }
  .rc-flow-shell > :last-child { grid-column: 1 / -1; min-height: 520px; }
}
</style>
