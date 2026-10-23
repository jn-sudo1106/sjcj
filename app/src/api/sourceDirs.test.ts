import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.fn()
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>()
  return { ...actual, request: (...args: unknown[]) => requestMock(...args) }
})

import { sourceApi, workflowBindingApi, type SourceCategory } from './index'
import {
  addSourcesToBizDir, bizMembership, bizScopeSourceIds, dirKindOf, expandDirIds, loadDirChildren,
  importFromTemplateToBizDir, moveSourcesInBiz, removeSourcesFromBizDirs, resetSourceDirCache, searchDirs,
} from './sourceDirs'
import type { Source, SourceFlowsView } from './types'
import { describeFilters } from '@/views/FlowCanvas/result/useSourceLaunch'

const cat = (id: string, name: string, parentId = ''): SourceCategory => ({ id, name, ...(parentId ? { parentId } : {}) })
const TREE: Record<string, SourceCategory[]> = {
  root: [cat('9008953', '海外社媒'), cat('-1', '视图目录'), cat('-2', '业务分类'), cat('9009005', '财经资讯')],
  '-2': [cat('9011494', '股票数据', '-2'), cat('9011515', '宏观数据', '-2')],
  '9011494': [cat('9011495', '基本资料', '9011494'), cat('9011496', '股票行情', '9011494')],
  '9011515': [],
  '9011495': [],
  '9011496': [],
}
const DIR_SOURCES: Record<string, string[]> = { '9011494': [], '9011495': ['1'], '9011496': ['1', '2', '3'], '9011515': ['3', '4'] }

beforeEach(() => {
  resetSourceDirCache()
  requestMock.mockReset()
  vi.spyOn(sourceApi, 'sourceCategories').mockImplementation(async (parentId?: string) => TREE[parentId ?? 'root'] ?? [])
  requestMock.mockImplementation(async (endpoint: string, body: Record<string, unknown>) => {
    if (endpoint === 'category/listSources') return { sourceIds: DIR_SOURCES[String(body.categoryId)] ?? [], sourceGroupIds: [] }
    if (endpoint === 'category/addSources') return 2
    return null
  })
})
afterEach(() => vi.restoreAllMocks())

describe('sourceDirs · 目录树', () => {
  it('系统目录根层排除 -1「视图目录」和 -2「业务分类」', async () => {
    expect((await loadDirChildren('sys')).map((n) => n.id)).toEqual(['9008953', '9009005'])
  })

  it('业务目录根层取 -2 的子级，根节点的 parentId 记为空', async () => {
    const roots = await loadDirChildren('biz')
    expect(sourceApi.sourceCategories).toHaveBeenCalledWith('-2')
    expect(roots.map((n) => [n.id, n.parentId])).toEqual([['9011494', ''], ['9011515', '']])
  })

  it('展开子级：目录连同全部子孙，同一层只拉一次', async () => {
    await loadDirChildren('biz')
    expect((await expandDirIds('biz', ['9011494'])).sort()).toEqual(['9011494', '9011495', '9011496'])
    await expandDirIds('biz', ['9011494'])
    expect(vi.mocked(sourceApi.sourceCategories).mock.calls.filter(([p]) => p === '9011494')).toHaveLength(1)
  })

  it('搜索结果按目录归属分流：-2 链上的是业务目录，-1 链上的视图目录排除', async () => {
    vi.spyOn(sourceApi, 'searchCategories').mockResolvedValue([
      { id: '9008798', name: '股票', parentId: '', path: 'null0,' },
      // 186 上一级业务分类的 path 是坏的（0,9011493），靠 parentId=-2 认出来
      { id: '9011494', name: '股票数据', parentId: '-2', path: '0,9011493' },
      { id: '9011496', name: '股票行情', parentId: '9011494', path: '0,-2,9011494' },
      { id: '9009401', name: '股票关注', parentId: '-1', path: '0,-1,' },
      { id: '-2', name: '业务分类', parentId: '', path: '0,' },
    ])
    expect((await searchDirs('biz', '股票')).map((n) => n.id)).toEqual(['9011494', '9011496'])
    expect((await searchDirs('sys', '股票')).map((n) => n.id)).toEqual(['9008798'])
    expect(dirKindOf({ id: '9009401', parentId: '-1', path: '0,-1,' })).toBe('view')
  })
})

