// @vitest-environment jsdom
// 源的多流程绑定（画布流程标签栏 / 流程列表）走来源组接口文档里的 source-group/*：
// 读 sourceFlows，写只有 bindSourceFlows（整体替换 + 并发快照）。2026-10-09 取代 leo 的 workflow/* 契约。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response
}

const ok = (data: unknown) => jsonResponse({ success: true, code: '0', msg: '操作成功', data })
const fail = (msg: string) => jsonResponse({ success: false, code: '-1', msg, data: null })

/** 一个独立源：流程 100 是默认，101 启用，102 已停用 */
const ALONE = {
  sourceId: '430024667',
  sourceGroupId: null,
  flowIds: ['100', '101'],
  defaultFlowId: '100',
  bindings: [
    { id: '21', sourceId: '430024667', sourceGroupId: null, flowId: '100', isDefault: 1, state: 'ACTIVE', revision: 2 },
    { id: '22', sourceId: '430024667', sourceGroupId: null, flowId: '101', isDefault: 0, state: 'ACTIVE', revision: 4 },
    { id: '23', sourceId: '430024667', sourceGroupId: null, flowId: '102', isDefault: 0, state: 'DISABLED', revision: 1 },
  ],
}

describe('source-group 源多流程绑定 HTTP 契约', () => {
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

  async function load() {
    const api = await import('./index')
    vi.spyOn(api.flowCenterApi, 'detail').mockImplementation(async (id: string) => ({ id, name: `流程${id}`, definition: { main: [], branches: [], configs: {}, branchGroups: [] }, updatedAt: '' }))
    return api
  }
  const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: new URL(String(url), 'http://local.test'), init: init as RequestInit }))
  const bindCalls = () => calls().filter((c) => c.url.pathname.endsWith('/source-group/bindSourceFlows'))

  it('读取：sourceId 走 query；默认流程为主流程，停用的绑定不出现，流程名取自流程详情', async () => {
    fetchMock.mockResolvedValue(ok(ALONE))
    const { workflowBindingApi } = await load()
    const rows = await workflowBindingApi.list('430024667')
    const [first] = calls()
    expect(first.url.pathname).toBe('/api/v1/source-group/sourceFlows')
    expect(first.url.searchParams.get('sourceId')).toBe('430024667')
    expect(first.init.method).toBe('GET')
    expect(rows.map((r) => [r.workflowId, r.workflowName, r.primary, r.role, r.inherited, r.versionManaged])).toEqual([
      ['100', '流程100', true, 'MAIN', false, false],
      ['101', '流程101', false, 'AUX', false, false],
    ])
    expect(rows[0]).toMatchObject({ bindType: 'SOURCE', bindId: '430024667', publishedFlowId: '100', status: 'ACTIVE' })
  })

  it('流程详情 disabled → 行上 workflowStatus=DISABLED（10-22 标签栏禁用标识）', async () => {
    fetchMock.mockResolvedValue(ok(ALONE))
    const { workflowBindingApi, flowCenterApi } = await load()
    vi.mocked(flowCenterApi.detail).mockImplementation(async (id: string) => ({ id, name: `流程${id}`, disabled: id === '101', definition: { main: [], branches: [], configs: {}, branchGroups: [] }, updatedAt: '' }))
    const rows = await workflowBindingApi.list('430024667')
    expect(rows.map((r) => [r.workflowId, r.workflowStatus])).toEqual([['100', 'ACTIVE'], ['101', 'DISABLED']])
  })

  it('withNames: false 不取流程详情，名字退回「流程 #ID」（画布加载不被慢的 flowDetail 挡住）', async () => {
    fetchMock.mockResolvedValue(ok(ALONE))
    const { workflowBindingApi, flowCenterApi } = await load()
    const rows = await workflowBindingApi.list('430024667', { withNames: false })
    expect(flowCenterApi.detail).not.toHaveBeenCalled()
    expect(rows.map((r) => [r.workflowId, r.workflowName, r.primary])).toEqual([['100', '流程 #100', true], ['101', '流程 #101', false]])
  })

  /** 186 实测 430024683（10-15）：顶层是来源组 3 的流程，own* 是源自有的流程 */
  const IN_GROUP = {
    sourceId: '430024683', sourceGroupId: '3', flowIds: ['21000005', '21000006'], defaultFlowId: '21000006',
    bindings: [
      { id: '32769', sourceId: null, sourceGroupId: '3', flowId: '21000006', isDefault: 1, state: 'ACTIVE', revision: 0 },
      { id: '32768', sourceId: null, sourceGroupId: '3', flowId: '21000005', isDefault: 0, state: 'ACTIVE', revision: 0 },
    ],
    ownFlowIds: ['21000019', '21000022'], ownDefaultFlowId: '21000022',
    ownBindings: [
      { id: '32838', sourceId: '430024683', sourceGroupId: null, flowId: '21000022', isDefault: 1, state: 'ACTIVE', revision: 2 },
      { id: '32839', sourceId: '430024683', sourceGroupId: null, flowId: '21000019', isDefault: 0, state: 'ACTIVE', revision: 1 },
      { id: '32840', sourceId: '430024683', sourceGroupId: null, flowId: '21000030', isDefault: 0, state: 'DISABLED', revision: 1 },
    ],
  }

  it('入组的源只列来源组流程，主流程是组默认；入组前留下的自有绑定不列（1021-02）', async () => {
    fetchMock.mockResolvedValue(ok(IN_GROUP))
    const { workflowBindingApi } = await load()
    const loaded = await workflowBindingApi.load('430024683')
    expect(loaded.sourceGroupId).toBe('3')
    expect(loaded.rows.map((r) => [r.workflowId, r.inherited, r.own, r.primary, r.groupDefault, r.bindType, r.bindId])).toEqual([
      ['21000006', true, false, true, true, 'SOURCE_GROUP', '3'],
      ['21000005', true, false, false, false, 'SOURCE_GROUP', '3'],
    ])
  })

  it('入组的源、组还没绑流程：rows 为空，仍带回 sourceGroupId（标签栏据此不给「＋」）', async () => {
    fetchMock.mockResolvedValue(ok({ ...IN_GROUP, flowIds: [], defaultFlowId: null, bindings: [] }))
    const { workflowBindingApi } = await load()
    expect(await workflowBindingApi.load('430024683')).toEqual({ rows: [], sourceGroupId: '3' })
  })

  it('入组的源没有自有默认流程：主流程回落到来源组默认', async () => {
    fetchMock.mockResolvedValue(ok({ ...IN_GROUP, ownFlowIds: [], ownDefaultFlowId: null, ownBindings: [] }))
    const { workflowBindingApi } = await load()
    const rows = await workflowBindingApi.list('430024683')
    expect(rows.map((r) => [r.workflowId, r.primary, r.role])).toEqual([['21000006', true, 'MAIN'], ['21000005', false, 'AUX']])
  })

  it('未入组的源：顶层和 own* 是同一套，不重复出行', async () => {
    fetchMock.mockResolvedValue(ok({ ...ALONE, ownFlowIds: ALONE.flowIds, ownDefaultFlowId: ALONE.defaultFlowId, ownBindings: ALONE.bindings }))
    const { workflowBindingApi } = await load()
    const rows = await workflowBindingApi.list('430024667')
    expect(rows.map((r) => [r.workflowId, r.inherited, r.own, r.primary])).toEqual([['100', false, true, true], ['101', false, true, false]])
  })

  it('旧后端没有 own*：未入组回落到顶层字段，入组视为没有自有流程', async () => {
    fetchMock.mockResolvedValueOnce(ok(ALONE))
    const { workflowBindingApi } = await load()
    expect(await workflowBindingApi.view('430024667')).toMatchObject({ ownFlowIds: ['100', '101'], ownDefaultFlowId: '100' })
    const { ownFlowIds: _a, ownDefaultFlowId: _b, ownBindings: _c, ...legacyGroup } = IN_GROUP
    fetchMock.mockResolvedValueOnce(ok(legacyGroup))
    const view = await workflowBindingApi.view('430024683')
    expect(view).toMatchObject({ flowIds: ['21000005', '21000006'], ownFlowIds: [], ownBindings: [], ownDataAvailable: false })
    expect(view.ownDefaultFlowId).toBeUndefined()
  })

  it('本地演示源（字母 ID）不发请求', async () => {
    const { workflowBindingApi } = await load()
    expect(await workflowBindingApi.list('demo-source')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('关联已有流程：先读最新绑定，再带着读到的快照整体提交；默认不变', async () => {
    fetchMock.mockResolvedValueOnce(ok(ALONE)).mockResolvedValueOnce(ok(null))
    const { workflowBindingApi } = await load()
    await workflowBindingApi.bind({ sourceId: '430024667', workflowId: '103' })
    const [post] = bindCalls()
    expect(post.init.method).toBe('POST')
    expect(JSON.parse(String(post.init.body))).toEqual({
      sourceId: '430024667',
      expectedFlowIds: ['100', '101'],
      expectedDefaultFlowId: '100',
      flowIds: ['100', '101', '103'],
      defaultFlowId: '100',
    })
  })

  it('关联时要求设为默认，或源上还没有默认流程：新流程成为默认', async () => {
    fetchMock.mockResolvedValueOnce(ok(ALONE)).mockResolvedValueOnce(ok(null))
    const { workflowBindingApi } = await load()
    await workflowBindingApi.bind({ sourceId: '430024667', workflowId: '103', primary: true })
    expect(JSON.parse(String(bindCalls()[0].init.body))).toMatchObject({ flowIds: ['100', '101', '103'], defaultFlowId: '103' })

    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(ok({ sourceId: '1', sourceGroupId: null, flowIds: [], defaultFlowId: null, bindings: [] })).mockResolvedValueOnce(ok(null))
    await workflowBindingApi.bind({ sourceId: '1', workflowId: '200' })
    expect(JSON.parse(String(bindCalls()[0].init.body))).toEqual({
      sourceId: '1', expectedFlowIds: [], expectedDefaultFlowId: null, flowIds: ['200'], defaultFlowId: '200',
    })
  })

  it('设为默认：列表不变，只换默认；不在列表里的流程拒绝', async () => {
    fetchMock.mockResolvedValueOnce(ok(ALONE)).mockResolvedValueOnce(ok(null))
    const { workflowBindingApi } = await load()
    await workflowBindingApi.setPrimary('430024667', '101')
    expect(JSON.parse(String(bindCalls()[0].init.body))).toMatchObject({ flowIds: ['100', '101'], defaultFlowId: '101' })

    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(ok(ALONE))
    await expect(workflowBindingApi.setPrimary('430024667', '999')).rejects.toThrow('没有关联到本源')
    expect(bindCalls()).toHaveLength(0)
  })

  it('解除：去掉这一条；默认流程在还有别的流程时不能直接解除', async () => {
    fetchMock.mockResolvedValueOnce(ok(ALONE)).mockResolvedValueOnce(ok(null))
    const { workflowBindingApi } = await load()
    await workflowBindingApi.unbind('430024667', '101')
    expect(JSON.parse(String(bindCalls()[0].init.body))).toMatchObject({ flowIds: ['100'], defaultFlowId: '100' })

    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(ok(ALONE))
    await expect(workflowBindingApi.unbind('430024667', '100')).rejects.toThrow('先把其他流程设为默认')
    expect(bindCalls()).toHaveLength(0)

    // 只剩默认这一条：可以解除，列表清空、默认置空
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(ok({ sourceId: '5', sourceGroupId: null, flowIds: ['7'], defaultFlowId: '7', bindings: [] })).mockResolvedValueOnce(ok(null))
    await workflowBindingApi.unbind('5', '7')
    expect(JSON.parse(String(bindCalls()[0].init.body))).toMatchObject({ flowIds: [], defaultFlowId: null })
  })

  it('解除默认流程时同一次提交换主（10-21 画布右键解绑）', async () => {
    fetchMock.mockResolvedValueOnce(ok(ALONE)).mockResolvedValueOnce(ok(null))
    const { workflowBindingApi } = await load()
    await workflowBindingApi.unbind('430024667', '100', '101')
    expect(bindCalls()).toHaveLength(1)
    expect(JSON.parse(String(bindCalls()[0].init.body))).toMatchObject({ flowIds: ['101'], defaultFlowId: '101' })
  })

  it('入组的源维护自有流程：快照和提交都只用 own*，不带来源组的流程', async () => {
    fetchMock.mockResolvedValueOnce(ok(IN_GROUP)).mockResolvedValueOnce(ok(null))
    const { workflowBindingApi } = await load()
    await workflowBindingApi.bind({ sourceId: '430024683', workflowId: '21000040' })
    expect(JSON.parse(String(bindCalls()[0].init.body))).toEqual({
      sourceId: '430024683',
      expectedFlowIds: ['21000019', '21000022'],
      expectedDefaultFlowId: '21000022',
      flowIds: ['21000019', '21000022', '21000040'],
      defaultFlowId: '21000022',
    })

    // 来源组的流程不在本源列表里：不能在这里设主
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(ok(IN_GROUP))
    await expect(workflowBindingApi.setPrimary('430024683', '21000006')).rejects.toThrow('没有关联到本源')
    expect(bindCalls()).toHaveLength(0)

    // 入组源第一次加自有流程：成为本源默认
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(ok({ ...IN_GROUP, ownFlowIds: [], ownDefaultFlowId: null, ownBindings: [] })).mockResolvedValueOnce(ok(null))
    await workflowBindingApi.bind({ sourceId: '430024683', workflowId: '21000040' })
    expect(JSON.parse(String(bindCalls()[0].init.body))).toEqual({
      sourceId: '430024683', expectedFlowIds: [], expectedDefaultFlowId: null, flowIds: ['21000040'], defaultFlowId: '21000040',
    })
  })

  it('后端拒绝时（并发快照不一致等）保留后端原文', async () => {
    fetchMock.mockResolvedValueOnce(ok(ALONE)).mockResolvedValueOnce(fail('来源流程关联已变化，请重新查询'))
    const { workflowBindingApi } = await load()
    await expect(workflowBindingApi.bind({ sourceId: '430024667', workflowId: '103' })).rejects.toThrow('来源流程关联已变化，请重新查询')
  })

  it('新建空白流程：先建流程、再关联；关联失败时说明流程已建出（带 ID），不留孤儿', async () => {
    const definition = { main: [], branches: [], configs: {}, branchGroups: [] }
    fetchMock.mockResolvedValue(ok(ALONE))
    const { workflowBindingApi } = await load()
    const create = vi.spyOn(await import('@/utils/flow/createFromTemplate'), 'createFlowFromTemplate').mockResolvedValue({ id: '103', name: '新流程', definition, updatedAt: '' })
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(ok(ALONE)).mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok({ ...ALONE, flowIds: ['100', '101', '103'], bindings: [...ALONE.bindings, { id: '24', sourceId: '430024667', sourceGroupId: null, flowId: '103', isDefault: 0, state: 'ACTIVE', revision: 1 }] }))
    const created = await workflowBindingApi.createForSource({ sourceId: '430024667', name: '新流程', templateId: 'template-1' })
    expect(create).toHaveBeenCalledWith('template-1', '新流程')
    expect(created).toMatchObject({ workflowId: '103', primary: false })

    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(ok(ALONE)).mockResolvedValueOnce(fail('目标流程不存在或已删除：flowId=103'))
    await expect(workflowBindingApi.createForSource({ sourceId: '430024667', name: '新流程', templateId: 'template-1' })).rejects.toThrow(/已新建流程 #103，但关联到本源失败：.*目标流程不存在或已删除/)
  })

  it('expected 快照取默认行：默认流程即使已停用也要回传 expectedDefaultFlowId（1008-02 验收）', async () => {
    // 默认流程 100 已停用，101 启用
    const view = {
      sourceId: '430024667',
      sourceGroupId: null,
      flowIds: ['101'],
      defaultFlowId: '100',
      bindings: [
        { id: '21', sourceId: '430024667', sourceGroupId: null, flowId: '100', isDefault: 1, state: 'DISABLED', revision: 2 },
        { id: '22', sourceId: '430024667', sourceGroupId: null, flowId: '101', isDefault: 0, state: 'ACTIVE', revision: 4 },
      ],
    }
    // list 的 GET sourceFlows；bind → save → view 的 GET sourceFlows；再 POST bindSourceFlows
    fetchMock.mockResolvedValueOnce(ok(view)).mockResolvedValueOnce(ok(view)).mockResolvedValueOnce(ok(null))
    const { workflowBindingApi } = await load()
    // 停用行不进编辑初值（列表只有启用的 101），但保存快照必须带停用的默认行 100
    const rows = await workflowBindingApi.list('430024667')
    expect(rows.map((r) => r.workflowId)).toEqual(['101'])
    await workflowBindingApi.bind({ sourceId: '430024667', workflowId: '102' })
    const [post] = bindCalls()
    expect(JSON.parse(String(post.init.body))).toMatchObject({
      expectedFlowIds: ['101'],
      expectedDefaultFlowId: '100',
    })
  })

  it('没有版本（草稿 / 发布）接口：available 为 false，ensureDraft / publish 明确报错', async () => {
    const { workflowBindingApi } = await load()
    expect(workflowBindingApi.available()).toBe(false)
    await expect(workflowBindingApi.ensureDraft('1')).rejects.toThrow('尚未上线')
    await expect(workflowBindingApi.publish('1')).rejects.toThrow('尚未上线')
  })
})
