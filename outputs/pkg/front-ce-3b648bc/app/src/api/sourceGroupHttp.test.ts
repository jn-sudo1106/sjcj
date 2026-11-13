// @vitest-environment jsdom
// 来源组（source-group/*）HTTP 契约（1008-02 API 层）。
// 验收四点：ID 转字符串；changeMembers 的 target/expected 为 null 时 JSON 显式写 null；
//           expected 快照取默认行（停用也回传）；停用行不进编辑初值。
// 与 leo 的本地「我的分组」（stores/sourceGroups.ts）无关，那是个人目录。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response
}

const ok = (data: unknown) => jsonResponse({ success: true, code: '0', msg: '操作成功', data })
const fail = (msg: string) => jsonResponse({ success: false, code: '-1', msg, data: null })

describe('source-group 来源组 HTTP 契约（1008-02）', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.stubEnv('VITE_API_BASE', '')
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  async function load() {
    return import('./index')
  }
  const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: new URL(String(url), 'http://local.test'), init: init as RequestInit }))

  it('list：返回行的 ID 一律转字符串，isDefault/state 归一，flowIds 展开成字符串数组', async () => {
    fetchMock.mockResolvedValue(ok([
      { sourceGroupId: 3, sourceGroupCode: 'twitter1', sourceGroupName: 'twitter1', description: null, state: 'ACTIVE', authGroupId: null, defaultFlowId: '21000006', flowIds: [21000005, 21000006], revision: 2 },
      { sourceGroupId: 1, sourceGroupCode: 'test1', sourceGroupName: '测试组1', state: 'DISABLED', defaultFlowId: null, flowIds: [], revision: 1 },
    ]))
    const { sourceGroupApi } = await load()
    const rows = await sourceGroupApi.list()
    expect(rows.map((r) => [r.sourceGroupId, r.sourceGroupCode, r.flowIds, r.defaultFlowId, r.state, r.revision])).toEqual([
      ['3', 'twitter1', ['21000005', '21000006'], '21000006', 'ACTIVE', 2],
      ['1', 'test1', [], undefined, 'DISABLED', 1],
    ])
    const [first] = calls()
    expect(first.url.pathname).toBe('/api/v1/source-group/list')
    expect(first.init.method).toBe('GET')
  })

  it('members：sourceId 数字转字符串；limit+1 条判下一页，超出时截断', async () => {
    fetchMock.mockResolvedValue(ok([
      { sourceId: 391000500, sourceName: 'twitter-Demis Hassabis', sourceGroupId: '3', defaultFlowId: '21000006' },
      { sourceId: 391000501, sourceName: 'twitter-2', sourceGroupId: '3', defaultFlowId: '21000006' },
    ]))
    const { sourceGroupApi } = await load()
    const page = await sourceGroupApi.members('3', 0, 1)
    expect(page.rows.map((r) => [r.sourceId, r.sourceName])).toEqual([
      ['391000500', 'twitter-Demis Hassabis'],
    ])
    expect(page.hasMore).toBe(true)
    const [first] = calls()
    expect(first.url.searchParams.get('sourceGroupId')).toBe('3')
    expect(first.url.searchParams.get('offset')).toBe('0')
    // 前端请求 limit+1 = 2 条，用多出来的那条判断是否有下一页
    expect(first.url.searchParams.get('limit')).toBe('2')
  })

  it('members：不满 limit+1 条说明没有下一页', async () => {
    fetchMock.mockResolvedValue(ok([{ sourceId: 1, sourceName: 'a' }]))
    const { sourceGroupApi } = await load()
    const page = await sourceGroupApi.members('3', 0, 5)
    expect(page.hasMore).toBe(false)
    expect(page.rows.map((r) => r.sourceId)).toEqual(['1'])
  })

  it('changeMembers：sourceGroupId/expectedSourceGroupId 为 null 时 JSON 必须显式写 null（退组 / 不改组时传 null）', async () => {
    fetchMock.mockResolvedValue(ok(null))
    const { sourceGroupApi } = await load()
    await sourceGroupApi.changeMembers({ sourceIds: ['430024667', '430024668'], sourceGroupId: null, expectedSourceGroupId: '3' })
    const [post] = calls()
    expect(post.init.method).toBe('POST')
    expect(JSON.parse(String(post.init.body))).toEqual({
      sourceIds: [430024667, 430024668],
      sourceGroupId: null,
      expectedSourceGroupId: '3',
    })
  })

  it('changeMembers：sourceGroupId=-1 表示退组，expectedSourceGroupId 填当前组 ID', async () => {
    fetchMock.mockResolvedValue(ok(null))
    const { sourceGroupApi } = await load()
    await sourceGroupApi.changeMembers({ sourceIds: ['430024667'], sourceGroupId: '-1', expectedSourceGroupId: '3' })
    expect(JSON.parse(String(calls()[0].init.body))).toEqual({ sourceIds: [430024667], sourceGroupId: '-1', expectedSourceGroupId: '3' })
  })

  it('changeMembersByRange：参数全放 query，targetSourceGroupId=-1 退组；返回统计数字', async () => {
    fetchMock.mockResolvedValue(ok({ total: 22, joined: 22, moved: 0, left: 0, unchanged: 0 }))
    const { sourceGroupApi } = await load()
    const result = await sourceGroupApi.changeMembersByRange({ targetSourceGroupId: '-1', filter: { sourceGroupId: '1' } })
    expect(result).toEqual({ total: 22, joined: 22, moved: 0, left: 0, unchanged: 0 })
    const [post] = calls()
    expect(post.url.pathname).toBe('/api/v1/source-group/changeMembersByRange')
    expect(post.url.searchParams.get('targetSourceGroupId')).toBe('-1')
    expect(post.url.searchParams.get('sourceGroupId')).toBe('1')
    // 参数在 query → body 不应携带
    expect(post.init.body).toBeUndefined()
  })

  it('changeMembersByRange：页面筛选条件按 sourcePaged 同口径转参数（源 ID 走 ids），不带分页 / 排序 / 空数组', async () => {
    fetchMock.mockResolvedValue(ok({ total: 2, joined: 2, moved: 0, left: 0, unchanged: 0 }))
    const { sourceGroupApi } = await load()
    await sourceGroupApi.changeMembersByRange({
      targetSourceGroupId: '3',
      filter: { sourceIds: '430024431,430024432', state: 'C', tags: [], siteIds: [], field: 'DATA_CNT', sorted: -1, type: 'DESC' },
    })
    const params = Object.fromEntries(calls()[0].url.searchParams)
    expect(params).toEqual({ ids: '430024431,430024432', state: 'C', targetSourceGroupId: '3' })
  })

  it('bindFlows：带 revision 并发快照，flowIds 转数字，defaultFlowId 为 null 时显式写 null', async () => {
    fetchMock.mockResolvedValue(ok(null))
    const { sourceGroupApi } = await load()
    await sourceGroupApi.bindFlows({ sourceGroupId: '3', revision: 2, flowIds: ['21000005', '21000006'], defaultFlowId: '21000006' })
    expect(JSON.parse(String(calls()[0].init.body))).toEqual({
      sourceGroupId: '3', revision: 2, flowIds: [21000005, 21000006], defaultFlowId: 21000006,
    })

    fetchMock.mockReset()
    fetchMock.mockResolvedValue(ok(null))
    await sourceGroupApi.bindFlows({ sourceGroupId: '1', revision: 1, flowIds: [], defaultFlowId: null })
    expect(JSON.parse(String(calls()[0].init.body))).toEqual({
      sourceGroupId: '1', revision: 1, flowIds: [], defaultFlowId: null,
    })
  })

  it('bindings：返回含停用行；id/flowId 转字符串，isDefault 1/0 转布尔', async () => {
    fetchMock.mockResolvedValue(ok([
      { id: 11, sourceId: '430024667', sourceGroupId: null, flowId: '100', isDefault: 1, state: 'ACTIVE', revision: 2 },
      { id: 12, sourceId: '430024667', sourceGroupId: null, flowId: '101', isDefault: 0, state: 'DISABLED', revision: 4 },
    ]))
    const { sourceGroupApi } = await load()
    const rows = await sourceGroupApi.bindings({ sourceId: '430024667' })
    // 停用行也返回（编辑初值过滤是 UI 层的事，快照必须含停用行）
    expect(rows.map((r) => [r.id, r.flowId, r.isDefault, r.state])).toEqual([
      ['11', '100', true, 'ACTIVE'],
      ['12', '101', false, 'DISABLED'],
    ])
    const [first] = calls()
    expect(first.url.searchParams.get('sourceId')).toBe('430024667')
  })

  it('updateBindingState：回传 id/sourceId/sourceGroupId/flowId/revision + state', async () => {
    fetchMock.mockResolvedValue(ok(null))
    const { sourceGroupApi } = await load()
    await sourceGroupApi.updateBindingState(
      { id: '12', sourceId: '430024667', flowId: '101', isDefault: false, state: 'DISABLED', revision: 4 },
      'ACTIVE',
    )
    expect(JSON.parse(String(calls()[0].init.body))).toEqual({
      id: 12, sourceId: 430024667, sourceGroupId: null, flowId: 101, revision: 4, state: 'ACTIVE',
    })
  })

  it('sourceFlowIds：GET sourceIds 逗号串；超过 5000 分片合并', async () => {
    fetchMock.mockResolvedValue(ok(['100', '101']))
    const { sourceGroupApi } = await load()
    expect(await sourceGroupApi.sourceFlowIds(['430024667'])).toEqual(['100', '101'])
    const [first] = calls()
    expect(first.url.searchParams.get('sourceIds')).toBe('430024667')
    expect(first.init.method).toBe('GET')

    // 5001 条 → 两次请求，结果合并
    fetchMock.mockReset()
    const ids = Array.from({ length: 5001 }, (_, i) => String(5000000 + i))
    fetchMock.mockResolvedValueOnce(ok(['100'])).mockResolvedValueOnce(ok(['200']))
    const { sourceGroupApi: sg2 } = await import('./index')
    expect(await sg2.sourceFlowIds(ids)).toEqual(['100', '200'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('add / update / remove：走 POST；update/remove 必须带编辑前 revision', async () => {
    fetchMock.mockResolvedValue(ok(null))
    const { sourceGroupApi } = await load()
    await sourceGroupApi.add({ sourceGroupCode: 'test2', sourceGroupName: '测试组2', description: '新建' })
    expect(JSON.parse(String(calls()[0].init.body))).toEqual({ sourceGroupCode: 'test2', sourceGroupName: '测试组2', description: '新建' })

    fetchMock.mockReset()
    fetchMock.mockResolvedValue(ok(null))
    await sourceGroupApi.update({ sourceGroupId: '1', sourceGroupName: '测试组1改名', revision: 1 })
    expect(JSON.parse(String(calls()[0].init.body))).toEqual({ sourceGroupId: '1', sourceGroupName: '测试组1改名', revision: 1 })

    fetchMock.mockReset()
    fetchMock.mockResolvedValue(ok(null))
    await sourceGroupApi.remove({ sourceGroupId: '1', revision: 1 })
    expect(JSON.parse(String(calls()[0].init.body))).toEqual({ sourceGroupId: '1', revision: 1 })
  })

  it('后端拒绝时保留后端原文，不包一层「操作失败」', async () => {
    fetchMock.mockResolvedValue(fail('来源组不存在或已删除'))
    const { sourceGroupApi } = await load()
    await expect(sourceGroupApi.remove({ sourceGroupId: '9', revision: 1 })).rejects.toThrow('来源组不存在或已删除')
  })

  it('detail：无数据返回 null', async () => {
    fetchMock.mockResolvedValue(ok(null))
    const { sourceGroupApi } = await load()
    expect(await sourceGroupApi.detail('3')).toBeNull()
  })
})
