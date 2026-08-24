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

export type PreviewKind = 'excel' | 'pdf' | 'image' | 'text' | 'none'

const EXCEL_EXT = new Set(['xlsx', 'xls', 'xlsm', 'csv'])
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])
const TEXT_EXT = new Set(['txt', 'json', 'xml', 'md', 'html', 'htm', 'log'])

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
  if (TEXT_EXT.has(e)) return 'text'
  return 'none'
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
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

/** 从文件名兜底推断扩展名——K7 缺失时用（例如数据视图单元格里只有一个路径）。 */
export function extFromName(name?: string | null): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name ?? '').trim())
  return m ? m[1].toLowerCase() : ''
}
