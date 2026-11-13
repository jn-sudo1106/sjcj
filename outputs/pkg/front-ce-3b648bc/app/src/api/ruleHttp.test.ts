// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  // request() 现在先 res.text() 再 JSON.parse（client.ts 空响应体兜底），mock 也要跟着给 text()
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

describe('规则编排 API · vrule HTTP 契约（0801 §8）', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.stubEnv('VITE_API_BASE', '')
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  const sampleCfg = {
    mode: 'new' as const,
    name: '邮箱附件转换指标数据规则',
    describe: '转换',
    dataSource: 'dp-wwdata',
    inputTable: 'sense_data.TB_email_XQ',
    outputTable: 'sense_data.TB_INDICATOR_DATA',
    inputFields: ['date', 'zb_value'],
    outputFields: ['end_date', 'indicator_data'],
  }

  it('orchestrationSaveMeta：POST /vrule/api/custom-compose/save，旧体字段 + FromLegacy 取 ruleId', async () => {
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: { id: 173, msg: 'ok' } }))
    const { ruleApi } = await import('./index')

    const result = await ruleApi.orchestrationSaveMeta(sampleCfg, 'ht_poc')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/vrule/api/custom-compose/save')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toMatchObject({
      state: 1,
      ruleType: '数据处理',
      dataSource: 'dp-wwdata',
      userCode: 'ht_poc',
      ruleName: '邮箱附件转换指标数据规则',
      targetTable: 'sense_data.TB_email_XQ',
      inputFields: 'date,zb_value',
      outputFields: 'end_date,indicator_data',
    })
    expect(result.ruleId).toBe('173')
  })

  it('orchestrationSaveMeta：响应无 id 时用 list/compose 按名称回查', async () => {
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: '0', data: null }))
      .mockResolvedValueOnce(jsonResponse({
        records: [{ id: 180, ruleName: sampleCfg.name, targetTable: sampleCfg.inputTable }],
      }))
    const { ruleApi } = await import('./index')

    const result = await ruleApi.orchestrationSaveMeta(sampleCfg, 'ht_poc')

    expect(fetchMock.mock.calls[0][0]).toBe('/vrule/api/custom-compose/save')
    expect(fetchMock.mock.calls[1][0]).toBe('/vrule/ai/dashscope/list/compose')
    expect(result.ruleId).toBe('180')
  })

  it('orchestrationTest：POST /vrule/fastapi/execute/dynamic，params 取 rows[0]', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0',
      data: {
        success: true,
        result: [{ end_date: '2025-01-01' }],
        execution_time: 0.12,
        code_hash: 'abc',
      },
    }))
    const { ruleApi } = await import('./index')

    const result = await ruleApi.orchestrationTest({
      ruleId: '173',
      inputTable: 'sense_data.TB_email_XQ',
      inputFields: ['date'],
      outputFields: ['end_date'],
      rows: [{ date: '2025年' }],
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/vrule/fastapi/execute/dynamic')
    expect(JSON.parse(String(init.body))).toEqual({
      rule_id: '173',
      params: { date: '2025年' },
      timeout: 300,
    })
    expect(result.success).toBe(true)
    expect(result.outputs).toEqual([{ end_date: '2025-01-01' }])
    expect(result.codeHash).toBe('abc')
  })

  it('executeCode：POST /vrule/fastapi/execute/code，body 传 code_path / params / timeout', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0',
      data: {
        success: true,
        result: [{ ok: true }],
        message: 'done',
      },
    }))
    const { ruleApi } = await import('./index')

    const result = await ruleApi.executeCode({
      codePath: '/code01/202609/1788327078099.py',
      params: { content: '正文', title: '测试行' },
      timeout: 300,
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/vrule/fastapi/execute/code')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual({
      code_path: '/code01/202609/1788327078099.py',
      params: { content: '正文', title: '测试行' },
      timeout: 300,
    })
    expect(result).toMatchObject({ success: true, result: [{ ok: true }] })
  })

  it('executeCode：未传 params 时 body 不带 params 字段', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0',
      data: {
        success: true,
        result: [{ ok: true }],
      },
    }))
    const { ruleApi } = await import('./index')

    await ruleApi.executeCode({
      codePath: '/code01/202609/1788774054213.py',
      timeout: 300,
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      code_path: '/code01/202609/1788774054213.py',
      timeout: 300,
    })
  })

  it('fileUploadScript：POST /api/file/upload，fileId 和脚本文本都在 JSON body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: null }))
    const { ruleApi } = await import('./index')

    const script = 'import json\n\ndef main(code, name):\n    return {"命中": code == "1121250", "名称": name}'
    await ruleApi.fileUploadScript('/code01/202609/1789022685732.py', script)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/file/upload')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      fileId: '/code01/202609/1789022685732.py',
      body: script,
    })
  })

  it('fileUploadScript：接口返回纯文本脚本路径时按成功处理，不尝试 JSON.parse', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '/code01/202609/1789022685732.py',
    } as Response)
    const { ruleApi } = await import('./index')

    await expect(ruleApi.fileUploadScript('/code01/202609/1789022685732.py', 'def main():\n    return {}'))
      .resolves.toMatchObject({ ok: true, message: '/code01/202609/1789022685732.py' })
  })

  it('dataProcessGenerate：POST /api/answer/data-process，按 SSE event/data 解析 thinking/content/done', async () => {
    const streamText = [
      'event: thinking',
      'data:正在确认输入表',
      '',
      'event: thinking',
      'data:正在确认字段',
      '',
      'event: content',
      'data:def process(date, zb_value):',
      'data:    return {"end_date": "2025-01-01"}',
      '',
      'event: done',
      'data:{"scriptPath":"/code01/20260801/abc.py","message":"保存完成"}',
    ].join('\n')
    const encoder = new TextEncoder()
    const chunks = [encoder.encode(streamText.slice(0, 30)), encoder.encode(streamText.slice(30, 60)), encoder.encode(streamText.slice(60))]
    let i = 0
    const thinking: string[] = []
    const content: string[] = []
    const done: string[] = []
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }),
        }),
      },
    } as unknown as Response)
    // 打开 live 逃逸：vitest 默认 DISABLE_LIVE_ENDPOINTS=1，本用例要测真实 HTTP 路径
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    const { ruleApi } = await import('./index')

    const result = await ruleApi.dataProcessGenerate({
      description: '按字段生成',
      configId: 184,
      providerCode: 'DeepSeek',
      model: 'deepseek-v4-flash',
      sourceTable: 'sense_data.TB_email_XQ',
      targetTable: 'sense_data.TB_INDICATOR_DATA',
      inputFields: 'date:date,zb_value:zb_value',
      outputFields: 'end_date:end_date,indicator_data:indicator_data',
      systemPrompt: '只返回 JSON',
    }, {
      onThinking: (delta) => thinking.push(delta),
      onContent: (delta) => content.push(delta),
      onDone: (payload) => done.push(payload.message || payload.scriptPath || ''),
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/answer/data-process')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(String(init.body))).toMatchObject({
      description: '按字段生成',
      configId: 184,
      providerCode: 'DeepSeek',
      model: 'deepseek-v4-flash',
      sourceTable: 'sense_data.TB_email_XQ',
      targetTable: 'sense_data.TB_INDICATOR_DATA',
      inputFields: 'date:date,zb_value:zb_value',
      outputFields: 'end_date:end_date,indicator_data:indicator_data',
      systemPrompt: '只返回 JSON',
    })
    expect(thinking.join('')).toBe('正在确认输入表正在确认字段')
    expect(content).toEqual(['def process(date, zb_value):\n    return {"end_date": "2025-01-01"}'])
    expect(done).toEqual(['保存完成'])
    expect(result.script).toBe('def process(date, zb_value):\n    return {"end_date": "2025-01-01"}')
    expect(result.scriptPath).toBe('/code01/20260801/abc.py')
  })

  it('dataProcessGenerate：保留后端 data: 后正文中的 token 空格和 Python 缩进', async () => {
    const streamText = [
      'event:content',
      'data:def',
      '',
      'event:content',
      'data: process():',
      '',
      'event:content',
      'data:    return {"ok": True}',
      '',
      'event:done',
      'data:{"scriptPath":"/code01/202609/generated.py"}',
    ].join('\n')
    const encoder = new TextEncoder()
    let read = false
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (read) return { done: true, value: undefined }
            read = true
            return { done: false, value: encoder.encode(streamText) }
          },
        }),
      },
    } as unknown as Response)
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    const { ruleApi } = await import('./index')

    const content: string[] = []
    const result = await ruleApi.dataProcessGenerate({
      description: '按字段生成',
      configId: 184,
      providerCode: 'DeepSeek',
      model: 'deepseek-v4-flash',
      sourceTable: 'sense_data.TB_email_XQ',
      targetTable: 'sense_data.TB_INDICATOR_DATA',
      inputFields: 'date:date',
      outputFields: 'ok:ok',
      systemPrompt: '只返回 Python',
    }, {
      onContent: (delta) => content.push(delta),
    })

    expect(content).toEqual(['def', ' process():', '    return {"ok": True}'])
    expect(result.script).toBe('def process():    return {"ok": True}')
  })

  it('dataProcessGenerate：带 Excel 时发送 request JSON Blob 和单个 file，不手动设置 multipart Content-Type', async () => {
    const streamText = [
      'event: content',
      'data:def process():',
      '',
      'event: done',
      'data:# 当前文件已保存到/code01/202609/generated.py',
    ].join('\n')
    const encoder = new TextEncoder()
    let read = false
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (read) return { done: true, value: undefined }
            read = true
            return { done: false, value: encoder.encode(streamText) }
          },
        }),
      },
    } as unknown as Response)
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    const { ruleApi } = await import('./index')
    const file = new File(['date,name'], 'orders.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const result = await ruleApi.dataProcessGenerate({
      description: '根据 Excel 生成 Python',
      configId: 184,
      providerCode: 'OpenAI',
      model: 'gpt-5',
      sourceTable: '订单表',
      targetTable: '订单结果表',
      inputFields: '日期:date',
      outputFields: '标题:title',
      systemPrompt: '只返回 Python',
    }, { file })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
    expect(init.body).toBeInstanceOf(FormData)
    const form = init.body as FormData
    const requestPart = form.get('request')
    expect(requestPart).toBeInstanceOf(Blob)
    expect((requestPart as Blob).type).toBe('application/json')
    await expect((requestPart as Blob).text()).resolves.toContain('"configId":184')
    expect(form.get('file')).toBe(file)
    expect(result).toMatchObject({
      script: 'def process():',
      scriptPath: '/code01/202609/generated.py',
    })
  })

  // 1005：PDF 抓取「解析内容」。multipart 口径与 data-process 一致，但返回值只有正文与元信息
  // ——done 里那句"已保存到 xxx.py"不能像生成脚本那样被正则提成 scriptPath（方案 §5.2）。
  it('documentExtract：发送 request JSON Blob 与 PDF file，不手写 multipart Content-Type，done 不解析脚本路径', async () => {
    const streamText = [
      'event: thinking',
      'data:先读文档结构',
      '',
      'event: content',
      'data:甲方：某某公司',
      '',
      'event: content',
      'data:金额：12 万元',
      '',
      'event: done',
      'data:# 当前文件已保存到/code01/202609/generated.py',
    ].join('\n')
    const encoder = new TextEncoder()
    let read = false
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (read) return { done: true, value: undefined }
            read = true
            return { done: false, value: encoder.encode(streamText) }
          },
        }),
      },
    } as unknown as Response)
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    const { ruleApi } = await import('./index')
    const file = new File(['%PDF-1.7'], 'report.pdf', { type: 'application/pdf' })
    const thinking: string[] = []
    const content: string[] = []
    let donePayload: Record<string, unknown> | undefined

    const result = await ruleApi.documentExtract({
      description: '抽取合同双方与金额',
      systemPrompt: '只输出字段与值',
      configId: 184,
      providerCode: 'OpenAI',
      model: 'gpt-5',
      outputFields: '甲方:party_a,金额:amount',
      outputFormat: 'text',
    }, {
      file,
      onThinking: (delta) => thinking.push(delta),
      onContent: (delta) => content.push(delta),
      onDone: (payload) => { donePayload = payload as Record<string, unknown> },
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/answer/document-extract')
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
    expect(init.body).toBeInstanceOf(FormData)
    const form = init.body as FormData
    const requestPart = form.get('request')
    expect(requestPart).toBeInstanceOf(Blob)
    expect((requestPart as Blob).type).toBe('application/json')
    await expect((requestPart as Blob).text()).resolves.toContain('"configId":184')
    expect(form.get('file')).toBe(file)
    expect(thinking).toEqual(['先读文档结构'])
    expect(content).toEqual(['甲方：某某公司', '金额：12 万元'])
    expect(result).toEqual({ content: '甲方：某某公司金额：12 万元', charCount: 15, truncated: false, chunkCount: 1, sourceCharCount: 0, mergeRounds: 0 })
    expect(result).not.toHaveProperty('scriptPath')
    expect(donePayload).toMatchObject({ message: '# 当前文件已保存到/code01/202609/generated.py' })
  })

  it('documentExtract：done 的 JSON 元信息带回 charCount 与 truncated', async () => {
    const streamText = [
      'event: content',
      'data:正文',
      '',
      'event: done',
      'data:{"message":"解析完成","charCount":2,"truncated":true}',
    ].join('\n')
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => streamText,
    } as unknown as Response)
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    const { ruleApi } = await import('./index')

    const result = await ruleApi.documentExtract({
      description: '抽取合同双方与金额',
      systemPrompt: '只输出字段与值',
      configId: 184,
      providerCode: 'OpenAI',
      model: 'gpt-5',
      outputFields: '',
      outputFormat: 'text',
    }, { file: new File(['%PDF-1.7'], 'report.pdf', { type: 'application/pdf' }) })

    expect(result).toEqual({ content: '正文', charCount: 2, truncated: true, chunkCount: 1, sourceCharCount: 0, mergeRounds: 0 })
  })

  // 1005 §11：分块抽取的 map/merge 事件。合并轮第一段是新的正文，之前铺开的分段结果必须丢掉；
  // 陌生的事件名不能拼进正文，中途失败靠 in-band 的 error 事件（HTTP 状态早就是 200）。
  it('documentExtract：chunk 事件驱动进度与合并重铺，error 事件让整次解析失败且不返回半截正文', async () => {
    const streamText = [
      'event: chunk',
      'data:{"phase":"map","index":1,"total":2,"pages":"第 1-2 页","charCount":12000,"last":false}',
      '',
      'event: content',
      'data:第一段结果',
      '',
      'event: chunk',
      'data:{"phase":"map","index":2,"total":2,"pages":"第 3 页","charCount":640,"last":false}',
      '',
      'event: content',
      'data:第二段结果',
      '',
      'event: metric',
      'data:{"ignored":true}',
      '',
      'event: chunk',
      'data:{"phase":"merge","index":1,"total":1,"pages":null,"charCount":1300,"last":true}',
      '',
      'event: content',
      'data:合并后的完整结果',
      '',
      'event: done',
      'data:{"message":"解析完成","charCount":9,"truncated":false,"chunkCount":2,"sourceCharCount":23456,"mergeRounds":1}',
    ].join('\n')
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => streamText,
    } as unknown as Response)
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    const { ruleApi } = await import('./index')

    const progress: Array<Record<string, unknown>> = []
    const result = await ruleApi.documentExtract({
      description: '抽取合同双方与金额',
      systemPrompt: '只输出字段与值',
      configId: 184,
      providerCode: 'OpenAI',
      model: 'gpt-5',
      outputFields: '',
      outputFormat: 'text',
    }, {
      file: new File(['%PDF-1.7'], 'report.pdf', { type: 'application/pdf' }),
      onChunk: (payload) => progress.push(payload as unknown as Record<string, unknown>),
    })

    expect(progress.map((p) => `${p.phase} ${p.index}/${p.total}`)).toEqual(['map 1/2', 'map 2/2', 'merge 1/1'])
    expect(progress[0]?.pages).toBe('第 1-2 页')
    expect(progress[2]?.pages).toBeUndefined()
    expect(result).toEqual({
      content: '合并后的完整结果',
      charCount: 9,
      truncated: false,
      chunkCount: 2,
      sourceCharCount: 23456,
      mergeRounds: 1,
    })

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => [
        'event: chunk',
        'data:{"phase":"map","index":1,"total":2,"pages":"第 1 页","charCount":12000,"last":false}',
        '',
        'event: content',
        'data:第一段结果',
        '',
        'event: error',
        'data:第 2/2 块抽取失败：模型超时',
      ].join('\n'),
    } as unknown as Response)
    await expect(ruleApi.documentExtract({
      description: '抽取合同双方与金额',
      systemPrompt: '只输出字段与值',
      configId: 184,
      providerCode: 'OpenAI',
      model: 'gpt-5',
      outputFields: '',
      outputFormat: 'text',
    }, { file: new File(['%PDF-1.7'], 'report.pdf', { type: 'application/pdf' }) }))
      .rejects.toThrow('第 2/2 块抽取失败：模型超时')
  })

  it('documentExtract：HTTP 400 优先展示后端 error 字段', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: '仅支持 .xls 或 .xlsx 文件' }),
    } as unknown as Response)
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    const { ruleApi } = await import('./index')

    await expect(ruleApi.documentExtract({
      description: '抽取合同双方与金额',
      systemPrompt: '只输出字段与值',
      configId: 184,
      providerCode: 'OpenAI',
      model: 'gpt-5',
      outputFields: '',
      outputFormat: 'text',
    }, { file: new File(['x'], 'sheet.xlsx') })).rejects.toThrow('仅支持 .xls 或 .xlsx 文件')
  })

  it('dataProcessGenerate：收到 done 后忽略后续 content 事件', async () => {
    const streamText = [
      'event: content',
      'data:def process():',
      '',
      'event: done',
      'data:{"scriptPath":"/code01/202609/generated.py"}',
      '',
      'event: content',
      'data:SHOULD_NOT_BE_APPENDED',
    ].join('\n')
    const encoder = new TextEncoder()
    let read = false
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (read) return { done: true, value: undefined }
            read = true
            return { done: false, value: encoder.encode(streamText) }
          },
        }),
      },
    } as unknown as Response)
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    const { ruleApi } = await import('./index')

    const result = await ruleApi.dataProcessGenerate({
      description: '根据 Excel 生成 Python',
      configId: 184,
      providerCode: 'OpenAI',
      model: 'gpt-5',
      sourceTable: '订单表',
      targetTable: '订单结果表',
      inputFields: '日期:date',
      outputFields: '标题:title',
      systemPrompt: '只返回 Python',
    })

    expect(result.script).toBe('def process():')
    expect(result.script).not.toContain('SHOULD_NOT_BE_APPENDED')
  })

  it('dataProcessGenerate：HTTP 400 优先展示后端 error 字段', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      clone: () => ({
        json: async () => ({ error: 'Excel 文件格式不支持' }),
      }),
      text: async () => JSON.stringify({ error: 'Excel 文件格式不支持' }),
    } as unknown as Response)
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    const { ruleApi } = await import('./index')

    await expect(ruleApi.dataProcessGenerate({
      description: '根据 Excel 生成 Python',
      configId: 184,
      providerCode: 'OpenAI',
      model: 'gpt-5',
      sourceTable: '订单表',
      targetTable: '订单结果表',
      inputFields: '日期:date',
      outputFields: '标题:title',
      systemPrompt: '只返回 Python',
    })).rejects.toThrow('Excel 文件格式不支持')
  })

  it('dataProcessGenerate：响应体流式读取期间触发外部 abort 会中断 reader', async () => {
    let requestSignal: AbortSignal | undefined
    fetchMock.mockImplementation(async (_input: unknown, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: () => new Promise((_resolve, reject) => {
              requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true })
            }),
          }),
        },
      } as unknown as Response
    })
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    const { ruleApi } = await import('./index')
    const externalController = new AbortController()
    const pending = ruleApi.dataProcessGenerate({
      description: '按字段生成',
      configId: 184,
      providerCode: 'DeepSeek',
      model: 'deepseek-v4-flash',
      sourceTable: 'sense_data.TB_email_XQ',
      targetTable: 'sense_data.TB_INDICATOR_DATA',
      inputFields: 'date:date',
      outputFields: 'ok:ok',
      systemPrompt: '只返回 Python',
    }, { signal: externalController.signal })

    await vi.waitFor(() => expect(requestSignal).toBeDefined())
    externalController.abort()
    await vi.waitFor(() => expect(requestSignal?.aborted).toBe(true))

    await expect(pending).rejects.toBeDefined()
  })

  it('orchestrationGenerate：xml 格式仍走旧 stream，解析 MinIO 路径', async () => {
    const streamText = [
      'def main(date, zb_value):',
      '    return {"end_date": date}',
      '# [系统消息] 当前文件已经保存至MinIO：/code01/20260801/abc.py',
    ].join('\n')
    const encoder = new TextEncoder()
    const chunks = [encoder.encode(streamText.slice(0, 20)), encoder.encode(streamText.slice(20))]
    let i = 0
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }),
        }),
      },
    } as unknown as Response)
    // 打开 live 逃逸：vitest 默认 DISABLE_LIVE_ENDPOINTS=1，本用例要测真实 HTTP 路径
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    const { ruleApi } = await import('./index')

    const result = await ruleApi.orchestrationGenerate({
      ...sampleCfg,
      mode: 'ref',
      ruleId: '173',
      format: 'xml',
      describe: '按字段生成',
      systemPrompt: '只返回 JSON',
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/vrule/ai/dashscope/stream')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(String(init.body)).toContain('ruleId=173')
    expect(String(init.body)).toContain('query=')
    expect(String(init.body)).toContain('userPrompt=')
    expect(result.script).toContain('def main(date, zb_value)')
    expect(result.scriptPath).toBe('/code01/20260801/abc.py')
  })

  it('orchestrationGenerate：mock 的 orch-* ruleId 不打真实 stream（会 400），回退 mock', async () => {
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    const { ruleApi } = await import('./index')

    const result = await ruleApi.orchestrationGenerate({
      ...sampleCfg,
      mode: 'ref',
      ruleId: 'orch-999',
      describe: '按字段生成',
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.script).toContain('def main(date, zb_value)')
  })

  it('orchestrationGenerate：hybrid 下真实 stream 失败时回退 mock 骨架', async () => {
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'mock')
    vi.resetModules()
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'ruleId 不存在',
    } as Response)
    const { ruleApi } = await import('./index')

    const result = await ruleApi.orchestrationGenerate({
      ...sampleCfg,
      mode: 'ref',
      ruleId: '173',
      describe: '按字段生成',
    })

    expect(fetchMock).toHaveBeenCalled()
    expect(result.script).toContain('def main(date, zb_value)')
  })

  it('orchestrationDetail：POST getComposeById?id=，映射 nlDescribe/codePath', async () => {
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    fetchMock.mockResolvedValue(jsonResponse({
      id: 173,
      ruleName: '邮箱附件',
      nlDescribe: '转换规则',
      codePath: '/code01/a.py',
      state: 1,
      targetTable: 'sense_data.TB_email_XQ',
      inputFields: 'date',
      outputFields: 'end_date',
    }))
    const { ruleApi } = await import('./index')

    const detail = await ruleApi.orchestrationDetail('173')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/vrule/api/custom-compose/getComposeById?id=173')
    expect(init.method).toBe('POST')
    expect(detail.ruleId).toBe('173')
    expect(detail.describe).toBe('转换规则')
    expect(detail.scriptPath).toBe('/code01/a.py')
  })

  it('orchestrationPaged：POST list/compose，pageNum/pageSize + IPage.records 映射为 Paged<RuleOrchestrationItem>', async () => {
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    fetchMock.mockResolvedValue(jsonResponse({
      total: 1,
      records: [{
        id: 173, ruleName: '邮箱附件转换指标数据规则', nlDescribe: '转换规则',
        codePath: '/code01/a.py', state: 1, targetTable: 'sense_data.TB_email_XQ',
        inputFields: 'date,zb_value', outputFields: 'end_date',
      }],
    }))
    const { ruleApi } = await import('./index')

    const paged = await ruleApi.orchestrationPaged({ size: 50 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/vrule/ai/dashscope/list/compose')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toMatchObject({ pageNum: 1, pageSize: 50 })
    expect(paged.total).toBe(1)
    expect(paged.list[0]).toMatchObject({
      ruleId: '173', name: '邮箱附件转换指标数据规则', describe: '转换规则',
      scriptPath: '/code01/a.py', enabled: true, inputFields: ['date', 'zb_value'], outputFields: ['end_date'],
    })
  })

  // REVIEW-2026-08-04 P1：补 orchestrationPaged 的错误路径——之前只测了 happy path
  it('orchestrationPaged：业务错误码（code 非 "0"）→ throw json.msg', async () => {
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    fetchMock.mockResolvedValue(jsonResponse({ code: -1, msg: '规则列表查询失败' }))
    const { ruleApi } = await import('./index')

    await expect(ruleApi.orchestrationPaged({ size: 50 })).rejects.toThrow('规则列表查询失败')
  })

  it('orchestrationPaged：session expired 重定向 → throw 登录失效', async () => {
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    fetchMock.mockResolvedValue({
      ok: false, status: 302, redirected: true, url: '/apiapi/logout.htm',
      json: async () => ({}),
    } as unknown as Response)
    const { ruleApi } = await import('./index')

    await expect(ruleApi.orchestrationPaged({ size: 50 })).rejects.toThrow('登录失效')
  })

  it('orchestrationPaged：records 为空/缺失时兜底为空列表', async () => {
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    fetchMock.mockResolvedValue(jsonResponse({ total: 0 })) // 无 records 字段
    const { ruleApi } = await import('./index')

    const paged = await ruleApi.orchestrationPaged({ size: 50 })

    expect(paged.total).toBe(0)
    expect(paged.list).toEqual([])
  })

  it('orchestrationPaged：inputFields/outputFields 为 null 时按空数组兜底（splitCsv null 分支）', async () => {
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    fetchMock.mockResolvedValue(jsonResponse({
      total: 1,
      records: [{ id: 173, ruleName: '示例规则', targetTable: 'sense_data.TB_X', inputFields: null, outputFields: null }],
    }))
    const { ruleApi } = await import('./index')

    const paged = await ruleApi.orchestrationPaged({ size: 50 })

    expect(paged.list[0].inputFields).toEqual([])
    expect(paged.list[0].outputFields).toEqual([])
  })

  // 已知行为（不是本次修的范围，先锁定）：真实响应目前是不带 code 字段的裸 IPage（见上面 happy path）。
  // client.ts 的 normalizeHttpPayload 假定的信封是 {code, data}——如果这个端点哪天改成带 code 包一层，
  // 但 total/records 仍平铺在顶层（不嵌进 data），会被当成"没 data"直接吞成 { ok: true }，
  // total/records 静默丢失、变成空列表，且不报错。这里锁定这个已知坑，以后改 normalizeHttpPayload
  // 或后端响应格式时，这条测试会先炸，提醒去看这个交互。
  it('orchestrationPaged：响应意外带 code:"0" 但 total/records 仍平铺顶层——会被信封解析吞成空列表（已知坑）', async () => {
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    fetchMock.mockResolvedValue(jsonResponse({
      code: '0', total: 1,
      records: [{ id: 173, ruleName: '示例规则', targetTable: 'sense_data.TB_X' }],
    }))
    const { ruleApi } = await import('./index')

    const paged = await ruleApi.orchestrationPaged({ size: 50 })

    expect(paged.total).toBe(0)
    expect(paged.list).toEqual([])
  })

  it('orchestrationLoadScript：GET dashscope/code 读纯文本', async () => {
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'def main(date):\n    return {}',
    } as Response)
    const { ruleApi } = await import('./index')

    const script = await ruleApi.orchestrationLoadScript('/code01/a.py')

    expect(fetchMock.mock.calls[0][0]).toBe('/vrule/ai/dashscope/code?file_name=%2Fcode01%2Fa.py')
    expect(script).toContain('def main(date)')
  })

  it('fileDownloadScript：GET /api/file/download 按 fileId 读取纯文本', async () => {
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.resetModules()
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'def main():\n    return {"ok": True}',
    } as Response)
    const { ruleApi } = await import('./index')

    const script = await ruleApi.fileDownloadScript('/code01/202609/1788761803128.py')

    expect(fetchMock.mock.calls[0][0]).toBe('/api/file/download?fileId=%2Fcode01%2F202609%2F1788761803128.py')
    expect(script).toContain('def main()')
  })

})
