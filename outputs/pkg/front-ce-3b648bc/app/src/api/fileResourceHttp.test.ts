// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptLegacyPayload } from './legacyCrypto'

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

function decryptBody(init: RequestInit) {
  const body = JSON.parse(String(init.body)) as Record<string, unknown>
  expect(Object.keys(body)).toEqual(['data'])
  return JSON.parse(decryptLegacyPayload(String(body.data))) as Record<string, unknown>
}

describe('file_resource 文件视图 HTTP 契约', () => {
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

  it('用 file_resource 名称查询表目录，不调用废弃 filePaged', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0', count: 1, data: [{ entryTypeId: '6200028', tableName: 'sense_data.tb_news_file_resource', typeName: 'news-文件资源表', items: [] }],
    }))
    const { fileApi } = await import('./index')

    const tables = await fileApi.resourceTables()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/config/entryTypePagedView?')
    expect(url).toContain('name=file_resource')
    expect(url).toContain('limit=100')
    expect(url).not.toContain('filePaged')
    expect(init.method).toBe('GET')
    expect(tables[0]).toMatchObject({ tableId: '6200028', tableName: 'sense_data.tb_news_file_resource' })
  })

  it('表结构使用 entry/queryEntryType 的 type 参数', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0', data: { entryTypeId: '6200028', tableName: 'sense_data.tb_news_file_resource', typeName: 'news-文件资源表', items: [{ itemCode: 'file_name', itemName: '文件名', columnName: 'K1' }] },
    }))
    const { fileApi } = await import('./index')

    const meta = await fileApi.resourceMeta('6200028')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/entry/queryEntryType?')
    expect(url).toContain('type=6200028')
    expect(init.method).toBe('GET')
    expect(meta?.tableId).toBe('6200028')
    expect(meta?.fields[0]).toMatchObject({ columnName: 'K1' })
  })

  it('文件行使用 entryDataPaged AES 载荷，文件名/扩展名进入 more 条件', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0', count: 1, data: [{ ENTRY_ID: '9001', SOURCE_ID: '391007768', STATE: 'C', CREATE_DT: '2026-08-17 10:00:00', K1: '公告.pdf', K2: 'https://files.example.com/a.pdf', K4: '2048', K5: 'md5-1', K6: '公告.pdf', K7: 'pdf' }],
    }))
    const { fileApi } = await import('./index')

    const result = await fileApi.resourceRows({ tableId: '6200028', sourceId: '391007768', state: 'C', fileName: "公告'", ext: '.pdf', page: 2, size: 30 })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/entry/entryDataPaged')
    expect(init.method).toBe('POST')
    const payload = decryptBody(init)
    expect(payload).toMatchObject({ page: 2, limit: 30, entryType: 6200028, sourceId: '391007768', state: 'C' })
    expect(String(payload.more)).toContain('K1 LIKE')
    expect(String(payload.more)).toContain('K6 LIKE')
    expect(String(payload.more)).toContain('K7 LIKE')
    expect(payload).not.toHaveProperty('fileName')
    expect(result.list[0]).toMatchObject({ dataId: '9001', sourceId: '391007768', state: 'C' })
    expect(result.list[0].values).toMatchObject({ K1: '公告.pdf', K7: 'pdf' })
  })

  // 2026-08-22 生产实测：文件行自带 CONFIG_ID / DETAIL_ID 物理列，此前适配时被丢掉，
  // 导致"文件挂在哪个节点"这条现成的线索前端完全看不到。
  it('保留文件行的 CONFIG_ID / DETAIL_ID —— 节点归属靠它反查步骤', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0', count: 1, data: [{ ENTRY_ID: '9001', SOURCE_ID: '391002885', CONFIG_ID: 81134, DETAIL_ID: '8390132556', STATE: 'C', K1: 'a.xlsx' }],
    }))
    const { fileApi } = await import('./index')

    const result = await fileApi.resourceRows({ tableId: '6200028', sourceId: '391002885', page: 1, size: 20 })

    expect(result.list[0]).toMatchObject({ dataId: '9001', configId: '81134', detailId: '8390132556' })
  })

  it('保留父ID / 序号 / 总次数 / 原始 JSON，供文件详情对齐旧平台标识区', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0', count: 1, data: [{
        ENTRY_ID: '9001', SOURCE_ID: '391002885', PARENT_ID: '88001', CATEGORY_ID: '2102157',
        SEQ: '3', TIMES: '2', K0: 'json-771', FILE_ID: 'f-9', STATE: 'C', K1: 'a.xlsx',
      }],
    }))
    const { fileApi } = await import('./index')

    const result = await fileApi.resourceRows({ tableId: '6200028', sourceId: '391002885', page: 1, size: 20 })

    expect(result.list[0]).toMatchObject({
      parentId: '88001', categoryId: '2102157', seq: '3', times: '2', k0: 'json-771', fileId: 'f-9',
    })
  })

  it('按节点筛选落到 CONFIG_ID 等值条件，与其他条件 AND 相接', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', count: 0, data: [] }))
    const { fileApi } = await import('./index')

    await fileApi.resourceRows({ tableId: '6200028', sourceId: '430016501', configId: '1400765', ext: 'xlsx', page: 1, size: 20 })

    const more = String(decryptBody(fetchMock.mock.calls[0][1] as RequestInit).more)
    expect(more).toContain("CONFIG_ID = '1400765'")
    expect(more).toContain('K7 LIKE')
    expect(more).toContain(' AND ')
  })
})
