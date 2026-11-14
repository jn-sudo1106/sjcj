// 运行记录抽屉的公共口径：查询范围、三维筛选、状态文案/色调、时间与条数格式。
//
// 这里只放纯函数，不请求、不碰 DOM：列表、详情、单测共用同一套口径，避免两处各写一套
// 状态翻译（1110 §9.2 / 1111 §7 fe-runs）。
//
// 数据来源只有 listRuns（共享层已处理旧接口 jobId 实际存 ckSource.id 的兼容），
// 页面不直接读旧的 paged-logs，也不拿当前监控定义回填历史运行。

import type {
  MonitorDataStatus,
  MonitorExecStatus,
  MonitorNotifyStatus,
  MonitorRunView,
} from '@/api/types/monitorCenter'
import { DATA_TEXT, EXEC_TEXT, NOTIFY_TEXT } from '@/utils/monitor/record'

export interface RunScope {
  sourceId?: string
  monitorId?: string
  monitorName?: string
}

export interface RunListQuery {
  monitorId?: string
  sourceId?: string
}

/**
 * listRuns 的入参。
 *
 * - monitorId 优先：一次运行归属哪条检查项是确定的，范围最窄；
 * - 同时带上 sourceId（若调用方知道），兼容旧 paged-logs 需要 sourceId 做权限/分区的实现；
 * - 两者都没有时返回空对象，由调用方显式报「未指定范围」，不要静默查全量。
 */
export function runListQuery(scope: RunScope): RunListQuery {
  const monitorId = (scope.monitorId ?? '').trim()
  const sourceId = (scope.sourceId ?? '').trim()
  if (monitorId) return sourceId ? { monitorId, sourceId } : { monitorId }
  if (sourceId) return { sourceId }
  return {}
}

export function hasRunScope(scope: RunScope): boolean {
  return Object.keys(runListQuery(scope)).length > 0
}

/** 抽屉顶部的范围说明：让用户一眼看出筛的是「一条检查项」还是「整个源」。 */
export function scopeLabel(scope: RunScope): string {
  const monitorId = (scope.monitorId ?? '').trim()
  if (monitorId) {
    const name = (scope.monitorName ?? '').trim()
    return `当前检查项「${name || monitorId}」`
  }
  if ((scope.sourceId ?? '').trim()) return '当前源 · 含该源下全部检查项'
  return '未指定范围'
}

export const SCOPE_NOTE = '一行对应一次正式运行'

/** 色调对齐设计令牌 `.rc-status` 的可用修饰类。 */
export type RunTone = 'ok' | 'err' | 'warn' | 'run' | 'muted'

export function execTextOf(exec: MonitorExecStatus): string {
  return EXEC_TEXT[exec] ?? EXEC_TEXT.unknown
}

export function dataTextOf(data: MonitorDataStatus): string {
  return DATA_TEXT[data] ?? DATA_TEXT.unknown
}

export function notifyTextOf(status: MonitorNotifyStatus): string {
  return NOTIFY_TEXT[status] ?? NOTIFY_TEXT.unknown
}

/**
 * 列表列宽有限，通知状态用短文案；但「受理 ≠ 送达」必须保留区别，
 * 没有回执时只能写「未取得回执」，不能写「已送达」。
 */
const NOTIFY_SHORT_TEXT: Record<MonitorNotifyStatus, string> = {
  none: '未配置',
  pending: '待投递',
  accepted: '已受理·未送达',
  delivered: '已送达',
  failed: '投递失败',
  suppressed: '已静默',
  unknown: '未取得回执',
}

export function notifyShortText(status: MonitorNotifyStatus): string {
  return NOTIFY_SHORT_TEXT[status] ?? NOTIFY_SHORT_TEXT.unknown
}

// 执行：成功才绿；失败/超时红；进行中蓝；取消/未执行/未知灰。
export function execTone(exec: MonitorExecStatus): RunTone {
  if (exec === 'succeeded') return 'ok'
  if (exec === 'failed' || exec === 'timeout') return 'err'
  if (exec === 'running' || exec === 'queued') return 'run'
  return 'muted'
}

