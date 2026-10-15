// @vitest-environment jsdom
// 向量表数据浏览接口契约（1015 从旧 ai-chat-view「基础配置 → 向量表数据浏览」迁入，端点域 /poc/vector）。
// 钉死四条旧口径：
// ① 下拉是只读 GET /api/poc/vector/config/all?name=（旧 vectorConfigList）；
// ② 查询是 POST /api/poc/vector/data，body 照旧 queryParam 原样发（input/type/pageSize/pageNo，旧页面没有分页控件）；
// ③ POC 信封带 count:null 时 client.ts 会按「key 存在」误判成分页结果（见 api/templateConfig.ts 的 toRowArray 注释），
//    下拉与查询都要还原回裸数组 —— 查询结果旧页面是整份 JSON.stringify(res.data) 展示，多包一层 {list,total} 展示口径就变了；
// ④ code ≠ 0 抛后端 msg，不静默成功。
// ⚠️ 联调状态（2026-10-15，浏览器带 186 会话直连 /api/poc）：
//   · config/all 已实测，真实行形状为 {id,name,comment,sourceTableId,sourceTable,matchDegree,dataIndexCode,preRule,…}，
//     信封同样是 count:null → 本文件第 ③ 条的还原假设成立；
//   · data 用旧页面的原载荷（input/type/pageSize/pageNo）实测回 {code:500,msg:'服务器繁忙，请稍后再试'}，
//     与旧平台同载荷同结果（186 上向量检索链路没起来），所以返回形状仍按旧页面读法落地，待后端可用后复核。
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
