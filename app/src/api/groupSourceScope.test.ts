// 组级源数据权限读写适配层的单测：钉住「前端只传点选结果、展开与落库交给后端」的契约形状。
// 后端口径见 SysGroupResService.saveSourceScope（SOURCE/STRUCT 整目录 + SOURCE/ID 单源，一个事务）。
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./client', () => ({ request: vi.fn() }))

import { request } from './client'
import {
  getGroupSourceScope,
  listCategorySources,
  listScopeCategories,
  minimizeDirIds,
  saveGroupSourceScope,
  type GroupSourceScope,
} from './groupSourceScope'

const called = () => vi.mocked(request).mock.calls
const scope = (over: Partial<GroupSourceScope> = {}): GroupSourceScope => ({
  accept: { dirIds: [], sourceIds: [] }, reject: { dirIds: [], sourceIds: [] }, ...over,
})

beforeEach(() => {
  vi.mocked(request).mockReset()
})

describe('getGroupSourceScope', () => {
  it('按 groupId 读 source-scope，并把后端可能缺失的 accept/reject 归一成两个 Grant', async () => {
    vi.mocked(request).mockResolvedValue({
      accept: { dirIds: ['9009250', '9009250'], sourceIds: ['430001300', ''] },
    })
    const s = await getGroupSourceScope(100001)
    expect(called()[0]).toEqual(['group-res/source-scope', { groupId: 100001 }, { method: 'GET' }])
    expect(s.accept).toEqual({ dirIds: ['9009250'], sourceIds: ['430001300'] })
    expect(s.reject).toEqual({ dirIds: [], sourceIds: [] })
  })

  it('后端整体为空时回两个空 Grant，不让调用方判空', async () => {
    vi.mocked(request).mockResolvedValue(null)
    const s = await getGroupSourceScope(100001)
    expect(s).toEqual({ accept: { dirIds: [], sourceIds: [] }, reject: { dirIds: [], sourceIds: [] } })
  })
})

describe('saveGroupSourceScope', () => {
  it('一次 modify-source-scope：前端只传点选结果，不再自己展开目录或逐条 add/modify', async () => {
    vi.mocked(request).mockResolvedValue({ groupId: 100001 })
    await saveGroupSourceScope(100001, scope({
      accept: { dirIds: ['d1'], sourceIds: ['501', '501', '502'] },
      reject: { dirIds: [], sourceIds: ['900'] },
    }))
    expect(called()).toHaveLength(1)
    expect(called()[0]).toEqual([
      'group-res/modify-source-scope',
      { groupId: 100001, accept: { dirIds: ['d1'], sourceIds: ['501', '502'] }, reject: { dirIds: [], sourceIds: ['900'] } },
      { method: 'POST' },
    ])
  })
})

describe('listScopeCategories', () => {
  it('把后端扁平节点归一成字符串 ID，parentId 为 0/空都当根', async () => {
    vi.mocked(request).mockResolvedValue([
      { id: 9009005, name: '财经', parentId: 0, level: 1, directCount: 3, subtreeCount: 10, hasChildren: true },
      { id: 9009253, name: '公司', parentId: 9009005, level: 2, directCount: 7, subtreeCount: 7 },
    ])
    const rows = await listScopeCategories()
    expect(called()[0]).toEqual(['category/scopeTree', undefined, { method: 'GET' }])
    expect(rows[0]).toMatchObject({ id: '9009005', parentId: null, directCount: 3, subtreeCount: 10, hasChildren: true })
    expect(rows[1]).toMatchObject({ id: '9009253', parentId: '9009005', hasChildren: false })
  })
})

describe('listCategorySources', () => {
  it('按目录取源：透传 allSub/keyword/limit，并把 sourceId/sourceName 归一成 {id,name}', async () => {
    vi.mocked(request).mockResolvedValue({
      total: 2,
      list: [{ sourceId: 430001300, sourceName: '中国网财经' }, { sourceId: 430001301, sourceName: '新浪财经' }],
    })
    const res = await listCategorySources('9009253', { allSub: true, keyword: ' 财经 ', limit: 500 })
    expect(called()[0]).toEqual([
      'source/categorySources',
      { categoryId: '9009253', allSub: true, keyword: '财经', limit: 500 },
      { method: 'GET' },
    ])
    expect(res.list).toEqual([{ id: '430001300', name: '中国网财经' }, { id: '430001301', name: '新浪财经' }])
    expect(res.total).toBe(2)
  })

  it('空 keyword 不发参数；后端没返回 list 时回空数组而不是抛错', async () => {
    vi.mocked(request).mockResolvedValue({ total: 0 })
    const res = await listCategorySources('9009253', { keyword: '   ' })
    expect(called()[0]?.[1]).toMatchObject({ keyword: undefined, allSub: false, limit: 500 })
    expect(res).toEqual({ total: 0, list: [] })
  })
})

describe('minimizeDirIds', () => {
  it('祖先也在集合里时丢掉子目录，只留用户点选的层级', () => {
    const parentOf: Record<string, string | null> = { d1: null, d1a: 'd1', d1a1: 'd1a', d2: null }
    expect(minimizeDirIds(['d1', 'd1a', 'd1a1', 'd2'], parentOf)).toEqual(['d1', 'd2'])
  })

  it('父链不在树里（目录权限过滤掉了）时保留自身，不会把已选目录吞掉', () => {
    expect(minimizeDirIds(['d1a1'], { d1a1: 'd1a' })).toEqual(['d1a1'])
  })
})