// 数据：只有 normal 才绿；no_data 不是通过，用黄色；unknown 不冒充正常。
export function dataTone(data: MonitorDataStatus): RunTone {
  if (data === 'normal') return 'ok'
  if (data === 'abnormal') return 'err'
  if (data === 'no_data') return 'warn'
  return 'muted'
}

// 通知：只有明确 delivered 才绿；accepted/pending 黄（受理≠送达）；failed 红；其余灰。
export function notifyTone(status: MonitorNotifyStatus): RunTone {
  if (status === 'delivered') return 'ok'
  if (status === 'accepted' || status === 'pending') return 'warn'
  if (status === 'failed') return 'err'
  return 'muted'
}

export interface RunFilters {
  exec: MonitorExecStatus | ''
  data: MonitorDataStatus | ''
  notify: MonitorNotifyStatus | ''
}

export function emptyRunFilters(): RunFilters {
  return { exec: '', data: '', notify: '' }
}

export interface RunFilterOption<T extends string> {
  value: T
  label: string
}

export const RUN_EXEC_OPTIONS: RunFilterOption<MonitorExecStatus>[] = [
  { value: 'succeeded', label: EXEC_TEXT.succeeded },
  { value: 'failed', label: EXEC_TEXT.failed },
  { value: 'timeout', label: EXEC_TEXT.timeout },
  { value: 'cancelled', label: EXEC_TEXT.cancelled },
  { value: 'running', label: EXEC_TEXT.running },
  { value: 'queued', label: EXEC_TEXT.queued },
  { value: 'none', label: EXEC_TEXT.none },
  { value: 'unknown', label: EXEC_TEXT.unknown },
]

export const RUN_DATA_OPTIONS: RunFilterOption<MonitorDataStatus>[] = [
  { value: 'normal', label: DATA_TEXT.normal },
  { value: 'abnormal', label: DATA_TEXT.abnormal },
  { value: 'no_data', label: DATA_TEXT.no_data },
  { value: 'unknown', label: DATA_TEXT.unknown },
]

export const RUN_NOTIFY_OPTIONS: RunFilterOption<MonitorNotifyStatus>[] = [
  { value: 'delivered', label: NOTIFY_TEXT.delivered },
  { value: 'accepted', label: NOTIFY_TEXT.accepted },
  { value: 'pending', label: NOTIFY_TEXT.pending },
  { value: 'failed', label: NOTIFY_TEXT.failed },
  { value: 'suppressed', label: NOTIFY_TEXT.suppressed },
  { value: 'none', label: NOTIFY_TEXT.none },
  { value: 'unknown', label: NOTIFY_SHORT_TEXT.unknown },
]

/** 三维筛选只作用于已加载的运行；服务端接口没有这三个筛选参数（state/name 才是服务端的）。 */
export function filterRuns(runs: MonitorRunView[], filters: RunFilters): MonitorRunView[] {
  return runs.filter((run) => {
    if (filters.exec && run.exec !== filters.exec) return false
    if (filters.data && run.data !== filters.data) return false
    if (filters.notify && run.notify !== filters.notify) return false
    return true
  })
}

export function anyFilterActive(filters: RunFilters): boolean {
  return Boolean(filters.exec || filters.data || filters.notify)
}

/**
 * 条数只认运行记录里的结构化值（共享层用 checkCountOf 解析，含旧日志文本兜底）；
 * 未知显示「—」，绝不补 0。
 *
 * 新 /runs 的旧日志行按契约「count 只放 checkedCount、未知保持空」，从日志文本抠出的数
 * 单独放在 `legacyCount`（仅展示、不参与判定），这里作为展示兜底，避免旧日志条数列退化成「—」。
 */
export function runCountText(run: MonitorRunView): string {
  const text = String(run.count ?? '').trim()
  if (text) return text
  const legacy = String(run.legacyCount ?? '').trim()
  return legacy || '—'
}

/**
 * 列表时间只做格式整理（ISO 的 T/毫秒/时区后缀），不做时区换算：
 * 后端给的时钟是什么就显示什么，避免前端按浏览器时区改写出一个「看起来对」的时间。
 */
export function runTimeText(at: string | undefined): string {
  const text = String(at ?? '').trim()
  if (!text) return '—'
  return text.replace('T', ' ').replace(/(\.\d+)?(Z|[+-]\d{2}:\d{2})$/, '').trim()
}