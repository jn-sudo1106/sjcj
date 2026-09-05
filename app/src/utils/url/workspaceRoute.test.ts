import { describe, expect, it } from 'vitest'
import { firstSourceId, normalizeSiteView, normalizeSourceView, sourceViewFromHash } from './workspaceRoute'

describe('源工作区路由', () => {
  it('未指定视图时默认流程视图', () => {
    expect(normalizeSourceView(undefined)).toBe('flow')
  })

  it('网站容器选择首个源', () => {
    expect(firstSourceId([{ sourceId: 'src-a' }, { sourceId: 'src-b' }])).toBe('src-a')
  })

  it('hash 路由可解析工作区视图', () => {
    expect(sourceViewFromHash('#/canvas?sourceId=src-a&view=data')).toBe('data')
    expect(sourceViewFromHash('#/canvas?sourceId=src-a')).toBe('flow')
  })

  it('源视图只属于网站详情，源路由不会进入该视图', () => {
    expect(normalizeSiteView('source')).toBe('source')
    expect(normalizeSourceView('source')).toBe('flow')
  })
})

// 0904 I11（Z0-3）：切换器去掉「文件视图 / 任务视图」，但存量深链、页签快照里还带着
// view=file / view=task。它们必须**降级到数据视图**——文件能力现在在数据视图的单元格
// 文件预览里（0819 N2-7），落到数据视图离用户意图最近；退回流程视图或白屏都不对。
describe('撤掉的视图深链降级（Z0-3）', () => {
  it('view=file 落到数据视图', () => {
    expect(normalizeSourceView('file')).toBe('data')
  })

  it('view=task 落到数据视图', () => {
    expect(normalizeSourceView('task')).toBe('data')
  })

  it('hash 里的旧 view 同样降级（页签快照/外部粘贴的 URL 走这条）', () => {
    expect(sourceViewFromHash('#/canvas?sourceId=src-a&view=file')).toBe('data')
    expect(sourceViewFromHash('#/canvas?sourceId=src-a&view=task')).toBe('data')
  })

  it('仍然认得的两个视图不受影响', () => {
    expect(normalizeSourceView('flow')).toBe('flow')
    expect(normalizeSourceView('data')).toBe('data')
  })
})
