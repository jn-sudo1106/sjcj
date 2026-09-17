// 语音转文字（音频提取文字节点，2026-09-17 接入）。
//
// 契约来自后端项目 vanv-data-engine `com.vanv.dataengine.speech.SpeechController`（逐字核对过）：
//
//   请求  POST /api/speech/transcriptions   multipart/form-data
//         · `file`    必填，音频文件（后端按**文件名后缀**校验格式，见 SPEECH_AUDIO_EXTENSIONS）
//         · `request` 可选，JSON 部分 `{"language":"zh","model":"asr-1.0","providerCode":"MiniMax"}`
//   响应  200 `{"text":"...","duration":12.3,"traceId":"..."}`
//   错误  400 / 413 / 502 `{"error":"..."}`——后端已经把 MiniMax 的原文与处置建议拼好了，
//         前端原样透出即可（413 = 音频超上限，502 = 供应商配置或上游调用有问题）。
//
// 这个服务与 data-process / prompt / model / ck_source 同在 8080（server.port 默认 8080），
// 开发环境靠 Vite 代理收进同源（见 vite.config.ts 的 /api/speech），目标用
// VITE_DATA_PROCESS_PROXY_TARGET 切换。
const SPEECH_API_URL = '/api/speech/transcriptions'

/** MiniMax 支持的音频后缀（后端 SUPPORTED_EXTENSIONS 同款）——用于上传前的本地拦截。 */
export const SPEECH_AUDIO_EXTENSIONS = [
  'wav', 'aiff', 'aif', 'flac', 'm4a', 'alac', 'mp3', 'aac', 'opus', 'ogg',
] as const

/** 后端与 MiniMax 的体积上限，本地先拦一道给出可读提示。 */
export const SPEECH_MAX_FILE_SIZE = 50 * 1024 * 1024

/**
 * MiniMax 单段音频的时长上限（秒）。
 *
 * 2026-09-17 实测踩到：660.1 秒（11 分钟）的音频被上游拒回
 * `MiniMax 返回 400：invalid params, audio duration 660.1s exceeds the limit of 500s (2013)`。
 * **后端不做时长校验**（只按后缀与体积拦），所以这条只能在前端先拦——读不出时长时不拦，
 * 交给上游报错（见 readAudioDuration 的返回值约定）。
 */
export const SPEECH_MAX_DURATION_SECONDS = 500

/**
 * 读音频时长（秒）：用 `<audio preload="metadata">` 让浏览器解析文件头，不加载整段音频。
 * 拿不到（浏览器解不了该格式 / 读元数据超时）返回 `null`——**不因为读不出时长就挡住上传**，
 * 那种情况退回到后端 + 上游的报错，比前端瞎猜一个值强。
 */
export function readAudioDuration(file: File, timeoutMs = 3000): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof Audio === 'undefined' || typeof URL.createObjectURL !== 'function') {
      resolve(null)
      return
    }
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    let done = false
    const finish = (value: number | null) => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      audio.removeAttribute('src')
      URL.revokeObjectURL(url)
      resolve(value)
    }
    const timer = window.setTimeout(() => finish(null), timeoutMs)
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      const seconds = audio.duration
      finish(Number.isFinite(seconds) && seconds > 0 ? seconds : null)
    }
    audio.onerror = () => finish(null)
    audio.src = url
  })
}

/**
 * 语言候选（后端 SUPPORTED_LANGUAGES 同款，BCP-47）。留空 = 自动识别。
 * 后端只认逗号分隔之外的**精确值**，多一个少一个都会 400，所以这份表不能自行增删。
 */
