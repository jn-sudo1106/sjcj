// @vitest-environment jsdom
// 分词配置接口契约（1014 从旧 ai-chat-view 迁入，端点域 /poc/word-segment-config）。
// 这个模块有四条容易被"顺手统一"掉的旧口径，全部钉死：
// ① 没有单条新增端点 —— 旧列表的 showAdd 没绑任何按钮（死代码），新增一律走 batch；
// ② batch 的 body 是 **{type,content,token} 对象数组**，不是包装对象；
// ③ 启停 POST /poc/word-segment-config/status 参数走 **body**（与 question-dic 的 query 不同）；
// ④ 分页四个筛选（name/type/token/status）都在 body，name 匹配的是「内容」content。
// 分页契约已在 186 POC 服务实测（2026-10-14）：信封 {code,msg,count,data}，434 条，status 回数字 0。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  // request() 先 res.text() 再 JSON.parse（client.ts 空响应体兜底），mock 响应也要给 text()
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

const ENVELOPE_PAGE = {
  code: 0,
  msg: '请求成功',
  count: 434,
  data: [
    { id: 2669, type: 'ORGANIZATION', content: '新城科技园', token: 'base', status: 0, createTime: '2025-03-25 15:27:18', updateTime: '2025-03-25 15:27:18' },
    { id: 2667, type: 'PERSON', content: '张宪', token: 'base', status: 0, createTime: '2025-03-25 15:07:55', updateTime: '2025-03-25 15:07:55' },
  ],
}
const ENVELOPE_ACK = { code: 0, msg: '请求成功', count: null, data: null }

describe('分词配置 · /api/poc HTTP 契约', () => {
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

  it('page：POST /api/poc/word-segment-config/page，四个筛选与分页全在 body，响应 {count,data} 归一成 {list,total}', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_PAGE))
    const { wordSegmentApi } = await import('./templateConfig')

    const res = await wordSegmentApi.page({ pageNo: 2, pageSize: 20, name: '张', type: 'PERSON', token: 'base', status: '0' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/word-segment-config/page')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ pageNo: 2, pageSize: 20, name: '张', type: 'PERSON', token: 'base', status: '0' })
    expect(res).toEqual({ total: 434, list: ENVELOPE_PAGE.data })
  })

  it('update：POST /api/poc/word-segment-config/update，body 带 id —— 本域没有单条新增端点', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { wordSegmentApi } = await import('./templateConfig')

    await wordSegmentApi.update({ id: 2669, type: 'ORGANIZATION', content: '新城科技园', token: 'base' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/word-segment-config/update')
    expect(JSON.parse(String(init.body))).toEqual({ id: 2669, type: 'ORGANIZATION', content: '新城科技园', token: 'base' })
  })

  it('changeStatus：POST /api/poc/word-segment-config/status，参数走 **body**（不是 query，同 data-index-config）', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { wordSegmentApi } = await import('./templateConfig')

    await wordSegmentApi.changeStatus(2669, '1')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/word-segment-config/status')
    expect(url).not.toContain('?')
    expect(JSON.parse(String(init.body))).toEqual({ id: 2669, status: '1' })
  })

  it('batchAdd：POST /api/poc/word-segment-config/batch，body 是裸 **对象数组**（不是 {list:[...]}）', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { wordSegmentApi } = await import('./templateConfig')

    await wordSegmentApi.batchAdd([
      { type: 'PERSON', content: '张宪', token: 'base' },
      { type: 'ORGANIZATION', content: '白下分行', token: 'base' },
    ])

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/word-segment-config/batch')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual([
      { type: 'PERSON', content: '张宪', token: 'base' },
      { type: 'ORGANIZATION', content: '白下分行', token: 'base' },
    ])
  })

  it('不提供单条新增与复制（旧弹窗的 add 分支没有入口，旧后端也没有 word-segment-config/copy）', async () => {
    const { wordSegmentApi } = await import('./templateConfig')
    const members = wordSegmentApi as unknown as Record<string, unknown>
    expect(members.save).toBeUndefined()
    expect(members.add).toBeUndefined()
    expect(members.copy).toBeUndefined()
  })

  it('业务失败（code ≠ 0）抛出后端 msg，不静默成功', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 500, msg: '未找到对应的分词配置' }))
    const { wordSegmentApi } = await import('./templateConfig')

    await expect(wordSegmentApi.changeStatus(999999, '1')).rejects.toThrow('未找到对应的分词配置')
  })
})

