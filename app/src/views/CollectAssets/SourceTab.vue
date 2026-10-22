<script setup lang="ts">
import { computed, onActivated, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { sourceApi, siteApi, expandCategoryIds, type Site, type Source, type SourceCategory } from '@/api'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { favoriteSiteIds, loadFavoriteSites } from '@/utils/siteFavorites'
import { favoriteSourceIds, favoriteSourcesLoaded, loadFavoriteSources } from '@/utils/sourceFavorites'
import { recentLoaded, recentRankOf, recentSiteIds, recordSiteVisit, loadRecentSites } from '@/utils/siteRecents'
import { trackClick, trackCreate, trackDelete, trackEdit } from '@/utils/logEvents'
import SiteCardGrid from './SiteCardGrid.vue'
import FilterToolbar from './components/FilterToolbar.vue'
import SourceOverviewView from '@/views/FlowCanvas/result/SourceOverviewView.vue'
import SiteEditorDialog from './components/SiteEditorDialog.vue'
import { beginSitesFetch, collectAssetsCache, clearCollectAssetsCache, commitSites } from './siteListCache'
import AddToViewDialog from './AddToViewDialog.vue'
import SourceDirPanel, { type DirScope } from './SourceDirPanel.vue'
import BizDirPickerDialog from './BizDirPickerDialog.vue'
import BizDirMoveDialog from './BizDirMoveDialog.vue'
import BizTemplateImportDialog from './BizTemplateImportDialog.vue'
import CategoryScheduleModal from '@/views/AuxiliaryTool/scheduleConfig/CategoryScheduleModal.vue'
import { VIEW_DIR_ROOT_ID, BIZ_DIR_ROOT_ID, bizMembership, bizScopeSourceIds, dirNode } from '@/api/sourceDirs'

/**
 * `scope`：由外层 tab 传进来（`CollectAssets/index.vue`，0924-01）。
 * - `all`：网站列表；
 * - `favorite`：我的收藏，恒定只看收藏；
 * - `recent`：最近打开，恒定只看最近打开过的，按访问顺序排。
 * 这两种过滤原来挂在排序下拉里（0917-17），0924 会上改成 tab，工具条上不再能切。
 */
const props = withDefaults(defineProps<{ scope?: 'all' | 'favorite' | 'recent' }>(), { scope: 'all' })

const ui = useUiStore()
const route = useRoute()
const router = useRouter()

// 总览页下钻：?state=E / external / disabled 预置筛选
const VALID_STATES = ['all', 'error']

// ---- 分类 / 标签 / 统计 ----
const categories = ref<SourceCategory[]>([])
const allTags = ref<string[]>([])
/**
 * 全站汇总（`site/summary` 不带条件）。
 *
 * ⚠️ `stats.total` 是**源**总数（`summary.sourceTotal`），不是网站数——历史命名，别改动它的含义。
 * `siteTotal` 是全站网站数：工具条第一个标签要显示「命中 / 全站」，光有命中数说不清"筛掉了多少"。
 * 列表加载出来之后，源 / 出错源 / 告警网站三项改用 {@link listStats}（跟筛选走），这里只在
 * 列表还没回来时顶一下，以及提供 siteTotal。
 */
const stats = reactive({ total: 0, error: 0, notify: 0, siteTotal: 0 })

// ---- 筛选 ----
const keyword = ref('')
// 分类多选（目录 ID 数组，空 = 全部）；查询时拼成旧契约 categoryIds 的逗号串
const categoryFilter = ref<string[]>([])
const tagFilter = ref('')
/** 'error' = 只看有异常源的网站。没有下拉了（0924-01），由「出错源」标签和 ?state=error 驱动 */
const stateFilter = ref('all')
const favOnly = computed(() => props.scope === 'favorite')
const recentOnly = computed(() => props.scope === 'recent')
watch(() => props.scope, () => applyView())

/**
 * 只看有异常源的网站：**前端按 errorCount 过滤，不发给后端**（0924-01）。
 * 2026-09-24 生产实测 `site/sitePaged?state=ERROR` 恒返回 0 条（`count:0`）——原「全部状态 →
 * 有异常源」下拉一直是坏的，只是没人发现。列表本来就是全量拉回来前端筛的，每个网站又带着
 * errorCount（B31），前端筛既不多发请求，也和标签上的「出错源 N」是同一个口径。
 */
function toggleErrorOnly() {
  stateFilter.value = stateFilter.value === 'error' ? 'all' : 'error'
  if (stateFilter.value === 'error') emptyOnly.value = false
  page.value = 1
  applyView()
}

/** 收藏 / 最近打开一个都没有时，空态要说清楚怎么才会有；其余情况是筛选没命中 */
const emptyText = computed(() => {
  if (favOnly.value && !favoriteSiteIds.value.size) return '还没有收藏的网站，在列表里点 ☆ 收藏'
  if (recentOnly.value) {
    // 后端还没回来时先别说"没有"，否则每次进 tab 都闪一下空态
    if (!recentLoaded.value) return '正在加载最近打开…'
    if (!recentSiteIds.value.length) return '还没有打开过网站，打开过的网站会自动出现在这里（最多 10 个）'
  }
  return '没有匹配的网站'
})

/**
 * 当前是否带着筛选条件（2026-09-21 用户报「根据条件查询完后，条数没有更新」）。
 * 带着条件时「网站」写成「命中 / 全站」（如「71 / 83」）。
 */
const hasFilter = computed(() => !!keyword.value.trim()
  || categoryFilter.value.length > 0
  || !!tagFilter.value
  || stateFilter.value !== 'all'
  || emptyOnly.value
  || favOnly.value
  || recentOnly.value)

/**
 * 只看没有源的网站（0930-01）。网站列表默认不显示空网站（预建的空目录站），
 * 要找它们就点工具条上的「空网站 N」。与「出错源」互斥——空网站不可能有出错源，两个一起开必然是空列表。
 */
const emptyOnly = ref(false)
function toggleEmptyOnly() {
  emptyOnly.value = !emptyOnly.value
  if (emptyOnly.value) stateFilter.value = 'all'
  page.value = 1
  applyView()
}
/** 本次在这里新建的网站：刚建好还没有源，但要照常显示、方便马上点进去加源，不然看着像没建成功 */
const justCreatedSiteIds = new Set<string>()
const isEmptySite = (site: Site) => (site.sourceCount || 0) <= 0
/** 当前筛选（关键词 / 分类 / 标签）下没有源的网站数，「空网站」标签上的数字 */
const emptyCount = ref(0)

// ---- 网站列表 / 分页 ----
const sites = ref<Site[]>([])
const total = ref(0)
const page = ref(1)
/**
 * 每页 20（2026-09-23，此前 09-18 按用户要求是 50）。
 *
 * 列表本身是一次全量拉回、前端分页，页大小不影响它；影响的是卡片——每张卡片各发一个
 * 源预览请求，之后还要逐站拉完整源列表算数据量（见 SiteCardGrid）。50 张卡片就是
 * 50 轮请求，首屏明显慢，所以回到 20。选项仍是 10/20/50，要看更多自己调。
 */
const size = ref(20)
const loading = ref(false)

// ---- 表格视图 ref ----
const editorVisible = ref(false)
const editorSite = ref<Site | null>(null)
// 新建与编辑共用 SiteEditorDialog（2026-09-18）：新建态 editorSite 为 null。
const editorMode = ref<'create' | 'edit'>('edit')

// ---- 加载 ----
// 网站列表一次全量拉回来，排序和分页都在前端做。两个原因：
// 1. 真实后端**不支持排序**——`field`/`sorted`、`orderBy`、`sort`/`order` 五种参数名
//    2026-09-16 生产实测全部无效，恒按 siteId 升序返回。「最近修改 / 名称」只能前端排。
// 2. 后端分页 + 前端排序 = 只能把当前页那 10 条重排一遍，跨页顺序还是乱的。
// cfg_site 的行很轻（没有 flowConf 那类大字段），网站量级也远小于源（当前 10 个），
// 一次拉 2000 条成本可以接受。关键词搜索分支本来就是这么做的，这里把两条路合成一条。
const LIST_FETCH_SIZE = 2000

function sortSites(list: Site[]): Site[] {
  // 「最近打开」模式下按访问时间排，不走收藏置顶那套——它本身就是一个时间序，
  // 再让收藏插队反而看不出"我刚才去过哪"
  if (recentOnly.value) return [...list].sort((a, b) => recentRankOf(a.siteId) - recentRankOf(b.siteId))
  // 收藏的**恒排最前**（0917-17），组内按最近修改倒序。
  // 「名称」排序 0924 会上随排序下拉一起去掉了（Q1），卡片视图只剩这一种顺序。
  // updatedAt 是 'YYYY-MM-DD HH:mm:ss'，定长且高位在前，字符串倒序即时间倒序。
  return [...list].sort((a, b) => {
    const fa = favoriteSiteIds.value.has(a.siteId) ? 0 : 1
    const fb = favoriteSiteIds.value.has(b.siteId) ? 0 : 1
    return fa !== fb ? fa - fb : (b.updatedAt || '').localeCompare(a.updatedAt || '')
  })
}

/**
 * 这一轮请求拉回来的全量（已按关键词 / 分类 / 状态过滤过，**未**按收藏过滤、未排序、未切片）。
 *
 * 单独留一份是为了让"点一下星"能就地重排——不然点完星顺序纹丝不动，得等下次筛选才生效，
 * 用户看到的就是"点了没反应"（这条是单测先发现的）。重发一次请求也能解决，
 * 但那是 2000 条的全量拉取，为一次点星不值得。
 */
const fetchedSites = ref<Site[]>([])

/**
 * 筛选命中的这批网站的汇总（2026-09-23，B31 后端补齐聚合列后才做得了）。
 *
 * 直接对筛完的列表求和，而不是再发一次带条件的 site/summary：
 * - 列表本来就是全量拉回、前端筛（见 loadList），求和零请求；
 * - 搜索框是「网站名 **或** 源名」命中，后端 name / sourceName 两个参数之间是 AND，
 *   一次 summary 表达不了这个「或」，带搜索词时统计会和列表对不上；这里天然一致；
 * - 口径已核对：2026-09-23 全量（98 站 / 18189 源 / 1496 出错 / 10 告警站）与
 *   按标签「财经资讯」（64 / 2784 / 327 / 0）两组，前端求和与 summary 四项完全相同。
 * 「告警网站」按网站计（有告警源的网站数），与 summary 的 notifyCount 同义，不是告警源数。
 * null = 列表还没回来，工具条先用全站汇总顶着。
 */
const listStats = ref<{ total: number; error: number; notify: number } | null>(null)
const toolbarStats = computed(() => ({ ...(listStats.value ?? stats), siteTotal: stats.siteTotal }))

/** 从 fetchedSites 重算展示：只看收藏 → 排序（收藏置顶）→ 切片。不发请求。 */
function applyView() {
  let base = fetchedSites.value
  // 0930-01：网站列表不显示一个源都没有的网站（预建的空目录站，会上看着是一片「暂无源」）。
  // 点「空网站」只看它们；按网站名搜索、本次新建的照样显示；收藏 / 最近打开是用户自己点过的，也不藏。
  if (props.scope === 'all') {
    emptyCount.value = base.filter(isEmptySite).length
    if (emptyOnly.value) base = base.filter(isEmptySite)
    else if (!keyword.value.trim()) base = base.filter((site) => !isEmptySite(site) || justCreatedSiteIds.has(site.siteId))
  }
  if (stateFilter.value === 'error') base = base.filter((site) => (site.errorCount || 0) > 0)
  if (favOnly.value) base = base.filter((site) => favoriteSiteIds.value.has(site.siteId))
  else if (recentOnly.value) base = base.filter((site) => recentSiteIds.value.includes(site.siteId))
  listStats.value = {
    total: base.reduce((sum, site) => sum + (site.sourceCount || 0), 0),
    error: base.reduce((sum, site) => sum + (site.errorCount || 0), 0),
    notify: base.filter((site) => (site.notifyCount ?? 0) > 0).length,
  }
  const list = sortSites(base)
  const start = (page.value - 1) * size.value
  sites.value = list.slice(start, start + size.value)
  total.value = list.length
}

// 收藏 / 最近打开变了（本页点的，或另一个标签页点的）就地重排，不重新请求
watch([favoriteSiteIds, recentSiteIds], applyView)

// 筛选条件连着变（改关键词又马上改分类、翻页）会有多次 loadList 同时在飞，
// 而它们的完成顺序跟发起顺序无关——慢的那次后回来就会把新结果盖掉，列表显示的是过期内容。
// 只认最后一次发起的请求，其余的结果直接丢弃。
let listRequestSeq = 0

/**
 * `force`：跳过缓存直接请求（本页改了数据之后用）。
 * `revalidate`：命中缓存时先把缓存画出来，再**静默**重拉一次覆盖（进页面 / 切回 tab 时用）。
 *   缓存是模块级的、跨路由存活，别的页面新建网站、挪源都不会清它——不重拉就会一直显示旧数据。
 * 两个都不传（翻页、筛选改回默认）：命中缓存就直接用。
 */
async function loadList(options: { force?: boolean; revalidate?: boolean } = {}) {
  const seq = ++listRequestSeq
  const search = keyword.value.trim()
  const isDefaultQuery = !search && !categoryFilter.value.length && !tagFilter.value

  let silent = false
  if (!options.force && isDefaultQuery && collectAssetsCache.sites) {
    fetchedSites.value = collectAssetsCache.sites
    applyView()
    loading.value = false
    if (!options.revalidate) return
    silent = true
  }

  const ticket = isDefaultQuery ? beginSitesFetch() : 0
  if (!silent) loading.value = true
  try {
    // 勾一个分类要连它下面的子分类一起筛（后端 categoryIds 只精确匹配本级，不含子级；
    // 分类树又是懒加载的，未展开的子级 ID 前端手里没有）——交给 expandCategoryIds 把子树拉全。
    const filters = {
      category: (await expandCategoryIds(categoryFilter.value)).join(','),
      tag: tagFilter.value,
      // state 不传：后端 state=ERROR 查不出东西，异常过滤在 applyView 里做（见 toggleErrorOnly）
    }
    // 源名匹配走 source/sourcePaged?name= 取命中源的 siteId，再与网站列表求交集：
    // 真实 site/sitePaged 只按网站名筛，传 sourceName 会被忽略并原样返回整页
    // （旧实现的 name∪sourceName 并集因此把无关网站也带了出来）。
    const [sitePage, matchedSources] = await Promise.all([
      siteApi.sitePaged({ ...filters, page: 1, size: LIST_FETCH_SIZE }),
      search ? sourceApi.sourcePaged({ name: search, page: 1, size: LIST_FETCH_SIZE }) : undefined,
    ])
    let list = sitePage.list
    if (search) {
      const kw = search.toLowerCase()
      const siteIdsBySource = new Set(
        (matchedSources?.list ?? []).map((s) => s.siteId).filter((id): id is string => !!id),
      )
      list = list.filter((site) => site.name.toLowerCase().includes(kw) || siteIdsBySource.has(site.siteId))
    }
    if (seq !== listRequestSeq) return
    if (isDefaultQuery) commitSites(ticket, list)
    fetchedSites.value = list
    applyView()
  } catch {
    if (seq !== listRequestSeq) return
    // 静默重拉失败就留着缓存那份，不清空、不打扰
    if (silent) return
    ElMessage.warning('加载网站列表失败')
    fetchedSites.value = []
    sites.value = []
    total.value = 0
  } finally {
    // 已经有更新的请求在飞时不要关 loading，否则转圈会提前消失
    if (seq === listRequestSeq) loading.value = false
  }
}
/**
 * 同 loadList：`revalidate` 先画缓存再静默重拉。
 * 分类 0924-03 起在「系统设置 → 分类目录」维护，那边改完再回来，这里的模块级缓存就过期了——
 * 进页面 / 切回 tab 都要重拉一次根分类（就一个请求）。
 */
async function loadCategories(options: { revalidate?: boolean } = {}) {
  let silent = false
  if (collectAssetsCache.categories) {
    categories.value = collectAssetsCache.categories
    if (!options.revalidate) return
    silent = true
  }
  try {
    // 首屏只拉根分类（1个请求），子级由 FilterToolbar 的 el-tree-select 展开时按需懒加载；
    // 不再首屏扇出十几个请求把网络打满
    // 2026-10-21：-1「视图目录」、-2「业务分类」是另外两套目录的根，不是系统分类，不进卡片视图的分类下拉
    const roots = (await sourceApi.sourceCategories()).filter((c) => c.id !== VIEW_DIR_ROOT_ID && c.id !== BIZ_DIR_ROOT_ID)
    collectAssetsCache.categories = roots
    categories.value = roots
  } catch {
    if (silent) return
    ElMessage.warning('加载分类失败')
    categories.value = []
  }
}
/** 同 loadList：`force` 跳过缓存；`revalidate` 先画缓存再静默重拉 */
async function loadStats(options: { force?: boolean; revalidate?: boolean } = {}) {
  let silent = false
  if (!options.force && collectAssetsCache.stats) {
    Object.assign(stats, collectAssetsCache.stats)
    if (!options.revalidate) return
    silent = true
  }
  try {
    const summary = await siteApi.siteSummary()
    const next = {
      total: summary.sourceTotal,
      error: summary.errorCount,
      notify: summary.notifyCount,
      siteTotal: summary.total,
    }
    collectAssetsCache.stats = next
    Object.assign(stats, next)
  } catch {
    if (silent) return
    ElMessage.warning('加载网站统计失败')
  }
}
async function loadTagOptions() {
  if (collectAssetsCache.tags) {
    allTags.value = collectAssetsCache.tags
    return
  }
  try {
    // 0915-14：改用后端 2026-09-16 交付的 site/siteTags（返回的就是拆分去重后的数组）。
    // 此前是 sitePaged({size:999}) 拉全量网站再前端聚合——那个 TODO（性能审查 P0-2）到此为止；
    // 而且在后端加 tags 字段之前，聚合出来的集合**恒为空**，这个下拉一直是个空壳。
    allTags.value = await siteApi.siteTags()
    collectAssetsCache.tags = allTags.value
  } catch {
    ElMessage.warning('加载标签选项失败')
    allTags.value = []
  }
}

function resetAndLoad() {
  page.value = 1
  loadList()
}
async function refreshAll() {
  clearCollectAssetsCache()
  await Promise.all([loadList({ force: true }), loadStats(), loadCategories(), loadTagOptions()])
}

// ---- 筛选辅助 ----
// ---- 视图偏好 ----
// 'table' 这个取值沿用（存在 localStorage 里），0924-06 起它渲染的是**源列表视图**：
// 复用网站详情的「源视图」组件，不限网站，一行一个源。
const view = computed(() => ui.assetView)

// ---- 数据中心「按条件查源」带来的命中源（1016）----
// 名单在 store 里（见 workspace.dataQueryHits），URL 只带 `from=data-query` 标记；
// 刷新后 store 空了就当没带，回到普通源管理。
const ws = useWorkspaceStore()
const dataHits = computed(() => (props.scope === 'all' && route.query.from === 'data-query' ? ws.dataQueryHits : null))
function clearDataHits() {
  ws.setDataQueryHits(null)
  const query = { ...route.query }
  delete query.from
  void router.replace({ path: route.path, query })
}

// ---- 源列表视图（0924-06）----
/** 页签范围：最近打开 = 那几个网站下的源 */
const sourceScopeSiteIds = computed<string[] | undefined>(() => (recentOnly.value ? recentSiteIds.value : undefined))
/**
 * 我的收藏 = 收藏的源（0924-08）。卡片视图下同一个页签仍是收藏的网站——两种视图一行是什么，收藏就是什么。
 * 收藏没拉回来之前范围是空集（不能传 undefined，那等于不限、会查出全部源），空态文案显示加载中；
 * 拉回来后 scopeSourceIds 变了，源视图自己重查。
 */
const sourceScopeSourceIds = computed<string[] | undefined>(() => (favOnly.value ? [...favoriteSourceIds.value] : undefined))
const sourceScopeEmptyText = computed(() => {
  if (recentOnly.value) {
    if (!recentLoaded.value) return '正在加载最近打开…'
    return '还没有打开过网站，打开过的网站会自动出现在这里（最多 10 个）'
  }
  if (favOnly.value) return favoriteSourcesLoaded.value ? '还没有收藏的源，在源列表里点 ☆ 收藏' : '正在加载收藏的源…'
  return ''
})
/** 打开源：与网站详情「源视图」同一落点（概览视图），带上网站上下文，左侧才加载得出同网站的源 */
function openSourceFromList(source: Source, view: 'overview' | 'data' = 'overview') {
  if (source.siteId && source.siteId !== '0') recordSiteVisit(source.siteId, source.siteName)
  // 两条埋点，口径不同：SITE/ENTER 归「最近打开的网站」（读 `recent`），
  // SOURCE/CLICK 归「最近查看的源」（读 `page` 明细）。不能只打一条——前者是网站，后者是源。
  trackClick('SOURCE', source.sourceId, source.name, {
    eventCode: 'source_open',
    eventName: '打开源',
    firstModule: '采集资产',
    pageName: view === 'data' ? '源数据视图' : '源概览视图',
  })
  void router.push({
    path: '/canvas',
    query: { ...(source.siteId && source.siteId !== '0' ? { siteId: source.siteId } : {}), sourceId: source.sourceId, view, returnTo: route.fullPath },
  })
}
function openSiteFromList(siteId: string) {
  // 名字就地查：`contentTitle` 建议每次都传，否则后端最近列表的标题会是空的
  recordSiteVisit(siteId, fetchedSites.value.find((site) => site.siteId === siteId)?.name)
  void router.push({ path: '/canvas', query: { siteId, view: 'source', returnTo: route.fullPath } })
}
// ---- 系统目录 / 业务目录（2026-10-21，原型 设计稿/原型设计/源管理_系统目录与业务目录_原型_2026-10-21.html）----
// 只在「系统目录」页签的源列表视图里有：左侧 SourceDirPanel 选目录，系统目录按 categorys 筛，
// 业务目录先算出目录（含子级）里的源 ID 再按源 ID 范围筛（后端口径见 api/sourceDirs.ts）。
const dirCollapsed = ref(true)
const showDirPanel = computed(() => props.scope === 'all' && view.value === 'table')
const dirPanelRef = ref<InstanceType<typeof SourceDirPanel>>()
const dirScope = ref<DirScope>({ kind: 'biz', dirIds: [], labels: [] })
const dirActive = computed(() => showDirPanel.value && (dirScope.value.all || dirScope.value.dirIds.length > 0))
const bizActive = computed(() => dirActive.value && dirScope.value.kind === 'biz')
const bizSourceIds = ref<string[]>([])
const bizLoading = ref(true)
const bizError = ref('')
const dirScopeVersion = ref(0)
let bizSeq = 0
async function resolveBizScope() {
  const seq = ++bizSeq
  if (!bizActive.value) { bizSourceIds.value = []; bizLoading.value = false; return }
  bizLoading.value = true
  bizError.value = ''
  try {
    const ids = await bizScopeSourceIds(dirScope.value.dirIds)
    if (seq === bizSeq) bizSourceIds.value = ids
  } catch (error) {
    if (seq === bizSeq) { bizSourceIds.value = []; bizError.value = `读取业务目录里的源失败：${(error as Error)?.message ?? String(error)}` }
  } finally {
    if (seq === bizSeq) bizLoading.value = false
  }
}
function onDirScope(scope: DirScope) {
  dirScope.value = scope
  void resolveBizScope()
}
const dirKindLabel = computed(() => (dirScope.value.kind === 'biz' ? '业务目录' : '系统目录'))
const dirLabelText = computed(() => {
  if (dirScope.value.all) return '全部目录'
  const labels = dirScope.value.labels
  if (!labels.length) return ''
  return labels.length === 1 ? labels[0].path : `已选 ${labels.length} 个目录`
})
const dirLabelTip = computed(() => dirScope.value.labels.map((l) => l.path).join('\n'))
const dirWithSub = computed(() => dirScope.value.labels.some((l) => l.hasKids))
/** 给发任务确认弹窗看的范围描述 */
const dirScopeLabel = computed(() => (dirActive.value ? `${dirKindLabel.value}：${dirScope.value.all ? '全部目录' : dirScope.value.labels.map((l) => l.path).join('、')}${dirWithSub.value ? '（含子级）' : ''}` : ''))
const listScopeCategoryIds = computed(() => (dirActive.value && dirScope.value.kind === 'sys' ? dirScope.value.dirIds : undefined))
const listScopeSourceIds = computed(() => {
  if (props.scope !== 'all') return sourceScopeSourceIds.value
  return bizActive.value ? (bizLoading.value ? [] : bizSourceIds.value) : undefined
})
const listScopeEmptyText = computed(() => {
  if (!bizActive.value) return sourceScopeEmptyText.value
  if (bizLoading.value) return '正在读取业务目录里的源…'
  return bizError.value || '这个业务目录里还没有源，请点击「添加源到业务目录」'
})

// 「业务目录」列：源 → 所在业务目录。没有反查接口，整棵业务目录树 listSources 一遍，会话内缓存
const bizOf = ref(new Map<string, string[]>())
async function loadBizMembership() {
  try { bizOf.value = await bizMembership() } catch { /* 列显示「—」，不打断列表 */ }
}
const bizNames = (sourceId: string) => (bizOf.value.get(sourceId) ?? []).map((id) => dirNode(id)?.name ?? `#${id}`)

// 按目录：发送 = 复用源列表的「发任务」（不勾选 = 按当前筛选范围，已含目录范围）；定时 = 按范围统一定时弹窗
const overviewRef = ref<InstanceType<typeof SourceOverviewView>>()
const scheduleRef = ref<InstanceType<typeof CategoryScheduleModal>>()
function onDirCommand(command: 'send' | 'schedule') {
  if (command === 'send') {
    overviewRef.value?.clearSelection()
    void overviewRef.value?.openLaunch()
    return
  }
  if (dirScope.value.kind === 'sys') scheduleRef.value?.show({ categoryIds: dirScope.value.dirIds.join(',') })
  else if (!bizSourceIds.value.length) ElMessage.warning('这个业务目录里还没有源')
  else scheduleRef.value?.show({ ids: bizSourceIds.value.join(',') })
}

// 选中源加入 / 移出业务目录（一个源可以放进多个业务目录，10-21 定暂不限制）
const bizPicker = reactive({ open: false, ids: [] as string[] })
const defaultBizDirIds = computed(() => (bizActive.value && !dirScope.value.all ? dirScope.value.labels.map((label) => label.id) : []))
function openBizPicker(ids: string[]) {
  bizPicker.ids = [...ids]
  bizPicker.open = true
}
async function afterBizChanged() {
  await loadBizMembership()
  await resolveBizScope()
  dirScopeVersion.value += 1
}
// 移动到…（10-21）：必须先在左侧点 / 勾一个业务目录，作为「从哪移出」；弹窗里选目标或「仅移出」
const canMoveBiz = computed(() => bizActive.value && !dirScope.value.all && dirScope.value.labels.length === 1)
const bizMove = reactive({ open: false, ids: [] as string[] })
function openBizMove(ids: string[]) {
  if (!canMoveBiz.value || !ids.length) return
  bizMove.ids = [...ids]
  bizMove.open = true
}

// 按模板批量新增（10-22）：同「移动」一样要先在左侧选定一个业务目录，且只能勾一个源当模板
const bizTemplate = reactive({ open: false, templateId: '', dirId: '' })
function openBizTemplate(ids: string[]) {
  if (!canMoveBiz.value || ids.length !== 1) return
  bizTemplate.templateId = ids[0]
  bizTemplate.dirId = dirScope.value.labels[0].id
  bizTemplate.open = true
}

// 勾选源后「加入视图目录」（2026-10-13 目录版）：选视图 → 选目录；条件视图与「另存为视图」10-13 起下线
const addToView = reactive({ open: false, ids: [] as string[] })
function openAddToView(ids: string[]) {
  addToView.ids = [...ids]
  addToView.open = true
}
function onAddedToView(viewName: string, place: string, count: number) {
  ElMessage.success(`已加入视图「${viewName}」的「${place}」（新增 ${count} 个源）`)
}
/** 点来源组名（1008-04）：跳到「我的分组」并选中该组 */
function openSourceGroup(sourceGroupId: string) {
  void router.push({ path: '/collect', query: { tab: 'personal', group: sourceGroupId } })
}
function onToolbarRefresh() {
  if (view.value === 'table') ui.notifySourceListChanged()
  else void refreshAll()
}
function setView(v: 'card' | 'table') {
  ui.setAssetView(v)
}

// ---- 搜索 debounce（300ms）----
let kwTimer: ReturnType<typeof setTimeout> | undefined
function onKeywordChange() {
  clearTimeout(kwTimer)
  kwTimer = setTimeout(() => resetAndLoad(), 300)
}
watch(keyword, onKeywordChange)

// ---- 网站编辑 / 新建 ----
function openSiteEditor(site: Site) {
  editorMode.value = 'edit'
  editorSite.value = site
  editorVisible.value = true
}

/**
 * 删除网站（1014 右键卡片菜单）。高危操作：
 * 1) 弹窗二次确认；2) 确认后调 site/delete；3) 成功后整体刷新。
 * 后端语义（反编译 SiteController.delete 确认）：**只删除网站本身（逻辑删除 is_delete=1），不会删源**——
 * 网站下还有源时后端会直接拒绝（「该网站下还有 N 个源，请先解除关联后再删除」），必须先解除源关联才能删。
 * 删除当前工作区正在编辑的网站时，其缓存（源/表引用）由 clearCollectAssetsCache 一并清掉。
 */
async function onDeleteSite(site: Site) {
  try {
    await ElMessageBox.confirm(
      `确定删除网站「${site.name}」吗？该操作不可恢复。删除只移除网站本身、不影响网站下的源（网站下还有源时需先解除关联后才能删除）。`,
      '删除网站',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning', confirmButtonClass: 'el-button--danger' },
    )
  } catch {
    return // 用户取消
  }
  try {
    const res = await siteApi.siteDelete(site.siteId)
    if (!res.ok) {
      ElMessage.error(res.message || '删除网站失败')
      return
    }
    trackDelete('SITE', site.siteId, site.name, {
      eventCode: 'site_delete',
      eventName: '删除网站',
      firstModule: '采集资产',
      pageName: '网站列表',
    })
    ElMessage.success(`已删除网站「${site.name}」`)
    await refreshAll()
  } catch (error) {
    ElMessage.error(`删除失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 新建网站（2026-09-18）。落点是列表工具条而不是顶栏：顶栏那个「新建采集」是总览页也挂着的
 * 全局入口（建网站 + 首批源一步到位），而这里是网站列表自己的对象级操作——只开一个空网站，
 * 源随后用侧栏的批量导入灌进去。旧平台也是这么分的（SiteList 操作栏：＋新增网站 / 批量导入 / 导出）。
 */
function openSiteCreator() {
  editorMode.value = 'create'
  editorSite.value = null
  editorVisible.value = true
}

async function onEditorSaved(newSiteId?: string) {
  // 性能审查 P1-3：编辑网站只改名称/分类/负责人，不改标签，删除 loadTagOptions 调用
  // 标签列表在 mount 时加载一次即可（标签通过新建网站/其他途径才能变更）
  //
  // 新建成功后**不自动跳进新网站**：建站常常是连着建好几个，跳走反而打断。
  // 回到第一页即可——默认排序是「最近修改」，新网站就在最前面，点卡片就能进去灌源。
  // 编辑前的 id 先留一份：刷新列表后 `editorSite` 可能已被清掉，埋点还要用它
  const editedId = editorSite.value?.siteId
  clearCollectAssetsCache()
  if (newSiteId) {
    justCreatedSiteIds.add(newSiteId)
    page.value = 1
  }
  await loadList({ force: true })
  // 标题用**刷新后**的名字：编辑可能刚改过名，用打开弹窗时的旧名会让明细表和列表对不上
  const trackId = newSiteId ?? editedId
  const title = fetchedSites.value.find((s) => s.siteId === trackId)?.name ?? editorSite.value?.name
  if (newSiteId) {
    trackCreate('SITE', newSiteId, title, {
      eventCode: 'site_create',
      eventName: '新建网站',
      firstModule: '采集资产',
      pageName: '网站列表',
    })
  } else if (editedId) {
    trackEdit('SITE', editedId, title, {
      eventCode: 'site_update',
      eventName: '编辑网站基本信息',
      firstModule: '采集资产',
      pageName: '网站列表',
    })
  }
}

// 新建采集
function openNewFlowCanvas() {
  router.push({ path: '/canvas', query: { mode: 'new' } })
}

// ---- 顶部模块按钮接线 ----
let appliedRouteFilters = ''
function applyRouteFilters() {
  const signature = JSON.stringify([route.query.state, route.query.category])
  if (signature === appliedRouteFilters) return
  appliedRouteFilters = signature
  const qs = String(route.query.state ?? '')
  if (VALID_STATES.includes(qs)) stateFilter.value = qs
  // 总览「资产类型分布」按分类下钻（DistributionPanel 带来的 ?category=<id>）——此前没接，
  // 下钻过来分类筛选是静默丢的。多选口径下预置成一个勾选项。
  const qc = String(route.query.category ?? '')
  if (qc) categoryFilter.value = qc.split(',').map((s) => s.trim()).filter(Boolean)
}
onMounted(() => {
  applyRouteFilters()
  // 并发优化：优先发起核心列表与统计请求；分类与标签后置并发，不再产生扇出请求风暴
  void loadStats({ revalidate: true })
  void loadList({ revalidate: true })
  // 收藏以后端为准（B30）；回来后 watch(favoriteSiteIds) 会就地重排，不用等它
  void loadFavoriteSites()
  void loadFavoriteSources()
  // 最近打开 2026-10-19 起也以后端为准（通用埋点），回来后 watch(recentSiteIds) 会就地重排。
  // 只有「最近打开」这个实例需要它，别让系统目录 / 收藏 tab 白打一次请求
  if (recentOnly.value) void loadRecentSites()
  void loadCategories({ revalidate: true })
  void loadTagOptions()
  if (props.scope === 'all') void loadBizMembership()
  ui.registerAction('新建采集', openNewFlowCanvas)
})
// 外层 CollectAssets 套了 KeepAlive：tab 之间切换不重新挂载，onMounted 不再跑。
// 切回来时静默重拉，免得另一个 tab 或别的页面改过的数据看不到。
// 首次挂载也会触发一次 onActivated，那次 onMounted 已经拉过，跳过。
let activatedOnce = false
onActivated(() => {
  if (!activatedOnce) {
    activatedOnce = true
    return
  }
  applyRouteFilters()
  void loadFavoriteSites()
  void loadFavoriteSources()
  // 最近打开：切回 tab 时静默重拉，别的浏览器/别的设备上报的也能看到
  if (recentOnly.value) void loadRecentSites()
  void loadStats({ revalidate: true })
  void loadList({ revalidate: true })
  void loadCategories({ revalidate: true })
})
onUnmounted(() => {
  ui.clearActions()
  clearTimeout(kwTimer)
})
</script>

<template>
  <div class="ca-page" :class="{ 'is-list': view === 'table' || !!dataHits }">
    <template v-if="dataHits">
      <div class="ca-hits-bar" data-testid="data-query-hits">
        <span>数据查询命中 <strong>{{ dataHits.length }}</strong> 个源</span>
        <button class="ca-save-view sm" type="button" data-testid="data-query-hits-clear" @click="clearDataHits">清除</button>
      </div>
      <SourceOverviewView
        :key="dataHits.join(',')"
        class="ca-source-list"
        current-site-id=""
        :scope-source-ids="dataHits"
        @open-source="openSourceFromList"
        @open-source-data="openSourceFromList($event, 'data')"
        @open-site="openSiteFromList"
        @open-source-group="openSourceGroup"
      />
    </template>
    <template v-else>
    <FilterToolbar
      v-if="view === 'card'"
      v-model:keyword="keyword"
      v-model:category-filter="categoryFilter"
      v-model:tag-filter="tagFilter"
      :error-only="stateFilter === 'error'"
      :empty-count="scope === 'all' ? emptyCount : 0"
      :empty-only="emptyOnly"
      :filtered="hasFilter"
      :categories="categories"
      :all-tags="allTags"
      :total="total"
      :stats="toolbarStats"
      :view="view"
      @filter-change="resetAndLoad"
      @toggle-error-only="toggleErrorOnly"
      @toggle-empty-only="toggleEmptyOnly"
      @refresh="onToolbarRefresh"
      @set-view="setView"
      @create-site="openSiteCreator"
    />

    <!-- 卡片视图 -->
    <div v-if="view === 'card'" v-loading="loading && !!sites.length" class="ca-card-body">
      <SiteCardGrid :sites="sites" :loading="loading" :empty-text="emptyText" @open-editor="openSiteEditor" @delete-site="onDeleteSite" />
    </div>

    <!-- 源列表视图（0924-06）：一行一个源，复用网站详情的「源视图」，不限网站 -->
    <div v-else class="ca-dir-layout" :class="{ 'with-dir': showDirPanel, collapsed: dirCollapsed }">
    <SourceDirPanel v-if="showDirPanel" ref="dirPanelRef" v-model:collapsed="dirCollapsed" class="ca-dir-panel" @change="onDirScope" />
    <SourceOverviewView
      ref="overviewRef"
      class="ca-source-list"
      current-site-id=""
      :scope-site-ids="sourceScopeSiteIds"
      :scope-source-ids="listScopeSourceIds"
      :scope-category-ids="listScopeCategoryIds"
      :scope-label="dirScopeLabel || undefined"
      :scope-version="dirScopeVersion"
      :scope-empty-text="listScopeEmptyText"
      :extra-column-label="scope === 'all' ? '业务目录' : undefined"
      :quick-edit="scope === 'all'"
      :group-ops="scope === 'all'"
      @open-source="openSourceFromList"
      @open-source-data="openSourceFromList($event, 'data')"
      @open-site="openSiteFromList"
      @open-source-group="openSourceGroup"
    >
      <template v-if="scope === 'all'" #selection-actions="{ ids }">
        <button class="ca-save-view sm" type="button" data-testid="source-add-to-view" @click="openAddToView(ids)">加入视图目录</button>
      </template>
      <template v-if="scope === 'all'" #summary-extra>
        <span v-if="dirActive" class="ca-dir-scope" :class="{ biz: dirScope.kind === 'biz' }" :title="dirLabelTip" data-testid="dir-scope">
          · {{ dirKindLabel }}：<b>{{ dirLabelText }}</b><template v-if="dirWithSub">（含子级）</template>
          <button class="ca-dir-link" type="button" data-testid="dir-scope-clear" @click="dirPanelRef?.clear()">清除</button>
        </span>
        <!-- 业务目录下暂不提供按目录发送 / 定时（10-21 用户） -->
        <el-dropdown v-if="dirActive && dirScope.kind === 'sys'" trigger="click" data-testid="dir-ops" @command="onDirCommand">
          <button class="ca-save-view sm" type="button">按目录 ▾</button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="send" data-testid="dir-ops-send">按目录发送</el-dropdown-item>
              <el-dropdown-item command="schedule" data-testid="dir-ops-schedule">按目录更新定时</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </template>
      <template v-if="scope === 'all' && showDirPanel && dirScope.kind === 'biz'" #summary-ops="{ ids }">
        <el-dropdown trigger="click" data-testid="biz-ops" @command="(command: 'add' | 'move' | 'template') => (command === 'add' ? openBizPicker(ids) : command === 'move' ? openBizMove(ids) : openBizTemplate(ids))">
          <button class="ca-save-view sm" type="button">目录归类 ▾</button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="add" data-testid="source-pick-for-biz">加入业务目录…</el-dropdown-item>
              <el-dropdown-item command="move" :disabled="!canMoveBiz || !ids.length" data-testid="source-move-biz">{{ canMoveBiz && ids.length ? `移到其他业务目录…（${ids.length} 个）` : '移到其他业务目录…（先在左侧点一个目录，再勾选源）' }}</el-dropdown-item>
              <el-dropdown-item command="template" :disabled="!canMoveBiz || ids.length !== 1" data-testid="source-template-import-biz">{{ !canMoveBiz ? '按模板批量新增…（先在左侧点一个目录）' : ids.length !== 1 ? '按模板批量新增…（请只勾选一个源作为模板）' : '按模板批量新增…' }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </template>
      <template v-if="scope === 'all'" #extra-cell="{ source }">
        <span v-for="name in bizNames(source.sourceId)" :key="name" class="ca-biz-tag">{{ name }}</span>
        <span v-if="!bizNames(source.sourceId).length" class="ca-muted">—</span>
      </template>
      <template #filter-extra>

        <FilterToolbar
          keyword=""
          :category-filter="[]"
          tag-filter=""
          :categories="[]"
          :all-tags="[]"
          :total="0"
          :stats="toolbarStats"
          :view="view"
          source-mode
          @set-view="setView"
          @refresh="onToolbarRefresh"
        />
      </template>
    </SourceOverviewView>
    </div>
    </template>
    <AddToViewDialog v-model="addToView.open" :source-ids="addToView.ids" @added="onAddedToView" />
    <BizDirPickerDialog v-if="bizPicker.open" :initial-source-ids="bizPicker.ids" :initial-directory-ids="defaultBizDirIds" @close="bizPicker.open = false" @saved="afterBizChanged" />
    <BizDirMoveDialog v-if="bizMove.open" :source-ids="bizMove.ids" :from-dir-ids="dirScope.dirIds" :from-label="`${dirLabelText}${dirWithSub ? '（含子级）' : ''}`" @close="bizMove.open = false" @saved="afterBizChanged" />
    <BizTemplateImportDialog v-if="bizTemplate.open" :template-id="bizTemplate.templateId" :dir-id="bizTemplate.dirId" :dir-label="dirLabelText" @close="bizTemplate.open = false" @saved="afterBizChanged" />
    <CategoryScheduleModal ref="scheduleRef" />

    <!-- 卡片视图分页：**常驻**，与表格视图一致（2026-09-18）。
         原来带 `total > size` 的条件，每页改成 50 之后 25 个网站正好一页装下，
         整条分页就消失了——连「共 N 条」和每页条数选择器一起没了，看着像功能丢了。
         单页时 el-pagination 自己会把页码收成一个，不占额外空间。 -->
    <div v-if="view === 'card' && !dataHits" class="ca-pager card-mode">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="size"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        background
        small
        @current-change="loadList"
        @size-change="() => { page = 1; loadList() }"
      />
    </div>

    <!-- 性能审查 P2-2：editorVisible=false 时不挂载 SiteEditorDialog，避免其内部 fetch + watch 提前跑 -->
    <SiteEditorDialog
      v-if="editorVisible"
      v-model:visible="editorVisible"
      :site="editorSite"
      :categories="categories"
      :mode="editorMode"
      @saved="onEditorSaved"
    />
  </div>
</template>

<style scoped>
.ca-page { display: flex; flex-direction: column; gap: 12px; }
/* 源列表视图才撑满、交给表格自己滚动；卡片视图保持自然高度随页面滚——
   撑满会把卡片区压在一屏里，溢出的卡片和底部分页条叠在一起（2026-09-24 用户截图） */
.ca-page.is-list { flex: 1; min-height: 0; }
/* 源视图组件自带灰底内边距（在网站详情里是整块主区），放进采集资产去掉，和工具条对齐 */
.ca-source-list { padding: 0; background: transparent; }
.ca-save-view { height: 34px; padding: 0 12px; border: 1px solid #d5e2f2; border-radius: 8px; background: #fff; color: var(--rc-text-2); font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.ca-save-view.sm { height: 30px; padding: 0 10px; border-radius: 6px; font-size: 12px; }
.ca-save-view:hover { border-color: var(--rc-primary); color: var(--rc-primary); }

/* 系统目录页签：左侧目录面板 + 源列表（2026-10-21） */
.ca-dir-layout { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.ca-dir-layout.with-dir { display: grid; grid-template-columns: 252px minmax(0, 1fr); gap: 12px; align-items: stretch; }
.ca-dir-layout.with-dir.collapsed { grid-template-columns: 36px minmax(0, 1fr); }
.ca-dir-panel { min-height: 0; max-height: 100%; align-self: start; }
.ca-dir-layout > .ca-source-list { min-width: 0; min-height: 0; }
.ca-dir-scope { color: var(--rc-text-2); font-size: 13px; }
.ca-dir-scope b { color: var(--rc-primary); font-weight: 600; }
.ca-dir-scope.biz b { color: #7c3aed; }
.ca-dir-link { margin-left: 6px; border: 0; background: none; padding: 0; color: var(--rc-primary); font-size: 12px; cursor: pointer; }
.ca-biz-tag { display: inline-block; margin-right: 4px; padding: 0 6px; border-radius: 4px; background: #f5f3ff; color: #7c3aed; font-size: 12px; line-height: 18px; }
.ca-muted { color: var(--rc-faint); }
@media (max-width: 900px) {
  .ca-dir-layout.with-dir, .ca-dir-layout.with-dir.collapsed { grid-template-columns: 1fr; }
}
.ca-card-body { min-height: 200px; }
.ca-hits-bar { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border: 1px solid #bfdbfe; border-radius: 8px; background: var(--rc-primary-bg); color: var(--rc-text-2); font-size: 13px; }
.ca-hits-bar strong { color: var(--rc-primary-ink); }

.ca-pager { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 10px 16px; }
/* 0930-01：分页条钉在视口底部。原来跟在卡片后面，翻页时卡片高度一变它就跟着跳，
   连点「下一页」会点到卡片上、进了网站 */
.ca-pager.card-mode { position: sticky; bottom: 0; z-index: 2; justify-content: center; border-top: 0; padding: 8px 0; background: linear-gradient(180deg, rgba(248, 250, 252, 0) 0%, rgba(248, 250, 252, 0.96) 40%); }
</style>
