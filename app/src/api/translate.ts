// 翻译（翻译助手节点，2026-09-18 接入，2026-09-21 起支持多引擎）：后端 vanv-data-engine 的
// `com.vanv.dataengine.translate`。
//
// 契约（逐字核对 TranslateController / TranslateRouter / 三个引擎客户端）：
//   请求  POST /api/translate   JSON `{"from":"zh","to":"en","query":"你好，世界","engine":"baidu"}`
//         · from/to 是**百度语言标签**（zh/cht/en/jp/kor/fra/de/spa/ru…，from 支持 auto，**to 不支持 auto**）
//         · engine 可选：baidu / google / youdao，**缺省 baidu**（向后兼容）
//         · query 单次上限 `translate.max-query-bytes`（默认 **6000 字节**，按 UTF-8 编码算——
//           不是字符数！中文 1 字 3 字节，约 2000 字）
//         · from/to/query 都必须非空白，否则 400
//   响应  200 `{"from":"zh","to":"en","translatedText":"Hello, world"}`
//         · 后端把上游的分段译文用换行合并成整段一次性返回，**不是流式**
//         · from/to 已由后端归一化为百度码（谷歌/有道方言差异收敛在后端），前端零感知
//         · 返回的 from 是上游实际识别到的源语言（auto 时可能更精确），用它展示"检测到的语言"更准
//   错误  400（参数/引擎名/超字节数）/ 429（上游限流）/ 502（凭据/余额/IP 白名单/上游不可达）
//         → `{"error":"..."}`，后端已把各家错误码翻成人话 + 排查提示，前端原样透出
//
// 后端实现：TranslateRouter 按 engine 分发到百度开放平台（appId+secretKey 的 MD5 签名）、
// 谷歌 v2 Basic（API key）、有道智云（appKey+appSecret 的 sha256 v3 签名）三个客户端。
// 语言方言映射全部在后端（jp→ja、cht→zh-TW、zh→zh-CHS…），前端仍发百度标签。
//
// ⚠️ 这台服务与 data-process 同在 8080，但**不在 /api/answer 下**：开发环境 Vite 单独转发
// `/api/translate`，生产 Nginx 也有对应的 location（漏了会被通用 /api 送到业务后端 404）。
const TRANSLATE_API_URL = '/api/translate'

/**
 * 单次翻译上限（后端 translate.baidu.max-query-bytes 默认值）。
 * ⚠️ 单位是**字节**（UTF-8），不是字符：中文 1 字 3 字节，6000 字节大约 2000 个汉字。
 */
export const TRANSLATE_MAX_QUERY_BYTES = 6000

/** 文本的 UTF-8 字节数（与后端 validateRequest 的算法一致：`getBytes(UTF_8).length`）。 */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** 「源语言」里的自动检测项：请求时发 `auto`，交给上游判断 */
export const TRANSLATE_AUTO_CODE = 'auto'

/**
 * 界面语言名 → 百度语言码。
 *
 * 代码取自百度翻译的语言列表（不是 ISO 639-1）：日语是 `jp` 不是 `ja`、韩语 `kor`、法语 `fra`、
 * 西班牙语 `spa`、繁体 `cht`。后端不做映射，直接把 from/to 透传给百度，所以映射必须在前端做对，
 * 否则百度会报语言不支持。
 */
export const TRANSLATE_LANGUAGE_CODES: Record<string, string> = {
  '中文简体': 'zh',
  '中文繁体': 'cht',
  '英语': 'en',
  '日语': 'jp',
  '韩语': 'kor',
  '法语': 'fra',
  '德语': 'de',
  '西班牙语': 'spa',
  '俄语': 'ru',
}

/** 界面语言名 → 百度语言标签；认不出（含「自动检测」这种非语言项）返回 auto，交给上游识别。 */
export function languageCodeOf(language: string): string {
  const key = language.trim()
  if (!key || key === '自动检测') return TRANSLATE_AUTO_CODE
  return TRANSLATE_LANGUAGE_CODES[key] ?? TRANSLATE_AUTO_CODE
}

/** 翻译引擎名 → 引擎码（2026-09-21 起，请求体 engine 字段的口径） */
export const TRANSLATE_ENGINE_CODES: Record<string, string> = {
  '谷歌翻译': 'google',
  '有道翻译': 'youdao',
  '百度翻译': 'baidu',
}

/** 引擎码 → 界面引擎名（code_rule 回填下拉用） */
export const TRANSLATE_ENGINE_LABELS: Record<string, string> = {
  google: '谷歌翻译',
  youdao: '有道翻译',
  baidu: '百度翻译',
}

/**
 * 界面引擎名/引擎码 → 引擎码（core_param 里 engine 的统一口径，2026-09-21 最终拍板存英文码）。
 * 兼容两种输入：界面名（「谷歌翻译」）换算成码，已经是码（google）原样返回；
 * 其余认不出（含空）回落 baidu（存量 code_rule 没有 engine 字段，缺省即百度）。
 */
