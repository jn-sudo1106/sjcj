// 指标数据集列定义 —— 1:1 迁移旧 data-view `src/config/column.config.js` 的 `allColumns.DATASET`
// （base 12 列 + other 6 列）。
//
// 旧页面用两份列集：
//   · 表格列   = base（s-table 的 :columns）
//   · 弹窗/抽屉 = base + other 按 noEdit / noDetail 过滤（DatasetList.vue 的 editCols / detailCols）
// 所以这里把 18 列放一份，再导出两个派生函数，口径与旧 computed 完全一致。
//
// `span` 是旧 a-descriptions :column="4" 的栅格（span=2 → 半行，span=4 → 整行），
// 新版弹窗用 el-descriptions :column="4" + :span 还原同样的排版。
// `sorter` 是**服务端**排序：旧列上的 `sorter: true` / 比较函数经旧 s-table
// （components/Table/index.js:135-151 的 `onChange={this.loadData}`）转成 sortField/sortOrder 随 GET 发出去，
// 由后端排序（比较函数只让 antd 顺手排了当前页，随即又被服务端结果覆盖）。
// 新版表格列据此挂 `sortable="custom"`——只渲染表头箭头 + 抛 sort-change，排序同样后端做。
// 旧配置里有 7 列带 sorter：datasetId / measureCnt / entryTypeId / lastId / lastRun / nextRun / sourceId。
//
// 列宽口径（旧版全部写死 width，容器宽时剩余空间只能塞给最后一列）：
//   · 文本列（数据集名称 / 定时）给 `minWidth` → 自适应，容器变宽时按比例变宽
//   · 数值 / 状态 / 操作列给 `width` → 定宽居中，数字对齐稳定
//   旧版的 width 原值一并留在注释里，方便对照。

export interface DatasetColumn {
  title: string
  dataIndex: string
  /** el-descriptions 的栅格占位（旧 a-descriptions 是 4 列） */
  span?: number
  /** 表格列固定宽（数值/状态/操作这类定宽列用） */
  width?: number
  /** 表格列最小宽（文本列用：el-table 用它吃掉剩余空间，容器变宽列就跟着变宽） */
  minWidth?: number
  align?: 'left' | 'center' | 'right'
  /** 旧列的 tips：表单里当 placeholder / 详情里当问号提示 */
  tips?: string
  /** 表单里禁用（旧 BaseEdit 的 `:disabled="item.readonly"`） */
  readonly?: boolean
  /** 旧列的服务端排序标记（新版映射成 el-table 的 sortable="custom"，排序交给后端） */
  sorter?: boolean
  /** 不进编辑弹窗（旧 noEdit） */
  noEdit?: boolean
  /** 不进详情抽屉（旧 noDetail） */
  noDetail?: boolean
  /** 表格单元格走哪个插槽（旧 scopedSlots.customRender 的等价物） */
  slot?: 'id' | 'name' | 'measureCnt' | 'lastDate' | 'action'
  /** 表单控件类型（旧 BaseEdit 的 item.type 口径，缺省 = 普通输入框） */
  type?: 'cron' | 'textArea'
}

