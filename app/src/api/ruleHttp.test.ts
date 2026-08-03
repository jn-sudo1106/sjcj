// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response
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
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          records: [{ id: 180, ruleName: sampleCfg.name, targetTable: sampleCfg.inputTable }],
        }),
      } as Response)
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

  it('orchestrationSave：POST /vrule/ai/dashscope/script/edit，codeFileName/scriptCode', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: null }))
    const { ruleApi } = await import('./index')

    const result = await ruleApi.orchestrationSave({
      ...sampleCfg,
      mode: 'ref',
      ruleId: '173',
      scriptPath: '/code01/x.py',
      script: 'def main(date):\n    return {}',
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/vrule/ai/dashscope/script/edit')
    expect(JSON.parse(String(init.body))).toEqual({
      ruleId: '173',
      codeFileName: '/code01/x.py',
      scriptCode: 'def main(date):\n    return {}',
    })
    expect(result).toMatchObject({ ruleId: '173', scriptPath: '/code01/x.py' })
  })

  it('orchestrationGenerate：数字 ruleId + live 时 POST form 流式，解析 MinIO 路径', async () => {
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
})
