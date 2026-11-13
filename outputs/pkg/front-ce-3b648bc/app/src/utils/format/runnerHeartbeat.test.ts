import { expect, it } from 'vitest'
import { formatRunnerHeartbeat } from './runnerHeartbeat'

it('UTC 心跳跨日转换为北京时间，午夜使用 00，日期时间补零', () => {
  expect(formatRunnerHeartbeat('2026-10-12T16:36:50+00:00')).toBe('2026-10-13 00:36:50')
  expect(formatRunnerHeartbeat('2026-10-12T16:00:00Z')).toBe('2026-10-13 00:00:00')
  expect(formatRunnerHeartbeat('2026-01-02T01:02:03.999Z')).toBe('2026-01-02 09:02:03')
  expect(formatRunnerHeartbeat('2026-10-13T00:36:50+08:00')).toBe('2026-10-13 00:36:50')
})
it('兼容旧接口无时区的北京时间，缺失或无效值不显示 Invalid Date', () => {
  expect(formatRunnerHeartbeat('2026-10-04 12:00')).toBe('2026-10-04 12:00:00')
  for (const value of [undefined, null, '', 'not-a-date']) expect(formatRunnerHeartbeat(value)).toBe('未收到心跳')
})
