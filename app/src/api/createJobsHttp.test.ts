// @vitest-environment jsdom
// 批量配定时（旧源列表「定时任务变更 → 批量配定时」）的真实 HTTP 契约。
// 对齐旧 data-view `SourceCron.vue` + `api/source-job.js saveSourceCron`：
// POST /v1/source/createJobs，参数全在 query；configId 必须在场、可为空串（186 实测不带报 not present）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendQuery } from './client'
import { createJobsToLegacy } from './legacyAdapters'

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response
}

describe('createJobsToLegacy · 旧字段映射', () => {
  it('ids 逗号串、configId 空串、flowId 空 → 0、monitorAfter 默认 30', () => {
    expect(createJobsToLegacy({ sourceIds: ['430023165', '', '391008041'], cron: ' 0 0 3 * * ? ', enable: true, monitorEnable: false })).toEqual({
      ids: '430023165,391008041',
      cron: '0 0 3 * * ?',
      enable: true,
      monitorEnable: false,
      monitorAfter: 30,
      flowId: 0,
      configId: '',
    })
  })

  it('指定流程转数字，监控参数原样带', () => {
    expect(createJobsToLegacy({ sourceIds: ['1'], cron: '0 0 3 * * ?', enable: false, monitorEnable: true, monitorAfter: 45, flowId: '402330' }))
      .toMatchObject({ enable: false, monitorEnable: true, monitorAfter: 45, flowId: 402330 })
  })
})

describe('appendQuery · keepEmpty', () => {
  it('列出的键保留空串，其它空串照旧跳过', () => {
    expect(appendQuery('/x', { a: '', configId: '', b: 1 }, ['configId'])).toBe('/x?configId=&b=1')
    expect(appendQuery('/x', { a: '', configId: '' })).toBe('/x')
  })
})

describe('sourceApi.createJobs · HTTP', () => {
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

  it('POST，参数全在 query（含 configId=），body 为空', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: '0', msg: '处理成功', data: null }))
    const { sourceApi } = await import('./index')

    const ack = await sourceApi.createJobs({
      sourceIds: ['430023165', '391008041'], cron: '0 0 3 1 1 ?', enable: false, monitorEnable: true, monitorAfter: 35, flowId: '402330',
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const parsed = new URL(url, 'http://local.test')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
    expect(parsed.pathname).toBe('/api/v1/source/createJobs')
    expect(url).toContain('configId=')
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      ids: '430023165,391008041',
      cron: '0 0 3 1 1 ?',
      enable: 'false',
      monitorEnable: 'true',
      monitorAfter: '35',
      flowId: '402330',
      configId: '',
    })
    expect(ack.ok).toBe(true)
  })

  it('后端 success:false（流程未关联）→ 抛错并带后端原因', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, code: '-1', msg: '以下源无法按所选流程调度（未关联或ROOT缺失），未创建任何调度：430023165', data: null }))
    const { sourceApi } = await import('./index')

    await expect(sourceApi.createJobs({ sourceIds: ['430023165'], cron: '0 0 3 * * ?', enable: true, monitorEnable: false, flowId: '819519' }))
      .rejects.toThrow('以下源无法按所选流程调度')
  })

  it('没有源或没有表达式不发请求', async () => {
    const { sourceApi } = await import('./index')
    expect(await sourceApi.createJobs({ sourceIds: [], cron: '0 0 3 * * ?', enable: true, monitorEnable: false })).toMatchObject({ ok: false })
    expect(await sourceApi.createJobs({ sourceIds: ['1'], cron: '  ', enable: true, monitorEnable: false })).toMatchObject({ ok: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
