// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateSiteScript, submitSiteScriptTask } from './siteScript'

afterEach(() => vi.restoreAllMocks())

describe('generateSiteScript', () => {
  it('任务方式只保存数据库任务，不调用业务 MQ 或轮询结果', async () => {
    const { sourceApi } = await import('./index')
    const { runnerManagementApi } = await import('./runnerManagement')
    const send = vi.spyOn(sourceApi, 'sendCodeConfig')
    const create = vi.spyOn(runnerManagementApi, 'createCodeGenerationTask').mockResolvedValue({ job: { taskId: '501' } as never })
    const fetch = vi.spyOn(globalThis, 'fetch')
    const receipt = await submitSiteScriptTask({ taskContext: { sourceId: '1', flowId: '2', stepId: '3' }, configId: '1401081', interfaceId: 'agent', prompt: '生成', url: 'https://example.com', sampleId: 'www.realcan.cn.py' })
    expect(receipt).toEqual({ taskId: '501', queue: '' })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sourceId: '1', flowId: '2', stepId: '3', configId: '1401081', generation: expect.objectContaining({ interfaceId: 'agent' }) }))
    expect(send).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('停止查看保留已创建的数据库任务，不转为直接调用', async () => {
    const { runnerManagementApi } = await import('./runnerManagement')
    const create = vi.spyOn(runnerManagementApi, 'createCodeGenerationTask').mockResolvedValue({ job: { taskId: '501' } as never })
    const fetch = vi.spyOn(globalThis, 'fetch')
    const controller = new AbortController()
    await expect(generateSiteScript({ taskContext: { sourceId: '1', flowId: '2', stepId: '3' }, configId: '1401081', prompt: '生成', url: 'https://example.com', sampleId: 'www.realcan.cn.py' }, controller.signal, event => {
      if (event.type === 'task' && event.status === 'waiting') controller.abort()
    })).rejects.toThrow()
    expect(create).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('从数据库详情接口取得过程输出和生成结果', async () => {
    const { runnerManagementApi } = await import('./runnerManagement')
    vi.spyOn(runnerManagementApi, 'createCodeGenerationTask').mockResolvedValue({ job: { taskId: '501' } as never })
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ job: { status: 'succeeded', stages: ['模型生成完成'], output: '实际模型输出', result: { fileName: 'example.com.py', code: 'def scrape(url): return []', warnings: [] } } })))
    const events = vi.fn()
    const result = await generateSiteScript({ taskContext: { sourceId: '1', flowId: '2', stepId: '3' }, configId: '1401081', prompt: '生成', url: 'https://example.com', sampleId: 'www.realcan.cn.py' }, undefined, events)
    expect(fetch).toHaveBeenCalledWith('/api/runner-management/code-generation/tasks/detail?taskId=501', expect.anything())
    expect(events).toHaveBeenCalledWith({ type: 'chunk', text: '实际模型输出' })
    expect(events).toHaveBeenCalledWith({ type: 'task', taskId: '501', queue: '', status: 'succeeded' })
    expect(result.code).toContain('def scrape')
  })
  it('分段接收实际生成过程并等待最终代码，支持跨字节中文', async () => {
    const encoder = new TextEncoder()
    let release!: () => void
    const wait = new Promise<void>(resolve => { release = resolve })
    const bytes = encoder.encode(JSON.stringify({ type: 'chunk', text: '正在生成代码' }) + '\n')
    const stream = new ReadableStream({ async start(controller) {
      controller.enqueue(bytes.slice(0, 31)); controller.enqueue(bytes.slice(31))
      await wait
      controller.enqueue(encoder.encode(JSON.stringify({ type: 'result', result: { fileName: 'example.com.py', code: 'def scrape(url): return []', warnings: [] } }) + '\n'))
      controller.close()
    } })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } }))
    const events: unknown[] = []
    const result = await generateSiteScript({ interfaceId: 'chat', prompt: '生成', url: 'https://example.com', sampleId: 'www.realcan.cn.py' }, undefined, event => { events.push(event); release() })
    expect(result.code).toContain('def scrape')
    expect(events).toEqual([{ type: 'chunk', text: '正在生成代码' }])
  })
  it('保留已收到过程，错误或缺少最终结果时不误报成功', async () => {
    const encode = (events: unknown[]) => new Response(events.map(e => JSON.stringify(e)).join('\n'), { headers: { 'Content-Type': 'application/x-ndjson' } })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(encode([{ type: 'chunk', text: '已收到内容' }, { type: 'error', message: '模型连接中断' }]))
      .mockResolvedValueOnce(encode([{ type: 'chunk', text: '只有过程' }]))
    const input = { interfaceId: 'chat', prompt: '生成', url: 'https://example.com', sampleId: 'www.realcan.cn.py' as const }
    const seen = vi.fn()
    await expect(generateSiteScript(input, undefined, seen)).rejects.toThrow('模型连接中断')
    expect(seen).toHaveBeenCalledWith({ type: 'chunk', text: '已收到内容' })
    await expect(generateSiteScript(input, undefined, seen)).rejects.toThrow('生成响应中断')
  })
  it('接收实际模型请求详情，不把最终请求当作生成结果', async () => {
    const request = { method: 'POST', url: 'http://192.168.1.171:6000/wb/agent', headers: { 'Content-Type': 'application/json' }, body: { prompt: '实际提示词', cdp_port: 9223 } }
    const raw = [{ type: 'request', request }, { type: 'result', result: { fileName: 'example.com.py', code: 'def scrape(url): return []', warnings: [] } }].map(e => JSON.stringify(e)).join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(raw, { headers: { 'Content-Type': 'application/x-ndjson' } }))
    const seen = vi.fn()
    await generateSiteScript({ interfaceId: 'chat', prompt: '生成', url: 'https://example.com', sampleId: 'www.realcan.cn.py' }, undefined, seen)
    expect(seen).toHaveBeenCalledWith({ type: 'request', request })
  })
  it('允许多文件归档没有 Python 预览，但拒绝无效归档记录', async () => {
    const archive = { archiveId: 'a'.repeat(32), status: 'pending', files: [] }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ fileName: 'newslink.py', code: '', archive, warnings: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ fileName: 'newslink.py', code: '', archive: {}, warnings: [] })))
    const input = { interfaceId: 'remote', configId: '101', repositoryId: 'repo', directoryId: 'default', autoCommit: true,
      prompt: '生成代码', url: 'https://example.com', sampleId: 'www.realcan.cn.py' as const }
    expect((await generateSiteScript(input)).archive?.archiveId).toBe(archive.archiveId)
    expect(JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string).repositoryId).toBe('repo')
    await expect(generateSiteScript(input)).rejects.toThrow('代码归档服务返回的数据无效')
  })
  it('routes a selected model through the server adapter without exposing its address in generation input', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ fileName: 'example.com.py', code: 'def scrape(url): return []', warnings: [] })))
    await generateSiteScript({ interfaceId: 'chat-hy3', prompt: '需求', url: 'https://example.com', sampleId: 'www.realcan.cn.py' })
    expect(spy).toHaveBeenCalledWith('/api/runner-management/model-interfaces/generate', expect.objectContaining({ body: expect.stringContaining('"interfaceId":"chat-hy3"') }))
  })
  it('sends prompt, URL and fixed sample id to the isolated generation service', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      fileName: 'www.realcan.cn.py',
      code: 'def scrape(url):\n    return []\n',
      warnings: [],
    }), { status: 200 }))
    const result = await generateSiteScript({
      prompt: '抓取新闻标题',
      url: 'https://www.realcan.cn/newscenter',
      sampleId: 'www.realcan.cn.py',
    })
    expect(result.fileName).toBe('www.realcan.cn.py')
    expect(fetchSpy).toHaveBeenCalledWith('/api/ai/site-script/generate', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        prompt: '抓取新闻标题',
        url: 'https://www.realcan.cn/newscenter',
        sampleId: 'www.realcan.cn.py',
      }),
    }))
  })

  it('shows service validation errors instead of accepting invalid results', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ message: '生成的 Python 语法错误' }), { status: 422 }))
    await expect(generateSiteScript({ prompt: 'x', url: 'https://www.realcan.cn', sampleId: 'www.realcan.cn.py' }))
      .rejects.toThrow('生成的 Python 语法错误')
  })
  it('passes the edited system and user prompts separately without combining roles', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ fileName: 'example.com.py', code: 'def scrape(url):\n    return []\n', warnings: [] }), { status: 200 }))
    const input = { prompt: '用户抓取要求', userPrompt: '用户抓取要求', systemPrompt: '系统代码规范', url: 'https://example.com/list', sampleId: 'www.realcan.cn.py' as const }
    await generateSiteScript(input)
    expect(JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string)).toEqual(input)
  })
})
