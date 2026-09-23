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
// ---- 音频提取文字节点「编排配置」的结构化配置（落 cs_config.CODE_RULE，见方案 §3）----
//
// 这份 JSON 是前后端的契约：字段名与 `wanv-processor` audio-to-text 分支的
// `RULE_DEFAULTS` / `build_payload` 逐字对齐，改一处必须同步另一处（方案 §7 红线）。
// 与转写执行本身无关的常量（供应商/模型候选、区间时长上限）也在这一节，UI 与后端读同一份。

/** 模型供应商：本地离线（faster-whisper，全默认）或远程语音转文字接口。 */
export type AudioProviderKind = 'local' | 'remote'

/** 输出格式：纯文本或字幕 SRT。远程接口只回整段文本、无分段，因此 remote 只允许 txt（方案 C5）。 */
export type AudioOutputFormat = 'txt' | 'srt'

/** 远程接口供应商候选（后端 /api/speech 支持的 providerCode）。 */
export const SPEECH_PROVIDER_OPTIONS: { value: string; label: string }[] = [
  { value: 'MiniMax', label: 'MiniMax' },
]

/** 远程接口侧模型候选（providerCode 对应的 model）。 */
export const SPEECH_MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'asr-1.0', label: 'asr-1.0' },
]

export interface AudioOrchestrationConfig {
  /** Context 中音频来源字段名，留空由后端按「唯一 Key → 任务 Url」定位 */
  urlField: string
  provider: AudioProviderKind
  /** 仅 provider=remote：接口供应商码 */
  providerCode: string
  /** 仅 provider=remote：接口侧模型 */
  remoteModel: string
  /** 识别语言（BCP-47，见 SPEECH_LANGUAGE_OPTIONS），留空=自动识别。local/remote 共用 */
  language: string
  /** 区间裁剪起点，秒或 HH:MM:SS，空=从头。主用途：切给远程绕开 500s 上限 */
  start: string
  /** 区间裁剪终点，空=到尾 */
  end: string
  outputFormat: AudioOutputFormat
  /** 远端产物目录前缀，留空用后端默认（/code01） */
  outputBaseDir: string
}

export const AUDIO_ORCHESTRATION_DEFAULTS: AudioOrchestrationConfig = {
  urlField: '',
  provider: 'local',
  providerCode: 'MiniMax',
  remoteModel: 'asr-1.0',
  language: '',
  start: '',
  end: '',
  outputFormat: 'txt',
  outputBaseDir: '',
}

/**
 * 把时间文本解析成秒数：接受纯秒数（`90` / `90.5`）与 `HH:MM:SS` / `MM:SS`。
 * 与后端 `video_audio_extract.parse_time` 同口径。空串 / `null` → `null`（表示不设该端）；
 * 解析不出（负数、乱码、end≤start 之类交上层判）也回 `null`，UI 据此给可读提示而非瞎猜。
 */
export function parseAudioTimeToSeconds(value: string | null | undefined): number | null {
  const text = (value ?? '').trim()
  if (!text) return null
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text)
  const parts = text.split(':')
  if (parts.length === 2 || parts.length === 3) {
    const nums = parts.map((p) => (p.trim() ? Number(p) : NaN))
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null
    const [h, m, s] = parts.length === 3
      ? [nums[0], nums[1], nums[2]]
      : [0, nums[0], nums[1]]
    return h * 3600 + m * 60 + s
  }
  return null
}

/**
 * 校验区间：两端都填且可解析时才判 `end > start`，返回错误信息（null = 无错）。
 * 起点越界 / 终点截断由后端拿真实时长再判，前端只拦「明显反了」的输入。
 */
export function validateAudioRange(start: string, end: string): string | null {
  if (!start.trim() || !end.trim()) return null
  const s = parseAudioTimeToSeconds(start)
  const e = parseAudioTimeToSeconds(end)
  if (s == null) return '开始时间格式不正确（用秒数或 HH:MM:SS）'
  if (e == null) return '结束时间格式不正确（用秒数或 HH:MM:SS）'
  if (e <= s) return '结束时间必须晚于开始时间'
  return null
}

function asStringValue(value: unknown, fallback = ''): string {
  return value == null ? fallback : String(value)
}

/**
 * 从节点已存的 CORE_PARAM（structuredConfig JSON）还原音频编排配置；
 * 解析不出 / 字段不齐时回落默认，provider 只认 local/remote，其它按默认。
 */
export function parseAudioOrchestrationConfig(stored: unknown): AudioOrchestrationConfig {
  const base = { ...AUDIO_ORCHESTRATION_DEFAULTS }
  if (typeof stored !== 'string') return base
  const text = stored.trim()
  if (!text.startsWith('{')) return base
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return base
    const record = parsed as Record<string, unknown>
    const provider = asStringValue(record.provider).trim()
    const outputFormat = asStringValue(record.outputFormat).trim()
    return {
      urlField: asStringValue(record.urlField),
      provider: provider === 'remote' ? 'remote' : provider === 'local' ? 'local' : base.provider,
      providerCode: asStringValue(record.providerCode) || base.providerCode,
      remoteModel: asStringValue(record.remoteModel) || base.remoteModel,
      language: asStringValue(record.language).trim(),
      start: asStringValue(record.start).trim(),
      end: asStringValue(record.end).trim(),
      outputFormat: outputFormat === 'srt' ? 'srt' : outputFormat === 'txt' ? 'txt' : base.outputFormat,
      outputBaseDir: asStringValue(record.outputBaseDir),
    }
  } catch {
    return base
  }
}

/**
 * 把音频编排配置落成 CORE_PARAM 文本（保存时随 buildConfigPayload 写进 config.coreParam）。
 * remote 强制 txt（C5），落库前就抹掉 srt，避免存出后端做不到的组合。
 */
export function serializeAudioOrchestrationConfig(cfg: AudioOrchestrationConfig): string {
  const outputFormat: AudioOutputFormat = cfg.provider === 'remote' ? 'txt' : cfg.outputFormat
  return JSON.stringify({
    urlField: cfg.urlField.trim(),
    provider: cfg.provider,
    providerCode: cfg.provider === 'remote' ? cfg.providerCode.trim() : '',
    remoteModel: cfg.provider === 'remote' ? cfg.remoteModel.trim() : '',
    language: cfg.language.trim(),
    start: cfg.start.trim(),
    end: cfg.end.trim(),
    outputFormat,
    outputBaseDir: cfg.outputBaseDir.trim(),
  })
}

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
