// OSS 文件上传 —— 1:1 迁移旧 data-view `src/page/install/FileOss.vue` 里的上传通路。
//
// 契约（旧页面写死的形状）：
//   POST /api/v1/oss-upload?fileId=<encodeURIComponent(path)>
//        body   = 文件二进制本体（**不是** multipart，也不是 JSON）
//        header = Content-Type: <按扩展名推断 / 固定值>、Authorization: Basic ...（可选）
//
// 为什么不走 api/client.ts 的 request()：那个封装只认 JSON / form 两种 body，二进制上传得自己发。
// 好在它导出了 BASE_URL，这里直接复用，路径口径仍是 `/api/v1/` 前缀，换环境不用改代码。
//
// ⚠️ Authorization 默认值是旧页面**硬编码**的 `Basic YWRtaW46MTIzNDU=`（解码即 admin:12345）。
//    按迁移决定 1:1 保留（不改行为、不加隐藏逻辑），但仍以常量形式集中在这里，
//    将来要换成环境变量或登录态，只改这一个常量即可。
import { BASE_URL } from './client'

/** OSS 读文件服务的基础地址（旧页面 form.readBaseUrl 的默认值） */
export const DEFAULT_READ_BASE_URL = 'http://syncoss.oneweigh.cn:9371/read-file?fileId='

/** 旧页面硬编码的 OSS 写权限（admin:12345 的 Basic 串），见文件头说明 */
export const DEFAULT_AUTHORIZATION = 'Basic YWRtaW46MTIzNDU='

/** 扩展名 → MIME。旧页面的 MIME_MAP，一个不少（少一个就会退化成 application/octet-stream） */
export const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.xml': 'text/xml',
  '.html': 'text/html',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

/** 扩展名（带点，小写不转换——调用方自己 toLowerCase） */
export function getExtension(name: string): string {
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.substring(index) : ''
}

/**
 * 决定这次上传的 Content-Type。
 * 旧口径：`contentType !== 'auto'` 时用固定值，否则先看 fileId 的扩展名、再看文件名的扩展名，
 * 都没有就 application/octet-stream。
 */
export function resolveContentType(fileId: string, fileName: string, contentType = 'auto'): string {
  if (contentType !== 'auto') return contentType
  const ext = getExtension(fileId) || getExtension(fileName)
  return MIME_MAP[ext.toLowerCase()] || 'application/octet-stream'
}

/** 上传结果：成功带后端回执文本，失败带错误原因（页面按条展示，一个失败不影响其它文件） */
export interface OssUploadResult {
  success: boolean
  message: string
}

/**
 * 上传单个文件。
 * @param file  浏览器 File 对象（原样作为 body 发出去）
 * @param fileId OSS 路径，形如 `/qinlong/report/20260709/uuid.txt`
 */
export async function uploadOssFile(param: {
  file: File
  fileId: string
  contentType?: string
  authorization?: string
  signal?: AbortSignal
}): Promise<OssUploadResult> {
  const { file, fileId } = param
  const url = `${BASE_URL}oss-upload?fileId=${encodeURIComponent(fileId)}`
  const headers: Record<string, string> = {
    'Content-Type': resolveContentType(fileId, file.name, param.contentType),
  }
  if (param.authorization) headers.Authorization = param.authorization

  try {
    const res = await fetch(url, { method: 'POST', headers, body: file, signal: param.signal })
    const text = await res.text()
    if (!res.ok) {
      return { success: false, message: `${res.status} - ${text || res.statusText}` }
    }
    // 旧版把对象响应 JSON.stringify 后当回执展示，纯文本就直接显示
    let message = text
    try {
      const parsed = JSON.parse(text) as unknown
      if (parsed !== null && typeof parsed === 'object') message = JSON.stringify(parsed)
    } catch {
      /* 非 JSON 就保持纯文本 */
    }
    return { success: true, message: message || '上传成功' }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) }
  }
}
