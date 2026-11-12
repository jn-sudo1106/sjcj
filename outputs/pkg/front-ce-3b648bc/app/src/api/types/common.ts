// 通用基础类型（P1-3 拆 8 域 · common 域）
// 跨域被引用：所有其他 7 个域都依赖这里的 Paged/PageQuery/RunState/Ack。
// 无外部 import，作为依赖图最底层。

/** 通用分页返回 */
export interface Paged<T> {
  total: number
  list: T[]
}

/** 通用分页查询入参 */
export interface PageQuery {
  page?: number
  size?: number
  [key: string]: unknown
}

/** 任务/节点运行状态，含已入队但尚未被处理机领取的等待态。 */
export type RunState = 'L' | 'C' | 'E' | 'W' | 'W1' | 'D' | 'AC'

/** 写类操作通用回执（mock：仅 ack，不落库） */
export interface Ack {
  ok: boolean
  demo?: boolean // 演示环境占位：未真正执行写操作
  message?: string
}
