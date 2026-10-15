// @vitest-environment jsdom
// 向量表接口契约（1015 从旧 ai-chat-view「基础配置 → 向量表数据浏览 / 向量表管理」迁入，端点域 /poc/vector）。
// 钉死四条旧口径（浏览）：
// ① 下拉是只读 GET /api/poc/vector/config/all?name=（旧 vectorConfigList）；
// ② 查询是 POST /api/poc/vector/data，body 照旧 queryParam 原样发（input/type/pageSize/pageNo，旧页面没有分页控件）；
// ③ POC 信封带 count:null 时 client.ts 会按「key 存在」误判成分页结果（见 api/templateConfig.ts 的 toRowArray 注释），
//    下拉与查询都要还原回裸数组 —— 查询结果旧页面是整份 JSON.stringify(res.data) 展示，多包一层 {list,total} 展示口径就变了；
// ④ code ≠ 0 抛后端 msg，不静默成功。
// 「向量表管理」五条（config/page、config、mapping/info、sync、delete）在文件后半段单独钉：
// 保存 body 是 {config, items} 包装、sync body 是裸 id 数组、删除按 name（body {type: 向量表名称}）。
// ⚠️ 联调状态（2026-10-15，浏览器带 186 会话直连 /api/poc）：
//   · config/all 已实测，真实行形状为 {id,name,comment,sourceTableId,sourceTable,matchDegree,dataIndexCode,preRule,…}，
//     信封同样是 count:null → 本文件第 ③ 条的还原假设成立；
//   · data 用旧页面的原载荷（input/type/pageSize/pageNo）实测回 {code:500,msg:'服务器繁忙，请稍后再试'}，
//     与旧平台同载荷同结果（186 上向量检索链路没起来），所以返回形状仍按旧页面读法落地，待后端可用后复核；
//   · 管理页五条本轮没拿到真实响应（端点未标 live，见 endpoints.ts），契约按旧 src/demoApi/VectorApi.js 落地。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  // request() 先 res.text() 再 JSON.parse（client.ts 空响应体兜底），mock 响应也要给 text()
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

const VECTOR_ROWS = [
  { id: 1, name: 'DIM_JG_VECTOR', comment: '机构向量表', sourceTable: 'sense_data.DIM_JG', matchDegree: 0.85 },
  { id: 2, name: 'DIC_YHH_VECTOR', comment: '用户号向量表', sourceTable: 'sense_data.DIC_YHH', matchDegree: 0.75 },
]

describe('向量表数据浏览 · /api/poc HTTP 契约', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('config/all：GET /api/poc/vector/config/all?name=，count:null 的信封要还原成裸数组', async () => {
    const envelope = { code: 0, msg: '请求成功', count: null, data: VECTOR_ROWS }
    fetchMock.mockResolvedValue(jsonResponse(envelope))
    const { pocVectorConfigList } = await import('./templateConfig')

    await expect(pocVectorConfigList('机构')).resolves.toEqual(envelope.data)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/vector/config/all?name=%E6%9C%BA%E6%9E%84')
    expect(init.method).toBe('GET')
  })

  it('config/all：空关键词也要把 ?name= 带上（后端把它声明成必填，参数缺失回 code:400）', async () => {
    // 2026-10-15 在 186 实测：GET /api/poc/vector/config/all 不带 name →
    // {code:400,msg:"Required request parameter 'name' for method parameter type String is not present"}；
    // 而 client.ts 的 appendQuery 会跳过空串，所以 name 是显式拼在 httpEndpoint 上的（旧 axios 空关键词也发 ?name=）。
    const envelope = { code: 0, msg: '请求成功', count: null, data: VECTOR_ROWS }
    fetchMock.mockResolvedValue(jsonResponse(envelope))
    const { pocVectorConfigList } = await import('./templateConfig')

    await expect(pocVectorConfigList('')).resolves.toEqual(envelope.data)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('/api/poc/vector/config/all?name=')
  })

  it('data：POST /api/poc/vector/data，旧 queryParam 四个字段全在 body，返回的数组不被包成 {list,total}', async () => {
    const rows = [{ id: 101, code: 'JG001', name: '杭州分行', score: 0.93 }]
    const envelope = { code: 0, msg: '请求成功', count: null, data: rows }
    fetchMock.mockResolvedValue(jsonResponse(envelope))
    const { pocVectorDataQuery } = await import('./templateConfig')

    const payload = await pocVectorDataQuery({ input: '杭州', type: 'DIM_JG_VECTOR', pageSize: 20, pageNo: 1 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/vector/data')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ input: '杭州', type: 'DIM_JG_VECTOR', pageSize: 20, pageNo: 1 })
    expect(payload).toEqual(rows)
  })

  it('data：后端回对象载荷时原样透传（旧页面拿到什么就展示什么）', async () => {
    const envelope = { code: 0, msg: '请求成功', count: null, data: { matched: 1, detail: { id: 101 } } }
    fetchMock.mockResolvedValue(jsonResponse(envelope))
    const { pocVectorDataQuery } = await import('./templateConfig')

    await expect(pocVectorDataQuery({ input: '', type: 'DIM_JG_VECTOR', pageSize: 20, pageNo: 1 })).resolves.toEqual(envelope.data)
  })

  it('业务失败（code ≠ 0）抛出后端 msg，不静默成功', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 500, msg: '向量表不存在' }))
    const { pocVectorDataQuery } = await import('./templateConfig')

    await expect(pocVectorDataQuery({ input: '', type: 'NO_SUCH_VECTOR', pageSize: 20, pageNo: 1 })).rejects.toThrow('向量表不存在')
  })
})

