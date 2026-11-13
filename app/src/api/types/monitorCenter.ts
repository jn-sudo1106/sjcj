// 监控中心（1110 方案）的**前端领域视图类型**。
//
// 与 `api/types/monitor.ts` 的分工：
//   · 那里是旧接口的原始返回（SourceCheck / SourceCheckLog，字段名对齐旧平台 /v1/source/check/*）；
//   · 这里是「按监控记录身份（monitorId）」规范化之后的视图模型，供页面与纯函数消费。
//
// 为什么要多一层：旧记录同时存在 `state`（E/C 校验结果）、`isDelete`（0 在用/1 停用，语义是反的）、
// `checkConf`（JSON 串）三个不同口径的字段，直接进模板必然出现「一行里三种状态互相矛盾」。
// 规范化后每个维度只留一个值，页面不再各自解释 `E` 或 `isDelete`（1109 §7.3 / 1110 §7.3）。

import type { SourceCheck, SourceCheckLog } from './monitor'

/** 检查方式：AI 脚本 / 旧规则。编辑已有记录时不得自动转换（1110 §3.3）。 */
export type MonitorKind = 'ai' | 'rule'

/** 发布就绪：草稿（无有效版本，不执行）/ 待发布 / 已生效 / 发布失败。 */
export type MonitorPublishStatus = 'draft' | 'pending' | 'ready' | 'failed'

/** 单次执行状态（与数据结论分开，1110 §7.3）。`none` = 还没有任何正式运行。 */
export type MonitorExecStatus = 'none' | 'queued' | 'running' | 'succeeded' | 'failed' | 'timeout' | 'cancelled' | 'unknown'

/** 数据结论。`no_data` 是「本次无待检记录」，不等于通过，也不等于异常（1110 §7.3 / R04）。 */
export type MonitorDataStatus = 'normal' | 'abnormal' | 'no_data' | 'unknown'

/** 通知投递状态。`accepted` 只代表服务端受理，不代表送达（1110 §9.3）。 */
export type MonitorNotifyStatus = 'none' | 'pending' | 'accepted' | 'delivered' | 'failed' | 'suppressed' | 'unknown'

/** 计划覆盖：无计划 / 未到期 / 排队 / 已完成 / 漏跑。漏跑只来自时隙判定，不由前端推算。 */
export type MonitorCoverStatus = 'not_scheduled' | 'not_due' | 'pending' | 'completed' | 'missed' | 'unavailable'

/** 所选日期的覆盖计数。`unavailable` 表示后端未提供聚合能力（不伪造 0）。 */
export interface MonitorCoverage {
  status: MonitorCoverStatus
  due: number
  finished: number
  succeeded: number
  failed: number
  missed: number
}

/**
 * 检查对象归属（1113 §3）：
 * - `source_result`：源结果检查（监控中心入口，检查最终落库表的结果）
 * - `node_input`：节点环节检查（画布数据监控节点，检查该节点的输入是否准确）
 *
 * 旧记录没有这个键，按「未分类（legacy）」处理——不推断、不默认，避免把两类检查混成一种。
 */
export type MonitorScopeType = 'source_result' | 'node_input'

/**
 * 监控定义里 `checkConf` 的结构化视图。
 * 旧平台把整套配置塞在一个 JSON 串里，键名与语义见 1109 §2.1；这里只挑页面会读的键，
 * 其余键通过索引签名原样保留——保存时必须整包回写，不能因为不认识就丢掉（1110 §8.1）。
 */
