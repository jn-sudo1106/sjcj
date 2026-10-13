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
  /** 定时任务 ID。旧平台开「历史日志」传的是 `record.jobId`（不是记录自身的 id），
   *  后端未返回时为空 —— 此时日志按 sourceId 过滤，与旧平台行为一致。 */
  jobId?: string
  /** 旧平台 /v1/source/check/paged 返回里可能带的额外时间字段（编辑提交前要剔除） */
  createDt?: string
  updateDt?: string
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

// ---------- 队列告警（1013 从旧平台 page/config/QueueCheck.vue 迁入） ----------

/**
 * 一条队列校验配置，字段名对齐旧平台 `/v1/mq/check/paged` 原始返回
 * （旧页面的列定义见 config/column.config.js · allColumns.MQ_CHECK）。
 *
 * ⚠️ `isDelete` 语义：**0 = 在用 / 1 = 停用 / 小于 0 = 历史删除的**。
 * 注意它和行上的 `state`（E=出错 / C=正常）是两件事：`state` 是校验结果，
 * `isDelete` 才是在用与否，页面筛选框「状态」筛的是后者。
 */
export interface MqCheck {
  queueId: string
  queueName: string
  /** 校验结果：E=出错 / C=正常（旧 stateFilter 还认 L=处理中 / AC=已审核 / W=待处理） */
  state: string
  /** 执行结果文本 */
  lastMsg: string
  queueDesc: string
  /** 队列积压超过 */
  maxSize: number | string
  /** 消费者数低于 */
  minConsumer: number | string
  /** 消费速率低于 */
  minRate: number | string
  /** 消费速率高于 */
  maxRate: number | string
  /** 自定义检测出错脚本 */
  check: string
  /** 告警提示 */
  checkMsg: string
  /** 0=在用 / 1=停用 / <0=历史删除 */
  isDelete: number
  /** 旧平台返回里可能带的额外时间字段（提交前要剔除，见 addCallback/updateCallback） */
  createDt?: string
  updateDt?: string
  lastRun?: string
  nextRun?: string
}

/** 队列告警查询入参。旧页面发的是 queue / queueId / name / enable + page / limit，
 *  表头排序时再追加 sortField / sortOrder（旧 s-table 口径，order 是 antd 原生的 'ascend' / 'descend'）。 */
export interface MqCheckQuery extends PageQuery {
  /** 队列名（旧 queryParam.queue） */
  queue?: string
  queueId?: string
  /** 描述（旧 queryParam.name） */
  name?: string
  /** '' 全部 / '0' 在用 / '1' 停用 / '-1' 历史删除的 */
  enable?: string
  /** 服务端排序字段：queueName / maxSize / minConsumer / maxRate（旧带 sorter:true 的四列） */
  sortField?: string
  /** 服务端排序方向：'ascend' 升序 / 'descend' 降序（不排序时整个键不出现） */
  sortOrder?: string
}

/**
 * 通用定时任务 / 自定义告警（旧 data-view `allColumns.COMM_JOB` → 旧 `page/config/CommJobList.vue`，
 * 路由 /config/comm-job，新平台 Monitor 页的「自定义告警」tab）。
 *
 * ⚠️ `isDelete` 语义与 MqCheck 同向：**0 = 在用 / 1 = 停用 / 小于 0 = 历史删除的**；
 * 页面筛选框「状态」筛的就是它。表格里「下次运行 / 上次运行」走旧 `timeago` 过滤器（相对时间）。
 */
export interface CommJob {
  jobId: string
  /** 任务类型：'sql' = 定时Job / 'sqlCheck' = SQL-告警（旧 typeFilter） */
  jobType: string
  /** 定时名 */
  jobName: string
  /** 执行信息（最近一次运行回执） */
  lastMsg: string
  /** SQL 定义 */
  sqlDef: string
  /** 告警条件 */
  ruleDef: string
  /** 运行参数 */
  jobParam: string
  /** 定时策略（cron 表达式） */
  schedule: string
  /** 下次运行（旧 lastDateSlot → timeago） */
  nextRun?: string
  /** 总运行次 */
  runCnt?: number | string
  /** 成功次 */
  successCnt?: number | string
  /** 上次运行（旧 lastDateSlot → timeago） */
  lastRun?: string
  /** 0 = 在用 / 1 = 停用 / < 0 = 历史删除 */
  isDelete: number
  /** 旧平台返回里可能带的时间字段（提交前要剔除，见 addCallback / updateCallback） */
  createDt?: string
  updateDt?: string
}

/** 通用任务查询入参（旧 queryParam：queue / queueId / name / enable + page / limit）。
 *  ⚠️ 与 QueueCheck 不同的是：本页 `enable` 初值是 '0'（只看在用），不是空串。 */
export interface CommJobQuery extends PageQuery {
  /** 队列名（旧 queryParam.queue；后端落在 jobName 上） */
  queue?: string
  queueId?: string
  /** 描述（旧 queryParam.name；注释见 api/mock/commJob.ts 的字段映射说明） */
  name?: string
  /** '' 全部 / '0' 在用 / '1' 停用 / '-1' 历史删除的 */
  enable?: string
}
