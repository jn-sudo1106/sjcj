// 旧接口原始行 → 领域视图（1110 §7.3 六维状态）。
//
// 这一层存在的原因：旧记录同时有三套口径——
//   · `isDelete`：0 = 在用、1 = 停用（语义是反的，见 api/types/monitor.ts 注释）；
//   · `state`：E = 校验发现异常、C = 正常；
//   · `lastMsg`：给人看的执行结果文本。
// 页面如果各读各的，就会出现「启停显示在用、结论显示正常、日志显示执行失败」三处打架。
// 这里一次性把它们收敛成 enabled / exec / data / notify 四个维度，并且**执行失败时不允许
// 再给出数据结论**（数量未知不是 0，也不是正常——1109 §6.4 / R01）。

import { checkCountOf } from './checkCount'
import type { SourceCheck, SourceCheckLog } from '../../api/types/monitor'
import type {
  MonitorCheckConf,
  MonitorDataStatus,
  MonitorExecStatus,
  MonitorKind,
  MonitorNotifyStatus,
  MonitorRecordView,
  MonitorRunView,
  MonitorPublishStatus,
  MonitorScopeType,
} from '../../api/types/monitorCenter'

/** 执行结果文本里能确认「没跑成」的措辞。取不到结构化执行状态时的过渡判据。 */
const FAIL_PATTERNS = [/执行失败/, /异常退出/, /连接(?:失败|超时|被拒绝)/, /timeout/i, /timed out/i]
const TIMEOUT_PATTERNS = [/超时/, /timeout/i, /timed out/i]
const CANCEL_PATTERNS = [/已取消/, /cancelled/i, /canceled/i]

/** 解析 checkConf JSON 串。非法 JSON 返回空对象，**不抛异常、不当成「清空配置」**（1110 §8.1）。 */
export function parseCheckConf(raw: unknown): MonitorCheckConf {
  if (!raw) return {}
  if (typeof raw === 'object') return { ...(raw as MonitorCheckConf) }
  if (typeof raw !== 'string') return {}
  const text = raw.trim()
  if (!text) return {}
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return { ...(parsed as MonitorCheckConf) }
  } catch {
    return {}
  }
}

/** 序列化回 checkConf。未识别键原样保留（parse 时没丢，stringify 时自然带回去）。 */
export function serializeCheckConf(conf: MonitorCheckConf): string {
  return JSON.stringify(conf ?? {})
}

export function monitorKindOf(conf: MonitorCheckConf): MonitorKind {
  if (conf.kind === 'ai' || conf.kind === 'rule') return conf.kind
  // 旧记录没有 kind：有 script / methods 视为 AI，否则按旧规则
  if (conf.script || conf.scriptPath || (conf.methods && conf.methods.length) || scriptPathOf(conf)) return 'ai'
  return 'rule'
}

/**
 * 检查对象归属（1113 §3）。
 * 只读取 conf 里显式写下的值：旧记录没有该键 = 未分类（返回 undefined），
 * 这里**不推断、不给默认值**，否则会把两类检查混成一种。
 */
export function monitorScopeOf(conf: MonitorCheckConf): MonitorScopeType | undefined {
  return conf.scopeType
}

function scriptPathOf(conf: MonitorCheckConf): string {
  const orchestration = conf.orchestration
  if (!orchestration || typeof orchestration !== 'object') return ''
  const path = (orchestration as Record<string, unknown>).scriptPath
  return typeof path === 'string' ? path.trim() : ''
}

/** 发布就绪：有可执行脚本（AI）或规则校验即视为已生效；AI 只有描述没有脚本 = 草稿。 */
export function publishStatusOf(kind: MonitorKind, conf: MonitorCheckConf): MonitorPublishStatus {
  if (kind === 'rule') return 'ready'
  return (typeof conf.script === 'string' && conf.script.trim()) ||
    (typeof conf.scriptPath === 'string' && conf.scriptPath.trim()) || scriptPathOf(conf) ? 'ready' : 'draft'
}

function textOf(row: SourceCheck): string {
  return typeof row.lastMsg === 'string' ? row.lastMsg : ''
}

/**
 * 执行状态。
 * 注意顺序：先判文本里的失败/超时，再判有没有跑过；否则「跑过但失败」会被当成成功。
 */
export function execStatusOf(row: Pick<SourceCheck, 'lastMsg' | 'lastRun'>): MonitorExecStatus {
  const text = typeof row.lastMsg === 'string' ? row.lastMsg : ''
  if (CANCEL_PATTERNS.some((re) => re.test(text))) return 'cancelled'
  if (TIMEOUT_PATTERNS.some((re) => re.test(text))) return 'timeout'
  if (FAIL_PATTERNS.some((re) => re.test(text))) return 'failed'
  if (!row.lastRun) return 'none'
  return 'succeeded'
}

/** 数据结论：执行没成功时不解释数据（unknown），避免把 E 直接渲染成「数据异常」。 */
export function dataStatusOf(exec: MonitorExecStatus, state: string): MonitorDataStatus {
  if (exec !== 'succeeded') return 'unknown'
  if (state === 'E') return 'abnormal'
  if (state === 'C') return 'normal'
  return 'unknown'
}

