// @vitest-environment jsdom
// 语音转文字调用（2026-09-17）：契约按后端 vanv-data-engine 的 SpeechController 锁定——
// multipart `file`（必填）+ 可选 JSON 部分 `request`，响应 `{text, duration, traceId}`，
// 错误体是 `{"error": "..."}`（后端已把处置建议拼好，前端原样透出）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SPEECH_AUDIO_EXTENSIONS,
  SPEECH_LANGUAGE_OPTIONS,
  SPEECH_MAX_DURATION_SECONDS,
  isSupportedAudioFile,
  readAudioDuration,
  transcribeAudio,
} from './speech'

function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
    return impl(url, init)
  })
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function audioFile(name = 'meeting.mp3'): File {
  return new File(['fake-audio-bytes'], name, { type: 'audio/mpeg' })
}

afterEach(() => vi.restoreAllMocks())

describe('语音转文字调用', () => {
  it('POST /api/speech/transcriptions，multipart 带 file，语言拼成 JSON 的 request 部分', async () => {
    const fetchSpy = mockFetch(() => json({ text: '你好世界', duration: 12.3, traceId: 'trace-1' }))
    await transcribeAudio(audioFile(), { language: 'zh' })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/speech/transcriptions')
    expect(init?.method).toBe('POST')
    const form = init?.body as FormData
    expect(form).toBeInstanceOf(FormData)
    // file 部分就是原始文件（后端按文件名后缀判格式）
    const sent = form.get('file') as File
    expect(sent.name).toBe('meeting.mp3')
    expect(sent.size).toBe(audioFile().size)
    // request 部分必须是 application/json，否则 Spring 的 @RequestPart 绑不上对象
    const requestPart = form.get('request') as Blob
    expect(requestPart.type).toBe('application/json')
    await expect(requestPart.text()).resolves.toBe('{"language":"zh"}')
    // 不能手写 Content-Type：boundary 由浏览器生成
    expect((init?.headers as Record<string, string> | undefined)?.['Content-Type']).toBeUndefined()
  })

  it('没有参数时不带 request 部分（后端该部分是可选）', async () => {
    const fetchSpy = mockFetch(() => json({ text: 'ok', duration: 1, traceId: 't' }))
    await transcribeAudio(audioFile(), {})

    const form = fetchSpy.mock.calls[0][1]?.body as FormData
    expect(form.get('request')).toBeNull()
  })

  it('把 {text,duration,traceId} 归一返回，duration 缺失给 null', async () => {
    mockFetch(() => json({ text: ' 第一段。第二段。 ', traceId: 'trace-9' }))
    const result = await transcribeAudio(audioFile())
    expect(result.text).toBe(' 第一段。第二段。 ')
    expect(result.duration).toBeNull()
    expect(result.traceId).toBe('trace-9')
  })

  it('非 2xx 时透出后端 {"error": "..."} 的原文（413 超限 / 502 上游）', async () => {
    mockFetch(() => json({ error: '音频超过服务器上传上限（spring.servlet.multipart.max-file-size）' }, 413))
    await expect(transcribeAudio(audioFile())).rejects.toThrow('音频超过服务器上传上限')

    mockFetch(() => json({ error: 'cfg_llm_config 中没有启用的供应商 MiniMax，无法调用 MiniMax 语音识别' }, 502))
    await expect(transcribeAudio(audioFile())).rejects.toThrow('没有启用的供应商 MiniMax')
  })

  it('错误体不是 JSON 时退回 HTTP 状态码，不吞错', async () => {
    mockFetch(() => new Response('<html>502 Bad Gateway</html>', { status: 502 }))
    await expect(transcribeAudio(audioFile())).rejects.toThrow('语音转写服务返回 HTTP 502')
  })

  // 2026-09-17 部署实测：网关（Nginx 默认 1MB）超限时回的是 HTML 错误页，不是后端那份 JSON。
  it('网关 413（HTML 错误页）提示到 Nginx 配置上', async () => {
    mockFetch(() => new Response('<html><title>413 Request Entity Too Large</title></html>', {
      status: 413, headers: { 'Content-Type': 'text/html' },
    }))
    await expect(transcribeAudio(audioFile())).rejects.toThrow('client_max_body_size')
  })

  it('返回里没有文本时给出可读提示，不静默成功', async () => {
    mockFetch(() => json({ text: '', duration: 3, traceId: 't' }))
    await expect(transcribeAudio(audioFile())).rejects.toThrow('未识别到文字')
  })

  it('缺文件直接拒绝，不发请求', async () => {
    const fetchSpy = mockFetch(() => json({ text: 'x' }))
    await expect(transcribeAudio(undefined as unknown as File)).rejects.toThrow('缺少音频文件')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('本地格式校验与后端 SUPPORTED_EXTENSIONS 一致（大小写不敏感）', () => {
    expect(isSupportedAudioFile(audioFile('a.mp3'))).toBe(true)
    expect(isSupportedAudioFile(audioFile('录音.WAV'))).toBe(true)
    expect(isSupportedAudioFile(audioFile('a.txt'))).toBe(false)
    expect(isSupportedAudioFile(audioFile('无后缀'))).toBe(false)
    expect([...SPEECH_AUDIO_EXTENSIONS]).toEqual([
      'wav', 'aiff', 'aif', 'flac', 'm4a', 'alac', 'mp3', 'aac', 'opus', 'ogg',
    ])
  })

  it('语言候选与后端白名单一致（多/少一个都会 400）', () => {
    expect(SPEECH_LANGUAGE_OPTIONS.map((o) => o.value)).toEqual([
      'zh', 'yue', 'en', 'ja', 'ko', 'th', 'vi', 'id', 'ms', 'fil',
      'fr', 'de', 'es', 'it', 'pt', 'pl', 'ru', 'uk', 'ar', 'tr',
    ])
  })

  // 2026-09-17：MiniMax 单段 500 秒上限，上游会回
  // "MiniMax 返回 400：invalid params, audio duration 660.1s exceeds the limit of 500s"
  describe('读时长（本地拦 500 秒上限）', () => {
    /** 用假的 Audio 顶掉浏览器实现：想让它报多少时长就报多少 */
    function stubAudio(duration: number | 'error' | 'never') {
      class FakeAudio {
        preload = ''
        onloadedmetadata: (() => void) | null = null
        onerror: (() => void) | null = null
        src = ''
        get duration() { return duration === 'error' || duration === 'never' ? NaN : duration }
        removeAttribute() { /* noop */ }
        constructor() {
          if (duration === 'error') {
            window.setTimeout(() => this.onerror?.(), 0)
          } else if (duration !== 'never') {
            window.setTimeout(() => this.onloadedmetadata?.(), 0)
          }
        }
      }
      vi.stubGlobal('Audio', FakeAudio)
      vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} })
    }

    afterEach(() => vi.unstubAllGlobals())

    it('解析出时长就返回秒数（660.1 秒这种能被识别出来）', async () => {
      stubAudio(660.1)
      await expect(readAudioDuration(audioFile())).resolves.toBe(660.1)
    })

    it('解不出元数据（onerror）返回 null，不做本地拦截', async () => {
      stubAudio('error')
      await expect(readAudioDuration(audioFile())).resolves.toBeNull()
    })

    it('一直等不到元数据时超时返回 null，不卡住上传', async () => {
      stubAudio('never')
      await expect(readAudioDuration(audioFile(), 20)).resolves.toBeNull()
    })

    it('上限就是 MiniMax 的 500 秒', () => {
      expect(SPEECH_MAX_DURATION_SECONDS).toBe(500)
    })
  })
})
