// @vitest-environment jsdom
// 「我的视图」存取（2026-10-12）：本机兜底实现 + 真实接口（开发环境联调口径）+ 接口不存在时自动退回本机 + 导入本机视图。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn())
vi.mock('./client', () => ({ request: requestMock }))

import {
  SOURCE_VIEW_LIMIT,
  isEndpointMissing,
  localSourceViewApi,
  setSourceViewBackend,
  sourceViewApi,
  sourceViewBackend,
  sourceViewStorageKey,
  stateFromJson,
  stateToJson,
} from './sourceViews'
import { blankSourceListViewState, emptyManualViewState } from '@/views/FlowCanvas/result/sourceListViewState'

const state = (status: 'all' | 'E' = 'all') => ({ ...blankSourceListViewState(), status })

beforeEach(() => {
  localStorage.clear()
  requestMock.mockReset()
  setSourceViewBackend(null)
})
afterEach(() => setSourceViewBackend(null))

describe('本机实现（接口没上线时的兜底，校验口径同后端）', () => {
  it('按用户隔离：A 建的视图 B 看不到', async () => {
    await localSourceViewApi.add('1', { viewName: '广发 · 失败', state: state('E') })
    expect((await localSourceViewApi.list('1')).map((v) => v.viewName)).toEqual(['广发 · 失败'])
    expect(await localSourceViewApi.list('2')).toEqual([])
    expect(localStorage.getItem(sourceViewStorageKey('1'))).toContain('广发 · 失败')
  })

  it('名称 1–40 字、同一用户不重名（提示语同后端）；重命名可以保持原名', async () => {
    const v = await localSourceViewApi.add('1', { viewName: '  视图A  ', state: state() })
    expect(v.viewName).toBe('视图A')
    await expect(localSourceViewApi.add('1', { viewName: '视图A', state: state() })).rejects.toThrow('视图名称已存在，请更换名称')
    await expect(localSourceViewApi.add('1', { viewName: ' ', state: state() })).rejects.toThrow('视图名称为1到40个字符')
    await expect(localSourceViewApi.add('1', { viewName: 'x'.repeat(41), state: state() })).rejects.toThrow('视图名称为1到40个字符')
    await expect(localSourceViewApi.update('1', { viewId: v.viewId, revision: v.revision, viewName: '视图A' })).resolves.toMatchObject({ viewName: '视图A' })
  })

  it('revision 从 0 起，保存 +1；拿旧 revision 再写报「视图已变化」', async () => {
    const v = await localSourceViewApi.add('1', { viewName: 'A', state: state() })
    expect(v.revision).toBe(0)
    const saved = await localSourceViewApi.update('1', { viewId: v.viewId, revision: 0, state: state('E') })
    expect(saved.revision).toBe(1)
    expect(saved.state.status).toBe('E')
    await expect(localSourceViewApi.update('1', { viewId: v.viewId, revision: 0, viewName: 'B' })).rejects.toThrow('视图已变化，请刷新后重试')
  })

  it('默认进入只能有一个；删除；每人上限 50 个；没有账号不能写', async () => {
    const a = await localSourceViewApi.add('1', { viewName: 'A', state: state(), isDefault: true })
    const b = await localSourceViewApi.add('1', { viewName: 'B', state: state() })
    await localSourceViewApi.update('1', { viewId: b.viewId, revision: b.revision, isDefault: true })
    const list = await localSourceViewApi.list('1')
    expect(list.filter((v) => v.isDefault).map((v) => v.viewId)).toEqual([b.viewId])
    await localSourceViewApi.remove('1', { viewId: a.viewId, revision: a.revision })
    expect((await localSourceViewApi.list('1')).map((v) => v.viewName)).toEqual(['B'])
    for (let i = 0; i < SOURCE_VIEW_LIMIT; i++) await localSourceViewApi.add('1', { viewName: `V${i}`, state: state() }).catch(() => undefined)
    await expect(localSourceViewApi.add('1', { viewName: '多一个', state: state() })).rejects.toThrow('最多 50 个')
    await expect(localSourceViewApi.add('', { viewName: 'A', state: state() })).rejects.toThrow('当前账号')
  })
})