/** 旧行 → 规范化监控记录。字段全部只读原始值，不做「猜」。 */
export function toMonitorRecord(row: SourceCheck, sourceName?: string): MonitorRecordView {
  const conf = parseCheckConf(row.checkConf)
  const kind = monitorKindOf(conf)
  const enabled = Number(row.isDelete) === 0
  const exec = execStatusOf(row)
  const publishStatus = publishStatusOf(kind, conf)
  return {
    id: String(row.id ?? ''),
    sourceId: String(row.sourceId ?? ''),
    sourceName,
    name: row.name ?? '',
    tableName: row.tableName,
    kind,
    enabled,
    schedule: row.schedule ?? conf.cron ?? '',
    nextRun: row.nextRun,
    lastRun: row.lastRun,
    publishStatus,
    effectiveVersion: typeof conf.version === 'string' && conf.version ? conf.version : undefined,
    exec,
    data: enabled ? dataStatusOf(exec, row.state) : 'unknown',
    // 旧接口没有投递回执：标记 unknown，页面显示「未取得回执」而不是「已送达」
    notify: 'unknown' as MonitorNotifyStatus,
    lastCheckAt: row.lastRun,
    count: checkCountOf(row),
    message: textOf(row),
    conf,
    raw: row,
  }
}

/** 旧日志行 → 运行视图。没有结构化结果，`legacy` 置 true，页面必须标注「旧日志」。 */
/**
 * 读执行器写进 `ck_job_log.REMARKS` 的结构化结论。
 *
 * 旧平台这一列从来没用过（都是 null），只有「脚本执行器」会写：
 * `{runId, status, checkedCount, abnormalCount, durationMs, window:{start,end}, reason, scriptPath}`。
 * 解析失败一律当作「没有结构化结论」，绝不把未知当 0。
 */
export interface MonitorRunStructured {
  runId?: string
  checkedCount?: number
  abnormalCount?: number
  durationMs?: number
  window?: { start?: string; end?: string }
  reason?: string
  scriptPath?: string
  status?: string
}

export function parseRunRemarks(raw: unknown): MonitorRunStructured {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text || text[0] !== '{') return {}
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const source = parsed as Record<string, unknown>
    const num = (value: unknown): number | undefined => {
      if (typeof value === 'number' && Number.isFinite(value)) return value
      if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
      return undefined
    }
    const window = source.window && typeof source.window === 'object' ? (source.window as Record<string, unknown>) : {}
    return {
      runId: typeof source.runId === 'string' ? source.runId : undefined,
      checkedCount: num(source.checkedCount),
      abnormalCount: num(source.abnormalCount),
      durationMs: num(source.durationMs),
      window: {
        start: typeof window.start === 'string' ? window.start : undefined,
        end: typeof window.end === 'string' ? window.end : undefined,
      },
      reason: typeof source.reason === 'string' ? source.reason : undefined,
      scriptPath: typeof source.scriptPath === 'string' ? source.scriptPath : undefined,
      status: typeof source.status === 'string' ? source.status : undefined,
    }
  } catch {
    return {}
  }
}

export function toMonitorRun(log: SourceCheckLog): MonitorRunView {
  const text = typeof log.logMsg === 'string' ? log.logMsg : ''
  const exec: MonitorExecStatus =
    CANCEL_PATTERNS.some((re) => re.test(text))
      ? 'cancelled'
      : TIMEOUT_PATTERNS.some((re) => re.test(text))
        ? 'timeout'
        : FAIL_PATTERNS.some((re) => re.test(text))
          ? 'failed'
          : 'succeeded'
  const structured = parseRunRemarks(log.remarks)
  const hasStructured = structured.checkedCount !== undefined || structured.abnormalCount !== undefined
  return {
    id: String(log.logId ?? ''),
    sourceId: String(log.sourceId ?? ''),
    monitorName: log.name,
    // 旧平台精确到秒；没有时区信息，按本地展示，不臆造时区
    at: log.createDt ?? '',
    trigger: hasStructured ? 'manual' : 'legacy',
    exec,
    data: dataStatusOf(exec, log.state),
    notify: 'unknown',
    // 有结构化结论就不再拿中文日志兜底抠数字（两条口径不能混用）
    count: hasStructured ? String(structured.checkedCount ?? '—') : checkCountOf(log),
    checkedCount: structured.checkedCount,
    abnormalCount: structured.abnormalCount,
    durationMs: structured.durationMs,
    runId: structured.runId,
    reason: structured.reason,
    summary: structured.reason,
    window: structured.window && (structured.window.start || structured.window.end) ? { ...structured.window } : undefined,
    message: text,
    deliveries: [],
    legacy: !hasStructured,
    raw: log,
  }
}

/** 展示文案：执行/数据/通知三个维度的统一措辞，页面不要各写一套。 */
export const EXEC_TEXT: Record<MonitorExecStatus, string> = {
  none: '尚未执行',
  queued: '已受理 · 排队中',
  running: '执行中',
  succeeded: '执行成功',
  failed: '执行失败',
  timeout: '执行超时',
  cancelled: '已取消',
  unknown: '执行状态未知',
}

export const DATA_TEXT: Record<MonitorDataStatus, string> = {
  normal: '数据正常',
  abnormal: '数据异常',
  no_data: '无待检记录',
  unknown: '待判断',
}

export const NOTIFY_TEXT: Record<MonitorNotifyStatus, string> = {
  none: '未配置通知',
  pending: '待投递',
  accepted: '已受理 · 未确认送达',
  delivered: '已送达',
  failed: '投递失败',
  suppressed: '已静默',
  unknown: '未取得回执',
}