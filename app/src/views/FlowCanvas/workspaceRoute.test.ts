import { describe, expect, it } from 'vitest'
import { firstSourceId, normalizeSourceView, sourceViewFromHash } from './workspaceRoute'

describe('子源工作区路由', () => {
  it('未指定视图时默认流程视图', () => {
    expect(normalizeSourceView(undefined)).toBe('flow')
  })

  it('网站容器选择首个子源', () => {
    expect(firstSourceId([{ sourceId: 'src-a' }, { sourceId: 'src-b' }])).toBe('src-a')
  })

  it('hash 路由可解析工作区视图', () => {
    expect(sourceViewFromHash('#/canvas?sourceId=src-a&view=data')).toBe('data')
    expect(sourceViewFromHash('#/canvas?sourceId=src-a')).toBe('flow')
  })
})
