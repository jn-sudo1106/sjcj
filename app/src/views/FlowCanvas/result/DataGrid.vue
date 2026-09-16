<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { copyToClipboard } from '@/utils/clipboard'
import type { DataTableMeta, DataRow } from '@/api'
import ColumnPickerDialog from '@/components/ColumnPickerDialog.vue'
import { useColumnPicker } from '@/utils/table/useColumnPicker'
import { IDENTITY_COL_PROPS } from '@/utils/table/columnPrefs'
import type { ChildCountCell } from '@/utils/flow/childCounts'

// withDefaults 是必须的：Vue 3 对 boolean 类型的 prop 有 casting 规则——未传时值是 false
// 而不是 undefined，所以 `props.allowColumnSort !== false` 这种写法会把"没传"误判成"禁止排序"。
const props = withDefaults(defineProps<{
  meta: DataTableMeta | null
  rows: DataRow[]
  loading?: boolean
  selectedId?: string
  compact?: boolean
  hideActions?: boolean
  /** 网站粒度数据视图「所属源」列（0707 优化·Phase5）：传入才渲染，id → 名称映射 */
  sourceNames?: Record<string, string>
  /** 源列可点（0915-03）：只有网站态的「全部源」视图给 true——点一下在新页签打开那个源。
   *  单源视图里这一列要么隐藏、要么改标「所属节点」，点了没有意义。 */
  sourceClickable?: boolean
  /** 该列表头文案，默认"所属源-SOURCE_NAME"；具体源·节点筛选场景下每行都是同一个源，
   *  改叫"所属节点"避免看着像跨源归并（那是全部源模式的语义），跟真正的具体源数据视图混淆。
   *  「所属节点」展示的是节点名而非源名，所以不跟着拼 SOURCE_NAME。 */
  sourceColLabel?: string
  /** 行勾选（0812 计划 M2-12：具体源"输入数据"页签勾行发后续任务）；不传时不渲染勾选列，
   *  不影响其余用法（全部源归并视图、输出数据页签都不需要勾选）。 */
  selectable?: boolean
  selectedIds?: string[]
  /** 当前排序列（发给后端的物理列名）与方向；由调用方持有，表格只负责显示与派发 */
  sortField?: string
  sortOrder?: 'ascend' | 'descend' | ''
  /** 是否允许对业务列（K 列）排序。旧平台 EntryList2.vue 按总行数 > 50 万关掉
   *  （watch pageForm.total → allSort），大表按无索引的业务列排序会拖垮库。
   *  ENTRY_ID / SOURCE_ID / 状态这些固定列不受此限制，旧平台也是始终可排。 */
  allowColumnSort?: boolean
  /** 可排序列白名单（物理列名）。不传＝沿用 allowColumnSort + FIXED_SORTABLE 的老口径。 */
  sortableProps?: string[]
  /** 触底自动加载：为 true 时在滚动容器底部装一个哨兵，进入视口就 emit reach-end。
   *  调用方在数据耗尽 / 正在加载时把它置 false，观察器随之解除。 */
  autoLoadMore?: boolean
  /** 默认只显示这批列（0831 F10「下一步字段」，由 utils/flow/nextStepFields 算出）。
   *  为空 / 全都不在当前表里时自动退回全部列——绝不因为配置没填就给一张空表。
   *  用户在本表存过列偏好时以偏好为准，预设只作用于"没表过态"的首次打开。 */
  presetCols?: string[]
  /** 强制只显示这批字段。未传时按列偏好/预设正常显示。 */
  visibleFieldProps?: string[]
  /** 临时强制展示全部列，不改写用户本地列偏好。 */
  forceAllColumns?: boolean
  /** 「下级」列（0903 H10）：每行在后继节点里产出了几条。
   *  `undefined` = 这个节点没有后继/后继没有输出表 → **整列不渲染**（不是显示一列 `—`）。
   *  `null` = 统计请求失败 → 显示 `?`，主表照常渲染（Y1-14）。 */
  childCounts?: Map<string, ChildCountCell> | null
  /** 统计失败的原因，挂在 `?` 的 tooltip 上 */
  childCountsError?: string
  /** 「下级」列是否可用（由调用方按有无后继决定），false 时整列不渲染 */
  showChildCol?: boolean
  /** 行内操作里是否给「删除单条」。仅测试表（tableMeta.state === 'C'）该为 true，
   *  由调用方判定——表状态在调用方手里，表格不去猜。 */
  allowRowDelete?: boolean
}>(), { allowColumnSort: true, presetCols: () => [] })
const showActions = computed(() => !props.compact && !props.hideActions)

