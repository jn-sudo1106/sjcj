<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, CaretBottom, CaretTop, CopyDocument, Delete, Download, Key, Odometer, RefreshRight, Star, StarFilled, SwitchButton } from '@element-plus/icons-vue'
import { entryApi, sourceApi, type EntryType } from '../../api'
import { useAuthStore } from '../../stores/auth'
import { getEffectiveWidth } from '../../constants/entry'
import { exportFieldsAsCsv } from '@/utils/format/csvExport'
import EntryEditorDrawer from './EntryEditorDrawer.vue'
import { withoutComposition } from '@/utils/enterKey'
import { copyToClipboard } from '@/utils/clipboard'
import { favoriteEntryIds, isFavoriteEntry, loadFavoriteEntries, toggleFavoriteEntry } from '@/utils/entryFavorites'

// 迁移方案 §1.6/§5-2：read 角色隐藏全部写入口（含旧只读页遗留的「新建」按钮，判为旧遗漏，不迁）。
const auth = useAuthStore()
const canWrite = computed(() => auth.role === 'admin')

const route = useRoute()

const list = ref<EntryType[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(20)
const loading = ref(false)
// §1.3-1：ID/名称两个独立框；enable 初始 '0'，重置后不带，不新增状态筛选下拉。
const entryTypeIdFilter = ref('')
const nameFilter = ref('')
const enableFilter = ref<string | undefined>('0')
const selected = ref<string[]>([])
const drawer = reactive<{ visible: boolean; entry: EntryType | null }>({ visible: false, entry: null })
// 1013-表详情数据统计：后端 CfgEntryType 不返回数据量（详情/列表接口都没有 dataCnt 字段，
// 实体表 cfg_entry_type 也无存量的列），真实数据量在 cs_source.DATA_CNT（每源数据条数，存储过程
// calc_this_cnt 算出，只有点过「重新计算数据量」的表才有值）。所以打开详情时用现有 sourceApi 拉
// 该表所有源，把每源 dataCount 求和，作为「数据条数」；没有统计值的表显示「— 未统计」而非误导性的「0 行」。
const detailStats = reactive<{ dataCount?: number; sourceCount: number; loaded: boolean }>({
  dataCount: undefined,
  sourceCount: 0,
  loaded: false,
})
const editor = reactive<{ visible: boolean; entry: EntryType | null }>({ visible: false, entry: null })
const extractDialog = reactive<{ visible: boolean; text: string; count: number }>({ visible: false, text: '', count: 0 })

// ---- 1013：全量拉取 + 前端列头排序 + 只看收藏 ----
// 后端 entryTypePagedView 不支持排序（Service 硬编码 ENTRY_TYPE_ID DESC，见设计文档 §一），
// 实体表量级小（186 库未删除 90 张），一次拉全量再前端排序分页，跨页顺序稳定（网站列表同套路）。
const LIST_FETCH_SIZE = 2000
/** 这一轮请求拉回来的全量（已按 ID/名称过滤，**未**按收藏过滤、未排序、未切片） */
const fetchedEntries = ref<EntryType[]>([])
/** 只看收藏开关 */
const favOnly = ref(false)
/** 当前排序列与方向；默认表ID倒序（与后端现状一致） */
const sortKey = ref<'tableId' | 'name' | 'tableName' | 'keyField' | 'state' | 'updatedAt'>('tableId')
const sortDir = ref<'asc' | 'desc'>('desc')

/** 排序列取值：表ID/数字按数字比，其余按字符串（updatedAt 是定长 'YYYY-MM-DD HH:mm:ss'，字符串序即时间序） */
function sortValue(e: EntryType, key: typeof sortKey.value): string | number {
  switch (key) {
    case 'tableId': return Number(e.tableId) || 0
    case 'name': return e.name || ''
    case 'tableName': return e.tableName || ''
    case 'keyField': return e.keyField || ''
    case 'state': return e.state || ''
    case 'updatedAt': return e.updatedAt || ''
    default: return ''
  }
}

/** 从 fetchedEntries 重算展示：只看收藏 → 排序 → 切片。不发请求。 */
function applyView() {
  let base = fetchedEntries.value
  if (favOnly.value) base = base.filter((e) => favoriteEntryIds.value.has(e.tableId))
  const dir = sortDir.value === 'asc' ? 1 : -1
  const sorted = [...base].sort((a, b) => {
    const av = sortValue(a, sortKey.value)
    const bv = sortValue(b, sortKey.value)
    if (av === bv) return 0
    // 表ID按数值比；其余字符串列（表名称/物理表名/去重字段/状态/更新时间）用 localeCompare，
    // 中文按拼音/字典序（码点序对中文不直观，用户实测「表名称」正倒序不对）。
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? (av < bv ? -1 : 1)
      : String(av).localeCompare(String(bv), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
    return dir * cmp
  })
  total.value = sorted.length
  const start = (page.value - 1) * size.value
  list.value = sorted.slice(start, start + size.value)
}

/** 收藏 / 只看收藏变了（本页点的）就地重排/重过滤，不重新请求 */
watch(favoriteEntryIds, applyView)

async function load() {
  loading.value = true
  try {
    // 全量拉取：一次 2000 覆盖当前量级；万一总量超过单页上限则翻页补拉（上限保护）
    const filters = {
      entryTypeId: entryTypeIdFilter.value.trim() || undefined,
      name: nameFilter.value.trim() || undefined,
      enable: enableFilter.value,
    }
    const first = await entryApi.entryPaged({ ...filters, page: 1, size: LIST_FETCH_SIZE })
    const all: EntryType[] = [...first.list]
    let p = 1
    while (first.total > all.length && p < 20) {
      p++
      const r = await entryApi.entryPaged({ ...filters, page: p, size: LIST_FETCH_SIZE })
      all.push(...r.list)
    }
    fetchedEntries.value = all
    applyView()
  } catch (error) {
    ElMessage.error(`加载实体表失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    loading.value = false
  }
}
function onSearch() { page.value = 1; void load() }
// §1.3-1：重置把查询条件清成 {}，之后查询不再携带 enable。
function onReset() {
  entryTypeIdFilter.value = ''
  nameFilter.value = ''
  enableFilter.value = undefined
  page.value = 1
  void load()
}
function onSize() { page.value = 1; applyView() }

/** 列头点击排序：同列切换方向，换列时表ID默认倒序、其余默认升序 */
function onSort(key: typeof sortKey.value) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = key === 'tableId' ? 'desc' : 'asc'
  }
  page.value = 1
  applyView()
}

/** 只看收藏开关：开启时确保收藏已从后端拉取（幂等），回到第一页重过滤 */
function onFavOnlyChange(value: string | number | boolean) {
  favOnly.value = Boolean(value)
  if (favOnly.value) void loadFavoriteEntries()
  page.value = 1
  applyView()
}

// §1.3-7：深链接 ?entryTypeId= 进入自动带入检索，并 watch 路由参数变化即时刷新。
watch(() => route.query.entryTypeId, (id) => {
  const value = typeof id === 'string' ? id : ''
  if (value) {
    entryTypeIdFilter.value = value
    page.value = 1
    void load()
  }
}, { immediate: true })

onMounted(() => {
  // 星标状态先拉（幂等），列表加载不受它阻塞
  void loadFavoriteEntries()
  if (!route.query.entryTypeId) void load()
})

// 显示后端返回的更新时间。统一走字符串截断（`yyyy-MM-dd HH:mm`）——
// 旧 `new Date(value.replace(/-/g, '/'))` 解析无时区后缀的字符串会跨时区漂移，
// 字符串截断避免此坑，且与 ParamTab / ConfigTab 口径一致。
// 详见 REVIEW-2026-07-24.md #3。
function formatDateTime(value?: string) {
  if (!value) return '—'
  return value.slice(0, 16)
}

async function openDetail(e: EntryType) {
  try {
    drawer.entry = await entryApi.entryDetail(e.tableId)
    drawer.visible = true
  } catch (error) {
    ElMessage.error(`加载实体表详情失败：${error instanceof Error ? error.message : String(error)}`)
    return
  }
  await loadDetailStats(e.tableId)
}
/** 数据统计：拉该表所有源，求和每源 dataCount（口径与后端 calc_this_cnt 的 cs_source.DATA_CNT 一致）。
 *  失败不影响详情主体展示，静默降级为「未统计」。 */
async function loadDetailStats(tableId: string) {
  detailStats.loaded = false
  detailStats.dataCount = undefined
  detailStats.sourceCount = 0
  try {
    const page = await sourceApi.sourcePaged({ entryTypeId: tableId, page: 1, size: 2000 })
    const sources = page.list ?? []
    detailStats.sourceCount = sources.length
    const total = sources.reduce((sum, s) => sum + (typeof s.dataCount === 'number' ? s.dataCount : 0), 0)
    detailStats.dataCount = sources.length > 0 && total > 0 ? total : undefined
  } catch {
    // 统计接口失败：保持未统计
  } finally {
    detailStats.loaded = true
  }
}
async function openEdit(e: EntryType) {
  try {
    editor.entry = await entryApi.entryDetail(e.tableId)
    editor.visible = true
  } catch (error) {
    ElMessage.error(`加载实体表详情失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
function openCreate() {
  editor.entry = null
  editor.visible = true
}
async function onEntrySaved() {
  await load()
}

async function confirmDanger(
  title: string,
  body: string,
  run: () => Promise<{ message?: string }>,
  opts: { successFallback?: string } = {},
) {
  try {
    await ElMessageBox.confirm(body, title, { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消' })
  } catch {
    return
  }
  try {
    const r = await run()
    ElMessage.success(r?.message || opts.successFallback || '操作成功')
    await load()
  } catch (error) {
    ElMessage.error(`操作失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

// §1.3-8：复制新表
async function onCopy(e: EntryType) {
  let tableName = ''
  try {
    const result = await ElMessageBox.prompt('请输入新的表名:', '复制新表', {
      inputValue: 'tb_',
      inputPlaceholder: '一般以tb_entry_开头',
      inputValidator: (value) => {
        const v = value?.trim()
        return (!!v && v !== 'tb_') || '请输入新的表名'
      },
    })
    tableName = result.value.trim()
  } catch {
    return
  }
  try {
    const ack = await entryApi.copyEntry(e.tableId, tableName)
    ElMessage.success(`复制成功:${ack?.message ?? ''}`)
    await load()
  } catch (error) {
    ElMessage.error(`复制失败,返回值:${error instanceof Error ? error.message : String(error)}`)
  }
}

// §1.3-8：物理表同步
async function onCheckTable(e: EntryType) {
  let sql: string[]
  try {
    sql = await entryApi.checkTable(e.tableId)
  } catch (error) {
    ElMessage.error(`检查表结构失败：${error instanceof Error ? error.message : String(error)}`)
    return
  }
  if (!Array.isArray(sql) || !sql.length) {
    ElMessage.success('表配置配置的字段与物理表一致')
    return
  }
  try {
    await ElMessageBox.confirm(
      `${sql.join('\n')}\n\n物理表结构与配置中的结构不一致，点击确定执行更新`,
      '结构差异',
      { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await entryApi.syncTable(e.tableId)
    ElMessage.success('物理表结构已更新')
    await load()
  } catch (error) {
    ElMessage.error(`同步失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

function onCalc(e: EntryType) {
  confirmDanger(
    '是否要强制计算数据表对应的源数据量',
    `如有手动删除表数据等操作，本次计算将强制修正源上数据量不一致的问题: ${e.tableId}`,
    () => entryApi.calcEntrySum(e.tableId),
  )
}
function onRebuildIndex(e: EntryType) {
  confirmDanger(
    '重建去重索引(谨慎使用!!）',
    `如变更去重字段后，本次将重新计算历史数据的去重索引: ${e.tableId}`,
    () => entryApi.rebuildIndex(e.tableId),
  )
}
function onState(e: EntryType) {
  const toAc = e.state !== 'AC'
  confirmDanger(
    toAc ? '正式态确认' : '改为测试态',
    toAc ? '【无法删数据】设置为正式态' : '【注意:可从页面中删除】,改为测试态',
    () => entryApi.markEntryType(e.tableId, toAc ? 'AC' : 'C'),
    { successFallback: '设置成功' },
  )
}
async function onExtractFields(e: EntryType) {
  try {
    const detail = await entryApi.entryDetail(e.tableId)
    extractDialog.count = detail.fields.length
    extractDialog.text = detail.fields
      .map((f) => `${f.prop}:${f.desc}:${getEffectiveWidth(f.width)}`)
      .join('\n')
    extractDialog.visible = true
  } catch (error) {
    ElMessage.error(`加载字段失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
// 同 SiteSourceSwitcher：原先自造的 navigator.clipboard 在 http 部署站上必然失败
// （非安全上下文不暴露这个 API），且没有 execCommand 兜底。统一走 utils/clipboard。
function copyExtractText() {
  void copyToClipboard(extractDialog.text)
}

function toggleSelected(tableId: string, checked: boolean) {
  selected.value = checked
    ? Array.from(new Set([...selected.value, tableId]))
    : selected.value.filter((id) => id !== tableId)
}
const allChecked = computed(() => !!list.value.length && list.value.every((e) => selected.value.includes(e.tableId)))
const pageIndeterminate = computed(() => !allChecked.value && list.value.some((e) => selected.value.includes(e.tableId)))
function togglePage(checked: boolean) {
  const pageIds = list.value.map((e) => e.tableId)
  selected.value = checked
    ? Array.from(new Set([...selected.value, ...pageIds]))
    : selected.value.filter((id) => !pageIds.includes(id))
}

// §1.3-8：批量重建
async function onBatchRebuild() {
  if (!selected.value.length) return
  const ids = selected.value.join(',')
  try {
    await ElMessageBox.confirm(
      `是否确定检查并重建物理表，数量:${selected.value.length}?, ids:${ids}`,
      '检查表结构提示',
      { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    const result = await entryApi.rebuildTable(selected.value)
    ElMessage.success(`处理成功:${result?.message ?? ''}`)
    selected.value = []
    await load()
  } catch (error) {
    ElMessage.error(`处理失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
// §1.3-8：批量删除
async function onBatchDelete() {
  if (!selected.value.length) return
  const ids = selected.value.join(',')
  try {
    await ElMessageBox.confirm(
      `是否确认要删除数据表，数量:${selected.value.length}?, ids:${ids}`,
      '提示',
      { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await entryApi.deleteEntries(selected.value)
    ElMessage.success(`删除成功，本次删除:${ids}`)
    selected.value = []
    await load()
  } catch (error) {
    ElMessage.error(`删除失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

// §1.5：导出字段 CSV（首轮以同列结构导出 CSV，不引入 xlsx 依赖）
function exportFields(e: EntryType) {
  exportFieldsAsCsv(e)
}

// 回车触发，但跳过中文输入法上屏时的 Enter（见 utils/enterKey.ts）
const onEnterSearch = withoutComposition(() => onSearch())
</script>

<template>
  <div class="rc-card et-main">
    <div class="rc-toolbar wrap">
      <el-input v-model="entryTypeIdFilter" clearable placeholder="表 ID" style="width: 150px" @keyup.enter="onEnterSearch" />
      <el-input v-model="nameFilter" clearable placeholder="表名称" style="width: 190px" @keyup.enter="onEnterSearch" />
      <button class="rc-btn" type="button" @click="onSearch">查询</button>
      <button class="rc-btn" type="button" @click="onReset">重置</button>
      <span class="et-spacer" />
      <!-- 1013：只看收藏开关（沿用项目轻量滑动开关 + 状态文字，见 AGENTS.md 控件视觉约定） -->
      <label class="et-fav-only" title="只看已收藏的表（收藏的星标在后，点操作列 ☆ 收藏）">
        <el-switch v-model="favOnly" size="small" aria-label="只看收藏" data-testid="entry-fav-only" @change="onFavOnlyChange" />
        <span class="et-fav-only-text">只看收藏</span>
      </label>
      <span class="muted">共 {{ total }} 张实体表</span>
      <template v-if="canWrite">
        <el-dropdown v-if="selected.length" trigger="click">
          <button class="rc-btn" type="button">更多<el-icon class="et-caret"><ArrowDown /></el-icon></button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item :icon="RefreshRight" @click="onBatchRebuild">检查并重建物理表<span style="margin-left: 4px; color: var(--rc-muted); font-size: 12px">（表不存在时自动新建）</span></el-dropdown-item>
              <el-dropdown-item :icon="Delete" divided style="color: #dc2626" @click="onBatchDelete">批量删除</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <button class="rc-btn primary" type="button" @click="openCreate">新建</button>
      </template>
    </div>

    <div v-loading="loading" class="rc-table-scroll et-table">
      <table class="rc-data-table">
        <thead>
          <tr>
            <th v-if="canWrite" style="width: 42px">
              <el-checkbox :model-value="allChecked" :indeterminate="pageIndeterminate" aria-label="选择本页" @change="togglePage" />
            </th>
            <th
              class="et-sortable"
              :class="{ 'is-sorted': sortKey === 'tableId' }"
              style="width: 90px"
              title="点击按表ID排序"
              @click="onSort('tableId')"
            >表ID<span class="et-sort-caret"><el-icon class="et-sort-up" :class="{ active: sortKey === 'tableId' && sortDir === 'asc' }"><CaretTop /></el-icon><el-icon class="et-sort-down" :class="{ active: sortKey === 'tableId' && sortDir === 'desc' }"><CaretBottom /></el-icon></span></th>
            <th
              class="et-sortable"
              :class="{ 'is-sorted': sortKey === 'name' }"
              title="点击按表名称排序"
              @click="onSort('name')"
            >表名称<span class="et-sort-caret"><el-icon class="et-sort-up" :class="{ active: sortKey === 'name' && sortDir === 'asc' }"><CaretTop /></el-icon><el-icon class="et-sort-down" :class="{ active: sortKey === 'name' && sortDir === 'desc' }"><CaretBottom /></el-icon></span></th>
            <th
              class="et-sortable"
              :class="{ 'is-sorted': sortKey === 'tableName' }"
              title="点击按物理表名排序"
              @click="onSort('tableName')"
            >物理表名<span class="et-sort-caret"><el-icon class="et-sort-up" :class="{ active: sortKey === 'tableName' && sortDir === 'asc' }"><CaretTop /></el-icon><el-icon class="et-sort-down" :class="{ active: sortKey === 'tableName' && sortDir === 'desc' }"><CaretBottom /></el-icon></span></th>
            <th
              class="et-sortable"
              :class="{ 'is-sorted': sortKey === 'keyField' }"
              style="width: 120px"
              title="点击按去重字段排序"
              @click="onSort('keyField')"
            >去重字段<span class="et-sort-caret"><el-icon class="et-sort-up" :class="{ active: sortKey === 'keyField' && sortDir === 'asc' }"><CaretTop /></el-icon><el-icon class="et-sort-down" :class="{ active: sortKey === 'keyField' && sortDir === 'desc' }"><CaretBottom /></el-icon></span></th>
            <th
              class="et-sortable"
              :class="{ 'is-sorted': sortKey === 'state' }"
              style="width: 70px"
              title="点击按状态排序"
              @click="onSort('state')"
            >状态<span class="et-sort-caret"><el-icon class="et-sort-up" :class="{ active: sortKey === 'state' && sortDir === 'asc' }"><CaretTop /></el-icon><el-icon class="et-sort-down" :class="{ active: sortKey === 'state' && sortDir === 'desc' }"><CaretBottom /></el-icon></span></th>
            <th>备注</th>
            <th
              class="et-sortable"
              :class="{ 'is-sorted': sortKey === 'updatedAt' }"
              style="width: 110px"
              title="点击按更新时间排序"
              @click="onSort('updatedAt')"
            >更新时间<span class="et-sort-caret"><el-icon class="et-sort-up" :class="{ active: sortKey === 'updatedAt' && sortDir === 'asc' }"><CaretTop /></el-icon><el-icon class="et-sort-down" :class="{ active: sortKey === 'updatedAt' && sortDir === 'desc' }"><CaretBottom /></el-icon></span></th>
            <th style="width: 170px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in list" :key="e.tableId">
            <td v-if="canWrite">
              <el-checkbox :model-value="selected.includes(e.tableId)" :aria-label="`选择表 ${e.tableId}`" @change="toggleSelected(e.tableId, $event)" />
            </td>
            <td>{{ e.tableId }}</td>
            <td>{{ e.name || '—' }}</td>
            <td>{{ e.tableName }}</td>
            <td>{{ e.keyField || '—' }}</td>
            <td>{{ e.state || '—' }}</td>
            <td>{{ e.remark || '—' }}</td>
            <td :title="e.updatedAt || ''">{{ formatDateTime(e.updatedAt) }}</td>
            <td>
              <!-- 1013：收藏星标（空心=未收藏，实心=已收藏；先改本地再发请求，失败回滚见 entryFavorites.ts） -->
              <button
                class="et-fav"
                :class="{ on: isFavoriteEntry(e.tableId) }"
                type="button"
                data-testid="entry-fav"
                :title="isFavoriteEntry(e.tableId) ? '取消收藏' : '收藏这张表（开启「只看收藏」可只显示收藏的表）'"
                :aria-pressed="isFavoriteEntry(e.tableId)"
                :aria-label="isFavoriteEntry(e.tableId) ? '取消收藏' : '收藏'"
                @click="toggleFavoriteEntry(e.tableId)"
              >
                <el-icon :size="13"><component :is="isFavoriteEntry(e.tableId) ? StarFilled : Star" /></el-icon>
              </button>
              <el-button link type="primary" size="small" @click="openDetail(e)">详情</el-button>
              <template v-if="canWrite">
                <el-button link type="primary" size="small" @click="openEdit(e)">编辑</el-button>
                <el-dropdown trigger="click">
                  <el-button link type="primary" size="small">更多<el-icon class="et-caret"><ArrowDown /></el-icon></el-button>
                  <template #dropdown><el-dropdown-menu>
                    <el-dropdown-item :icon="CopyDocument" @click="onCopy(e)">复制新表</el-dropdown-item>
                    <el-dropdown-item :icon="Download" @click="onExtractFields(e)">提取表字段</el-dropdown-item>
                    <el-dropdown-item :icon="RefreshRight" divided @click="onCheckTable(e)">同步物理表结构</el-dropdown-item>
                    <el-dropdown-item :icon="Odometer" @click="onCalc(e)">重新计算数据量</el-dropdown-item>
                    <el-dropdown-item :icon="Key" @click="onRebuildIndex(e)">重建去重索引</el-dropdown-item>
                    <el-dropdown-item v-if="e.state === 'C'" :icon="SwitchButton" divided style="color: #dc2626" @click="onState(e)">置为正式表</el-dropdown-item>
                    <el-dropdown-item v-else-if="e.state === 'AC'" :icon="SwitchButton" divided @click="onState(e)">设为测试表</el-dropdown-item>
                  </el-dropdown-menu></template>
                </el-dropdown>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!loading && !list.length" class="et-empty muted">没有匹配的实体表</div>
    </div>

    <div class="et-pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="size"
        :total="total"
        :page-sizes="[10, 30, 100, 200]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        small
        @current-change="applyView"
        @size-change="onSize"
      />
    </div>

  <el-drawer v-model="drawer.visible" :with-header="false" size="560px" append-to-body>
    <div v-if="drawer.entry" class="et-d">
      <div class="et-d-title">{{ drawer.entry.name || drawer.entry.tableName }}</div>
      <div class="et-d-sub muted">
        表 ID {{ drawer.entry.tableId }}{{ detailStats.loaded ? (detailStats.dataCount != null ? ` · ${detailStats.dataCount.toLocaleString()} 条数据` : '') : ' · 数据统计中…' }}
      </div>
      <div v-if="detailStats.loaded" class="et-d-stats" data-testid="entry-detail-stats">
        <div class="et-d-stat"><span class="muted">数据条数</span><b>{{ detailStats.dataCount != null ? detailStats.dataCount.toLocaleString() : '—' }}</b></div>
        <div class="et-d-stat"><span class="muted">源数量</span><b>{{ detailStats.sourceCount }}</b></div>
      </div>
      <dl class="rc-kv">
        <dt>表ID</dt><dd>{{ drawer.entry.tableId }}</dd>
        <dt>表名称</dt><dd>{{ drawer.entry.name || '—' }}</dd>
        <dt>物理表名</dt><dd>{{ drawer.entry.tableName }}</dd>
        <dt>去重字段</dt><dd>{{ drawer.entry.keyField || '—' }}</dd>
        <dt>去重方式</dt><dd>{{ drawer.entry.dedupMode === 'table' ? '表内去重' : '源内去重' }}</dd>
        <dt>状态</dt><dd>{{ drawer.entry.state || '—' }}</dd>
        <dt>备注</dt><dd>{{ drawer.entry.remark || '—' }}</dd>
        <dt>更新时间</dt><dd :title="drawer.entry.updatedAt || ''">{{ formatDateTime(drawer.entry.updatedAt) }}</dd>
        <dt>记录变更</dt><dd>{{ drawer.entry.recFlag ?? '—' }}</dd>
        <dt>校验标识</dt><dd>{{ drawer.entry.checkFlag ?? '—' }}</dd>
        <dt>校验规则</dt><dd>{{ drawer.entry.checkRule || '—' }}</dd>
        <dt>核心参数</dt><dd>{{ drawer.entry.coreParam || '—' }}</dd>
      </dl>
      <div class="et-section">
        字段
        <button class="rc-btn" type="button" style="float: right" @click="exportFields(drawer.entry)">导出字段</button>
      </div>
      <table class="rc-data-table">
        <thead>
          <tr>
            <th style="width: 40px">排序</th><th style="width: 60px">ID</th><th>编码</th><th>展示名</th>
            <th>数据库列</th><th style="width: 78px">类型</th><th>校验</th><th style="width: 56px">列宽</th><th>预处理</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in drawer.entry.fields" :key="f.itemId || f.prop">
            <td>{{ f.seq ?? '—' }}</td>
            <td>{{ f.itemId ?? '—' }}</td>
            <td>{{ f.prop }}</td>
            <td>{{ f.desc }}</td>
            <td>{{ f.columnName || '—' }}</td>
            <td>{{ f.type }}</td>
            <td>{{ f.checkRule || '—' }}</td>
            <td>{{ f.width || '—' }}</td>
            <td>{{ f.preprocess || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="canWrite" class="et-foot">
        <button class="rc-btn primary" type="button" @click="openEdit(drawer.entry)">编辑</button>
        <button class="rc-btn" type="button" @click="onRebuildIndex(drawer.entry)">重建去重索引</button>
      </div>
    </div>
  </el-drawer>

  <el-dialog v-model="extractDialog.visible" title="提取表字段" width="600px" append-to-body>
    <div class="et-extract-head">
      <span class="muted">格式：<code>字段编码:展示名:列宽</code> · 共 <b class="et-extract-count">{{ extractDialog.count }}</b> 个字段</span>
      <button class="rc-btn sm" type="button" @click="copyExtractText"><el-icon><CopyDocument /></el-icon>复制</button>
    </div>
    <textarea class="et-extract-textarea" :value="extractDialog.text" rows="14" readonly />
  </el-dialog>

  <EntryEditorDrawer v-model="editor.visible" :entry="editor.entry" @saved="onEntrySaved" />
  </div>
</template>

<style scoped>
.et-main { display: flex; flex-direction: column; height: calc(100vh - 215px); min-height: 520px; }
.et-spacer { flex: 1; }
.et-table { flex: 1; }
.et-empty { padding: 48px; text-align: center; }
.et-pager { display: flex; justify-content: flex-end; padding: 10px 16px; border-top: 1px solid var(--rc-border-soft); }
.et-d { display: flex; flex-direction: column; gap: 4px; }
.et-d-title { font-size: 15px; font-weight: 700; color: var(--rc-text); }
.et-d-sub { font-size: 12px; margin-bottom: 10px; }
/* 1013 表详情数据统计：两格卡片（数据条数 / 源数量） */
.et-d-stats { display: flex; gap: 10px; margin-bottom: 12px; }
.et-d-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border: 1px solid var(--rc-border-soft);
  border-radius: var(--rc-radius-sm, 6px);
  background: #f8fafc;
}
.et-d-stat .muted { font-size: 11px; }
.et-d-stat b { font-size: 15px; color: var(--rc-text); }
.et-section { margin: 14px 0 8px; font-size: 13px; font-weight: 700; color: var(--rc-text); }
.et-foot { display: flex; gap: 8px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--rc-border-soft); }
.et-caret { margin-left: 4px; font-size: 12px; }
.et-extract-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.et-extract-head code { background: var(--rc-bg, #f8fafc); border: 1px solid var(--rc-border-soft); border-radius: 4px; padding: 1px 5px; font-size: 11px; }
.et-extract-count { color: var(--rc-warn, #d97706); }
.et-extract-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  border: 1px solid #dbe3ee;
  border-radius: 7px;
  background: var(--rc-bg, #f8fafc);
  color: var(--rc-text);
  font-family: "SF Mono", Consolas, monospace;
  font-size: 12px;
  line-height: 1.7;
  padding: 10px 12px;
  outline: none;
}
.et-extract-textarea:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }

/* 1013：只看收藏开关（轻量滑动开关 + 状态文字，AGENTS.md 控件视觉约定） */
.et-fav-only { display: inline-flex; align-items: center; gap: 6px; margin-right: 12px; cursor: pointer; }
.et-fav-only-text { font-size: 12px; color: var(--rc-text, #1e293b); }

/* 1013：收藏星标按钮 */
.et-fav {
  border: 0;
  background: transparent;
  padding: 2px 4px;
  margin-right: 4px;
  vertical-align: middle;
  cursor: pointer;
  color: var(--rc-muted, #94a3b8);
  transition: color 0.15s ease;
}
.et-fav:hover { color: #f59e0b; }
.et-fav.on { color: #f59e0b; }

/* 1013：列头排序（视觉对齐数据查询 tab 的 el-table sortable 双三角箭头） */
.et-sortable { cursor: pointer; user-select: none; }
.et-sortable:hover { color: var(--rc-primary, #2563eb); }
.et-sortable.is-sorted { color: var(--rc-primary, #2563eb); }
.et-sort-caret { display: inline-flex; flex-direction: column; vertical-align: middle; margin-left: 3px; line-height: 0; }
.et-sort-caret .el-icon { font-size: 10px; color: #c0c4cc; }
.et-sort-caret .el-icon.active { color: var(--rc-primary, #2563eb); }
</style>
