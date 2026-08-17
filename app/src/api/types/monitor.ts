// 监控域（P1-3 拆 8 域 · monitor 域）
// 包含 HealthCard（健康卡片）/ MqQueue（队列积压）/ SyncRow（同步差异）/
//       AlarmRow（告警）/ NodeRunStat（节点运行统计）/ QueueStat（队列运行统计）
// 跨域被引用：overview.OverviewKpi.alarms 引用 alarm 数（不是类型）
// 跨域引用：RunState（NodeRunStat.state / QueueStat.state）
// import type 严格模式

import type { RunState } from './common'

/* ---------------- M4 监控工具 ---------------- */

export interface HealthCard {
  key: string
  name: string // 执行器(青龙) / 规则引擎网关 / MQ / 函数工具
  status: 'ok' | 'warn' | 'down'
  detail: string
}

export interface MqQueue {
  name: string
  pending: number // 积压
  failed: number
  state: 'ok' | 'warn' | 'err'
}

export interface SyncRow {
  client: string
  status: string
  diff: number // 差异条数
  externalChanged: boolean
}

export interface AlarmRow {
  alarmId: string
  level: 'fail' | 'block' | 'recover'
  text: string
  at: string
}

/** 节点粒度运行统计（0706 Phase4·任务视图=运行视图，0707 Phase5 起该形态退役，仅内部聚合用） */
export interface NodeRunStat {
  nodeId: string
  queue?: string // 队列归属（后端口径；前端本地 taskCfg.queue 优先）
  totalTasks: number // 总任务数
  processedTasks: number // 已处理数
  state?: RunState // 运行状态；缺省视为空闲
}

/** 队列粒度运行统计（0707 优化·Phase5·任务视图网站化）：网站下全部源节点按队列去重聚合 */
export interface QueueStat {
  queue: string
  totalTasks: number
  processedTasks: number
  state?: RunState // 队列内任一 E → E；任一 L → L；否则有任务视为 C，无任务缺省
}
