<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
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
import SyncSourcesDialog from './SyncSourcesDialog.vue'
import SourceBasicForm from './SourceBasicForm.vue'

const route = useRoute()
const router = useRouter()
const flow = useFlowStore()
const ui = useUiStore()
const ws = useWorkspaceStore()
const runtime = useRuntimeStore()
// 数据/任务视图站在网站粒度（0707 优化·Phase5），网站模板与子源两种编排对象都可达
const isDataView = computed(() => route.query.view === 'data' && !!(flow.sourceCtx || flow.siteCtx))
const isTaskView = computed(() => route.query.view === 'task' && !!(flow.sourceCtx || flow.siteCtx))

// 网站统一流程保存后的同步询问（0707 优化·Phase4·A+C 混合）：整条流程覆盖所选子源，走危险端点二次确认
const syncDlg = reactive({ visible: false, siteId: '' })

// 页签快照：记录每个源页签当前停留的视图（流程/数据/任务），激活页签时恢复
watch(
  () => [route.query.sourceId, route.query.view] as const,
  ([sid, v]) => {
    if (sid) ws.saveSnapshot(String(sid), { view: v === 'data' ? 'data' : v === 'task' ? 'task' : 'flow' })
  },
  { immediate: true },
)

// ---- 新建采集闸门（0707 优化·Phase3 → §5.7 改口径）：先填网站基础信息 + 首批子源清单，过闸进入网站统一流程画布。
// §5.7 推翻 §5.5 的"落地范围收窄（落到第一个子源）"——Phase4 的 siteCtx / 切换器 / 同步弹窗就绪后，回正到方案 B：
// - 单一权威方向（模板→子源同步），不引入子源互相复制，detached 语义干净（A+C 同步根基，详见 §5.7 理由 1）；
// - 新建瞬间所有子源空白、视角天然就是模板，不需额外"传染"步骤（理由 2）；
// - 想验证时切换器一键切子源试跑，试跑入口仍在切换器旁（理由 3）；
// - 引导文案（FlowBoard 空白卡）与同步成功提示（SyncSourcesDialog）配套改文案，详见 §5.7 落地口径。
const isGate = computed(() => route.query.mode === 'new')
const GATE_CATEGORY_OPTIONS = [
  { value: '基金类', label: '基金类', categoryPath: '/基金类' },
  { value: '股票类', label: '股票类', categoryPath: '/股票类' },
  { value: '舆情类', label: '舆情类', categoryPath: '/舆情类' },
]
function suggestId(prefix: string): string {
  return `${prefix}${Math.floor(100000 + Math.random() * 900000)}`
}
function categoryPathOf(category: string): string {
  return GATE_CATEGORY_OPTIONS.find((opt) => opt.value === category)?.categoryPath ?? `/${category}`
}
function blankSiteDraft(): Site {
  return {
    siteId: suggestId('site-'),
    name: '',
    category: GATE_CATEGORY_OPTIONS[0].value,
    categoryPath: GATE_CATEGORY_OPTIONS[0].categoryPath,
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
// 子源默认设置（0707 优化·补）：目录/标签/代理/选用配置/登录/定时等源级字段过去只能创建后逐个进编辑抽屉补，
// 批量新建场景下很重——这里复用 SourceBasicForm（隐藏源ID/名称/URL，那三项在上面 gateRows 逐行填），
// 创建时把这份默认值套给本批全部子源，每个子源生成后在编辑抽屉里仍可单独覆盖。
function blankSourceDefaults(): Source {
  return { sourceId: '', name: '', url: '', configId: '', mainTable: '', owner: 'admin', state: 'C' }
}
const gateSourceDefaults = ref<Source>(blankSourceDefaults())
const gateTagsInput = computed({
  get: () => (gateSite.value.tags ?? []).join(', '),
  set: (v: string) => { gateSite.value.tags = v.split(',').map((s) => s.trim()).filter(Boolean) },
})
const gateTemplateId = ref('')
const gateTemplates = ref<Site[]>([])
// §5.7 创建后跳转防重载：onCreateAndEnter 已 eager 载入默认骨架（避免新 URL 下短暂渲染旧 store 状态的闪烁），
// 紧跟的 router.replace 会触发 route watcher 再跑一次 enterFromRoute -> loadSiteFlow -> startSiteFlow（查无存档，
// 重新生成同一份骨架，幂等但多余两次 mock 调用）。置此 flag 在跳转前，watcher 顶置检查并清除，跳过这一次冗余重载。
let skipRouteReload = false
async function loadGateTemplates() {
  gateTemplates.value = (await siteApi.sitePaged({ size: 50 })).list
}
async function onPickSiteTemplate(e: Event) {
  const fromId = (e.target as HTMLSelectElement).value
  gateTemplateId.value = fromId
  if (!fromId) return
  const tpl = await siteApi.siteDetail(fromId)
  if (!tpl) return
  gateSite.value = { ...tpl, siteId: gateSite.value.siteId, name: `${tpl.name}（复制）` }
  const children = await siteApi.siteSources(fromId)
  if (children.length) gateRows.value = children.map((c) => ({ sourceId: suggestId('src-'), name: c.name, url: c.url }))
}
function onGateCategoryChange() {
  gateSite.value.categoryPath = categoryPathOf(gateSite.value.category)
}
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
  if (!site.siteId || !site.name || !site.category) {
    ElMessage.warning('请完整填写网站 ID / 网站名称 / 分类')
    return
  }
  const rows = gateRows.value.filter((r) => r.name.trim())
  if (!rows.length) {
    ElMessage.warning('请至少填写一个子源名称')
    return
  }
  // 子源默认设置（目录/标签/代理/选用配置/登录/定时）套给本批全部子源，各自仍可创建后单独覆盖
  const sources: Source[] = rows.map((r) => ({
    ...gateSourceDefaults.value,
    sourceId: r.sourceId, name: r.name, url: r.url, mainTable: '', owner: site.owner || 'admin', state: 'C',
  }))
  const siteForCreate: Site = { ...site, sourceCount: sources.length, errorCount: sources.filter((s) => s.state === 'E').length }
  const res = await siteApi.siteCreate(siteForCreate, sources)
  if (!res?.ok) {
    ElMessage.warning(res?.message || '创建失败，请重试')
    return
  }
  // §5.7：过闸进入网站统一流程画布（方案 B），不再落第一个子源；详见文件头注释。
  flow.startSiteFlow(siteForCreate)
  ws.open(`site:${siteForCreate.siteId}`, siteForCreate.name)
  skipRouteReload = true // eager 已载入骨架，watcher 这次跳过冗余重载（见文件上方 skipRouteReload 声明）
  await router.replace({ path: '/canvas', query: { siteId: siteForCreate.siteId } })
  registerCanvasActions()
  ElMessage.success(`网站「${siteForCreate.name}」已创建（${sources.length} 个子源），请编排全站统一流程，保存后可一键同步到全部子源`)
}
// ---- 配置区宽度（优化 0701 问题一）：拖拽分隔条调宽 + 一键展开 ----
const inspWidth = computed(() => `${ui.inspectorWidth ?? (flow.sourceCtx || flow.siteCtx ? 480 : 372)}px`)
let splitStartX = 0
let splitStartW = 0
function onSplitMove(e: MouseEvent) {
  // 分隔条在配置区左侧：向左拖增宽；下限随模式（普通 372 / 源详情 480），与 inspWidth/onSplitStart 三元一致；
  // 上限固定值由 ui.setInspectorWidth 统一夹住（不再跟当前窗口宽度挂钩），拖到头后要更大空间用「展开」
  const minW = flow.sourceCtx || flow.siteCtx ? 480 : 372
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
  splitStartW = ui.inspectorWidth ?? (flow.sourceCtx || flow.siteCtx ? 480 : 372)
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  window.addEventListener('mousemove', onSplitMove)
  window.addEventListener('mouseup', onSplitEnd)
}

async function loadSourceFlow(sourceId: string) {
  // persistedDef（0707 优化·Phase4）：该源若保存过自己的流程（含网站同步覆盖写入的），优先加载，
  // 否则退回按 Step 拼通用模板——不然子源单独调整 / 网站同步的结果重进画布会被覆盖掉。
  const [source, steps, persistedDef] = await Promise.all([
    sourceApi.sourceDetail(sourceId),
    sourceApi.sourceSteps(sourceId),
    flowApi.flowLoad(sourceId),
  ])
  if (source) {
    flow.loadFromSource(source, steps ?? [], persistedDef)
    // 深链/刷新直达也注册为页签（已开则仅激活）；超限时不阻断浏览，仅不入页签条
    ws.open(source.sourceId, source.name)
  }
}
// 网站态：加载网站统一流程模板（0707 优化·Phase4）；页签用 `site:${siteId}` 伪 id 复用既有页签机制，无需改 workspace 数据结构
async function loadSiteFlow(siteId: string) {
  const [site, def] = await Promise.all([siteApi.siteDetail(siteId), flowApi.flowLoad(`site:${siteId}`)])
  if (site) {
    flow.startSiteFlow(site, def)
    ws.open(`site:${siteId}`, site.name)
  }
}

async function onSave() {
  const res = await flowApi.flowSave(flow.serialize())
  flow.markSaved()
  ElMessage.success(res?.message || '流程已保存')
  if (flow.siteCtx) {
    syncDlg.visible = true
    syncDlg.siteId = flow.siteCtx.siteId
  }
}
async function onPublish() {
  const s = flow.sourceCfg
  if (flow.sourceCtx && (!s?.name || s.name === '未命名采集源' || !s.category)) {
    ElMessage.warning('发布前请先在顶部摘要头「编辑」中补全源名称 / 分类')
    return
  }
  const errs = flow.validateFlow()
  if (errs.length) {
    ElMessage.warning(`发布前请修正：${errs[0]}${errs.length > 1 ? ` 等 ${errs.length} 项` : ''}`)
    return
  }
  await flowApi.flowSave(flow.serialize())
  flow.markSaved()
  ElMessage.success('已保存并标记为发布候选（演示）')
}
function onTrial() {
  if (flow.siteCtx) {
    ElMessage.warning('网站是流程模板，不实际运行；请切到具体子源再试跑')
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

function registerCanvasActions() {
  ui.registerAction('保存', onSave)
  ui.registerAction('发布', onPublish)
  ui.registerAction('试跑', onTrial)
}

async function enterFromRoute() {
  const siteId = String(route.query.siteId ?? '')
  const sourceId = String(route.query.sourceId ?? '')
  if (siteId) {
    await loadSiteFlow(siteId)
  } else if (sourceId) {
    await loadSourceFlow(sourceId)
  } else {
    // 裸 /canvas 已由路由守卫导回采集资产；这里仅保留内部兜底
    flow.newFlow('blank')
  }
}
onMounted(async () => {
  if (isGate.value) {
    gateSite.value = blankSiteDraft()
    gateRows.value = [blankRow()]
    gateSourceDefaults.value = blankSourceDefaults()
    gateTemplateId.value = ''
    loadGateTemplates()
    registerCanvasActions()
    return
  }
  await enterFromRoute()
  registerCanvasActions()
})
// sourceId / siteId 互斥，合一个 watcher 处理（0707 优化·Phase4）：无论从页签/切换器/深链哪里改变编排对象都走这里
watch(
  () => [route.query.sourceId, route.query.siteId] as const,
  async ([sid, stid], prev) => {
    if (skipRouteReload) {
      skipRouteReload = false
      return
    }
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
    gateSourceDefaults.value = blankSourceDefaults()
    gateTemplateId.value = ''
    loadGateTemplates()
    registerCanvasActions()
  }
})
onUnmounted(() => {
  onSplitEnd()
  ui.inspectorExpanded = false
  ui.clearActions()
  flow.clearSourceCtx()
  flow.clearSiteCtx()
})
</script>

<template>
  <div v-if="isGate" class="rc-gate">
    <div class="rc-gate-card">
      <div class="rc-gate-title">新建采集 · 网站基础信息</div>
      <div class="rc-gate-hint">网站是流程模板 + 批量工具，本身不实际运行；子源（语言/变体）才是真正的采集实体，创建后可在画布内继续增删调整。</div>
      <div class="rc-field"><label>从现有网站复制（可选，预填网站信息与子源清单，不含节点编排细节）</label>
        <select class="rc-select" :value="gateTemplateId" @change="onPickSiteTemplate">
          <option value="">不使用模板，从空白开始</option>
          <option v-for="s in gateTemplates" :key="s.siteId" :value="s.siteId">{{ s.siteId }} · {{ s.name }}</option>
        </select>
      </div>
      <div class="rc-field"><label>网站 ID</label><input class="rc-input" v-model="gateSite.siteId" placeholder="必填" /></div>
      <div class="rc-field"><label>网站名称</label><input class="rc-input" v-model="gateSite.name" placeholder="必填" /></div>
      <div class="rc-field"><label>分类</label>
        <select class="rc-select" v-model="gateSite.category" @change="onGateCategoryChange">
          <option v-for="opt in GATE_CATEGORY_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>
      <div class="rc-field"><label>标签</label><input class="rc-input" v-model="gateTagsInput" placeholder="用逗号分隔，选填" /></div>

      <div class="rc-gate-rows-title">子源清单（至少一个，语言 / 变体，创建后可继续增删）</div>
      <div v-for="(row, i) in gateRows" :key="row.sourceId" class="rc-gate-row">
        <input class="rc-input" v-model="row.name" placeholder="子源名称，必填" />
        <input class="rc-input" v-model="row.url" placeholder="子源 URL，选填" />
        <button class="rc-btn" type="button" :disabled="gateRows.length <= 1" @click="removeGateRow(i)">移除</button>
      </div>
      <button class="rc-btn" type="button" @click="addGateRow">＋ 添加子源</button>

      <div class="rc-gate-rows-title">子源默认设置（可选，套用到本批全部子源，创建后各子源仍可单独覆盖）</div>
      <SourceBasicForm v-model="gateSourceDefaults" :show-identity="false" />

      <div class="rc-gate-actions">
        <button class="rc-btn" type="button" @click="onCancelGate">取消</button>
        <button class="rc-btn primary" type="button" @click="onCreateAndEnter">创建并进入编排</button>
      </div>
    </div>
  </div>

  <template v-else>
    <SourceTabsBar v-if="flow.sourceCtx || flow.siteCtx" />
    <CompareSplit v-if="ws.compareSourceId" class="rc-flow-result with-tabs" />
    <ResultView v-else-if="isDataView" :key="ws.activeSourceId" class="rc-flow-result with-tabs" />
    <TaskView v-else-if="isTaskView" :key="ws.activeSourceId" class="rc-flow-result with-tabs" />
    <div
      v-else
      class="rc-flow-shell"
      :class="{ 'source-mode': !!(flow.sourceCtx || flow.siteCtx), expanded: ui.inspectorExpanded, 'with-tabs': !!(flow.sourceCtx || flow.siteCtx) }"
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
  </template>

  <SyncSourcesDialog v-if="syncDlg.visible" :site-id="syncDlg.siteId" @close="syncDlg.visible = false" />
</template>

<style scoped>
.rc-flow-shell {
  display: grid;
  grid-template-columns: minmax(620px, 1fr) 6px var(--insp-w, 372px);
  gap: 8px;
  align-items: stretch;
  height: calc(100vh - 168px);
  min-height: 600px;
}
.rc-flow-shell.source-mode { grid-template-columns: minmax(560px, 1fr) 6px var(--insp-w, 480px); }
/* 展开态：配置区约 2/3 视口宽，画布压缩为缩略列 */
.rc-flow-shell.expanded { grid-template-columns: minmax(0, 1fr) 6px minmax(0, 66vw); }
.rc-flow-result { height: calc(100vh - 168px); min-height: 600px; }
/* 源详情页签条占位后收缩内容高度 */
.rc-flow-shell.with-tabs { height: calc(100vh - 204px); min-height: 564px; }
.rc-flow-result.with-tabs { height: calc(100vh - 204px); min-height: 564px; }

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
  .rc-flow-shell,
  .rc-flow-shell.source-mode,
  .rc-flow-shell.expanded { grid-template-columns: minmax(0, 1fr); height: auto; }
  .rc-insp-splitter { display: none; }
  .rc-flow-shell > :last-child { grid-column: 1 / -1; min-height: 520px; }
}
</style>
