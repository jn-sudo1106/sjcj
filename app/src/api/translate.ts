// 翻译（翻译助手节点，2026-09-18 接入）：后端 vanv-data-engine 的 `com.vanv.dataengine.translate`。
//
// 契约（逐字核对 TranslateController / BaiduTranslateClient，**2026-09-18 后端换成开放平台后重核过**）：
//   请求  POST /api/translate   JSON `{"from":"zh","to":"en","query":"你好，世界"}`
//         · from/to 是**百度语言标签**（zh/cht/en/jp/kor/fra/de/spa/ru…，from 支持 auto，**to 不支持 auto**）
//         · query 单次上限 `translate.baidu.max-query-bytes`（默认 **6000 字节**，按 UTF-8 编码算——
//           不是字符数！中文 1 字 3 字节，约 2000 字）
//         · from/to/query 都必须非空白，否则 400
//   响应  200 `{"from":"zh","to":"en","translatedText":"Hello, world"}`
//         · 后端把开放平台的 trans_result 各句用换行合并成整段译文后一次性返回，**不是流式**
//         · 返回的 from 是上游实际识别到的源语言（可能比请求更精确），用它展示"检测到的语言"更准
//   错误  400（参数，含超字节数）/ 429（百度限流 54003/54005）/ 502（鉴权/余额/IP 白名单/上游不可达）
//         → `{"error":"..."}`，后端已把百度错误码翻成人话 + 排查提示，前端原样透出
//
// 后端实现：百度翻译**开放平台**（api.fanyi.baidu.com，appId + secretKey 签名），
// 不再依赖浏览器会话抓来的 acs-token/cookie；语言标签还额外接受常见 ISO 写法
//（ja→jp、ko→kor、fr→fra、es→spa、zh-CN→zh、zh-TW→cht…）。前端仍发百度标签，不依赖别名表。
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
  input: { from: string; to: string; query: string },
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<TranslateResult> {
  const query = input.query.trim()
  if (!query) throw new Error('缺少待翻译内容')
  const to = languageCodeOf(input.to)
  // 后端明确拒绝 to=auto（"to 不支持 auto，请指定具体目标语言"），这里先给一句中文提示
  if (to === TRANSLATE_AUTO_CODE) throw new Error('请选择具体的目标语言（目标语言不支持自动检测）')
  // 上限按 UTF-8 字节算，与后端 validateRequest 同口径
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
      body: JSON.stringify({ from: languageCodeOf(input.from), to, query }),
      signal: controller.signal,
    })
    const payload: unknown = await res.json().catch(() => null)
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    if (!res.ok) {
      const message = String(record.error ?? '').trim()
      // 429 是上游限流（百度网页版对 token 有频率限制），给一句能指导操作的话
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