export interface MonitorCheckConf {
  /** 无 checkRule 时的数量范围；`minSize: 0` 必须保留（1109 §5.3②） */
  minSize?: number | string
  maxSize?: number | string
  /** 时间口径 C=create_dt / U=update_dt / M/T=modify_dt（T 未填起点用源上次任务时间） */
  timeType?: string
  startDt?: string
  endDt?: string
  /** 完整 SELECT 时替换默认 SQL；片段则附加（1109 §5.3③） */
  cond?: string
  /** 动态校验表达式；有值时不再与数量范围 AND */
  checkRule?: string
  checkMsg?: string
  /** 通知策略：error=仅异常 / ok=仅恢复或正常 / all=全部 / none=静默 */
  notifyOn?: 'error' | 'ok' | 'all' | 'none'
  channels?: string[]
  receivers?: string[]
  cron?: string
  /** 任务后延时：旧前端写 `AFTER:30`，旧后端识别 `AFTER-30`（1109 §5.3⑦） */
  after?: string
  kind?: MonitorKind
  /** 检查对象归属；旧记录缺省（未分类） */
  scopeType?: MonitorScopeType
  /** 24 个通用方法里选中的那些（AI 检查） */
  methods?: string[]
  desc?: string
  systemPrompt?: string
  script?: string
  /** 字段值为空怎么判 */
  nullPolicy?: 'abnormal' | 'allow' | 'skip'
  /** 本次无待检记录怎么判（与「字段为空」是两件事，R04） */
  noDataPolicy?: 'no_data' | 'alarm' | 'unknown'
  /** 已生效版本号（如 v3）；旧记录没有 */
  version?: string
  /** 生成脚本里实际使用的入库时间列（脚本自动探测不到时需要显式传入） */
  timeColumn?: string
  /**
   * 本次检查覆盖的时间窗口。不填按「当日 00:00 → 现在」。
   * 执行器把它换算成 `DQ_START_DATE/DQ_END_DATE` 传进脚本——窗口必须有边界，
   * 否则停更的表会被算出「连续几百天异常」。
   */
  window?: { type?: 'today' | 'hours' | 'period'; hours?: number; periodHours?: number }
  /**
   * 脚本检查自己的计划状态。
   *
   * Java 调度器会把 `NEXT_RUN` 为空或到期的行全部捡走（`CkSourceMapper.lockForDeal`），
   * 所以 AI 记录的 `ck_source.NEXT_RUN` 停在远期、由执行器把真正的「上次/下次」写在这里。
   */
  schedule?: { last?: string; next?: string }
  /** 未识别键必须保留 */
  [key: string]: unknown
}

/** 一条运行记录里冻结的配置快照。历史详情只读它，不回查当前定义（T03）。 */
export interface MonitorRunConfig {
  version?: string
  digest?: string
  name?: string
  desc?: string
  methods?: string[]
  plan?: { cron?: string; text?: string }
  notifyOn?: string
  channels?: string[]
  nullPolicy?: string
  noDataPolicy?: string
  script?: string
}

/** 一次通知投递。重试只增加 attempt，不新建 run（1110 §9.3 / C08）。 */
export interface MonitorDelivery {
  /** C08 投递主键；旧日志没有，重试按钮据此不可点 */
  deliveryId?: string
  /** 通知事件 ID（一次运行可有多渠道投递） */
  eventId?: string
  channel: string
  target?: string
  /** 接收对象快照：收件人可能改过，展示历史投递不能回查当前配置 */
  recipientSnapshot?: string
  attempt: number
  status: MonitorNotifyStatus
  at?: string
  message?: string
}

/**
 * 规范化的监控定义视图（一行 = 一条监控记录 = 一个 monitorId）。
 * 页面只读这里，不再直接读 `state` / `isDelete`。
 */
export interface MonitorRecordView {
  /** 监控记录主键（ck_source.id），不是 sourceId */
  id: string
  sourceId: string
  sourceName?: string
  name: string
  tableName?: string
  kind: MonitorKind
  enabled: boolean
  schedule: string
  nextRun?: string
  lastRun?: string
  publishStatus: MonitorPublishStatus
  /** 发布状态是否由旧字段推导（旧后端没有 publishStatus，页面标「推导」） */
  publishStatusDerived?: boolean
  /** 配置修订号（C01 保存 CAS 用）；旧记录没有 */
  revision?: number
  /** 当前生效修订号 / 版本展示串（v3）；两者不是一回事 */
  effectiveRevision?: number
  effectiveVersion?: string
  pendingVersion?: string
  /** 保存/发布作业 ID（C01/C04） */
  publishJobId?: string
  /** 保存时服务端给的非阻断告警（例如未识别字段被保留） */
  warnings?: string[]
  exec: MonitorExecStatus
  data: MonitorDataStatus
  notify: MonitorNotifyStatus
  lastCheckAt?: string
  /** 结构化条数；`''` 表示未知，页面显示「—」，不是 0 */
  count: string
  /** 执行结果文本（给人看，不作业务判定） */
  message?: string
  conf: MonitorCheckConf
  /** 原始行：仅在需要回写旧接口时使用 */
  raw: SourceCheck
}

