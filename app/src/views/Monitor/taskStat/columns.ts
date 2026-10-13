// 任务统计页的静态配置：状态选项、明细表列定义、错误率预设、口径说明文案。
// 与旧 page/inst/TaskStat.vue 的 data/computed 逐条对齐（选项文案、列宽、排序器、空态文案都照抄）。
import type { StatRow } from './stat'

/** 任务状态（旧页取自 StateEnum，共 16 项；下拉文案是「值 - 名称」） */
export const STAT_STATE_OPTIONS: { value: string; label: string }[] = [
  { value: 'WD', label: 'WAIT DOWN' },
  { value: 'WC', label: 'WAIT CONFIG' },
  { value: 'W1', label: '待派发任务' },
  { value: 'W0', label: '等待其它字段' },
  { value: 'W', label: 'WAIT' },
  { value: 'D', label: 'DELETE' },
  { value: 'C', label: 'COMPLETE' },
  { value: 'E', label: 'ERROR' },
  { value: 'L', label: 'LOCK' },
  { value: 'T', label: 'FOR TEST' },
  { value: 'WA', label: '待审核' },
  { value: 'A', label: '已审核' },
  { value: 'AC', label: '自动完成' },
  { value: 'K', label: '仅记录，无需处理' },
  { value: 'RL', label: '重试中' },
  { value: 'RC', label: '已生成重试任务' },
]

/** 错误率阈值快捷项（%）：点击即筛「错误率 >= 阈值」，再次点击同一项取消 */
export const RATE_PRESETS = [100, 90, 80, 70, 60, 50]

/** 环图下方的口径备注（旧页硬编码在模板里） */
export const PIE_OTHER_NOTE = '其他 = 未单列状态：WD/WC/W0/D/T/WA/A/K/RL/RC'

/** 页头问号的帮助说明（旧页 helpText） */
export const HELP_TEXT = [
  '口径：按任务创建时间(CREATE_DT)统计，含全部状态（含AC自动完成/D删除），与任务实例列表口径可能不同。',
  '时间仅支持 yyyy-MM-dd 与 yyyy-MM-dd HH:mm:ss 两种格式，范围≤30天，默认当天。',
  '状态筛选中"不限"时提供总任务与 ERROR 双重视角；错误率为 ERROR/全部任务（含排队中，参考值）。',
].join('\n')

/** 明细表列的渲染类别（模板里按 slot 分支渲染） */
export type StatColumnSlot = 'index' | 'source' | 'config' | 'cnt' | 'rate' | 'errorCnt' | 'errorRate' | 'action'

export interface StatColumn {
  title: string
  prop: string
  /**
   * 列宽**下限**（旧页 antd 的 `width`）。
   *
   * 这里刻意用 `min-width` 而不是 `width`：el-table 只有在存在「没有数字 width」的列时才会把
   * 容器剩余宽度分配给这些列（见 table-layout 的 `flexColumns`）；若所有列都给死 `width`，
   * 它会把表格宽度定成各列之和，容器再宽也在右侧留一条空白（空数据时最明显：表头只到 1050px，
   * 而空态占位块却铺满 1516px，观感断裂）。
   * 旧页 antd 的 `<table>` 是 `width:100%`，所有列按比例分掉剩余宽度，所以用 min-width 才是 1:1。
   * 数值沿用旧页原样，窄窗口下这些值就是各列的固定宽度（此时横向滚动，与旧页一致）。
   */
  minWidth: number
  slot: StatColumnSlot
  /** 客户端排序比较器（旧页 a-table 的 sorter，在整份数据上排序，不是服务端排序） */
  sortMethod?: (a: StatRow, b: StatRow) => number
  /** 进页面就默认降序的列（旧页 errorRate 列在开启阈值筛选时 defaultSortOrder='descend'） */
  defaultDesc?: boolean
}

/**
 * 明细表列（旧页 columns computed）。
 * 单一状态过滤时 ERROR 双重视角不适用 → 去掉「ERROR数 / 错误率」两列。
 * 注意「任务占比」的 dataIndex 是 rate（行上没有该字段，由 percentOf 现算），
 * 排序器比的仍是 cnt —— 旧页就是这么写的，照抄。
 */
export function statColumns(stateFiltered: boolean, rateActive: boolean): StatColumn[] {
  const cols: StatColumn[] = [
    { title: '#', prop: 'no', minWidth: 60, slot: 'index' },
    { title: '来源ID', prop: 'sourceId', minWidth: 110, slot: 'source' },
    { title: '配置ID', prop: 'configId', minWidth: 110, slot: 'config' },
    { title: '任务数', prop: 'cnt', minWidth: 130, slot: 'cnt', sortMethod: (a, b) => a.cnt - b.cnt },
    { title: '任务占比', prop: 'rate', minWidth: 190, slot: 'rate', sortMethod: (a, b) => a.cnt - b.cnt },
  ]
  if (!stateFiltered) {
    cols.push(
      { title: 'ERROR数', prop: 'errorCnt', minWidth: 110, slot: 'errorCnt', sortMethod: (a, b) => a.errorCnt - b.errorCnt },
      {
        title: '错误率',
        prop: 'errorRate',
        minWidth: 190,
        slot: 'errorRate',
        sortMethod: (a, b) => a.errorRate - b.errorRate,
        defaultDesc: rateActive,
      },
    )
  }
  cols.push({ title: '操作', prop: 'action', minWidth: 150, slot: 'action' })
  return cols
}

/** 明细表空态文案（旧页 tableLocale.emptyText） */
export function emptyText(rateActive: boolean, threshold: number): string {
  return rateActive
    ? `当前条件下没有错误率 ≥ ${threshold}% 的分组，可调整阈值或清除筛选查看全部`
    : '当前条件下暂无统计数据，可调整时间范围或过滤条件'
}
