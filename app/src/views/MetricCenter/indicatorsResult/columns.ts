// 指标结果（旧 `/inst/measure-data` → MeasureData.vue）的列定义。
//
// 与「指标列表」不同，这一页的列**不是**从旧 column.config.js 抄一组静态配置，而是三类拼起来的：
//
//   1. 动态列（旧 `columns()` / `allColumns()`）：按当前数据表（`curEntryType.items`）里的
//      **必填字段**生成，只有前 12 个进表格（旧 `if (i >= 12) break`），编辑弹窗用全量。
//      标题是 `中文名-列名`（如 `标题-K3`），`dataIndex` 就是物理列名（K1/K2/…）。
//      宽度规则照抄旧代码：默认 120，字段名含「区间/时间/日期/周期」的算 140，再乘 0.9；
//      **但落到列上是 `minWidth` 而不是 `width`**（见下方 `buildDynamicColumns` 的说明：
//      只有非数字 width 的列才会去吸收容器富余宽度，否则必填字段少时表格右侧会留白）。
//      `dataType === 'url'` 或字段名含 url 的渲染成外链（旧 dataUrlSlot）。
//   2. 系统列（旧 MeasureData 内联在模板里的 u-table-column）：ENTRY_ID / SOURCE_ID / STATE /
//      UPDATE_DT / CREATE_DT / DETAIL_ID / NEXT_FLAG / PARENT_ID / K0 / action。
//   3. 非必填字段 + 固定的 7 个「表信息」列（旧 `computed.otherCols` = 非必填项 + `baseOtherCols`），
//      **只**进编辑弹窗与详情抽屉，不进表格。
//
// ⚠️ 字段名映射：旧 `entryType.items[i]` 的 `itemName / columnName / dataType / required`
// 在新平台对应 `dataApi.tableMeta().fields[i]` 的 `desc / columnName / type / required`
// （见 api/legacyAdapters.ts 的 `entryTypeToLegacy`：itemName 就是 field.desc）。
// 所以本文件统一吃**新字段名**，由 `fieldsToEntryItems()` 先归一化再交给列构造函数。
import type { ColumnDef } from '../shared/types'

/** 归一化后的「数据表字段」（旧 entryType.items 的一行） */
export interface EntryItem {
  /** 物理列名（K1 / K2 …），就是表格的 dataIndex */
  columnName: string
  /** 中文名（旧 itemName） */
  itemName: string
  /** url / string / text / longtext / number / date / json */
  dataType: string
  required: boolean
}

/** `DataTableMeta.fields` → 旧 `entryType.items` 的同口径结构 */
export function fieldsToEntryItems(
  fields: { columnName?: string; desc?: string; type?: string; required?: boolean }[] | undefined,
): EntryItem[] {
  return (fields ?? [])
    .map((field) => ({
      columnName: String(field.columnName ?? ''),
      itemName: String(field.desc ?? ''),
      dataType: String(field.type ?? ''),
      required: Boolean(field.required),
    }))
    .filter((item) => !!item.columnName)
}

/** 旧 `width` 规则：默认 120，名字里带时间语义的算 140，统一再乘 0.9 */
function dynamicWidth(itemName: string): number {
  const base = ['区间', '时间', '日期', '周期'].some((kw) => itemName.includes(kw)) ? 140 : 120
  return base * 0.9
}

function isUrlItem(item: EntryItem): boolean {
  return item.dataType === 'url' || item.itemName.toLocaleLowerCase().includes('url')
}

export interface EntryDataColumn extends ColumnDef {
  /** 表格单元格走哪个插槽 */
  slot?: 'data' | 'dataUrl'
  /** 值本身就是外链（旧 `url: true`） */
  url?: boolean
}

/**
 * 旧 `columns()`（表格用，最多 12 个必填字段）与 `allColumns()`（编辑弹窗用，全量）。
 * @param limit 0 表示不限（= 旧 allColumns()）
 *
 * ⚠️ 宽度给的是 **`minWidth` 而不是 `width`**（数值仍是旧的 `120/140 * 0.9`）：
 *   el-table 只把「容器富余宽度」分给**没有数字 `width`** 的列
 *   （见 element-plus 的 `table-layout.updateColumnsWidth`：`flexColumns = columns.filter(c => !isNumber(c.width))`，
 *   flexColumns 为空时直接 `bodyWidth = Σ width`）。本页数据列是唯一会随表变多/变少的「内容列」，
 *   旧版全列定宽，遇到必填字段少的表时整张表只有 895px、右边空出 500+px 的白条。
 *   改成 `minWidth` 后：容器够宽 → 富余按各列 minWidth 比例分给数据列（列自适应页面宽度、不留白）；
 *   容器不够 → 各列退回自己的 minWidth 并横向滚动（与原来一致）。
 *   编辑弹窗不看这个字段（`ColumnEditDialog` 按 `span` 走栅格），所以这里改名不影响弹窗。
 */
