// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fetchMock = vi.fn()
const jsonResponse = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) }) as Response
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); vi.stubEnv('VITE_API_MODE', 'http'); vi.stubEnv('VITE_API_PROXY_TARGET', 'http://127.0.0.1:9100'); vi.resetModules() })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
it('发送 JSON body，保持 201 派发 configId、stepId 与队列独立，Long ID 不丢精度', async () => {
  const receipt = { requestCnt: 1, sendCnt: 1, failCnt: 0, configId: '900', queue: 'manual', taskIds: ['1001'], tasks: [] }
  fetchMock.mockResolvedValue(jsonResponse({ code: '0', success: true, data: receipt }))
  const { sourceApi } = await import('./index')
  const payload = { sourceId: '7', flowId: '50', stepId: '2', configId: '9223372036854775806', queue: 'manual', entryIds: ['901'], params: { '20_172': 'value' } }
  expect(await sourceApi.sendCodeConfig(payload)).toEqual(receipt)
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(url).toBe('/api/v1/source/sendCodeConfig'); expect(init.method).toBe('POST'); expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' }); expect(JSON.parse(String(init.body))).toEqual(payload)
})
it('默认配置和默认队列由后端选择；即使 mock 默认模式也不伪造 MQ 发送成功', async () => {
  vi.stubEnv('VITE_API_MODE', 'mock')
  fetchMock.mockResolvedValue(jsonResponse({ code: '0', success: true, data: { configId: '900', queue: 'config-topic', sendCnt: 1, failCnt: 0, taskIds: [], tasks: [] } }))
  const { sourceApi } = await import('./index')
  await sourceApi.sendCodeConfig({ sourceId: '7', flowId: '50', stepId: '2' })
  expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body))).toEqual({ sourceId: '7', flowId: '50', stepId: '2' })
})
it('保留没有 201 配置的真实错误', async () => {
  fetchMock.mockResolvedValue(jsonResponse({ code: '-1', success: false, msg: '没有启用的 config_type=201 配置' }))
  const { sourceApi } = await import('./index')
  await expect(sourceApi.sendCodeConfig({ sourceId: '7', flowId: '50', stepId: '2' })).rejects.toThrow('没有启用的 config_type=201 配置')
})

it('部分派发失败时保留成功任务 ID 与逐项错误，供界面展示', async () => {
  const receipt = { requestCnt: 2, sendCnt: 1, failCnt: 1, configId: '900', queue: 'manual', taskIds: ['1001', '1002'], tasks: [{ stepId: '2', taskIds: ['1002'], errors: ['broker unavailable'] }] }
  fetchMock.mockResolvedValue(jsonResponse({ code: '-1', success: false, msg: '部分任务派发失败', data: receipt }))
  const { sourceApi } = await import('./index')
  expect(await sourceApi.sendCodeConfig({ sourceId: '7', flowId: '50', stepId: '2' })).toEqual(receipt)
})

it('只读查询真实的 201 配置候选，显示名称和队列，ID 保持字符串', async () => {
  vi.stubEnv('VITE_API_MODE', 'mock')
  const options = [{ configId: '9223372036854775806', name: '代码生成', topic: 'code-gen', entryTypeId: 13 }]
  fetchMock.mockResolvedValue(jsonResponse({ code: '0', success: true, data: options }))
  const { sourceApi } = await import('./index')
  expect(await sourceApi.codeConfigOptions()).toEqual(options)
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(url).toBe('/api/v1/source/codeConfigOptions'); expect(init.method).toBe('GET'); expect(init.body).toBeUndefined()
})
it('配置候选查询失败时保留真实错误，不回退假列表', async () => {
  fetchMock.mockResolvedValue(jsonResponse({ code: '-1', success: false, msg: '配置读取失败' }))
  const { sourceApi } = await import('./index')
  await expect(sourceApi.codeConfigOptions()).rejects.toThrow('配置读取失败')
})
