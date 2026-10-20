// cron 工具回归：预设清单、中文描述、本地格式校验（旧 utils/cron.js 的三件套）。
import { describe, expect, it } from 'vitest'
import { CRON_PRESETS, describeCron, isIntervalCron, localCronCheck } from './cron'

describe('CRON_PRESETS', () => {
  it('9 条预设，顺序与旧文件一致', () => {
    expect(CRON_PRESETS).toHaveLength(9)
    expect(CRON_PRESETS[0]).toEqual({ txt: '每10秒钟', cron: '0/10 * * * * ?' })
    expect(CRON_PRESETS[8]).toEqual({ txt: '每周一19点', cron: '0 0 19 ? * 1' })
  })
})

describe('describeCron', () => {
  it('@秒数 → 每 N 秒', () => {
    expect(describeCron('@300')).toBe('每 300 秒')
  })

  it('精确映射表', () => {
    expect(describeCron('0 0 3 * * ?')).toBe('每天3点')
    expect(describeCron('0 0 19 ? * 1')).toBe('每周一19点')
  })

  it('通用解析：每天 N 点 / 每 n 分钟', () => {
    expect(describeCron('0 0 7 * * ?')).toBe('每天 7 点')
    expect(describeCron('0 0/15 * * * ?')).toBe('每 15 分钟')
  })

  it('周段有具体值时不硬套「每天」（旧版的 dowFree 判据）', () => {
    expect(describeCron('0 0 7 * * 2')).toBe('')
  })

  it('认不出来 / 空值给空串', () => {
    expect(describeCron('1 2 3 4 5 6')).toBe('')
    expect(describeCron('')).toBe('')
    expect(describeCron(undefined)).toBe('')
  })
})

describe('localCronCheck', () => {
  it('合法：@秒数 与 6~7 段', () => {
    expect(localCronCheck('@300')).toBe('')
    expect(localCronCheck('0 0/30 * * * ?')).toBe('')
    expect(localCronCheck('0 0/30 * * * ? 2026')).toBe('')
  })

  it('非法：空 / 段数不对', () => {
    expect(localCronCheck('')).toBe('请填写调度表达式')
    expect(localCronCheck('0 0 * *')).toContain('6~7 段')
  })
})

describe('isIntervalCron', () => {
  it('只认 @数字', () => {
    expect(isIntervalCron('@300')).toBe(true)
    expect(isIntervalCron('@300 0 * * * ?')).toBe(false)
    expect(isIntervalCron('0 0 * * * ?')).toBe(false)
  })
})
