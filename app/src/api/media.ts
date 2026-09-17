// 视频提取音频（视频提取音频节点，2026-09-17 接入）。
//
// 契约来自后端项目 vanv-data-engine `com.vanv.dataengine.media.MediaController`（逐字核对过）：
//
//   请求  POST /api/media/extract-audio   multipart/form-data
//         · `file`    必填，视频（后端按**文件名后缀**校验，见 MEDIA_VIDEO_EXTENSIONS）
//         · `request` 可选，JSON 部分：
//             {format?: 'mp3'|'wav'|'m4a'|'aac'|'flac'|'ogg'  // 默认 mp3
//              bitRate?: 8000..320000   // 仅对有损格式生效
//              samplingRate?: 8000..48000
//              channels?: 1|2
//              upload?: boolean}        // true 时改为上传外部文件服务
//
//   响应  **两种形态**（同一个方法按 upload 分叉，后端不声明 produces）：
//         · upload 不是 true → **音频二进制流**：Content-Type 按格式（audio/mpeg 等），
//           Content-Disposition: attachment; filename="原文件名.mp3"（RFC 5987 带 UTF-8 filename*）
//         · upload = true    → JSON {fileId, filename, format, size, duration}
//   错误  400（参数/后缀非法）、413（超 200MB 或容器层超限）、422（视频没有音轨）、
//         504（转码超时，默认 5 分钟）、500（转码失败），体是 `{"error":"..."}`
//
// 服务与 data-process / prompt / speech 同在 8080，开发环境靠 Vite 代理收进同源
//（见 vite.config.ts 的 /api/media），目标用 VITE_DATA_PROCESS_PROXY_TARGET 切换。
const MEDIA_API_URL = '/api/media/extract-audio'

/** 后端接受的输入容器（VIDEO_EXTENSIONS 同款）——用于上传前的本地拦截。 */
export const MEDIA_VIDEO_EXTENSIONS = [
  'mp4', 'mov', 'm4v', 'avi', 'mkv', 'flv', 'wmv', 'webm', 'mpeg', 'mpg', 'ts', '3gp',
] as const

/** 输出音频格式（AudioFormat 同款）；不是所有格式都支持码率（wav/flac 无损，后端会忽略）。 */
export const MEDIA_AUDIO_FORMATS: { value: string; label: string; lossy: boolean }[] = [
  { value: 'mp3', label: 'MP3', lossy: true },
  { value: 'wav', label: 'WAV（无损）', lossy: false },
  { value: 'm4a', label: 'M4A', lossy: true },
  { value: 'aac', label: 'AAC', lossy: true },
  { value: 'flac', label: 'FLAC（无损）', lossy: false },
  { value: 'ogg', label: 'OGG', lossy: true },
]

/** 码率候选（后端区间 8000..320000）；不选 = 不下发，交给 ffmpeg 默认 */
export const MEDIA_BIT_RATE_OPTIONS: { value: number; label: string }[] = [
  { value: 64000, label: '64 kbps' },
  { value: 128000, label: '128 kbps' },
  { value: 192000, label: '192 kbps' },
  { value: 320000, label: '320 kbps' },
]

/** 采样率候选（后端区间 8000..48000） */
export const MEDIA_SAMPLING_RATE_OPTIONS: { value: number; label: string }[] = [
  { value: 8000, label: '8 kHz' },
  { value: 16000, label: '16 kHz' },
  { value: 22050, label: '22.05 kHz' },
  { value: 44100, label: '44.1 kHz' },
  { value: 48000, label: '48 kHz' },
]

export const MEDIA_CHANNEL_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: '单声道' },
  { value: 2, label: '双声道' },
]

/**
 * 上传体积上限（后端 media.extract.max-file-size 默认值 200MB；容器还有一层 spring 的上限）。
 * 这是**默认值**，现场调过配置的话后端仍会给出更准的 413 文案——本地这道只为少跑一趟。
 */
export const MEDIA_MAX_FILE_SIZE = 200 * 1024 * 1024

/** 前端等待上限：后端转码超时默认 5 分钟（media.extract.timeout），我们比它再宽一点。 */
export const MEDIA_EXTRACT_TIMEOUT_MS = 330_000

export interface MediaExtractionParams {
  /** 输出格式，默认 mp3 */
  format?: string
  /** 输出码率（bps，8000..320000），仅对有损格式生效 */
  bitRate?: number
  /** 输出采样率（Hz，8000..48000） */
  samplingRate?: number
  /** 声道数 1 / 2 */
  channels?: number
  /** true 时不上传二进制流，改为落到外部文件服务并返回 fileId */
  upload?: boolean
}

/** 音频二进制流（upload 未开）或文件服务回执（upload=true）——按响应形态二选一。 */
export interface ExtractedAudioFile {
  kind: 'file'
  blob: Blob
  /** 输出文件名：取响应头 Content-Disposition，拿不到就按源文件名换扩展名 */
  filename: string
  /** 音频字节数 */
  size: number
  contentType: string
  format: string
}

export interface ExtractedAudioUpload {
  kind: 'upload'
  /** 外部文件服务里的文件 id，可直接用于下载或后续处理 */
  fileId: string
  filename: string
  format: string
  size: number
  /** 源媒体时长（秒） */
  duration: number
}

export type MediaExtractionResult = ExtractedAudioFile | ExtractedAudioUpload

/** 后端只接受这些后缀（按文件名判，大小写不敏感），本地先拦一道。 */
export function isSupportedVideoFile(file: File): boolean {
  const name = file.name || ''
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
  return (MEDIA_VIDEO_EXTENSIONS as readonly string[]).includes(ext)
}