describe('分词配置 · mock 内存表（演示 / 单测口径）', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('分页支持 name（匹配 content）/ type / token / status 四个条件，空串按全部处理', async () => {
    const { wordSegmentApi } = await import('./templateConfig')

    const all = await wordSegmentApi.page({ pageNo: 1, pageSize: 20 })
    expect(all.total).toBeGreaterThan(0)

    const byName = await wordSegmentApi.page({ pageNo: 1, pageSize: 20, name: '分行' })
    expect(byName.list.length).toBeGreaterThan(0)
    expect(byName.list.every((row) => String(row.content).includes('分行'))).toBe(true)

    const byType = await wordSegmentApi.page({ pageNo: 1, pageSize: 20, type: 'PERSON' })
    expect(byType.list.every((row) => String(row.type).includes('PERSON'))).toBe(true)

    const byToken = await wordSegmentApi.page({ pageNo: 1, pageSize: 20, token: 'not-exist' })
    expect(byToken.list).toHaveLength(0)

    const disabled = await wordSegmentApi.page({ pageNo: 1, pageSize: 20, status: '1' })
    expect(disabled.list.length).toBeGreaterThan(0)
    expect(disabled.list.every((row) => String(row.status) === '1')).toBe(true)
  })

  it('修改真落内存表且不新增行', async () => {
    const { wordSegmentApi } = await import('./templateConfig')

    const before = await wordSegmentApi.page({ pageNo: 1, pageSize: 20 })
    const target = before.list.find((row) => row.content === '新城科技园')!

    await wordSegmentApi.update({ id: target.id, type: 'PARK', content: '新城科技园', token: 'base' })
    const after = await wordSegmentApi.page({ pageNo: 1, pageSize: 20 })
    expect(after.total).toBe(before.total)
    expect(after.list.find((row) => row.id === target.id)?.type).toBe('PARK')
  })

  it('启停按 id 改状态（本域 status 走 body），未知 id 回失败回执', async () => {
    const { wordSegmentApi } = await import('./templateConfig')

    const first = await wordSegmentApi.page({ pageNo: 1, pageSize: 20 })
    const target = first.list[0]!

    await wordSegmentApi.changeStatus(Number(target.id), '1')
    const after = await wordSegmentApi.page({ pageNo: 1, pageSize: 20 })
    expect(String(after.list.find((row) => row.id === target.id)?.status)).toBe('1')

    const miss = await wordSegmentApi.changeStatus(999999, '0')
    expect(miss).toMatchObject({ ok: false, message: '未找到对应的分词配置' })
  })

  it('batchAdd 按数组追加行，新行是启用态并带创建时间', async () => {
    const { wordSegmentApi } = await import('./templateConfig')

    const before = await wordSegmentApi.page({ pageNo: 1, pageSize: 20 })

    await wordSegmentApi.batchAdd([
      { type: 'PERSON', content: '批量词条甲', token: 'base' },
      { type: 'ORGANIZATION', content: '批量词条乙', token: 'base' },
    ])
    const after = await wordSegmentApi.page({ pageNo: 1, pageSize: 50 })
    expect(after.total).toBe(before.total + 2)

    const added = after.list.find((row) => row.content === '批量词条甲')!
    expect(added.type).toBe('PERSON')
    expect(String(added.status)).toBe('0')
    expect(added.createTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('batchAdd 传空数组回失败回执，不落任何行（旧版会把空数组也 POST 给后端）', async () => {
    const { wordSegmentApi } = await import('./templateConfig')

    const before = await wordSegmentApi.page({ pageNo: 1, pageSize: 20 })
    const res = await wordSegmentApi.batchAdd([])
    expect(res).toMatchObject({ ok: false, message: '没有要新增的分词配置' })
    const after = await wordSegmentApi.page({ pageNo: 1, pageSize: 20 })
    expect(after.total).toBe(before.total)
  })
})
