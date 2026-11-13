// @vitest-environment jsdom
// 视频提取音频调用（2026-09-17）：契约按后端 vanv-data-engine 的 MediaController 锁定——
// multipart `file` + 可选 JSON 部分 `request`；**成功响应有两种形态**：
//   upload 未开 → 音频二进制流 + Content-Disposition；upload=true → JSON {fileId, filename, format, size, duration}
// 失败是 `{"error": "..."}`（400/413/422/504），但**文件服务失败那条路是 Spring 默认错误体**（实测）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MEDIA_VIDEO_EXTENSIONS,
  extractAudio,
  filenameFromContentDisposition,
  isSupportedVideoFile,
  outputFilenameFor,
} from './media'

function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
    return impl(url, init)
  })
}

function videoFile(name = 'meeting.mp4'): File {
  return new File(['fake-video-bytes'], name, { type: 'video/mp4' })
}

function audioStream(filename = 'meeting.mp3'): Response {
  // 真实响应头只能放 ASCII：非 ASCII 名走后端给的 RFC 5987 写法（filename* 里百分号编码），
  // 前面那个 filename= 是 Spring 的 MIME 编码字（`=?UTF-8?Q?...?=`），两种都照原样复刻。
  return new Response(new Uint8Array([1, 2, 3, 4, 5]), {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': `attachment; filename="=?UTF-8?Q?sample.mp3?="; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}

afterEach(() => vi.restoreAllMocks())

describe('视频提取音频调用', () => {
  it('POST /api/media/extract-audio，multipart 带 file 与 JSON 的 request 部分', async () => {
    const fetchSpy = mockFetch(() => audioStream())
    await extractAudio(videoFile(), { format: 'mp3', bitRate: 128000, samplingRate: 44100, channels: 2 })

    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/media/extract-audio')
    expect(init?.method).toBe('POST')
    const form = init?.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect((form.get('file') as File).name).toBe('meeting.mp4')
    const requestPart = form.get('request') as Blob
    expect(requestPart.type).toBe('application/json')
    await expect(requestPart.text()).resolves.toBe('{"format":"mp3","bitRate":128000,"samplingRate":44100,"channels":2}')
    // 不能手写 Content-Type：multipart 的 boundary 由浏览器生成
    expect((init?.headers as Record<string, string> | undefined)?.['Content-Type']).toBeUndefined()
  })

  it('二进制分支：返回 blob + 从 Content-Disposition 取的文件名（优先 filename*）', async () => {
    mockFetch(() => audioStream('会议录音.mp3'))
    const result = await extractAudio(videoFile())
    expect(result.kind).toBe('file')
    if (result.kind !== 'file') return
    expect(result.filename).toBe('会议录音.mp3')
    expect(result.contentType).toContain('audio/mpeg')
    expect(result.size).toBe(5)
    expect(result.format).toBe('mp3')
  })

  it('上传分支（upload=true）：解析 fileId 等 JSON 回执', async () => {
    mockFetch(() => new Response(JSON.stringify({
      fileId: '/media01/202609/abcdef.mp3', filename: 'meeting.mp3', format: 'mp3', size: 16629, duration: 12.3,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const result = await extractAudio(videoFile(), { upload: true })
    expect(result).toMatchObject({
      kind: 'upload',
      fileId: '/media01/202609/abcdef.mp3',
      filename: 'meeting.mp3',
      format: 'mp3',
      size: 16629,
      duration: 12.3,
    })
  })

  it('不带参数的调用只下发 format（其余交给后端默认）', async () => {
    const fetchSpy = mockFetch(() => audioStream())
    await extractAudio(videoFile(), { format: 'wav' })
    const request = fetchSpy.mock.calls[0][1]?.body as FormData
    await expect((request.get('request') as Blob).text()).resolves.toBe('{"format":"wav"}')
  })

  it('无音轨 422 透出后端原文', async () => {
    mockFetch(() => new Response(JSON.stringify({ error: '视频不包含音频轨道，无法提取音频' }), {
      status: 422, headers: { 'Content-Type': 'application/json' },
    }))
    await expect(extractAudio(videoFile())).rejects.toThrow('视频不包含音频轨道')
  })

  it('格式非法 400 透出后端支持的格式清单 / 超时 504 同理', async () => {
    mockFetch(() => new Response(JSON.stringify({ error: 'unsupported format: xyz, supported: mp3, wav' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    }))
    await expect(extractAudio(videoFile(), { format: 'xyz' })).rejects.toThrow('unsupported format: xyz')

    mockFetch(() => new Response(JSON.stringify({ error: '视频提取音频超时（PT5M），已中断' }), {
      status: 504, headers: { 'Content-Type': 'application/json' },
    }))
    await expect(extractAudio(videoFile())).rejects.toThrow('视频提取音频超时')
  })

  // 2026-09-17 实测：upload=true 且外部文件服务不可达时，后端返回的是 Spring 默认错误体
  // （error 字段是 "Internal Server Error"），不是模块自己的 {"error": "..."}。
  it('文件服务失败（Spring 默认错误体）不把状态短语当文案，退回带状态码的提示', async () => {
    mockFetch(() => new Response(JSON.stringify({
      timestamp: '2026-09-17T07:54:28.784+00:00', status: 500, error: 'Internal Server Error', path: '/api/media/extract-audio',
    }), { status: 500, statusText: 'Internal Server Error', headers: { 'Content-Type': 'application/json' } }))

    await expect(extractAudio(videoFile(), { upload: true })).rejects.toThrow('视频提取音频服务返回 HTTP 500')
  })

  // 2026-09-17 部署实测：Nginx 默认 client_max_body_size 1MB，超限时由**网关**回 413（HTML 错误页），
  // 不是后端那份 JSON。要给出可操作的提示，不能只丢一句 413。
  it('网关 413（HTML 错误页）提示到 Nginx 配置上', async () => {
    mockFetch(() => new Response('<html><head><title>413 Request Entity Too Large</title></head></html>', {
      status: 413, headers: { 'Content-Type': 'text/html' },
    }))
    await expect(extractAudio(videoFile())).rejects.toThrow('client_max_body_size')
  })

  it('后端自己的 413（JSON 中文说明）仍然透出后端原文', async () => {
    mockFetch(() => new Response(JSON.stringify({ error: '视频大小 300MB 超过上限 200MB（media.extract.max-file-size）' }), {
      status: 413, headers: { 'Content-Type': 'application/json' },
    }))
    await expect(extractAudio(videoFile())).rejects.toThrow('超过上限 200MB')
  })

  it('返回空音频时给可读提示，不静默成功', async () => {
    mockFetch(() => new Response(new Uint8Array(0), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }))
    await expect(extractAudio(videoFile())).rejects.toThrow('空音频')
  })

  it('缺文件直接拒绝，不发请求', async () => {
    const fetchSpy = mockFetch(() => audioStream())
    await expect(extractAudio(undefined as unknown as File)).rejects.toThrow('缺少视频文件')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('本地视频后缀校验与后端 VIDEO_EXTENSIONS 一致（大小写不敏感）', () => {
    expect(isSupportedVideoFile(videoFile('a.MP4'))).toBe(true)
    expect(isSupportedVideoFile(videoFile('a.mkv'))).toBe(true)
    expect(isSupportedVideoFile(videoFile('a.mp3'))).toBe(false)
    expect(isSupportedVideoFile(videoFile('无后缀'))).toBe(false)
    expect([...MEDIA_VIDEO_EXTENSIONS]).toEqual([
      'mp4', 'mov', 'm4v', 'avi', 'mkv', 'flv', 'wmv', 'webm', 'mpeg', 'mpg', 'ts', '3gp',
    ])
  })

  it('文件名解析：优先 filename*；只有 MIME 编码字时返回空（交给调用方换扩展名兜底）', () => {
    expect(filenameFromContentDisposition(
      'attachment; filename="=?UTF-8?Q?sample.mp3?="; filename*=UTF-8\'\'sample.mp3',
    )).toBe('sample.mp3')
    expect(filenameFromContentDisposition('attachment; filename="=?UTF-8?Q?sample.mp3?="')).toBe('')
    expect(filenameFromContentDisposition('attachment; filename="plain.mp3"')).toBe('plain.mp3')
    expect(filenameFromContentDisposition(null)).toBe('')
  })

  it('源文件名换扩展名（后端 outputFilename 同款，仅兜底用）', () => {
    expect(outputFilenameFor('meeting.mp4', 'mp3')).toBe('meeting.mp3')
    expect(outputFilenameFor('无扩展名', 'wav')).toBe('无扩展名.wav')
    expect(outputFilenameFor('', 'mp3')).toBe('audio.mp3')
  })
})
