// @vitest-environment jsdom
// （必须 jsdom：client.ts 在 mock 分支里会读 location.search 做失败注入，node 环境下取不到）
// 任务统计接口层（旧 data-view `src/api/task.js` 的 taskStat）。
// 这一层守两件事：①哪些键会发给后端（空值不下发）；②响应解包（真实响应是行数组，不是分页信封）。
import { describe, expect, it } from 'vitest'
import { buildStatParams, taskStat } from './taskStat'

describe('taskStat · 入参口径（对齐旧 api/task.js）', () => {
  it('空串 / 纯空白视为未传（旧页 buildParams 的过滤口径）', () => {
    expect(buildStatParams({ group: 'source', sourceId: '  ', configId: '', state: undefined })).toEqual({
      group: 'source',
    })
  })

  it('只下发后端认识的 7 个键，且不并存 date 与时间范围（调用方组装，这里不猜）', () => {
    const params = buildStatParams({
      group: 'both',
      sourceId: '161725',
      configId: '70598',
      state: 'E,C',
      date: '2026-10-13',
      startTime: '2026-10-01 00:00:00',
      endTime: '2026-10-13 23:59:59',
    })
    expect(Object.keys(params).sort()).toEqual(['configId', 'date', 'endTime', 'group', 'sourceId', 'startTime', 'state'])
  })

  it('数字 0 也算有效值（不能被当成空值丢掉）', () => {
    expect(buildStatParams({ sourceId: '0' as unknown as string })).toEqual({ sourceId: '0' })
  })
})

describe('taskStat · 走 mock 端点', () => {
  it('返回行数组（sourceId/configId/cnt），不带 state 时行里没有 state 字段', async () => {
    const rows = await taskStat({ group: 'source', date: '2026-10-13' })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]).toHaveProperty('sourceId')
    expect(rows[0]).toHaveProperty('cnt')
    expect(rows[0]).not.toHaveProperty('state')
  })

  it('带多状态请求时行里带 state（页面据此判定后端为 v2）', async () => {
    const rows = await taskStat({ group: 'source', date: '2026-10-13', state: 'E,C,AC,W1,W,L' })
    expect(rows.length).toBeGreaterThan(0)
    expect(new Set(rows.map((r) => r.state)).size).toBeGreaterThan(1)
    expect(rows.every((r) => typeof r.state === 'string')).toBe(true)
  })

  it('单状态请求只返回该状态的行', async () => {
    const rows = await taskStat({ group: 'source', date: '2026-10-13', state: 'E' })
    expect(rows.every((r) => r.state === 'E')).toBe(true)
  })
})
