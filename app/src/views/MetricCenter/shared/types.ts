// 指标中心共享的「列驱动」配置类型。
//
// 旧平台 `config/column.config.js` 的每一列就是一个普通对象，弹窗（BaseEdit.vue）、
// 详情抽屉（BaseDetail.vue）、表格（s-table / u-table）三处都直接消费它——列定义是这套
// 页面的事实源。1014 迁移「指标列表」（旧 page/config/MeasureList.vue）与「指标结果」
// （旧 page/inst/MeasureData.vue）时照搬这套写法，把旧字段名原样保留，只在类型上收紧。
//
// ⚠️ 字段名一律用旧平台的名字（dataIndex / scopedSlots / values ...），**不做驼峰重命名**——
// 这样从旧 column.config.js 里抄过来的列定义可以逐行对照，降低抄错的风险。

/** SELECT / INT_BOOL / TAGS 等下拉的候选项（旧 `values: [{ value, text }]`） */
export interface ColumnOption {
  value: string | number
  text: string
}

/**
 * 列渲染形态。
 * `cron` / `CONFIG` / `FLOW_ID` / `CATEGORY` / `ENTRY_TYPE` / `SOURCE_TYPE` 六个是旧 BaseEdit
 * 支持的**远程下拉/子编辑器**分支；指标列表与指标结果用到的列集里**一个都没有**
 * （已逐列核对 MEASURE / ENTRY_DETAIL / SOURCE 三组配置），所以共享弹窗只保留
 * 这些分支的「降级为普通输入框」行为，遇到时在控制台留一条告警——避免有一天真加了
 * 这类列、静默变成一个不能选的文本框（见 ColumnEditDialog.vue 的 `warnUnsupported`）。
 */
export type ColumnType =
  | 'textArea'
  | 'span'
  | 'checkbox'
  | 'SELECT'
  | 'INT_BOOL'
  | 'json'
  | 'TAGS'
  | 'int'
  | 'ENTRY_COLUMNS'
  | 'cron'
  | 'CONFIG'
  | 'FLOW_ID'
  | 'CATEGORY'
  | 'ENTRY_TYPE'
  | 'SOURCE_TYPE'

/** 一列的完整定义。必填项只有 title / dataIndex，其余按需。 */
export interface ColumnDef {
  /** 列标题（表格表头 + 弹窗/抽屉的字段名） */
  title: string
  /** 字段名，同时是取值 key */
  dataIndex: string
  /** 弹窗栅格里占几格（旧 a-descriptions `:column="4"` 的 span） */
  span?: number
  /** 表格列固定宽度（px）。**给了 width 就不能给 minWidth**，见 columns.ts 的说明 */
  width?: number
  /** 表格列最小宽度（px）。文本列走这个才不会把表格撑出横向留白 */
  minWidth?: number
  align?: 'left' | 'center' | 'right'
  /** 输入框 placeholder / 下拉说明（旧 `tips`） */
  tips?: string
  /** 标题右侧问号气泡的文案（旧 `more`） */
  more?: string
  /** 输入框禁用 */
  readonly?: boolean
  /** 编辑弹窗里不出现 */
  noEdit?: boolean
  /** 详情抽屉里不出现 */
  noDetail?: boolean
  /** 新增弹窗里不出现（旧 CategoryTree 用） */
  noAdd?: boolean
  /** 表格列可排序（服务端排序，映射成 el-table 的 sortable="custom"） */
  sorter?: boolean
  /**
   * 表格单元格走哪个插槽（旧 `scopedSlots.customRender` 的等价物）。
   * 这里只收成 `string`——每个页面的 slot 取值集合不同（指标列表 5 个、指标结果 3 个），
   * 由各页自己的 columns.ts 收窄成联合类型再导出，避免共享层耦合页面语义。
   */
  slot?: string
  type?: ColumnType
  /** SELECT / INT_BOOL 之外的候选项（旧 `values`） */
  values?: ColumnOption[]

  /* ---- 详情抽屉专用（旧 BaseDetail 的渲染分支） ---- */
  /** 值渲染成站内链接（旧 `link: allLinks.XXX`，`$VAL$` 会被值替换） */
  link?: string
  /** 值渲染成外链（旧 `href`，`$VAL$` 会被值替换） */
  href?: string
  /** 值本身就是 URL（旧 `url: true`） */
  url?: boolean
  /** 自定义渲染（旧 `fun`） */
  fun?: (value: unknown) => unknown
  /** textArea 字段的「保存」回调（旧 SOURCE.remark 的 `save`） */
  save?: (record: Record<string, unknown>) => Promise<unknown>
  minRows?: number
  maxRows?: number
  placeholder?: string
}
