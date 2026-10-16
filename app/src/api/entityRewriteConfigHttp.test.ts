// @vitest-environment jsdom
// 实体改写管理接口契约（1015 从旧 ai-chat-view 迁入，旧 src/demoApi/EntityRewriteConfigApi.js:4-7）。
// 端点形状与选表规则配置一字不差，全部钉死：
// ① 新增与修改是**同一个根端点**（POST /poc/entity-rewrite-config，body 带 id 即更新），
//    与 question-dic / chat-flow-step / data-index-* 那种分两个端点的域不同；
// ② 启停与删除参数都走 **query**（旧 changeConfigStatus / deleteConfig 用的是 axios params）；
// ③ 旧域没有 /copy，不提供复制；
// ④ 搜索框上送的参数名是 **entityName**（旧 List.vue:11 绑的就是这个键），
//    不像选表规则 / 表改写那样把「表名称」改名成 name；实体列同名。
// ⚠️ 与那两个已实测的域不同：这四条端点**还没在 186 后端实测**（2026-10-16 POST /api/poc/entity-rewrite-config/page
// 回后端通用 500，同前缀不存在的路径回 404，说明控制器在、查询时炸，疑该域在 186 库里缺表）。
// 所以这里的行形状与筛选语义都还是**按旧页面代码推出来的期望**，下面 HTTP 用例是把契约接线钉住，
// 不代表后端已经这样回；后端打通后要按真实响应复核，再逐条在 endpoints.ts 标 live（同 vector-config 先例）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  // request() 先 res.text() 再 JSON.parse（client.ts 空响应体兜底），mock 响应也要给 text()
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

const ENVELOPE_PAGE = {
  code: 0,
  msg: '请求成功',
  count: 2,
  // 按旧列表列构造的行（未取到真实行）；status 写成数字是按同域选表规则 / 表改写的真实响应形状，
  // 真实回的是字符串也走 String(row.status) 比较，不影响这里的接线断言。
  data: [{ id: 2, entityName: '行员', cleanType: 'regular_replacement', content: '(行员|员工)', targetContent: '行员', status: 0, createTime: '2025-04-22 10:10:44', updateTime: '2025-04-22 10:10:44' }],
}
const ENVELOPE_ACK = { code: 0, msg: '请求成功', count: null, data: null }

describe('实体改写管理 · /api/poc HTTP 契约', () => {
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

  it('page：POST /api/poc/entity-rewrite-config/page，分页 + entityName/status 全在 body，响应 {count,data} 归一成 {list,total}', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_PAGE))
    const { entityRewriteConfigApi } = await import('./templateConfig')

    const res = await entityRewriteConfigApi.page({ pageNo: 2, pageSize: 20, entityName: '行员', status: '1' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/entity-rewrite-config/page')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ pageNo: 2, pageSize: 20, entityName: '行员', status: '1' })
    expect(res).toEqual({ total: 2, list: ENVELOPE_PAGE.data })
  })

  it('save（新增，不带 id）：POST /api/poc/entity-rewrite-config，表单字段原样进 body，没有旧版那个 replaceType 死字段', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { entityRewriteConfigApi } = await import('./templateConfig')

    const form = { entityName: '管户口径', cleanType: 'simple_replacement', content: '管户口径', targetContent: '个人管户口径', status: '0' }
    await entityRewriteConfigApi.save(form)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/entity-rewrite-config')
    expect(JSON.parse(String(init.body))).toEqual(form)
  })

  it('save（修改，带 id）：还是 POST /api/poc/entity-rewrite-config —— 与新增同一个端点，不拆 /update', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { entityRewriteConfigApi } = await import('./templateConfig')

    await entityRewriteConfigApi.save({ id: 2, entityName: '行员', targetContent: '员工' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/entity-rewrite-config')
    expect(JSON.parse(String(init.body))).toEqual({ id: 2, entityName: '行员', targetContent: '员工' })
  })

  it('changeStatus：POST /api/poc/entity-rewrite-config/status?id=&status=，参数在 **query**、无 body（旧契约）', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { entityRewriteConfigApi } = await import('./templateConfig')

    await entityRewriteConfigApi.changeStatus?.(2, '0')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/entity-rewrite-config/status?id=2&status=0')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
  })

  it('remove：POST /api/poc/entity-rewrite-config/delete?id=，id 走 **query**、无 body（旧 deleteConfig）', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { entityRewriteConfigApi } = await import('./templateConfig')

    await entityRewriteConfigApi.remove(2)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/entity-rewrite-config/delete?id=2')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
  })

  it('不提供复制（旧接口文件只有 page / 根 / status / delete 四个函数）', async () => {
    const { entityRewriteConfigApi } = await import('./templateConfig')
    expect(entityRewriteConfigApi.copy).toBeUndefined()
  })

  it('业务失败（code ≠ 0）抛出后端 msg，不静默成功', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 500, msg: '实体名称已存在' }))
    const { entityRewriteConfigApi } = await import('./templateConfig')

    await expect(entityRewriteConfigApi.save({ entityName: '行员' })).rejects.toThrow('实体名称已存在')
  })
})

describe('实体改写管理 · mock 内存表（演示 / 单测口径）', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('分页按 entityName（实体名称模糊）与 status 筛，空值都按全部处理', async () => {
    const { entityRewriteConfigApi } = await import('./templateConfig')

    const all = await entityRewriteConfigApi.page({ pageNo: 1, pageSize: 20, entityName: '', status: '' })
    expect(all.total).toBeGreaterThan(0)

    const byName = await entityRewriteConfigApi.page({ pageNo: 1, pageSize: 20, entityName: '行员' })
    expect(byName.list.length).toBeGreaterThan(0)
    expect(byName.list.every((row) => String(row.entityName ?? '').includes('行员'))).toBe(true)

    const disabled = await entityRewriteConfigApi.page({ pageNo: 1, pageSize: 20, status: '1' })
    expect(disabled.list.length).toBeGreaterThan(0)
    expect(disabled.list.every((row) => String(row.status) === '1')).toBe(true)
  })

  it('新增/修改/启停/删除真落内存表：新增不带 id、修改按 id 就地更新、启停后状态跟着变、删除后查不到', async () => {
    const { entityRewriteConfigApi } = await import('./templateConfig')

    const before = await entityRewriteConfigApi.page({ pageNo: 1, pageSize: 20 })
    const total = before.total

    await entityRewriteConfigApi.save({ entityName: 'MOCK_DEMO_ENTITY', cleanType: 'simple_replacement', content: '演示旧写法', targetContent: '演示新写法', status: '0' })
    const afterAdd = await entityRewriteConfigApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterAdd.total).toBe(total + 1)

    const added = afterAdd.list.find((row) => row.entityName === 'MOCK_DEMO_ENTITY')!
    await entityRewriteConfigApi.save({ id: added.id, targetContent: '演示新写法2' })
    const afterUpdate = await entityRewriteConfigApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterUpdate.total).toBe(total + 1)
    expect(afterUpdate.list.find((row) => row.id === added.id)?.targetContent).toBe('演示新写法2')

    await entityRewriteConfigApi.changeStatus?.(Number(added.id), '1')
    const afterStatus = await entityRewriteConfigApi.page({ pageNo: 1, pageSize: 20, status: '1' })
    expect(afterStatus.list.find((row) => row.id === added.id)?.status).toBe('1')

    await entityRewriteConfigApi.remove(Number(added.id))
    const afterDelete = await entityRewriteConfigApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterDelete.total).toBe(total)
    expect(afterDelete.list.find((row) => row.id === added.id)).toBeUndefined()
  })
})