// 排序（迁移旧平台 EntryList2.vue 的 @sort-change）：发给后端的是物理列名，
// 载荷拼装在 api/index.ts（field=`(列名+ 0)`、type=' ASC '/' DESC '），与旧平台一致。
const FIXED_SORTABLE = new Set(['ENTRY_ID', 'SOURCE_ID', 'PARENT_ID', 'STATE', 'UPDATE_DT', 'CREATE_DT'])
function sortKeyOf(field: { prop: string; columnName?: string }): string {
  return field.columnName || field.prop
}
function canSort(field: { prop: string; columnName?: string }): boolean {
  // sortableProps 是白名单，给"只有个别列能真排"的场景用（网站汇总的归并视图：
  // 归并键固定是 ENTRY_ID，按别的列排出来的顺序是假的）。传了就只认它，
  // 连 FIXED_SORTABLE 也不放行——那几个在归并视图下同样排不了。
  // prop 与物理列名都认：调用方按 prop 写白名单更稳（content_size 跨表含义一致，
  // 而 K7 在不同表里可能是别的字段），但发给后端和归并用的仍是物理列名。
  if (props.sortableProps) return props.sortableProps.includes(field.prop) || props.sortableProps.includes(sortKeyOf(field))
  return FIXED_SORTABLE.has(sortKeyOf(field)) || props.allowColumnSort
}
function sortIndicator(field: { prop: string; columnName?: string }): string {
  if (props.sortField !== sortKeyOf(field)) return '↕'
  return props.sortOrder === 'descend' ? '↓' : '↑'
}
// 三态循环：升 → 降 → 取消。旧平台这里有个瑕疵——u-table 的 sortable='custom' 第三次点击
// 会把 column.order 置 null，而它的 handleSortChange 只判断 'ascending'，else 一律当降序，
// 于是点到第二次以后就在降序卡住、取消不掉。我们的查询层支持不传 sortField（= 不排序），
// 故实现成真正的三态，不复刻这个 bug。
function onSort(field: { prop: string; columnName?: string }) {
  if (!canSort(field)) return
  const key = sortKeyOf(field)
  if (props.sortField !== key) return emit('sort-change', key, 'ascend')
  if (props.sortOrder === 'ascend') return emit('sort-change', key, 'descend')
  emit('sort-change', '', '')
}
const strictFieldOnly = computed(() => !!props.visibleFieldProps?.length)
const showSelectCol = computed(() => !!props.selectable && !strictFieldOnly.value)
const showSourceCol = computed(() => !!props.sourceNames && !strictFieldOnly.value)
const showChildDataCol = computed(() => !!props.showChildCol && !strictFieldOnly.value)
const showStatusCol = computed(() => !props.compact && !strictFieldOnly.value)
const showActionCol = computed(() => showActions.value && !strictFieldOnly.value)
function sourceLabel(row: DataRow): string {
  return props.sourceNames?.[row.sourceId] ?? row.sourceId
}
const emit = defineEmits<{
  (e: 'row-click', row: DataRow): void
  (e: 'row-action', row: DataRow, cmd: string): void
  (e: 'source-click', row: DataRow): void
  (e: 'update:selectedIds', ids: string[]): void
  (e: 'sort-change', field: string, order: 'ascend' | 'descend' | ''): void
  (e: 'reach-end'): void
  (e: 'file-click', path: string, field: { prop: string; desc?: string }, sourceUrl: string): void
  /** 点了 PARENT_ID 单元格里的父行 ID（0903 Y1-3）：调用方去打开那条上游数据 */
  (e: 'parent-click', row: DataRow): void
  /** 点了「下级」列的条数（0903 Y1-12）：调用方跳到后继节点并带上 父ID=本行 */
  (e: 'child-click', row: DataRow, cell: ChildCountCell): void
}>()

// 触底加载（0819 N3-1，会议 10:39"是不是应该直接朝下滑动就加载更多啊？你这个要点还不麻烦吗"）。
// 观察器装在这里而不是调用方：纵向滚动发生在本组件的 .dg-scroll 上（flex:1 + overflow:auto），
// 调用方拿不到这个容器，只能靠本组件把"到底了"这件事 emit 出去。
// rootMargin 提前 120px 触发，滚到底之前就开始取下一批，接得上。
const scrollRef = ref<HTMLElement | null>(null)
const sentinelRef = ref<HTMLElement | null>(null)
let endObserver: IntersectionObserver | undefined

/**
 * 容器不可滚动时，自动加载最多再触发几次（2026-09-16 修）。
 *
 * **窄屏（≤980px）下 `.dg-scroll` 根本不会滚动**：`AppShell.vue` 的移动端分支把 `.rc-app`
 * 从 `height:100vh; overflow:hidden` 改成 `height:auto; overflow:auto`（整页滚动布局），
 * 高度约束链一断，本组件的 `flex:1 + overflow:auto` 就失效——容器跟着内容长，
 * `scrollHeight === clientHeight`，于是**哨兵永远 intersecting**，reach-end 无限触发，
 * 一路把整张表拉完（实测 6131 条的表：300+ 请求、6000+ 行 DOM、页面高 15 万 px、越来越卡）。
 * 桌面宽度下容器正常限高，加载一批就把哨兵推出视口，从来不会踩到。
 *
 * 不能直接"不可滚动就不加载"：首屏本来就可能填不满一屏，那时正需要自动续几批。
 * 所以给一个上限——5 批足够填满任何窄屏，封顶后交给「加载更多」按钮（它一直都在）。
 * 用户手动滚动视为"还想要更多"，计数清零。
 */
