// 指标列表的列定义 —— 1:1 抄自旧平台 `data-view/src/config/column.config.js` 的 `MEASURE` 段。
//
// 四组（旧名保持不动，页面里按同一套名字取用）：
//   MEASURE_BASE      13 列 → 表格列 + 编辑弹窗 + 详情抽屉
//   MEASURE_OTHER      1 列（更新时间）→ **只**进编辑弹窗与详情抽屉，不进表格
//   MEASURE_JSON_DIM   8 列 → 「纬度」JSON 子编辑器（ColumnEditDialog 的 cols）
//   MEASURE_JSON_VAL   4 列 → 「值1/值2/单位/条件」JSON 子编辑器
//
// ⚠️ 表格里的 6 个插槽（旧 `scopedSlots.customRender`）按原样映射成 `slot` 字段，
// 页面按 slot 分支渲染：
//   measureId → 'id'（在用=纯文本 / 停用=红标签 / 历史删除=感叹号+标签）
//   measureName, measureType → 'name'（限宽省略 + popover 全文）
//   keyDef, val1Def, val2Def, unitDef → 'json'（限宽 + popover 里带「编辑」图标）
//   dimDef → 'jsonDim'（同上，但打开的是 json_dim 列集）
//   action → 'action'
// 旧模板里还有 freqSlot / lastDateSlot 两个插槽，但 **MEASURE 的任何一列都没有引用它们**
// （逐列核对过 base/other/json_dim/json_val 四组），属于死代码，不迁。顺带也就不必复刻
// freqSlot 里 `text ? '月频' : '日频'` 那个恒等于「日频」的旧 bug。
//
// ⚠️ 列宽：旧版给每一列都写了固定 width，再加上 `:scroll="{x:1500}"`。el-table 只会把
// 「非数字 width」的列拿去分配剩余宽度，所以这里把**文本列改走 minWidth**（限宽 + 吸收多余宽度），
// 数值/状态/操作列保持固定 width —— 与 indicatorDataset / queueCheck 的处理同口径。
// 长度接近旧 1500 的合计值，容器窄时照旧横向滚动；**操作列 `fixed: 'right'`**，横向滚动时始终可见。
import type { ColumnDef } from '../shared/types'

/** 本页的列定义：在共享 `ColumnDef` 上把 `slot` 收窄成这 5 个取值。
 *  （共享层只约定 `slot?: string`，页面级语义由各页自己收窄。） */
export interface MeasureColumn extends ColumnDef {
  slot?: 'id' | 'name' | 'json' | 'jsonDim' | 'action'
  /** 表格列固定在右侧（照 `Monitor/taskList/columns.ts` 的 `TaskColumn` 收窄成只允许 right） */
  fixed?: 'right'
}

/** MEASURE.base 的 13 列（表格 + 编辑 + 详情共用） */
export const MEASURE_BASE: MeasureColumn[] = [
  {
    title: 'ID',
    span: 2,
    width: 100,
    dataIndex: 'measureId',
    // 旧列是 readonly: true → 编辑弹窗里禁用；required: true 在旧 BaseEdit 里是空转的
    // （rules 挂在 a-input 上、validate() 收不到），这里同样不做前端必填拦截。
    readonly: true,
    sorter: true,
    slot: 'id',
  },
  { title: '编码[唯一]', span: 2, minWidth: 110, dataIndex: 'measureCode' },
  { title: '名称', span: 2, minWidth: 140, dataIndex: 'measureName', slot: 'name' },
  { title: '源ID', span: 2, width: 100, dataIndex: 'sourceId' },
  { title: '类型', span: 2, minWidth: 100, dataIndex: 'measureType', slot: 'name' },
  { title: '数据集', span: 2, width: 90, dataIndex: 'datasetId' },
  { title: '条件', span: 4, minWidth: 140, dataIndex: 'keyDef', slot: 'json' },
  { title: '纬度', span: 4, minWidth: 140, dataIndex: 'dimDef', slot: 'jsonDim' },
  { title: '值1', span: 4, minWidth: 140, dataIndex: 'val1Def', slot: 'json' },
  { title: '值2', span: 4, minWidth: 140, dataIndex: 'val2Def', slot: 'json' },
  { title: '单位', span: 4, minWidth: 140, dataIndex: 'unitDef', slot: 'json' },
  { title: '启用', span: 2, width: 80, dataIndex: 'isDelete' },
  {
    title: '操作',
    span: 2,
    width: 150,
    dataIndex: 'action',
    noEdit: true,
    noDetail: true,
    slot: 'action',
    align: 'center',
    // 本页列总宽（≈1470）超出内容区（≈1180）会横向滚动，操作列固定在右侧才不会
    // 「拉开滚动条才能点编辑」。旧 s-table 是 `:scroll="{x:1500}"` + 各列 width，
    // 没有 fixed；这里跟 Monitor/taskList 的口径统一。
    fixed: 'right',
  },
]

