// @vitest-environment jsdom
// 数据字典配置接口契约（1014 从旧 ai-chat-view 迁入，端点域 /poc/data-index-config，旧页面 DataIndexList.vue）。
// 这个模块有两条容易被"顺手统一"掉的旧口径，全部钉死：
// ① 新增与修改是两个端点（POST /poc/data-index-config 与 POST /poc/data-index-config/update）；
// ② 启停 POST /poc/data-index-config/status 的参数走 **body**（旧 dataIndexConfigStatus 用的是 axios 的 data，
//    与问句改写那个走 query 的 status 不同）；本域没有 copy。
// 另有一条只读下拉数据源 GET /poc/data-index-config/all-code，返回 {code,type} **裸数组**（信封里没有 count）。
// ⚠️ 真实响应尚未在 186 POC 服务实测核对过（沙箱直连不通），端点清单里先不标 live，契约来自 EntityApi.js:34-38、104-150。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  // request() 先 res.text() 再 JSON.parse（client.ts 空响应体兜底），mock 响应也要给 text()
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

const ENVELOPE_PAGE = {
  code: 0,
  msg: '请求成功',
  count: 128,
  data: [
    {
      id: 41,
      code: 'BRANCH_NAME',
      type: 'ORG',
      content: '城南支行',
      alias: '城南',
      contentCode: '1001',
      status: '0',
      createTime: '2025-04-22 18:56:48',
      updateTime: '2025-05-09 10:12:33',
      delFlag: '0',
    },
  ],
}
const ENVELOPE_ACK = { code: 0, msg: '请求成功', count: null, data: null }
const ENVELOPE_ALL_CODE = { code: 0, msg: '请求成功', data: [{ code: 'BRANCH_NAME', type: 'ORG' }, { code: 'INDICATOR_DATE', type: 'DATE' }] }

describe('数据字典配置 · /api/poc HTTP 契约', () => {
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

  it('page：POST /api/poc/data-index-config/page，name/code/type/status 与分页全在 body，响应 {count,data} 归一成 {list,total}', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_PAGE))
    const { dataIndexConfigApi } = await import('./templateConfig')

    const res = await dataIndexConfigApi.page({ pageNo: 2, pageSize: 20, name: '城南', code: 'BRANCH_NAME', type: 'ORG', status: '0' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/data-index-config/page')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ pageNo: 2, pageSize: 20, name: '城南', code: 'BRANCH_NAME', type: 'ORG', status: '0' })
    expect(res).toEqual({ total: 128, list: ENVELOPE_PAGE.data })
  })

  it('save（新增，不带 id）：POST /api/poc/data-index-config，别名与 status="0" 进 body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { dataIndexConfigApi } = await import('./templateConfig')

    await dataIndexConfigApi.save({ code: 'BRANCH_NAME', type: 'ORG', content: '城南支行', alias: '城南', contentCode: '1001', status: '0' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/data-index-config')
    expect(JSON.parse(String(init.body))).toMatchObject({ code: 'BRANCH_NAME', alias: '城南', status: '0' })
  })

  it('save（修改，带 id）：POST /api/poc/data-index-config/update —— 与新增不是一个端点', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { dataIndexConfigApi } = await import('./templateConfig')

    await dataIndexConfigApi.save({ id: 41, alias: '城南支行（改）' })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/data-index-config/update')
  })

  it('changeStatus：POST /api/poc/data-index-config/status，id/status 走 **body**（不是 query，与 question-dic 不同）', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { dataIndexConfigApi } = await import('./templateConfig')

    await dataIndexConfigApi.changeStatus(41, '1')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/data-index-config/status')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ id: 41, status: '1' })
  })

  it('allCode：GET /api/poc/data-index-config/all-code 不带参数，信封里没有 count 时裸数组直接透传', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ALL_CODE))
    const { dataIndexConfigApi } = await import('./templateConfig')

    const res = await dataIndexConfigApi.allCode()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/data-index-config/all-code')
    expect(init.method).toBe('GET')
    expect(res).toEqual(ENVELOPE_ALL_CODE.data)
  })

  it('不提供复制（旧后端没有 /poc/data-index-config/copy）', async () => {
    const { dataIndexConfigApi } = await import('./templateConfig')
    expect('copy' in dataIndexConfigApi).toBe(false)
  })

  it('业务失败（code ≠ 0）抛出后端 msg，不静默成功', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 500, msg: '未找到对应的字典项' }))
    const { dataIndexConfigApi } = await import('./templateConfig')

    await expect(dataIndexConfigApi.changeStatus(999, '1')).rejects.toThrow('未找到对应的字典项')
  })
})