describe('sourceDirs · 业务目录里的源', () => {
  it('多个目录取并集，同一目录只请求一次', async () => {
    expect((await bizScopeSourceIds(['9011495', '9011496', '9011515'])).sort()).toEqual(['1', '2', '3', '4'])
    await bizScopeSourceIds(['9011496'])
    expect(requestMock.mock.calls.filter(([, body]) => body.categoryId === '9011496')).toHaveLength(1)
  })

  it('源 → 所在业务目录：一个源可以在多个目录里', async () => {
    const map = await bizMembership()
    expect(map.get('1')?.sort()).toEqual(['9011495', '9011496'])
    expect(map.get('4')).toEqual(['9011515'])
  })

  it('加入：POST 数字 ID，返回新增数，并让该目录的源缓存失效', async () => {
    await bizScopeSourceIds(['9011515'])
    expect(await addSourcesToBizDir('9011515', ['7', '8'])).toBe(2)
    expect(requestMock).toHaveBeenCalledWith('category/addSources', expect.anything(), expect.objectContaining({
      method: 'POST', httpParams: { categoryId: 9011515, sourceIds: [7, 8], sourceGroupIds: [] },
    }))
    await bizScopeSourceIds(['9011515'])
    expect(requestMock.mock.calls.filter(([ep, body]) => ep === 'category/listSources' && body.categoryId === '9011515')).toHaveLength(2)
  })

  it('移出：只对真有这些源的目录发 delSources，只带该目录里有的源', async () => {
    await removeSourcesFromBizDirs(['9011495', '9011496', '9011515'], ['2', '4', '9'])
    const dels = requestMock.mock.calls.filter(([ep]) => ep === 'category/delSources').map(([, , opt]) => opt.httpParams)
    expect(dels).toEqual([
      { categoryId: 9011496, sourceIds: [2], sourceGroupIds: [] },
      { categoryId: 9011515, sourceIds: [4], sourceGroupIds: [] },
    ])
  })
})

describe('describeFilters · 目录范围', () => {
  it('带目录说明；源 ID 超过 10 个只写个数', () => {
    const ids = Array.from({ length: 12 }, (_, i) => String(i)).join(',')
    expect(describeFilters({ dirLabel: '业务目录：股票数据（含子级）', sourceIds: ids })).toBe('业务目录：股票数据（含子级），源 ID 12 个')
    expect(describeFilters({ sourceIds: '1,2' })).toBe('源 ID 1,2')
  })
})

describe('sourceDirs · 移动（10-21）', () => {
  const calls = () => requestMock.mock.calls.filter(([ep]) => ep !== 'category/listSources').map(([ep, , opt]) => [ep, opt.httpParams.categoryId, opt.httpParams.sourceIds])

  it('先加入目标、再从原目录（只限包含该源的目录）移出', async () => {
    await moveSourcesInBiz(['9011494', '9011495', '9011496'], '9011515', ['1', '2'])
    expect(calls()).toEqual([
      ['category/addSources', 9011515, [1, 2]],
      ['category/delSources', 9011495, [1]],
      ['category/delSources', 9011496, [1, 2]],
    ])
  })

  it('不选目标 = 仅移出；目标就在原目录里时不从目标移出', async () => {
    await moveSourcesInBiz(['9011496'], null, ['3'])
    expect(calls()).toEqual([['category/delSources', 9011496, [3]]])
    requestMock.mockClear()
    await moveSourcesInBiz(['9011496', '9011515'], '9011515', ['3'])
    expect(calls()).toEqual([['category/addSources', 9011515, [3]], ['category/delSources', 9011496, [3]]])
  })

  it('加入失败就不移出（step=add）；移出失败标 step=remove', async () => {
    requestMock.mockImplementation(async (ep: string, body: Record<string, unknown>) => {
      if (ep === 'category/listSources') return { sourceIds: DIR_SOURCES[String(body.categoryId)] ?? [] }
      throw new Error(ep === 'category/addSources' ? '加入挂了' : '移出挂了')
    })
    await expect(moveSourcesInBiz(['9011496'], '9011515', ['1'])).rejects.toMatchObject({ step: 'add', message: '加入挂了' })
    expect(requestMock.mock.calls.some(([ep]) => ep === 'category/delSources')).toBe(false)
    await expect(moveSourcesInBiz(['9011496'], null, ['1'])).rejects.toMatchObject({ step: 'remove', message: '移出挂了' })
  })
})

