// @vitest-environment jsdom
// 提示词配置接口契约（1014 从旧 ai-chat-view 迁入，旧 src/demoApi/ChatFlowStepApi.js:3-8）。
// 这个模块的旧口径有三条容易被"顺手统一"掉，全部钉死：
// ① 菜单叫「提示词配置」，端点域是 chat-flow-step（旧路由 /demo/chat-flow-step-list），不改名；
// ② 新增与修改是两个端点（POST /poc/chat-flow-step 与 POST /poc/chat-flow-step/update）；
// ③ 启停参数走 **body**（旧 chatFlowStepStatus 用的是 axios data，与 question-dic/status 的 query 不同）。
// 另外旧后端没有 copy、没有删除端点。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  // request() 先 res.text() 再 JSON.parse（client.ts 空响应体兜底），mock 响应也要给 text()
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

const ENVELOPE_PAGE = {
  code: 0,
  msg: '请求成功',
  count: 3,
  data: [{ id: 11, stepCode: 'sql_generate', flowCode: 'chat_main', stepName: 'SQL 生成', templateDef: '问句：{{question}}', retryCount: 3, status: '1', createTime: '2025-01-08 15:21:40' }],
}
const ENVELOPE_ACK = { code: 0, msg: '请求成功', count: null, data: null }

describe('提示词配置 · /api/poc HTTP 契约', () => {
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

  it('page：POST /api/poc/chat-flow-step/page，分页 + name/status 全在 body，响应 {count,data} 归一成 {list,total}', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_PAGE))
    const { chatFlowStepApi } = await import('./templateConfig')

    const res = await chatFlowStepApi.page({ pageNo: 2, pageSize: 20, name: '', status: '1' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/chat-flow-step/page')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ pageNo: 2, pageSize: 20, name: '', status: '1' })
    expect(res).toEqual({ total: 3, list: ENVELOPE_PAGE.data })
  })

  it('save（新增，不带 id）：POST /api/poc/chat-flow-step，16 个表单字段原样进 body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { chatFlowStepApi } = await import('./templateConfig')

    const form = { stepCode: 'sql_generate', flowCode: 'chat_main', stepName: 'SQL 生成', templateDef: '问句：{{question}}', retryCount: 3, nextStepCode: 'sql_check' }
    await chatFlowStepApi.save(form)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/chat-flow-step')
    expect(JSON.parse(String(init.body))).toEqual(form)
  })

  it('save（修改，带 id）：POST /api/poc/chat-flow-step/update —— 与新增不是一个端点', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { chatFlowStepApi } = await import('./templateConfig')

    await chatFlowStepApi.save({ id: 11, stepCode: 'sql_generate', flowCode: 'chat_main' })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/chat-flow-step/update')
  })

  it('changeStatus：POST /api/poc/chat-flow-step/status，id 与 status 在 **body**（旧契约，不是 query）', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { chatFlowStepApi } = await import('./templateConfig')

    await chatFlowStepApi.changeStatus?.(11, '0')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/chat-flow-step/status')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ id: 11, status: '0' })
  })

  it('不提供复制与删除（旧后端没有 /poc/chat-flow-step/copy，也没有删除端点）', async () => {
    const { chatFlowStepApi } = await import('./templateConfig')
    expect(chatFlowStepApi.copy).toBeUndefined()
    expect(chatFlowStepApi).not.toHaveProperty('remove')
  })

  it('业务失败（code ≠ 0）抛出后端 msg，不静默成功', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 500, msg: '步骤编码已存在' }))
    const { chatFlowStepApi } = await import('./templateConfig')

    await expect(chatFlowStepApi.save({ stepCode: 'a', flowCode: 'b' })).rejects.toThrow('步骤编码已存在')
  })
})

describe('提示词配置 · mock 内存表（演示 / 单测口径）', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('分页按 status 筛，空串按全部处理；name 传空串不影响结果', async () => {
    const { chatFlowStepApi } = await import('./templateConfig')

    const all = await chatFlowStepApi.page({ pageNo: 1, pageSize: 20, name: '', status: '' })
    expect(all.total).toBeGreaterThan(0)

    const disabled = await chatFlowStepApi.page({ pageNo: 1, pageSize: 20, status: '1' })
    expect(disabled.list.length).toBeGreaterThan(0)
    expect(disabled.list.every((row) => String(row.status) === '1')).toBe(true)
  })

  it('新增/修改/启停真落内存表：新增不带 id、修改按 id 就地更新、不产生新行', async () => {
    const { chatFlowStepApi } = await import('./templateConfig')

    const before = await chatFlowStepApi.page({ pageNo: 1, pageSize: 20 })
    const total = before.total

    await chatFlowStepApi.save({ stepCode: 'mock_step', flowCode: 'chat_main', stepName: '演示步骤', templateDef: '问句：{{question}}', retryCount: 2 })
    const afterAdd = await chatFlowStepApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterAdd.total).toBe(total + 1)

    const added = afterAdd.list.find((row) => row.stepCode === 'mock_step')!
    expect(added.status).toBe('0') // 旧新增弹窗不给 status，内存表按旧 blank 兜 '0'

    await chatFlowStepApi.save({ id: added.id, stepCode: 'mock_step', flowCode: 'chat_main', stepName: '改过的步骤名称' })
    const afterUpdate = await chatFlowStepApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterUpdate.total).toBe(total + 1)
    expect(afterUpdate.list.find((row) => row.id === added.id)?.stepName).toBe('改过的步骤名称')

    await chatFlowStepApi.changeStatus?.(Number(added.id), '1')
    const afterStatus = await chatFlowStepApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterStatus.list.find((row) => row.id === added.id)?.status).toBe('1')
  })
})