describe('数据字典配置 · mock 内存表（演示 / 单测口径）', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('分页支持 name（匹配数据内容 content）/ code / type / status 四个条件，空串按全部处理', async () => {
    const { dataIndexConfigApi } = await import('./templateConfig')

    const all = await dataIndexConfigApi.page({ pageNo: 1, pageSize: 20, name: '', code: '', type: '', status: '' })
    expect(all.total).toBeGreaterThan(0)

    const byName = await dataIndexConfigApi.page({ pageNo: 1, pageSize: 20, name: '支行' })
    expect(byName.list.length).toBeGreaterThan(0)
    expect(byName.list.every((row) => String(row.content).includes('支行'))).toBe(true)

    const byCode = await dataIndexConfigApi.page({ pageNo: 1, pageSize: 20, code: 'BRANCH_NAME' })
    expect(byCode.list.every((row) => row.code === 'BRANCH_NAME')).toBe(true)

    const byStatus = await dataIndexConfigApi.page({ pageNo: 1, pageSize: 20, status: '1' })
    expect(byStatus.list.length).toBeGreaterThan(0)
    expect(byStatus.list.every((row) => String(row.status) === '1')).toBe(true)
  })

  it('allCode 按 code+type 去重返回裸数组（「编码」下拉的选项）', async () => {
    const { dataIndexConfigApi } = await import('./templateConfig')

    const options = await dataIndexConfigApi.allCode()
    expect(options.length).toBeGreaterThan(0)
    expect(new Set(options.map((o) => `${o.code}|${o.type}`)).size).toBe(options.length)
  })

  it('新增/修改真落内存表，且修改不会新增行；未提供的字段保持原值', async () => {
    const { dataIndexConfigApi } = await import('./templateConfig')

    const before = await dataIndexConfigApi.page({ pageNo: 1, pageSize: 20 })

    await dataIndexConfigApi.save({ code: 'TOWN_NAME', type: 'ORG', content: '城西支行', alias: '城西', status: '0' })
    const afterAdd = await dataIndexConfigApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterAdd.total).toBe(before.total + 1)

    const added = afterAdd.list.find((row) => row.alias === '城西')!
    await dataIndexConfigApi.save({ id: added.id, code: 'TOWN_NAME', type: 'ORG', content: '城西支行', alias: '城西（改）' })
    const afterUpdate = await dataIndexConfigApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterUpdate.total).toBe(before.total + 1)
    const updated = afterUpdate.list.find((row) => row.id === added.id)!
    expect(updated.alias).toBe('城西（改）')
    // 旧新增弹窗固定提交 status '0'，新增行落地就该是启用态
    expect(String(updated.status)).toBe('0')
  })

  it('启停改状态并留在原页，未知 id 不改任何行', async () => {
    const { dataIndexConfigApi } = await import('./templateConfig')

    const first = await dataIndexConfigApi.page({ pageNo: 1, pageSize: 20 })
    const target = first.list.find((row) => String(row.status) === '0')!

    await dataIndexConfigApi.changeStatus(Number(target.id), '1')
    const after = await dataIndexConfigApi.page({ pageNo: 1, pageSize: 20 })
    expect(String(after.list.find((row) => row.id === target.id)?.status)).toBe('1')

    await expect(dataIndexConfigApi.changeStatus(999999, '0')).resolves.toMatchObject({ ok: false })
  })
})