export const SPEECH_LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'zh', label: '中文 zh' },
  { value: 'yue', label: '粤语 yue' },
  { value: 'en', label: '英语 en' },
  { value: 'ja', label: '日语 ja' },
  { value: 'ko', label: '韩语 ko' },
  { value: 'th', label: '泰语 th' },
  { value: 'vi', label: '越南语 vi' },
  { value: 'id', label: '印尼语 id' },
  { value: 'ms', label: '马来语 ms' },
  { value: 'fil', label: '菲律宾语 fil' },
  { value: 'fr', label: '法语 fr' },
  { value: 'de', label: '德语 de' },
  { value: 'es', label: '西班牙语 es' },
  { value: 'it', label: '意大利语 it' },
  { value: 'pt', label: '葡萄牙语 pt' },
  { value: 'pl', label: '波兰语 pl' },
  { value: 'ru', label: '俄语 ru' },
  { value: 'uk', label: '乌克兰语 uk' },
  { value: 'ar', label: '阿拉伯语 ar' },
  { value: 'tr', label: '土耳其语 tr' },
]

export interface SpeechTranscriptionParams {
  /** 语言提示（BCP-47，取值见 SPEECH_LANGUAGE_OPTIONS），留空自动识别 */
  language?: string
  /** 识别模型，留空用后端配置的默认（asr-1.0） */
  model?: string
  /** 取哪一行供应商连接信息，留空用后端配置的默认（MiniMax） */
  providerCode?: string
}

export interface SpeechTranscriptionResult {
  text: string
  /** 音频时长（秒），上游没给就是 null */
  duration: number | null
  /** MiniMax 请求追踪号，排查问题时提供给对方 */
  traceId: string
}

/** 后端只接受这几个后缀（按文件名判），本地先拦一道，省一次往返。 */
export function isSupportedAudioFile(file: File): boolean {
  const name = file.name || ''
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
  return (SPEECH_AUDIO_EXTENSIONS as readonly string[]).includes(ext)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

/**
 * 调后端转写音频。失败（网络 / 超时 / 非 2xx / 没返回文本）向上抛，
 * 错误信息优先用后端 `{"error": "..."}` 里的原文。
 */
export async function transcribeAudio(
  file: File,
  params: SpeechTranscriptionParams = {},
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<SpeechTranscriptionResult> {
  if (!file) throw new Error('缺少音频文件')
  const form = new FormData()
  form.append('file', file)
  // `request` 是 JSON 部分：必须带 application/json，否则 Spring 的 @RequestPart 绑不上对象
  const body: SpeechTranscriptionParams = {}
  if (params.language?.trim()) body.language = params.language.trim()
  if (params.model?.trim()) body.model = params.model.trim()
  if (params.providerCode?.trim()) body.providerCode = params.providerCode.trim()
  if (Object.keys(body).length) {
    form.append('request', new Blob([JSON.stringify(body)], { type: 'application/json' }))
  }

  const controller = new AbortController()
  // 转写是同步长请求（后端读超时给到 3 分钟），前端超时略长于它，避免后端还在跑就先断开
  const timer = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 200_000)
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true })
  try {
    const res = await fetch(SPEECH_API_URL, { method: 'POST', body: form, signal: controller.signal })
    // 不要把 Content-Type 写死成 multipart/form-data：boundary 由浏览器生成，手写会丢掉 boundary
    const payload: unknown = await res.json().catch(() => null)
    const record = asRecord(payload)
    if (!res.ok) {
      const message = String(record.error ?? '').trim()
      // 413 有两个来源：后端自己的（JSON + 中文说明，见上）与**网关的**。
      // 网关那份是 Nginx 默认 1MB 上限回的错误页（HTML，解析不出 error），
      // 不给可操作提示的话用户只看到一句 413 无从下手（2026-09-17 部署后实测踩到）。
      if (res.status === 413 && !message) {
        throw new Error('上传被网关拒绝（HTTP 413）：请求体超过服务器上传上限，'
          + '请确认 Nginx 的 client_max_body_size 已放宽（本接口后端允许 50MB）')
      }
      throw new Error(message || `语音转写服务返回 HTTP ${res.status}`)
    }
    const text = record.text == null ? '' : String(record.text)
    if (!text.trim()) throw new Error('未识别到文字（音频可能为空或全是静音）')
    const duration = record.duration == null ? null : Number(record.duration)
    return {
      text,
      duration: Number.isFinite(duration) ? duration : null,
      traceId: record.traceId == null ? '' : String(record.traceId),
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new Error('语音转写超时或已取消')
    throw e
  } finally {
    window.clearTimeout(timer)
  }
}
