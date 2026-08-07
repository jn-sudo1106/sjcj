// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response
}

describe('旧平台新建源 HTTP 契约', () => {
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

  it('POST /v1/snatch/snatchSave，保持旧平台字段名且解析源ID', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '源ID:12345' }))
    const { sourceApi } = await import('./index')
    const payload = {
      sourceType: 90, sourceUrl: 'https://example.com', sourceName: '公告源', categoryId: 'cat-1', proxy: '', keep: '', cron: '', tags: '',
      newConfig: '1' as const, isMulti: '1', loginTemplete: '1', entryTypeId: 'tb-1', params: [{ paramId: 'p-1' }],
      reqLogin: '1' as const, newLoginConfig: '1' as const, loginUrl: 'https://example.com/login', loginName: 'alice', loginPwd: 'secret',
    }

    const result = await sourceApi.snatchSaveAll(payload)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/snatch/snatchSave')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual(payload)
    expect(result).toMatchObject({ ok: true, message: '源ID:12345', sourceId: '12345' })
  })
})
