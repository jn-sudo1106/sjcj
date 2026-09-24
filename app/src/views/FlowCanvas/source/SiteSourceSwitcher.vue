<script setup lang="ts">
// 源侧栏：页面级左侧固定栏，流程、数据、文件和任务视图共用。
import { computed, h, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import { CHANGE_SITE_CHUNK, flowCenterApi, siteApi, sourceApi, type Site, type SourceCategory, type Source, type UsedTable } from '@/api'
import SiteTablePanel from './SiteTablePanel.vue'
import SourceParamModal from './SourceParamModal.vue'
import { importProgressText } from './importProgress'

/**
 * 0903 Y8-9：只控制**新增的第三步**（复制完把新源关联到被复制源的流程）。
 * 已经在跑的复制功能（copySource?flag=1 + changeSite）不受它影响——关掉开关，复制照样可用，
 * 只是不自动关联流程。实测通过后可以删掉这个常量。
 */
const ENABLE_SOURCE_COPY_BIND_FLOW = true
import { hasLoadParams } from './paramNormalize'
import { urlOrPlaceholder } from '@/utils/source/placeholderUrl'
import { toExternalHref } from '@/utils/url/externalUrl'
import type { ParamGroupRef } from '@/utils/flow/urlParams'
import ParamSourceEditor, { type ParamSourceModel } from './ParamSourceEditor.vue'
import SiteEditorDialog from '@/views/CollectAssets/components/SiteEditorDialog.vue'
import EditSourceDialog from './EditSourceDialog.vue'
import { withoutComposition } from '@/utils/enterKey'
import { useFlowStore } from '@/stores/flow'
import { useWorkspaceStore } from '@/stores/workspace'
import { useUiStore } from '@/stores/ui'
import { csvDateTag, downloadCsv, toCsv } from '@/utils/csv'
import { Close, Download } from '@element-plus/icons-vue'
import { copyToClipboard } from '@/utils/clipboard'

const props = defineProps<{
  siteId: string
  activeKey: string
  /** 网站态 + 数据视图时为 true（0924-10，Q4）：顶部出现「源 / 数据表」切换；其他视图恒为源列表 */
  allowTableMode?: boolean
  /** 数据表模式下选中的表（地址栏 tableId） */
  activeTableId?: string
  /** 地址栏没带表时优先选它（网站页签快照里上次看的表） */
  preferredTableId?: string
}>()
const emit = defineEmits<{
  pick: [target: Source]
  added: [Source]
  compare: [rightId: string]
  pickSite: []
  /** 数据表模式下点了一张表 */
  pickTable: [table: UsedTable]
}>()

const flow = useFlowStore()
const ws = useWorkspaceStore()
const ui = useUiStore()
/** 当前是否显示数据表列表：只有允许（数据视图）且用户选了数据表模式时 */
const tableMode = computed(() => !!props.allowTableMode && ui.siteDataSideMode === 'table')

const site = ref<Site | null>(null)
const children = ref<Source[]>([])
const childrenHydrating = ref(false)
/** 源列表（首批）没拉下来。跟「这个网站确实没有源」必须分开显示，见下方 load 的说明 */
const listLoadFailed = ref(false)
let loadSeq = 0
/**
 * 网站详情和源列表**各算各的**（2026-09-23）。
 *
 * 原来是 `Promise.all([siteDetail, 源列表])` 且没有 catch：两个里任何一个失败，整个 load
 * 直接抛掉——site 留空、children 留空，侧栏就显示「源列表 (0)」「该网站暂无源」，
 * 把"没加载出来"伪装成"这个网站没有源"，也不提示、不能重试。用户实际撞到过：
 * 站 89（主流媒体，1368 个源）侧栏显示 0，右侧源视图走 sourcePaged 却正常列出 1368 个。
 */
async function load(force = false) {
  const id = ++loadSeq
  listLoadFailed.value = false
  // 左侧首屏最多渲染 120 行，不必先等单站 6496 条完整响应。先取同等大小的预览让网站页
  // 立即可用，再后台补齐完整列表；右侧源视图自己的 sourcePaged(20) 可同时快速返回。
  // 强刷（外部新建源、改配置后）要最新数据，直接拿完整列表、绕过 siteSources 的短缓存。
  const [detailRes, listRes] = await Promise.allSettled([
    siteApi.siteDetail(props.siteId),
    force ? siteApi.siteSources(props.siteId, { force: true }) : siteApi.siteSourcePreview(props.siteId, LIST_PAGE),
  ])
  // 响应慢，回来时可能已切到别的站（watch 已推进 loadSeq）——晚到的旧站数据直接丢弃。
  if (id !== loadSeq) return
  // 详情失败就清掉，别留着上一个网站的名字和源数
  site.value = detailRes.status === 'fulfilled' ? detailRes.value : null
  if (site.value?.name) nameSiteTab(props.siteId, site.value.name)
  if (listRes.status === 'rejected') {
    children.value = []
    childrenHydrating.value = false
    listLoadFailed.value = true
    return
  }
  children.value = listRes.value
  if (force) {
    childrenHydrating.value = false
    return
  }
  // 详情没拿到就不知道总数：预览拉满一页就当作可能还有，照样后台补齐，别只停在前 120 个
  const expected = site.value?.sourceCount
  childrenHydrating.value = expected != null ? listRes.value.length < expected : listRes.value.length >= LIST_PAGE
  if (!childrenHydrating.value) return
  void siteApi.siteSources(props.siteId).then((all) => {
    if (id !== loadSeq) return
    children.value = all
    childrenHydrating.value = false
  }).catch(() => {
    if (id === loadSeq) childrenHydrating.value = false
  })
}
/**
 * 「全部 · 网站名」页签只拿到 siteId 时显示的是裸 ID，靠 site/detail 补名；那次请求失败就一直是
 * 「全部 · 89」。侧栏这里也拿了一次详情，顺手补上——点「重试」也就连页签名一起修好了。
 * 只改已有的页签，不在这里新建（建不建页签是路由那边的事）。
 */
function nameSiteTab(siteId: string, name: string) {
  if (ws.siteTabs.some((t) => t.siteId === siteId)) ws.ensureSiteTab(siteId, name)
}
onMounted(() => load())
watch(() => props.siteId, () => load())
// 外部（新建源、改配置等）触发的刷新要拿最新数据，绕过 siteSources 的短缓存
defineExpose({ reload: () => load(true) })

const collapsed = ref(false)
const listExpanded = ref(true)
const detailExpanded = ref(true)
const kw = ref('')
/**
 * 按数据条件反查出的命中源（2026-09-09）。数据视图点「按条件查源」后写进 store，
 * 侧栏在此收窄成"只显示这批源"，按命中条数从多到少排——问题最严重的排最前。
 *
 * 为什么不复用搜索框：`kw` 是单关键词子串匹配（name/sourceId 任一包含即可），
 * 喂不进一批 ID；硬拼成 "a|b|c" 还得改匹配规则，两件事的语义也不一样
 * （搜索是"我记得名字里有这几个字"，命中是"就这些源，别的别显示"）。
 */
const hits = computed(() => ws.backTraceHitsOf(props.siteId))
const hitCountBy = computed(() => new Map(hits.value.map((h) => [h.sourceId, h.count])))
const hitFiltered = computed(() => {
  if (!hits.value.length) return children.value
  const order = new Map(hits.value.map((h, i) => [h.sourceId, i]))
  return children.value
    .filter((s) => order.has(s.sourceId))
    .sort((a, b) => (order.get(a.sourceId) ?? 0) - (order.get(b.sourceId) ?? 0))
})
const filtered = computed(() => {
  const q = kw.value.trim().toLowerCase()
  if (!q) return hitFiltered.value
  return hitFiltered.value.filter((s) => s.name.toLowerCase().includes(q) || s.sourceId.toLowerCase().includes(q))
})
// 分页渲染：源多的网站（实测 6496 个）一次性铺 6496 行会把 #app DOM 顶到 29 万节点，
// 首屏渲染和之后每次响应式刷新都被拖慢。只渲染前 shownCount 行，滚到底再追加一页。
const LIST_PAGE = 120
const shownCount = ref(LIST_PAGE)
const visibleRows = computed(() => filtered.value.slice(0, shownCount.value))
/**
 * 标题上那个数字（2026-09-11）。
 *
 * 原先恒取 sourceCount，于是反查命中后标题写着「源列表 (6496)」、列表里却只有 40 行，
 * 两个数字当面打架——本块加反查命中条时的理由正是"别让人以为侧栏坏了"，可标题这半边
 * 一直没跟上。列表被收窄（命中 / 搜索）时改说「40 / 6496」：前一个是眼前有多少，
 * 后一个留住总量这个上下文。
 *
 * 只在收窄时才加分母：源还在加载时 filtered 是空的，无条件显示分数会闪一下「0 / 6496」。
 */
/**
 * 把命中的源导出成 CSV（2026-09-11）。
 *
 * 这批源是前端算出来的（反查命中 + 可能再叠加了搜索），后端没有对应的导出接口，
 * 所以在前端拼文件——与数据视图那个「导出 Excel」不是一回事，那个是甩 URL 给后端。
 *
 * 导的是**眼前这份列表**而不是全部命中：标题上写着多少就导多少，所见即所得；
 * 想要全部命中，把搜索词清掉即可。
 */
function exportHits() {
  const rows = filtered.value.map((s) => [s.sourceId, s.name, hitCountBy.value.get(s.sourceId) ?? ''])
  const csv = toCsv(['源 ID', '源名称', '命中条数'], rows)
  downloadCsv(`${site.value?.name || '网站'}_条件命中源_${csvDateTag()}`, csv)
}

const listNarrowed = computed(() => !!hits.value.length || !!kw.value.trim())
const listCountLabel = computed(() => {
  // 收窄时分母取 children 而不是 sourceCount：**分子分母必须同源**。分子是从 children
  // 一路过滤下来的，而 sourceCount 来自 siteDetail 接口，两者在加载中或接口不同步时会
  // 对不上，显示出「2 / 1」这种分子大于分母的荒谬值（2026-09-11 被测试当场抓到）。
  if (listNarrowed.value) return `${filtered.value.length} / ${children.value.length}`
  // 加载失败又不知道总数时写「—」，别写 0 冒充"没有源"
  if (listLoadFailed.value && site.value?.sourceCount == null) return '—'
  return String(site.value?.sourceCount ?? children.value.length)
})
watch([kw, children, hitFiltered], () => { shownCount.value = LIST_PAGE })
function onListScroll(e: Event) {
  const el = e.target as HTMLElement
  if (
    shownCount.value < filtered.value.length &&
    el.scrollTop + el.clientHeight >= el.scrollHeight - 240
  ) {
    shownCount.value += LIST_PAGE
  }
}
const activeSource = computed(() => children.value.find((s) => s.sourceId === props.activeKey) || null)

/**
 * 复制走全站统一的 `copyToClipboard`（2026-09-22 修）。
 *
 * 这里原先自己写了一套 `navigator.clipboard.writeText` + catch，
 * **在部署站上必然失败**：生产是 http、非安全上下文，浏览器压根不暴露 `navigator.clipboard`，
 * 于是每次都落到 catch、`ElMessage.info('源 ID: xxx')` 把值弹成一条提示——
 * 用户看到的就是"复制不了，还冒出个浮层"（2026-09-22 用户在生产报的）。
 * 关键是它**根本没尝试过复制**：没有 execCommand 兜底。
 *
 * `utils/clipboard.ts` 那条路才是全的（异步 API → execCommand → 可一步复制的弹窗），
 * 0920-03 刚加固过。全站只该有那一个复制实现。
 */
function copyText(text: string, label: string) {
  void copyToClipboard(text, label)
}
function copyId(id: string) {
  void copyText(id, '源 ID')
}
function sourceDisplayUrl(s: Source) {
  return s.kind === 'param' ? (s.urlTemplate || s.baseUrl || s.url || '') : (s.url || '')
}
/**
 * 源 URL 可点开（2026-09-17 用户提，与 CanvasHeader 摘要行同批）：看到地址就想去原站核对。
 * 参数源这里展示的是 urlTemplate（带 $PARAM$ 占位符），不是能打开的地址，不给链接。
 */
function sourceOpenUrl(s: Source) {
  return s.kind === 'param' ? '' : toExternalHref(s.url)
}
function copySourceUrl(s: Source) {
  void copyText(sourceDisplayUrl(s), '源 URL')
}

const editSourceOpen = ref(false)
function applyEditedSource(updated: Source) {
  const local = children.value.find((c) => c.sourceId === updated.sourceId)
  if (local) {
    local.name = updated.name
    local.url = updated.url
  }
  if (flow.sourceCtx?.sourceId === updated.sourceId) {
    if (updated.url !== flow.sourceCtx.url) flow.patchSource({ name: updated.name, url: updated.url })
    flow.patchSourceCtx({ name: updated.name, url: updated.url })
  }
  ws.renameTab(updated.sourceId, updated.name)
}

function isErr(s: Source): boolean {
  return !s.disabled && s.state === 'E'
}
const canCompare = computed(() => !!props.activeKey)

// ---- 全局对比选择器（B4：跨站场景，按 sourceId 直接分屏加载，不依赖页签） ----
const cmp = reactive({ show: false, kw: '', results: [] as Source[], loading: false })
function openComparePicker() {
  cmp.show = true
  cmp.kw = ''
  cmp.results = children.value.filter((c) => c.sourceId !== props.activeKey)
}
function closeComparePicker() {
  cmp.show = false
}
let cmpTimer: ReturnType<typeof setTimeout> | undefined
function onCompareKwInput() {
  clearTimeout(cmpTimer)
  cmpTimer = setTimeout(async () => {
    const q = cmp.kw.trim()
    if (!q) {
      cmp.results = children.value.filter((c) => c.sourceId !== props.activeKey)
      return
    }
    cmp.loading = true
    try {
      // 全局搜索（含跨站）：复用源分页契约的 keyword 匹配，排除当前源
      const res = await sourceApi.sourcePaged({ keyword: q, size: 50 })
      cmp.results = res.list.filter((s) => s.sourceId !== props.activeKey)
    } finally {
      cmp.loading = false
    }
  }, 250)
}
function pickCompare(s: Source) {
  closeComparePicker()
  emit('compare', s.sourceId)
}
function onWindowClick() {
  if (cmp.show) closeComparePicker()
  closeRowMenu()
  closeSiteMenu()
  paramEditorRef.value?.closePicker()
}
onMounted(() => window.addEventListener('click', onWindowClick))
onBeforeUnmount(() => {
  window.removeEventListener('click', onWindowClick)
  if (cmpTimer) clearTimeout(cmpTimer)
})

// ---- 源操作：名称点击切换；右键菜单提供重命名/发起抓取 ----
const rename = reactive({ sourceId: '', name: '' })
function startRename(s: Source) {
  rename.sourceId = s.sourceId
  rename.name = s.name
  closeRowMenu()
}
function cancelRename() {
  rename.sourceId = ''
  rename.name = ''
}
async function saveRename(s: Source) {
  const name = rename.name.trim()
  if (!name || rename.sourceId !== s.sourceId) {
    cancelRename()
    return
  }
  if (name === s.name) {
    cancelRename()
    return
  }
  const updated = { ...s, name }
  try {
    const res = await sourceApi.sourceUpdate(updated)
    if (!res?.ok) {
      ElMessage.warning(res?.message || '重命名失败，请重试')
      return
    }
    s.name = name
    cancelRename()
    ElMessage.success(res?.message || '源已重命名')
    emit('added', updated)
  } catch (error) {
    ElMessage.error(`重命名失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

const rowMenu = reactive({ show: false, x: 0, y: 0, source: null as Source | null })
function openRowMenu(event: MouseEvent, s: Source) {
  rowMenu.show = true
  rowMenu.x = event.clientX
  rowMenu.y = event.clientY
  rowMenu.source = s
}
function closeRowMenu() {
  rowMenu.show = false
  rowMenu.source = null
}

const paramModalRef = ref<InstanceType<typeof SourceParamModal>>()
async function launchFromMenu() {
  const s = rowMenu.source
  if (!s || s.disabled) return
  closeRowMenu()
  await sendSnatchForSource(s)
}

// ---- 源右键：更换网站（2026-08-27）----
// 一个源只属于一个网站（0824-00 §1.1 变更），所以这是「搬移」不是「多加一个关联」：
// 换绑成功后本网站不再包含该源，必须在确认文案里说清楚，否则用户会以为只是加了个关系。
const moveDlg = reactive({ show: false, source: null as Source | null, targetSiteId: '', saving: false })
const siteOptions = ref<Site[]>([])
async function openMoveDialog(s: Source) {
  closeRowMenu()
  moveDlg.source = s
  moveDlg.targetSiteId = ''
  moveDlg.show = true
  if (!siteOptions.value.length) {
    try {
      siteOptions.value = (await siteApi.sitePaged({ size: 200 })).list
    } catch (error) {
      ElMessage.error(`网站列表加载失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
function closeMoveDialog() {
  moveDlg.show = false
  moveDlg.source = null
}
const moveTargets = computed(() => siteOptions.value.filter((s) => String(s.siteId) !== String(props.siteId)))
/** 换绑弹窗里的「当前所属」：优先用网站列表里的真名，取不到就退回 ID（0828 W5-9） */
const currentSiteLabel = computed(() => {
  const current = siteOptions.value.find((s) => String(s.siteId) === String(props.siteId))
  if (current) return `${current.name}（ID ${current.siteId}）`
  return site.value?.name ? `${site.value.name}（ID ${props.siteId}）` : `ID ${props.siteId}`
})
async function submitMove() {
  const s = moveDlg.source
  const target = moveDlg.targetSiteId
  if (!s || !target || moveDlg.saving) return
  const targetName = moveTargets.value.find((x) => String(x.siteId) === target)?.name || target
  moveDlg.saving = true
  try {
    const res = await sourceApi.changeSite([s.sourceId], target)
    if (!res?.ok) {
      ElMessage.warning(res?.message || '更换网站失败，请重试')
      return
    }
    // 换绑成功：本网站列表里移除该源（源已经搬走，不是还在这儿）
    children.value = children.value.filter((c) => c.sourceId !== s.sourceId)
    closeMoveDialog()
    ElMessage.success(`源「${s.name}」已移至网站「${targetName}」`)
  } catch (error) {
    ElMessage.error(`更换网站失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    moveDlg.saving = false
  }
}

// ---- 源右键：删除源（2026-08-27）----
// 永久删除，不可恢复；确认文案必须写明源名和 ID，避免误删相邻行。
async function deleteFromMenu() {
  const s = rowMenu.source
  if (!s) return
  closeRowMenu()
  try {
    await ElMessageBox.confirm(
      `将永久删除源「${s.name}」（ID ${s.sourceId}），该操作直接生效且不可恢复。确认删除？`,
      '删除源',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' },
    )
  } catch {
    return
  }
  try {
    const res = await sourceApi.deleteSource([s.sourceId])
    if (!res?.ok) {
      ElMessage.warning(res?.message || '删除失败，请重试')
      return
    }
    children.value = children.value.filter((c) => c.sourceId !== s.sourceId)
    ElMessage.success(`源「${s.name}」已删除`)
  } catch (error) {
    ElMessage.error(`删除失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

// ---- 网站右键：重命名（2026-08-27）----
const siteMenu = reactive({ show: false, x: 0, y: 0 })
function openSiteMenu(event: MouseEvent) {
  if (!site.value) return
  siteMenu.show = true
  siteMenu.x = event.clientX
  siteMenu.y = event.clientY
}
function closeSiteMenu() {
  siteMenu.show = false
}
// 编辑网站基本信息复用采集资产页的 SiteEditorDialog（名称+分类，分类必填），
// 不再单独做一个只改名称的简化版——分类是必填字段，只给名称输入框会存不进去。
const siteEditDlg = reactive({ show: false })
const siteCategories = ref<SourceCategory[]>([])
async function openSiteEdit() {
  closeSiteMenu()
  if (!site.value) return
  if (!siteCategories.value.length) {
    try {
      // sourceApi.sourceCategories() 不带 parentId 只返回顶层分类，不含子级（实测：真实分类是
      // 两级，网站当前分类往往就是子级，如「财经资讯 / 社交平台」）。CategoryTreePicker/
      // MoreSourcesDialog 用的是真正的树控件、按展开节点懒加载子级；这里是普通下拉框，没有
      // 展开动作，只能一次性把每个顶层的子级都取回来拍平，否则网站当前分类在下拉里选不中，
      // 保存时又会把它换成一个错的顶层分类。
      const roots = await sourceApi.sourceCategories()
      const childrenByRoot = await Promise.all(roots.map((r) => sourceApi.sourceCategories(r.id)))
      siteCategories.value = roots.map((r, i) => ({ ...r, children: childrenByRoot[i] }))
    } catch (error) {
      ElMessage.error(`分类列表加载失败：${error instanceof Error ? error.message : String(error)}`)
      return
    }
  }
  siteEditDlg.show = true
}
function onSiteEditSaved() {
  void load(true)
}

// ---- ＋添加源（0812 会议纠偏：删除"绑定已有源/仅展示未关联"模式，只保留新建；
// 按源 ID/名称导入现有源的能力放到 M4 的"导入源"，接旧平台真实批量归属契约） ----
type TemplateMode = 'default' | 'search' | 'blank'
type SourceKind = 'normal' | 'param'
const addDlg = reactive({
  show: false,
  name: '',
  url: '',
  templateMode: 'blank' as TemplateMode,
  templateSourceId: '',
  kind: 'normal' as SourceKind,
})
const templateSearch = reactive({ keyword: '', results: [] as Source[], loading: false, open: false })
const defaultTemplate = computed(() => children.value[0] ?? null)
const selectedTemplate = computed(() => {
  if (addDlg.templateMode === 'default') return defaultTemplate.value
  if (addDlg.templateMode === 'search') return templateSearch.results.find((source) => source.sourceId === addDlg.templateSourceId) ?? null
  return null
})
function onTemplateModeChange() {
  addDlg.templateSourceId = ''
  templateSearch.keyword = ''
  templateSearch.results = []
  templateSearch.open = false
}
async function searchTemplateSources() {
  const keyword = templateSearch.keyword.trim()
  addDlg.templateSourceId = ''
  templateSearch.results = []
  templateSearch.open = !!keyword
  if (!keyword) return
  templateSearch.loading = true
  try {
    templateSearch.results = (await sourceApi.sourcePaged({ keyword, size: 50 })).list
  } finally {
    templateSearch.loading = false
  }
}
function selectTemplateSource(source: Source) {
  addDlg.templateSourceId = source.sourceId
  templateSearch.keyword = `${source.name}（${source.sourceId}）`
  templateSearch.open = false
}
function openAdd(ev: MouseEvent) {
  ev.stopPropagation()
  addDlg.show = true
  addDlg.name = ''
  addDlg.url = ''
  addDlg.kind = 'normal'
  addDlg.templateMode = defaultTemplate.value ? 'default' : 'blank'
  addDlg.templateSourceId = ''
  templateSearch.keyword = ''
  templateSearch.results = []
  templateSearch.open = false
  resetParamSource()
}
function closeAdd() {
  addDlg.show = false
}

// ---- 参数源（0721 会议）：加源弹窗内新增分支，与上面的普通源字段/流程互不干扰 ----
// 面板本体抽成 ParamSourceEditor（NodeInspector 只读摘要 / 编辑参数源弹窗共用），这里只留创建态需要的胶水。
const paramSrc = ref<ParamSourceModel>({ baseUrl: '', refs: [] as ParamGroupRef[], urlTemplate: '' })
const paramEditorRef = ref<InstanceType<typeof ParamSourceEditor> | null>(null)

function resetParamSource() {
  paramSrc.value = { baseUrl: '', refs: [], urlTemplate: '' }
}
function switchKind(kind: SourceKind) {
  addDlg.kind = kind
}

async function submitParamSource() {
  const name = addDlg.name.trim()
  if (!name) {
    ElMessage.warning('请填写源名称')
    return
  }
  if (!paramSrc.value.baseUrl.trim()) {
    ElMessage.warning('请填写基础 url')
    return
  }
  if (!paramSrc.value.refs.length) {
    ElMessage.warning('请至少添加一个参数')
    return
  }
  if (paramEditorRef.value?.mismatchWarnings.length) {
    ElMessage.warning('存在同组值数不一致的分组，请先调整')
    return
  }
  const sourceId = `${props.siteId}-${Date.now().toString(36)}`
  const res = await siteApi.sourceAdd(
    props.siteId,
    {
      sourceId,
      name,
      url: '',
      configId: '',
      mainTable: '',
      owner: site.value?.owner || 'admin',
      state: 'C',
      kind: 'param',
      baseUrl: paramSrc.value.baseUrl.trim(),
      urlTemplate: paramSrc.value.urlTemplate,
      paramRefs: paramSrc.value.refs.map((ref) => ({ ...ref })),
    },
    false,
  )
  if (!res.ok) {
    ElMessage.warning(res.message || '添加失败，请重试')
    return
  }
  const addedId = res.sourceId || sourceId
  ElMessage.success(`已添加参数源「${name}」：源列表只存 1 条记录，发任务时将展开为 ${(paramEditorRef.value?.totalCount ?? 0).toLocaleString('en-US')} 个 URL`)
  closeAdd()
  await load(true)
  const added = children.value.find((c) => c.sourceId === addedId)
  if (added) emit('added', added)
}

async function submitAdd() {
  if (addDlg.kind === 'param') {
    await submitParamSource()
    return
  }
  if (!addDlg.name.trim()) {
    ElMessage.warning('请填写源名称')
    return
  }
  const sourceId = `${props.siteId}-${Date.now().toString(36)}`
  // 0904 I15（Z8）：URL 空了补占位值，不做前端必填。复制源那条路也走它——
  // copySource 同样会经后端的必填校验。
  const target = { name: addDlg.name.trim(), url: urlOrPlaceholder(addDlg.url, sourceId) }
  let addedId = sourceId
  if (addDlg.templateMode === 'search' && !selectedTemplate.value) {
    ElMessage.warning('请先选择模板源，或切换为空白模板')
    return
  }
  if (selectedTemplate.value) {
    try {
      const copied = await sourceApi.copySourceAndLocate({
        sourceId: selectedTemplate.value.sourceId,
        name: target.name,
        url: target.url,
        flag: 1,
      })
      if (!copied.ok) {
        ElMessage.warning(copied.message)
        return
      }
      const bind = await sourceApi.changeSite([copied.sourceId], props.siteId)
      if (!bind.ok) {
        ElMessage.warning(bind.message || `源已复制（#${copied.sourceId}），但未能关联到当前网站，请用「导入已有源」`)
        return
      }
      addedId = copied.sourceId
      // 第三步（0903 Y8-6）：把新源关联到**被复制源所属的流程**。
      // 前两步走的是旧平台的 copySource?flag=1（「制作源+配置副本」）——它复制的是源和配置，
      // 并不会把新源挂到流程上。而 0903 H01 之后配置是挂在流程上的、执行按 FLOW_ID 反查
      // （H1 答复），所以不补这一步，新源就是一个没有流程的孤儿。
      //
      // **三步递进，任一步失败都不回滚前面的**（Y8-7）：源已经建出来了，回滚等于删源，
      // 风险比留着一个待手工关联的源高得多。所以这里失败只提示、不抛错。
      // 被复制源的 flowId：列表接口（site/sources、sourcePaged）**不保证**带这个字段，
      // 但 sourceDetail 一定带（2026-09-04 实测 430016824 → flowId 1400935）。所以列表上
      // 拿不到就回查一次详情，而不是据此判定"这个源没有流程"——那会让第三步静默跳过。
      let templateFlowId = selectedTemplate.value.flowId
      if (ENABLE_SOURCE_COPY_BIND_FLOW && !templateFlowId) {
        templateFlowId = (await sourceApi.sourceDetail(selectedTemplate.value.sourceId).catch(() => null))?.flowId
      }
      if (!ENABLE_SOURCE_COPY_BIND_FLOW) {
        ElMessage.success(`已复制源「${target.name}」及配置`)
      } else if (!templateFlowId) {
        // sourceDetail/sourcePaged 都已返回 flowId（2026-09-04 实测），缺失只可能是这个源
        // 本来就没关联流程——那就没有可关联的目标，不是错误。
        ElMessage.success(`已复制源「${target.name}」及配置（被复制源未关联流程，新源也未关联）`)
      } else {
        const bound = await flowCenterApi.bindSources([copied.sourceId], templateFlowId)
        if (bound.ok) {
          ElMessage.success(`已复制源「${target.name}」及配置，并关联到流程 #${templateFlowId}`)
        } else {
          ElMessage.warning(
            `源已复制并归入本网站（#${copied.sourceId}），但**未能关联到流程 #${templateFlowId}**`
            + `（${bound.message || '原因未知'}），可在流程中心手动关联`,
          )
        }
      }
    } catch (error) {
      ElMessage.error(`复制源失败：${error instanceof Error ? error.message : String(error)}`)
      return
    }
  } else {
    const res = await siteApi.sourceAdd(
      props.siteId,
      { sourceId, ...target, configId: '', mainTable: '', owner: site.value?.owner || 'admin', state: 'C' },
      false,
    )
    if (!res.ok) return
    addedId = res.sourceId || sourceId
    ElMessage.success(`已添加源「${target.name}」（空白流程，请先编排）`)
  }
  closeAdd()
  await load(true)
  const added = children.value.find((c) => c.sourceId === addedId)
  if (added) emit('added', added)
}

function pickSource(s: Source) {
  emit('pick', s)
}
// —— 发抓取（从旧平台 SourceList 原样迁移）——
// 流程：loadParams → 有参数则弹参数框由用户确认后带参发送；无参数则直接带参发送。
async function sendSnatchForSource(s: Source, queue = '') {
  try {
    const configParam = await sourceApi.loadParams([s.sourceId])
    if (hasLoadParams(configParam)) {
      paramModalRef.value?.showParam(configParam, [s], false, queue)
    } else {
      const res = await sourceApi.sendSnatchWithParam({ ids: [s.sourceId], param: {}, all: 0, include: [], skip: 0, queue: queue || undefined })
      ElMessage.success(res?.message || `已发起「${s.name}」抓取`)
    }
  } catch (error) {
    ElMessage.error(`发起抓取失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

// 发指定队列：先填队列名，再走完整发抓取流程。
async function sendSnatchTestFromMenu() {
  const s = rowMenu.source
  if (!s) return
  closeRowMenu()
  try {
    const { value } = await ElMessageBox.prompt('请输入发送队列名称', '发指定队列', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputPlaceholder: '队列名',
    })
    if (!value?.trim()) return
    await sendSnatchForSource(s, value.trim())
  } catch {
    /* 用户取消 */
  }
}

// 参数弹窗回调：组装好参数后带参发送。
function sendWithParamsCallback(
  ids: string[],
  param: Record<string, string>,
  all: number,
  include: string[],
  skip: number,
  queue: string,
) {
  return sourceApi.sendSnatchWithParam({ ids, param, all, include, skip, queue: queue || undefined })
}

// ---- 批量导入（0812 会议反馈：关联已有源不该另起一个入口，跟"批量导入新源"都是"批量往这个
// 网站加源"，只是加的对象一个是新建一个是已存在，合成一个按钮、弹窗里用 tab 分）----
type BatchTab = 'new' | 'existing'
const batchTab = ref<BatchTab>('new')
function openBatch() {
  importDlg.show = true
  batchTab.value = 'new'
  importDlg.lines = ''
  resetBindState()
}
function closeBatch() {
  importDlg.show = false
}
function switchBatchTab(tab: BatchTab) {
  batchTab.value = tab
  if (tab === 'existing' && !bindDlg.results.length) void loadBindCandidates()
}

// ---- 导入已有源（0812 计划 M4-5，1:1 迁移旧平台 SiteList.vue 的关联源弹窗）：
// 按名称搜索、表格勾选后一次性 changeSite(ids, siteId)；按源 ID 批量导入见下面的 idImport（粘贴
// 即提交，不用先勾选）。跟"新增源" tab 是两回事——那边建的是新源，这里导入的是已经存在、
// 可能属于别的网站甚至没有归属的源。 ----
const bindDlg = reactive({
  keyword: '',
  results: [] as Source[],
  selected: new Set<string>(),
  hideBound: true,
  page: 1,
  total: 0,
  loading: false,
  submitting: false,
})
const BIND_PAGE_SIZE = 20
// 「仅展示未关联」改走服务端 siteIds='-1'（SITE_ID IS NULL），勾选态变化必须重查接口：
// 旧实现是前端把已关联源从当前页里 filter 掉——分页/总数口径全错（total 含已关联源、翻页会
// 跳到别的归属），现在把过滤条件交给 sourcePaged 后端，页码与 total 才是真实口径。
async function loadBindCandidates() {
  bindDlg.loading = true
  try {
    const res = await sourceApi.sourcePaged({
      keyword: bindDlg.keyword.trim() || undefined,
      page: bindDlg.page,
      size: BIND_PAGE_SIZE,
      siteIds: bindDlg.hideBound ? '-1' : undefined,
    })
    bindDlg.results = res.list
    bindDlg.total = res.total
  } finally {
    bindDlg.loading = false
  }
}
// 勾选/取消「仅展示未关联」：过滤条件是服务端生效的，来回切换都要重新查询并回到第一页。
function onHideBoundChange() {
  bindDlg.page = 1
  void loadBindCandidates()
}
function resetBindState() {
  bindDlg.keyword = ''
  bindDlg.results = []
  bindDlg.selected = new Set()
  bindDlg.hideBound = true
  bindDlg.page = 1
  bindDlg.total = 0
  idImport.open = false
  idImport.text = ''
}
function bindSearch() {
  bindDlg.page = 1
  void loadBindCandidates()
}
function toggleBindRow(sourceId: string) {
  const next = new Set(bindDlg.selected)
  if (next.has(sourceId)) next.delete(sourceId)
  else next.add(sourceId)
  bindDlg.selected = next
}
// 已属其他网站的源需要二次确认才能提交（0812 计划 M4-6：显著标记 + 二次确认，不硬拦——按旧平台
// 行为，勾选后依然能提交，只是要让用户明确知道这会把源从原网站挪走）。已属本站/未关联的不用额外确认，
// 不给"每次都要点一下确认"的无意义摩擦。名称搜索/源ID 两条路径共用这一个确认逻辑。
async function confirmCrossSiteIfNeeded(candidates: Source[]): Promise<boolean> {
  const crossSite = candidates.filter((s) => s.siteId && s.siteId !== props.siteId)
  if (!crossSite.length) return true
  const names = crossSite.map((s) => `「${s.name}」（当前属于${s.siteName || s.siteId}）`).join('、')
  try {
    await ElMessageBox.confirm(
      `本次共导入 ${candidates.length} 个源到「${site.value?.name ?? '当前网站'}」，其中 ${crossSite.length} 个当前已属于其他网站，导入后会改为属于本网站：${names}。是否继续？`,
      '确认导入',
      { type: 'warning', confirmButtonText: '确认导入', cancelButtonText: '取消' },
    )
    return true
  } catch {
    return false
  }
}
async function submitBind() {
  if (!bindDlg.selected.size) return
  const selected = bindDlg.results.filter((s) => bindDlg.selected.has(s.sourceId))
  if (!(await confirmCrossSiteIfNeeded(selected))) return
  bindDlg.submitting = true
  try {
    const res = await sourceApi.changeSite([...bindDlg.selected], props.siteId)
    if (!res?.ok) {
      ElMessage.warning(res?.message || '导入失败，请重试')
      return
    }
    ElMessage.success(res.message || `已导入 ${bindDlg.selected.size} 个源到「${site.value?.name ?? '当前网站'}」`)
    closeBatch()
    await load(true)
    // 主区的源列表是兄弟组件，不广播它不会重查（见 ui.sourceListRevision）
    ui.notifySourceListChanged()
  } finally {
    bindDlg.submitting = false
  }
}

// 按源ID批量导入（0812 会议反馈：不是"检索后手动勾选再点确认"，是粘贴一批源 ID 直接提交——
// ID 本身就是选择，不需要再在表格里勾一遍）。仍然过一遍跨网站二次确认，只是不需要先进表格预览。
const idImport = reactive({ open: false, text: '', loading: false })
function toggleIdImport() {
  idImport.open = !idImport.open
}
async function submitByIds() {
  const ids = [...new Set(idImport.text.split(/[,，\n\s]+/).map((id) => id.trim()).filter(Boolean))]
  if (!ids.length) {
    ElMessage.warning('请输入源 ID')
    return
  }
  idImport.loading = true
  try {
    const res = await sourceApi.sourcePaged({ sourceIds: ids, page: 1, size: ids.length })
    const found = res.list
    const missing = ids.filter((id) => !found.some((s) => s.sourceId === id))
    if (!found.length) {
      ElMessage.warning(`未找到匹配的源：${missing.join('、')}`)
      return
    }
    if (!(await confirmCrossSiteIfNeeded(found))) return

    // 确认后立即关弹窗，导入在后台跑：大批量会分片、耗时几分钟，用一条常驻通知显示进度。
    const total = found.length
    idImport.text = ''
    idImport.open = false
    closeBatch()
    // 进度文案分两种（2026-09-18 修）：
    //
    // `changeSite` 只有**超过 CHANGE_SITE_CHUNK 才分片**，否则一次请求把整批发出去，
    // 服务端不回报中间进度 —— onProgress 要等请求返回才被调用一次，而那时通知已经关了。
    // 于是导 100 个源全程只能看到「已导入 0 / 100」一动不动，看着像卡死（用户实测反馈）。
    // 不分片时就别假装有逐条进度，老实说"正在导入，需要一会儿"，配一个转圈表示还活着。
    //
    // 分片时的计数也从「已导入」改成「已提交」：onProgress 累计的是**已提交的片**
    // （含失败与未确认的），不是确认落库的条数。
    const chunked = total > CHANGE_SITE_CHUNK
    const progress = ref(0)
    const progressNote = ElNotification({
      title: '批量导入进行中',
      message: h(() => h('span', { style: 'display:inline-flex;align-items:center;gap:6px' }, [
        h('span', {
          style: 'display:inline-block;width:10px;height:10px;border:1.5px solid currentColor;'
            + 'border-top-color:transparent;border-radius:50%;animation:rc-imp-spin .7s linear infinite',
        }),
        h('span', importProgressText(progress.value, total, chunked)),
      ])),
      duration: 0,
      showClose: false,
      type: 'info',
    })
    let submitRes: Awaited<ReturnType<typeof sourceApi.changeSite>>
    try {
      submitRes = await sourceApi.changeSite(
        found.map((s) => s.sourceId),
        props.siteId,
        (done) => { progress.value = done },
      )
    } finally {
      progressNote.close()
    }
    await load(true)
    ui.notifySourceListChanged()

    // 成功文案用自己的，不透传后端那句「批量更改网站成功」——这里的语义是"把源导进网站"，
    // 不是"更改网站"，而且用户更关心导了几个。失败时才用后端原话，它有诊断价值。
    let msg = `已导入 ${total} 个源到「${site.value?.name ?? '当前网站'}」`
    if (missing.length) msg += `；${missing.length} 个源 ID 未找到：${missing.join('、')}`
    if (submitRes.ok) {
      // **成功的自动关**（2026-09-18 用户提：「这类提醒自动关闭，不需要手动点击」）。
      // 前一版为了防"回头没看见"改成了常驻，结果导几次就堆一摞要手动点掉的卡片。
      // 那个顾虑现在不成立了：同一批还修了「导入后主区列表不刷新」，
      // 结果直接反映在列表上，不必靠通知留着。
      // 失败仍然常驻——那是需要用户接着处理的事，不能自己溜走。
      ElNotification.success({ title: '批量导入完成', message: msg, duration: 5000 })
    } else {
      ElNotification.warning({ title: '批量导入部分失败', message: submitRes.message || msg, duration: 0 })
    }
  } catch (e) {
    // 请求被网关拒（如 URL 过长的 431/414）或后端 5xx 时，changeSite/sourcePaged 会抛出，
    // 之前没有 catch，异常静默冒泡，界面看着像"点了没反应"。
    ElMessage.error(`导入失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    idImport.loading = false
  }
}

// ---- 批量导入·新增源 tab（0711 R12：从采集资产页顶部迁入，siteId 已定，无需目标网站下拉） ----
const importDlg = reactive({ show: false, lines: '' })
async function submitImport() {
  if (!importDlg.lines.trim()) {
    ElMessage.warning('请填写源清单，一行一条「名称;URL」')
    return
  }
  const res = await siteApi.siteImportSources(props.siteId, importDlg.lines)
  if (!res?.ok) {
    ElMessage.warning(res?.message || '导入失败，请检查行格式')
    return
  }
  ElMessage.success(res?.message || '批量导入已提交（演示）')
  closeBatch()
  await load(true)
}

// 回车触发，但跳过中文输入法上屏时的 Enter（见 utils/enterKey.ts）
const onEnterBindSearch = withoutComposition(() => bindSearch())
</script>

<template>
  <aside class="ssw-side" :class="{ collapsed }">
    <template v-if="!collapsed">
      <div class="ssw-head">
        <button
          class="ssw-site"
          :class="{ active: !activeKey }"
          type="button"
          title="网站详情：源/数据/文件汇总（全部源）；右键可重命名"
          @click="emit('pickSite')"
          @contextmenu.prevent.stop="openSiteMenu($event)"
        >
          <span class="ssw-site-ico">🌐</span>
          <span class="ssw-site-name">{{ site?.name || '网站详情' }}</span>
        </button>
        <button class="ssw-collapse" type="button" title="收起侧栏" @click="collapsed = true">«</button>
      </div>
      <!-- 源 / 数据表切换（0924-10）：只在网站态的数据视图出现；切到别的视图左栏回到源列表，模式记着，切回来还原 -->
      <div v-if="allowTableMode" class="ssw-mode" role="tablist" data-testid="sidebar-mode">
        <button
          type="button"
          role="tab"
          class="ssw-mode-btn"
          :class="{ on: !tableMode }"
          :aria-selected="!tableMode"
          data-testid="sidebar-mode-source"
          @click="ui.setSiteDataSideMode('source')"
        >源</button>
        <button
          type="button"
          role="tab"
          class="ssw-mode-btn"
          :class="{ on: tableMode }"
          :aria-selected="tableMode"
          data-testid="sidebar-mode-table"
          @click="ui.setSiteDataSideMode('table')"
        >数据表</button>
      </div>
      <SiteTablePanel
        v-if="tableMode"
        :site-id="siteId"
        :active-table-id="activeTableId ?? ''"
        :preferred-table-id="preferredTableId"
        @pick="(t) => emit('pickTable', t)"
      />
      <template v-else>
      <div class="ssw-section-toggle" @click="listExpanded = !listExpanded">
        <span class="ssw-section-title">源列表 ({{ listCountLabel }})</span>
        <span class="ssw-section-icon">{{ listExpanded ? '▼' : '▶' }}</span>
      </div>
      <template v-if="listExpanded">
        <!-- 反查命中态（2026-09-09）：列表已收窄到条件命中的源，给一条明确的出口，
             否则用户会以为侧栏坏了——6496 个源突然只剩十几个。 -->
        <div v-if="hits.length" class="ssw-hit-bar" data-testid="sidebar-backtrace-bar">
          <span class="ssw-hit-text">命中 {{ hits.length }} 个源</span>
          <!-- 导出与 ✕ 归在一处：两者都是"对这批命中源的操作"。
               图标按钮沿用流程中心 .fc-icon-btn 的样式（无边框、hover 才出底色），
               文字按钮在 200px 的侧栏里会把这一条挤到折行（2026-09-11 实测三位数就折）。
               导的是**眼前这份列表**（含搜索过滤），与标题上的数字一致，所见即所得。 -->
          <button
            class="ssw-icon-btn"
            type="button"
            data-testid="sidebar-hit-export"
            :title="`导出当前列表的 ${filtered.length} 个源（CSV：源 ID / 源名称 / 命中条数）`"
            aria-label="导出命中的源"
            @click="exportHits()"
          ><el-icon><Download /></el-icon></button>
          <button
            class="ssw-icon-btn"
            type="button"
            data-testid="sidebar-hit-clear"
            title="恢复显示全部源"
            aria-label="恢复显示全部源"
            @click="ws.clearBackTraceHits()"
          ><el-icon><Close /></el-icon></button>
        </div>
        <input v-model="kw" class="ssw-search" :placeholder="hits.length ? '在命中的源里搜索' : '搜索源'" />
        <div class="ssw-list" @scroll.passive="onListScroll">
          <div v-if="!kw && !hits.length" class="ssw-row" :class="{ active: !activeKey }">
            <button
              class="ssw-row-all-btn"
              type="button"
              title="全部（不根据源 ID 过滤）"
              @click="emit('pickSite')"
            >
              <span class="ssw-dot all" />
              <div class="ssw-row-text">
                <div class="ssw-row-head">
                  <span class="ssw-row-name">全部</span>
                </div>
                <div class="ssw-row-id">不根据源 ID 过滤</div>
              </div>
            </button>
          </div>
          <div v-for="c in visibleRows" :key="c.sourceId" class="ssw-row" :class="{ active: activeKey === c.sourceId }">
            <template v-if="rename.sourceId === c.sourceId">
              <input
                v-model="rename.name"
                class="ssw-rename-input"
                data-testid="source-rename-input"
                autofocus
                @click.stop
                @keydown.enter.prevent="saveRename(c)"
                @keydown.esc.prevent="cancelRename"
                @blur="saveRename(c)"
              />
            </template>
            <button
              v-else
              class="ssw-row-main"
              type="button"
              :title="`${c.name} · ${c.sourceId}`"
              @click="pickSource(c)"
              @dblclick.stop="startRename(c)"
              @contextmenu.prevent.stop="openRowMenu($event, c)"
            >
              <span class="ssw-dot" :class="{ err: isErr(c), muted: c.disabled }" />
              <div class="ssw-row-text">
                <div class="ssw-row-head">
                  <span class="ssw-row-name">{{ c.name }}</span>
                  <span v-if="c.kind === 'param'" class="ssw-kind-tag" title="参数源：发任务时展开为多个 URL">参数源</span>
                </div>
                <div class="ssw-row-id">{{ c.sourceId }}</div>
              </div>
              <span
                v-if="hitCountBy.get(c.sourceId)"
                class="ssw-hit-count"
                data-testid="sidebar-hit-count"
                :title="`该源命中 ${hitCountBy.get(c.sourceId)} 条`"
              >{{ hitCountBy.get(c.sourceId) }}</span>
            </button>
            <button
              v-if="canCompare && c.sourceId !== activeKey"
              class="ssw-row-cmp"
              type="button"
              title="与当前源并排对比"
              @click.stop="emit('compare', c.sourceId)"
            >⇔</button>
          </div>
          <div v-if="listLoadFailed" class="ssw-empty ssw-load-failed" data-testid="ssw-load-failed">
            源列表加载失败<button type="button" class="ssw-retry" data-testid="ssw-retry" @click="load()">重试</button>
          </div>
          <div v-else-if="!filtered.length" class="ssw-empty">{{ kw ? '没有匹配的源' : (hits.length ? '命中的源不在当前列表里' : '该网站暂无源') }}</div>
          <div v-else-if="visibleRows.length < filtered.length" class="ssw-more-hint">
            已显示 {{ visibleRows.length }} / {{ filtered.length }}，向下滚动加载更多
          </div>
          <div v-else-if="childrenHydrating" class="ssw-more-hint">已显示首批 {{ children.length }} 个源，正在后台加载完整列表…</div>
        </div>
      </template>

      <!-- 选中源详情分割栏：点击源后完整展示源名称和源 ID -->
      <div v-if="activeSource" class="ssw-section-toggle ssw-detail-header" @click="detailExpanded = !detailExpanded">
        <span class="ssw-section-title">源详情</span>
        <span class="ssw-detail-head-right">
          <button
            class="ssw-copy-btn"
            type="button"
            data-testid="edit-source"
            title="编辑源名称和源 URL"
            @click.stop="editSourceOpen = true"
          >编辑</button>
          <span class="ssw-section-icon">{{ detailExpanded ? '▼' : '▶' }}</span>
        </span>
      </div>
      <div v-if="activeSource && detailExpanded" class="ssw-active-detail" data-testid="active-source-detail">
        <div class="ssw-detail-field">
          <span class="ssw-detail-label">源名称</span>
          <div class="ssw-detail-val name" data-testid="active-source-full-name">{{ activeSource.name }}</div>
        </div>
        <div class="ssw-detail-field">
          <span class="ssw-detail-label">源 ID</span>
          <div class="ssw-detail-val with-copy">
            <code data-testid="active-source-full-id">{{ activeSource.sourceId }}</code>
            <button class="ssw-copy-btn" type="button" title="复制源 ID" @click="copyId(activeSource.sourceId)">复制</button>
          </div>
        </div>
        <div class="ssw-detail-field">
          <span class="ssw-detail-label">源 URL</span>
          <div class="ssw-detail-val with-copy">
            <!-- 三行封顶后全文靠悬浮看，所以用 el-tooltip 而不是原生 title（原生要等约 1 秒、
                 长 URL 还会被拉成横穿屏幕的一条，见 tokens.css 的 .rc-tip-longtext）。 -->
            <el-tooltip
              v-if="sourceDisplayUrl(activeSource)"
              :content="sourceDisplayUrl(activeSource)"
              placement="top-start"
              :show-after="120"
              popper-class="rc-tip-longtext"
            >
              <a
                v-if="sourceOpenUrl(activeSource)"
                class="ssw-detail-url ssw-detail-link"
                :href="sourceOpenUrl(activeSource)"
                target="_blank"
                rel="noopener noreferrer"
                data-testid="active-source-url"
              >{{ sourceDisplayUrl(activeSource) }}</a>
              <span v-else class="ssw-detail-url" data-testid="active-source-url">{{ sourceDisplayUrl(activeSource) }}</span>
            </el-tooltip>
            <span v-else class="ssw-detail-url" data-testid="active-source-url">—</span>
            <button
              class="ssw-copy-btn"
              type="button"
              data-testid="copy-source-url"
              title="复制源 URL"
              :disabled="!sourceDisplayUrl(activeSource)"
              @click="copySourceUrl(activeSource)"
            >复制</button>
          </div>
        </div>
      </div>
      <div class="ssw-foot">
        <button class="ssw-foot-btn" type="button" title="添加源" @click="openAdd">＋ 添加源</button>
        <button
          class="ssw-foot-btn"
          type="button"
          :disabled="!canCompare"
          :title="canCompare ? '选择任意网站的源并排对比' : '请先切到具体源再对比'"
          @click.stop="openComparePicker"
        >⇔ 对比</button>
      </div>
      <div class="ssw-foot">
        <button class="ssw-foot-btn" type="button" title="批量新增源，或把已存在的源关联到这个网站" data-testid="open-batch" @click.stop="openBatch">批量导入</button>
      </div>
      </template>
    </template>
    <button v-else class="ssw-expand" type="button" title="展开源侧栏" @click="collapsed = false">»</button>
  </aside>

  <EditSourceDialog v-model:open="editSourceOpen" :source="activeSource" @saved="applyEditedSource" />

  <!-- 全局对比选择器（B4）：默认列本站其他源，输入即全局搜索（含跨站） -->
  <div v-if="cmp.show" class="ssw-cmp-pop" @click.stop>
    <div class="ssw-cmp-title">选择对比对象（与当前源并排）</div>
    <input v-model="cmp.kw" class="ssw-search" placeholder="搜索全部网站的源" autofocus @input="onCompareKwInput" />
    <div class="ssw-cmp-list">
      <div v-if="cmp.loading" class="ssw-empty">搜索中…</div>
      <template v-else>
        <button v-for="s in cmp.results" :key="s.sourceId" type="button" class="ssw-cmp-item" @click="pickCompare(s)">
          <span class="ssw-dot" :class="{ err: isErr(s) }" />
          <span class="ssw-cmp-name">{{ s.name }}</span>
          <span class="ssw-cmp-id">{{ s.sourceId }}</span>
        </button>
        <div v-if="!cmp.results.length" class="ssw-empty">没有匹配的源</div>
      </template>
    </div>
  </div>

  <div
    v-if="rowMenu.show && rowMenu.source"
    class="ssw-row-menu"
    :style="{ left: `${rowMenu.x}px`, top: `${rowMenu.y}px` }"
    @click.stop
  >
    <button type="button" @click="startRename(rowMenu.source!)">重命名</button>
    <button
      type="button"
      data-testid="source-menu-launch"
      :disabled="rowMenu.source.disabled"
      @click="launchFromMenu"
    >发起抓取</button>
    <button type="button" data-testid="source-menu-snatch-queue" @click="sendSnatchTestFromMenu">发指定队列</button>
    <button type="button" data-testid="source-menu-move" @click="openMoveDialog(rowMenu.source!)">更换网站…</button>
    <button type="button" class="danger" data-testid="source-menu-delete" @click="deleteFromMenu">删除源</button>
  </div>

  <!-- 网站右键菜单：重命名 -->
  <div
    v-if="siteMenu.show"
    class="ssw-row-menu"
    :style="{ left: `${siteMenu.x}px`, top: `${siteMenu.y}px` }"
    @click.stop
  >
    <button type="button" data-testid="site-menu-rename" @click="openSiteEdit">编辑网站信息</button>
  </div>

  <SiteEditorDialog
    v-if="siteEditDlg.show"
    v-model:visible="siteEditDlg.show"
    :site="site"
    :categories="siteCategories"
    @saved="onSiteEditSaved"
  />

  <!-- 更换网站：一个源只属于一个网站，这是搬移不是新增关联 -->
  <div v-if="moveDlg.show" class="ssw-add-backdrop" @click.self="closeMoveDialog">
    <div class="ssw-add-card" @click.stop>
      <div class="ssw-add-header"><b>更换网站</b></div>
      <div class="ssw-move-body">
        <p class="ssw-move-src">源「{{ moveDlg.source?.name }}」（ID {{ moveDlg.source?.sourceId }}）</p>
        <!-- 当前所属网站（0828 W5-9）：换绑是「搬走」，得先让用户看清是从哪儿搬 -->
        <p class="ssw-move-from" data-testid="move-from-site">当前所属：{{ currentSiteLabel }}</p>
        <label class="ssw-move-label">移动到网站</label>
        <!-- 可搜索（0828 W5-1）：会上「你这三个多的话怎么办？你这下拉框拉拉拉粉上」——
             原生 select 在网站多了之后只能滚动找，换成可按名称/ID 过滤的下拉 -->
        <el-select
          v-model="moveDlg.targetSiteId"
          filterable
          placeholder="请选择目标网站（可输入名称或 ID 过滤）"
          data-testid="move-site-select"
          style="width: 100%"
        >
          <el-option
            v-for="s in moveTargets"
            :key="s.siteId"
            :label="`${s.name}（ID ${s.siteId}）`"
            :value="String(s.siteId)"
          />
        </el-select>
        <p class="ssw-move-warn">一个源只能属于一个网站：移动后本网站将不再包含该源。</p>
      </div>
      <div class="ssw-add-footer">
        <button class="rc-btn" type="button" @click="closeMoveDialog">取消</button>
        <button
          class="rc-btn primary"
          type="button"
          data-testid="move-site-submit"
          :disabled="!moveDlg.targetSiteId || moveDlg.saving"
          @click="submitMove"
        >{{ moveDlg.saving ? '处理中…' : '确认' }}</button>
      </div>
    </div>
  </div>

  <SourceParamModal ref="paramModalRef" :callback="sendWithParamsCallback" @refresh="load" />

  <div v-if="addDlg.show" class="ssw-add-backdrop" @click.self="closeAdd">
    <div class="ssw-add-card" :class="{ wide: addDlg.kind === 'param' }" @click.stop="paramEditorRef?.closePicker()">
      <div class="ssw-add-header">
        <div class="ssw-add-title">添加源</div>
      </div>

      <div class="ssw-field-label">源类型</div>
      <div class="ssw-kind-seg" data-testid="source-kind-seg">
        <button type="button" :class="{ active: addDlg.kind === 'normal' }" @click="switchKind('normal')">
          <strong>普通源</strong><small>手工填写名称 + URL</small>
        </button>
        <button type="button" :class="{ active: addDlg.kind === 'param' }" data-testid="source-kind-param" @click="switchKind('param')">
          <strong>参数源</strong><small>URL 模板 + 参数，按规律生成</small>
        </button>
      </div>

      <template v-if="addDlg.kind === 'normal'">
        <label class="ssw-field-label">源名称 <em>*</em></label>
        <input v-model="addDlg.name" class="ssw-add-input" placeholder="请输入源名称" />
        <label class="ssw-field-label">源 URL <span>（可选）</span></label>
        <input v-model="addDlg.url" class="ssw-add-input" placeholder="请输入源 URL" />
        <label class="ssw-field-label">复制流程</label>
        <select v-model="addDlg.templateMode" class="ssw-add-input" data-testid="source-template-mode" @change="onTemplateModeChange">
          <option v-if="defaultTemplate" value="default">默认：本网站第一个源的流程（{{ defaultTemplate.name }}）</option>
          <option value="search">搜索并选择全部源</option>
          <option value="blank">空白模板</option>
        </select>
        <div v-if="addDlg.templateMode === 'search'" class="ssw-template-combobox" @click.stop>
          <input
            v-model="templateSearch.keyword"
            class="ssw-add-input"
            data-testid="source-template-search"
            placeholder="搜索并选择全部源（名称或 ID）"
            @focus="templateSearch.open = !!templateSearch.keyword.trim()"
            @input="searchTemplateSources"
          />
          <div v-if="templateSearch.open" class="ssw-template-options">
            <span v-if="templateSearch.loading" class="ssw-template-empty">搜索源中…</span>
            <span v-else-if="!templateSearch.results.length" class="ssw-template-empty">未找到匹配源</span>
            <button
              v-for="source in templateSearch.results"
              v-else
              :key="source.sourceId"
              type="button"
              data-testid="source-template-option"
              @click="selectTemplateSource(source)"
            >
              <div class="ssw-template-text">
                <span class="ssw-template-label">{{ source.name }}</span>
                <span class="ssw-template-id">{{ source.sourceId }}</span>
              </div>
            </button>
          </div>
        </div>
        <div class="ssw-add-hint">
          <!-- 界面上不出现旧平台的按钮名（「制作源+配置副本」）：用户看的是这个平台。
               实现上走的确实是旧平台那条 copySource?flag=1，记在 submitAdd 的注释里。 -->
          {{ selectedTemplate
            ? `将复制「${selectedTemplate.name}」的流程（含其配置）到当前网站，并把新源关联到该流程；不复制表数据与运行记录。`
            : '仅创建名称和 URL，流程从空白画布开始。' }}
        </div>
      </template>

      <template v-else>
        <label class="ssw-field-label">源名称 <em>*</em></label>
        <input v-model="addDlg.name" class="ssw-add-input" placeholder="请输入源名称" />
        <ParamSourceEditor ref="paramEditorRef" v-model="paramSrc" />
      </template>

      <div class="ssw-add-actions">
        <button class="rc-btn" type="button" @click="closeAdd">取消</button>
        <button class="rc-btn primary" type="button" data-testid="add-source-submit" @click="submitAdd">添加并进入编排</button>
      </div>
    </div>
  </div>

  <!-- 批量导入弹窗（0812 会议反馈：新增源和关联已有源都是"批量往这个网站加源"，只是加的对象
       一个是新建一个是已存在，合成一个入口、弹窗里用 tab 分，不再是两个独立按钮） -->
  <div v-if="importDlg.show" class="ssw-add-backdrop" @click.self="closeBatch">
    <div class="ssw-add-card" :class="{ bind: batchTab === 'existing' }" @click.stop>
      <div class="ssw-add-header">
        <div class="ssw-add-title">批量导入 · {{ site?.name || '当前网站' }}</div>
      </div>
      <div class="ssw-bind-toolbar batch-tabs">
        <button type="button" class="ssw-batch-tab" :class="{ active: batchTab === 'new' }" data-testid="batch-tab-new" @click="switchBatchTab('new')">新增源</button>
        <button type="button" class="ssw-batch-tab" :class="{ active: batchTab === 'existing' }" data-testid="batch-tab-existing" @click="switchBatchTab('existing')">导入已有源</button>
      </div>

      <template v-if="batchTab === 'new'">
        <textarea
          v-model="importDlg.lines"
          class="ssw-import-textarea"
          rows="6"
          placeholder="一行一条，格式：源名称;URL（URL 可省略）&#10;波兰语公告;https://example.com/notice?lang=pl&#10;瑞典语公告;https://example.com/notice?lang=sv"
        />
        <div class="ssw-add-hint">导入的源均从空白流程开始，空行跳过</div>
        <div class="ssw-add-actions">
          <button class="rc-btn" type="button" @click="closeBatch">取消</button>
          <button class="rc-btn primary" type="button" data-testid="batch-import-submit" @click="submitImport">导入</button>
        </div>
      </template>

      <!-- 导入已有源（0812 计划 M4-5，1:1 迁移旧平台 SiteList.vue 的关联源）：跟"新增源" tab 是两回事——
           那边建的是新源，这里导入的是已经存在的源，可能属于别的网站（要显著提示），也可能压根没归属过。
           两条路径：按名称搜索+表格勾选（下面这块），或者按源ID批量导入（粘贴即提交，不用先勾选）。 -->
      <template v-else>
        <div class="ssw-bind-toolbar">
          <input
            v-model="bindDlg.keyword"
            class="ssw-add-input bind-kw"
            placeholder="按源名称搜索"
            data-testid="bind-source-search"
            @keyup.enter="onEnterBindSearch"
          />
          <button class="rc-btn" type="button" @click="bindSearch">搜索</button>
          <button class="rc-btn" type="button" data-testid="id-import-toggle" @click="toggleIdImport">
            {{ idImport.open ? '收起按源ID批量导入' : '按源ID批量导入' }}
          </button>
          <label class="ssw-bind-hide">
            <input v-model="bindDlg.hideBound" type="checkbox" data-testid="bind-hide-bound" @change="onHideBoundChange" />
            仅展示未关联
          </label>
          <span class="ssw-bind-selected">已选 {{ bindDlg.selected.size }}</span>
        </div>

        <!-- 按源ID批量导入：粘贴一批源 ID 直接提交，ID 本身就是选择，不用先在下面表格里勾一遍
             （0812 会议反馈：不是"检索后手动勾选"）。仍会先查一遍归属，跨网站的照样弹二次确认。 -->
        <div v-if="idImport.open" class="ssw-bind-batch">
          <textarea
            v-model="idImport.text"
            class="ssw-import-textarea"
            rows="3"
            placeholder="输入源 ID，逗号或换行分隔，提交后直接导入到当前网站"
            data-testid="id-import-textarea"
          />
          <button class="rc-btn primary" type="button" :disabled="idImport.loading" data-testid="id-import-submit" @click="submitByIds">
            {{ idImport.loading ? '导入中…' : '批量导入' }}
          </button>
        </div>

        <div class="ssw-bind-table-wrap" v-loading="bindDlg.loading">
          <table class="rc-data-table ssw-bind-table" data-testid="bind-source-table">
            <thead><tr><th style="width:32px"></th><th>源ID</th><th>源名称</th><th>当前归属</th></tr></thead>
            <tbody>
              <tr v-for="s in bindDlg.results" :key="s.sourceId" @click="toggleBindRow(s.sourceId)">
                <td @click.stop><input type="checkbox" :checked="bindDlg.selected.has(s.sourceId)" @change="toggleBindRow(s.sourceId)" /></td>
                <td class="mono">{{ s.sourceId }}</td>
                <td>{{ s.name }}</td>
                <td>
                  <span v-if="!s.siteId" class="ssw-bind-unbound">未关联</span>
                  <span v-else-if="s.siteId === props.siteId" class="ssw-bind-current">已属本站</span>
                  <span v-else class="ssw-bind-other" :title="'已关联到其它网站，勾选并提交会改为关联到 ' + (site?.name || '当前网站')">已属其他网站{{ s.siteName ? `「${s.siteName}」` : '' }}</span>
                </td>
              </tr>
              <tr v-if="!bindDlg.loading && !bindDlg.results.length"><td colspan="4" class="ssw-empty">没有匹配的源</td></tr>
            </tbody>
          </table>
        </div>
        <!-- 分页与数据中心统一（DataQueryPanel 的 .dqp-pager 同款 el-pagination）。
             弹窗里宽度有限，layout 去掉 sizes/jumper 只留翻页；页大小固定 BIND_PAGE_SIZE。 -->
        <div class="ssw-bind-pager">
          <el-pagination
            data-testid="bind-pagination"
            v-model:current-page="bindDlg.page"
            :page-size="BIND_PAGE_SIZE"
            :total="bindDlg.total"
            layout="total, prev, pager, next"
            background
            small
            :disabled="bindDlg.loading"
            @current-change="loadBindCandidates"
          />
        </div>

        <div class="ssw-add-hint">勾选源后点击"确认导入"即可批量导入到当前网站。</div>
        <div class="ssw-add-actions">
          <button class="rc-btn" type="button" @click="closeBatch">取消</button>
          <button
            class="rc-btn primary"
            type="button"
            data-testid="bind-source-submit"
            :disabled="!bindDlg.selected.size || bindDlg.submitting"
            @click="submitBind"
          >{{ bindDlg.submitting ? '提交中…' : '确认导入' }}</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ssw-side {
  flex: none;
  width: 200px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #fbfdff;
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius);
  overflow: hidden;
}
.ssw-side.collapsed { width: 30px; align-items: center; justify-content: flex-start; padding-top: 8px; background: #fff; }
.ssw-expand { border: 0; background: transparent; color: var(--rc-muted); font-size: 14px; cursor: pointer; width: 24px; height: 24px; border-radius: 5px; }
.ssw-expand:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }

.ssw-head { display: flex; align-items: center; gap: 4px; padding: 8px 8px 0; }
.ssw-site {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--rc-border);
  border-radius: 7px;
  background: #fff;
  color: var(--rc-text-2);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.ssw-site:hover { border-color: #93c5fd; color: var(--rc-primary-ink); }
.ssw-site.active { border-color: var(--rc-primary); background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.ssw-site-ico { flex: none; }
.ssw-site-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ssw-collapse { flex: none; border: 0; background: transparent; color: var(--rc-faint); font-size: 13px; cursor: pointer; width: 20px; height: 24px; border-radius: 5px; }
.ssw-collapse:hover { background: #f1f5f9; color: var(--rc-text); }

.ssw-hit-bar { display: flex; align-items: center; gap: 6px; margin: 0 8px 6px; padding: 5px 8px; border: 1px solid #bfdbfe; border-radius: 6px; background: var(--rc-primary-bg); }
/* 文字挤不下时省略，**不许折行**：折了会把整条顶成两行，右边两个按钮跟着错位
   （2026-09-11 实测，源数是三位数时就会发生）。按钮 flex:none 固定，让位的永远是文字。 */
.ssw-hit-text { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--rc-primary-ink); font-size: 11px; font-weight: 600; }
/* 与流程中心 .fc-icon-btn 同一套：24px 见方、无边框、hover 才出底色。
   侧栏只有 200px，两个文字按钮会把命中条挤到折行。 */
.ssw-icon-btn { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--rc-primary-ink); cursor: pointer; }
.ssw-icon-btn :deep(svg) { width: 14px; height: 14px; }
.ssw-icon-btn:hover { background: #fff; color: var(--rc-primary); }
.ssw-icon-btn:focus-visible { outline: 2px solid var(--rc-primary); outline-offset: 1px; }
/* 命中条数：跟在源名右侧，数字越大越靠前（列表已按它排序），一眼看出先查谁 */
.ssw-hit-count { flex: none; margin-left: 6px; padding: 1px 6px; border-radius: 9px; background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-size: 10px; font-weight: 700; font-family: var(--rc-mono, monospace); }
.ssw-mode { flex: none; display: flex; gap: 2px; margin: 8px 8px 0; padding: 2px; border: 1px solid var(--rc-border); border-radius: 7px; background: #f1f5f9; }
.ssw-mode-btn { flex: 1; height: 24px; border: 0; border-radius: 5px; background: transparent; color: var(--rc-muted); font-size: 12px; font-weight: 600; cursor: pointer; }
.ssw-mode-btn:hover { color: var(--rc-text); }
.ssw-mode-btn.on { background: #fff; color: var(--rc-primary-ink); box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08); }
.ssw-search {
  flex: none;
  height: 28px;
  margin: 8px 8px 6px;
  padding: 0 9px;
  border: 1px solid var(--rc-border);
  border-radius: 7px;
  font-size: 12px;
  outline: none;
  background: #fff;
}
.ssw-search:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }

.ssw-list { flex: 1; overflow-y: auto; padding: 0 6px 6px; scrollbar-width: thin; }
.ssw-row { display: flex; align-items: center; border-radius: 7px; }

.ssw-row:hover { background: var(--rc-primary-bg); }
.ssw-row.active { background: var(--rc-primary); }
.ssw-row-main,
.ssw-row-all-btn {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 0;
  background: transparent;
  /* 0828 W5-3：会上反馈「字体有点小」——源名提到 13px，行内边距放宽 */
  padding: 8px 8px;
  font-size: 13px;
  color: var(--rc-text-2);
  cursor: pointer;
  text-align: left;
}
.ssw-rename-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  margin: 2px 4px;
  padding: 0 7px;
  border: 1px solid #60a5fa;
  border-radius: 5px;
  outline: none;
  font-size: 12px;
  color: var(--rc-text);
}
.ssw-row:hover .ssw-row-main,
.ssw-row:hover .ssw-row-all-btn { color: var(--rc-primary-ink); }
.ssw-row.active .ssw-row-main,
.ssw-row.active .ssw-row-all-btn { color: #fff; font-weight: 700; }
.ssw-row-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ssw-row-head { display: flex; align-items: center; gap: 4px; min-width: 0; }
.ssw-row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.4; }
.ssw-row-id { font-size: 11px; opacity: 0.6; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.2; margin-top: 1px; }
.ssw-row.active .ssw-row-id { opacity: 0.85; }
.ssw-kind-tag { flex: none; font-size: 9px; font-weight: 700; color: var(--rc-primary-ink); background: var(--rc-primary-bg); border: 1px solid #bfdbfe; border-radius: 3px; padding: 0 4px; line-height: 14px; }
.ssw-row.active .ssw-kind-tag { color: #fff; background: rgba(255, 255, 255, 0.2); border-color: rgba(255, 255, 255, 0.4); }
.ssw-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--rc-ok); }
.ssw-dot.all { background: #3b82f6; }
.ssw-dot.err { background: var(--rc-error); }
.ssw-dot.muted { background: var(--rc-faint); }
.ssw-row-cmp {
  flex: none;
  border: 0;
  background: transparent;
  color: var(--rc-muted);
  font-size: 12px;
  width: 22px;
  height: 22px;
  margin-right: 4px;
  border-radius: 5px;
  cursor: pointer;
  visibility: hidden;
}
.ssw-row:hover .ssw-row-cmp { visibility: visible; }
.ssw-row-cmp:hover { background: #fff; color: var(--rc-primary); }
.ssw-empty { padding: 14px 8px; text-align: center; font-size: 11px; color: var(--rc-faint); }
.ssw-load-failed { color: var(--rc-danger, #dc2626); }
.ssw-retry { margin-left: 6px; padding: 0; border: 0; background: transparent; color: var(--rc-primary); font-size: 11px; cursor: pointer; }
.ssw-retry:hover { text-decoration: underline; }
.ssw-more-hint { padding: 8px; text-align: center; font-size: 11px; color: var(--rc-faint); }

.ssw-foot { flex: none; display: flex; gap: 6px; padding: 6px 8px 8px; border-top: 1px solid var(--rc-border-soft); }
.ssw-foot-btn {
  flex: 1;
  height: 26px;
  border: 1px dashed var(--rc-border);
  border-radius: 7px;
  background: transparent;
  color: var(--rc-muted);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}
.ssw-foot-btn:hover:not(:disabled) { border-color: var(--rc-primary); color: var(--rc-primary-ink); }
.ssw-foot-btn:disabled { cursor: not-allowed; opacity: 0.55; }

.ssw-cmp-pop {
  position: fixed;
  left: 220px;
  bottom: 80px;
  z-index: 90;
  width: 280px;
  max-height: 360px;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid var(--rc-border);
  border-radius: 10px;
  box-shadow: 0 20px 48px -18px rgba(15, 23, 42, 0.4);
  overflow: hidden;
  padding-bottom: 6px;
}
.ssw-cmp-title { flex: none; font-size: 12px; font-weight: 700; color: var(--rc-text); padding: 10px 10px 0; }
.ssw-cmp-list { flex: 1; overflow-y: auto; padding: 0 6px; }
.ssw-cmp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 0;
  background: transparent;
  border-radius: 7px;
  padding: 6px 8px;
  font-size: 12px;
  color: var(--rc-text-2);
  cursor: pointer;
  text-align: left;
}
.ssw-cmp-item:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.ssw-cmp-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ssw-cmp-id { flex: none; margin-left: auto; font-size: 10px; color: var(--rc-faint); }

.ssw-row-menu {
  position: fixed;
  z-index: 92;
  min-width: 112px;
  padding: 4px;
  background: #fff;
  border: 1px solid var(--rc-border);
  border-radius: 7px;
  box-shadow: 0 12px 28px -12px rgba(15, 23, 42, 0.38);
}
.ssw-row-menu button {
  display: block;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--rc-text-2);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.ssw-row-menu button:hover:not(:disabled) { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.ssw-row-menu button:disabled { color: var(--rc-faint); cursor: not-allowed; }
.ssw-row-menu button.danger { color: #b91c1c; }
.ssw-row-menu button.danger:hover:not(:disabled) { background: var(--rc-error-bg); color: #b91c1c; }

/* 更换网站弹窗：内容很短，不用 ssw-add-card 那套大表单排版 */
.ssw-move-body { display: grid; gap: 8px; margin-bottom: 20px; }
.ssw-move-src { margin: 0; color: var(--rc-text); font-size: 14px; font-weight: 600; }
.ssw-move-from { margin: 0; color: var(--rc-muted); font-size: 12px; }
.ssw-move-label { color: var(--rc-muted); font-size: 12px; }
.ssw-move-body .rc-select { width: 100%; height: 40px; border: 1px solid #cbd8e8; border-radius: 9px; background: #fff; color: var(--rc-text); font-size: 14px; padding: 0 11px; outline: none; }
.ssw-move-body .rc-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.ssw-move-warn { margin: 2px 0 0; padding: 8px 10px; border: 1px solid #fde68a; border-radius: 8px; background: #fffbeb; color: #92400e; font-size: 12px; line-height: 1.5; }

.ssw-add-backdrop { position: fixed; inset: 0; z-index: 91; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(15, 23, 42, 0.34); }
.ssw-add-card { box-sizing: border-box; width: min(720px, calc(100vw - 32px)); max-height: min(760px, calc(100vh - 32px)); overflow-y: auto; background: #fff; border: 1px solid #dbe5f1; border-radius: 18px; padding: 24px; box-shadow: 0 24px 64px -22px rgba(15, 23, 42, 0.45); }
.ssw-add-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
.ssw-add-title { font-size: 22px; font-weight: 800; color: var(--rc-text); letter-spacing: -0.02em; }
.ssw-field-label { display: block; margin: 0 0 8px; color: var(--rc-text); font-size: 14px; font-weight: 700; }
.ssw-field-label em { color: #ef4444; font-style: normal; margin-left: 2px; }
.ssw-field-label span { color: var(--rc-muted); font-weight: 500; }
.ssw-add-input { box-sizing: border-box; width: 100%; height: 44px; border: 1px solid #cbd8e8; border-radius: 9px; background: #fff; color: var(--rc-text); font-size: 14px; padding: 0 13px; outline: none; margin-bottom: 18px; }
.ssw-add-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.ssw-template-combobox { position: relative; }
.ssw-template-options { position: absolute; z-index: 2; top: 32px; right: 0; left: 0; max-height: 160px; overflow: auto; border: 1px solid #bfdbfe; border-radius: 7px; background: #fff; box-shadow: 0 8px 20px rgba(15, 23, 42, 0.14); }
.ssw-template-options button { display: flex; width: 100%; align-items: center; border: 0; background: #fff; color: var(--rc-text); padding: 6px 9px; font-size: 12px; text-align: left; cursor: pointer; }
.ssw-template-options button:hover { background: #eff6ff; }
.ssw-template-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.ssw-template-label { font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ssw-template-id { font-size: 10px; color: var(--rc-faint); font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
.ssw-template-empty { display: block; padding: 8px 9px; color: var(--rc-muted); font-size: 12px; }
.ssw-add-inherit { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--rc-text); cursor: pointer; margin: 2px 0 4px; }
.ssw-add-hint { font-size: 12px; color: var(--rc-muted); line-height: 1.6; margin: -4px 0 6px; }
.ssw-add-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--rc-border-soft); }
.ssw-import-textarea {
  width: 100%;
  border: 1px solid #dbe3ee;
  border-radius: 7px;
  background: #fff;
  color: var(--rc-text);
  font-size: 12px;
  padding: 8px 9px;
  outline: none;
  margin-bottom: 8px;
  resize: vertical;
  font-family: inherit;
}
.ssw-import-textarea:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }

/* 参数源（0721 会议）：加源弹窗内新增分支；面板本体样式随 ParamSourceEditor.vue 迁走 */
.ssw-add-card.wide { width: min(780px, calc(100vw - 32px)); transition: width 0.18s ease; }
.ssw-kind-seg { display: flex; gap: 16px; margin: 0 0 24px; }
.ssw-kind-seg button { flex: 1; min-height: 82px; padding: 14px 18px; border: 1px solid #d5e2f2; border-radius: 12px; background: #fff; color: var(--rc-text-2); font-size: 16px; font-weight: 700; cursor: pointer; text-align: left; font-family: inherit; }
.ssw-kind-seg button.active { border-color: var(--rc-primary); background: #eff6ff; color: var(--rc-primary-ink); box-shadow: inset 0 0 0 1px var(--rc-primary); }
.ssw-kind-seg button strong { display: block; }
.ssw-kind-seg button small { display: block; font-size: 13px; font-weight: 500; color: var(--rc-muted); margin-top: 7px; }

@media (max-width: 720px) {
  .ssw-add-card, .ssw-add-card.wide { width: calc(100vw - 24px); padding: 18px; border-radius: 14px; }
  .ssw-add-header { align-items: flex-start; flex-direction: column; gap: 12px; margin-bottom: 18px; }
  .ssw-kind-seg { gap: 8px; }
  .ssw-kind-seg button { min-height: 72px; padding: 10px; font-size: 14px; }
  .ssw-kind-seg button small { font-size: 11px; }
}

/* 折叠分割栏 & 选中源详情 */
.ssw-section-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 9px;
  margin: 6px 6px 0;
  border-radius: 6px;
  background: #f1f5f9;
  color: var(--rc-text-2);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
  border: 1px solid var(--rc-border-soft);
  transition: background 0.12s, color 0.12s;
}
.ssw-section-toggle:hover {
  background: #e2e8f0;
  color: var(--rc-text);
}
.ssw-section-icon {
  font-size: 9px;
  color: var(--rc-muted);
}
.ssw-active-detail {
  flex: none;
  margin: 0 6px 6px;
  padding: 8px 9px;
  background: #fff;
  border: 1px solid var(--rc-border-soft);
  border-top: none;
  border-bottom-left-radius: 6px;
  border-bottom-right-radius: 6px;
  font-size: 11px;
}
.ssw-detail-field {
  margin-bottom: 6px;
}
.ssw-detail-field:last-child {
  margin-bottom: 0;
}
.ssw-detail-label {
  display: block;
  font-size: 10px;
  color: var(--rc-muted);
  font-weight: 600;
  margin-bottom: 2px;
}
.ssw-detail-val.name {
  color: var(--rc-text);
  font-weight: 600;
  word-break: break-all;
  line-height: 1.35;
}
.ssw-detail-head-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ssw-detail-val.with-copy {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 4px;
}
.ssw-detail-val.with-copy code {
  font-family: monospace;
  font-size: 10px;
  color: #2563eb;
  background: #eff6ff;
  padding: 2px 5px;
  border-radius: 4px;
  word-break: break-all;
  flex: 1;
  min-width: 0;
}
.ssw-copy-btn {
  flex: none;
  padding: 1px 6px;
  border: 1px solid var(--rc-border);
  border-radius: 4px;
  background: #f8fafc;
  color: var(--rc-text-2);
  font-size: 10px;
  cursor: pointer;
}
.ssw-copy-btn:hover:not(:disabled) {
  background: #eff6ff;
  border-color: #93c5fd;
  color: var(--rc-primary-ink);
}
.ssw-copy-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
/* 默认呈现为蓝色链接（2026-09-21 用户反馈） */
a.ssw-detail-link,
.ssw-detail-url.ssw-detail-link {
  color: var(--rc-primary);
  text-decoration: none;
}
a.ssw-detail-link:hover,
.ssw-detail-url.ssw-detail-link:hover {
  color: var(--rc-primary);
  text-decoration: underline;
}
.ssw-detail-url {
  color: var(--rc-faint);
  font-size: 10px;
  word-break: break-all;
  line-height: 1.35;
  flex: 1;
  min-width: 0;
  /* 封顶 3 行：公众号那类 URL 有 200+ 字符，光 break-all 会折出十几行，把下面的
     「添加源 / 对比 / 批量导入」整个顶出可视区（2026-09-17 走查）。
     截断不丢信息——完整地址在 title 悬浮里，右边还有「复制」按钮。 */
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 批量导入弹窗（新增源 / 关联已有源共用一个入口，靠 tab 分） */
.ssw-add-card.bind { width: min(760px, calc(100vw - 32px)); }
.batch-tabs { margin-bottom: 16px; }
.ssw-batch-tab { height: 32px; padding: 0 14px; border: 1px solid var(--rc-border); border-radius: 999px; background: #fff; color: var(--rc-text-2); font-size: 12.5px; font-weight: 600; cursor: pointer; }
.ssw-batch-tab:hover { border-color: #93c5fd; color: var(--rc-primary-ink); }
.ssw-batch-tab.active { border-color: var(--rc-primary); background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.ssw-bind-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.ssw-add-input.bind-kw { width: 220px; height: 34px; margin-bottom: 0; }
.ssw-bind-toolbar .rc-btn { height: 34px; padding: 0 12px; font-size: 12px; }
.ssw-bind-hide { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--rc-text-2); cursor: pointer; user-select: none; }
.ssw-bind-selected { margin-left: auto; font-size: 12px; font-weight: 700; color: var(--rc-primary-ink); }
.ssw-bind-batch { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 12px; }
.ssw-bind-batch .ssw-import-textarea { flex: 1; margin-bottom: 0; }
.ssw-bind-batch .rc-btn { flex: none; height: 34px; padding: 0 12px; font-size: 12px; white-space: nowrap; }
.ssw-bind-table-wrap { max-height: 320px; overflow: auto; border: 1px solid var(--rc-border-soft); border-radius: 8px; }
.ssw-bind-table { width: 100%; }
.ssw-bind-table tbody tr { cursor: pointer; }
.ssw-bind-table tbody tr:hover { background: var(--rc-primary-bg); }
.ssw-bind-table .mono { font-family: monospace; font-size: 11px; }
.ssw-bind-unbound { color: var(--rc-faint); font-size: 12px; }
.ssw-bind-current { color: var(--rc-ok); font-size: 12px; font-weight: 600; }
.ssw-bind-other { color: #d97706; font-size: 12px; font-weight: 600; }
.ssw-bind-pager { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 10px 0 4px; }
.ssw-bind-muted { font-size: 12px; color: var(--rc-muted); }
</style>

<!-- 批量导入的进度通知 teleport 到 body，scoped 选择器管不到，转圈动画放在这里（不加 scoped） -->
<style>
@keyframes rc-imp-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { [style*="rc-imp-spin"] { animation-duration: 2s !important; } }
</style>
