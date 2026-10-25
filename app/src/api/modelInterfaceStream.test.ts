// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { formatModelTestOutput, streamModelInterfaceTest, type ModelTestEvent } from './modelInterfaceStream'
afterEach(() => vi.restoreAllMocks())
it('JSON reply 还原中文与换行，保留代码中的反斜杠，不展示请求回显', () => {
  const raw = '{"model":"gemini","prompt":"不要显示请求内容","reply":"\\u4f60\\u597d\\n第二行","status":"success"}'
  expect(formatModelTestOutput(raw)).toBe('你好\n第二行')
  const code = 'path = r"D:\\temp\\u1234"'
  expect(formatModelTestOutput(JSON.stringify({ reply: code }))).toBe(code)
  expect(formatModelTestOutput('普通流式文本')).toBe('普通流式文本')
  expect(formatModelTestOutput('[INFO] 正在执行', true)).toBe('[INFO] 正在执行')
  expect(formatModelTestOutput('{"reply":"\\u4f', true)).toContain('正在接收')
  expect(formatModelTestOutput('{invalid', false)).toBe('{invalid')
})
it('在连接关闭前交付首段内容，正确解码跨网络块的中文', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body))
  const events: ModelTestEvent[] = [], encoder = new TextEncoder()
  let finished = false
  const task = streamModelInterfaceTest({ interfaceId: 'a', prompt: '问题' }, event => events.push(event)).then(() => { finished = true })
  const first = encoder.encode(JSON.stringify({ type: 'chunk', text: '你好', durationMs: 1 }) + '\n')
  const split = first.indexOf(0xe4) + 1
  controller.enqueue(first.slice(0, split)); await flushPromises()
  expect(events).toEqual([])
  controller.enqueue(first.slice(split)); await flushPromises()
  expect(events).toEqual([expect.objectContaining({ text: '你好' })])
  expect(finished).toBe(false)
  controller.enqueue(encoder.encode('{"type":"done","durationMs":2}\n')); controller.close(); await task
  expect(finished).toBe(true)
  expect(JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string).responseStream).toBe(true)
})
it('中途断流或错误帧不能被误判为完成', async () => {
  const emit = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{"type":"chunk","text":"部分输出","durationMs":1}\n'))
    .mockResolvedValueOnce(new Response('{"type":"error","message":"模型超时"}\n'))
  await expect(streamModelInterfaceTest({ interfaceId: 'a', prompt: '问题' }, emit)).rejects.toThrow('响应中断')
  expect(emit).toHaveBeenCalledWith(expect.objectContaining({ text: '部分输出' }))
  await expect(streamModelInterfaceTest({ interfaceId: 'a', prompt: '问题' }, emit)).rejects.toThrow('模型超时')
})