describe('状态 ↔ 后端两段 JSON', () => {
  it('条件 + 手选清单进 queryJson，显示设置进 displayJson，都是字符串；往返不丢', () => {
    const s = { ...emptyManualViewState(), status: 'E' as const, scopeIds: ['10', '20'], hiddenColumns: ['url'], sortField: 'DATA_CNT', sortDirection: 'desc' as const, pageSize: 50 }
    const { queryJson, displayJson } = stateToJson(s)
    expect(typeof queryJson).toBe('string')
    expect(typeof displayJson).toBe('string')
    expect(JSON.parse(queryJson)).toMatchObject({ v: 1, status: 'E', scopeIds: ['10', '20'] })
    expect(JSON.parse(queryJson)).not.toHaveProperty('hiddenColumns')
    expect(JSON.parse(displayJson)).toEqual({ hiddenColumns: ['url'], sortField: 'DATA_CNT', sortDirection: 'desc', pageSize: 50 })
    expect(stateFromJson(queryJson, displayJson)).toEqual(s)
  })

  it('后端存的 JSON 坏了 / 缺字段：用空白状态兜底，不抛', () => {
    expect(stateFromJson('不是 JSON', null)).toEqual(blankSourceListViewState())
    expect(stateFromJson('{"status":"E"}', '{}').status).toBe('E')
  })
})

const row = (over: Record<string, unknown> = {}) => ({
  viewId: '1', userId: 156, viewName: '联调', ...stateToJson({ ...emptyManualViewState(), scopeIds: ['1'] }), sortNo: 0, isDefault: 0, revision: 0, isDelete: 0, createDt: '2026-10-12 16:45:51', updateDt: '2026-10-12 16:45:51', ...over,
})

describe('真实接口（开发环境联调口径）', () => {
  it('list：第一次调用探测成功后用真实接口；视图转成前端状态，viewId 是字符串，revision 从 0', async () => {
    requestMock.mockResolvedValueOnce([row(), row({ viewId: '3', viewName: 'B', isDefault: 1, revision: 2 })])
    const views = await sourceViewApi.list('7')
    expect(sourceViewBackend()).toBe('remote')
    expect(requestMock).toHaveBeenCalledWith('source-view/list', {}, expect.objectContaining({ method: 'GET', httpEndpoint: 'source-view/list', mode: 'http' }))
    expect(views.map((v) => [v.viewId, v.viewName, v.isDefault, v.revision])).toEqual([['1', '联调', false, 0], ['3', 'B', true, 2]])
    expect(views[0].state.scopeIds).toEqual(['1'])
  })

  it('add / update / delete：queryJson、displayJson 传字符串，userId 不传，isDefault 传 0 / 1，update 只带改了的字段', async () => {
    requestMock.mockResolvedValueOnce([])
    await sourceViewApi.list('7')
    requestMock.mockResolvedValueOnce(row({ viewName: '新' }))
    const created = await sourceViewApi.add('7', { viewName: ' 新 ', state: emptyManualViewState(), isDefault: true })
    const addBody = requestMock.mock.calls[1][2].httpParams
    expect(addBody).toMatchObject({ viewName: '新', isDefault: 1 })
    expect(typeof addBody.queryJson).toBe('string')
    expect(typeof addBody.displayJson).toBe('string')
    expect(addBody).not.toHaveProperty('userId')
    expect(created.viewName).toBe('新')

    requestMock.mockResolvedValueOnce(row({ viewName: '改', revision: 1 }))
    await sourceViewApi.update('7', { viewId: '1', revision: 0, viewName: '改' })
    expect(requestMock.mock.calls[2][2].httpParams).toEqual({ viewId: '1', revision: 0, viewName: '改' })

    requestMock.mockResolvedValueOnce(row({ isDefault: 1, revision: 2 }))
    await sourceViewApi.update('7', { viewId: '1', revision: 1, isDefault: true })
    expect(requestMock.mock.calls[3][2].httpParams).toEqual({ viewId: '1', revision: 1, isDefault: 1 })

    requestMock.mockResolvedValueOnce(null)
    await sourceViewApi.remove('7', { viewId: '1', revision: 2 })
    expect(requestMock).toHaveBeenLastCalledWith('source-view/delete', { viewId: '1', revision: 2 }, expect.objectContaining({ httpEndpoint: 'source-view/delete', mode: 'http' }))
  })

  it('后端的业务报错只留原因（去掉「请求异常 […]」前缀），页面提示更干净', async () => {
    requestMock.mockResolvedValueOnce([])
    await sourceViewApi.list('7')
    requestMock.mockRejectedValueOnce(new Error('请求异常 [source-view/add]: 请求失败 500: 错误信息:运行时异常：视图名称已存在，请更换名称'))
    await expect(sourceViewApi.add('7', { viewName: 'A', state: state() })).rejects.toThrow(/^视图名称已存在，请更换名称$/)
  })
})

