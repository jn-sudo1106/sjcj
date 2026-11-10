/**
 * 「本次忽略进入条件」的发送分组（1109-R01 按节点，2026-11-09）。
 *
 * 后端 `source/nextStep` 只有**整批**参数 `skipCond=1`：它会把本次 `itemConfig` 里
 * **全部**步骤的进入条件一起跳过（`InfoSourceController.java:2311` 算出单个布尔，
 * `ItemConfigService.java:561-592` 在循环里对整个批次生效），没有"只忽略其中几个"的字段。
 *
 * 所以"发 B、C，只忽略 B 的条件"在前端只能拆成两次请求：
 * 先发 `[B] + skipCond=1`，再发 `[C]`。这样拆是等价的——后端按 `itemConfig` 逐个步骤
 * 独立建任务、按 `configId` 各自做 `hasExecNext` 幂等检查，两次请求之间没有依赖。
 * （等后端支持 `ignoreConditionStepIds` 后可以把这里换成一次请求，见方案二期。）
 *
 * 三种形态：
 * - 没勾 / 勾的和本次发送范围不相交 → 一次普通请求，不带 skipCond
 * - 勾选覆盖全部发送范围 → 一次请求 + skipCond=1（等价旧 Vue 的"强制跳过条件"整批行为）
 * - 只勾选一部分 → 两次请求，先跳过组再正常组
 */
export interface SkipCondSendPlan {
  /** 本次要跳过进入条件、仍然照常发送的步骤 */
  skipIds: string[]
  /** 本次按原进入条件判断的步骤 */
  normalIds: string[]
  /** 是否要拆成两次请求 */
  split: boolean
  /** 是否在（唯一那次）请求里带 skipCond=1 */
  skipCond: boolean
}

export function planSkipCondSend(allIds: string[], checkedIds: Iterable<string>): SkipCondSendPlan {
  const checked = new Set(checkedIds)
  const skipIds = allIds.filter((id) => checked.has(id))
  const normalIds = allIds.filter((id) => !checked.has(id))
  return {
    skipIds,
    normalIds,
    split: skipIds.length > 0 && normalIds.length > 0,
    // 只有"全部跳过"才用一次请求走整批参数；部分跳过交给 split 两次请求
    skipCond: skipIds.length > 0 && normalIds.length === 0,
  }
}