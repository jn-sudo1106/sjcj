// @vitest-environment jsdom
// 问句改写配置接口契约（1013 从旧 ai-chat-view 迁入）。
// 这个模块的旧口径有三条容易被"顺手统一"掉，全部钉死：
// ① 新增与修改是两个端点（POST /poc/question-dic 与 POST /poc/question-dic/update）；
// ② 启停参数走 **query**（旧 questionDicDataStatus 用 axios params），分页与保存走 body；
// ③ 删除 POST /poc/question-dic/deleteQuestionDic，body 发**整行**（旧页面 handleDelete(row) 直接传行对象）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  // request() 先 res.text() 再 JSON.parse（client.ts 空响应体兜底），mock 响应也要给 text()
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

const ENVELOPE_PAGE = {
  code: 0,
  msg: '请求成功',
  count: 3,
  data: [{ id: 11, stepCode: 'before-llm', type: '11', content: '各个机构', targetContent: '各机构', status: '1', createTime: '2025-01-08 15:21:40' }],
}
const ENVELOPE_ACK = { code: 0, msg: '请求成功', count: null, data: null }

describe('问句改写配置 · /api/poc HTTP 契约', () => {
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

  it('page：POST /api/poc/question-dic/page，四个筛选项与分页全在 body，响应 {count,data} 归一成 {list,total}', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_PAGE))
    const { questionDicApi } = await import('./templateConfig')

    const res = await questionDicApi.page({ pageNo: 2, pageSize: 20, name: '机构', stepCode: 'before-llm', type: '11', status: '1' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/question-dic/page')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ pageNo: 2, pageSize: 20, name: '机构', stepCode: 'before-llm', type: '11', status: '1' })
    expect(res).toEqual({ total: 3, list: ENVELOPE_PAGE.data })
  })

  it('save（新增，不带 id）：POST /api/poc/question-dic，tag 空串与 status="0" 原样进 body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { questionDicApi } = await import('./templateConfig')

    await questionDicApi.save({ stepCode: 'pre-replace', type: '10', content: '上个月', targetContent: '上月', tag: '', status: '0' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/question-dic')
    expect(JSON.parse(String(init.body))).toEqual({ stepCode: 'pre-replace', type: '10', content: '上个月', targetContent: '上月', tag: '', status: '0' })
  })

  it('save（修改，带 id）：POST /api/poc/question-dic/update —— 与新增不是一个端点', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { questionDicApi } = await import('./templateConfig')

    await questionDicApi.save({ id: 11, stepCode: 'before-llm', type: '11', content: '各机构' })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/question-dic/update')
  })

  it('changeStatus：POST /api/poc/question-dic/status，id 与 status 在 **query**、无 body（旧契约）', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { questionDicApi } = await import('./templateConfig')

    await questionDicApi.changeStatus?.(11, '0')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/question-dic/status?id=11&status=0')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
  })

  it('remove：POST /api/poc/question-dic/deleteQuestionDic，body 发整行（不只发 id）', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { questionDicApi } = await import('./templateConfig')

    const row = { id: 11, stepCode: 'before-llm', type: '11', content: '各个机构', status: '1' }
    await questionDicApi.remove(row)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/question-dic/deleteQuestionDic')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual(row)
  })

  it('不提供复制（旧后端没有 /poc/question-dic/copy）', async () => {
    const { questionDicApi } = await import('./templateConfig')
    expect(questionDicApi.copy).toBeUndefined()
  })

  it('业务失败（code ≠ 0）抛出后端 msg，不静默成功', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 500, msg: '改写规则不存在' }))
    const { questionDicApi } = await import('./templateConfig')

    await expect(questionDicApi.remove({ id: 999 })).rejects.toThrow('改写规则不存在')
  })
})

describe('问句改写配置 · mock 内存表（演示 / 单测口径）', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('分页支持 name/stepCode/type/status 四条件筛选，空串按全部处理', async () => {
    const { questionDicApi } = await import('./templateConfig')

    const all = await questionDicApi.page({ pageNo: 1, pageSize: 20, name: '', stepCode: '', type: '', status: '' })
    expect(all.total).toBeGreaterThan(0)

    const byStep = await questionDicApi.page({ pageNo: 1, pageSize: 20, stepCode: 'before-llm' })
    expect(byStep.list.every((row) => row.stepCode === 'before-llm')).toBe(true)

    const byType = await questionDicApi.page({ pageNo: 1, pageSize: 20, type: '10' })
    expect(byType.list.every((row) => String(row.type) === '10')).toBe(true)

    const byStatus = await questionDicApi.page({ pageNo: 1, pageSize: 20, status: '1' })
    expect(byStatus.list.every((row) => String(row.status) === '1')).toBe(true)

    const byName = await questionDicApi.page({ pageNo: 1, pageSize: 20, name: '机构' })
    expect(byName.list.every((row) => String(row.content).includes('机构'))).toBe(true)
  })

  it('新增/修改/启停/删除真落内存表', async () => {
    const { questionDicApi } = await import('./templateConfig')

    const first = await questionDicApi.page({ pageNo: 1, pageSize: 20 })
    const before = first.total

    // 新增（不带 id）
    await questionDicApi.save({ stepCode: 'after-replace', type: '10', content: '新增的改写内容', targetContent: '新增目标', tag: '', status: '0' })
    const afterAdd = await questionDicApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterAdd.total).toBe(before + 1)

    const added = afterAdd.list.find((row) => row.content === '新增的改写内容')!

    // 修改（带 id）更新原行，不新增
    await questionDicApi.save({ id: added.id, stepCode: 'after-replace', type: '11', content: '改过的改写内容' })
    const afterUpdate = await questionDicApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterUpdate.total).toBe(before + 1)
    expect(afterUpdate.list.find((row) => row.id === added.id)?.content).toBe('改过的改写内容')

    // 启停
    await questionDicApi.changeStatus?.(Number(added.id), '1')
    const afterStatus = await questionDicApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterStatus.list.find((row) => row.id === added.id)?.status).toBe('1')

    // 删除：整行发过去，真从内存表移除
    const target = afterStatus.list.find((row) => row.id === added.id)!
    await questionDicApi.remove(target)
    const afterDelete = await questionDicApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterDelete.total).toBe(before)
    expect(afterDelete.list.find((row) => row.id === added.id)).toBeUndefined()
  })
})
