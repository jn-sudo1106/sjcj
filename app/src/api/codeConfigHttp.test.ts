// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fetchMock = vi.fn()
const jsonResponse = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) }) as Response
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); vi.stubEnv('VITE_API_MODE', 'http'); vi.stubEnv('VITE_API_PROXY_TARGET', 'http://127.0.0.1:9100'); vi.resetModules() })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
it('代码任务使用节点配置写入管理数据库，不发送业务MQ请求', async () => {
  const { sourceApi, flowCenterApi } = await import('./index')
  vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue({ sourceId: '7', name: '测试源', url: 'https://example.com' } as never)
  vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([{ stepId: '2', configId: '9223372036854775806', name: '抓取', sourceId: '-1', enabled: true }] as never)
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ job: { taskId: 'a'.repeat(32) } }) })
  const result = await sourceApi.sendCodeConfig({ sourceId: '7', flowId: '50', stepId: '2', orchestration: { aiGeneration: { interfaceId: 'agent' } } })
  expect(result.taskIds).toEqual(['a'.repeat(32)])
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(url).toBe('/api/runner-management/code-generation/tasks')
  expect(JSON.parse(String(init.body))).toMatchObject({ sourceId: '7', flowId: '50', stepId: '2', configId: '9223372036854775806', generation: { interfaceId: 'agent' } })
  expect(fetchMock).toHaveBeenCalledOnce()
})
it('节点配置读取失败保留真实错误，不回退MQ', async () => {
  const { sourceApi } = await import('./index')
  vi.spyOn(sourceApi, 'sourceDetail').mockRejectedValue(new Error('源不存在'))
  await expect(sourceApi.sendCodeConfig({ sourceId: '7', flowId: '50', stepId: '2' })).rejects.toThrow('源不存在')
  expect(fetchMock).not.toHaveBeenCalled()
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
