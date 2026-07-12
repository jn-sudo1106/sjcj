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

const route = useRoute()
const router = useRouter()
const flow = useFlowStore()
const ui = useUiStore()
const ws = useWorkspaceStore()
const runtime = useRuntimeStore()
// 数据/任务视图站在网站粒度（0707 优化·Phase5），网站模板与子源两种编排对象都可达
const isDataView = computed(() => route.query.view === 'data' && !!(flow.sourceCtx || flow.siteCtx))
// 任务视图只挂网站层（0710 会议 C2）：无源概念，源态 URL 带 view=task 由 loadSourceFlow 重定向回流程视图
const isTaskView = computed(() => route.query.view === 'task' && !!flow.siteCtx)
// 文件视图只挂子源层（0711 R11：文件视图只有源才有）：网站态 URL 带 view=file 同理重定向回流程视图
const isFileView = computed(() => route.query.view === 'file' && !!flow.sourceCtx)


// 页签快照（0710 会议 B3 改键）：视图记到当前页签（网站页签键 site:xxx / 无归属草稿源键 sourceId），
// activeKey（页签内停留的编排对象）由 loadSourceFlow / loadSiteFlow 在加载时写入。
// 只在路由目标与已加载 ctx 一致时保存——路由切走瞬间 ctx 还是旧对象，此时保存会把新路由的
// view 冲掉旧页签的快照（浏览器实测抓到的真实竞态：切页签后数据视图被还原成流程视图）。
watch(
  () => [route.query.sourceId, route.query.siteId, route.query.view, flow.sourceCtx?.sourceId, flow.siteCtx?.siteId] as const,
  ([qSrc, qSite, v, ctxSrc, ctxSite]) => {
    const matched = (qSite && ctxSite === String(qSite)) || (qSrc && ctxSrc === String(qSrc))
    if (!matched) return
    const key = ctxSite ? `site:${ctxSite}` : flow.sourceCtx?.siteId ? `site:${flow.sourceCtx.siteId}` : ctxSrc ? String(ctxSrc) : ''
    if (key) ws.saveSnapshot(key, { view: v === 'data' ? 'data' : v === 'task' ? 'task' : 'flow' })
  },
  { immediate: true },
)