const MAX_AUTO_ROUNDS_UNSCROLLABLE = 5
let autoRoundsWhenUnscrollable = 0

function teardownObserver() {
  endObserver?.disconnect()
  endObserver = undefined
}
function setupObserver() {
  teardownObserver()
  // jsdom 与老浏览器没有 IntersectionObserver：不装观察器，调用方的「加载更多」按钮就是兜底
  if (!props.autoLoadMore || typeof IntersectionObserver === 'undefined') return
  if (!scrollRef.value || !sentinelRef.value) return
  endObserver = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      const el = scrollRef.value
      if (!el) return
      // +1 容差：内容与容器等高时四舍五入可能差出零点几像素
      if (el.scrollHeight > el.clientHeight + 1) {
        autoRoundsWhenUnscrollable = 0
        emit('reach-end')
        return
      }
      if (autoRoundsWhenUnscrollable >= MAX_AUTO_ROUNDS_UNSCROLLABLE) return
      autoRoundsWhenUnscrollable += 1
      emit('reach-end')
    },
    { root: scrollRef.value, rootMargin: '120px' },
  )
  endObserver.observe(sentinelRef.value)
}
/** 用户主动翻页面 = 还想看更多，把封顶计数放开（窄屏下滚的是整页，不是容器） */
function onUserScrollAnywhere() {
  autoRoundsWhenUnscrollable = 0
}
watch(() => props.autoLoadMore, () => void nextTick(setupObserver))
onMounted(() => {
  void nextTick(setupObserver)
  window.addEventListener('scroll', onUserScrollAnywhere, { passive: true, capture: true })
})
onBeforeUnmount(() => {
  teardownObserver()
  window.removeEventListener('scroll', onUserScrollAnywhere, { capture: true })
})

const selectedSet = computed(() => new Set(props.selectedIds ?? []))
const allChecked = computed(() => props.rows.length > 0 && props.rows.every((r) => selectedSet.value.has(r.dataId)))
const someChecked = computed(() => !allChecked.value && props.rows.some((r) => selectedSet.value.has(r.dataId)))
function toggleRow(dataId: string) {
  const next = new Set(selectedSet.value)
  if (next.has(dataId)) next.delete(dataId)
  else next.add(dataId)
  emit('update:selectedIds', [...next])
}
function toggleAll() {
  emit('update:selectedIds', allChecked.value ? [] : props.rows.map((r) => r.dataId))
}