describe('向量表数据浏览 · mock 内存表（演示 / 单测口径）', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('下拉给全量向量表选项，查询按选中的向量表出数据行', async () => {
    const { pocVectorConfigList, pocVectorDataQuery } = await import('./templateConfig')

    const tables = await pocVectorConfigList('')
    expect(tables.length).toBeGreaterThan(0)

    const rows = (await pocVectorDataQuery({ input: '', type: tables[0]!.name, pageSize: 20, pageNo: 1 })) as { code: string }[]
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('文本搜索做模糊匹配，未选表（type 空串）回空数组', async () => {
    const { pocVectorDataQuery } = await import('./templateConfig')

    const matched = (await pocVectorDataQuery({ input: '杭州', type: 'DIM_JG_VECTOR', pageSize: 20, pageNo: 1 })) as { name: string }[]
    expect(matched.map((row) => row.name)).toEqual(['杭州分行'])
    await expect(pocVectorDataQuery({ input: '', type: '', pageSize: 20, pageNo: 1 })).resolves.toEqual([])
  })
})

const VECTOR_CONFIG_ROWS = [
  { id: 2, name: 'KHFA_ZB_VECTOR', comment: '客户指标向量表', sourceTable: 'sense_data.KHFA_KHZBJG_JG', sourceTableId: 1, matchDegree: 0.9, dataIndexCode: 'ZB', returnNum: 1, lastSync: '2026-10-13 18:02:07', updateTime: '2026-10-13 18:02:07' },
  { id: 1, name: 'DIM_JG_VECTOR', comment: '机构向量表', sourceTable: 'sense_data.DIM_JG', sourceTableId: 3, matchDegree: 0.85, dataIndexCode: '', returnNum: 5, lastSync: '2026-10-12 09:20:31', updateTime: '2026-10-12 09:20:31' },
]

describe('向量表管理 · /api/poc HTTP 契约', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('config/page：POST /api/poc/vector/config/page，name/sourceTable 两个筛选进 body，{code,count,data} 归一成 {list,total}', async () => {
    const envelope = { code: 0, msg: '请求成功', count: 2, data: VECTOR_CONFIG_ROWS }
    fetchMock.mockResolvedValue(jsonResponse(envelope))
    const { vectorConfigApi } = await import('./templateConfig')

    await expect(vectorConfigApi.page({ pageNo: 1, pageSize: 20, name: 'VECTOR', sourceTable: 'DIM_JG' })).resolves.toEqual({
      list: VECTOR_CONFIG_ROWS,
      total: 2,
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/vector/config/page')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ pageNo: 1, pageSize: 20, name: 'VECTOR', sourceTable: 'DIM_JG' })
  })

  it('config：保存走同一个根端点，body 是 {config, items} 包装（config 带 id 即更新）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 0, msg: '操作成功' }))
    const { vectorConfigApi } = await import('./templateConfig')

    const payload = {
      config: { id: 1, name: 'DIM_JG_VECTOR', comment: '机构向量表', sourceTable: 'DIM_JG', sourceTableId: 3, matchDegree: 0.6, dataIndexCode: '', returnNum: 1 },
      items: [{ type: '1', sourceColumn: 'JGDM', targetColumn: 'jg_code', valueColumn: '', rule: '' }],
    }
    await vectorConfigApi.save(payload)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/vector/config')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual(payload)
  })

  it('mapping/info：GET /api/poc/vector/mapping/info?configId=，count:null 信封还原成裸数组（旧弹窗直接遍历 res.data）', async () => {
    const items = [{ id: 11, configId: 3, type: '1', sourceColumn: 'JGDM' }, { id: 12, configId: 3, type: '2', sourceColumn: 'JGMC' }]
    const envelope = { code: 0, msg: '请求成功', count: null, data: items }
    fetchMock.mockResolvedValue(jsonResponse(envelope))
    const { vectorConfigApi } = await import('./templateConfig')

    await expect(vectorConfigApi.mappingInfo(3)).resolves.toEqual(items)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/vector/mapping/info?configId=3')
    expect(init.method).toBe('GET')
  })

  it('sync：POST /api/poc/vector/sync，body 是裸 id 数组 [7]（不是 {ids:[...]}，同 data-index-sync 口径）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 0, msg: '同步成功' }))
    const { vectorConfigApi } = await import('./templateConfig')

    await vectorConfigApi.sync([7])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/vector/sync')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual([7])
  })

  it('delete：POST /api/poc/vector/delete，body {type: 向量表名称} —— 按 name 删不按 id（旧平台独有口径）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 0, msg: '删除成功' }))
    const { vectorConfigApi } = await import('./templateConfig')

    await vectorConfigApi.remove('DIM_JG_VECTOR')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/vector/delete')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ type: 'DIM_JG_VECTOR' })
  })

  it('业务失败（code ≠ 0）抛出后端 msg，不静默成功', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 500, msg: '向量表名称已存在' }))
    const { vectorConfigApi } = await import('./templateConfig')

    await expect(
      vectorConfigApi.save({ config: { name: 'DIM_JG_VECTOR' }, items: [] }),
    ).rejects.toThrow('向量表名称已存在')
  })
})

