<script setup lang="ts">
import { computed, onActivated, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { sourceApi, siteApi, expandCategoryIds, type Site, type SourceCategory } from '@/api'
import { useUiStore } from '@/stores/ui'
import { confirmDanger } from '@/utils/confirmDanger'
import { favoriteSiteIds, loadFavoriteSites } from '@/utils/siteFavorites'
import { recentRankOf, recentSiteIds } from '@/utils/siteRecents'
import SiteCardGrid from './SiteCardGrid.vue'
import FilterToolbar from './components/FilterToolbar.vue'
import BatchBar from './components/BatchBar.vue'
import TableView from './components/TableView.vue'
import SiteEditorDialog from './components/SiteEditorDialog.vue'
import CategoryManageDrawer from './components/CategoryManageDrawer.vue'
import { beginSitesFetch, collectAssetsCache, clearCollectAssetsCache, commitSites } from './siteListCache'

/**
 * `favOnly`：由「我收藏的网站」tab 传进来（`CollectAssets/index.vue`）。
 * 为 true 时这一页**恒定只看收藏**，工具条里也不再出现那个可关掉的选项——
 * 在"我收藏的网站"里还能切成"看全部"是自相矛盾的。
 */
const props = defineProps<{ favOnly?: boolean }>()

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
const stateFilter = ref('all')
const sortBy = ref<'updated' | 'name'>('updated')
/** 只看收藏（0917-17）。「网站列表」tab 里默认关（收藏的照样恒排最前）；
 *  「我收藏的网站」tab 里由 props 锁成 true。 */
const favOnly = ref(props.favOnly === true)
watch(() => props.favOnly, (val) => {
  favOnly.value = val === true
  applyView()
})
/** 只看最近打开（0917-17 后半条）。与 favOnly 互斥，由工具条那个下拉统一切换 */
const recentOnly = ref(false)

/**
 * 当前是否带着筛选条件（2026-09-21 用户报「根据条件查询完后，条数没有更新」）。
 * 带着条件时「网站」写成「命中 / 全站」（如「71 / 83」）。
 */
const hasFilter = computed(() => !!keyword.value.trim()
  || categoryFilter.value.length > 0
  || !!tagFilter.value
  || stateFilter.value !== 'all'
  || favOnly.value
  || recentOnly.value)

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

// ---- 分类管理抽屉（2026-09-21：仅在「全部分类」下拉底部入口唤起） ----
const categoryDrawerVisible = ref(false)
async function onCategoryRefresh() {
  clearCollectAssetsCache()
  await loadCategories()
  await loadList({ force: true })
}

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
  const byCurrent = sortBy.value === 'name'
    ? (a: Site, b: Site) => a.name.localeCompare(b.name, 'zh')
    // updatedAt 是 'YYYY-MM-DD HH:mm:ss'，定长且高位在前，字符串倒序即时间倒序
    : (a: Site, b: Site) => (b.updatedAt || '').localeCompare(a.updatedAt || '')
  // 收藏的**恒排最前**（0917-17），不做成排序下拉的第三档：用户自己点的星本来就该在前，
  // 再要求他先选一次才生效是多余的，而且会跟「最近修改 / 名称」这个正交维度打架
  //（选了"收藏优先"，组内按什么排就说不清了）。组内仍按当前排序。
  return [...list].sort((a, b) => {
    const fa = favoriteSiteIds.value.has(a.siteId) ? 0 : 1
    const fb = favoriteSiteIds.value.has(b.siteId) ? 0 : 1
    return fa !== fb ? fa - fb : byCurrent(a, b)
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
  const isDefaultQuery = !search && !categoryFilter.value.length && !tagFilter.value && stateFilter.value === 'all'

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
      state: stateFilter.value,
      sort: sortBy.value,
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
async function loadCategories() {
  if (collectAssetsCache.categories) {
    categories.value = collectAssetsCache.categories
    return
  }
  try {
    // 首屏只拉根分类（1个请求），子级由 FilterToolbar 的 el-tree-select 展开时按需懒加载；
    // 不再首屏扇出十几个请求把网络打满
    const roots = await sourceApi.sourceCategories()
    collectAssetsCache.categories = roots
    categories.value = roots
  } catch {
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
  selectedIds.value = []
  loadList()
}
async function refreshAll() {
  clearCollectAssetsCache()
  await Promise.all([loadList({ force: true }), loadStats(), loadCategories(), loadTagOptions()])
}

// ---- 筛选辅助 ----
// ---- 视图偏好 ----
const view = computed(() => ui.assetView)
function setView(v: 'card' | 'table') {
  ui.setAssetView(v)
}

// ---- 选中状态 ----
const selectedIds = ref<string[]>([])

// ---- 搜索 debounce（300ms）----
let kwTimer: ReturnType<typeof setTimeout> | undefined
function onKeywordChange() {
  clearTimeout(kwTimer)
  kwTimer = setTimeout(() => resetAndLoad(), 300)
}
watch(keyword, onKeywordChange)

// ---- 批量操作 ----
function requireSelection(): boolean {
  if (!selectedIds.value.length) {
    ElMessage.warning('请先在表格视图勾选网站或源')
    return false
  }
  return true
}

function onBatchSnatch() {
  if (!requireSelection()) return
  confirmDanger('批量发任务', `将向选中的 ${selectedIds.value.length} 个源下发抓取任务，是否继续？`, () =>
    sourceApi.sendSnatch(selectedIds.value),
  )
}

function onBatchDelete() {
  if (!requireSelection()) return
  confirmDanger('批量删除（高危）', `将删除选中的 ${selectedIds.value.length} 个源，删除后不可恢复，是否继续？`, () =>
    sourceApi.deleteSource(selectedIds.value),
  )
}

function onOperate(cmd: string) {
  if (!requireSelection()) return
  const map: Record<string, string> = {
    success: '改为成功状态', enable: '启用', disable: '禁用', delete: '删除',
    schedule: '批量定时', modify: '批量改配置',
  }
  if (cmd === 'delete') return onBatchDelete()
  if (cmd === 'success' || cmd === 'enable' || cmd === 'disable') {
    return confirmDanger(`${map[cmd]}（${selectedIds.value.length} 个源）`, `确认对选中源执行「${map[cmd]}」？`, async () => {
      let failed = 0
      for (const id of selectedIds.value) {
        const r = cmd === 'success'
          ? await sourceApi.changeToSuccess(id)
          : await sourceApi.changeSourceEnable(id, cmd !== 'enable')
        if (!r?.ok) failed++
      }
      await loadList({ force: true })
      await loadStats({ force: true })
      return failed
        ? { message: `已处理 ${selectedIds.value.length - failed} 个、失败 ${failed} 个（演示）` }
        : { message: `已对 ${selectedIds.value.length} 个源执行「${map[cmd]}」（演示）` }
    })
  }
  confirmDanger(`${map[cmd]}（${selectedIds.value.length} 个源）`, `确认对选中源执行「${map[cmd]}」？`, () =>
    cmd === 'modify'
      ? sourceApi.batchModifyConfig(selectedIds.value, '-')
      : cmd === 'schedule'
        ? sourceApi.batchSchedule(selectedIds.value)
        : sourceApi.changeSourceEnable(selectedIds.value[0], cmd !== 'enable'),
  )
}

function onMonitor(cmd: string) {
  if (!requireSelection()) return
  if (cmd.startsWith('freq')) {
    const tag = cmd.replace('freq-', '')
    return confirmDanger('频率标识', `将选中源频率标识设为「${tag}」？`, () => sourceApi.changeFreqTag(selectedIds.value, tag))
  }
  const verb = cmd === 'normal' ? '人工核验已正常' : '人工标为异常'
  confirmDanger(verb, `确认对选中源执行「${verb}」？`, () => sourceApi.markVerified(selectedIds.value, cmd))
}

// ---- 网站编辑 / 新建 ----
function openSiteEditor(site: Site) {
  editorMode.value = 'edit'
  editorSite.value = site
  editorVisible.value = true
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
  clearCollectAssetsCache()
  if (newSiteId) page.value = 1
  await loadList({ force: true })
}

// 新建采集
function openNewFlowCanvas() {
  router.push({ path: '/canvas', query: { mode: 'new' } })
}

// ---- 顶部模块按钮接线 ----
onMounted(() => {
  const qs = String(route.query.state ?? '')
  if (VALID_STATES.includes(qs)) stateFilter.value = qs
  // 总览「资产类型分布」按分类下钻（DistributionPanel 带来的 ?category=<id>）——此前没接，
  // 下钻过来分类筛选是静默丢的。多选口径下预置成一个勾选项。
  const qc = String(route.query.category ?? '')
  if (qc) categoryFilter.value = qc.split(',').map((s) => s.trim()).filter(Boolean)
  // 并发优化：优先发起核心列表与统计请求；分类与标签后置并发，不再产生扇出请求风暴
  void loadStats({ revalidate: true })
  void loadList({ revalidate: true })
  // 收藏以后端为准（B30）；回来后 watch(favoriteSiteIds) 会就地重排，不用等它
  void loadFavoriteSites()
  void loadCategories()
  void loadTagOptions()
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
  void loadFavoriteSites()
  void loadStats({ revalidate: true })
  void loadList({ revalidate: true })
})
onUnmounted(() => {
  ui.clearActions()
  clearTimeout(kwTimer)
})
</script>

<template>
  <div class="ca-page">
    <FilterToolbar
      v-model:keyword="keyword"
      v-model:category-filter="categoryFilter"
      v-model:tag-filter="tagFilter"
      v-model:state-filter="stateFilter"
      v-model:sort-by="sortBy"
      v-model:fav-only="favOnly"
      v-model:recent-only="recentOnly"
      :fav-count="favoriteSiteIds.size"
      :recent-count="recentSiteIds.length"
      :fav-locked="props.favOnly === true"
      :filtered="hasFilter"
      :categories="categories"
      :all-tags="allTags"
      :total="total"
      :stats="toolbarStats"
      :view="view"
      @filter-change="resetAndLoad"
      @refresh="refreshAll"
      @set-view="setView"
      @create-site="openSiteCreator"
      @open-category-manager="categoryDrawerVisible = true"
    />

    <BatchBar
      :selected-count="selectedIds.length"
      @batch-snatch="onBatchSnatch"
      @batch-delete="onBatchDelete"
      @operate="onOperate"
      @monitor="onMonitor"
      @clear-selection="() => { selectedIds = [] }"
    />

    <!-- 卡片视图 -->
    <div v-if="view === 'card'" v-loading="loading && !!sites.length" class="ca-card-body">
      <SiteCardGrid :sites="sites" :loading="loading" @open-editor="openSiteEditor" />
    </div>

    <!-- 表格视图 -->
    <TableView
      v-else
      :sites="sites"
      :loading="loading"
      :total="total"
      :page="page"
      :size="size"
      :selected-ids="selectedIds"
      @update:page="(p: number) => { page = p; loadList() }"
      @update:size="(s: number) => { size = s }"
      @update:selected-ids="(ids: string[]) => { selectedIds = ids }"
      @open-editor="openSiteEditor"
    />

    <!-- 卡片视图分页：**常驻**，与表格视图一致（2026-09-18）。
         原来带 `total > size` 的条件，每页改成 50 之后 25 个网站正好一页装下，
         整条分页就消失了——连「共 N 条」和每页条数选择器一起没了，看着像功能丢了。
         单页时 el-pagination 自己会把页码收成一个，不占额外空间。 -->
    <div v-if="view === 'card'" class="ca-pager card-mode">
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

    <!-- 分类管理抽屉：仅在「全部分类」下拉底部入口唤起 -->
    <CategoryManageDrawer
      v-model="categoryDrawerVisible"
      @refresh="onCategoryRefresh"
    />
  </div>
</template>

<style scoped>
.ca-page { display: flex; flex-direction: column; gap: 12px; }

.ca-card-body { min-height: 200px; }

.ca-pager { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 10px 16px; }
.ca-pager.card-mode { border-top: 0; padding: 0; }
</style>
