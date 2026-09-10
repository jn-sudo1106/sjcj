// 监控域（P1-3 拆 8 域 · monitor 域）
// 包含 HealthCard（健康卡片）/ MqQueue（队列积压）/ SyncRow（同步差异）/
//       AlarmRow（告警）/ NodeRunStat（节点运行统计）/ QueueStat（队列运行统计）
// 跨域被引用：overview.OverviewKpi.alarms 引用 alarm 数（不是类型）
// 跨域引用：RunState（NodeRunStat.state / QueueStat.state）
// import type 严格模式

import type { PageQuery, RunState } from './common'

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

// ---------- 源监控（数据源告警，0910 从旧平台 MonitorList 迁入） ----------

/**
 * 一条源检查（监控）。字段名对齐旧平台 /v1/source/check/paged 的原始返回。
 *
 * ⚠️ `isDelete` 的语义是反的：**0 才表示「在用」**。旧平台在 loadData 里转了一道
 * `obj.enabled = (obj.isDelete === 0)`，迁过来时别把布尔搞反。
 */
export interface SourceCheck {
  id: string
  isDelete: number
  state: string // E=告警 / C=正常
  lastMsg: string // 执行结果，形如 `2026-09-09 11:00:46---[X]:xxx-异常, 数量:0`
  name: string
  tableName: string
  schedule: string // cron
  nextRun: string
  lastRun: string
  sourceId: string
  checkConf: string // 校验详情，JSON 串
}

/** 一条校验历史日志，来自 /v1/source/check/paged-logs */
export interface SourceCheckLog {
  logId: string
  createDt: string
  logMsg: string
  name: string
  state: string
  logType: string
  tableName: string
  sourceId: string
}

/** 监控列表查询入参 */
export interface SourceCheckQuery extends PageQuery {
  sourceId?: string
  enable?: string // '0' 在用 / '1' 停用 / '' 全部
  state?: string // 'E' 告警 / 'C' 正常 / '' 全部
  name?: string
}

/** 历史日志查询入参 */
export interface SourceCheckLogQuery extends PageQuery {
  sourceId?: string
  jobId?: string
  state?: string
  name?: string
}