/** MEASURE.other 的 1 列（更新时间）——不进表格 */
export const MEASURE_OTHER: MeasureColumn[] = [
  { title: '更新时间', span: 2, width: 80, dataIndex: 'updateDt' },
]

/** MEASURE.json_dim 的 8 列（纬度 JSON 子编辑器） */
export const MEASURE_JSON_DIM: MeasureColumn[] = [
  { title: '数据列-数据集列名（必选)', span: 2, tips: '对应数据集中列名', width: 80, dataIndex: 'cols', type: 'ENTRY_COLUMNS' },
  {
    title: '类型（必选)',
    span: 2,
    width: 80,
    dataIndex: 'type',
    type: 'SELECT',
    values: [
      { value: 'date', text: '日期(date)' },
      { value: 'num', text: '数值(num)' },
      { value: 'string', text: '字符串(string)' },
    ],
  },
  {
    title: '预处理函数',
    span: 2,
    width: 80,
    tips: "可选,如替换掉逗号 string.replace_all(value, ',', '')",
    dataIndex: 'clearRule',
  },
  { title: '默认值(或固定值)', span: 2, width: 80, tips: '原始数据为空时, 填充默认值或固定值', dataIndex: 'nvl' },
  {
    title: '原始日期格式',
    span: 2,
    width: 80,
    tips: '可选,如 yyyy年M月, 按原始数据的日期格式填写，仅类型为date时需要填',
    dataIndex: 'from',
  },
  {
    title: '目标日期格式',
    span: 2,
    width: 80,
    dataIndex: 'to',
    type: 'SELECT',
    values: [
      { value: 'yyyy-MM-dd', text: '标准日期(yyyy-MM-dd)' },
      { value: '', text: '空(仅预处理,不转换格式)' },
    ],
  },
  {
    title: '范围: From天前(注1)',
    span: 2,
    width: 80,
    tips: '回溯处理日期值为 >= T-N天的数据,即start_date',
    dataIndex: 'min',
    type: 'int',
  },
  {
    title: '范围: To天前(注1)',
    span: 2,
    width: 80,
    tips: '回溯处理日期值为 <= T-N天的数据,即end_date',
    dataIndex: 'delay',
    type: 'int',
  },
]

/** MEASURE.json_val 的 4 列（条件 / 值1 / 值2 / 单位 JSON 子编辑器） */
export const MEASURE_JSON_VAL: MeasureColumn[] = [
  { title: '数据列-数据集列名（必选)', span: 2, tips: '对应数据集中列名', width: 80, dataIndex: 'cols', type: 'ENTRY_COLUMNS' },
  {
    title: '类型（必选)',
    span: 2,
    width: 80,
    dataIndex: 'type',
    type: 'SELECT',
    values: [
      { value: 'date', text: '日期(date)' },
      { value: 'num', text: '数值(num)' },
      { value: 'string', text: '字符串(string)' },
    ],
  },
  {
    title: '预处理函数',
    tips: "可选,如替换掉逗号 string.replace_all(value, ',', '')",
    span: 2,
    width: 80,
    dataIndex: 'clearRule',
  },
  { title: '默认值(或固定值)', tips: '原始数据为空时, 填充默认值或固定值', span: 2, width: 80, dataIndex: 'nvl' },
]

/** 旧 `computed.editCols`：base + other，剔除 noEdit */
export function editColumns(): MeasureColumn[] {
  return [...MEASURE_BASE, ...MEASURE_OTHER].filter((col) => !col.noEdit)
}

/** 旧 `computed.detailCols`：base + other，剔除 noDetail */
export function detailColumns(): MeasureColumn[] {
  return [...MEASURE_BASE, ...MEASURE_OTHER].filter((col) => !col.noDetail)
}
