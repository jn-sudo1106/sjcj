// @vitest-environment jsdom
// 翻译接口（2026-09-18 接入，2026-09-21 起多引擎）：契约按后端 vanv-data-engine 的
// TranslateController / TranslateRouter / 三个引擎客户端锁定——
// POST /api/translate，body {"from":"zh","to":"en","query":"...","engine":"baidu"}，返回 {from,to,translatedText}。
// 关键是**语言码是百度的**（日语 jp、韩语 kor、法语 fra、繁体 cht），不是 ISO 639-1，方言映射在后端。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TRANSLATE_ENGINE_CODES, TRANSLATE_LANGUAGE_CODES, TRANSLATE_MAX_QUERY_BYTES, engineCodeOf, engineLabelOf, languageCodeOf, translateSampleOf, translateText, utf8ByteLength } from './translate'

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

describe('翻译接口调用', () => {
  it('POST /api/translate，中文简体→英语 发 from=zh to=en engine=baidu（用户给的口径）', async () => {
    const fetchSpy = mockFetch(() => json({ from: 'zh', to: 'en', translatedText: 'Hello, world' }))
    const result = await translateText({ from: '中文简体', to: '英语', query: '你好，世界' })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/translate')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ from: 'zh', to: 'en', query: '你好，世界', engine: 'baidu' })
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(result).toEqual({ from: 'zh', to: 'en', translatedText: 'Hello, world' })
  })

  it('引擎码表与回落：三家的码是 google/youdao/baidu，认不出回落百度', () => {
    expect(TRANSLATE_ENGINE_CODES).toEqual({ '谷歌翻译': 'google', '有道翻译': 'youdao', '百度翻译': 'baidu' })
    expect(engineCodeOf('谷歌翻译')).toBe('google')
    expect(engineCodeOf('有道翻译')).toBe('youdao')
    expect(engineCodeOf('')).toBe('baidu')
    expect(engineCodeOf('不认识的引擎')).toBe('baidu')
    // 已经是引擎码的输入原样返回（core_param 里 engine 存英文码，保存归一化要认得出）
    expect(engineCodeOf('google')).toBe('google')
    expect(engineCodeOf('youdao')).toBe('youdao')
    expect(engineCodeOf('baidu')).toBe('baidu')
    expect(engineLabelOf('google')).toBe('谷歌翻译')
    expect(engineLabelOf('youdao')).toBe('有道翻译')
    expect(engineLabelOf('bing')).toBe('百度翻译')
    // 短暂落过库的界面值也能回填成界面名
    expect(engineLabelOf('谷歌翻译')).toBe('谷歌翻译')
    expect(engineLabelOf('有道翻译')).toBe('有道翻译')
    expect(engineLabelOf('百度翻译')).toBe('百度翻译')
  })

  it('指定有道翻译时 body 带 engine=youdao', async () => {
    const fetchSpy = mockFetch(() => json({ from: 'zh', to: 'en', translatedText: 'Hello' }))
    await translateText({ from: '中文简体', to: '英语', engine: '有道翻译', query: '你好' })
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)).engine).toBe('youdao')
  })

  it('测试样例：按语言取一句，自动检测与不认识的都回落中文样例', () => {
    expect(translateSampleOf('中文简体')).toContain('测试翻译引擎')
    expect(translateSampleOf('英语')).toBe('Hello, world! This is a sample text for testing the translation engine.')
    expect(translateSampleOf('自动检测')).toBe(translateSampleOf('中文简体'))
    expect(translateSampleOf('')).toBe(translateSampleOf('中文简体'))
  })

  it('9 种语言的码都是百度那一套（jp/kor/fra/spa/cht，不是 ja/ko/fr/es）', () => {
    expect(TRANSLATE_LANGUAGE_CODES).toEqual({
      '中文简体': 'zh', '中文繁体': 'cht', '英语': 'en', '日语': 'jp', '韩语': 'kor',
      '法语': 'fra', '德语': 'de', '西班牙语': 'spa', '俄语': 'ru',
    })
    expect(languageCodeOf('日语')).toBe('jp')
    expect(languageCodeOf('韩语')).toBe('kor')
  })

  it('「自动检测」与认不出的语言都发 auto', () => {
    expect(languageCodeOf('自动检测')).toBe('auto')
    expect(languageCodeOf('')).toBe('auto')
    expect(languageCodeOf('克林贡语')).toBe('auto')
  })

  it('原文首尾空白会被去掉再发', async () => {
    const fetchSpy = mockFetch(() => json({ from: 'zh', to: 'en', translatedText: 'ok' }))
    await translateText({ from: '中文简体', to: '英语', query: '  你好  ' })
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)).query).toBe('你好')
  })

  // 2026-09-18 后端换成开放平台后，上限从「5000 字符」变成「6000 **字节**（UTF-8）」。
  // 中文 1 字 3 字节，按字符数判断会低估 3 倍、放过去被后端 400，所以必须按字节算。
  it('超过单次上限（6000 字节）本地就拦，不发请求——按 UTF-8 字节算，不是字符数', async () => {
    const fetchSpy = mockFetch(() => json({ from: 'zh', to: 'en', translatedText: 'ok' }))
    // 2001 个汉字 = 6003 字节 > 6000，但字符数只有 2001（远小于 6000，只看字符会漏判）
    const query = '中'.repeat(2001)
    expect(query.length).toBeLessThan(TRANSLATE_MAX_QUERY_BYTES)
    await expect(translateText({ from: '中文简体', to: '英语', query })).rejects.toThrow('单次最多 6000 字节')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('刚好 6000 字节（2000 个汉字）放行', async () => {
    const fetchSpy = mockFetch(() => json({ from: 'zh', to: 'en', translatedText: 'ok' }))
    await translateText({ from: '中文简体', to: '英语', query: '中'.repeat(2000) })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('utf8ByteLength 与后端 getBytes(UTF_8).length 同口径', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    expect(utf8ByteLength('中文')).toBe(6)
    expect(utf8ByteLength('')).toBe(0)
  })

  it('目标语言不允许自动检测（后端会 400），本地先给中文提示', async () => {
    const fetchSpy = mockFetch(() => json({ from: 'zh', to: 'en', translatedText: 'ok' }))
    await expect(translateText({ from: '中文简体', to: '自动检测', query: '你好' }))
      .rejects.toThrow('目标语言不支持自动检测')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('空内容直接拒绝，不发请求', async () => {
    const fetchSpy = mockFetch(() => json({}))
    await expect(translateText({ from: '中文简体', to: '英语', query: '   ' })).rejects.toThrow('缺少待翻译内容')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('后端错误体里的 error 原样透出（400 参数 / 502 凭据未配置）', async () => {
    mockFetch(() => json({ error: 'query is 7000 bytes, exceeding the limit of 6000 bytes' }, 400))
    await expect(translateText({ from: '中文简体', to: '英语', query: '你好' })).rejects.toThrow('exceeding the limit of 6000 bytes')

    // 开放平台鉴权问题（appid/密钥/IP 白名单）后端都翻成人话再回
    mockFetch(() => json({ error: '百度翻译返回错误码 54001（签名错误，请检查 translate.baidu.app-id 与 secret-key 是否匹配）' }, 502))
    await expect(translateText({ from: '中文简体', to: '英语', query: '你好' })).rejects.toThrow('签名错误')
  })

  it('429 且没有 error 文案时给一句可操作的提示', async () => {
    mockFetch(() => new Response('', { status: 429 }))
    await expect(translateText({ from: '中文简体', to: '英语', query: '你好' })).rejects.toThrow('翻译请求过于频繁')
  })

  it('返回空译文时给可读提示，不静默成功', async () => {
    mockFetch(() => json({ from: 'zh', to: 'en', translatedText: '  ' }))
    await expect(translateText({ from: '中文简体', to: '英语', query: '你好' })).rejects.toThrow('没有返回译文')
  })
})
