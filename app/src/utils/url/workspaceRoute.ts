import type { Source } from '@/api'
import type { Router } from 'vue-router'

export type SourceWorkspaceView = 'overview' | 'flow' | 'data' | 'file' | 'task' | 'monitor-config'
// 网站详情页视图。monitor（数据源告警）2026-09-10 接入，枚举位此前已占好。
//
// task（0915-05，2026-09-16）：**推翻 0812 会议「网站汇总态没有任务页签」的结论**。
// 0812 定的是"任务只在具体源和一级任务中心查看"，但 0915 会上产品指出真实困境——
// 「发任务跑起来，现在想看跑了哪些任务是看不了的，因为不知道跑在哪个源上」；
// 任务中心又不区分网站，所以必须有一个"本网站、不分源"的任务视图。
export type SiteWorkspaceView = 'source' | 'data' | 'file' | 'task' | 'monitor'

export function firstSourceId(sources: Pick<Source, 'sourceId'>[]): string {
  return sources[0]?.sourceId ?? ''
}

// 首次打开源先看概览；显式指定的工作视图保持不变。
export function normalizeSourceView(view: unknown): SourceWorkspaceView {
  return view === 'overview' || view === 'flow' || view === 'data' || view === 'task' || view === 'file' || view === 'monitor-config' ? view : 'overview'
}

export function normalizeSiteView(view: unknown): SiteWorkspaceView {
  return view === 'data' || view === 'file' || view === 'task' || view === 'monitor' ? view : 'source'
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

/** 只接受源问题看板的站内返回路径。 */
export function resolveSourceIssueReturn(router: Router, target: unknown): string {
  if (typeof target !== 'string' || !target.startsWith('/monitor?')) return ''
  const resolved = router.resolve(target)
  return resolved.path === '/monitor' && resolved.query.tab === 'sourceIssues' ? resolved.fullPath : ''
}
