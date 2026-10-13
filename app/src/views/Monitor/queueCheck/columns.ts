// 队列告警列定义 —— 1:1 迁移旧 data-view `src/config/column.config.js` 的 `allColumns.MQ_CHECK`
// （base 9 列 + other 4 列）。
//
// 旧页面用两份列集：
//   · 表格列  = base（s-table 的 :columns）
//   · 弹窗/抽屉 = base + other 按 noEdit / noAdd / noDetail 过滤（QueueCheck.vue 的 editCols/addCols/detailCols）
// 所以这里把 13 列放一份，再导出三个派生函数，口径与旧 computed 完全一致。
//
// `span` 是旧 a-descriptions :column="4" 的栅格（span=2 → 半行，span=4 → 整行），
// 新版弹窗用 el-descriptions :column="4" + :span 还原同样的排版。
// `sorter: true` 是**服务端**排序：旧 s-table 把表头的 sorter 转成 sortField/sortOrder 随 GET 一起发出去
// （旧 components/Table/index.js:135-151，order 原样用 antd 的 'ascend' / 'descend'），由后端排序。
// 新版表格列据此挂 `sortable="custom"`——只负责渲染表头箭头 + 抛 sort-change，**不排当前页**，排序同样后端做。
// 旧配置里带 sorter 的是 4 列：queueName / maxSize / minConsumer / maxRate。

export interface QueueColumn {
  title: string
  dataIndex: string
  /** el-descriptions 的栅格占位（旧 a-descriptions 是 4 列） */
  span?: number
  /** 表格列固定宽（数值/状态/操作这类定宽列用） */
  width?: number
  /** 表格列最小宽（文本列用：el-table 用它吃掉剩余空间，容器变宽列就跟着变宽） */
  minWidth?: number
  align?: 'left' | 'center' | 'right'
  /** 旧列的 tips：表单里显示成 tooltip */
  tips?: string
  /** 旧列的服务端排序标记（新版映射成 el-table 的 sortable="custom"，排序交给后端） */
  sorter?: boolean
  noAdd?: boolean
  noEdit?: boolean
  noDetail?: boolean
  /** 表单控件类型：旧 BaseEdit 的 item.type 口径，缺省 = 普通输入框 */
  type?: 'INT_BOOL' | 'textArea' | 'span' | 'checkbox' | 'SELECT'
  values?: Array<{ text: string; value: unknown }>
}

/** `allColumns.MQ_CHECK.base`
 *
 *  列宽口径（旧版是全部写死 width，容器宽时剩余空间只能塞给最后一列，窄的文本列又把内容挤折行）：
 *   · 文本列（队列名 / 执行结果 / 描述）给 `minWidth` → 自适应，容器变宽时按比例变宽
 *   · 数值 / 状态 / 操作列给 `width` → 定宽居中，数字对齐稳定
 *  旧版的 width 原值一并保留在注释里，方便对照。
 */
export const MQ_CHECK_BASE: QueueColumn[] = [
  { title: '队列名', dataIndex: 'queueName', span: 2, width: 150, minWidth: 180, sorter: true }, // 旧 width 150
  { title: '状态', dataIndex: 'state', span: 2, width: 90, align: 'center', noEdit: true, noAdd: true }, // 旧 80
  { title: '执行结果', dataIndex: 'lastMsg', span: 4, width: 180, minWidth: 240, align: 'left', noAdd: true, noEdit: true }, // 旧 width 180
  { title: '描述', dataIndex: 'queueDesc', span: 2, width: 90, minWidth: 140, align: 'center', tips: '队列用途说明' }, // 旧 width 90
  { title: '队列积压超过', dataIndex: 'maxSize', span: 2, width: 130, align: 'center', sorter: true }, // 旧 90
  { title: '消费者数低于', dataIndex: 'minConsumer', span: 2, width: 130, align: 'center', sorter: true },
  { title: '消费速率低于', dataIndex: 'minRate', span: 2, width: 100, align: 'center' },
  {
    title: '消费速率高于', dataIndex: 'maxRate', span: 2, width: 130, align: 'center', sorter: true,
    tips: '如一些网站出异常,导致不正常快速消费完',
  },
  { title: '操作', dataIndex: 'action', span: 2, width: 96, noEdit: true, noAdd: true, noDetail: true }, // 旧 100
]

/** `allColumns.MQ_CHECK.other` */
export const MQ_CHECK_OTHER: QueueColumn[] = [
  {
    title: '自定义检测出错', dataIndex: 'check', span: 4, width: 90, align: 'center',
    tips: '非必填，脚本返回true时表示有异常',
  },
  {
    title: '告警提示', dataIndex: 'checkMsg', span: 2, width: 90, align: 'center',
    tips: '非必填，动态检测异常时提示信息定义',
  },
  { title: '生成时间', dataIndex: 'createDt', span: 2, width: 90, align: 'center', noAdd: true, noEdit: true },
  { title: '是否禁用', dataIndex: 'isDelete', span: 2, width: 90, align: 'center', type: 'INT_BOOL' },
]

/** 全部列（base + other），对应旧 `[...this.columns, ...this.otherCols]` */
export const MQ_CHECK_ALL: QueueColumn[] = [...MQ_CHECK_BASE, ...MQ_CHECK_OTHER]

/** 编辑弹窗字段：排除 noEdit（旧 editCols） */
export function editColumns(): QueueColumn[] {
  return MQ_CHECK_ALL.filter((c) => !c.noEdit)
}

/** 新增弹窗字段：排除 noAdd（旧 addCols） */
export function addColumns(): QueueColumn[] {
  return MQ_CHECK_ALL.filter((c) => !c.noAdd)
}

/** 详情抽屉字段：排除 noDetail（旧 detailCols） */
export function detailColumns(): QueueColumn[] {
  return MQ_CHECK_ALL.filter((c) => !c.noDetail)
}

/** 旧全局过滤器 `stateFilter`（utils/filter.js） */
export function stateText(value: string | undefined): string {
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
      return value ?? ''
  }
}

/** 旧全局过滤器 `enableFilter`（utils/filter.js）：只认 1/0 */
export function enableText(value: unknown): string {
  if (value === 1) return '是[1]'
  if (value === 0) return '否[0]'
  return String(value ?? '')
}