export function buildDynamicColumns(items: EntryItem[], limit = 12): EntryDataColumn[] {
  const ret: EntryDataColumn[] = []
  for (let i = 0; i < items.length; i++) {
    if (limit && i >= limit) break
    const item = items[i]
    if (!item.required) continue
    const url = isUrlItem(item)
    ret.push({
      title: `${item.itemName}-${item.columnName}`,
      dataIndex: item.columnName,
      span: 4,
      // 旧版 url 列没给宽度（旧 `width` 也没给，跟着内容走）；普通列给 width*0.9 作为**最小**宽度
      ...(url ? {} : { minWidth: dynamicWidth(item.itemName) }),
      url,
      slot: url ? 'dataUrl' : 'data',
    })
  }
  return ret
}

/** 旧 `data.baseOtherCols`：7 个固定「表信息」列（附在 otherCols 末尾） */
export const ENTRY_OTHER_COLS: ColumnDef[] = [
  { title: '任务', span: 2, width: 100, dataIndex: 'DETAIL_ID', noEdit: true, slot: 'task' },
  { title: '父ID', span: 2, width: 80, dataIndex: 'PARENT_ID', noEdit: true },
  { title: '文件ID', span: 2, width: 100, dataIndex: 'FILE_ID', noEdit: true },
  { title: '版本', span: 2, width: 80, dataIndex: 'SEQ', noEdit: true },
  // 旧配置里这两列与上面重复（baseOtherCols 是从别的页面抄来的），1:1 保留
  { title: '任务ID', span: 2, width: 90, dataIndex: 'DETAIL_ID', noEdit: true },
  { title: '父ID', span: 2, width: 80, dataIndex: 'PARENT_ID', noEdit: true },
  { title: '更新次数', span: 2, width: 80, dataIndex: 'TIMES', noEdit: true },
]

/** 旧 `computed.otherCols`：非必填字段（全量，不截断）+ 7 个固定表信息列 */
export function buildOtherColumns(items: EntryItem[]): ColumnDef[] {
  const ret: ColumnDef[] = items
    .filter((item) => !item.required)
    .map((item) => ({ title: item.itemName, span: 4, dataIndex: item.columnName }))
  return [...ret, ...ENTRY_OTHER_COLS]
}

/** 旧 `computed.editCols`：全量动态列 + otherCols，剔除 noEdit */
export function buildEditColumns(items: EntryItem[]): ColumnDef[] {
  return [...buildDynamicColumns(items, 0), ...buildOtherColumns(items)].filter((col) => !col.noEdit)
}

/**
 * 旧 `computed.detailCols`：表格动态列（前 12）+ otherCols，剔除 noDetail。
 *
 * ⚠️ **本页没有消费者**：旧 MeasureData 把它传给 `<entry-detail :cols="detailCols">`，而
 * `EntryDetail.vue` 的 props 是空的——这个参数从来没被接过（它内部只用写死的
 * `ENTRY_DETAIL.base` / `ENTRY_DETAIL.data`，见本文件的 ENTRY_DETAIL_BASE/DATA）。
 * 也就是说旧版真的详情列集是下面那两组，而 `detailCols` 是个死 prop。
 * 这里保留这个函数只为让「旧 computed 三兄弟（editCols / detailCols / otherCols）」
 * 在代码里能一一对上号，方便后来者核对；新页面（index.vue）不调用它。
 */
export function buildDetailColumns(items: EntryItem[]): ColumnDef[] {
  return [...buildDynamicColumns(items, 12), ...buildOtherColumns(items)].filter((col) => !col.noDetail)
}

/* ------------------------------------------------------------------ *
 * 数据详情抽屉（旧 ENTRY_DETAIL：base 16 列 + data 5 列）             *
 * ------------------------------------------------------------------ */

