// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localDate } from '@/utils/format/localDateTime'
import type { SourceIssueQuery } from './sourceIssues'
const loginUsername = vi.hoisted(() => vi.fn(() => 'admin'))
vi.mock('./auth', () => ({ readLoginUsername: loginUsername }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ name: '当前系统账号' }) }))
const query: SourceIssueQuery = { keyword: '', status: 'all', startDate: '', endDate: '', page: 1, size: 20 }
const sources = [{ sourceId: 'a', name: '源甲', siteId: 'site-a' }, { sourceId: 'b', name: '源乙' }]

beforeEach(() => { vi.resetModules(); loginUsername.mockReturnValue('admin'); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-03T09:00:00')) })
afterEach(() => vi.useRealTimers())

describe('源问题前端演示服务', () => {
  it('已有登录会话没有登录名缓存时沿用系统账号', async () => {
    loginUsername.mockReturnValue('')
    const { sourceIssueApi } = await import('./sourceIssues')
    const [created] = await sourceIssueApi.create({ sources, description: '账号核对' })
    expect(created!.createdBy).toBe('当前系统账号')
    expect((await sourceIssueApi.handle(created!.id)).handledBy).toBe('当前系统账号')
  })
  it('批量登记每个源独立记录，自动记录账号和时间，重复源只登记一次', async () => {
    const { sourceIssueApi } = await import('./sourceIssues')
    const created = await sourceIssueApi.create({ sources: [...sources, sources[0]!], description: '  字段缺失  ' })
    expect(created).toHaveLength(2)
    expect(new Set(created.map(row => row.id)).size).toBe(2)
    expect(created.map(row => row.sourceId)).toEqual(['a', 'b'])
    expect(created.every(row => row.description === '字段缺失' && row.status === 'open' && row.createdBy === 'admin')).toBe(true)
    expect(created[0]!.createdAt).toBe(new Date().toISOString())
    expect(created[1]!.createdAt).toBe(created[0]!.createdAt)
  })

  it('状态、关键词和登记日期组合筛选，分页不丢失筛选口径', async () => {
    const { sourceIssueApi } = await import('./sourceIssues')
    await sourceIssueApi.create({ sources, description: '字段缺失' })
    const filtered = { ...query, keyword: '字段缺失', status: 'open' as const, startDate: localDate(), endDate: localDate(), size: 1 }
    const first = await sourceIssueApi.paged(filtered)
    const second = await sourceIssueApi.paged({ ...filtered, page: 2 })
    expect(first.total).toBe(2)
    expect(second.total).toBe(2)
    expect(first.list[0]!.id).not.toBe(second.list[0]!.id)
    expect((await sourceIssueApi.paged({ ...filtered, keyword: '源甲' })).total).toBe(1)
    expect((await sourceIssueApi.paged({ ...filtered, endDate: '2026-11-02' })).total).toBe(0)
  })

  it('处理一条不影响同批其他源，重复处理保留第一次处理人和时间', async () => {
    const { sourceIssueApi } = await import('./sourceIssues')
    const [first, second] = await sourceIssueApi.create({ sources, description: '同一问题' })
    const handled = await sourceIssueApi.handle(first!.id)
    vi.setSystemTime(new Date('2026-11-04T10:00:00'))
    expect(await sourceIssueApi.handle(first!.id)).toEqual(handled)
    expect(handled.handledBy).toBe('admin')
    expect(handled.handledAt).toBeTruthy()
    expect((await sourceIssueApi.detail(second!.id)).status).toBe('open')
  })

  it('空描述或无效源不产生部分登记，读取结果不允许反向修改台账', async () => {
    const { sourceIssueApi } = await import('./sourceIssues')
    const before = await sourceIssueApi.paged(query)
    await expect(sourceIssueApi.create({ sources, description: '  ' })).rejects.toThrow('请填写问题描述')
    await expect(sourceIssueApi.create({ sources: [...sources, { sourceId: '', name: '无效' }], description: '问题' })).rejects.toThrow('有效的源')
    expect((await sourceIssueApi.paged(query)).total).toBe(before.total)
    const [created] = await sourceIssueApi.create({ sources, description: '原描述' })
    created!.description = '不能写回'
    expect((await sourceIssueApi.detail(created!.id)).description).toBe('原描述')
  })
})
