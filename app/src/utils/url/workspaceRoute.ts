import type { Source } from '@/api'

export type SourceWorkspaceView = 'flow' | 'data' | 'file' | 'task'
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

export function normalizeSourceView(view: unknown): SourceWorkspaceView {
  return view === 'flow' || view === 'data' || view === 'task' || view === 'file' ? view : 'flow'
}

export function normalizeSiteView(view: unknown): SiteWorkspaceView {
  return view === 'data' || view === 'file' || view === 'task' || view === 'monitor' ? view : 'source'
}

/** Hash 路由发生并发更新时，以地址栏中的 view 作为工作区视图兜底状态。 */
export function sourceViewFromHash(hash: string): SourceWorkspaceView {
  return normalizeSourceView(hash.split('?')[1]?.split('&').find((item) => item.startsWith('view='))?.slice(5))
}
