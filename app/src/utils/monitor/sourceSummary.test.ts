import { describe, expect, it } from 'vitest'
import { summarizeSource, summarizeSources } from './sourceSummary'
import type { MonitorRecordView } from '../../api/types/monitorCenter'
import { toMonitorRecord } from './record'

function view(over: Partial<MonitorRecordView> = {}): MonitorRecordView {
  return {
    id: 'mon-1',
    sourceId: 'src-1',
    name: '检查项',
    kind: 'rule',
    enabled: true,
    schedule: '0 30 8 * * *',
    publishStatus: 'ready',
    exec: 'succeeded',
    data: 'normal',
    notify: 'unknown',
    count: '60',
    conf: {},
    raw: {} as never,
    ...over,
  }
}

describe('summarizeSource 的最差事实优先级', () => {
  it('没有记录 → 未配置检查（中性）', () => {
    const agg = summarizeSource('src-1', [])
    expect(agg.label).toBe('未配置检查')
    expect(agg.tone).toBe('muted')
    expect(agg.unconfigured).toBe(true)
  })

  it('全部停用 → 已停用，不显示数据结论', () => {
    const agg = summarizeSource('src-1', [view({ enabled: false, data: 'normal' })])
    expect(agg.label).toBe('已停用')
    expect(agg.tone).toBe('muted')
    expect(agg.monitorTotal).toBe(1)
    expect(agg.monitorEnabled).toBe(0)
  })

  it('任一异常 → 数据异常（优先于执行失败之外的其它事实）', () => {
    const agg = summarizeSource('src-1', [view({ data: 'normal' }), view({ id: 'mon-2', data: 'abnormal' })])
    expect(agg.label).toBe('数据异常')
    expect(agg.tone).toBe('bad')
  })

  it('执行失败但数据未知 → 执行失败 · 数量未知（不折成数据异常）', () => {
    const agg = summarizeSource('src-1', [view({ exec: 'failed', data: 'unknown' })])
    expect(agg.label).toBe('执行失败 · 数量未知')
    expect(agg.tone).toBe('warn')
  })

  it('启用但只有草稿 → 未生效 · 不会执行（不能显示尚未检查）', () => {
    const agg = summarizeSource('src-1', [view({ publishStatus: 'draft', exec: 'none', data: 'unknown' })])
    expect(agg.label).toBe('未生效 · 不会执行')
    expect(agg.tone).toBe('warn')
  })

  it('启用且已生效但没跑过 → 尚未检查', () => {
    const agg = summarizeSource('src-1', [view({ exec: 'none', data: 'unknown' })])
    expect(agg.label).toBe('尚未检查')
    expect(agg.tone).toBe('unknown')
  })

  it('有结果但结论待判断 → 待判断', () => {
    const agg = summarizeSource('src-1', [view({ data: 'unknown' })])
    expect(agg.label).toBe('待判断')
  })

  it('有正常项 → 数据正常（同源另一项 0 条不把整源标黄）', () => {
    const agg = summarizeSource('src-1', [view(), view({ id: 'mon-2', data: 'no_data' })])
    expect(agg.label).toBe('数据正常')
    expect(agg.tone).toBe('good')
  })

  it('全部启用项都是 no_data → 无待检记录，不能落成数据正常', () => {
    const agg = summarizeSource('src-1', [
      view({ data: 'no_data' }),
      view({ id: 'mon-2', data: 'no_data' }),
    ])
    expect(agg.label).toBe('无待检记录')
    expect(agg.tone).toBe('warn')
    expect(agg.data).toBe('no_data')
  })

  it('覆盖统计没有服务端聚合时是 null，不伪造 0', () => {
    expect(summarizeSource('src-1', [view()]).coverage).toBeNull()
  })
})

describe('summarizeSources', () => {
  const sources = [
    { id: 'src-1', name: '上市公司新闻', siteId: 'st-1' },
    { id: 'src-2', name: '行业研报库', siteId: 'st-1' },
  ]

  it('传源目录时未配置检查的源也出现（1110 §3.2 要求）', () => {
    const rows = summarizeSources([toMonitorRecord({ id: '9', isDelete: 0, state: 'C', lastMsg: '正常, 数量:1', name: 'x', tableName: 't', schedule: '', nextRun: '', lastRun: '2026-11-10 08:00:00', sourceId: 'src-1', checkConf: '{}' } as never)], sources)
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.sourceId === 'src-2')?.unconfigured).toBe(true)
  })

  it('不传源目录只返回有监控的源（页面需要提示「仅已配置源」）', () => {
    const rows = summarizeSources([view({ sourceId: 'src-1' }), view({ id: 'mon-2', sourceId: 'src-1' })])
    expect(rows).toHaveLength(1)
    expect(rows[0].monitorTotal).toBe(2)
  })

  it('监控里存在但源目录没有的源也要列出，不能静默丢数据', () => {
    const rows = summarizeSources([view({ sourceId: 'src-9', sourceName: '已迁组的源' })], sources)
    expect(rows.map((r) => r.sourceId)).toContain('src-9')
  })
})