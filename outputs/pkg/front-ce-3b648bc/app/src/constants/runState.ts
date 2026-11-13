// 状态码中文字典（1021-05，设计方案 §5.4）：数据中心、任务、步骤里出现状态码的地方统一走这里，
// 不再各写一份 `state === 'E' ? '异常' : …`。未知值原样显示并带「未知状态」提示，不吞掉也不猜。
//
// 两类状态不要混用：
// - 运行状态（任务 / 步骤 / 源）：L 运行中、C 完成、E 异常、D 已停用 …
// - 数据状态（数据表 STATE 列）：C 初始、AC 已审核、NF 404、E 异常、D 已删除——同一个 C 意思不同。
//   数据质量状态流转（草稿 → 校验 → 发布）不在本次范围，口径定了再改这里。

export interface StateInfo {
  /** 原始状态码（空值为 ''） */
  code: string
  /** 显示文字：已知码为中文，未知码原样，空值为调用方给的占位 */
  label: string
  /** 悬浮说明 */
  hint: string
  known: boolean
}

interface StateDef { label: string; hint: string }

/** 运行状态：任务实例、流程节点（步骤）的 state */
const RUN_STATE: Record<string, StateDef> = {
  L: { label: '运行中', hint: '正在运行' },
  C: { label: '完成', hint: '最近一次运行已完成' },
  E: { label: '异常', hint: '运行出错，可在任务实例里查看' },
  D: { label: '已停用', hint: '源已停用，不再调度运行' },
  W: { label: '待处理', hint: '已生成，等待处理' },
  W1: { label: '排队', hint: '已进入队列，等待执行' },
  AC: { label: '跳过', hint: '本次跳过未执行' },
}

/**
 * 源的 state 与任务同一套码，但源管理把 C 叫「正常」、AC 叫「已审核」（旧 utils/filter.js 的 stateFilter），
 * 数据中心里展示源状态时跟源管理保持同一个叫法，测试两边对得上。
 */
const SOURCE_RUN_STATE: Record<string, StateDef> = {
  ...RUN_STATE,
  C: { label: '正常', hint: '最近一次运行正常结束' },
  AC: { label: '已审核', hint: '已审核' },
}

/** 数据状态：数据表 STATE 列（与 DataQueryPanel 的状态筛选项同一口径） */
const DATA_STATE: Record<string, StateDef> = {
  C: { label: '初始', hint: '采集入库后的初始状态' },
  AC: { label: '已审核', hint: '已审核通过' },
  NF: { label: '404', hint: '原始页面已不存在（404）' },
  E: { label: '异常', hint: '处理异常' },
  D: { label: '已删除', hint: '软删除' },
}

function lookup(dict: Record<string, StateDef>, value: string | null | undefined, empty: string): StateInfo {
  const code = value == null ? '' : String(value).trim()
  if (!code) return { code, label: empty, hint: '', known: true }
  const def = dict[code]
  if (def) return { code, label: def.label, hint: `${def.hint}（${code}）`, known: true }
  return { code, label: code, hint: `未知状态：${code}`, known: false }
}

/** 任务 / 步骤的运行状态 */
export function runStateInfo(value: string | null | undefined, empty = '—'): StateInfo {
  return lookup(RUN_STATE, value, empty)
}

/** 源的运行状态（叫法跟源管理一致） */
export function sourceRunStateInfo(value: string | null | undefined, empty = '—'): StateInfo {
  return lookup(SOURCE_RUN_STATE, value, empty)
}

/** 数据表 STATE 列 */
export function dataStateInfo(value: string | null | undefined, empty = '—'): StateInfo {
  return lookup(DATA_STATE, value, empty)
}
