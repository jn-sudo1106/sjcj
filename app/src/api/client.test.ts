// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCESS_TOKEN_HEADER, writeStoredToken } from './auth'

function jsonResponse(body: unknown) {
  // request() 现在先 res.text() 再 JSON.parse（client.ts 空响应体兜底），mock 也要跟着给 text()
  return { ok: true, status: 200, redirected: false, url: '', json: async () => body, text: async () => JSON.stringify(body) } as Response
}

// S1（计划 §12.2）：会话失效 302 → /apiapi/logout.htm，与认证客户端共用同一检测逻辑
function redirectedToLogout() {
  return {
    ok: false,
    status: 500,
    redirected: true,
    url: 'http://118.25.96.217:9999/apiapi/logout.htm',
    json: async (): Promise<unknown> => {
      throw new Error('no body')
    },
  } as Response
}

describe('业务 API 真实请求鉴权', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
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

  it('默认走同源 /api/v1/，携带 Cookie 与 Access-Token', async () => {
    writeStoredToken('tok-business')
    fetchMock.mockResolvedValue(jsonResponse({ total: 0, list: [] }))
    const { request } = await import('./client')

    await request('source/sourcePaged', { page: 1 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/source/sourcePaged')
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>)[ACCESS_TOKEN_HEADER]).toBe('tok-business')
  })

  // 实测撞见：vrule AI 编辑网关有时 2xx 但响应体为空，res.json() 直接解析空字符串会抛
  // "Unexpected end of JSON input"（S6-1 联调时报出，client.ts 修 res.text()+按需 JSON.parse 兜底）
  // 2026-09-24 生产整体 502（nginx 在、后端没起来）：原提示「请求异常 [x]: 请求失败 502」用户看不懂
  function htmlError(status: number) {
    return {
      ok: false, status, redirected: false, url: '',
      json: async (): Promise<unknown> => { throw new Error('not json') },
      clone() { return this },
      text: async () => '<html><body><h1>An error occurred.</h1><em>Faithfully yours, nginx.</em></body></html>',
    } as unknown as Response
  }

  it.each([502, 503, 504])('网关错误 %i：提示「后端服务暂时不可用，请稍后重试」，括号里留状态码和端点', async (status) => {
    fetchMock.mockResolvedValue(htmlError(status))
    const { request } = await import('./client')
    await expect(request('sourceType/update', {}, { method: 'POST' }))
      .rejects.toThrow(`后端服务暂时不可用，请稍后重试（${status} sourceType/update）`)
  })

  it('500 和其他错误保持原提示', async () => {
    fetchMock.mockResolvedValue(htmlError(500))
    const { request } = await import('./client')
    await expect(request('sourceType/update', {}, { method: 'POST' })).rejects.toThrow('请求异常 [sourceType/update]: 请求失败 500')
  })

  it('502 但后端带了业务 msg：照原文展示后端给的原因', async () => {
    const res = htmlError(502) as unknown as { json: () => Promise<unknown> }
    res.json = async () => ({ code: '-1', msg: '下游服务超时：vrule' })
    fetchMock.mockResolvedValue(res)
    const { request } = await import('./client')
    await expect(request('rule/run', {}, { method: 'POST' })).rejects.toThrow('请求失败 502: 下游服务超时：vrule')
  })

  it('2xx 但响应体为空：按 null 处理，不抛 JSON 解析异常', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, redirected: false, url: '', text: async () => '' } as Response)
    const { request } = await import('./client')

    await expect(request('file/upload', {})).resolves.toBeNull()
  })

  it('2xx 但响应体是非空的非法 JSON：仍然抛错，不静默吞掉', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, redirected: false, url: '', text: async () => '不是 JSON' } as Response)
    const { request } = await import('./client')

    await expect(request('file/upload', {})).rejects.toThrow()
  })

  // M3-0K（2026-08-18 实测）：业务失败常见形态是 HTTP 200 + envelope code!=='0'，不是传输层 5xx；
  // envelope.data 有时带比 msg 更具体的诊断（真实样例：nextStep 的 cond 语法错误，msg 只有
  // "错误信息:运行时异常"，data 却是解释器报错 "<Long, 1> can't be a left value for assignment."）。
  it('业务失败（code!=0）时，envelope.data 是非空字符串则拼进错误信息，而不是被丢弃', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: false, code: '500', msg: '错误信息:运行时异常',
      data: "<Long, 1> can't be a left value for assignment.",
    }))
    const { request } = await import('./client')

    await expect(request('source/nextStep', {})).rejects.toThrow(
      "错误信息:运行时异常：<Long, 1> can't be a left value for assignment.",
    )
  })

  it('业务失败时 envelope.data 为空/非字符串（如 null）：只用 msg，不拼出多余的"："', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, code: '500', msg: '没有详情配置', data: null }))
    const { request } = await import('./client')

    await expect(request('source/nextStep', {})).rejects.toThrow('没有详情配置')
  })

  it('可为未迁移业务域强制走 Mock，不影响全局真实接口模式', async () => {
    const { request } = await import('./client')

    const result = await request<{ total: number; list: unknown[] }>(
      'site/sitePaged',
      { page: 1, size: 10 },
      { mode: 'mock' },
    )

    expect(result.total).toBeGreaterThan(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('兼容旧平台 GET 查询参数与业务响应包裹', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: { paramId: '1035' } }))
    const { request } = await import('./client')

    const result = await request<{ paramId: string }>(
      'config/paramDetail',
      { paramId: '1035', empty: undefined },
      { method: 'GET' },
    )

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/config/paramDetail?paramId=1035')
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect(result).toEqual({ paramId: '1035' })
  })

  it('data 是标量（如 0）时不吞掉 msg——2026-08-19 nextStep2 真实联调实测', async () => {
    // 真实响应：{success:true, code:"0", msg:"操作成功，请等待处理，本次发送:0 条任务", data:0}
    // data:0 是"本次发送 0 条"的诊断数字，不是调用方要的载荷；旧逻辑 `data !== null` 对 0 成立，
    // 把标量 0 当整个响应体返回，msg 被静默丢弃，UI 只能落到兜底文案"操作已提交（演示）"。
    // 1008-10：标量 data 一并带回（data 字段），供同步服务 add 类接口展示新增记录 id；nextStep2 只读 message 不受影响。
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: '0', msg: '操作成功，请等待处理，本次发送:0 条任务', data: 0 }))
    const { request } = await import('./client')

    const result = await request<{ message?: string }>('source/nextStep2', {}, { method: 'POST' })

    expect(result).toEqual({ ok: true, message: '操作成功，请等待处理，本次发送:0 条任务', data: 0 })
  })

  it('把真实后端分页响应（count 字段）转换为新平台分页结构', async () => {
    // 实测修正（2026-07-17 T3）：真实后端返回 count，不是脚手架注释写的 totalCount
    // （旧 s-table 组件 components/table/index.js:160 读的也是 r.count）
    fetchMock.mockResolvedValue(jsonResponse({ code: 0, msg: null, count: 2, data: [{ paramId: '1' }], exts: null }))
    const { request } = await import('./client')

    const result = await request<{ total: number; list: { paramId: string }[] }>(
      'config/paramPaged',
      { page: 2, limit: 10 },
      { method: 'GET' },
    )

    expect(result).toEqual({ total: 2, list: [{ paramId: '1' }] })
  })

  it('totalCount 字段兜底：若某分页端点确实返回 totalCount 仍可正确转换', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: [{ paramId: '1' }], totalCount: 17 }))
    const { request } = await import('./client')

    const result = await request<{ total: number; list: { paramId: string }[] }>(
      'config/paramPaged',
      { page: 2, limit: 10 },
      { method: 'GET' },
    )

    expect(result).toEqual({ total: 17, list: [{ paramId: '1' }] })
  })

  it('旧平台业务错误沿用后端消息', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '-1', msg: '参数不存在', data: null }))
    const { request } = await import('./client')

    await expect(request('config/paramDetail', { paramId: 'missing' }, { method: 'GET' })).rejects.toThrow(
      '参数不存在',
    )
  })

  it('S1：业务接口 302 落地 logout.htm 触发与认证客户端相同的会话失效处理器', async () => {
    fetchMock.mockResolvedValue(redirectedToLogout())
    const { setUnauthorizedHandler } = await import('./auth')
    const onExpired = vi.fn()
    setUnauthorizedHandler(onExpired)
    const { request } = await import('./client')

    await expect(request('source/sourcePaged', { page: 1 })).rejects.toThrow('登录失效,请重新登录')
    expect(onExpired).toHaveBeenCalledTimes(1)
  })
})

