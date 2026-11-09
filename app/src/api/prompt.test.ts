// @vitest-environment jsdom
// 提示词表读取（cfg_llm_node_prompt）。2026-09-17 实测：表里「翻译」那一行的 category 是 NULL，
// 而这里曾经要求 category 非空 → 整行被丢掉、模板永远取不到（页面表现为"提示词没配"）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPromptList } from './prompt'

function mockFetch(payload: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(payload), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }))
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('提示词表读取', () => {
  it('本地流程模板从同一管理接口读取，过滤停用并优先默认版本', async () => {
    vi.stubEnv('VITE_FLOW_PROXY_TARGET', 'http://127.0.0.1:8090')
    const spy = mockFetch([
      { promptId: 1, isActive: 0, isDefault: 1, version: 9 },
      { promptId: 2, isActive: 1, isDefault: 0, version: 8 },
      { promptId: 3, isActive: 1, isDefault: 1, version: 1 },
    ])
    expect((await fetchPromptList('collect', '网页抓取')).map(row => row.promptId)).toEqual([3, 2])
    // 2026-11-05 合并后：流程侧模板改走 runner-management 的 node-prompt-templates（原 /api/local-flow/v1/flow/node-prompts）
    expect(String(spy.mock.calls[0][0])).toContain('/api/runner-management/node-prompt-templates')
    expect(String(spy.mock.calls[0][0])).toContain('templateUse=config')
  })
  it('category 为 NULL 的行也要保留（翻译那一行就是这样）', async () => {
    mockFetch([{
      promptId: 4, nodeType: 'article_translate', nodeTypeName: '翻译',
      category: null, systemPrompt: '你是一名专业翻译引擎', isActive: 1,
    }])
    const list = await fetchPromptList('', '翻译')
    expect(list).toHaveLength(1)
    expect(list[0].systemPrompt).toBe('你是一名专业翻译引擎')
    expect(list[0].category).toBe('')
  })

  it('缺 systemPrompt 或 nodeTypeName 的行仍然丢掉', async () => {
    mockFetch([
      { promptId: 1, nodeTypeName: '翻译', category: null, systemPrompt: '   ' },
      { promptId: 2, nodeType: '', nodeTypeName: '', category: 'rule', systemPrompt: 'x' },
    ])
    expect(await fetchPromptList('rule', '翻译')).toEqual([])
  })

  it('category 为空时不带 category 参数（后端 eq 匹配不上 NULL）', async () => {
    const spy = mockFetch([])
    await fetchPromptList('', '翻译')
    const url = String(spy.mock.calls[0][0])
    expect(url).toContain('node_type_name=%E7%BF%BB%E8%AF%91')
    expect(url).not.toContain('category=')
  })

  it('category 非空时照常带上', async () => {
    const spy = mockFetch([])
    await fetchPromptList('rule', '翻译')
    expect(String(spy.mock.calls[0][0])).toContain('category=rule')
  })
})
