// @vitest-environment jsdom
// 源检查（数据源告警）在 api/monitor.ts 这一层的真实 HTTP 契约。
// 逐条对齐旧平台 data-view/src/api/monitor.js 的方法与参数位置——这套东西最容易在迁移里
// 被"顺手写成更顺手的形状"（比如把 ids 塞 body、把 page/limit 写成 pageNo/pageSize），
// 而这类偏差在 mock 模式下一律看不见，只有真发请求才炸。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response
}

/** 取出第 n 次 fetch 的 (pathname, searchParams, init)，省得每条用例重复解包 */
function callAt(fetchMock: ReturnType<typeof vi.fn>, n = 0) {
  const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit]
  const parsed = new URL(url, 'http://local.test')
  return { path: parsed.pathname, q: parsed.searchParams, init }
}

describe('源检查 HTTP 契约（对齐旧 api/monitor.js）', () => {
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

  it('分页列表 GET，条件与 page/limit 全在 query，不发 size/pageNo/pageSize', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', count: 1, data: [{ id: 'ck-1', name: '日增量监控' }] }))
    const { pagedSourceCheck } = await import('./monitor')

    const res = await pagedSourceCheck({
      sourceId: '391007770', enable: '0', state: 'E', name: '增量', page: 2, limit: 30,
    })

    const { path, q, init } = callAt(fetchMock)
    expect(init.method).toBe('GET')
    expect(path).toBe('/api/v1/source/check/paged')
    expect(q.get('sourceId')).toBe('391007770')
    expect(q.get('enable')).toBe('0')
    expect(q.get('state')).toBe('E')
    expect(q.get('name')).toBe('增量')
    expect(q.get('page')).toBe('2')
    expect(q.get('limit')).toBe('30')
    for (const bad of ['size', 'pageNo', 'pageSize']) expect(q.has(bad)).toBe(false)
    expect(res.total).toBe(1)
    expect(res.list[0]).toMatchObject({ id: 'ck-1' })
  })

  it('分页列表也接受旧口径的 pageNo/pageSize（适配层映射成 page/limit）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', count: 0, data: [] }))
    const { pagedSourceCheck } = await import('./monitor')

    await pagedSourceCheck({ pageNo: 3, pageSize: 100 } as never)

    const { q } = callAt(fetchMock)
    expect(q.get('page')).toBe('3')
    expect(q.get('limit')).toBe('100')
  })

  it('历史日志 GET，sourceId/jobId/state/name + page/limit 全在 query', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', count: 1, data: [{ logId: 'log-1' }] }))
    const { pagedCheckJobLogs } = await import('./monitor')

    await pagedCheckJobLogs({ sourceId: '391007770', jobId: '8', state: 'E', name: '增量', page: 1, limit: 20 })

    const { path, q, init } = callAt(fetchMock)
    expect(init.method).toBe('GET')
    expect(path).toBe('/api/v1/source/check/paged-logs')
    expect(q.get('sourceId')).toBe('391007770')
    expect(q.get('jobId')).toBe('8')
    expect(q.get('state')).toBe('E')
    expect(q.get('name')).toBe('增量')
    expect(q.get('page')).toBe('1')
    expect(q.get('limit')).toBe('20')
    expect(q.has('size')).toBe(false)
  })

  it('启停 GET ?ids=&enable=：想启用发 0、想停用发 1（与 isDelete 同向）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '操作成功' }))
    const { changeSourceCheckEnable } = await import('./monitor')

    await changeSourceCheckEnable(['a', 'b'], true)
    let call = callAt(fetchMock, 0)
    expect(call.init.method).toBe('GET')
    expect(call.path).toBe('/api/v1/source/check/changeEnable')
    expect(call.q.get('ids')).toBe('a,b')
    expect(call.q.get('enable')).toBe('0')

    await changeSourceCheckEnable(['c'], false)
    call = callAt(fetchMock, 1)
    expect(call.q.get('ids')).toBe('c')
    expect(call.q.get('enable')).toBe('1')
  })

  it('立即运行 GET ?ids=a,b（无 body）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '已处理' }))
    const { handleRunNow } = await import('./monitor')

    await handleRunNow(['a', 'b'])

    const { path, q, init } = callAt(fetchMock)
    expect(init.method).toBe('GET')
    expect(path).toBe('/api/v1/source/check/runNow')
    expect(q.get('ids')).toBe('a,b')
    expect(init.body).toBeUndefined()
  })

  it('删除 POST 但 ids 走 query（旧契约就是 post + params，不是 body）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '删除 2 条成功' }))
    const { deleteSourceCheck } = await import('./monitor')

    await deleteSourceCheck(['a', 'b'])

    const { path, q, init } = callAt(fetchMock)
    expect(init.method).toBe('POST')
    expect(path).toBe('/api/v1/source/check/delete')
    expect(q.get('ids')).toBe('a,b')
    expect(init.body).toBeUndefined()
  })

  it('新增 / 修改 / 验证走 POST + JSON body，字段原样透传', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: 'ok' }))
    const { addSourceCheck, updateSourceCheck, checkOneManual } = await import('./monitor')

    const addPayload = { sourceId: 's1', isDelete: 0, name: '监控A', tableName: 't', schedule: '0 0 * * * ?', checkConf: '{"a":1}' }
    await addSourceCheck(addPayload)
    let call = callAt(fetchMock, 0)
    expect(call.init.method).toBe('POST')
    expect(call.path).toBe('/api/v1/source/check/add')
    expect(call.q.toString()).toBe('')
    expect(JSON.parse(String(call.init.body))).toEqual(addPayload)

    const updatePayload = { id: 'ck-1', name: '监控B', isDelete: 1 }
    await updateSourceCheck(updatePayload)
    call = callAt(fetchMock, 1)
    expect(call.init.method).toBe('POST')
    expect(call.path).toBe('/api/v1/source/check/update')
    expect(JSON.parse(String(call.init.body))).toEqual(updatePayload)

    const onePayload = { sourceId: 's1', tableName: 't', checkConf: '{}' }
    await checkOneManual(onePayload)
    call = callAt(fetchMock, 2)
    expect(call.init.method).toBe('POST')
    expect(call.path).toBe('/api/v1/source/check/check-one')
    expect(JSON.parse(String(call.init.body))).toEqual(onePayload)
  })

  it('定时预览 GET /v1/source/lastRun，cron 里的 */? / 空格都编码，返回裸数组', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: ['2026-10-12 18:00:00', '2026-10-12 19:00:00'] }))
    const { checkCron } = await import('./monitor')

    const runs = await checkCron('0 0 6-22 * * ?')

    const { path, q, init } = callAt(fetchMock)
    expect(init.method).toBe('GET')
    expect(path).toBe('/api/v1/source/lastRun')
    expect(q.get('cron')).toBe('0 0 6-22 * * ?')
    expect(runs).toEqual(['2026-10-12 18:00:00', '2026-10-12 19:00:00'])
  })
})