describe('接口没上线时自动退回本机', () => {
  const missing = () => Object.assign(new Error('请求异常 [source-view/list]: 请求失败 500'), { cause: { status: 500 } })

  it('217 实测：list 回 HTTP 500 且没有任何业务说明 → 退回本机，页面照常能存能读，且不再反复探测', async () => {
    requestMock.mockRejectedValue(missing())
    expect(await sourceViewApi.list('7')).toEqual([])
    expect(sourceViewBackend()).toBe('local')
    const v = await sourceViewApi.add('7', { viewName: 'A', state: state() })
    expect((await sourceViewApi.list('7')).map((x) => x.viewId)).toEqual([v.viewId])
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it('只在「接口不存在」时退回：404 / 405 / 500 空 body 算；业务报错、网关 502、网络错误照常抛出，不悄悄写本机', async () => {
    expect(isEndpointMissing(Object.assign(new Error('请求失败 404'), { cause: { status: 404 } }))).toBe(true)
    expect(isEndpointMissing(missing())).toBe(true)
    expect(isEndpointMissing(Object.assign(new Error('请求异常 [x]: 请求失败 500: 视图已变化'), { cause: { status: 500 } }))).toBe(false)
    expect(isEndpointMissing(Object.assign(new Error('后端服务暂时不可用'), { cause: { status: 502 } }))).toBe(false)
    expect(isEndpointMissing(new Error('Failed to fetch'))).toBe(false)

    requestMock.mockRejectedValueOnce(Object.assign(new Error('后端服务暂时不可用，请稍后重试（502 source-view/list）'), { cause: { status: 502 } }))
    await expect(sourceViewApi.list('7')).rejects.toThrow('后端服务暂时不可用')
    expect(sourceViewBackend()).toBeNull()
  })
})

describe('接口上线后导入本机视图', () => {
  it('逐个 add，重名的加（本机）后缀；全部成功才清掉本机数据', async () => {
    await localSourceViewApi.add('7', { viewName: '广发重点', state: { ...emptyManualViewState(), scopeIds: ['1'] } })
    await localSourceViewApi.add('7', { viewName: '失败源', state: state('E') })
    requestMock.mockResolvedValueOnce([row({ viewName: '广发重点' })]) // 探测
    await sourceViewApi.list('7')
    requestMock.mockResolvedValueOnce([row({ viewName: '广发重点' })]) // 导入前取现有名称
    requestMock.mockResolvedValue(row())
    const result = await sourceViewApi.importLocal('7')
    expect(result).toEqual({ imported: 2, failed: [] })
    const names = requestMock.mock.calls.filter(([e]) => e === 'source-view/add').map(([, , o]) => o.httpParams.viewName)
    expect(names).toEqual(['广发重点（本机）', '失败源'])
    expect(localStorage.getItem(sourceViewStorageKey('7'))).toBeNull()
  })

  it('中途失败：保留没导入成功的，下次还能再导', async () => {
    await localSourceViewApi.add('7', { viewName: 'A', state: state() })
    await localSourceViewApi.add('7', { viewName: 'B', state: state() })
    requestMock.mockResolvedValueOnce([])
    await sourceViewApi.list('7')
    requestMock.mockResolvedValueOnce([])
    requestMock.mockResolvedValueOnce(row({ viewName: 'A' }))
    requestMock.mockRejectedValueOnce(new Error('请求异常 [source-view/add]: 请求失败 500: 每人最多 50 个视图'))
    const result = await sourceViewApi.importLocal('7')
    expect(result.imported).toBe(1)
    expect(result.failed).toEqual(['B：每人最多 50 个视图'])
    expect(sourceViewApi.localViews('7').map((v) => v.viewName)).toEqual(['B'])
  })

  it('接口还没上线时不能导入', async () => {
    setSourceViewBackend('local')
    await expect(sourceViewApi.importLocal('7')).rejects.toThrow('接口还没上线')
  })
})
