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

afterEach(() => vi.restoreAllMocks())

describe('提示词表读取', () => {
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
