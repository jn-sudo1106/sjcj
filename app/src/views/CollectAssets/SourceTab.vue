<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { sourceApi, siteApi, expandCategoryIds, type Site, type SourceCategory } from '@/api'
import { useUiStore } from '@/stores/ui'
import { confirmDanger } from '@/utils/confirmDanger'
import SiteCardGrid from './SiteCardGrid.vue'
import FilterToolbar from './components/FilterToolbar.vue'
import BatchBar from './components/BatchBar.vue'
import TableView from './components/TableView.vue'
import SiteEditorDialog from './components/SiteEditorDialog.vue'

const ui = useUiStore()
const route = useRoute()
const router = useRouter()

// 总览页下钻：?state=E / external / disabled 预置筛选
const VALID_STATES = ['all', 'error']

// ---- 分类 / 标签 / 统计 ----
const categories = ref<SourceCategory[]>([])
const allTags = ref<string[]>([])
const stats = reactive({ total: 0, error: 0, notify: 0 })

// ---- 筛选 ----
const keyword = ref('')
// 分类多选（目录 ID 数组，空 = 全部）；查询时拼成旧契约 categoryIds 的逗号串
const categoryFilter = ref<string[]>([])
const tagFilter = ref('')
const stateFilter = ref('all')
const sortBy = ref<'updated' | 'name'>('updated')

// ---- 网站列表 / 分页 ----
const sites = ref<Site[]>([])
const total = ref(0)
const page = ref(1)
/**
 * 每页 50（2026-09-18 用户提：「卡片类的是不是默认 50 条会好一点」）。
 *
 * 网站列表本来就是**一次全量拉回、前端分页**（见下方 loadList 的说明），翻页不产生新的
 * 列表请求；而卡片一屏能排 8~12 张，10 条/页意味着 25 个网站要翻 3 次。50 一页到底。
 * 页大小选项仍是 10/20/50，想要更少自己调。
 */
const size = ref(50)
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
  return [...list].sort(sortBy.value === 'name'
    ? (a, b) => a.name.localeCompare(b.name, 'zh')
    // updatedAt 是 'YYYY-MM-DD HH:mm:ss'，定长且高位在前，字符串倒序即时间倒序
    : (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
}

// 筛选条件连着变（改关键词又马上改分类、翻页）会有多次 loadList 同时在飞，
// 而它们的完成顺序跟发起顺序无关——慢的那次后回来就会把新结果盖掉，列表显示的是过期内容。
// 只认最后一次发起的请求，其余的结果直接丢弃。
let listRequestSeq = 0

async function loadList() {
  const seq = ++listRequestSeq
  loading.value = true
  try {
    // 勾一个分类要连它下面的子分类一起筛（后端 categoryIds 只精确匹配本级，不含子级；
    // 分类树又是懒加载的，未展开的子级 ID 前端手里没有）——交给 expandCategoryIds 把子树拉全。
    const filters = {
      category: (await expandCategoryIds(categoryFilter.value)).join(','),
      tag: tagFilter.value,
      state: stateFilter.value,
      sort: sortBy.value,
    }
    const search = keyword.value.trim()
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
    list = sortSites(list)
    if (seq !== listRequestSeq) return
    const start = (page.value - 1) * size.value
    sites.value = list.slice(start, start + size.value)
    total.value = list.length
  } catch {
    if (seq !== listRequestSeq) return
    ElMessage.warning('加载网站列表失败')
    sites.value = []
    total.value = 0
  } finally {
    // 已经有更新的请求在飞时不要关 loading，否则转圈会提前消失
    if (seq === listRequestSeq) loading.value = false
  }
}
async function loadCategories() {
  try {
    // 旧分类接口首屏只返回根节点（categoryPaged 不带 parentId 的实测行为，画布侧
    // SiteSourceSwitcher 同款修法）：再按 parentId 并行补一层子级，查询树首屏两级立即可见，
    // SiteEditorDialog 的两级分类下拉也有选项。更深层级由 FilterToolbar 分类树展开时懒加载。
    const roots = await sourceApi.sourceCategories()
    await Promise.all(roots.map(async (root) => {
      root.children = await sourceApi.sourceCategories(root.id)
    }))
    categories.value = roots
  } catch {
    ElMessage.warning('加载分类失败')
    categories.value = []
  }
}
async function loadStats() {
  try {
    const summary = await siteApi.siteSummary()
    Object.assign(stats, {
      total: summary.sourceTotal,
      error: summary.errorCount,
      notify: summary.notifyCount,
    })
  } catch {
    ElMessage.warning('加载网站统计失败')
  }
}
async function loadTagOptions() {
  try {
    // 0915-14：改用后端 2026-09-16 交付的 site/siteTags（返回的就是拆分去重后的数组）。
    // 此前是 sitePaged({size:999}) 拉全量网站再前端聚合——那个 TODO（性能审查 P0-2）到此为止；
    // 而且在后端加 tags 字段之前，聚合出来的集合**恒为空**，这个下拉一直是个空壳。
    allTags.value = await siteApi.siteTags()
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
  await Promise.all([loadList(), loadStats()])
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
      await loadList()
      await loadStats()
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
  if (newSiteId) page.value = 1
  await loadList()
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
  loadCategories()
  loadStats()
  loadTagOptions()
  loadList()
  ui.registerAction('新建采集', openNewFlowCanvas)
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
      :categories="categories"
      :all-tags="allTags"
      :total="total"
      :stats="stats"
      :view="view"
      @filter-change="resetAndLoad"
      @refresh="refreshAll"
      @set-view="setView"
      @create-site="openSiteCreator"
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
    <div v-if="view === 'card'" v-loading="loading" class="ca-card-body">
      <SiteCardGrid :sites="sites" @open-editor="openSiteEditor" />
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
  </div>
</template>

<style scoped>
.ca-page { display: flex; flex-direction: column; gap: 12px; }

.ca-card-body { min-height: 200px; }

.ca-pager { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 10px 16px; }
.ca-pager.card-mode { border-top: 0; padding: 0; }
</style>
