// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SourceIssueQuery } from './sourceIssues'
const loginUsername = vi.hoisted(() => vi.fn(() => 'admin'))
vi.mock('./auth', () => ({ readLoginUsername: loginUsername }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ name: '当前系统账号' }) }))
const query: SourceIssueQuery = { keyword: '', state: undefined, createTimeStart: '', createTimeEnd: '', page: 1, size: 20 }
const sourceIds = ['a', 'b']

beforeEach(() => { vi.resetModules(); loginUsername.mockReturnValue('admin'); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-03T09:00:00')) })
afterEach(() => vi.useRealTimers())

describe('源问题前端演示服务', () => {
  it('已有登录会话没有登录名缓存时沿用系统账号', async () => {
    loginUsername.mockReturnValue('')
    const { sourceIssueApi } = await import('./sourceIssues')
    const [created] = await sourceIssueApi.create({ sourceIds: ['a'], description: '账号核对' })
    expect(created!.createdBy).toBe('当前系统账号')
    const handled = await sourceIssueApi.handle(created!.id)
    expect(handled.handledBy).toBe('当前系统账号')
    expect(handled.state).toBe(1)
    expect(handled.handleTime).toBe('2026-11-03 09:00:00')
  })

  it('批量登记每个源独立记录，自动记录账号和源管理口径的时间，重复源只登记一次', async () => {
    const { sourceIssueApi } = await import('./sourceIssues')
    const created = await sourceIssueApi.create({ sourceIds: [...sourceIds, 'a'], description: '  字段缺失  ' })
    expect(created).toHaveLength(2)
    expect(new Set(created.map(row => row.id)).size).toBe(2)
    expect(created.map(row => row.sourceId)).toEqual(['a', 'b'])
    expect(created.every(row => row.description === '字段缺失' && row.state === 0 && row.createdBy === 'admin')).toBe(true)
    expect(created[0]!.createTime).toBe('2026-11-03 09:00:00')
    expect(created[1]!.createTime).toBe(created[0]!.createTime)
    expect(created[0]!.handleTime).toBeUndefined()
  })

  it('状态、关键词和登记日期按后端口径筛选，分页不丢失筛选口径', async () => {
    const { sourceIssueApi } = await import('./sourceIssues')
    await sourceIssueApi.create({ sourceIds, description: '字段缺失' })
    const filtered = { ...query, keyword: '字段缺失', state: 0 as const, createTimeStart: '2026-11-03', createTimeEnd: '2026-11-04', size: 1 }
    const first = await sourceIssueApi.paged(filtered)
    const second = await sourceIssueApi.paged({ ...filtered, page: 2 })
    expect(first.total).toBe(2)
    expect(second.total).toBe(2)
    expect(first.list[0]!.id).not.toBe(second.list[0]!.id)
    expect((await sourceIssueApi.paged({ ...filtered, keyword: 'b' })).total).toBe(1)
    expect((await sourceIssueApi.paged({ ...filtered, createTimeEnd: '2026-11-03' })).total).toBe(0)
    expect((await sourceIssueApi.paged({ ...query, state: 1 })).total).toBe(1)
  })

  it('处理一条不影响同批其他源，重复处理保留第一次处理人和时间', async () => {
    const { sourceIssueApi } = await import('./sourceIssues')
    const [first, second] = await sourceIssueApi.create({ sourceIds, description: '同一问题' })
    const handled = await sourceIssueApi.handle(first!.id)
    vi.setSystemTime(new Date('2026-11-04T10:00:00'))
    expect(await sourceIssueApi.handle(first!.id)).toEqual(handled)
    expect(handled.handledBy).toBe('admin')
    expect(handled.handleTime).toBeTruthy()
    expect((await sourceIssueApi.detail(second!.id)).state).toBe(0)
  })

  it('空描述或无效源不产生部分登记，读取结果不允许反向修改台账', async () => {
    const { sourceIssueApi } = await import('./sourceIssues')
    const before = await sourceIssueApi.paged(query)
    await expect(sourceIssueApi.create({ sourceIds, description: '  ' })).rejects.toThrow('请填写问题描述')
    await expect(sourceIssueApi.create({ sourceIds: [...sourceIds, ''], description: '问题' })).rejects.toThrow('有效的源')
    expect((await sourceIssueApi.paged(query)).total).toBe(before.total)
    const [created] = await sourceIssueApi.create({ sourceIds, description: '原描述' })
    created!.description = '不能写回'
    expect((await sourceIssueApi.detail(created!.id)).description).toBe('原描述')
  })
})