/** 旧 `allColumns.ENTRY_DETAIL.base` 的 16 列。`link` 值沿用旧 link.all.js 的模板串。 */
export const ENTRY_DETAIL_BASE: ColumnDef[] = [
  { title: '数据ID', span: 2, dataIndex: 'entryId' },
  { title: '源ID', span: 2, dataIndex: 'sourceId', link: '/source/source-list?sourceId=$VAL$' },
  { title: '源名称', span: 2, dataIndex: 'sourceName' },
  { title: '文件ID', span: 2, dataIndex: 'fileId', link: '/inst/file-list?fileId=$VAL$' },
  { title: '类型ID', span: 2, dataIndex: 'entryTypeId', link: '/config/entry-type?entryTypeId=$VAL$' },
  { title: '类型名', span: 2, dataIndex: 'entryTypeName' },
  { title: '父ID', span: 2, dataIndex: 'parentId' },
  { title: '任务ID', span: 2, dataIndex: 'detailId', link: '/inst/task-list?taskId=$VAL$' },
  { title: 'updateDt', span: 2, dataIndex: 'updateDt' },
  { title: 'createDt', span: 2, dataIndex: 'createDt' },
  { title: '版本', span: 2, dataIndex: 'ver' },
  { title: '总次数', span: 2, dataIndex: 'times' },
  { title: '序号', span: 2, dataIndex: 'seq' },
  { title: '抓取日期', span: 2, dataIndex: 'flag1' },
  { title: '原始', span: 2, dataIndex: 'k0' },
  { title: '子数据量', span: 2, dataIndex: 'subsCnt' },
]

/** 旧 `allColumns.ENTRY_DETAIL.data` 的 5 列（详情抽屉里「数据列表」/子表的列） */
export const ENTRY_DETAIL_DATA: ColumnDef[] = [
  { title: '字段ID', span: 2, dataIndex: 'itemId' },
  { title: '字段编码', span: 2, dataIndex: 'itemCode' },
  { title: '字段注释', span: 2, dataIndex: 'itemName' },
  { title: '列名', span: 2, dataIndex: 'columnName' },
  { title: '字段值', span: 2, dataIndex: 'value' },
]

/* ------------------------------------------------------------------ *
 * 源详情抽屉（旧 SOURCE.BASE + SOURCE.OTHER）                        *
 * ------------------------------------------------------------------ */

/**
 * 旧 `allColumns.SOURCE.BASE`（13 列）+ `SOURCE.OTHER`（19 列），取「BASE+OTHER 里 !noDetail 的」
 * ——旧 SourceDetail.vue 的 detailCols 就是这个口径。
 *
 * ⚠️ `dataIndex` 用的是**新适配层的字段名**（`sourceApi.sourceDetail` → `sourceFromLegacy`
 * 的输出，见 api/types/source.ts 的 `Source`），不是旧列配置里的原始列名。逐条对照：
 *   旧 sourceName→name / sourceUrl→url / dataCnt→dataCount / lastInsert→lastInsertAt /
 *   entryTypeId→mainTable / keepLast→resume / jobCnt→jobCount / categoryId→dirId /
 *   templetCode&classify→category / categoryName→categoryPath / sourceParam→coreParam /
 *   classifySub→subCategory / author→owner / isDelete→disabled / createDt→createdAt /
 *   updateDt→updatedAt / lastRun→lastTaskAt / lastSuccess→lastSuccessAt。
 *   旧 `authConfig / lastUrl / domain / priority / tags / remark / state / sourceId / configId /
 *   flowId` 同名保留。
 *
 * 有意偏差（都只影响展示形态，不影响字段本身）：
 *   1. 旧「大类(templetCode)」与「类别(classify)」在新适配层是同一个 `category`（去重后只留「大类」）；
 *      「子类别」走 `subCategory`。
 *   2. `keepLast`(0/1) 与 `isDelete`(0/1) 在新适配层已归一成布尔 `resume` / `disabled`，
 *      这里用 `fun` 显示「是[1]/否[0]」（沿用旧 enableFilter 的文案）。
 *   3. 旧列上那些 `sorter`（比较函数）只服务于旧 s-table 的**本地**排序，详情抽屉不排序，不迁。
 *   4. 「数量(dataCnt)」与「数据(dataCnt)」在旧配置里是同一个字段的两次出现，各留一条（旧版如此）。
 */
