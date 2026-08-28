// @vitest-environment jsdom
// 配置写入的 HTTP 契约。
//
// 这组测试盯的是**真正发出去的 body**，不是传给 configApi 的参数——2026-08-28 线上就栽在这个差别上：
// `buildConfigPayload` 产出的已经是旧平台字段名（configName / isMulti / templetCode …），
// 而 `updateConfig` 当时又对它跑了一遍 `configToLegacy`（那是"模型 → 旧字段"的转换，读 name /
// multiMode / templateCode 这些模型键），结果除了键名恰好相同的几个，其余全写成 undefined。
// 表现是"点保存没报错，但配置名称/是否列表/业务类型都没更新"。
// 只断言入参的测试对此完全无感，所以这里必须落到 fetch 这一层。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  const init = call[1] as RequestInit
  return JSON.parse(String(init.body))
}

describe('配置写入 HTTP 契约', () => {
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

  const payload = {
    configId: '1400917',
    configName: 'test2',
    configUrl: 'http://www.baidu.com/',
    isMulti: 0,
    templetCode: 'news',
    topic: 'q_x',
    entryTypeId: '900',
    inEntryType: '900',
    snatchDrepeat: 'ALL',
    codeRule: '{"globals":["列ID"]}',
    contentRule: '{}',
    clearRule: '{"keep":1}',
  }

  it('updateConfig 原样 POST 旧平台字段，一个都不能掉', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: '0', msg: '操作成功' }))
    const { configApi } = await import('./index')

    await configApi.updateConfig(payload)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('config/modify/updateConfig')
    expect((init as RequestInit).method).toBe('POST')
    // 逐个点名：这几个正是双重转换时被写空的字段
    expect(bodyOf(fetchMock.mock.calls[0])).toMatchObject(payload)
  })

  it('copyConfigAndLocate 按 ID 差集定位复制出来的配置，不靠猜名字', async () => {
    // 复制前后各查一次同名前缀，取新增的 ID。名字规则（原名_copy）不可靠——
    // 生产上就有一条历史遗留的 test2_copy，按名字回查会认错。
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, count: 2, data: [{ configId: 1400917, configName: 'test2' }, { configId: 1400980, configName: 'test2_copy' }] }))
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', msg: '操作成功' }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, count: 3, data: [{ configId: 1400917, configName: 'test2' }, { configId: 1400980, configName: 'test2_copy' }, { configId: 1400999, configName: 'test2_copy' }] }))
    const { configApi } = await import('./index')

    const res = await configApi.copyConfigAndLocate('1400917', 'test2')

    expect(String(fetchMock.mock.calls[1][0])).toContain('config/copyAll')
    // 复制前就存在的同名 test2_copy(1400980) 不能被认成新的
    expect(res).toMatchObject({ ok: true, configId: '1400999' })
  })

  it('定位不到唯一新配置时不返回 ID（宁可不绑，也不能绑错）', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, count: 1, data: [{ configId: 1400917, configName: 'test2' }] }))
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', msg: '操作成功' }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, count: 1, data: [{ configId: 1400917, configName: 'test2' }] }))
    const { configApi } = await import('./index')

    const res = await configApi.copyConfigAndLocate('1400917', 'test2')
    expect(res.ok).toBe(false)
  })
})