describe('sourceDirs · 按模板批量新增（10-22）', () => {
  const tpl = { sourceId: '100', name: '模板', url: 'https://tpl', siteId: '7' } as Source
  const flows = (own: string[], def?: string): SourceFlowsView => ({ flowIds: own, defaultFlowId: def, bindings: [], ownFlowIds: own, ownDefaultFlowId: def, ownBindings: [] })
  let nextId = 200

  beforeEach(() => {
    nextId = 200
    vi.spyOn(sourceApi, 'copySourceAndLocate').mockImplementation(async (input) => ({ ok: true as const, sourceId: String(nextId++), name: input.name }))
    vi.spyOn(sourceApi, 'sourceDetail').mockImplementation(async (id: string) => ({ sourceId: id, siteId: '7' }) as Source)
    vi.spyOn(sourceApi, 'changeSite').mockResolvedValue({ ok: true })
    vi.spyOn(workflowBindingApi, 'view').mockResolvedValue(flows(['1', '2'], '1'))
    vi.spyOn(workflowBindingApi, 'save').mockResolvedValue()
  })

  it('每行按模板复用配置复制（flag=0），URL 省略沿用模板；空名跳过；新源统一加入目录', async () => {
    const r = await importFromTemplateToBizDir(tpl, 'A;https://a;x=1\n\n;https://b\nB', '9011515')
    expect(vi.mocked(sourceApi.copySourceAndLocate).mock.calls.map(([i]) => [i.name, i.url, i.flag])).toEqual([
      ['A', 'https://a;x=1', 0],
      ['B', 'https://tpl', 0],
    ])
    expect(r).toEqual({ added: ['200', '201'], skipped: 1, failed: [], partial: [] })
    expect(requestMock.mock.calls.filter(([ep]) => ep === 'category/addSources').map(([, , o]) => o.httpParams)).toEqual([
      { categoryId: 9011515, sourceIds: [200, 201], sourceGroupIds: [] },
    ])
  })

  it('网站和流程已随复制带过来就不再写；不一致才补', async () => {
    await importFromTemplateToBizDir(tpl, 'A', '9011515')
    expect(sourceApi.changeSite).not.toHaveBeenCalled()
    expect(workflowBindingApi.save).not.toHaveBeenCalled()

    vi.mocked(sourceApi.sourceDetail).mockResolvedValue({ sourceId: '201', siteId: '' } as Source)
    vi.mocked(workflowBindingApi.view).mockImplementation(async (id: string) => (id === '100' ? flows(['1', '2'], '1') : flows(['1'], '1')))
    await importFromTemplateToBizDir(tpl, 'B', '9011515')
    expect(sourceApi.changeSite).toHaveBeenCalledWith(['201'], '7')
    const change = vi.mocked(workflowBindingApi.save).mock.calls[0]
    expect(change[0]).toBe('201')
    expect(change[1](flows([]))).toEqual({ flowIds: ['1', '2'], defaultFlowId: '1' })
  })

  it('某行复制失败不影响其他行；建出来但后续失败的记进 partial', async () => {
    vi.mocked(sourceApi.copySourceAndLocate)
      .mockResolvedValueOnce({ ok: false as const, message: '名称重复' })
      .mockResolvedValueOnce({ ok: true as const, sourceId: '300', name: 'B' })
    vi.mocked(sourceApi.sourceDetail).mockResolvedValue({ sourceId: '300', siteId: '9' } as Source)
    vi.mocked(sourceApi.changeSite).mockResolvedValue({ ok: false, message: 'x' })
    const r = await importFromTemplateToBizDir(tpl, 'A\nB', '9011515')
    expect(r.failed).toEqual(['A（名称重复）'])
    expect(r.added).toEqual(['300'])
    expect(r.partial).toEqual(['#300 B（归入网站失败）'])
  })
})
