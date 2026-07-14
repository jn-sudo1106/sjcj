import type { Source } from '../../api'

export type SourceWorkspaceView = 'flow' | 'data' | 'file' | 'task'

export function firstSourceId(sources: Pick<Source, 'sourceId'>[]): string {
  return sources[0]?.sourceId ?? ''
}

export function normalizeSourceView(view: unknown): SourceWorkspaceView {
  return view === 'flow' || view === 'data' || view === 'task' || view === 'file' ? view : 'flow'
}

/** Hash 路由发生并发更新时，以地址栏中的 view 作为工作区视图兜底状态。 */
export function sourceViewFromHash(hash: string): SourceWorkspaceView {
  return normalizeSourceView(hash.split('?')[1]?.split('&').find((item) => item.startsWith('view='))?.slice(5))
}