// 按端点逐个上线机制（2026-07-20）：全局默认 mock，endpoints.ts 标 live:true 的端点自动逃逸走真实，
// 其余端点（尚未联调验证的功能）继续走 mock——避免像 VITE_API_MODE=http 那样一刀切影响未接入的页面。
describe('按端点上线：全局仍 mock 时，live 端点照样走真实 HTTP', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('VITE_API_MODE', 'mock')
    vi.stubEnv('VITE_API_BASE', '')
    // vitest.config.ts 默认关掉这套机制（避免撞上其它未打 fetch mock 的既有测试），这里专门测它本身要重新打开
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('已标 live 的参数端点（config/paramPaged）绕过全局 mock，真的发 fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 0, msg: null, count: 0, data: [], exts: null }))
    const { request } = await import('./client')

    await request('config/paramPaged', { page: 1, limit: 10 }, { method: 'GET' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/config/paramPaged')
  })

  it('未标 live 的端点（source/stats）在全局 mock 下继续走 mock，不发 fetch', async () => {
    const { request } = await import('./client')

    await request('source/stats', { page: 1 })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('options.mode==="mock" 的强制 mock 优先级高于 live 标记（未迁移业务域即便误标也不会被打真实）', async () => {
    const { request } = await import('./client')

    await request('config/paramPaged', { page: 1 }, { mode: 'mock' })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('options.mode==="http" 在全局 mock 下仍发 fetch（生产新建等单次逃逸，不切全局 http）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: null }))
    const { request } = await import('./client')

    await request('site/add', { siteName: 'x' }, { mode: 'http', method: 'POST' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/site/add')
  })

  it('vrule 绝对路径 httpEndpoint 时 live 以逻辑键为准（/vrule/... 不在清单）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: { id: 1 } }))
    const { request } = await import('./client')

    await request('rule/orchestrationSaveMeta', {}, {
      method: 'POST',
      httpEndpoint: '/vrule/api/custom-compose/save',
      httpParams: { state: 1 },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/vrule/api/custom-compose/save')
  })
})

// 生产写守卫：代理指向生产（118.25.96.217）时，danger 端点只放行新建网站/源/配置及编排元数据，改删一律拦截。
describe('生产写守卫', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
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

  it('未连生产时，danger 端点正常发出', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://127.0.0.1:9999')
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: null }))
    const { request } = await import('./client')

    await request('task/resetTaskInsts', { ids: '1' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('连生产时，不在白名单的 danger 端点被拦截，不发 fetch', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    const { request, ProductionWriteBlockedError } = await import('./client')

    await expect(request('dataset/delete', { id: '1' })).rejects.toThrow(/写保护|不在允许清单/)
    expect(fetchMock).not.toHaveBeenCalled()

    // 拦截发生在网络请求之前，抛出的错误信息里必须点名具体端点，方便排查是哪次调用被挡
    try {
      await request('dataset/delete', { id: '1' })
    } catch (e) {
      expect((e as Error).message).toContain('dataset/delete')
    }
    void ProductionWriteBlockedError
  })

  it('连生产时，task/resetTaskInsts 在白名单内（任务重发，只重排队不改删，2026-08-13 实测）', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }))
    const { request } = await import('./client')

    await request('task/resetTaskInsts', { ids: '1' }, { method: 'GET', httpParams: { ids: '1' } })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('连生产时，config/modify/updateConfig 在白名单内（2026-08-28 拍板放开新建+保存配置）', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: null }))
    const { request } = await import('./client')

    await request('config/modify/updateConfig', { config: { configName: 'x' } }, { method: 'POST', httpParams: { configName: 'x' } })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('连生产时，entry/entryDelete 与 entry/entryDeleteBatch 在白名单内（源数据视图删除数据，2026-09-09 放开）', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: { success: 1 } }))
    const { request } = await import('./client')

    await request('data/rowDelete', { tableId: '900', sourceId: '1', all: 1 }, {
      method: 'GET',
      httpEndpoint: 'entry/entryDelete',
      httpParams: { entryTypeId: '900', sourceId: '1', all: 1, key: 9 },
    })
    await request('data/rowDeleteBatch', { tableId: '900', ids: ['1'] }, {
      method: 'POST',
      httpEndpoint: 'entry/entryDeleteBatch',
      httpParams: { ids: ['1'], entryTypeId: '900' },
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/entry/entryDelete')
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/v1/entry/entryDeleteBatch')
  })

  it('连生产时，source/nextStep 与 source/nextStep2 在白名单内（数据视图发后续，与发抓取同性质）', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '已提交', data: null }))
    const { request } = await import('./client')

    await request('data/nextStep', { sourceId: '1', tableId: '900', entryIds: ['1'] }, {
      method: 'GET',
      httpEndpoint: 'source/nextStep',
      httpParams: { sourceId: '1', entryTypeId: '900', entryIds: '1' },
    })
    await request('data/nextStepBatch', { tableId: '900', sourceId: '1', size: 1, start: 0 }, {
      method: 'POST',
      httpEndpoint: 'source/nextStep2',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/source/nextStep')
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/v1/source/nextStep2')
  })

  it('连生产时，source/markBatch 与 source/setColor 在白名单内（问题标记入库，旧平台可见）', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: null }))
    const { request } = await import('./client')

    // markBatch 才是真实路径（2026-09-01 实测报错才发现 source/tagSource 是臆造的端点名，真机 500）
    await request('source/tagSource', { ids: ['1'], tags: '正文缺失' }, { httpEndpoint: 'source/markBatch' })
    await request('source/setColor', { ids: '1', flag: 2, isClear: 0 }, { method: 'GET', httpEndpoint: 'source/setColor' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('连生产时，config/copyAll 在白名单内（「复制节点 = 新增一套配置」的实现，纯新增）', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: null }))
    const { request } = await import('./client')

    await request('config/copyAll', { configId: '1' }, { method: 'GET', httpParams: { id: '1' } })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('连生产时，item/next 步骤写接口在白名单内（节点名 / 进入条件 / 增删节点）', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: null }))
    const { request } = await import('./client')

    await request('item/next/stepModify', { itemConfig: 40600 }, { method: 'POST', httpEndpoint: 'item/next/stepModify' })
    await request('item/next/saveItemConfig', { name: 'x' }, { method: 'POST', httpEndpoint: 'item/next/saveItemConfig', paramsIn: 'query' })
    await request('item/next/enable', { id: '40600', state: '0' }, { method: 'GET', httpEndpoint: 'item/next/enable' })
    await request('item/next/delete', { id: '40600' }, { method: 'GET', httpEndpoint: 'item/next/delete' })

    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('连生产时，新建网站/源/配置及编排元数据在白名单内，正常放行', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: null }))
    const { request } = await import('./client')

    await request('site/add', { siteName: 'x' })
    await request('snatch/snatchSave', { sourceName: 'x' }, { httpEndpoint: 'snatch/snatchSave' })
    await request('source/bindSite', { sourceId: '1', siteId: '2' }, { httpEndpoint: 'source/bindSite' })
    await request('rule/orchestrationSaveMeta', {}, {
      httpEndpoint: '/vrule/api/custom-compose/save',
      httpParams: { ruleName: '编排测试' },
    })

    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('连生产时，源启停、换网站和复制源在白名单内（侧栏 / 源视图每天在用）', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: null }))
    const { request } = await import('./client')

    await request('source/changeEnable', { ids: '1', enable: 1 }, { method: 'GET', httpEndpoint: 'source/changeEnable' })
    await request('source/changeSite', { ids: '1', siteId: '2' }, { method: 'GET', httpEndpoint: 'source/changeSite' })
    await request('source/copySource', { sourceId: '1', name: 'x', url: 'http://x', flag: 1 }, { method: 'GET', httpEndpoint: 'source/copySource' })

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  // 2026-09-22：用户在生产点「新建表 → 确定」毫无反应，根因是这两个端点不在白名单、
  // 守卫在发请求前就拦了，而调用处当时没 catch。拍板新建和修改都放开。
  it('连生产时，数据表的新建与修改在白名单内（画布「表配置」每天在用）', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: null }))
    const { request } = await import('./client')

    await request('config/entryTypeAddAll', { name: 'x' }, { method: 'POST', httpEndpoint: 'config/entryTypeAddAll' })
    await request('config/modifyEntryType', { type: '1' }, { method: 'POST', httpEndpoint: 'config/modifyEntryType' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // 2026-10-10 拍板：来源组写接口除「按筛选范围调整」外都放开
  it('连生产时，来源组写接口放行，按范围调整成员仍拦截', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: null }))
    const { request } = await import('./client')

    for (const endpoint of ['add', 'update', 'delete', 'changeMembers', 'bindFlows', 'updateBindingState']) {
      await request(`source-group/${endpoint}`, {}, { method: 'POST', httpEndpoint: `source-group/${endpoint}` })
    }
    expect(fetchMock).toHaveBeenCalledTimes(6)

    await expect(request('source-group/changeMembersByRange', {}, {
      method: 'POST', httpEndpoint: 'source-group/changeMembersByRange', paramsIn: 'query',
    })).rejects.toThrow(/禁止改删/)
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('连生产时，未放行的改删仍拦截', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    const { request } = await import('./client')

    await expect(request('site/updateSite', { siteId: '1' })).rejects.toThrow(/禁止改删/)
    await expect(request('config/delete', { id: '1' })).rejects.toThrow(/禁止改删/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('连生产时，文件上传端点直接放行，旧脚本编辑端点不再放行', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: null }))
    const { request } = await import('./client')

    await request('file/upload', {}, {
      httpEndpoint: '/api/file/upload',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await expect(request('file/upload', {}, {
      httpEndpoint: '/vrule/ai/dashscope/script/edit',
      method: 'POST',
    })).rejects.toThrow(/禁止改删/)
})

  it('非 danger 端点即使连生产也不受影响（只读请求正常发出）', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: [] }))
    const { request } = await import('./client')

    await request('source/sourcePaged', { page: 1 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('isProductionBackend 按 VITE_API_PROXY_TARGET 主机名判定，VITE_AUTH_PROXY_TARGET 作为兼容兜底', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', '')
    vi.stubEnv('VITE_AUTH_PROXY_TARGET', 'http://118.25.96.217:9999')
    const { isProductionBackend } = await import('./client')

    expect(isProductionBackend()).toBe(true)
  })

  it('isProductionCreateEnabled 需要同时指向生产并打开新建开关', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    vi.stubEnv('VITE_SITE_CREATE_TARGET', 'production')
    const { isProductionCreateEnabled } = await import('./client')
    expect(isProductionCreateEnabled()).toBe(true)
  })

  it('只连生产但未打开新建开关时，isProductionCreateEnabled 为 false', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    vi.stubEnv('VITE_SITE_CREATE_TARGET', '')
    const { isProductionCreateEnabled } = await import('./client')
    expect(isProductionCreateEnabled()).toBe(false)
  })

  it('连本地开发环境 186 并打开新建开关时，isProductionCreateEnabled 为 true（2026-10-12：186 开发环境全放行）', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://124.223.180.186:9999')
    vi.stubEnv('VITE_SITE_CREATE_TARGET', 'production')
    const { isProductionCreateEnabled, isProductionBackend } = await import('./client')

    expect(isProductionBackend()).toBe(false) // 186 不是生产：写保护/徽标不应生效
    expect(isProductionCreateEnabled()).toBe(true) // 但可真实新建采集
  })

  it('连本地开发环境 186 但未打开新建开关时，isProductionCreateEnabled 为 false', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://124.223.180.186:9999')
    vi.stubEnv('VITE_SITE_CREATE_TARGET', '')
    const { isProductionCreateEnabled } = await import('./client')
    expect(isProductionCreateEnabled()).toBe(false)
  })
})
