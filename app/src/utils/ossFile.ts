import { DEFAULT_API_PROXY_TARGET } from '@/constants/backend'

/**
 * 原始文件（Excel / PDF / 图片 / 文本）的取用地址与字节流。
 *
 * 通路只有一条：文件资源表的 K3「文件路径」是 OSS 上的路径，经同源 `/oss` 前缀取回。
 * K9「文本路径」在真实数据里整列为空，K2「文件链接」是源站的原始外网地址（跨域且
 * 可达性不保证），两者都不能用于站内预览——K2 只适合「新窗口打开」。
 * 详见方案 §7.4 / §7.4.1（2026-08-21 生产实测）。
 *
 * 同源怎么来的：OSS 服务在 9102 端口，与业务后端（9999）不同源，浏览器不允许页面
 * 跨源读取内容。开发环境由 vite 的 `/oss` 代理收进同源，生产环境由 wan 反代
 * （JN-WW/wan `feat/sjcj-oss-proxy`）。
 */

/** OSS 路径 → 同源可取地址。路径原样拼接，不做 encodeURIComponent（旧平台亦然，实测两种都可用）。 */
export function ossFileUrl(path: string): string {
  return `/oss/api/oss/download?fileId=${path}`
}

/**
 * OSS 路径 → **独立 origin 的绝对地址**，只用于「新窗口打开」，不能用于 fetch（跨源会被 CORS 拒）。
 *
 * 端口规则跟 vite.config.ts 的 `/oss` 代理同源同宗：OSS 服务在业务后端同机的 9102 端口。
 * 这里不复用 `ossFileUrl` 的同源前缀是刻意的——同源恰恰是问题所在：
 * 采集回来的页面在我们自己的 origin 下打开，它的脚本就能读 localStorage 里的登录 token。
 * 旧平台（EntryList2.vue 的 `<a target="_blank">`）打开的是 9102 这个**独立 origin**，
 * 与它的前端（9999）天然隔离，页面脚本正常跑、正文正常显示，又碰不到主应用。这里照搬。
 */
export function ossPublicUrl(path: string): string {
  const target = import.meta.env.VITE_API_PROXY_TARGET || DEFAULT_API_PROXY_TARGET
  return `${String(target).replace(/:\d+$/, ':9102')}/api/oss/download?fileId=${path}`
}

/**
 * 取文件字节流。
 *
 * **必须不带凭据**：OSS 服务本身无鉴权，收到 sjcj 的会话 Cookie 反而返回 500
 * （2026-08-21 生产实测：带 Cookie 500、不带 201）。这也是不能把 URL 直接交给
 * 第三方预览组件的原因——组件内部自己发请求会带上 Cookie。
 */
export async function fetchOssFile(path: string): Promise<ArrayBuffer> {
  const res = await fetch(ossFileUrl(path), { credentials: 'omit' })
  // OSS 成功时返回 201 Created 而不是 200，别只认 200
  if (!res.ok) throw new Error(`取文件失败（HTTP ${res.status}）`)
  return res.arrayBuffer()
}

/**
 * 只取文件开头的若干字节。
 *
 * 用流式读取而不是 Range 请求：OSS 那边是否支持 Range 没有把握，而流式读到够了就
 * `cancel()`，即便服务端整份吐出来也会在传够之后断开连接，**不会把 3MB 的正文整份拉完**。
 * 这一条很关键——HTML 存档的探测（见 utils/blockedArchive.ts）对每次预览都要跑一次，
 * 若按整份下载，正常文章会被下两遍（探测一次、iframe 再一次）。
 */
export async function fetchOssFileHead(path: string, maxBytes: number): Promise<ArrayBuffer> {
  const res = await fetch(ossFileUrl(path), { credentials: 'omit' })
  if (!res.ok) throw new Error(`取文件失败（HTTP ${res.status}）`)
  if (!res.body) return (await res.arrayBuffer()).slice(0, maxBytes)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
    }
  } finally {
    // 读够就掐断，剩下的字节不再落地
    void reader.cancel().catch(() => {})
  }
  const out = new Uint8Array(Math.min(received, maxBytes))
  let at = 0
  for (const c of chunks) {
    if (at >= out.length) break
    out.set(c.subarray(0, out.length - at), at)
    at += c.length
  }
  return out.buffer
}

export type PreviewKind = 'excel' | 'pdf' | 'image' | 'html' | 'text' | 'none'

const EXCEL_EXT = new Set(['xlsx', 'xls', 'xlsm', 'csv'])
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])
const HTML_EXT = new Set(['html', 'htm'])
const TEXT_EXT = new Set(['txt', 'json', 'xml', 'md', 'log'])

