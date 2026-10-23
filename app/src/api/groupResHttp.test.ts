// 组级数据权限（/api/v1/group-res，SysGroupResController）HTTP 契约。
// 响应形状取自《接口文档-组数据权限.md》：只有 list 是 Paged（code 数字），其余 6 条是 RspResult（code 字符串）。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

const RULE = { id: 15, groupId: 100001, action: 'ACCEPT', resType: 'SOURCE', condType: 'SQL', resCond: 'CATEGORY_ID IN (9009387,9009388)', condJson: null, remarks: '研发一组可见的源', isDelete: 0 }

describe('组级数据权限 API HTTP 契约', () => {
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

  it('列表：GET ?groupId&resType&page&limit；Paged 的 code 是数字 0，转成 { list, total }', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 0, msg: '操作成功', count: 2, data: [RULE], exts: null }))
    const { pagedGroupRes } = await import('./groupRes')

    const res = await pagedGroupRes({ groupId: 100001, resType: 'SOURCE', page: 1, limit: 20 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/group-res/list?')
    expect(url).toContain('groupId=100001')
    expect(url).toContain('resType=SOURCE')
    expect(url).toContain('page=1')
    expect(url).toContain('limit=20')
    expect(init.method).toBe('GET')
    expect(res).toEqual({ total: 2, list: [RULE] })
  })

  it('列表不传筛选项时不带 resType / action；groupId ≤90000 时（code 数字 -1）抛出后端原文', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 0, msg: '操作成功', count: 0, data: [], exts: null }))
    const { pagedGroupRes } = await import('./groupRes')
    await pagedGroupRes({ groupId: 100001 })
    expect((fetchMock.mock.calls[0] as [string])[0]).not.toContain('resType')
    expect((fetchMock.mock.calls[0] as [string])[0]).not.toContain('action')

    fetchMock.mockResolvedValueOnce(jsonResponse({ code: -1, msg: 'groupId 必须大于 90000', count: 0, data: [], exts: null }))
    await expect(pagedGroupRes({ groupId: 90000 })).rejects.toThrow('groupId 必须大于 90000')
  })

  it('详情：GET ?id=15；RspResult 的 data 是对象则直接透传', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, code: '0', msg: '操作成功', data: RULE }))
    const { groupResDetail } = await import('./groupRes')
    expect(await groupResDetail(15)).toEqual(RULE)
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/api/v1/group-res/detail?id=15')

    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false, code: '-1', msg: '记录不存在', data: null }))
    await expect(groupResDetail(99)).rejects.toThrow('记录不存在')
  })

  it('元数据：GET 无入参，resType / action / condType 枚举原样返回', async () => {
    const meta = { resTypes: [{ key: 'SOURCE', name: '数据源', baseTable: 'cs_source', idColumn: 'SOURCE_ID', fields: [] }], actions: [{ key: 'ACCEPT', name: '入选' }], condTypes: [{ key: 'ID', name: 'ID列表' }] }
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: '0', msg: '操作成功', data: meta }))
    const { groupResMeta } = await import('./groupRes')
    expect(await groupResMeta()).toEqual(meta)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/api\/v1\/group-res\/meta$/)
    expect(init.method).toBe('GET')
  })

  it('新增：POST JSON body；data 是标量新 ID 时回 { ok, message, data }', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: '0', msg: '新增成功', data: 15 }))
    const { addGroupRes } = await import('./groupRes')

    const ack = await addGroupRes({ groupId: 100001, action: 'ACCEPT', resType: 'SOURCE', condType: 'ID', resCond: '430001300,430001301' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/api\/v1\/group-res\/add$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ groupId: 100001, action: 'ACCEPT', resType: 'SOURCE', condType: 'ID', resCond: '430001300,430001301' })
    expect(ack).toMatchObject({ ok: true, message: '新增成功', data: 15 })
  })

  it('修改：POST JSON body 带 id，data 是修改后的完整记录', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: '0', msg: '修改成功', data: { ...RULE, resCond: 'CATEGORY_ID IN (9009387)' } }))
    const { modifyGroupRes } = await import('./groupRes')

    const row = await modifyGroupRes({ id: 15, groupId: 100001, action: 'ACCEPT', resType: 'SOURCE', condType: 'SQL', resCond: 'CATEGORY_ID IN (9009387)' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/api\/v1\/group-res\/modify$/)
    expect(JSON.parse(String(init.body))).toMatchObject({ id: 15, condType: 'SQL' })
    expect(row.resCond).toBe('CATEGORY_ID IN (9009387)')
  })

  it('删除：POST ?ids=15,16（query 不是 body），data 为删除条数', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: '0', msg: '删除数量:2', data: 2 }))
    const { deleteGroupRes } = await import('./groupRes')

    const ack = await deleteGroupRes([15, 16])

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/group-res/delete?ids=15%2C16')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
    expect(ack).toMatchObject({ ok: true, message: '删除数量:2', data: 2 })
  })

  it('删除入参非法时抛出后端原文（ids 为空 / 含非数字）', async () => {
    const { deleteGroupRes } = await import('./groupRes')
    fetchMock.mockResolvedValue(jsonResponse({ success: false, code: '-1', msg: 'ids 不能为空', data: null }))
    await expect(deleteGroupRes([])).rejects.toThrow('ids 不能为空')
    fetchMock.mockResolvedValue(jsonResponse({ success: false, code: '-1', msg: 'ids 只能是逗号分隔的数字', data: null }))
    await expect(deleteGroupRes([15, 'a' as unknown as number])).rejects.toThrow('ids 只能是逗号分隔的数字')
  })

  it('试算：success=true 且 data.error 非空时不判失败，错误原样带回给调用方', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: '0', msg: '操作成功', data: { compiledCond: '1=1 union select', condType: 'SQL', count: 0, sample: [], error: '条件包含非法关键字: union' } }))
    const { previewGroupRes } = await import('./groupRes')

    const res = await previewGroupRes({ resType: 'SOURCE', condType: 'SQL', resCond: '1=1 union select' })

    expect((fetchMock.mock.calls[0] as [string])[0]).toMatch(/\/api\/v1\/group-res\/preview$/)
    expect(res.error).toBe('条件包含非法关键字: union')
    expect(res.count).toBe(0)
  })

  it('ID 条件校验：只允许逗号分隔的数字（后端同规则，前端先拦一次）', async () => {
    const { idCondError, sqlCondError } = await import('./groupRes')
    expect(idCondError('430001300, 430001301')).toBeNull()
    expect(idCondError('')).toBe('请填写 ID 列表')
    expect(idCondError('430001300;drop')).toContain('只能是逗号分隔的数字')
    expect(sqlCondError('SOURCE_ID > 1')).toBeNull()
    // 列名里的 UPDATE_DT 不该被误判，条件值里的 delete 该被拦
    expect(sqlCondError('UPDATE_DT IS NULL')).toBeNull()
    expect(sqlCondError("TAGS LIKE '%delete%'")).toContain('delete')
    expect(sqlCondError('SOURCE_ID = 1 --')).toContain('--')
  })
})
