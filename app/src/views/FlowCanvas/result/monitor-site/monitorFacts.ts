// 源内 / 网站监控视图的纯展示口径（1110 §3.1、1110 原型说明 §四·一）。
//
// 页面只做展示，最差事实、覆盖等判断统一走 `utils/monitor/sourceSummary`；这里只把
// MonitorSourceRow 摊平成「源信息条 6 项」「网站 7 项摘要」「检查项摘要文案」，
// 不自己发明状态、不在前端推算覆盖（无 C07 时一律 `—（需服务端聚合）`）。
import type { MonitorRecordView, MonitorSourceRow } from '@/api/types/monitorCenter'
import { DATA_TEXT } from '@/utils/monitor/record'
import { isKnownMethod, methodLabel } from '@/utils/monitor/methods'

/** 后端尚未提供聚合能力时的统一占位（1110 §7.3 / 降级红线）。 */
export const COVERAGE_PLACEHOLDER = '—（需服务端聚合）'

/** 网站视图 7 项摘要：顺序与全局源列表一致。 */
export const SITE_SUMMARY_ITEMS = [
  '有启用检查源',
  '当日应检查源',
  '至少完成一次',
  '计划覆盖完整',
  '数据异常源',
  '执行失败源',
  '漏跑源',
] as const

/**
 * 网站级 7 项全部依赖服务端按授权聚合（C07）。当前接口没有该能力，
 * 7 项统一显示占位而**不是 0**——0 会让人误以为「一个都没有」。
 */
export const SITE_SUMMARY_NOTE = '网站级 7 项需服务端按授权聚合（当前无 C07 接口），页面不按当前页数据推算；分项不互斥。'

/** 检查方式展示文案。 */
export function kindText(monitor: MonitorRecordView): string {
  return monitor.kind === 'ai' ? 'AI 检查' : '规则检查'
}

/** 最近数据结论：执行失败/未知时 sourceSummary 已给 unknown，这里只转文案。 */
export function dataText(monitor: MonitorRecordView): string {
  return DATA_TEXT[monitor.data]
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ''
}

/**
 * 检查摘要列：AI 检查优先列方法名，其次描述首行；规则检查用旧配置里的说明。
 * 旧记录里的中文方法名通过 methods 映射回来，映射不到原样展示（不丢、不替换）。
 */
export function checkSummary(monitor: MonitorRecordView): string {
  const conf = monitor.conf ?? {}
  const rawMethods = Array.isArray(conf.methods) ? conf.methods.map((m) => String(m)).filter(Boolean) : []
  if (rawMethods.length) {
    const labels = rawMethods.map((m) => {
      const label = methodLabel(m)
      return isKnownMethod(m) ? label : `${label}（旧方法）`
    })
    return labels.length > 3 ? `${labels.slice(0, 3).join('、')} 等 ${labels.length} 项` : labels.join('、')
  }
  const desc = typeof conf.desc === 'string' ? firstLine(conf.desc) : ''
  if (desc) return desc
  const message = typeof conf.checkMsg === 'string' ? firstLine(conf.checkMsg) : ''
  if (message) return message
  return monitor.kind === 'rule' ? '按旧规则校验' : '—'
}

/** 计划列：cron 与下次时间分开展示，cron 缺失显示「未设置」。 */
export function planText(monitor: MonitorRecordView): string {
  return monitor.schedule || '未设置'
}

/** 计划列悬浮提示：下次执行时间。 */
export function planTitle(monitor: MonitorRecordView): string {
  return `cron ${monitor.schedule || '—'}｜下次 ${monitor.nextRun || '—'}`
}

/** 最差事实的色调 → class 后缀（good/bad/warn/unknown/muted）。 */
export function toneClass(tone: MonitorSourceRow['tone']): string {
  return `tone-${tone}`
}

/** 运行记录里通知列：旧接口没有回执，统一「未取得回执」；条数未知「—」不是 0。 */
export function runCountText(count: string): string {
  return count || '—'
}
export type MonitorStatusTone = 'good' | 'bad' | 'warn' | 'unknown' | 'muted'

export interface MonitorStatus {
  tone: MonitorStatusTone
  label: string
  /** 异常/失败时的一句原因（取执行结果文本首行），正常时为空 */
  reason: string
  /** 排序权重：越小越靠前（异常 → 执行失败 → 待判断 → 未运行 → 正常） */
  rank: number
}

/**
 * 检查项「状态」列：把执行结果与最近数据结论合成一个状态，正常就一眼看到正常，
 * 不正常再点「记录」看运行明细（1123 沟通：运行记录只有不正常才会去看）。
 */
export function monitorStatus(monitor: MonitorRecordView): MonitorStatus {
  const reason = statusReason(monitor.message)
  if (monitor.exec === 'failed' || monitor.exec === 'timeout' || monitor.exec === 'cancelled') {
    const label = monitor.exec === 'timeout' ? '执行超时' : monitor.exec === 'cancelled' ? '已取消' : '执行失败'
    return { tone: 'warn', label, reason, rank: 1 }
  }
  if (monitor.exec === 'queued' || monitor.exec === 'running') {
    return { tone: 'unknown', label: '执行中', reason: '', rank: 2 }
  }
  if (monitor.data === 'abnormal') return { tone: 'bad', label: '异常', reason, rank: 0 }
  if (monitor.exec === 'none' || !monitor.lastCheckAt) return { tone: 'muted', label: '未运行', reason: '', rank: 3 }
  if (monitor.data === 'normal') return { tone: 'good', label: '正常', reason: '', rank: 4 }
  if (monitor.data === 'no_data') return { tone: 'muted', label: '无待检记录', reason: '', rank: 3 }
  return { tone: 'unknown', label: '待判断', reason: '', rank: 2 }
}

/**
 * 旧执行器的结果文本形如「2026-11-23 10:00:00---[X]:<检查项名>-异常, 数量:0」，
 * 时间和名称表里已有，原因只取「数量 N」；其他格式去掉时间前缀后取首行。
 */
function statusReason(message?: string): string {
  if (!message) return ''
  const count = message.match(/数量\s*[:：]\s*(-?\d+)/)
  if (count) return `数量 ${count[1]}`
  return firstLine(message.replace(/^\s*\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?\s*-*\s*/, ''))
}
