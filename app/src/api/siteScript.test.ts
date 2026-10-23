// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateSiteScript } from './siteScript'

afterEach(() => vi.restoreAllMocks())

describe('generateSiteScript', () => {
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
