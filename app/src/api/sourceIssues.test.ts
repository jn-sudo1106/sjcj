// @vitest-environment jsdom
/// <reference types="vitest/jsdom" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BASE_URL } from './client'
import { sourceIssueApi, type SourceIssue, type SourceIssueQuery } from './sourceIssues'

const issue: SourceIssue = {
  id: '10001', sourceId: '9007199254740993', sourceName: '测试源', sourceAvailable: true,
  description: '缺数', state: 0, createdBy: 'collector', createTime: '2026-11-03 09:00:00',
  siteId: null, siteName: null, handledBy: null, handleTime: null,
}
const query: SourceIssueQuery = { keyword: '', createTimeStart: '', createTimeEnd: '', page: 1, size: 40 }
const fetcher = vi.fn<typeof fetch>()
const reply = (body: unknown) => new Response(JSON.stringify(body))

beforeEach(() => {
  vi.stubEnv('VITE_API_PROXY_TARGET', 'http://127.0.0.1:9999')
  vi.stubGlobal('fetch', fetcher.mockReset())
})
const initialUrl = window.location.href
afterEach(() => {
  jsdom.reconfigure({ url: initialUrl })
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('源问题 HTTP 契约', () => {
  it('分页使用 limit 和原始日期，区分待处理和全部，沿用通用解包', async () => {
    fetcher.mockImplementation(async () => reply({ code: 0, data: [issue], count: 3 }))
    await expect(sourceIssueApi.paged({ ...query, state: 0, createTimeEnd: '2026-11-04' }))
      .resolves.toEqual({ list: [issue], total: 3 })
    const [url, options] = fetcher.mock.calls[0]!
    expect(url).toBe(BASE_URL + 'source/issue/paged?createTimeEnd=2026-11-04&page=1&state=0&limit=40')
    expect(options).toMatchObject({ method: 'GET', credentials: 'include' })
    await sourceIssueApi.paged(query)
    expect(fetcher.mock.calls[1]![0]).toBe(BASE_URL + 'source/issue/paged?page=1&limit=40')
  })

  it('登记和处理发送 JSON，详情发送 GET，字符串 ID 不丢精度', async () => {
    const handled = { ...issue, state: 1, handledBy: 'operator', handleTime: '2026-11-03 10:00:00' }
    fetcher.mockResolvedValueOnce(reply({ success: true, code: '0', data: [issue] }))
      .mockResolvedValueOnce(reply({ success: true, code: '0', data: issue }))
      .mockResolvedValueOnce(reply({ success: true, code: '0', data: handled }))
    const input = { sourceIds: [issue.sourceId], description: '缺数' }
    await expect(sourceIssueApi.create(input)).resolves.toEqual([issue])
    expect(fetcher).toHaveBeenNthCalledWith(1, BASE_URL + 'source/issue/addBatch',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }))
    await expect(sourceIssueApi.detail(issue.id)).resolves.toEqual(issue)
    expect(fetcher).toHaveBeenNthCalledWith(2, BASE_URL + 'source/issue/detail?id=10001',
      expect.objectContaining({ method: 'GET' }))
    await expect(sourceIssueApi.handle(issue.id)).resolves.toEqual(handled)
    expect(fetcher).toHaveBeenNthCalledWith(3, BASE_URL + 'source/issue/handle',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ id: issue.id }) }))
  })

  it('保留明确的业务失败，断网后只提示核对台账', async () => {
    const input = { sourceIds: [issue.sourceId], description: '缺数' }
    fetcher.mockResolvedValueOnce(reply({ success: false, code: '-1', msg: '整批未登记' }))
      .mockRejectedValueOnce(new TypeError('网络中断'))
    await expect(sourceIssueApi.create(input)).rejects.toThrow('整批未登记')
    await expect(sourceIssueApi.create(input)).rejects.toThrow('先到源问题台账核对')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('登记超时后只发送一次，并要求核对台账', async () => {
    vi.useFakeTimers()
    try {
      fetcher.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      }))
      const result = sourceIssueApi.create({ sourceIds: [issue.sourceId], description: '缺数' })
      const assertion = expect(result).rejects.toThrow('先到源问题台账核对')
      await vi.advanceTimersByTimeAsync(20_000)
      await assertion
      expect(fetcher).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['115.227.21.133:9999', '118.25.96.217:9999', 'app217:9999', '47.120.11.60:2806'])(
    '生产写保护拦截代理到 %s 的登记和处理', async target => {
      vi.stubEnv('VITE_API_PROXY_TARGET', `http://${target}`)
      await expect(sourceIssueApi.create({ sourceIds: [issue.sourceId], description: '缺数' })).rejects.toThrow('生产环境写保护')
      await expect(sourceIssueApi.handle(issue.id)).rejects.toThrow('生产环境写保护')
      expect(fetcher).not.toHaveBeenCalled()
    },
  )

  it.each(['', 'http://app186:9999'])('同域 2806 按实际请求地址拦截写操作（构建目标 %j），分页正常', async target => {
    vi.stubEnv('VITE_API_PROXY_TARGET', '')
    vi.stubEnv('VITE_AUTH_PROXY_TARGET', target)
    jsdom.reconfigure({ url: 'http://47.120.11.60:2806/sjcj/#/monitor?tab=sourceIssues' })
    await expect(sourceIssueApi.create({ sourceIds: [issue.sourceId], description: '缺数' })).rejects.toThrow('生产环境写保护')
    await expect(sourceIssueApi.handle(issue.id)).rejects.toThrow('生产环境写保护')
    expect(fetcher).not.toHaveBeenCalled()
    fetcher.mockResolvedValueOnce(reply({ code: 0, data: [issue], count: 1 }))
    await expect(sourceIssueApi.paged(query)).resolves.toEqual({ list: [issue], total: 1 })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('186 开发目标允许真实登记和处理', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://124.223.180.186:9999')
    const handled = { ...issue, state: 1, handledBy: 'operator' }
    fetcher.mockResolvedValueOnce(reply({ success: true, code: '0', data: [issue] }))
      .mockResolvedValueOnce(reply({ success: true, code: '0', data: handled }))
    await expect(sourceIssueApi.create({ sourceIds: [issue.sourceId], description: '缺数' })).resolves.toEqual([issue])
    await expect(sourceIssueApi.handle(issue.id)).resolves.toEqual(handled)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