// 两个身份列都不依赖 schema，靠合成列补出来——旧平台各表的 fields 里基本不声明它们，
// 导致列表上既看不出"这条数据的 ID"，也看不出"它属于哪个源"：
//   ENTRY_ID  每行真实主键（legacyAdapters 的 dataId 取自它）
//   SOURCE_ID 该行所属源（DataRow.sourceId）
// 0819 会议 08:16"你数据就没展示怎么说（还怎么按数据 ID 查）"→ 08:20"我没把这个主键字段
// 放出来"；09:23"你肯定要有个地方展示这个选在哪一个源"→ 09:33"在你这个数据节点里面、
// 字段里面应该有"→ 09:44"不是源 ID，你的 430114955 这个 ID 应该有的"。
// 故两列**默认可见**（N0 那批 ENTRY_ID 曾默认隐藏，与该要求相反，此处纠正）；
// 嫌占地方的人从「列」弹窗自行关掉。
// label 是列头显式文案，仅这两个合成列有：旧平台 EntryList2.vue 的固定列用的就是短标签
// （ENTRY_ID 列 label="ENTRY_ID"、SOURCE_ID 列 label="源"），只有动态列才拼 itemName-columnName。
// ENTRY_ID/PARENT_ID 保持短标签：它们本身就是物理列名，拼成「主键 ID-ENTRY_ID」既长又重复。
// 「源」原本也是短标签，2026-09-10 会上改为「源-SOURCE_ID」：单独一个「源」字与其余列的
// 「标题-K1」「URL-K2」不是一个体例，用户看不出该拿哪个名字往 SQL 条件框里写。
// desc 仍保留给悬浮提示。
const ENTRY_ID_COL = { prop: 'ENTRY_ID', type: 'string', desc: '主键 ID', label: 'ENTRY_ID' }
const SOURCE_ID_COL = { prop: 'SOURCE_ID', type: 'string', desc: '所属源 ID', label: '源-SOURCE_ID' }
// PARENT_ID（0903 H09）：这行是上一节点哪条数据产出的。异表回溯（下游筛出问题行 → 回上游发
// 任务）全靠它，会上「你少一个 parent id」指的就是这列。
//
// **首节点表整列是 `—`，但列仍然渲染**——不做"全空就隐藏"的特判：那会让同一个数据视图在
// 不同节点之间列数忽多忽少，用户以为是自己把列关掉了。空值本身就是信息（这是链路起点）。
const PARENT_ID_COL = { prop: 'PARENT_ID', type: 'string', desc: '父行 ID', label: 'PARENT_ID' }
const UPDATE_DT_COL = { prop: 'UPDATE_DT', type: 'string', desc: '更新时间', label: '更新时间-UPDATE_DT' }
const CREATE_DT_COL = { prop: 'CREATE_DT', type: 'string', desc: '创建时间', label: '创建时间-CREATE_DT' }
// 列序：ENTRY_ID → PARENT_ID → 源 → 更新时间 → 创建时间
type GridColumn = DataTableMeta['fields'][number] | typeof ENTRY_ID_COL | typeof PARENT_ID_COL | typeof SOURCE_ID_COL | typeof UPDATE_DT_COL | typeof CREATE_DT_COL
const allCols = computed<GridColumn[]>(() => (props.meta ? [ENTRY_ID_COL, PARENT_ID_COL, SOURCE_ID_COL, UPDATE_DT_COL, CREATE_DT_COL, ...props.meta.fields] : []))
const identityColSet = new Set<string>(IDENTITY_COL_PROPS)
function isIdentityCol(field: { prop: string; columnName?: string }): boolean {
  return identityColSet.has(field.prop.toUpperCase()) || identityColSet.has((field.columnName ?? '').toUpperCase())
}
const visibleFieldSet = computed(() => new Set(props.visibleFieldProps ?? []))
const cols = computed(() => {
  if (!props.visibleFieldProps?.length) return allCols.value
  return allCols.value.filter((field) => {
    if (isIdentityCol(field)) return false
    return visibleFieldSet.value.has(field.prop) || visibleFieldSet.value.has('columnName' in field ? field.columnName ?? '' : '')
  })
})

// 预设里认不出来的列先剔掉：presetCols 是按流程配置算的，可能引用了当前表没有的字段
// （改过表结构、或后继节点读的是另一张表）。留着会让「下一步字段」按钮显示一个虚高的数字。
// 两个身份列无条件并进来——不知道这行是哪条数据、属于哪个源，剩下的字段看了也没用
// （0819 会议 08:16/09:23 要出来的就是这两列）；调用方不必自己记得带上。
const effectivePreset = computed(() => {
  if (props.forceAllColumns) return []
  if (!props.presetCols.length) return []
  const known = new Set(cols.value.map((f) => f.prop))
  const wanted = new Set(props.presetCols.filter((prop) => known.has(prop)))
  if (!wanted.size) return []
  for (const prop of IDENTITY_COL_PROPS) if (known.has(prop)) wanted.add(prop)
  return cols.value.map((f) => f.prop).filter((prop) => wanted.has(prop))
})
const {
  hidden: hiddenCols,
  order: colOrder,
  open: colPickerOpen,
  visibleCount: colVisibleCount,
  presetActive,
  apply: applyColumnPrefs,
  applyPreset,
  showAll: showAllCols,
} = useColumnPicker(
  () => props.meta?.tableId ?? '',
  () => cols.value.map((f) => f.prop),
  { getPresetProps: () => effectivePreset.value },
)
const visibleCols = computed(() => {
  const byProp = new Map(cols.value.map((f) => [f.prop, f]))
  return colOrder.value
    .map((prop) => byProp.get(prop))
    .filter((f): f is (typeof cols.value)[number] => !!f && (props.forceAllColumns || !hiddenCols.value.has(f.prop)))
})
const displayVisibleCount = computed(() => (props.forceAllColumns ? cols.value.length : colVisibleCount.value))
const pickerColumns = computed(() => cols.value.map((f) => ({ prop: f.prop, label: colLabel(f) })))
const showColPicker = computed(() => cols.value.length > 1)
const emptyColspan = computed(() =>
  visibleCols.value.length
  + (showStatusCol.value ? 1 : 0)
  + (showActionCol.value ? 1 : 0)
  + (showSourceCol.value ? 1 : 0)
  + (showSelectCol.value ? 1 : 0)
  + (showChildDataCol.value ? 1 : 0),
)
// row.values 的键是旧平台的物理列名（K1/K2...），不是 tableMeta 给的逻辑字段名 f.prop
// （比如 "title"）——这两个只在 f.columnName 里对得上，直接用 f.prop 去取永远是 undefined。
// 真实 bug，2026-08-14 生产环境实测发现：详情弹层和表格本体所有字段都显示"—"，
// 不是接口没数据，是取错了 key。
// 列头文案对齐旧平台 EntryList2.vue:842 的 `item.itemName + '-' + item.columnName`
// ——即「标题-K1」。SQL 条件框拼的是物理列名（K1），而迁移时列头只渲染了 prop（itemCode，
// 如 title），把 columnName 整个藏了起来：界面上唯一能看到的名字拿去写 WHERE 必然 500，
// 等于把人往坑里引（0819 会议 10:53"条件支持什么开头"的根子）。数据一直都在，只是没渲染。
// 兜底：没有 columnName 的列（ENTRY_ID/SOURCE_ID 合成列本身就是物理列名，
// 或 inferTableMeta 推断出的列）退回 prop；desc 缺失时只显示物理列名。
// 文件类单元格识别（0819 N2-6）：判据迁移自旧平台 EntryList2.vue:344——
// itemCode 含 path/minio，或列名含「地址/路径/图片」，且值以 / 开头（OSS 路径的形状）。
// 我们的 field.prop 即旧平台的 itemCode、field.desc 即 itemName，一一对应。
// 旧平台据此把这些单元格渲染成 OSS 下载链接；这里进一步做成可点开的站内预览。
function isFileCell(field: { prop: string; desc?: string }, value: string): boolean {
  if (!value.startsWith('/')) return false
  const code = String(field.prop || '').toLowerCase()
  const label = String(field.desc || '')
  return code.includes('path') || code.includes('minio')
    || label.includes('地址') || label.includes('路径') || label.includes('图片')
}

