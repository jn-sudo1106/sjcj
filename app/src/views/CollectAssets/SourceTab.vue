<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { sourceApi, siteApi, type Site, type SourceCategory } from '@/api'
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
const stats = reactive({ total: 0, error: 0, externalChanged: 0, disabled: 0 })

// ---- 筛选 ----
const keyword = ref('')
const categoryFilter = ref('')
const tagFilter = ref('')
const stateFilter = ref('all')
const sortBy = ref<'updated' | 'name'>('updated')

// ---- 网站列表 / 分页 ----
const sites = ref<Site[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(10)
const loading = ref(false)

// ---- 表格视图 ref ----
const editorVisible = ref(false)
const editorSite = ref<Site | null>(null)

// ---- 加载 ----
async function loadList() {
  loading.value = true
  try {
    const res = await siteApi.sitePaged({
      category: categoryFilter.value,
      keyword: keyword.value,
      tag: tagFilter.value,
      state: stateFilter.value,
      sort: sortBy.value,
      page: page.value,
      size: size.value,
    })
    sites.value = res.list
    total.value = res.total
  } catch {
    ElMessage.warning('加载网站列表失败')
    sites.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}
async function loadCategories() {
  try {
    categories.value = await sourceApi.sourceCategories()
  } catch {
    ElMessage.warning('加载分类失败')
    categories.value = []
  }
}
async function loadStats() {
  try {
    Object.assign(stats, await sourceApi.sourceStats())
  } catch {
    ElMessage.warning('加载统计失败')
  }
}
async function loadTagOptions() {
  try {
    // TODO: 后端加 /api/site/tags 轻量接口替代（性能审查 P0-2）
    // 当前用 size: 999 拉全量只为取 tags 去重集合，数据量大时浪费
    const res = await siteApi.sitePaged({ size: 999 })
    const set = new Set<string>()
    res.list.forEach((s) => (s.tags ?? []).forEach((t) => set.add(t)))
    allTags.value = [...set].sort()
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
const hasFilter = computed(
  () => !!categoryFilter.value || !!keyword.value || !!tagFilter.value || stateFilter.value !== 'all',
)
function clearFilters() {
  categoryFilter.value = ''
  keyword.value = ''
  tagFilter.value = ''
  stateFilter.value = 'all'
  resetAndLoad()
}

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

// ---- 批量操作 ----
function requireSelection(): boolean {
  if (!selectedIds.value.length) {
    ElMessage.warning('请先在表格视图勾选网站或子源')
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

// ---- 网站编辑 ----
function openSiteEditor(site: Site) {
  editorSite.value = site
  editorVisible.value = true
}

async function onEditorSaved() {
  // 性能审查 P1-3：编辑网站只改名称/分类/负责人，不改标签，删除 loadTagOptions 调用
  // 标签列表在 mount 时加载一次即可（标签通过新建网站/其他途径才能变更）
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
      :has-filter="hasFilter"
      @update:keyword="onKeywordChange"
      @filter-change="resetAndLoad"
      @clear-filters="clearFilters"
      @refresh="refreshAll"
      @set-view="setView"
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
      <SiteCardGrid :sites="sites" />
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

    <!-- 卡片视图分页 -->
    <div v-if="view === 'card' && total > size" class="ca-pager card-mode">
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