export const SOURCE_DETAIL_BASE: ColumnDef[] = [
  { title: '源ID', span: 2, width: 150, dataIndex: 'sourceId', readonly: true },
  { title: '名称', span: 2, dataIndex: 'name' },
  { title: 'URL', span: 4, width: 230, dataIndex: 'url', url: true },
  { title: '配置ID', span: 2, width: 80, dataIndex: 'configId', align: 'center' },
  { title: '流程ID', span: 2, width: 80, dataIndex: 'flowId', align: 'center', noEdit: true },
  { title: '数据', span: 2, width: 80, dataIndex: 'dataCount', noEdit: true, noDetail: true },
  { title: '最新', span: 2, width: 120, dataIndex: 'lastInsertAt', noEdit: true },
  {
    title: '主表',
    span: 2,
    width: 80,
    dataIndex: 'mainTable',
    align: 'center',
    readonly: true,
    more: '该源默认展示的表，更改请从配置ID入口进行修改',
  },
  {
    title: '断点续传',
    span: 2,
    width: 60,
    dataIndex: 'resume',
    align: 'center',
    fun: (v: unknown) => (v === true ? '是[1]' : v === false ? '否[0]' : v),
  },
  { title: '定时', span: 2, width: 60, dataIndex: 'jobCount', noEdit: true, noDetail: true, align: 'center' },
  { title: '步骤', span: 2, width: 60, dataIndex: 'stepCount', noEdit: true, noDetail: true, align: 'center' },
  { title: '域', span: 2, width: 100, dataIndex: 'domain', align: 'center' },
  // 旧「操作」列是 noDetail，详情抽屉里不出现
]

export const SOURCE_DETAIL_OTHER: ColumnDef[] = [
  { title: '大类', span: 2, dataIndex: 'category' },
  { title: '数量', span: 2, dataIndex: 'dataCount' },
  { title: '登陆配置', span: 2, dataIndex: 'authConfig' },
  { title: '上次URL', span: 4, dataIndex: 'lastUrl', url: true, noEdit: true, width: 160 },
  { title: '目录', span: 2, dataIndex: 'dirId' },
  { title: '目录路径', span: 2, noEdit: true, dataIndex: 'categoryPath' },
  { title: '核心参数', span: 4, dataIndex: 'coreParam' },
  { title: '子类别', span: 2, dataIndex: 'subCategory' },
  {
    title: '标签',
    span: 2,
    dataIndex: 'tags',
    fun: (v: unknown) => (Array.isArray(v) ? v.join('、') : v),
  },
  { title: '责任人', span: 2, dataIndex: 'owner' },
  // remark 的可写「保存」按钮由 SourceDetailDialog 注入 save（旧列配置里 save 直接闭包了 updateSource）
  { title: '备注', span: 4, dataIndex: 'remark', type: 'textArea', minRows: 2, maxRows: 8 },
  { title: '优先级', span: 2, dataIndex: 'priority' },
  {
    title: '禁用',
    span: 2,
    dataIndex: 'disabled',
    fun: (v: unknown) => (v === true ? '是[1]' : v === false ? '否[0]' : v),
  },
  { title: '日期', span: 2, dataIndex: 'createdAt', noEdit: true },
  { title: '更新时间', span: 2, dataIndex: 'updatedAt', noEdit: true },
  { title: '状态', span: 2, dataIndex: 'state' },
  { title: '上次任务', span: 2, dataIndex: 'lastTaskAt', noEdit: true },
  { title: '上次成功', span: 2, dataIndex: 'lastSuccessAt', noEdit: true },
]

/** 旧 SourceDetail.detailCols：BASE+OTHER 里 !noDetail 的 */
export function sourceDetailColumns(): ColumnDef[] {
  return [...SOURCE_DETAIL_BASE, ...SOURCE_DETAIL_OTHER].filter((col) => !col.noDetail)
}

/* ------------------------------------------------------------------ *
 * 任务实例（旧 TASK_LIST）                                            *
 * ------------------------------------------------------------------ *
 * ⚠️ 这里**不再重复**定义 TASK_LIST.base / TASK_LIST.other / state 下拉：
 *   `views/Monitor/taskList/` 下已有一份 1:1 迁移好的完整实现（`columns.ts` 的
 *   TASK_LIST_BASE / TASK_LIST_OTHER / detailColumns() / STATE_OPTIONS / taskDotTone /
 *   timeAgoText，以及配套的 TaskDetailDrawer.vue、ConfigTemplateDrawer.vue）。
 *   Monitor 文件夹里的组件按迁移约束可以直接引用，所以「任务实例」弹窗（TaskInstDialog.vue）
 *   直接吃 Monitor 那一套，避免同一份列配置在仓库里出现两份、日后改一处漏一处。
 *   旧 MeasureData 的 `handleShowTask` / `handleShowSubTask` 打开的正是旧 TaskInst 页，
 *   与 Monitor/taskList 是同一个源文件（`src/page/inst/TaskInst.vue`）。
 * ------------------------------------------------------------------ */
