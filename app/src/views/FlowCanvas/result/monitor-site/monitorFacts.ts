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

export interface SourceFactItem {
  key: 'source' | 'site' | 'table' | 'checks' | 'last' | 'coverage'
  label: string
  value: string
  title?: string
}

export interface SourceFactInput {
  sourceId: string
  sourceName?: string
  siteId?: string
  siteName?: string
  mainTable?: string
  summary: MonitorSourceRow
}

/** 源信息条 6 项（顺序固定：源 / 网站 / 主表 / 检查项 / 最近检查 / 所选日期覆盖）。 */
export function sourceFacts(input: SourceFactInput): SourceFactItem[] {
  const { summary } = input
  const name = input.sourceName || summary.sourceName || ''
  const siteName = input.siteName || summary.siteName || (input.siteId ? `网站 ${input.siteId}` : '—')
  return [
    {
      key: 'source',
      label: '源',
      value: name ? `${name}（${input.sourceId}）` : input.sourceId,
      title: `${name || input.sourceId} · ${input.sourceId}`,
    },
    { key: 'site', label: '网站', value: siteName },
    {
      key: 'table',
      label: '主表',
      value: input.mainTable ? `${input.mainTable} ／ 子表数 —` : '—',
      title: '子表数需服务端聚合（当前接口未提供），主表 ID 来自源详情',
    },
    {
      key: 'checks',
      label: '检查项',
      value: `${summary.monitorEnabled} 启用 ／ ${summary.monitorTotal} 项`,
    },
    {
      key: 'last',
      label: '最近检查',
      // 时间 + 状态：状态取该源最差数据结论（与最差事实同一口径），无记录只写「尚未检查」。
      value: summary.lastCheckAt ? `${summary.lastCheckAt} ／ ${DATA_TEXT[summary.data]}` : '尚未检查',
      title: summary.lastCheckAt
        ? `最近检查 ${summary.lastCheckAt}，该源最差数据结论：${DATA_TEXT[summary.data]}`
        : '该源尚未完成一次正式检查',
    },
    {
      key: 'coverage',
      label: '所选日期覆盖',
      value: COVERAGE_PLACEHOLDER,
      title: '计划覆盖需服务端按时隙聚合（C07），前端不按当前页数据推算',
    },
  ]
}

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