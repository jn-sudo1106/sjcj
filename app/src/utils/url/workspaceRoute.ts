import type { Source } from '@/api'

export type SourceWorkspaceView = 'flow' | 'data' | 'file' | 'task'
// 网站详情页（0812 会议纠偏）：网站汇总态没有任务页签，任务只在具体源和一级任务中心查看；
// monitor 在 M5 接入，这里先占住枚举位，normalizeSiteView 暂不放行（未接入前落到 data）。
export type SiteWorkspaceView = 'source' | 'data' | 'file' | 'monitor'

export function firstSourceId(sources: Pick<Source, 'sourceId'>[]): string {
  return sources[0]?.sourceId ?? ''
}

/**
 * 0904 I11（Z0-3）：切换器里去掉了「文件视图 / 任务视图」，但**类型与路由保留**——
 * 存量深链、页签快照、外部粘贴的 URL 里还会带 `view=file` / `view=task`。
 *
 * 处理：**降级到数据视图**，不是白屏也不是退回流程视图。
 * 文件能力现在在数据视图的单元格文件预览里（0819 N2-7），落到数据视图离用户的意图最近；
 * 任务那条整批暂缓（0903 Y5），入口等产品重新定（0904 §9-Q7）。
 *
 * 什么时候该把这条降级删掉：任务视图入口定下来、或确认再也不会有人带这两个 view 值进来。
 */
export function normalizeSourceView(view: unknown): SourceWorkspaceView {
  if (view === 'flow' || view === 'data') return view
  if (view === 'task' || view === 'file') return 'data'
  return 'flow'
}

export function normalizeSiteView(view: unknown): SiteWorkspaceView {
  return view === 'source' || view === 'file' ? view : 'data'
}

/** Hash 路由发生并发更新时，以地址栏中的 view 作为工作区视图兜底状态。 */
export function sourceViewFromHash(hash: string): SourceWorkspaceView {
  return normalizeSourceView(hash.split('?')[1]?.split('&').find((item) => item.startsWith('view='))?.slice(5))
}
