// OCR 识别服务（2026-09-17 接入）：外部服务 `http://118.25.96.217:4864/ocr`。
//
// 契约（2026-09-17 用真实样本实测，HTTP 200）：
//   请求  POST /ocr   body `{"image": "<裸 base64>"}`——**不带** `data:image/png;base64,` 前缀
//   响应  `{"status":"success","message":"ok","data":{"result":{"data":[
//            {"block_id":"1","element_value":"Body","row_id":"1"}, …]}}}`
//   数组里每个元素是一个文本块：`element_value` 是识别出的文字，`row_id` 是行号
//  （按 row_id 聚合更接近原文版面，见 ocrTextOf）。
//
// 为什么不走 request() / ENDPOINT_PATHS：那套适配层是给业务后端（BASE_URL=/api/v1/）用的，
// 端点表里的路径都会拼到业务后端的 base 上。这台是独立部署的第三方服务，采用与
// data-process / prompt 服务同款做法——自己的 base + fetch：开发环境靠 Vite 代理收进同源
// （见 vite.config.ts 的 /ocr），生产由 Nginx 反代，目标地址用 VITE_OCR_PROXY_TARGET 切换。
const OCR_API_BASE = '/ocr'
/** 识别是同步长请求（实测样本 0.5s，大图会久得多），超时给足；调用方可用信号提前取消。 */
const OCR_TIMEOUT_MS = 60_000

export interface OcrBlock {
  blockId: string
  rowId: string
  text: string
}

export interface OcrResult {
  status: string
  message: string
  blocks: OcrBlock[]
  /** 原始响应，界面上给"看原文"用（返回结构以后变了也不至于丢信息）。 */
  raw: unknown
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function toText(value: unknown): string {
  return value == null ? '' : String(value)
}

/**
 * 响应 → 文本块列表。路径按实测结构取；结构对不上就返回空数组（不抛），
 * 由调用方把 raw 展示出来兜底——契约以后变了，用户至少还看得到原始返回。
 */
export function ocrBlocksOf(payload: unknown): OcrBlock[] {
  const data = asRecord(asRecord(payload).data)
  const result = asRecord(data.result)
  const list = Array.isArray(result.data) ? result.data : []
  return list.map((item) => {
    const record = asRecord(item)
    return {
      blockId: toText(record.block_id),
      rowId: toText(record.row_id),
      text: toText(record.element_value),
    }
  })
}

/**
 * 文本块 → 可读文本：按 row_id 聚合成行（同一行的多个块用空格接），行序按 row_id 升序
 * （纯数字时按数值排，"10" 不会排到 "2" 前面）。
 */
export function ocrTextOf(blocks: OcrBlock[]): string {
  const rows = new Map<string, string[]>()
  const order: string[] = []
  for (const block of blocks) {
    const key = block.rowId || String(order.length + 1)
    if (!rows.has(key)) {
      rows.set(key, [])
      order.push(key)
    }
    const text = block.text.trim()
    if (text) rows.get(key)!.push(text)
  }
  const numeric = order.every((key) => /^\d+$/.test(key))
  const sorted = numeric ? [...order].sort((a, b) => Number(a) - Number(b)) : order
  return sorted.map((key) => rows.get(key)!.join(' ')).filter(Boolean).join('\n')
}

/** `data:image/png;base64,iVBOR…` → `iVBOR…`：服务要裸 base64，前缀必须去掉。 */
export function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma >= 0 && /^data:/i.test(dataUrl) ? dataUrl.slice(comma + 1) : dataUrl
}

/** 图片文件 → 裸 base64（内部走 readAsDataURL 再剥前缀，等价于 readAsBinaryString + btoa 但不受编码影响）。 */
export function readImageAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      if (!result) {
        reject(new Error('图片读取失败'))
        return
      }
      resolve(stripDataUrlPrefix(result))
    }
    reader.readAsDataURL(file)
  })
}

/**
 * 调 OCR 服务识别一张图片。失败（网络 / 超时 / 非 2xx / status!=='success'）向上抛，
 * 由调用方决定提示策略。
 */
export async function recognizeImage(
  imageBase64: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<OcrResult> {
  const image = imageBase64.trim()
  if (!image) throw new Error('缺少图片内容')
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), options.timeoutMs ?? OCR_TIMEOUT_MS)
  // 外部信号与超时信号取并集：任一触发都中断这次请求
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true })
  try {
    const res = await fetch(OCR_API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: '*/*' },
      body: JSON.stringify({ image }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`OCR 服务返回 HTTP ${res.status}`)
    const payload: unknown = await res.json()
    const record = asRecord(payload)
    const status = toText(record.status)
    const message = toText(record.message)
    const blocks = ocrBlocksOf(payload)
    if (status && status !== 'success') throw new Error(message || `OCR 识别失败（${status}）`)
    if (!blocks.length) throw new Error(message && message !== 'ok' ? message : 'OCR 未返回识别结果')
    return { status: status || 'success', message, blocks, raw: payload }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new Error('OCR 识别超时或已取消')
    throw e
  } finally {
    window.clearTimeout(timer)
  }
}