/**
 * 取这一行的原文地址（K2 那类 url 字段），随 file-click 一起交给预览器。
 *
 * 由 DataGrid 算是因为只有它同时握着 meta 与 row：调用方拿到的只是一个文件路径，
 * 此前它们从「详情抽屉当前行」去找 url——而直接点单元格预览时详情根本没打开，
 * 于是永远取不到，预览弹窗里的「原始地址 ↗」按钮就一直不渲染
 * （2026-09-11 实测：采集被拦的存档预览不出来，恰恰最需要这个按钮跳去看原文）。
 */
function sourceUrlOf(row: DataRow): string {
  const fields = props.meta?.fields ?? []
  const urlField = fields.find((f) => f.prop === 'url')
    || fields.find((f) => (f.desc || '').toUpperCase().includes('URL'))
  const direct = urlField ? cellText(row, urlField) : ''
  if (/^https?:/i.test(direct)) return direct
  // 兜底：schema 里认不出 url 字段时，取该行第一个 http 值
  return Object.values(row.values ?? {}).find((v) => typeof v === 'string' && /^https?:/i.test(v)) as string ?? ''
}

function colLabel(field: { prop: string; desc?: string; columnName?: string; label?: string }): string {
  if (field.label) return field.label
  const physical = field.columnName || field.prop
  return field.desc && field.desc !== physical ? `${field.desc}-${physical}` : physical
}

/**
 * 复制单元格的值（0828 D27）。
 */
async function copyCell(text: string) {
  await copyToClipboard(text)
}