// ---- 子源侧栏（0710 会议 B1）：页面级左列，流程/数据/任务视图共用；接线自 FlowBoard 顶部横排切换器迁入 ----
const sidebarSiteId = computed(() => flow.siteCtx?.siteId || flow.sourceCtx?.siteId || '')
const sidebarActiveKey = computed(() => (flow.siteCtx ? 'site' : (flow.sourceCtx?.sourceId ?? '')))
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
async function onSwitchTarget(target: 'site' | Source) {
  if (!(await confirmDiscardIfDirty())) return
  if (target === 'site') {
    if (!sidebarSiteId.value) return
    // 文件视图只属于子源层（0711 R11）：从文件视图切到网站时回落流程视图，数据视图正常随身携带
    const view = route.query.view && route.query.view !== 'file' ? { view: route.query.view } : {}
    router.replace({ path: '/canvas', query: { siteId: sidebarSiteId.value, ...view } })
  } else {
    // 任务视图只属于网站层（C2）：从任务视图切到子源时回落流程视图，数据视图正常随身携带
    const view = route.query.view && route.query.view !== 'task' ? { view: route.query.view } : {}
    router.replace({ path: '/canvas', query: { sourceId: target.sourceId, ...view } })
  }
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

// ---- 新建采集闸门（0707 优化·Phase3 → §5.7 改口径）：先填网站基础信息 + 首批子源清单，过闸进入网站统一流程画布。
// §5.7 推翻 §5.5 的"落地范围收窄（落到第一个子源）"——Phase4 的 siteCtx / 切换器 / 同步弹窗就绪后，回正到方案 B：
// - 单一权威方向（模板→子源同步），不引入子源互相复制，detached 语义干净（A+C 同步根基，详见 §5.7 理由 1）；
// - 新建瞬间所有子源空白、视角天然就是模板，不需额外"传染"步骤（理由 2）；
// - 想验证时切换器一键切子源试跑，试跑入口仍在切换器旁（理由 3）；
// - 引导文案（FlowBoard 空白卡）与同步成功提示（SyncSourcesDialog）配套改文案，详见 §5.7 落地口径。
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
// 首个子源名称联动（0711 R4）：网站名称变化时，只要用户还没手动改过首个子源名称，就跟随同步；
// 用户一旦在首行输入框手动改过就停止跟随。从模板复制时整批 gateRows 会被模板子源名称整体替换，
// 那次替换不应算作"跟随同步"的产物，也不该被之前的 touched 状态污染，所以在选模板时重置该标记。
const firstSourceNameTouched = ref(false)
watch(
  () => gateSite.value.name,
  (name) => {
    if (!firstSourceNameTouched.value && gateRows.value[0]) gateRows.value[0].name = name
  },
)
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
  firstSourceNameTouched.value = false // 模板子源名称整体替换不算"用户手动改过"，重置跟随状态
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
  if (!source) {
    ElMessage.error('源不存在')
    return
  }
  if (source) {
    flow.loadFromSource(source, steps ?? [], persistedDef)
    // 页签网站化（0710 会议 B3）：有归属网站的子源挂在网站页签下（页签名=网站 · 子源，快照记停留位置）；
    // 无 siteId 的历史草稿源保留独立页签。深链/刷新直达同样注册；超限不阻断浏览，仅不入页签条。
    if (source.siteId) {
      const site = await siteApi.siteDetail(source.siteId)
      const key = `site:${source.siteId}`
      ws.open(key, site ? `${site.name} · ${source.name}` : source.name)
      ws.saveSnapshot(key, { activeKey: source.sourceId })
    } else {
      ws.open(source.sourceId, source.name)
    }
  }
}
// 任务视图只挂网站层（0710 会议 C2）：子源态出现 view=task（深链/同源改 query 等一切路径）都回落流程视图。
// 独立 watcher 而非塞在 loadSourceFlow 里——同源仅 view 变化时 route watcher 会跳过重载，load 内的重定向够不着。
watch(
  () => [route.query.view, flow.sourceCtx?.sourceId, route.query.sourceId] as const,
  ([v, ctxSrc, qSrc]) => {
    if (v === 'task' && ctxSrc && String(qSrc ?? '') === ctxSrc) {
      router.replace({ path: '/canvas', query: { sourceId: ctxSrc } })
    }
  },
  { immediate: true },
)
// 文件视图只挂子源层（0711 R11）：网站态出现 view=file 都回落流程视图，与上面 view=task 同一套口径对称实现。
watch(
  () => [route.query.view, flow.siteCtx?.siteId, route.query.siteId] as const,
  ([v, ctxSite, qSite]) => {
    if (v === 'file' && ctxSite && String(qSite ?? '') === ctxSite) {
      router.replace({ path: '/canvas', query: { siteId: ctxSite } })
    }
  },
  { immediate: true },
)
// 网站态：加载网站统一流程模板（0707 优化·Phase4）；页签用 `site:${siteId}` 伪 id 复用既有页签机制，无需改 workspace 数据结构
async function loadSiteFlow(siteId: string) {
  const [site, def] = await Promise.all([siteApi.siteDetail(siteId), flowApi.flowLoad(`site:${siteId}`)])
  if (site) {
    flow.startSiteFlow(site, def)
    ws.open(`site:${siteId}`, site.name)
    ws.saveSnapshot(`site:${siteId}`, { activeKey: 'site' })
  }
}

