import { describe, expect, it } from 'vitest'
import {
  mockCommJobPaged,
  mockCommJobAdd,
  mockCommJobUpdate,
  mockCommJobDelete,
  mockCommJobChangeEnable,
  mockCommJobCopy,
  mockCommJobRun,
} from './commJob'

// 自定义告警 mock（/v1/comm-job/*）：筛选口径与 7 个写操作必须和后端契约一致，
// 否则本地 mock 演示会出现「点了没反应」的假象。
// ⚠️ 内存表是模块级共享状态，所以把**只读**用例放前面，写操作用例放后面，并自带清理。
describe('自定义告警 mock：分页与筛选', () => {
  it('默认返回全部（内存表 6 条），顺序即内存表顺序', () => {
    const res = mockCommJobPaged({ page: 1, limit: 100 })
    expect(res.total).toBe(6)
    expect(res.list[0].jobId).toBe('1001')
  })

  it('enable 与 isDelete 同向：\'0\' 只看在用，\'1\' 只看停用，\'-1\' 只看历史删除', () => {
    const active = mockCommJobPaged({ enable: '0' })
    expect(active.total).toBe(4)
    expect(active.list.every((r) => r.isDelete === 0)).toBe(true)

    const disabled = mockCommJobPaged({ enable: '1' })
    expect(disabled.total).toBe(1)
    expect(disabled.list[0].isDelete).toBe(1)

    const removed = mockCommJobPaged({ enable: '-1' })
    expect(removed.total).toBe(1)
    expect(removed.list[0].isDelete).toBeLessThan(0)

    // 不带 enable（旧「重置」后 queryParam = {} 的效果）= 全部
    expect(mockCommJobPaged({}).total).toBe(6)
  })

  it('query.queue / query.name 都落在 jobName 上；queryId 落在 jobId 上', () => {
    const expectNames = ['订单积压告警', '支付失败率告警', '短信配额告警（已停用）']
    expect(mockCommJobPaged({ queue: '告警' }).list.map((r) => r.jobName)).toEqual(expectNames)
    expect(mockCommJobPaged({ name: '告警' }).list.map((r) => r.jobName)).toEqual(expectNames)
    const byId = mockCommJobPaged({ queueId: '100' })
    expect(byId.total).toBe(6)
    expect(mockCommJobPaged({ queueId: '1005' }).list.map((r) => r.jobId)).toEqual(['1005'])
  })

  it('分页切页', () => {
    const p2 = mockCommJobPaged({ page: 2, limit: 4 })
    expect(p2.total).toBe(6)
    expect(p2.list).toHaveLength(2)
    expect(p2.list[0].jobId).toBe('1005')
  })
})

describe('自定义告警 mock：写操作（共用内存表，自带清理）', () => {
  it('changeEnable：0=启用 / 1=停用（与 isDelete 同向），可来回切', () => {
    mockCommJobChangeEnable({ ids: '1004', enable: 1 })
    expect(mockCommJobPaged({ queueId: '1004' }).list[0].isDelete).toBe(1)
    mockCommJobChangeEnable({ ids: '1004', enable: 0 })
    expect(mockCommJobPaged({ queueId: '1004' }).list[0].isDelete).toBe(0)
  })

  it('copy：沿用原配置、名字加 -copy、运行统计清零、定时不变', () => {
    const src = mockCommJobPaged({ queueId: '1001' }).list[0]
    const res = mockCommJobCopy({ id: '1001' }) as { ok: boolean; id: string }
    expect(res.ok).toBe(true)

    const copy = mockCommJobPaged({ queueId: res.id }).list[0]
    expect(copy.jobName).toBe(`${src.jobName}-copy`)
    expect(copy.schedule).toBe(src.schedule)
    expect(copy.sqlDef).toBe(src.sqlDef)
    expect(copy.runCnt).toBe(0)
    expect(copy.successCnt).toBe(0)

    // 清理：把复制出来的那条删掉，避免影响后面的用例
    mockCommJobDelete({ ids: res.id })
    expect(mockCommJobPaged({ queueId: res.id }).total).toBe(0)
  })

  it('run：把「上次运行 / 执行信息 / 总运行次」更新掉（页面刷新后能看到变化）', () => {
    // 注意：paged 返回的是内存表里的**同一批对象引用**（不是副本），所以必须先取值快照
    const before = mockCommJobPaged({ queueId: '1002' }).list[0]
    const beforeLastRun = before.lastRun
    const beforeCnt = Number(before.runCnt)

    mockCommJobRun({ id: '1002' })

    const after = mockCommJobPaged({ queueId: '1002' }).list[0]
    expect(after.lastRun).not.toBe(beforeLastRun)
    expect(after.lastMsg).toContain('已提交运行')
    expect(Number(after.runCnt)).toBe(beforeCnt + 1)
  })

  it('add / update / delete 落库到内存表', () => {
    const added = mockCommJobAdd({ jobType: 'sql', jobName: '临时任务', schedule: '0 0 1 * * ?', isDelete: 0 }) as {
      ok: boolean
      id: string
    }
    expect(added.ok).toBe(true)
    const created = mockCommJobPaged({ queueId: added.id }).list[0]
    expect(created.jobName).toBe('临时任务')
    expect(created.runCnt).toBe(0)

    mockCommJobUpdate({ jobId: added.id, jobName: '临时任务（改）' })
    expect(mockCommJobPaged({ queueId: added.id }).list[0].jobName).toBe('临时任务（改）')

    mockCommJobDelete({ ids: added.id })
    expect(mockCommJobPaged({ queueId: added.id }).total).toBe(0)
  })
})
