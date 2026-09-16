import type { Source } from '@/api'

export type SourceWorkspaceView = 'flow' | 'data' | 'file' | 'task' | 'monitor-config'
// 网站详情页（0812 会议纠偏）：网站汇总态没有任务页签，任务只在具体源和一级任务中心查看。
// monitor（数据源告警）2026-09-10 接入，枚举位此前已占好。
export type SiteWorkspaceView = 'source' | 'data' | 'file' | 'monitor'

export function firstSourceId(sources: Pick<Source, 'sourceId'>[]): string {
  return sources[0]?.sourceId ?? ''
}

export function normalizeSourceView(view: unknown): SourceWorkspaceView {
  return view === 'flow' || view === 'data' || view === 'task' || view === 'file' || view === 'monitor-config' ? view : 'flow'
}

export function normalizeSiteView(view: unknown): SiteWorkspaceView {
  return view === 'data' || view === 'file' || view === 'monitor' ? view : 'source'
}

// 监控视图（网站汇总态）内的两个子 Tab（0916）：监控结果 = 监控列表，监控配置 = 数据监控告警配置。
// 跟 view 一样落 URL（query.monitorTab），刷新和深链都回得到同一个 Tab。
export type SiteMonitorTab = 'result' | 'config'

export function normalizeSiteMonitorTab(tab: unknown): SiteMonitorTab {
  return tab === 'config' ? 'config' : 'result'
}

/** Hash 路由发生并发更新时，以地址栏中的 view 作为工作区视图兜底状态。 */
export function sourceViewFromHash(hash: string): SourceWorkspaceView {
  return normalizeSourceView(hash.split('?')[1]?.split('&').find((item) => item.startsWith('view='))?.slice(5))
}