// 保存即绑定（0710 会议 C3）：网站态保存 = 存模板 + 同步到未脱离子源，不再弹勾选列表——
// 覆盖多个子源属危险操作，按项目约定保留一次 confirm；取消 = 仅保存模板（不同步）。
async function onSave() {
  try {
    const res = await flowApi.flowSave(flow.serialize())
    if (!res?.ok) {
      ElMessage.error(res?.message || '保存失败')
      return
    }
    flow.markSaved()
    if (!flow.siteCtx) {
      ElMessage.success(res?.message || '流程已保存')
      return
    }
    const children = await siteApi.siteSources(flow.siteCtx.siteId)
    const targets = children.filter((c) => !c.detached).map((c) => c.sourceId)
  const detachedCount = children.length - targets.length
  if (!targets.length) {
    ElMessage.success(children.length ? '模板已保存；全部子源已单独调整，未覆盖' : '模板已保存')
    return
  }
  try {
    await ElMessageBox.confirm(
      `模板已保存。将同步覆盖 ${targets.length} 个未脱离子源的整条流程${detachedCount ? `（${detachedCount} 个已单独调整不覆盖）` : ''}，是否继续？`,
      '保存并同步到子源',
      { type: 'warning', confirmButtonText: '同步', cancelButtonText: '仅保存模板' },
    )
  } catch {
    ElMessage.success('模板已保存（本次未同步子源）')
    return
  }
  const syncRes = await siteApi.siteSyncFlow(flow.siteCtx.siteId, targets)
  if (!syncRes?.ok) {
    ElMessage.error(syncRes?.message || '同步失败')
    return
  }
  const base = (syncRes?.message || `已同步到 ${targets.length} 个子源（演示）`).replace(/[。.；;，,]\s*$/, '')
  ElMessage.success(`${base}，可切换到具体子源试跑验证`)
  } catch (e) {
    ElMessage.error(`保存失败：${(e as Error).message ?? '未知错误'}，画布未清空，请重试`)
  }
}
function onTrial() {
  if (flow.siteCtx) {
    ElMessage.warning('网站是流程模板，不实际运行；请切到具体子源再试跑')
    return
  }
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
    firstSourceNameTouched.value = false
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
    firstSourceNameTouched.value = false
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
      <!-- 网站 ID 自动生成（0710 会议 D7）：不让用户填，只读展示 -->
      <div class="rc-field"><label>网站 ID（自动生成）</label><input class="rc-input" :value="gateSite.siteId" readonly disabled /></div>
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
    <SourceTabsBar v-if="flow.sourceCtx || flow.siteCtx" />
    <!-- 两列布局（0710 会议 B1）：左列子源侧栏（页面级，在视图层之上），右列内容区随流程/数据/任务视图切换 -->
    <div class="rc-canvas-cols" :class="{ 'with-tabs': !!(flow.sourceCtx || flow.siteCtx) }">
      <SiteSourceSwitcher
        v-if="sidebarSiteId"
        :site-id="sidebarSiteId"
        :active-key="sidebarActiveKey"
        @pick="onSwitchTarget"
        @added="onSwitchAdded"
        @compare="onSidebarCompare"
      />
      <div class="rc-canvas-main">
        <!-- key 用加载完成后的 ctx（而非 route query）：确保重挂载时 flow.sourceCtx/siteCtx 已是新对象，避免读到旧源的竞态 -->
        <CompareSplit v-if="ws.compareSourceId" class="rc-flow-result" />
        <ResultView v-else-if="isDataView" :key="flow.sourceCtx?.sourceId || flow.siteCtx?.siteId" class="rc-flow-result" />
        <TaskView v-else-if="isTaskView" :key="flow.sourceCtx?.sourceId || flow.siteCtx?.siteId" class="rc-flow-result" />
        <FileView v-else-if="isFileView" :key="flow.sourceCtx?.sourceId" class="rc-flow-result" />
        <div
          v-else
          class="rc-flow-shell"
          :class="{ 'source-mode': !!(flow.sourceCtx || flow.siteCtx), expanded: ui.inspectorExpanded }"
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