describe('向量表管理 · mock 内存表（演示 / 单测口径）', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('分页两个筛选都是模糊；新建保存后回第一页能看到新行', async () => {
    const { vectorConfigApi } = await import('./templateConfig')

    const byName = await vectorConfigApi.page({ pageNo: 1, pageSize: 20, name: 'DIC' })
    expect(byName.list.map((row) => row.name)).toEqual(['DIC_YHH_VECTOR'])
    const bySource = await vectorConfigApi.page({ pageNo: 1, pageSize: 20, name: '', sourceTable: 'KHFA' })
    expect(bySource.list.map((row) => row.name)).toEqual(['KHFA_ZB_VECTOR'])

    await vectorConfigApi.save({
      config: { name: 'NEW_DEMO_VECTOR', comment: '演示新建', sourceTable: 'DIM_DATE', sourceTableId: 5, matchDegree: 0.6, dataIndexCode: '', returnNum: 1 },
      items: [{ type: '1' }, { type: '2' }, { type: '3' }],
    })
    const afterAdd = await vectorConfigApi.page({ pageNo: 1, pageSize: 20, name: 'NEW_DEMO' })
    expect(afterAdd.total).toBe(1)
    const added = afterAdd.list[0]!
    expect(added).toMatchObject({ name: 'NEW_DEMO_VECTOR', comment: '演示新建' })
    expect(added.id).toBeTypeOf('number')

    // 浏览页下拉与管理列表共用内存表：新建的表也进下拉
    const { pocVectorConfigList } = await import('./templateConfig')
    expect((await pocVectorConfigList('NEW_DEMO')).map((row) => row.name)).toEqual(['NEW_DEMO_VECTOR'])
  })

  it('编辑保存整行更新 + 列映射覆盖；mapping/info 取回的就是保存的 items', async () => {
    const { vectorConfigApi } = await import('./templateConfig')

    await vectorConfigApi.save({
      config: { id: 1, name: 'DIM_JG_VECTOR', comment: '机构向量表（改）', sourceTable: 'sense_data.DIM_JG', sourceTableId: 3, matchDegree: 0.75, dataIndexCode: 'JG', returnNum: 8 },
      items: [
        { type: '1', sourceColumn: 'JGDM', targetColumn: 'jg_code', valueColumn: '', rule: '' },
        { type: '2', sourceColumn: 'JGMC', targetColumn: 'jg_name', valueColumn: '', rule: '去空格' },
      ],
    })
    const items = await vectorConfigApi.mappingInfo(1)
    expect(items.map((item) => item.sourceColumn)).toEqual(['JGDM', 'JGMC'])

    const page = await vectorConfigApi.page({ pageNo: 1, pageSize: 20, name: 'DIM_JG' })
    expect(page.list[0]).toMatchObject({ comment: '机构向量表（改）', returnNum: 8 })
  })

  // mock 分支不抛错：client.ts 的 mock handler 返回 {ok:false,message} 原样透传（HTTP 模式的失败才是 code≠0 抛后端 msg，见上面的契约用例）。
  // 断言口径同 wordSegmentConfigHttp.test.ts。
  it('mapping/info：未知 configId 在 mock 模式被 toRowArray 还原成空数组（弹窗据此仍可打开，只是映射为空）', async () => {
    const { vectorConfigApi } = await import('./templateConfig')
    await expect(vectorConfigApi.mappingInfo(9999)).resolves.toEqual([])
  })

  it('同步回写 lastSync；删除按 name 移除行与映射', async () => {
    const { vectorConfigApi } = await import('./templateConfig')

    const before = await vectorConfigApi.page({ pageNo: 1, pageSize: 20, name: 'KHFA_ZB' })
    await vectorConfigApi.sync([before.list[0]!.id!])
    const after = await vectorConfigApi.page({ pageNo: 1, pageSize: 20, name: 'KHFA_ZB' })
    expect(after.list[0]!.lastSync).not.toBe(before.list[0]!.lastSync)

    await vectorConfigApi.remove('KHFA_ZB_VECTOR')
    const gone = await vectorConfigApi.page({ pageNo: 1, pageSize: 20, name: 'KHFA_ZB' })
    expect(gone.total).toBe(0)
    // 二次删除：mock 模式不抛错，handler 的 {ok:false,message} 原样返回（口径同上面的 mapping/info）
    await expect(vectorConfigApi.remove('KHFA_ZB_VECTOR')).resolves.toMatchObject({ ok: false, message: '未找到要删除的向量表' })
  })
})
