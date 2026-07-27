// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptLegacyPayload } from './legacyCrypto'

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response
}

/** 取本次 fetch 的 AES 请求体明文（entryDataPaged 的 POST 体只有 {data}） */
function decryptBody(init: RequestInit) {
  const body = JSON.parse(String(init.body)) as Record<string, unknown>
  expect(Object.keys(body)).toEqual(['data'])
  return JSON.parse(decryptLegacyPayload(String(body.data))) as Record<string, unknown>
}

describe('实体数据 API 旧平台 HTTP 契约', () => {
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

  it('entryDataPaged 用 POST + AES 单字段体，SQL 条件走 more（不是 sql）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: null, count: 0, data: [] }))
    const { dataApi } = await import('./index')

    await dataApi.rowQueryPaged({
      tableId: '1042', sourceId: 'src-7', dataId: '9', page: 2, size: 40,
      sql: "CREATE_DT > CURDATE()",
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/entry/entryDataPaged')
    expect(init.method).toBe('POST')

    const payload = decryptBody(init)
    // 旧后端读 more；sql 键不应出现，否则筛选被静默忽略
    expect(payload.more).toBe("CREATE_DT > CURDATE()")
    expect(payload).not.toHaveProperty('sql')
    // 前端字段名改名口径
    expect(payload.page).toBe(2)
    expect(payload.limit).toBe(40)
    expect(payload.entryType).toBe('1042')
    expect(payload.entryId).toBe('9')
  })

  it('SQL 条件有值时 min 默认 0，无值时不兜底', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: null, count: 0, data: [] }))
    const { dataApi } = await import('./index')

    await dataApi.rowQueryPaged({ tableId: '1042', sql: 'UPDATE_DT > CURDATE()' })
    expect(decryptBody(fetchMock.mock.calls[0][1] as RequestInit).min).toBe(0)

    await dataApi.rowQueryPaged({ tableId: '1042', min: '500' })
    expect(decryptBody(fetchMock.mock.calls[1][1] as RequestInit).min).toBe('500')

    await dataApi.rowQueryPaged({ tableId: '1042' })
    expect(decryptBody(fetchMock.mock.calls[2][1] as RequestInit).min).toBeUndefined()
  })

  it('分页响应用 count 作总数，行按大写物理列名转换', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0',
      msg: null,
      count: 1203,
      data: [{
        ENTRY_ID: '88231', SOURCE_ID: '161725', CONFIG_ID: '70612', DETAIL_ID: 'TK-99021',
        PARENT_ID: '412', CATEGORY_ID: '1040', STATE: 'C', NEXT_FLAG: '-1',
        CREATE_DT: '2026-07-18 09:12:00', UPDATE_DT: '2026-07-18 10:00:00',
        K0: 'json-771', SEQ: '3', TIMES: '1', FILE_ID: 'f-9',
        K1: '这是测试数据', K2: '161725',
      }],
    }))
    const { dataApi } = await import('./index')

    const result = await dataApi.rowQueryPaged({ tableId: '1042' })

    expect(result.total).toBe(1203)
    expect(result.list[0]).toMatchObject({
      dataId: '88231', sourceId: '161725', configId: '70612', detailId: 'TK-99021',
      parentId: '412', categoryId: '1040', state: 'C', nextFlag: '-1',
      createDt: '2026-07-18 09:12:00', updateDt: '2026-07-18 10:00:00',
      k0: 'json-771', seq: '3', times: '1', fileId: 'f-9',
    })
    // 系统列不得混入动态值集，否则动态列会多出系统列、任务/后续/原始列取不到值
    expect(result.list[0].values).toEqual({ K1: '这是测试数据', K2: '161725' })
  })

  it('entryDataPaged 载荷固定带 enable:"0"（旧平台初始查询口径，随载荷一起提交）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: null, count: 0, data: [] }))
    const { dataApi } = await import('./index')

    await dataApi.rowQueryPaged({ tableId: '1042' })

    expect(decryptBody(fetchMock.mock.calls[0][1] as RequestInit).enable).toBe('0')
  })

  it('state 多选由调用方 join(\',\') 传入；无值时不带该键（不兜底 ALL）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: null, count: 0, data: [] }))
    const { dataApi } = await import('./index')

    await dataApi.rowQueryPaged({ tableId: '1042', state: 'C,AC' })
    expect(decryptBody(fetchMock.mock.calls[0][1] as RequestInit).state).toBe('C,AC')

    await dataApi.rowQueryPaged({ tableId: '1042' })
    const payload = decryptBody(fetchMock.mock.calls[1][1] as RequestInit)
    expect(payload).not.toHaveProperty('state')
  })

  it('排序：ENTRY_ID 列走 sorted ±1，不带 field/type', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: null, count: 0, data: [] }))
    const { dataApi } = await import('./index')

    await dataApi.rowQueryPaged({ tableId: '1042', sortField: 'ENTRY_ID', sortOrder: 'ascend' })
    let payload = decryptBody(fetchMock.mock.calls[0][1] as RequestInit)
    expect(payload.sorted).toBe(1)
    expect(payload).not.toHaveProperty('field')
    expect(payload).not.toHaveProperty('type')

    await dataApi.rowQueryPaged({ tableId: '1042', sortField: 'ENTRY_ID', sortOrder: 'descend' })
    payload = decryptBody(fetchMock.mock.calls[1][1] as RequestInit)
    expect(payload.sorted).toBe(-1)
  })

  it('排序：非 ENTRY_ID 动态列走 field/type 数值化排序 hack，sorted 保持 "0"', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: null, count: 0, data: [] }))
    const { dataApi } = await import('./index')

    await dataApi.rowQueryPaged({ tableId: '1042', sortField: 'K1', sortOrder: 'descend' })
    const payload = decryptBody(fetchMock.mock.calls[0][1] as RequestInit)
    expect(payload.sorted).toBe('0')
    expect(payload.field).toBe('(K1+ 0)')
    expect(payload.type).toBe(' DESC ')
  })

  it('无排序时 sorted 为字符串 "0"，不带 field/type', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: null, count: 0, data: [] }))
    const { dataApi } = await import('./index')

    await dataApi.rowQueryPaged({ tableId: '1042' })
    const payload = decryptBody(fetchMock.mock.calls[0][1] as RequestInit)
    expect(payload.sorted).toBe('0')
    expect(payload).not.toHaveProperty('field')
    expect(payload).not.toHaveProperty('type')
  })
})