/** 规范化的单次运行视图。 */
/** 单次运行里的一个检查子项（C06 结构化结果；旧日志没有，页面标「未记录逐项结果」）。 */
export interface MonitorRunCheck {
  checkKey: string
  methodCode?: string
  methodLabel?: string
  exec: MonitorExecStatus
  data: MonitorDataStatus
  tableName?: string
  field?: string
  /** 本次检查的记录数（未知时缺省，页面显示「—」，不要补 0） */
  checkedCount?: number
  abnormalCount?: number
  samples?: { recordId?: string; actual?: string; reasonCode?: string }[]
}

export interface MonitorRunView {
  /** runId；旧数据没有时用日志 logId 占位并标 legacy */
  id: string
  monitorId?: string
  sourceId: string
  monitorName?: string
  at: string
  trigger: 'schedule' | 'manual' | 'legacy' | 'unknown'
  exec: MonitorExecStatus
  data: MonitorDataStatus
  notify: MonitorNotifyStatus
  count: string
  abnormalCount?: number
  window?: { start?: string; end?: string; timezone?: string }
  version?: string
  digest?: string
  message?: string
  /** 冻结快照；缺失时页面显示「未记录」，禁止用当前定义补 */
  config?: MonitorRunConfig
  deliveries: MonitorDelivery[]
  /** C06 的运行主键；旧日志只有 logId，此时 `id` 为日志标识、本字段缺省 */
  runId?: string
  /** 本次检查记录数（结构化）；未知缺省，页面显示「—」 */
  checkedCount?: number
  /** 脚本检查耗时（毫秒，remarks.durationMs）；旧记录没有结构化结果时缺省 */
  durationMs?: number
  /** 执行器给出的原因（remarks.reason：数据异常说明 / 执行失败主因）；旧记录缺省 */
  reason?: string
  /** 旧日志从文本里抠出来的条数（仅展示，不参与判定，与 checkedCount 不要混用） */
  legacyCount?: string
  /** 逐方法逐表结果；旧日志没有，页面显示「未记录逐项结果」 */
  checks?: MonitorRunCheck[]
  /** C06 汇总文案 / 缺失字段清单 / 旧日志原因 */
  summary?: string
  missingFields?: string[]
  legacyReason?: string
  /** 日志正文（C06）；旧日志的 logMsg 仍走 raw.logMsg，两者不要混用 */
  logText?: string
  /** 日志在服务端的引用（页面拿不到正文时显示入口而非伪造内容） */
  logRef?: string
  /** 来自旧 paged-logs，没有结构化结果 */
  legacy: boolean
  raw?: SourceCheckLog
}

/** 源列表一行：源是业务主维度，检查项挂在下面（1110 §3.2 / §9.1）。 */
export interface MonitorSourceRow {
  sourceId: string
  sourceName?: string
  /** 主表物理名；列表副标题用它代替源 ID，便于业务辨认 */
  tableName?: string
  siteId?: string
  siteName?: string
  monitorTotal: number
  monitorEnabled: number
  /** 覆盖统计；后端无聚合能力时为 null，页面显示「—（需服务端聚合）」 */
  coverage: MonitorCoverage | null
  /** 服务端明确表示「当前没有聚合能力」时为 true，页面显示「—（需服务端聚合）」 */
  coverageUnavailable?: boolean
  /** 覆盖说明（例如「历史计划版本不可还原」），直接展示，不自行解释 */
  coverageDetail?: string
  data: MonitorDataStatus
  exec: MonitorExecStatus
  notifyFailures: number
  lastCheckAt?: string
  /** 最差事实的展示文案与色调，由 summary 统一算，页面不再各自判断 */
  label: string
  tone: 'good' | 'bad' | 'warn' | 'unknown' | 'muted'
  monitors: MonitorRecordView[]
  /** 未配置检查的源（来自源目录） */
  unconfigured: boolean
}