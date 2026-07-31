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

  it('排序：ENTRY_ID 列也走 field/type 数值化 hack，sorted 恒为字符串 "0"（对照真实源码 handleSortChange 修正）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: null, count: 0, data: [] }))
    const { dataApi } = await import('./index')

    await dataApi.rowQueryPaged({ tableId: '1042', sortField: 'ENTRY_ID', sortOrder: 'ascend' })
    let payload = decryptBody(fetchMock.mock.calls[0][1] as RequestInit)
    expect(payload.sorted).toBe('0')
    expect(payload.field).toBe('(ENTRY_ID+ 0)')
    expect(payload.type).toBe(' ASC ')

    await dataApi.rowQueryPaged({ tableId: '1042', sortField: 'ENTRY_ID', sortOrder: 'descend' })
    payload = decryptBody(fetchMock.mock.calls[1][1] as RequestInit)
    expect(payload.type).toBe(' DESC ')
  })

  it('排序：动态列同样走 field/type 数值化排序 hack', async () => {
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

  it('tables() 摊平 list1/list2/list3 为扁平列表；main 是默认选中的标量 ID，不参与摊平', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0', msg: null,
      data: {
        main: '2',
        list1: [{ entryTypeId: '2', tableName: 't2' }],
        list2: [],
        list3: [{ entryTypeId: '3', tableName: 't3' }],
      },
    }))
    const { dataApi } = await import('./index')

    const tables = await dataApi.tables()
    expect(tables.map((t) => t.tableId)).toEqual(['2', '3'])
  })

  it('entryTypesGroup 把 main 解析为字符串 ID，不当作分组列表', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0', msg: null,
      data: { main: '2', list1: [], list2: [], list3: [] },
    }))
    const { dataApi } = await import('./index')

    const group = await dataApi.entryTypesGroup()
    expect(group.main).toBe('2')
  })

  it('tableMeta 用 GET 调 entry/queryEntryType，参数名是 type（不是 typeId）；响应是扁平记录，不包 curEntryType', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0', msg: null,
      data: { entryTypeId: '1042', tableName: 'sense_data.TB_NEWS', items: [] },
    }))
    const { dataApi } = await import('./index')

    const meta = await dataApi.tableMeta('1042')

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/entry/queryEntryType')
    expect(url).toContain('type=1042')
    expect(url).not.toContain('typeId=')
    expect(meta).toMatchObject({ tableId: '1042', tableName: 'sense_data.TB_NEWS' })
  })
})