/** 父行 ID 是否是个真值：后端用 `'0'` 表示"没有父行"，跟空串同义，都不该显示成一个可点的 ID */
function parentIdOf(row: DataRow): string {
  const raw = row.parentId ? String(row.parentId) : ''
  return raw && raw !== '0' ? raw : ''
}
function cellText(row: DataRow, field: { prop: string; columnName?: string }): string {
  if (field.prop === 'ENTRY_ID') return row.dataId || '—'
  if (field.prop === 'SOURCE_ID') return row.sourceId || '—'
  if (field.prop === 'PARENT_ID') return parentIdOf(row) || '—'
  if (field.prop === 'UPDATE_DT') return row.updateDt || (row.values?.UPDATE_DT as string) || '—'
  if (field.prop === 'CREATE_DT') return row.createDt || (row.values?.CREATE_DT as string) || '—'
  const v = row.values?.[field.columnName ?? field.prop]
  if (v === undefined || v === null) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
/** 这一行的下级明细。统计整体失败时 childCounts 是 null，返回 undefined 让模板显示 `?`。 */
function childCellOf(row: DataRow): ChildCountCell | undefined {
  return props.childCounts?.get(row.dataId)
}
/** 多后继时把「抽取正文 5 / 图片下载 2」拆开挂 tooltip；单后继就没必要重复一遍节点名 */
function childCellTitle(cell: ChildCountCell): string {
  if (cell.byTarget.length <= 1) return `查看这 ${cell.total} 条下级数据`
  return cell.byTarget.map((t) => `${t.title} ${t.count}`).join(' / ')
}
function stateMeta(s?: string) {
  if (s === 'C') return { cls: 'ok', text: 'C' }
  if (s === 'E') return { cls: 'err', text: 'E' }
  if (s === 'L') return { cls: 'run', text: 'L' }
  return { cls: 'muted', text: '—' }
}
</script>

<template>
  <div class="dg-wrap" :class="{ compact }">
    <!-- 表头工具行：调用方可以用 #head 插槽把自己的表头内容（表名/行数/执行按钮/分页等）
         塞进来，跟「列」共用同一条横条。原来「列 ▾」自己独占一条 33px、调用方的表头又
         是另一条 47px、分页再一条 45px——三条横条摞起来把数据区挤没了
         （2026-08-15：数据视图一屏只看得到 6.2/20 行）。 -->
    <div v-if="(!compact && (cols.length > 1 || $slots.head)) || (compact && showColPicker)" class="dg-toolbar">
      <div class="dg-head"><slot name="head" /></div>
      <!-- #head-right：不参与 .dg-head 横向滚动的常驻区。表头内容多到溢出时，#head 里的
           东西会被滚动条藏起来（2026-08-19 用户反馈：全屏按钮在最右边，得先拉滚动条才够
           得着），像"全屏"这种任何时候都该点得到的开关放这里，跟「列」一样钉住。 -->
      <div v-if="$slots['head-right']" class="dg-head-right"><slot name="head-right" /></div>
      <div v-if="showColPicker" class="dg-cols-menu">
        <!-- 一键在「下一步字段」与「全部列」之间来回切。收进弹窗里就成了
             开弹窗 → 全选 → 确定 三步，而这是看数据时最常来回按的一个开关。 -->
        <button
          v-if="effectivePreset.length"
          class="dg-col-btn"
          type="button"
          data-testid="column-preset-toggle"
          :title="presetActive
            ? '当前只显示下一节点会用到的字段，点击展开全部列'
            : `只显示下一节点会用到的 ${effectivePreset.length} 个字段`"
          :class="{ on: presetActive }"
          @click="presetActive ? showAllCols() : applyPreset()"
        >{{ presetActive ? '全部列' : `下一步字段 ${effectivePreset.length}` }}</button>
        <button
          class="dg-col-btn"
          type="button"
          data-testid="column-picker-btn"
          :title="`列显示与顺序（已显 ${displayVisibleCount}/${cols.length}）`"
          @click="colPickerOpen = true"
        >列 {{ displayVisibleCount }}/{{ cols.length }}</button>
      </div>
    </div>
    <div v-if="!cols.length && !loading" class="dg-empty">该节点暂无输出表 schema</div>
    <div v-else ref="scrollRef" class="dg-scroll" v-loading="loading">
      <table class="dg-table dg-sticky-table">
        <thead>
          <tr>
            <th v-if="showSelectCol" class="dg-sticky-head" style="width:36px" @click.stop>
              <input type="checkbox" :checked="allChecked" :indeterminate="someChecked" @change="toggleAll" />
            </th>
            <th v-if="showSourceCol" class="dg-sticky-head" style="width:180px">{{ sourceColLabel || '所属源-SOURCE_NAME' }}</th>
            <th
              v-for="f in visibleCols"
              :key="f.prop"
              class="dg-sticky-head"
              :style="{ minWidth: compact ? '96px' : '120px' }"
              :class="{ 'dg-sortable': canSort(f), 'dg-sorted': sortField === sortKeyOf(f) }"
              :title="canSort(f) ? `${f.desc || f.prop}（点击排序）` : (f.desc || f.prop)"
              @click="onSort(f)"
            >{{ colLabel(f) }}<span v-if="canSort(f)" class="dg-sort-ind">{{ sortIndicator(f) }}</span></th>
            <!-- 「下级」（0903 H10）：这行在后继节点里产出了几条。末节点 / 后继无输出表时
                 整列不渲染——显示一整列 `—` 只会让人以为"数据没跑出来"。 -->
            <th v-if="showChildDataCol" class="dg-sticky-head" style="width:72px" title="这一行在下一节点产出了多少条数据">下级</th>
            <th v-if="showStatusCol" class="dg-sticky-head" style="width:64px">状态</th>
            <th v-if="showActionCol" class="dg-sticky-head" style="width:80px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.dataId" :class="{ active: selectedId === r.dataId }" @click="emit('row-click', r)">
            <td v-if="showSelectCol" class="dg-select" @click.stop>
              <input type="checkbox" :checked="selectedSet.has(r.dataId)" @change="toggleRow(r.dataId)" />
            </td>
            <td v-if="showSourceCol" :title="sourceClickable && r.sourceId ? `在新页签打开源 ${sourceLabel(r)}` : sourceLabel(r)">
              <button
                v-if="sourceClickable && r.sourceId"
                type="button"
                class="dg-source-cell"
                data-testid="data-source-name-cell"
                @click.stop="emit('source-click', r)"
              >{{ sourceLabel(r) }} <span aria-hidden="true">↗</span></button>
              <template v-else>{{ sourceLabel(r) }}</template>
            </td>
            <td v-for="f in visibleCols" :key="f.prop" class="dg-cell" :title="cellText(r, f)">
              <!-- 父行 ID 做成可点（0903 Y1-3）：跟详情里那个「父 ID ↗」是同一个下钻，
                   只是把入口挪到表格上，不用先点开详情再点一次。空值（'' 或 '0'）不可点。 -->
              <button
                v-if="f.prop === 'PARENT_ID' && parentIdOf(r)"
                type="button"
                class="dg-parent-cell"
                data-testid="data-parent-cell"
                :title="`查看上游数据 ${parentIdOf(r)}`"
                @click.stop="emit('parent-click', r)"
              >{{ parentIdOf(r) }} <span aria-hidden="true">↗</span></button>
              <!-- 源 ID 做成可点（0915-03）：会上原话「我点这个源…就像打开一个网页标签」——
                   点一下在新页签打开这个源，当前查询条件跟着带过去，人不离开这一页。 -->
              <button
                v-else-if="sourceClickable && f.prop === 'SOURCE_ID' && r.sourceId"
                type="button"
                class="dg-source-cell"
                data-testid="data-source-id-cell"
                :title="`在新页签打开源 ${r.sourceId}（带上当前查询条件）`"
                @click.stop="emit('source-click', r)"
              >{{ r.sourceId }} <span aria-hidden="true">↗</span></button>
              <!-- 路径类单元格做成可点：点开站内预览，不改变行点击（打开数据详情）的语义 -->
              <button
                v-else-if="isFileCell(f, cellText(r, f))"
                type="button"
                class="dg-file-cell"
                data-testid="data-file-cell"
                :title="`预览 ${cellText(r, f)}`"
                @click.stop="emit('file-click', cellText(r, f), f, sourceUrlOf(r))"
              >📄 {{ cellText(r, f) }}</button>
              <template v-else>{{ cellText(r, f) }}</template>
              <!-- 复制该格的值（0828 D27）。会上原话「人家有的时候他只需要复制这个值」。
                   hover 才显形，避免每格常驻一个图标；@click.stop 保住行点击（打开详情）的语义。 -->
              <button
                v-if="cellText(r, f)"
                type="button"
                class="dg-copy"
                data-testid="data-cell-copy"
                title="复制该值"
                @click.stop="copyCell(cellText(r, f))"
              >
                <!-- 用 SVG 而不是字符图标：字符会进 td 的 textContent，把「取值是否正确」这类断言污染成
                     「真实标题⧉」（2026-08-28 实测撞到）。图标不该改变单元格的文本内容。 -->
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                  <path
                    d="M5.5 2.5h6a1 1 0 0 1 1 1v6M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z"
                    fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"
                  />
                </svg>
              </button>
            </td>
            <td v-if="showChildDataCol" class="dg-child" @click.stop>
              <!-- 统计整体失败：只有这一列变 `?`，表格照常看（Y1-14）——统计是附加信息，
                   不该因为它挂了就让人看不了数据。 -->
              <span v-if="childCounts === null" class="dg-child-err" data-testid="data-child-error" :title="childCountsError || '下级条数统计失败'">?</span>
              <button
                v-else-if="childCellOf(r) && childCellOf(r)!.total > 0"
                type="button"
                class="dg-child-link"
                data-testid="data-child-count"
                :title="childCellTitle(childCellOf(r)!)"
                @click="emit('child-click', r, childCellOf(r)!)"
              >{{ childCellOf(r)!.total }}</button>
              <span v-else class="muted">—</span>
            </td>
            <td v-if="showStatusCol"><span class="rc-status" :class="stateMeta(r.state).cls">{{ stateMeta(r.state).text }}</span></td>
            <td v-if="showActionCol" class="dg-actions" @click.stop>
              <el-dropdown trigger="click" @command="(c: string) => emit('row-action', r, c)">
                <span class="dg-act-btn">操作 ▾</span>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="detail">详情</el-dropdown-item>
                    <el-dropdown-item command="tasks">查后续任务实例</el-dropdown-item>
                    <el-dropdown-item v-if="allowRowDelete" divided command="delete">删除单条【无法恢复】</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </td>
          </tr>
          <tr v-if="!rows.length && !loading">
            <td :colspan="emptyColspan" class="dg-empty-cell">无符合条件的数据</td>
          </tr>
        </tbody>
      </table>
      <!-- 触底哨兵：必须在滚动容器内部、表格之后，滚到底时才会进入 root 的视口 -->
      <div v-if="autoLoadMore" ref="sentinelRef" class="dg-sentinel" aria-hidden="true" />
    </div>
    <!-- #foot：表格下方的常驻横条，给分页用（0819 N1-8，会议 19:13"页子放下面，
         没有把页子放上面的"）。此前分页并在 #head 里是为了省纵向空间，现在由顶部区
         收窄（N1-10）来补偿，两项必须同批，否则会卡在"分页下移了但空间没补回来"。 -->
    <div v-if="$slots.foot" class="dg-foot"><slot name="foot" /></div>
    <ColumnPickerDialog
      :open="colPickerOpen"
      :columns="pickerColumns"
      :hidden="[...hiddenCols]"
      :order="colOrder"
      :preset-props="effectivePreset"
      preset-label="仅下一步字段"
      @update:open="colPickerOpen = $event"
      @confirm="applyColumnPrefs"
    />
  </div>
</template>

<style scoped>
.dg-wrap { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.dg-toolbar { display: flex; align-items: center; gap: 8px; padding: 5px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fbfdff; }
/* 插槽内容不换行、放不下横向滚动：换行会让这条横条随窗口变窄一路长高，又把数据区挤回去。 */
.dg-head { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px 10px; flex-wrap: nowrap; overflow-x: auto; }
/* 常驻区：flex:none 不被压缩、不参与 .dg-head 的横向滚动，永远够得着 */
.dg-head-right { flex: none; display: flex; align-items: center; gap: 8px; }
/* 表格下方横条：跟 .dg-toolbar 同一套内边距与底色，视觉上把表格夹在中间 */
.dg-foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 5px 12px; border-top: 1px solid var(--rc-border-soft); background: #fbfdff; }
.dg-head > * { flex-shrink: 0; }
.dg-cols-menu { flex: none; display: flex; align-items: center; gap: 6px; }
.dg-col-btn { height: 24px; padding: 0 9px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text-2); font-size: 11px; cursor: pointer; }
.dg-col-btn:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.dg-col-btn.on { border-color: var(--rc-primary); background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.dg-scroll { flex: 1; overflow: auto; }
.dg-sentinel { height: 1px; }
.dg-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; }
.dg-cell { position: relative; }
.dg-copy { position: absolute; top: 50%; right: 4px; transform: translateY(-50%); border: 0; background: rgba(255,255,255,.9); color: var(--rc-faint); font-size: 12px; line-height: 1; padding: 2px 4px; border-radius: 4px; cursor: pointer; opacity: 0; transition: opacity .12s; }
.dg-cell:hover .dg-copy { opacity: 1; }
.dg-copy:hover { color: var(--rc-primary); background: var(--rc-primary-bg); }
.dg-child { text-align: center; }
.dg-child-link { border: 0; background: transparent; padding: 0; color: var(--rc-primary); font: inherit; font-weight: 600; cursor: pointer; }
.dg-child-link:hover { text-decoration: underline; }
.dg-child-err { color: var(--rc-warn); cursor: help; }
/* 源 ID / 源名可点：与「父 ID ↗」同一种"可下钻"的视觉语言 */
.dg-source-cell {
  border: 0; background: transparent; padding: 0; cursor: pointer;
  color: var(--rc-primary); font-size: inherit; font-family: inherit;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dg-source-cell:hover { text-decoration: underline; }
.dg-parent-cell { border: 0; background: transparent; padding: 0; color: var(--rc-primary); font: inherit; cursor: pointer; }
.dg-parent-cell:hover { text-decoration: underline; }
.dg-file-cell { max-width: 100%; padding: 0; border: 0; background: none; color: var(--rc-primary); font: inherit; text-align: left; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dg-file-cell:hover { text-decoration: underline; }
.dg-sortable { cursor: pointer; user-select: none; }
.dg-sortable:hover { color: var(--rc-primary); }
.dg-sort-ind { margin-left: 4px; opacity: .35; font-size: 10px; }
.dg-sorted .dg-sort-ind { opacity: 1; color: var(--rc-primary); }
/* z-index 必须显式给（2026-09-09）：th 虽是 sticky，但默认 z-index:auto，而单元格
   .dg-cell 为了放复制按钮是 position:relative，同为 auto 时按 DOM 先后决定层叠——
   tbody 在 thead 之后，于是数据行画在表头上面；td 背景又是透明的，滚动时就成了
   表头文字与数据文字叠在一起（全部源 / 具体源两个数据视图都复现）。 */
.dg-table th { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; position: sticky; top: 0; z-index: 2; background: #f8fafc; color: var(--rc-text-2); font-weight: 700; text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--rc-border); font-family: var(--rc-mono, monospace); }
.dg-table td { padding: 8px 10px; border-bottom: 1px solid var(--rc-border-soft); color: var(--rc-text); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dg-table tbody tr { cursor: pointer; }
.dg-table tbody tr:hover { background: #f8fbff; }
.dg-table tbody tr.active { background: #eff6ff; }
.dg-actions, .dg-select { color: var(--rc-primary); }
.dg-select input, .dg-table th input[type="checkbox"] { cursor: pointer; }
.dg-act-btn { font-size: 12px; cursor: pointer; }
.dg-empty, .dg-empty-cell { padding: 24px; text-align: center; color: var(--rc-faint); font-size: 12px; }
.compact .dg-table th { font-size: 11px; padding: 6px 8px; }
.compact .dg-table td { font-size: 11px; padding: 6px 8px; max-width: 160px; }
</style>
