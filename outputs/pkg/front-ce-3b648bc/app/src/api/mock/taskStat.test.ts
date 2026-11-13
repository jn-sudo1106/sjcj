// 任务统计 mock（/v1/task/stat）的行为约定。
// 最要紧的是**形态**：不带 state 的行没有 state 字段、带 state 的行有 —— 任务统计页的
// v2/v1 能力探测就靠这个判据，mock 形态错了会让页面在演示环境里走错请求模式。
import { describe, expect, it } from 'vitest'
import { mockTaskStat, statWindowDays } from './taskStat'

const TODAY = '2026-10-13'

describe('mockTaskStat · 形态', () => {
  it('不带 state：行里没有 state 字段（总数视角）', () => {
    const rows = mockTaskStat({ group: 'source', date: TODAY })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => !('state' in r))).toBe(true)
  })

  it('带多状态：每行都带 state，且至少覆盖 E 与 C', () => {
    const rows = mockTaskStat({ group: 'source', date: TODAY, state: 'E,C,AC,W1,W,L' })
    const states = new Set(rows.map((r) => r.state))
    expect(states.has('E')).toBe(true)
    expect(states.has('C')).toBe(true)
    expect(rows.every((r) => typeof r.state === 'string')).toBe(true)
  })

  it('各状态行之和 == 总数行的 cnt（状态构成图切片和不会超过合计）', () => {
    const total = mockTaskStat({ group: 'source', date: TODAY })
    const multi = mockTaskStat({ group: 'source', date: TODAY, state: 'E,C,AC,W1,W,L,WD,WA,RC' })
    const byId = (rows: { sourceId?: unknown; cnt: number | string }[]) => {
      const m = new Map<string, number>()
      rows.forEach((r) => m.set(String(r.sourceId), (m.get(String(r.sourceId)) ?? 0) + Number(r.cnt)))
      return m
    }
    const t = byId(total)
    const s = byId(multi)
    expect([...t.keys()].sort()).toEqual([...s.keys()].sort())
    t.forEach((cnt, id) => expect(s.get(id)).toBe(cnt))
  })
})

describe('mockTaskStat · 分组维度', () => {
  it('group=source 不返回 configId；group=config 不返回 sourceId；both 两者都有', () => {
    const bySource = mockTaskStat({ group: 'source', date: TODAY })
    expect(bySource.every((r) => r.configId == null)).toBe(true)
    const byConfig = mockTaskStat({ group: 'config', date: TODAY })
    expect(byConfig.every((r) => r.sourceId == null)).toBe(true)
    expect(byConfig.every((r) => r.configId != null)).toBe(true)
    const both = mockTaskStat({ group: 'both', date: TODAY })
    // both 维度下允许某一维为空（mock 特意留了「配置为空」「来源为空」各一条，用来验证页面上的「-」），
    // 但不可能两维都空
    expect(both.some((r) => r.sourceId != null && r.configId != null)).toBe(true)
    expect(both.every((r) => r.sourceId != null || r.configId != null)).toBe(true)
  })

  it('group 缺省按 source 处理（旧页默认值）', () => {
    expect(mockTaskStat({ date: TODAY })).toEqual(mockTaskStat({ group: 'source', date: TODAY }))
  })
})

describe('mockTaskStat · 过滤与窗口', () => {
  it('sourceId / configId 按包含匹配（演示环境里输半截也能看到效果）', () => {
    expect(mockTaskStat({ group: 'source', date: TODAY, sourceId: '1617' }).every((r) => String(r.sourceId).includes('1617'))).toBe(true)
    expect(mockTaskStat({ group: 'config', date: TODAY, configId: '706' }).length).toBeGreaterThan(0)
    expect(mockTaskStat({ group: 'source', date: TODAY, sourceId: '不存在的源' })).toEqual([])
  })

  it('窗口天数按时间范围算，任务量随之放大（含首尾）', () => {
    expect(statWindowDays({ date: TODAY })).toBe(1)
    expect(statWindowDays({ startTime: '2026-10-07 00:00:00', endTime: '2026-10-13 23:59:59' })).toBe(7)
    // 只给一端时按 1 天算（旧页只在两端都有时才裁剪/透传范围）
    expect(statWindowDays({ startTime: '2026-10-07 00:00:00' })).toBe(1)
    const oneDay = mockTaskStat({ group: 'source', date: TODAY })
    const week = mockTaskStat({ group: 'source', startTime: '2026-10-07 00:00:00', endTime: '2026-10-13 23:59:59' })
    // 不是精确 ×7：每个状态各自 round(perDay × 天数 × 权重)，小数进位会让两点之间有零点几天的差
    expect(Number(week[0].cnt)).toBeGreaterThan(Number(oneDay[0].cnt) * 6.5)
    expect(Number(week[0].cnt)).toBeLessThan(Number(oneDay[0].cnt) * 7.5)
  })

  it('结果按 cnt 降序（与后端一致）', () => {
    const rows = mockTaskStat({ group: 'source', date: TODAY })
    const cnts = rows.map((r) => Number(r.cnt))
    expect([...cnts].sort((a, b) => b - a)).toEqual(cnts)
  })
})
