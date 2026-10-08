/** undefined = 全部；空字符串 = 空交集，调用方必须直接返回空结果，不能发给旧接口。 */
export function scopedSourceIds(scope: string[] | undefined, filter?: string): string | undefined {
  if (scope === undefined) return filter
  const wanted = filter ? new Set(filter.split(/[,，\s]+/).filter(Boolean)) : undefined
  return [...new Set(scope)].filter(id => !wanted || wanted.has(id)).join(',')
}
