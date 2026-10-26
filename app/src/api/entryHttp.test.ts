// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  // request() 现在先 res.text() 再 JSON.parse（client.ts 空响应体兜底），mock 也要跟着给 text()
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

describe('表 ID（实体表）API 旧平台 HTTP 契约', () => {
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

  it('列表使用 GET、page/limit，独立传 entryTypeId/name/enable（不猜词、不残留 keyword）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', count: 1, data: [{ entryTypeId: 2102157, tableName: 't', items: [] }] }))
    const { entryApi } = await import('./index')

    const result = await entryApi.entryPaged({ page: 2, size: 30, entryTypeId: '2102157', name: '评论', enable: '0' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/config/entryTypePagedView?')
    expect(url).toContain('page=2')
    expect(url).toContain('limit=30')
    expect(url).toContain('entryTypeId=2102157')
    expect(url).toContain(encodeURIComponent('评论'))
    expect(url).toContain('enable=0')
    expect(url).not.toContain('keyword')
    expect(url).not.toContain('size=')
    expect(init.method).toBe('GET')
    expect(result.total).toBe(1)
    expect(result.list[0]).toMatchObject({ tableId: '2102157', tableName: 't' })
  })

    it('列表默认分页 limit=20（旧 s-table pageSize 口径）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', count: 0, data: [] }))
    const { entryApi } = await import('./index')

    await entryApi.entryPaged({})

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('limit=20')
    expect(url).not.toContain('entryTypeId=')
    expect(url).not.toContain('name=')
    expect(url).not.toContain('enable=')
  })

  // 窄接口（2026-10-26）：只改 DS_KIND，POST 查询参数，不走整对象 modifyEntryType
  it('单独置数据源使用 POST 查询参数 entryTypeId + dsKind', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '数据源已更新为 CK，id:2101020' }))
    const { entryApi } = await import('./index')

    await entryApi.setEntryDsKind('2101020', 'CK')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(url).toContain('/api/v1/config/entry-type-ds-kind?')
    expect(url).toContain('entryTypeId=2101020')
    expect(url).toContain('dsKind=CK')
  })

  it('详情使用 GET 和旧字段名 typeId（非 tableId/entryTypeId）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: { entryTypeId: '2102157', tableName: 't', items: [] } }))
    const { entryApi } = await import('./index')

    await entryApi.entryDetail('2102157')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(url).toContain('/api/v1/config/entryType?')
    expect(url).toContain('typeId=2102157')
  })

  // DS_KIND（2026-10-22）：列表/详情把后端 DS_KIND 带出为 dsKind；老记录缺失时归一 MYSQL
  it('列表把 DS_KIND 带出为 dsKind，缺失时归一 MYSQL', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0', count: 2,
      data: [
        { entryTypeId: 2101020, tableName: 't_ck', dsKind: 'CK', items: [] },
        { entryTypeId: 2102157, tableName: 't_mysql', items: [] },
      ],
    }))
    const { entryApi } = await import('./index')

    const result = await entryApi.entryPaged({ page: 1, size: 20 })

    expect(result.list[0].dsKind).toBe('CK')
    expect(result.list[1].dsKind).toBe('MYSQL')
  })

  it('新建（无 tableId）走 entryTypeAddAll，POST JSON 且不带 entryTypeId', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '表已创建', data: null }))
    const { entryApi } = await import('./index')

    const result = await entryApi.entrySave({ tableId: '', tableName: 'tb_new', name: '新表', fields: [] })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/config/entryTypeAddAll')
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body))
    expect(body).not.toHaveProperty('entryTypeId')
    expect(body).toMatchObject({ typeName: '新表', tableName: 'tb_new' })
    expect(result.message).toBe('处理成功, 后端返回:表已创建')
  })

  it('编辑（有 tableId）走 modifyEntryType，POST JSON 带 entryTypeId，成功文案透传后端 msg', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: 'ok', data: null }))
    const { entryApi } = await import('./index')

    const result = await entryApi.entrySave({ tableId: '2102157', tableName: 'sense_data.TB_ZFB_COMMENT', name: '评论', fields: [] })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/config/modifyEntryType')
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({ entryTypeId: '2102157' })
    expect(result.tableId).toBe('2102157')
    expect(result.message).toBe('处理成功, 后端返回:ok')
  })

  it('批量重建表使用 GET，ids 逗号连接', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '处理成功', data: null }))
    const { entryApi } = await import('./index')

    await entryApi.rebuildTable(['2102157', '2101001'])

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(url).toContain('/api/v1/config/rebuildTable?')
    expect(url).toContain('ids=2102157%2C2101001')
  })

  it('重建去重索引使用 GET 和旧字段名 entryTypeId（单表）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '重建去重索引成功', data: null }))
    const { entryApi } = await import('./index')

    await entryApi.rebuildIndex('2102157')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(url).toContain('/api/v1/config/rebuildIndex?')
    expect(url).toContain('entryTypeId=2102157')
  })

  it('批量删除使用 GET，ids 逗号连接', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '删除成功', data: null }))
    const { entryApi } = await import('./index')

    await entryApi.deleteEntries(['2102157', '2101001'])

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(url).toContain('/api/v1/config/deleteEntryType?')
    expect(url).toContain('ids=2102157%2C2101001')
  })

  it('清缓存使用 POST 查询参数，ids 逗号连接', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '清理成功', data: null }))
    const { entryApi } = await import('./index')

    await entryApi.clearCache(['2102157', '2101001'])

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(url).toContain('/api/v1/config/entry-type-clear?')
    expect(url).toContain('ids=2102157%2C2101001')
    expect(init.body).toBeUndefined()
  })

  it('复制新表使用 POST 查询参数 id + tableName', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '复制成功', data: null }))
    const { entryApi } = await import('./index')

    await entryApi.copyEntry('2102157', 'tb_entry_copy')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(url).toContain('/api/v1/config/entryTypeCopy?')
    expect(url).toContain('id=2102157')
    expect(url).toContain('tableName=tb_entry_copy')
  })

  it('检查表结构使用 GET 和旧字段名 entryTypeId，返回差异 SQL 数组', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: ['ALTER TABLE t ADD COLUMN k1 varchar(255)'] }))
    const { entryApi } = await import('./index')

    const result = await entryApi.checkTable('2102157')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(url).toContain('/api/v1/config/checkTable?')
    expect(url).toContain('entryTypeId=2102157')
    expect(result).toEqual(['ALTER TABLE t ADD COLUMN k1 varchar(255)'])
  })

  it('同步物理表结构使用 GET 和旧字段名 entryTypeId', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '物理表结构已更新', data: null }))
    const { entryApi } = await import('./index')

    await entryApi.syncTable('2102157')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(url).toContain('/api/v1/config/syncTable?')
    expect(url).toContain('entryTypeId=2102157')
  })

  it('计算数据量使用 GET 和旧字段名 entryTypeId', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '计算成功', data: null }))
    const { entryApi } = await import('./index')

    await entryApi.calcEntrySum('2102157')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(url).toContain('/api/v1/config/calcEntrySum?')
    expect(url).toContain('entryTypeId=2102157')
  })

  it('正式/测试切换使用 POST 查询参数 entryTypeId + state', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '设置成功', data: null }))
    const { entryApi } = await import('./index')

    await entryApi.markEntryType('2102157', 'AC')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(url).toContain('/api/v1/config/markEntryType?')
    expect(url).toContain('entryTypeId=2102157')
    expect(url).toContain('state=AC')
    expect(init.body).toBeUndefined()
  })

  it('旧平台业务错误沿用后端消息（msg 透传）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '-1', msg: '表名已存在', data: null }))
    const { entryApi } = await import('./index')

    await expect(entryApi.copyEntry('2102157', 'tb_dup')).rejects.toThrow('表名已存在')
  })

  // 2026-09-23：表下拉支持按 ID 搜。后端 name 不匹配 ID（name=2101720 → 0），要走 entryTypeId
  describe('searchTables', () => {
    it('非纯数字只按名称查一次', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ code: '0', count: 1, data: [{ entryTypeId: 2101720, tableName: 'sense_data.TB_YOUTUBE', items: [] }] }))
      const { entryApi } = await import('./index')
      const list = await entryApi.searchTables('YOUTUBE')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(String(fetchMock.mock.calls[0][0])).toContain('name=YOUTUBE')
      expect(list.map((t) => t.tableId)).toEqual(['2101720'])
    })

    it('纯数字：按 ID（entryTypeId）和名称两路查，合并去重，ID 命中排最前', async () => {
      fetchMock.mockImplementation(async (url: string) => String(url).includes('entryTypeId=')
        ? jsonResponse({ code: '0', count: 1, data: [{ entryTypeId: 2101720, tableName: 'sense_data.TB_YOUTUBE', items: [] }] })
        : jsonResponse({ code: '0', count: 2, data: [
          { entryTypeId: 9001, tableName: 'sense_data.TB_2101720_BAK', items: [] },
          { entryTypeId: 2101720, tableName: 'sense_data.TB_YOUTUBE', items: [] },
        ] }))
      const { entryApi } = await import('./index')
      const list = await entryApi.searchTables('2101720')
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(list.map((t) => t.tableId)).toEqual(['2101720', '9001'])
    })
  })
})