/**
 * 按扩展名决定用哪种预览器。
 * 真实分布以 Excel 为主（文件中心首页 20 行：xlsx 13 / pdf 7 / txt 0），
 * txt 主要出现在数据视图的 `content_path` 字段。
 */
export function previewKindOf(ext?: string | null): PreviewKind {
  const e = String(ext ?? '').trim().toLowerCase().replace(/^\./, '')
  if (!e) return 'none'
  if (EXCEL_EXT.has(e)) return 'excel'
  if (e === 'pdf') return 'pdf'
  if (IMAGE_EXT.has(e)) return 'image'
  if (HTML_EXT.has(e)) return 'html'
  if (TEXT_EXT.has(e)) return 'text'
  return 'none'
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  html: 'text/html;charset=utf-8',
  htm: 'text/html;charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
}

/**
 * 扩展名 → MIME 类型，**建 blob 时必须带上**。
 *
 * `new Blob([buf])` 不给 type，得到的 blob URL 没有 Content-Type，浏览器按 text/plain 处理：
 * PDF 塞进 <iframe> 会整页显示 `%PDF-1.7 …` 的二进制原文，而不是渲染成文档（2026-08-24 实测）。
 */
export function mimeTypeOf(ext?: string | null): string {
  const e = String(ext ?? '').trim().toLowerCase().replace(/^\./, '')
  return MIME_BY_EXT[e] ?? ''
}

/**
 * 按**字段语义**猜扩展名——给那些"路径里根本没有后缀"的存储路径用。
 *
 * 2026-09-18 实测：公众号正文路径（`TB_GZHWZ` 的 K9 / URLMD5，字段名「正文路径」）长这样
 *   `/gzh/gzh_msg/MzU2Njc5NjY0OQ==/2020-01-29/d0bc4a044f965c2058475987760f1c6f`
 * ——尾段是 md5，**没有 `.txt`**。于是 `extFromName` 取不到东西，`previewKindOf('')`
 * 返回 `none`，预览面板只能显示「该类型不支持站内直接解析」。
 *
 * 所以靠字段本身来判断：正文类 → txt，网页快照类 → html。命中不了就返回空串，
 * 由调用方继续回退到 `extFromName`（路径真带后缀时那条仍然更可信）。
 *
 * ⚠️ 不要在这里按"是文件路径就默认 txt"兜底：图片、附件同样没有后缀的情况存在，
 * 猜错会把二进制塞进文本预览器。
 */
export function extFromFieldHint(field?: { prop?: string; columnName?: string; desc?: string } | null): string {
  if (!field) return ''
  const col = String(field.columnName || '').toUpperCase()
  const prop = String(field.prop || '').toLowerCase()
  const desc = String(field.desc || '')
  if (col === 'K17' || prop === 'html' || desc.includes('html') || desc.includes('网页')) return 'html'
  // K6 是新闻类表的正文路径，K9 是公众号表的；两边字段名都带「正文」，desc 这条才是通用的那个判据
  if (col === 'K6' || prop.includes('content') || prop.includes('textpath') || desc.includes('正文')) return 'txt'
  return ''
}

/**
 * 给**存少了后缀的** OSS 路径补上扩展名。
 *
 * 2026-09-18 生产实测（公众号源 430022401 的一行正文路径）：
 *
 * | 请求                                   | 结果 |
 * | -------------------------------------- | ---- |
 * | 库里存的 `…/d0bc4a04…7760f1c6f`        | **404** |
 * | `…/d0bc4a04…7760f1c6f.txt`             | 201，2892 字节 —— 与该行 K13「正文大小」完全一致 |
 * | `…/d0bc4a04…7760f1c6f.html`            | 201，9298 字节（同一 md5 下还存着网页快照） |
 *
 * 也就是说 `TB_GZHWZ` 的正文路径字段落库时丢了后缀，OSS 上的真实对象名是带 `.txt` 的，
 * 拿原样的路径去取必然 404。这个补丁只在**字段语义能确定类型**时生效
 * （`extFromFieldHint` 猜得出来），路径本身已带后缀的一概不动。
 *
 * 治本是后端把后缀写进库里；在那之前，不补这一下公众号正文就是打不开的。
 */
export function ossPathWithExt(path: string, ext?: string | null): string {
  const p = String(path ?? '').trim()
  const e = String(ext ?? '').trim().replace(/^\./, '')
  if (!p || !e) return p
  // 路径自带后缀时以它为准：它是实打实的对象名，猜测不该覆盖事实
  if (extFromName(p)) return p
  return `${p}.${e}`
}

/** 从文件名兜底推断扩展名——K7 缺失时用（例如数据视图单元格里只有一个路径）。 */
export function extFromName(name?: string | null): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name ?? '').trim())
  return m ? m[1].toLowerCase() : ''
}
