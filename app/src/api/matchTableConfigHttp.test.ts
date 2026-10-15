// @vitest-environment jsdom
// 选表规则配置接口契约（1015 从旧 ai-chat-view 迁入，旧 src/demoApi/MatchTableConfigApi.js:3-8）。
// 这个模块的旧口径容易被"顺手统一"掉，全部钉死：
// ① 新增与修改是**同一个根端点**（POST /poc/match-table-config，body 带 id 即更新），
//    与 question-dic / chat-flow-step / data-index-* 那种分两个端点的域不同 —— 它正是 CRUD 工厂的默认形态；
// ② 启停与删除的参数都走 **query**（旧 changeConfigStatus / deleteConfig 用的是 axios params），
//    与 chat-flow-step / data-index-config / system 那几个 body 传参的 status 不同；
// ③ 删除只发 id（旧 deleteConfig(id)），不像 question-dic 那样发整行；
// ④ 旧域没有 /copy。
// 搜索框标签是「表名称」但上送参数名叫 name，实测后端确实按 tableName 模糊筛（2026-10-15，186 会话）；
// 反过来实测也确认**分页的 status 筛选后端不收**（'0'/'1'/数字/不传都回全量），所以本页下面那条 status 的
// mock 断言只反映 mock 内存表的期望语义，不代表真实后端 —— 别据此以为线上能筛。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  // request() 先 res.text() 再 JSON.parse（client.ts 空响应体兜底），mock 响应也要给 text()
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

const ENVELOPE_PAGE = {
  code: 0,
  msg: '请求成功',
  count: 2,
  // 行形状照 186 POC 服务 2026-10-15 的真实抓样：status 是**数字**，另带 tableId/type/delFlag 三列（页面不展示）
  data: [{ id: 8, tableId: 1042, tableName: 'YJZB_HY_GHKJ', type: '0', selectionType: 'text_selection', rule: '^(?=.*管户口径 )(?=.*(行员|员工)).+$', status: 1, delFlag: '0', createTime: '2025-03-11 17:42:41' }],
}
const ENVELOPE_ACK = { code: 0, msg: '请求成功', count: null, data: null }

describe('选表规则配置 · /api/poc HTTP 契约', () => {
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

  it('page：POST /api/poc/match-table-config/page，分页 + name/status 全在 body，响应 {count,data} 归一成 {list,total}', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_PAGE))
    const { matchTableConfigApi } = await import('./templateConfig')

    const res = await matchTableConfigApi.page({ pageNo: 2, pageSize: 20, name: 'DIM_JG', status: '1' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/match-table-config/page')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ pageNo: 2, pageSize: 20, name: 'DIM_JG', status: '1' })
    expect(res).toEqual({ total: 2, list: ENVELOPE_PAGE.data })
  })

  it('save（新增，不带 id）：POST /api/poc/match-table-config，四个表单字段原样进 body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { matchTableConfigApi } = await import('./templateConfig')

    const form = { tableName: 'KHFA_ZB', selectionType: 'text_selection', rule: '问句含指标名时选本表', status: '0' }
    await matchTableConfigApi.save(form)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/match-table-config')
    expect(JSON.parse(String(init.body))).toEqual(form)
  })

  it('save（修改，带 id）：还是 POST /api/poc/match-table-config —— 与新增同一个端点，不拆 /update', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { matchTableConfigApi } = await import('./templateConfig')

    await matchTableConfigApi.save({ id: 3, tableName: 'DIM_JG', selectionType: 'vector_selection' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/match-table-config')
    expect(JSON.parse(String(init.body))).toEqual({ id: 3, tableName: 'DIM_JG', selectionType: 'vector_selection' })
  })

  it('changeStatus：POST /api/poc/match-table-config/status?id=&status=，参数在 **query**、无 body（旧契约）', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { matchTableConfigApi } = await import('./templateConfig')

    await matchTableConfigApi.changeStatus?.(3, '0')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/match-table-config/status?id=3&status=0')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
  })

  it('remove：POST /api/poc/match-table-config/delete?id=，只发 id（不像 question-dic 发整行）', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { matchTableConfigApi } = await import('./templateConfig')

    await matchTableConfigApi.remove(3)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/match-table-config/delete?id=3')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
  })

  it('不提供复制（旧后端没有 /poc/match-table-config/copy）', async () => {
    const { matchTableConfigApi } = await import('./templateConfig')
    expect(matchTableConfigApi.copy).toBeUndefined()
  })

  it('业务失败（code ≠ 0）抛出后端 msg，不静默成功', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 500, msg: '表名称已存在' }))
    const { matchTableConfigApi } = await import('./templateConfig')

    await expect(matchTableConfigApi.save({ tableName: 'DIM_JG' })).rejects.toThrow('表名称已存在')
  })
})

describe('选表规则配置 · mock 内存表（演示 / 单测口径）', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('分页按 name（表名称模糊）与 status 筛，空值都按全部处理', async () => {
    const { matchTableConfigApi } = await import('./templateConfig')

    const all = await matchTableConfigApi.page({ pageNo: 1, pageSize: 20, name: '', status: '' })
    expect(all.total).toBeGreaterThan(0)

    const byName = await matchTableConfigApi.page({ pageNo: 1, pageSize: 20, name: 'YJZB_HY_JX' })
    expect(byName.list.length).toBe(1)
    expect(byName.list[0]?.tableName).toBe('YJZB_HY_JX')

    const disabled = await matchTableConfigApi.page({ pageNo: 1, pageSize: 20, status: '1' })
    expect(disabled.list.length).toBeGreaterThan(0)
    expect(disabled.list.every((row) => String(row.status) === '1')).toBe(true)
  })

  it('新增/修改/启停/删除真落内存表：新增不带 id、修改按 id 就地更新、删除后查不到', async () => {
    const { matchTableConfigApi } = await import('./templateConfig')

    const before = await matchTableConfigApi.page({ pageNo: 1, pageSize: 20 })
    const total = before.total

    await matchTableConfigApi.save({ tableName: 'MOCK_DEMO_TABLE', selectionType: 'vector_selection', rule: 'MOCK_DEMO_VECTOR', status: '0' })
    const afterAdd = await matchTableConfigApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterAdd.total).toBe(total + 1)

    const added = afterAdd.list.find((row) => row.tableName === 'MOCK_DEMO_TABLE')!
    await matchTableConfigApi.save({ id: added.id, tableName: 'MOCK_DEMO_TABLE', rule: '改过的匹配规则' })
    const afterUpdate = await matchTableConfigApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterUpdate.total).toBe(total + 1)
    expect(afterUpdate.list.find((row) => row.id === added.id)?.rule).toBe('改过的匹配规则')

    await matchTableConfigApi.changeStatus?.(Number(added.id), '1')
    const afterStatus = await matchTableConfigApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterStatus.list.find((row) => row.id === added.id)?.status).toBe('1')

    await matchTableConfigApi.remove(Number(added.id))
    const afterDelete = await matchTableConfigApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterDelete.total).toBe(total)
    expect(afterDelete.list.find((row) => row.id === added.id)).toBeUndefined()
  })
})
