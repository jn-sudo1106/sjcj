// @vitest-environment jsdom
// OCR 服务调用（2026-09-17）：契约按真实服务实测锁定——
// 请求 `{"image": "<裸 base64>"}`，响应 `data.result.data[]` 里一堆 `{block_id,row_id,element_value}`。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ocrBlocksOf, ocrTextOf, readImageAsBase64, recognizeImage, stripDataUrlPrefix } from './ocr'

/** 实测样本的精简版：两行三块，其中一行有两个块 */
const RESPONSE = {
  status: 'success',
  message: 'ok',
  data: { result: { data: [
    { block_id: '1', row_id: '1', element_value: 'Body' },
    { block_id: '2', row_id: '2', element_value: '控制台' },
    { block_id: '3', row_id: '2', element_value: 'Cookie' },
  ] } },
}

function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
    return impl(url, init)
  })
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => vi.restoreAllMocks())

describe('OCR 服务调用', () => {
  it('POST /ocr，body 只有裸 base64（不带 data URL 前缀）', async () => {
    const fetchSpy = mockFetch(() => json(RESPONSE))
    await recognizeImage('iVBORw0KGgoAAA')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/ocr')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ image: 'iVBORw0KGgoAAA' })
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('把 data.result.data[] 归一成文本块', async () => {
    mockFetch(() => json(RESPONSE))
    const result = await recognizeImage('x')

    expect(result.status).toBe('success')
    expect(result.blocks).toEqual([
      { blockId: '1', rowId: '1', text: 'Body' },
      { blockId: '2', rowId: '2', text: '控制台' },
      { blockId: '3', rowId: '2', text: 'Cookie' },
    ])
    expect(result.raw).toEqual(RESPONSE)
  })

  it('按 row_id 聚合成行、同一行的块用空格接', async () => {
    mockFetch(() => json(RESPONSE))
    const result = await recognizeImage('x')
    expect(ocrTextOf(result.blocks)).toBe('Body\n控制台 Cookie')
  })

  it('row_id 是数字时按数值排行，"10" 不排到 "2" 前面', () => {
    const blocks = ['10', '2', '1'].map((row) => ({ blockId: row, rowId: row, text: `R${row}` }))
    expect(ocrTextOf(blocks)).toBe('R1\nR2\nR10')
  })

  it('空图直接拒绝，不发请求', async () => {
    const fetchSpy = mockFetch(() => json(RESPONSE))
    await expect(recognizeImage('   ')).rejects.toThrow('缺少图片内容')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('非 2xx 抛错并带上 HTTP 状态', async () => {
    mockFetch(() => json({ message: 'boom' }, 500))
    await expect(recognizeImage('x')).rejects.toThrow('OCR 服务返回 HTTP 500')
  })

  it('status 不是 success 时抛服务端 message', async () => {
    mockFetch(() => json({ status: 'error', message: '图片格式不支持', data: {} }))
    await expect(recognizeImage('x')).rejects.toThrow('图片格式不支持')
  })

  it('返回里没有识别块时给出可读提示，不静默成功', async () => {
    mockFetch(() => json({ status: 'success', message: 'ok', data: { result: { data: [] } } }))
    await expect(recognizeImage('x')).rejects.toThrow('OCR 未返回识别结果')
  })

  it('结构对不上返回空块列表（不抛），由界面展示原始返回兜底', () => {
    expect(ocrBlocksOf({ data: { result: { data: 'oops' } } })).toEqual([])
    expect(ocrBlocksOf(null)).toEqual([])
  })

  it('剥掉 data URL 前缀；没有前缀的原样返回', () => {
    expect(stripDataUrlPrefix('data:image/png;base64,iVBORw0KGgo=')).toBe('iVBORw0KGgo=')
    expect(stripDataUrlPrefix('iVBORw0KGgo=')).toBe('iVBORw0KGgo=')
  })

  it('readImageAsBase64 读文件并剥前缀', async () => {
    const file = new File(['hello'], 'a.png', { type: 'image/png' })
    // jsdom 的 FileReader 能跑，readAsDataURL 会给出 data:image/png;base64,aGVsbG8=
    await expect(readImageAsBase64(file)).resolves.toBe('aGVsbG8=')
  })
})
