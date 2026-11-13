// 运行记录抽屉的公共口径：范围说明、三维筛选、条数/时间格式、状态文案与色调。
import { describe, expect, it } from 'vitest'
import type { MonitorRunView } from '@/api/types/monitorCenter'
import {
  RUN_EXEC_OPTIONS,
  anyFilterActive,
  dataTone,
  emptyRunFilters,
  execTone,
  filterRuns,
  notifyShortText,
  notifyTone,
  runCountText,
  runListQuery,
  runTimeText,
  scopeLabel,
} from './runScope'

function run(over: Partial<MonitorRunView> = {}): MonitorRunView {
  return {
    id: 'l1',
    sourceId: 's1',
    monitorName: '日增量监控',
    at: '2026-09-09 11:00:46',
    trigger: 'legacy',
    exec: 'succeeded',
    data: 'normal',
    notify: 'unknown',
    count: '1240',
    deliveries: [],
    legacy: true,
    ...over,
  }
}

describe('runListQuery · 范围翻译', () => {
  it('monitorId 优先，并把已知的 sourceId 一起带上（兼容旧接口的 sourceId 参数）', () => {
    expect(runListQuery({ monitorId: 'm1', sourceId: 's1' })).toEqual({ monitorId: 'm1', sourceId: 's1' })
    expect(runListQuery({ monitorId: 'm1' })).toEqual({ monitorId: 'm1' })
    expect(runListQuery({ sourceId: 's1' })).toEqual({ sourceId: 's1' })
    expect(runListQuery({ monitorId: '  ', sourceId: '  ' })).toEqual({})
  })

  it('范围文案要让人分清「一条检查项」和「整个源」', () => {
    expect(scopeLabel({ monitorId: 'm1', monitorName: '日增量监控' })).toBe('当前检查项「日增量监控」')
    expect(scopeLabel({ monitorId: 'm1' })).toBe('当前检查项「m1」')
    expect(scopeLabel({ sourceId: 's1' })).toBe('当前源 · 含该源下全部检查项')
    expect(scopeLabel({})).toBe('未指定范围')
  })
})

describe('filterRuns · 三维客户端筛选', () => {
  const abnormal = run({ id: 'a', exec: 'failed', data: 'abnormal', notify: 'failed', legacy: false })
  const normal = run({ id: 'b', exec: 'succeeded', data: 'normal', notify: 'unknown' })
  const running = run({ id: 'c', exec: 'running', data: 'unknown', notify: 'pending' })

  it('空筛选保留全部；每个维度独立生效', () => {
    const runs = [abnormal, normal, running]
    expect(filterRuns(runs, emptyRunFilters())).toHaveLength(3)
    expect(filterRuns(runs, { exec: 'failed', data: '', notify: '' })).toEqual([abnormal])
    expect(filterRuns(runs, { exec: '', data: 'normal', notify: '' })).toEqual([normal])
    expect(filterRuns(runs, { exec: '', data: '', notify: 'pending' })).toEqual([running])
  })

  it('多个维度是 AND；没命中返回空数组', () => {
    const runs = [abnormal, normal, running]
    expect(filterRuns(runs, { exec: 'failed', data: 'normal', notify: '' })).toEqual([])
    expect(anyFilterActive(emptyRunFilters())).toBe(false)
    expect(anyFilterActive({ exec: 'failed', data: '', notify: '' })).toBe(true)
  })

  it('筛选选项覆盖共享层的全部执行状态', () => {
    expect(RUN_EXEC_OPTIONS.map((option) => option.value)).toContain('timeout')
    expect(RUN_EXEC_OPTIONS.map((option) => option.value)).toContain('queued')
  })
})

describe('runCountText · 条数未知显示「—」', () => {
  it('空串 → 「—」；0 是有效值不当作未知', () => {
    expect(runCountText(run({ count: '' }))).toBe('—')
    expect(runCountText(run({ count: '0' }))).toBe('0')
    expect(runCountText(run({ count: '1240' }))).toBe('1240')
    expect(runCountText(run({ count: undefined as unknown as string }))).toBe('—')
  })
})

describe('runTimeText · 只整理格式，不做时区换算', () => {
  it('ISO 的 T / 毫秒 / 时区后缀去掉，时钟数字保持后端给的值', () => {
    expect(runTimeText('2026-11-11T10:02:33.123+08:00')).toBe('2026-11-11 10:02:33')
    expect(runTimeText('2026-11-11T10:02:33Z')).toBe('2026-11-11 10:02:33')
    expect(runTimeText('2026-09-09 11:00:46')).toBe('2026-09-09 11:00:46')
    expect(runTimeText(undefined)).toBe('—')
  })
})

describe('通知短文案 · 受理 ≠ 送达', () => {
  it('accepted 必须体现「未送达」；没有回执写「未取得回执」；只有 delivered 才写「已送达」', () => {
    expect(notifyShortText('accepted')).toContain('未送达')
    expect(notifyShortText('accepted')).not.toBe('已送达')
    expect(notifyShortText('unknown')).toBe('未取得回执')
    expect(notifyShortText('delivered')).toBe('已送达')
    expect(notifyShortText('none')).toBe('未配置')
  })
})

describe('状态色调', () => {
  it('执行/数据/通知只有明确的成功才绿，未知一律灰', () => {
    expect(execTone('succeeded')).toBe('ok')
    expect(execTone('failed')).toBe('err')
    expect(execTone('timeout')).toBe('err')
    expect(execTone('running')).toBe('run')
    expect(execTone('cancelled')).toBe('muted')
    expect(execTone('unknown')).toBe('muted')

    expect(dataTone('normal')).toBe('ok')
    expect(dataTone('abnormal')).toBe('err')
    expect(dataTone('no_data')).toBe('warn')
    expect(dataTone('unknown')).toBe('muted')

    expect(notifyTone('delivered')).toBe('ok')
    expect(notifyTone('accepted')).toBe('warn')
    expect(notifyTone('pending')).toBe('warn')
    expect(notifyTone('failed')).toBe('err')
    expect(notifyTone('suppressed')).toBe('muted')
    expect(notifyTone('unknown')).toBe('muted')
  })
})