/** 源文件名换目标扩展名（后端 outputFilename 同款逻辑，仅在缺响应头时兜底）。 */
export function outputFilenameFor(sourceName: string, format: string): string {
  const dot = sourceName.lastIndexOf('.')
  const base = dot > 0 ? sourceName.slice(0, dot) : sourceName
  return `${base || 'audio'}.${format}`
}

/**
 * 从 Content-Disposition 取文件名。后端用 `ContentDisposition.attachment().filename(name, UTF_8)`：
 * 非 ASCII 名会给 `filename*=UTF-8''...`（RFC 5987）**外加**一个 MIME 编码的 `filename="=?UTF-8?Q?…?="`
 *（实测 2026-09-17：`filename="=?UTF-8?Q?sample-with-audio.mp3?="; filename*=UTF-8''sample-with-audio.mp3`）。
 * 我们优先取 `filename*`；取不到又只认得 MIME 编码那种写法时**宁可返回空**——
 * 让调用方退回「源文件名换扩展名」，总比把 `=?UTF-8?Q?…?=` 当文件名存下来强。
 */
export function filenameFromContentDisposition(header: string | null): string {
  if (!header) return ''
  const star = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim())
    } catch {
      return star[1].trim()
    }
  }
  const plain = header.match(/filename\s*=\s*"?([^";]+)"?/i)
  const name = plain?.[1]?.trim() ?? ''
  // `=?UTF-8?Q?...?=` 是 RFC 2047 编码字，不是可直接用的文件名
  return name.includes('=?') ? '' : name
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

/**
 * 读视频时长（秒）：用 `<video preload="metadata">` 让浏览器解析容器头，不加载整段视频。
 * 拿不到返回 `null`（不阻塞流程——时长只用于展示与「大概要等多久」的提示）。
 */
export function readVideoDuration(file: File, timeoutMs = 3000): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
      resolve(null)
      return
    }
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    let done = false
    const finish = (value: number | null) => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      video.removeAttribute('src')
      URL.revokeObjectURL(url)
      resolve(value)
    }
    const timer = window.setTimeout(() => finish(null), timeoutMs)
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const seconds = video.duration
      finish(Number.isFinite(seconds) && seconds > 0 ? seconds : null)
    }
    video.onerror = () => finish(null)
    video.src = url
  })
}

/**
 * 调后端从视频里抽音轨。失败（网络 / 超时 / 非 2xx）向上抛，
 * 错误信息优先用后端 `{"error": "..."}` 里的原文。
 */
export async function extractAudio(
  file: File,
  params: MediaExtractionParams = {},
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<MediaExtractionResult> {
  if (!file) throw new Error('缺少视频文件')
  const format = (params.format || 'mp3').trim()
  const request: Record<string, unknown> = {}
  if (format) request.format = format
  if (params.bitRate) request.bitRate = params.bitRate
  if (params.samplingRate) request.samplingRate = params.samplingRate
  if (params.channels) request.channels = params.channels
  if (params.upload) request.upload = true

  const form = new FormData()
  form.append('file', file)
  // `request` 是 JSON 部分：必须带 application/json，否则 Spring 的 @RequestPart 绑不上对象
  form.append('request', new Blob([JSON.stringify(request)], { type: 'application/json' }))

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), options.timeoutMs ?? MEDIA_EXTRACT_TIMEOUT_MS)
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true })
  try {
    // 不要手写 Content-Type：multipart 的 boundary 由浏览器生成
    const res = await fetch(MEDIA_API_URL, { method: 'POST', body: form, signal: controller.signal })
    if (!res.ok) {
      // 失败一般是 JSON（MediaExceptionHandler 的 {"error": "..."}），二进制分支只在成功时出现。
      // ⚠️ 但「上传到文件服务」那条路失败时是 **Spring 默认错误体**（{"status":500,"error":"Internal Server Error",…}，
      // 2026-09-17 实测：外部文件服务不可达时 FileProxyClient 的异常没被 media 的 advice 接住），
      // 那种 error 字段是 HTTP 状态短语、不是给人看的，这时退回带状态码的通用文案。
      const payload = await res.json().catch(() => null)
      const raw = String(asRecord(payload).error ?? '').trim()
      // 413 有两个来源：后端自己的（JSON + 中文说明，见上面）与**网关的**。
      // 网关那份是 Nginx 默认 1MB 上限回的错误页（HTML，解析不出 error），
      // 不给出可操作提示的话用户只看到一句 413 无从下手（2026-09-17 部署后实测踩到）。
      if (res.status === 413 && !raw) {
        throw new Error('上传被网关拒绝（HTTP 413）：请求体超过服务器上传上限，'
          + '请确认 Nginx 的 client_max_body_size 已放宽（本接口后端允许 200MB）')
      }
      const message = raw && raw !== res.statusText ? raw : `视频提取音频服务返回 HTTP ${res.status}`
      throw new Error(message)
    }
    const contentType = res.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const record = asRecord(await res.json())
      const fileId = String(record.fileId ?? '').trim()
      if (!fileId) throw new Error('后端未返回 fileId（upload=true 时应当返回）')
      return {
        kind: 'upload',
        fileId,
        filename: String(record.filename ?? ''),
        format: String(record.format ?? format),
        size: Number(record.size ?? 0),
        duration: Number(record.duration ?? 0),
      }
    }
    const blob = await res.blob()
    if (!blob.size) throw new Error('后端返回了空音频（视频可能没有音轨）')
    return {
      kind: 'file',
      blob,
      filename: filenameFromContentDisposition(res.headers.get('content-disposition'))
        || outputFilenameFor(file.name, format),
      size: blob.size,
      contentType: contentType || blob.type,
      format,
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new Error('视频提取音频超时或已取消')
    throw e
  } finally {
    window.clearTimeout(timer)
  }
}
