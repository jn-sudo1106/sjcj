/** Server-resolved source range. Empty selected is an empty set; none alone means unrestricted. */
export interface SourceDirectoryScope {
  kind: 'sys' | 'biz'
  mode: 'none' | 'selected' | 'all'
  selections: { id: string; includeDescendants: boolean }[]
}
export type SiteScopeSort = 'editedDesc' | 'siteIdAsc' | 'siteIdDesc' | 'sourceCountAsc' | 'sourceCountDesc'

/** Legacy query-bound SourceCond endpoints need dotted keys, never "[object Object]". */
export function directoryQueryParams(value: unknown): Record<string, string | boolean> {
  const directory = value as SourceDirectoryScope | undefined
  if (!directory || directory.mode === 'none') return {}
  const params: Record<string, string | boolean> = { 'directory.kind': directory.kind, 'directory.mode': directory.mode }
  directory.selections.forEach((selection, i) => {
    params[`directory.selections[${i}].id`] = selection.id
    params[`directory.selections[${i}].includeDescendants`] = selection.includeDescendants
  })
  return params
}