export function engineCodeOf(engine: string): string {
  const key = engine.trim()
  if (!key) return 'baidu'
  const byLabel = TRANSLATE_ENGINE_CODES[key]
  if (byLabel) return byLabel
  const lower = key.toLowerCase()
  if (TRANSLATE_ENGINE_LABELS[lower]) return lower
  return 'baidu'
}

/**
 * 引擎码/界面名 → 界面引擎名。兼容两种输入：已经是界面名（如「谷歌翻译」）原样返回，
 * 引擎码（google/youdao/baidu）换算成界面名；其余不认识的回落「百度翻译」。
 */
export function engineLabelOf(code: string): string {
  const key = code.trim()
  if (TRANSLATE_ENGINE_CODES[key]) return key
  return TRANSLATE_ENGINE_LABELS[key.toLowerCase()] ?? '百度翻译'
}

/**
 * 「测试翻译」的内置样例文本（2026-09-21 改版：编排配置不再有输入框，测试按钮用样例验证引擎）。
 * 按界面语言名各备一句；源语言选「自动检测」时用中文简体样例。
 */
export const TRANSLATE_SAMPLE_TEXTS: Record<string, string> = {
  '中文简体': '你好，世界！这是一段用于测试翻译引擎的文本。',
  '中文繁体': '你好，世界！這是一段用於測試翻譯引擎的文本。',
  '英语': 'Hello, world! This is a sample text for testing the translation engine.',
  '日语': 'こんにちは、世界！これは翻訳エンジンをテストするためのサンプルテキストです。',
  '韩语': '안녕하세요, 세계! 이것은 번역 엔진을 테스트하기 위한 샘플 텍스트입니다.',
  '法语': 'Bonjour le monde ! Ceci est un exemple de texte pour tester le moteur de traduction.',
  '德语': 'Hallo Welt! Dies ist ein Beispieltext zum Testen der Übersetzungs-Engine.',
  '西班牙语': '¡Hola, mundo! Este es un texto de ejemplo para probar el motor de traducción.',
  '俄语': 'Привет, мир! Это пример текста для проверки движка перевода.',
}

/** 取测试样例：按界面语言名找，找不到（含自动检测）回落中文简体样例。 */
export function translateSampleOf(language: string): string {
  const key = language.trim()
  return TRANSLATE_SAMPLE_TEXTS[key] ?? TRANSLATE_SAMPLE_TEXTS['中文简体'] ?? ''
}

export interface TranslateResult {
  /** 上游实际识别到的源语言码（auto 时可能是 zh / en…） */
  from: string
  to: string
  translatedText: string
}

/**
 * 调后端翻译一段文本。失败（网络 / 超时 / 非 2xx / 空译文）向上抛，
 * 错误信息优先用后端 `{"error": "..."}` 里的原文。
 */
export async function translateText(
  input: { from: string; to: string; query: string; engine?: string },
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<TranslateResult> {
  const query = input.query.trim()
  if (!query) throw new Error('缺少待翻译内容')
  const to = languageCodeOf(input.to)
  // 后端明确拒绝 to=auto（"to 不支持 auto，请指定具体目标语言"），这里先给一句中文提示
  if (to === TRANSLATE_AUTO_CODE) throw new Error('请选择具体的目标语言（目标语言不支持自动检测）')
  // 上限按 UTF-8 字节算，与后端共享校验同口径
  const bytes = utf8ByteLength(query)
  if (bytes > TRANSLATE_MAX_QUERY_BYTES) {
    throw new Error(`单次最多 ${TRANSLATE_MAX_QUERY_BYTES} 字节（中文约 2000 字），当前 ${bytes} 字节，请分段翻译`)
  }
  const controller = new AbortController()
  // 后端读上游的超时是 1 分钟，前端比它宽一点
  const timer = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 90_000)
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true })
  try {
    const res = await fetch(TRANSLATE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        from: languageCodeOf(input.from),
        to,
        query,
        engine: engineCodeOf(input.engine ?? '百度翻译'),
      }),
      signal: controller.signal,
    })
    const payload: unknown = await res.json().catch(() => null)
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    if (!res.ok) {
      const message = String(record.error ?? '').trim()
      // 429 是上游限流，给一句能指导操作的话
      if (res.status === 429 && !message) throw new Error('翻译请求过于频繁，请稍后重试')
      throw new Error(message || `翻译服务返回 HTTP ${res.status}`)
    }
    const translatedText = record.translatedText == null ? '' : String(record.translatedText)
    if (!translatedText.trim()) throw new Error('后端没有返回译文（原文可能为空或上游无结果）')
    return {
      from: record.from == null ? '' : String(record.from),
      to: record.to == null ? '' : String(record.to),
      translatedText,
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new Error('翻译超时或已取消')
    throw e
  } finally {
    window.clearTimeout(timer)
  }
}