describe('选表分组 / 动态表结构 API 旧平台 HTTP 契约（E 包 T1b）', () => {
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

  it('entryTypesGroup 用 GET 调 config/queryEntryTypesGroup，sourceId 可空', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0', msg: null,
      data: { main: [{ entryTypeId: '1', tableName: 't1' }], list1: [], list2: [], list3: [] },
    }))
    const { dataApi } = await import('./index')

    await dataApi.entryTypesGroup()
    let [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/config/queryEntryTypesGroup')
    expect(url).not.toContain('sourceId=')
    expect(init.method).toBe('GET')

    await dataApi.entryTypesGroup('src-7')
    ;[url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toContain('sourceId=src-7')
  })

  it('tables() 摊平四个分组为扁平列表，供现有选表下拉复用', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0', msg: null,
      data: {
        main: [{ entryTypeId: '1', tableName: 't1' }],
        list1: [{ entryTypeId: '2', tableName: 't2' }],
        list2: [],
        list3: [{ entryTypeId: '3', tableName: 't3' }],
      },
    }))
    const { dataApi } = await import('./index')

    const tables = await dataApi.tables()
    expect(tables.map((t) => t.tableId)).toEqual(['1', '2', '3'])
  })

  it('tableMeta 用 GET 调 entry/queryEntryType，参数名是 type（不是 typeId）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0', msg: null,
      data: { curEntryType: { entryTypeId: '1042', tableName: 'sense_data.TB_NEWS', items: [] } },
    }))
    const { dataApi } = await import('./index')

    const meta = await dataApi.tableMeta('1042')

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/entry/queryEntryType')
    expect(url).toContain('type=1042')
    expect(url).not.toContain('typeId=')
    // 真实响应包一层 curEntryType，需解包后再转换
    expect(meta).toMatchObject({ tableId: '1042', tableName: 'sense_data.TB_NEWS' })
  })
})