/** `allColumns.DATASET.base` —— 表格列（12 列，标题/对齐/顺序 1:1） */
export const DATASET_BASE: DatasetColumn[] = [
  { title: '数据集ID', dataIndex: 'datasetId', span: 2, width: 90, align: 'center', readonly: true, sorter: true, slot: 'id' },
  { title: '数据集名称', dataIndex: 'datasetName', span: 2, minWidth: 150, slot: 'name' }, // 旧 width 120
  { title: '指标数', dataIndex: 'measureCnt', span: 2, width: 90, align: 'center', noEdit: true, sorter: true, slot: 'measureCnt' },
  { title: '表ID', dataIndex: 'entryTypeId', span: 2, width: 90, align: 'center', readonly: true, sorter: true },
  { title: '上次ID', dataIndex: 'lastId', span: 2, width: 90, align: 'center', sorter: true },
  { title: '定时', dataIndex: 'schedule', span: 2, minWidth: 130, type: 'cron' }, // 旧 width 120
  { title: '上次运行', dataIndex: 'lastRun', span: 2, width: 100, align: 'center', noEdit: true, sorter: true, slot: 'lastDate' }, // 旧 width 90
  { title: '下次运行', dataIndex: 'nextRun', span: 2, width: 100, align: 'center', noEdit: true, sorter: true, slot: 'lastDate' }, // 旧 width 80
  { title: '执行', dataIndex: 'runCnt', span: 2, width: 80, align: 'center', noEdit: true }, // 旧 width 70
  { title: '成功', dataIndex: 'successCnt', span: 2, width: 80, align: 'center', noEdit: true }, // 旧 width 70
  { title: '状态', dataIndex: 'state', span: 2, width: 85, align: 'center', noEdit: true }, // 旧 width 80
  { title: '操作', dataIndex: 'action', span: 2, width: 175, noEdit: true, noDetail: true, slot: 'action', align: 'center' }, // 旧 width 180
]

/** `allColumns.DATASET.other` —— 只在编辑弹窗 / 详情抽屉里出现（6 列） */
export const DATASET_OTHER: DatasetColumn[] = [
  { title: '源ID', dataIndex: 'sourceId', span: 2, width: 100, align: 'center', readonly: true, sorter: true },
  {
    title: 'SQL条件片断',
    dataIndex: 'filters',
    span: 4,
    width: 120,
    tips: "基于当前数据表的条件片断,如：STATE='C' AND K1='123'",
    // 旧配置把 nameSlot 也挂在这一列上，但它只出现在弹窗/抽屉里，而那两处都不渲染表格插槽 → 无影响
  },
  {
    title: '自定义查询SQL',
    dataIndex: 'sqlDef',
    span: 4,
    width: 150,
    tips: "如：SELECT ENTRY_ID, K1 FROM TB_TEST WHERE STATE = 'C'",
  },
  { title: '域名', dataIndex: 'domain', span: 2, width: 80, noEdit: true },
  { title: '启用', dataIndex: 'isDelete', span: 2, width: 80, noEdit: true },
  { title: 'ver', dataIndex: 'ver', span: 2, width: 80, noEdit: true },
]

/** 全部列（base + other），对应旧 `[...this.columns, ...this.otherCols]` */
export const DATASET_ALL: DatasetColumn[] = [...DATASET_BASE, ...DATASET_OTHER]

/** 编辑弹窗字段：排除 noEdit（旧 editCols）= 数据集ID / 数据集名称 / 表ID / 上次ID / 定时 / 源ID / SQL条件片断 / 自定义查询SQL */
export function editColumns(): DatasetColumn[] {
  return DATASET_ALL.filter((c) => !c.noEdit)
}

/** 详情抽屉字段：排除 noDetail（旧 detailCols）= 除「操作」外的 17 列 */
export function detailColumns(): DatasetColumn[] {
  return DATASET_ALL.filter((c) => !c.noDetail)
}

/** 旧全局过滤器 `stateFilter`（utils/filter.js） */
export function stateText(value: unknown): string {
  switch (value) {
    case 'C':
      return '正常'
    case 'E':
      return '出错'
    case 'L':
      return '处理中'
    case 'AC':
      return '已审核'
    case 'W':
      return '待处理'
    default:
      return value == null ? '' : String(value)
  }
}

/** 旧全局过滤器 `enableFilter`（utils/filter.js）：只认 1/0
 *  ⚠️ 口径：`isDelete` 字段 **0 = 启用 / 1 = 停用**（列标题「启用」），故 0 → 是、1 → 否。 */
export function enableText(value: unknown): string {
  if (value === 0) return '是[1]'
  if (value === 1) return '否[0]'
  return value == null ? '' : String(value)
}
