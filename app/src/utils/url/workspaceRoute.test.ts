import { describe, expect, it } from 'vitest'
import { firstSourceId, normalizeSiteMonitorTab, normalizeSiteView, normalizeSourceView, sourceViewFromHash } from './workspaceRoute'

describe('源工作区路由', () => {
  // 源默认概览，显式指定视图保持原落点。
  it('未指定视图时默认概览视图', () => {
    expect(normalizeSourceView(undefined)).toBe('overview')
    expect(normalizeSourceView('flow')).toBe('flow')
  })

  it('网站容器选择首个源', () => {
    expect(firstSourceId([{ sourceId: 'src-a' }, { sourceId: 'src-b' }])).toBe('src-a')
  })

  it('hash 路由可解析工作区视图', () => {
    expect(sourceViewFromHash('#/canvas?sourceId=src-a&view=data')).toBe('data')
    expect(sourceViewFromHash('#/canvas?sourceId=src-a&view=flow')).toBe('flow')
    expect(sourceViewFromHash('#/canvas?sourceId=src-a')).toBe('overview')
  })

  it('数据监控节点可进入监控配置视图', () => {
    expect(normalizeSourceView('monitor-config')).toBe('monitor-config')
    expect(sourceViewFromHash('#/canvas?sourceId=src-a&view=monitor-config')).toBe('monitor-config')
  })

  // 0916：监控视图内部再分「监控结果 / 监控配置」两个子 Tab，非法值一律回落到监控结果。
  it('监控视图子 Tab 只认 config，其余回落监控结果', () => {
    expect(normalizeSiteMonitorTab('config')).toBe('config')
    expect(normalizeSiteMonitorTab('result')).toBe('result')
    expect(normalizeSiteMonitorTab(undefined)).toBe('result')
    expect(normalizeSiteMonitorTab('monitor-config')).toBe('result')
  })

  it('源视图只属于网站详情，源路由不会进入该视图', () => {
    expect(normalizeSiteView('source')).toBe('source')
    expect(normalizeSiteView(undefined)).toBe('source')
    expect(normalizeSourceView('source')).toBe('overview')
  })
})
