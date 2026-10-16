// @vitest-environment jsdom
// 表改写管理接口契约（1015 从旧 ai-chat-view 迁入，旧 src/demoApi/ReplaceTableConfigApi.js:4-6）。
// 旧接口文件只有三个函数，本域因此是 CRUD 工厂最干净的落点，全部钉死：
// ① 新增与修改是**同一个根端点**（POST /poc/replace-table-config，body 带 id 即更新），
//    与 question-dic / chat-flow-step / data-index-* 那种分两个端点的域不同；
// ② 启停参数走 **query**（旧 changeConfigStatus 用的是 axios params），与 chat-flow-step /
//    data-index-config / system 那几个 body 传参的 status 不同；
// ③ 旧域没有 /copy，也**没有删除**（旧列表操作列只有「编辑」和「启用/禁用」），两个都不提供；
// ④ 搜索框标签是「表名称」但上送参数名叫 name，2026-10-15 在 186 实测确认按 tableName 模糊筛、
//    且**大小写敏感**（name=JX 回 1 条、name=jx 回 0 条）；
// ⑤ 与选表规则配置**不同**：本域分页的 status 筛选后端认（实测 '0' 回 0 条、'1' 回全量 2 条），
//    所以这里的 status 断言反映真实后端语义，不是 mock 单方的期望。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  // request() 先 res.text() 再 JSON.parse（client.ts 空响应体兜底），mock 响应也要给 text()
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

const ENVELOPE_PAGE = {
  code: 0,
  msg: '请求成功',
  count: 2,
  // 行形状照 186 POC 服务 2026-10-15 的真实抓样：status 是**数字**，另带 delFlag（页面不展示、编辑时整行带回）
  data: [{ id: 13, tableName: 'YJZB_HY_JX', replaceType: 'unionall', replaceTableName: 'YJZB_HY_GHKJ', status: 1, createTime: '2025-04-18 17:56:05', updateTime: '2025-04-27 12:33:06', delFlag: '0' }],
}
const ENVELOPE_ACK = { code: 0, msg: '请求成功', count: null, data: null }

describe('表改写管理 · /api/poc HTTP 契约', () => {
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

  it('page：POST /api/poc/replace-table-config/page，分页 + name/status 全在 body，响应 {count,data} 归一成 {list,total}', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_PAGE))
    const { replaceTableConfigApi } = await import('./templateConfig')

    const res = await replaceTableConfigApi.page({ pageNo: 2, pageSize: 20, name: 'YJZB_HY_JX', status: '1' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/replace-table-config/page')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ pageNo: 2, pageSize: 20, name: 'YJZB_HY_JX', status: '1' })
    expect(res).toEqual({ total: 2, list: ENVELOPE_PAGE.data })
  })

  it('save（新增，不带 id）：POST /api/poc/replace-table-config，四个表单字段原样进 body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { replaceTableConfigApi } = await import('./templateConfig')

    const form = { tableName: 'KHFA_ZB', replaceTableName: 'KHFA_ZB_HISTORY', replaceType: 'unionall', status: '0' }
    await replaceTableConfigApi.save(form)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/replace-table-config')
    expect(JSON.parse(String(init.body))).toEqual(form)
  })

  it('save（修改，带 id）：还是 POST /api/poc/replace-table-config —— 与新增同一个端点，不拆 /update', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { replaceTableConfigApi } = await import('./templateConfig')

    await replaceTableConfigApi.save({ id: 13, tableName: 'YJZB_HY_JX', replaceTableName: 'YJZB_HY_GHKJ_X' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/replace-table-config')
    expect(JSON.parse(String(init.body))).toEqual({ id: 13, tableName: 'YJZB_HY_JX', replaceTableName: 'YJZB_HY_GHKJ_X' })
  })

  it('changeStatus：POST /api/poc/replace-table-config/status?id=&status=，参数在 **query**、无 body（旧契约）', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { replaceTableConfigApi } = await import('./templateConfig')

    await replaceTableConfigApi.changeStatus?.(13, '0')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/replace-table-config/status?id=13&status=0')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
  })

  it('不提供复制，也不提供删除（旧接口文件只有 page / 根 / status 三个端点）', async () => {
    const { replaceTableConfigApi } = await import('./templateConfig')
    expect(replaceTableConfigApi.copy).toBeUndefined()
    expect((replaceTableConfigApi as unknown as { remove?: unknown }).remove).toBeUndefined()
  })

  it('业务失败（code ≠ 0）抛出后端 msg，不静默成功', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 500, msg: '表名称已存在' }))
    const { replaceTableConfigApi } = await import('./templateConfig')

    await expect(replaceTableConfigApi.save({ tableName: 'DIM_JG' })).rejects.toThrow('表名称已存在')
  })
})

describe('表改写管理 · mock 内存表（演示 / 单测口径）', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('分页按 name（表名称模糊、大小写敏感）与 status 筛，空值都按全部处理', async () => {
    const { replaceTableConfigApi } = await import('./templateConfig')

    const all = await replaceTableConfigApi.page({ pageNo: 1, pageSize: 20, name: '', status: '' })
    expect(all.total).toBeGreaterThan(0)

    const byName = await replaceTableConfigApi.page({ pageNo: 1, pageSize: 20, name: 'YJZB_HY_JX' })
    expect(byName.list.length).toBe(1)
    expect(byName.list[0]?.replaceTableName).toBe('YJZB_HY_GHKJ')

    // 大小写敏感：真实后端就是这样（name=jx 回 0 条），mock 不额外放宽
    const lower = await replaceTableConfigApi.page({ pageNo: 1, pageSize: 20, name: 'yjzb_hy_jx' })
    expect(lower.list.length).toBe(0)

    const disabled = await replaceTableConfigApi.page({ pageNo: 1, pageSize: 20, status: '1' })
    expect(disabled.list.length).toBeGreaterThan(0)
    expect(disabled.list.every((row) => String(row.status) === '1')).toBe(true)
  })

  it('新增/修改/启停真落内存表：新增不带 id、修改按 id 就地更新、启停后状态跟着变', async () => {
    const { replaceTableConfigApi } = await import('./templateConfig')

    const before = await replaceTableConfigApi.page({ pageNo: 1, pageSize: 20 })
    const total = before.total

    await replaceTableConfigApi.save({ tableName: 'MOCK_DEMO_TABLE', replaceTableName: 'MOCK_DEMO_TARGET', replaceType: 'unionall', status: '0' })
    const afterAdd = await replaceTableConfigApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterAdd.total).toBe(total + 1)

    const added = afterAdd.list.find((row) => row.tableName === 'MOCK_DEMO_TABLE')!
    expect(added.delFlag).toBe('0')
    await replaceTableConfigApi.save({ id: added.id, replaceTableName: 'MOCK_DEMO_TARGET_2' })
    const afterUpdate = await replaceTableConfigApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterUpdate.total).toBe(total + 1)
    expect(afterUpdate.list.find((row) => row.id === added.id)?.replaceTableName).toBe('MOCK_DEMO_TARGET_2')

    await replaceTableConfigApi.changeStatus?.(Number(added.id), '1')
    const afterStatus = await replaceTableConfigApi.page({ pageNo: 1, pageSize: 20, status: '1' })
    expect(afterStatus.list.find((row) => row.id === added.id)?.status).toBe('1')
  })
})
