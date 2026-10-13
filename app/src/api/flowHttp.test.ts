// @vitest-environment jsdom
// cs_flow（/v1/flow/*）的真实 HTTP 契约。2026-09-02 接入时**没有做过真机联调**——
// 匿名探测被登录过滤器 302 拦下，确认不了部署状态。所以这里按旧平台 src/api/flow.js 的
// 实际调用形状逐条锁死：真机第一次联调如果对不上，改的应该是这里 + 实现，而不是悄悄放宽断言。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response
}

describe('flow 流程 HTTP 契约', () => {
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

  it('POST /v1/flow/flowPaged：page/limit 走 body，回填计算列 sourceCnt', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: 0,
      count: 12,
      data: [{
        flowId: 1001,
        flowName: '网页抓取流程',
        flowType: 'WEB_SNATCH',
        updateDt: '2026-09-01 10:00:00',
        sourceCnt: 12,
      }],
    }))
    const { flowCenterApi } = await import('./index')
    const page = await flowCenterApi.paged({ page: 2, size: 50 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(url, 'http://local.test').pathname).toBe('/api/v1/flow/flowPaged')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ page: 2, limit: 50, field: 'updateDt', order: 'desc' })
    expect(page.total).toBe(12)
    expect(page.list[0]).toMatchObject({ id: '1001', name: '网页抓取流程', sourceCnt: 12 })
    // 列表接口不返回 flowConf，definition 只能是空流程——别让调用方以为拿到了画布
    expect(page.list[0].definition).toEqual({ main: [], branches: [], configs: {}, branchGroups: [] })
    // cs_flow 没有版本列
    expect(page.list[0].version).toBeUndefined()
  })

  it('GET /v1/flow/flowList：下拉候选走全量不分页端点，不再拿 flowPaged 拼（500 条在 186 要 30s 超时）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      code: null,
      msg: null,
      data: [
        { flowId: 1001, flowName: '网页抓取流程', state: 'C' },
        { flowId: 1002, flowName: '公众号流程', state: 'C' },
      ],
    }))
    const { flowCenterApi } = await import('./index')
    const list = await flowCenterApi.list()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(url, 'http://local.test').pathname).toBe('/api/v1/flow/flowList')
    expect(init.method).toBe('GET')
    expect(list.map((f) => [f.id, f.name])).toEqual([['1001', '网页抓取流程'], ['1002', '公众号流程']])
  })

  it('GET /v1/flow/flowDetail：flowId 走 query，flowConf 字符串解析回 definition', async () => {
    const definition = { main: ['start', 'n1', 'end'], branches: [], configs: { n1: { title: '列表页' } }, branchGroups: [] }
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      code: null,
      msg: null,
      data: { flowId: 1001, flowName: '网页抓取流程', flowConf: JSON.stringify(definition), updateDt: '2026-09-01 10:00:00', sourceCnt: 3 },
    }))
    const { flowCenterApi } = await import('./index')
    const flow = await flowCenterApi.detail('1001')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const parsed = new URL(url, 'http://local.test')
    expect(parsed.pathname).toBe('/api/v1/flow/flowDetail')
    expect(parsed.searchParams.get('flowId')).toBe('1001')
    expect(init.method).toBe('GET')
    expect(flow?.definition.main).toEqual(['start', 'n1', 'end'])
    expect(flow?.sourceCnt).toBe(3)
  })

  // client.normalizeHttpPayload 靠 `'code' in envelope` 决定要不要拆信封。flowDetail 成功时
  // code 是 null（不是缺省，见 flow_api.md §二），所以能拆。这条把这个依赖钉住：
  // 真实响应哪天不带 code 键了，data 会原样透传，flowId 取不到、id 变空串，而且不报错。
  it('flowDetail 响应缺 code 键时不会静默产出空 id 的流程', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { flowId: 1001, flowName: '网页抓取流程' } }))
    const { flowCenterApi } = await import('./index')
    const flow = await flowCenterApi.detail('1001')
    expect(flow?.id).toBe('')
  })

  // 0917-09 / R1：源上挂着一个已被删除的 flowId 时，后端不是回 data:null，而是回一个**业务失败**
  // （2026-09-21 生产实测 flowId=999999999：HTTP 200 + success:false + code:'-1' +
  // msg「未找到相关流程 flowId=999999999」）。画布头要靠"查不到"和"请求坏了"的区别决定
  // 显不显示「流程已删除」，所以这一种必须翻译成 null。
  it('flowDetail 对不存在的 flowId（code -1 / 未找到相关流程）返回 null，不抛错', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, code: '-1', msg: '未找到相关流程 flowId=999999999', data: null }))
    const { flowCenterApi } = await import('./index')
    await expect(flowCenterApi.detail('999999999')).resolves.toBeNull()
  })

  // 只吞"未找到"这一种。别的业务失败照抛——否则权限、参数错都会被画布头说成"流程已删除"
  it('flowDetail 遇到其它业务失败仍然抛错', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, code: '-1', msg: '没有权限查看该流程', data: null }))
    const { flowCenterApi } = await import('./index')
    await expect(flowCenterApi.detail('1001')).rejects.toThrow('没有权限查看该流程')
  })

  // 旧平台流程管理页的「重置模板」会把 flowConf 写成 {"states":{},"paths":{}}（更早的画布格式），
  // 人手改坏也可能。认不出就当空流程，绝不让流程列表整页崩。
  it('flowConf 是旧格式 / 坏 JSON / 空时一律回退空流程，不抛异常', async () => {
    const { flowDefinitionFromConf } = await import('./legacyAdapters')
    const blank = { main: [], branches: [], configs: {}, branchGroups: [] }
    expect(flowDefinitionFromConf('{"states":{},"paths":{}}')).toEqual(blank)
    expect(flowDefinitionFromConf('{ 这不是 JSON')).toEqual(blank)
    expect(flowDefinitionFromConf('')).toEqual(blank)
    expect(flowDefinitionFromConf(null)).toEqual(blank)
  })

  it('POST /v1/flow/saveFlow：新增不带 flowId，新 ID 从 msg 里取再回查详情', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', msg: '保存成功，id:2001', data: null }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        code: null,
        data: { flowId: 2001, flowName: '新流程', flowConf: '{"main":["start","end"],"branches":[],"configs":{}}', updateDt: '2026-09-02 10:00:00' },
      }))
    const { flowCenterApi } = await import('./index')
    const saved = await flowCenterApi.save({ name: '  新流程  ', definition: { main: ['start', 'end'], branches: [], configs: {} } })

    const [saveUrl, saveInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(saveUrl, 'http://local.test').pathname).toBe('/api/v1/flow/saveFlow')
    const body = JSON.parse(String(saveInit.body))
    expect('flowId' in body).toBe(false)
    expect(body.flowName).toBe('新流程')
    // definition 以 JSON 串写进 flowConf；后端只当不透明字符串存
    expect(JSON.parse(body.flowConf).main).toEqual(['start', 'end'])
    // 第二发是回查详情
    expect(new URL(String(fetchMock.mock.calls[1][0]), 'http://local.test').pathname).toBe('/api/v1/flow/flowDetail')
    expect(saved.id).toBe('2001')
  })

  it('POST /v1/flow/saveFlow：带 id 是修改，不再靠 msg 解析 ID', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', msg: '保存成功，id:1001', data: null }))
      .mockResolvedValueOnce(jsonResponse({ success: true, code: null, data: { flowId: 1001, flowName: '改名后', flowConf: null } }))
    const { flowCenterApi } = await import('./index')
    const saved = await flowCenterApi.save({ id: '1001', name: '改名后', definition: { main: [], branches: [], configs: {} } })
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)).flowId).toBe('1001')
    expect(saved.name).toBe('改名后')
  })

  it('保存失败时抛后端原文，不返回一条假记录', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, code: '-1', msg: '流程名称不能为空', data: null }))
    const { flowCenterApi } = await import('./index')
    await expect(flowCenterApi.save({ name: 'x', definition: { main: [], branches: [], configs: {} } }))
      .rejects.toThrow('流程名称不能为空')
  })

  it('修改已发布流程后采用服务端返回的新草稿 ID 回查，不读取旧发布版本', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', msg: '保存成功，id:2002', data: { flowId: 2002 } }))
      .mockResolvedValueOnce(jsonResponse({ code: '0', data: { flowId: 2002, flowName: '新草稿', flowConf: null } }))
    const { flowCenterApi } = await import('./index')
    const saved = await flowCenterApi.save({ id: '1001', name: '新草稿', definition: { main: [], branches: [], configs: {} } })
    expect(saved.id).toBe('2002')
    expect(new URL(String(fetchMock.mock.calls[1][0]), 'http://local.test').searchParams.get('flowId')).toBe('2002')
  })

  it('POST /v1/flow/changeFlowBatch：sourceIds 走 body 数组，解绑传 flowId=0', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: '0', msg: '批量更改流程成功，更新数量:3', data: null }))
    const { flowCenterApi } = await import('./index')

    await flowCenterApi.bindSources(['1001', '1002', '1003'], '2001')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(url, 'http://local.test').pathname).toBe('/api/v1/flow/changeFlowBatch')
    expect(init.method).toBe('POST')
    // 必须是 body 里的数字数组：query 版（changeFlow）批量上千会撞请求行上限触发 414，已被后端标废弃
    expect(JSON.parse(String(init.body))).toEqual({ sourceIds: [1001, 1002, 1003], flowId: 2001 })

    await flowCenterApi.bindSources(['1001'])
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body)))
      .toEqual({ sourceIds: [1001], flowId: 0 })
  })

  it('GET /v1/flow/deleteFlow：ids 逗号串走 query（逻辑删除）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: '0', msg: '删除成功，共删除 2 条', data: null }))
    const { flowCenterApi } = await import('./index')
    const ack = await flowCenterApi.remove(['1001', '1002'])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const parsed = new URL(url, 'http://local.test')
    expect(parsed.pathname).toBe('/api/v1/flow/deleteFlow')
    expect(parsed.searchParams.get('ids')).toBe('1001,1002')
    expect(init.method).toBe('GET')
    expect(ack).toMatchObject({ ok: true, message: '删除成功，共删除 2 条' })
  })

  it('flowPaged 的排序字段走后端白名单，默认按更新时间倒序', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 0, count: 0, data: [] }))
    const { flowCenterApi } = await import('./index')
    await flowCenterApi.paged({ page: 3, size: 50, field: 'sourceCnt', order: 'desc' })
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)))
      .toEqual({ page: 3, limit: 50, field: 'sourceCnt', order: 'desc' })
    await flowCenterApi.paged({})
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body)))
      .toMatchObject({ field: 'updateDt', order: 'desc' })
  })

  it('changeFlowBatch 超过 5000 条直接本地拦下，不发请求', async () => {
    const { flowCenterApi } = await import('./index')
    const ack = await flowCenterApi.bindSources(Array.from({ length: 5001 }, (_, i) => String(i)), '2001')
    expect(ack.ok).toBe(false)
    expect(ack.message).toContain('5000')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POST /v1/flow/copyFlow：从 msg 里取新流程 ID——后端大写「新流程ID:」也能命中（0925 REVIEW 高危修复）', async () => {
    // 后端回执 data 是标量（normalizeHttpPayload 按「标量不是载荷」丢弃），新 ID 只能从 msg 取：
    // 「复制成功，新流程ID:728」——旧正则大小写敏感匹配不上，copy() 恒抛「未能解析新流程 ID」（复制已成功、残留孤立流程）
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: '0', data: 728, msg: '复制成功，新流程ID:728' }))
    const { flowCenterApi } = await import('./index')
    const id = await flowCenterApi.copy('1001')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const parsed = new URL(url, 'http://local.test')
    expect(parsed.pathname).toBe('/api/v1/flow/copyFlow')
    expect(parsed.searchParams.get('flowId')).toBe('1001')
    expect(init.method).toBe('POST')
    expect(id).toBe('728')
  })

  it('POST /v1/flow/copyFlow：小写「id:」msg 与 saveFlow 同款也能命中（兼容旧后端）', async () => {
    // 0927 P2-3：data 与 msg 故意给**不同值**（data=707、msg 解析 939）——若哪天
    // normalizeHttpPayload 不再丢标量、copy 转从 data 取 ID，此断言立刻失败暴露。
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: '0', data: 707, msg: '复制成功，id:939' }))
    const { flowCenterApi } = await import('./index')
    await expect(flowCenterApi.copy('1001')).resolves.toBe('939')
  })

  // 2026-09-29 对齐 118 上线版旧平台「步骤列表1」handleSaveRoot：
  // stepModify({ itemConfig, flowId, isRoot: 1, configId })，POST body。
  it('POST /v1/item/next/stepModify（流程入口换配置）：body 带 itemConfig / flowId / isRoot=1 / configId', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: '0', data: null, msg: '操作成功' }))
    const { itemApi } = await import('./index')
    await itemApi.rootConfigUpdate('41352', '1400999', '1400935')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(url, 'http://local.test').pathname).toBe('/api/v1/item/next/stepModify')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ itemConfig: 41352, flowId: 1400935, isRoot: 1, configId: 1400999 })
  })

  it('流程入口换配置：flowId 无效（空 / 0）时不带该键，isRoot 照带', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: '0', data: null, msg: '操作成功' }))
    const { itemApi } = await import('./index')
    await itemApi.rootConfigUpdate('41352', '1400999', '0')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ itemConfig: 41352, isRoot: 1, configId: 1400999 })
  })

  it('流程入口换配置带输出表：outEntry 有值才携带，空值不占键', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: '0', data: null, msg: '操作成功' }))
    const { itemApi } = await import('./index')
    await itemApi.rootConfigUpdate('41352', '1400999', '1400935', '6200027')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ itemConfig: 41352, flowId: 1400935, isRoot: 1, configId: 1400999, outEntry: 6200027 })

    await itemApi.rootConfigUpdate('41352', '1400999', '1400935', '')
    const [, init2] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(String(init2.body))).toEqual({ itemConfig: 41352, flowId: 1400935, isRoot: 1, configId: 1400999 })
  })

  it('GET /v1/flow/changeFlowEnable：ids 逗号串 + enable 0/1（F6 启停）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: '0', msg: '处理成功，共处理 2 条', data: null }))
    const { flowCenterApi } = await import('./index')
    const ack = await flowCenterApi.changeFlowEnable(['1001', '1002'], 1)
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    const u = new URL(url, 'http://local.test')
    expect(u.pathname).toBe('/api/v1/flow/changeFlowEnable')
    expect(u.searchParams.get('ids')).toBe('1001,1002')
    expect(u.searchParams.get('enable')).toBe('1')
    expect(ack.ok).toBe(true)
  })

  it('saveFlow 回查详情 state=D：明确报错而不是假装保存成功（F8）', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', msg: '保存成功，id:1001', data: null }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        code: null,
        data: { flowId: 1001, flowName: '被删的流程', state: 'D', isDelete: -1, flowConf: null },
      }))
    const { flowCenterApi } = await import('./index')
    await expect(flowCenterApi.save({ id: '1001', name: '被删的流程', definition: { main: [], branches: [], configs: {} } }))
      .rejects.toThrow('已被删除')
  })
})