describe('数据详情 / 统计 / 后续 / 删除 API 旧平台 HTTP 契约（E 包 T1c）', () => {
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
    vi.useRealTimers()
  })

  it('rowDetail 用 GET 调 entry/entryDetail，参数是 entryId+type（不是 entryTypeId），解包 showItems/subs', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0', msg: null,
      data: {
        ENTRY_ID: '88231', SOURCE_ID: '161725', K1: '正文',
        showItems: [{ itemId: '1', columnName: 'K1', itemName: '正文', value: '正文' }],
        subs: [{ ENTRY_ID: '88232', SOURCE_ID: '161725' }],
      },
    }))
    const { dataApi } = await import('./index')

    const detail = await dataApi.rowDetail('1042', '88231')

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/entry/entryDetail')
    expect(url).toContain('entryId=88231')
    expect(url).toContain('type=1042')
    expect(url).not.toContain('entryTypeId=')
    expect(detail?.row).toMatchObject({ dataId: '88231', sourceId: '161725' })
    expect(detail?.row.values).toEqual({ K1: '正文' })
    expect(detail?.showItems).toEqual([{ itemId: '1', columnName: 'K1', itemName: '正文', value: '正文' }])
    expect(detail?.subs).toEqual([expect.objectContaining({ dataId: '88232' })])
  })

  it('distinctSource 复用 buildLegacyRowQuery（含 more/enable），GET 返回源 ID 数组', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: null, data: ['161725', '110022'] }))
    const { dataApi } = await import('./index')

    const ids = await dataApi.distinctSource({ tableId: '1042', sql: 'UPDATE_DT > CURDATE()' })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/entry/entryDistinctSource')
    // 查询串走 URLSearchParams 编码（空格转 +），非 encodeURIComponent
    expect(url).toContain('more=UPDATE_DT+%3E+CURDATE%28%29')
    expect(url).toContain('enable=0')
    expect(ids).toEqual(['161725', '110022'])
  })

  it('summaryData 用 POST JSON 未加密（不走 AES），带 summaryFields 逗号分隔', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: null, data: [{ K2: '161725', CNT: 42 }] }))
    const { dataApi } = await import('./index')

    const rows = await dataApi.summaryData({ tableId: '1042', sourceId: 'src-7' }, ['K2', 'K3'])

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/entry/summaryEntryData')
    expect(init.method).toBe('POST')
    // 未加密：请求体是明文字段，不是 {data: AES(...)}
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).not.toHaveProperty('data')
    expect(body.summaryFields).toBe('K2, K3')
    expect(body.entryType).toBe('1042')
    expect(rows).toEqual([{ K2: '161725', CNT: 42 }])
  })

  it('nextStep 用 GET 调 source/nextStep，entryIds 逗号连接', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '发送成功', data: null }))
    const { dataApi } = await import('./index')

    await dataApi.nextStep('161725', '1042', ['1', '2', '3'])

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/source/nextStep')
    expect(url).toContain('entryIds=1%2C2%2C3')
    expect(url).toContain('entryTypeId=1042')
  })

  it('nextStepBatch 用 POST + AES，超时设为 180s', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '已提交', data: null }))
    const { dataApi } = await import('./index')
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout')

    await dataApi.nextStepBatch({ tableId: '1042', sourceId: 'src-7', size: 500000, start: 0 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/source/nextStep2')
    expect(init.method).toBe('POST')
    expect(decryptBody(init)).toMatchObject({ entryTypeId: '1042', sourceId: 'src-7', size: 500000, start: 0 })
    expect(setTimeoutSpy.mock.calls.some(([, delay]) => delay === 180_000)).toBe(true)
  })

  it('rowDelete 用 GET 调 entry/entryDelete，key 是当前小时数（防呆参数必须带）', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-27T15:30:00'))
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: null, data: { success: 3 } }))
    const { dataApi } = await import('./index')

    await dataApi.rowDelete('1042', { sourceId: '161725', all: 0 })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/entry/entryDelete')
    expect(url).toContain('key=15')
    expect(url).toContain('all=0')
    expect(url).toContain('entryTypeId=1042')
  })

  it('rowDeleteBatch 用 POST JSON {ids, entryTypeId}', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: null, data: { success: 2, all: 3, not_found: 1 } }))
    const { dataApi } = await import('./index')

    const result = await dataApi.rowDeleteBatch('1042', ['1', '2', '3'])

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/entry/entryDeleteBatch')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ ids: ['1', '2', '3'], entryTypeId: '1042' })
    expect(result).toEqual({ success: 2, all: 3, not_found: 1 })
  })

  it('clearParent 用 POST JSON，整个查询条件 + ids + flag:"-1"', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '设置成功', data: null }))
    const { dataApi } = await import('./index')

    await dataApi.clearParent({ tableId: '1042', sourceId: '161725' }, ['1', '2'])

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/entry/entryClearParent')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.flag).toBe('-1')
    expect(body.ids).toEqual(['1', '2'])
    expect(body.entryType).toBe('1042')
  })

  it('rowAdd 用 POST JSON 平铺体，null 字段提交前删除；ENTRY_TYPE_ID/SOURCE_ID/CONFIG_ID 数值化', async () => {
    // 真实联调实测（2026-07-31）：这三个系统指针字段后端按 Integer 反序列化，字符串会 500
    // “class java.lang.String cannot be cast to class java.lang.Integer”。K1 等动态列不做数值转换。
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '新增成功', data: null }))
    const { dataApi } = await import('./index')

    await dataApi.rowAdd('1042', { SOURCE_ID: '161725', CONFIG_ID: null, K1: '正文' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/entry/batch/saveEntryOne')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).not.toHaveProperty('CONFIG_ID')
    expect(body).toEqual({ ENTRY_TYPE_ID: 1042, SOURCE_ID: 161725, K1: '正文' })
  })

  it('rowAdd：非数字形态的 tableId 原样保留字符串，不强转', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '新增成功', data: null }))
    const { dataApi } = await import('./index')

    await dataApi.rowAdd('ZZ-测试表', { K1: '正文' })

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as Record<string, unknown>
    expect(body.ENTRY_TYPE_ID).toBe('ZZ-测试表')
  })

  it('rowUpdate 用 POST JSON，键名是大写 ENTRY_ID/ENTRY_TYPE_ID（不是 entryId/entryTypeId），且数值化', async () => {
    // 方案 §1.1："平铺 {ENTRY_ID, ENTRY_TYPE_ID, K1:..., K2:...}"（大写列名）；
    // 真实联调实测同 rowAdd，这两个系统指针字段需要是 JSON number 不是字符串。
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '修改成功', data: null }))
    const { dataApi } = await import('./index')

    await dataApi.rowUpdate('1042', '88231', { K1: '改过的标题' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/entry/entryUpdate')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toEqual({ K1: '改过的标题', ENTRY_TYPE_ID: 1042, ENTRY_ID: 88231 })
    expect(body).not.toHaveProperty('entryTypeId')
    expect(body).not.toHaveProperty('entryId')
  })

  it('reSave 用 GET 调 entry/re-save，jsonId 即行的 K0', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '重新保存成功,请检查数据', data: null }))
    const { dataApi } = await import('./index')

    await dataApi.reSave('161725', 'json-771')

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/entry/re-save')
    expect(url).toContain('jsonId=json-771')
  })

  it('exportUrl 是纯字符串拼接，不发起请求，只带 6 个查询字段', async () => {
    const { dataApi } = await import('./index')

    const url = dataApi.exportUrl({ tableId: '1042', sourceId: '161725', sql: "CREATE_DT > CURDATE()" })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(url).toContain('/api/v1/entry/entryExportAll?')
    expect(url).toContain('entryType=1042')
    expect(url).toContain('sourceId=161725')
    expect(url).toContain('more=CREATE_DT+%3E+CURDATE%28%29')
    // SQL 条件有值时 min 默认 0，导出与查询保持一致口径
    expect(url).toContain('min=0')
  })
})
