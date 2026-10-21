// OSS 上传页的路径工具 —— 从旧 `FileOss.vue` 的 methods 里抠出来的纯函数。
//
// 这些规则是那一页最容易出事的部分，单独放一份好写单测：
//   · 默认前缀 `/qinlong/report/YYYYMMDD`（当天日期，不带分隔符）
//   · 每个文件一个 UUID 文件名（不可读、避免同名覆盖），用户改了 fileId 就变「自定义」
//   · fileId 必须是**完整文件路径**：不能空、不能是纯 "/"、不能以 "/" 结尾、不能有 "//"
//     （旧版注释写明：'/' 这种路径发到后端会 500）
import { getExtension } from '@/api/oss'

/** 默认路径前缀：/qinlong/report/YYYYMMDD（旧 getDefaultPrefix） */
export function getDefaultPrefix(date = new Date()): string {
  const dateStr =
    String(date.getFullYear()) +
    String(date.getMonth() + 1).padStart(2, '0') +
    String(date.getDate()).padStart(2, '0')
  return `/qinlong/report/${dateStr}`
}

/** UUID v4 风格的随机串（旧 generateUuid，用 Math.random，不依赖 crypto） */
export function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

/** 拼前缀和文件名，顺手把两侧多余的 "/" 规范化（旧 joinPath） */
export function joinPath(prefix: string, fileName: string): string {
  const left = (prefix || '').replace(/\/+$/, '')
  const right = (fileName || '').replace(/^\/+/, '')
  return `${left}/${right}`
}

/** fileId 合法性（旧 isValidFileId）：非空、不是纯 "/"、不以 "/" 结尾、不含连续 "//" */
export function isValidFileId(fileId: string | null | undefined): boolean {
  if (!fileId || typeof fileId !== 'string') return false
  const trimmed = fileId.trim()
  if (!trimmed) return false
  if (/^\/+$/.test(trimmed)) return false
  if (trimmed.endsWith('/')) return false
  if (trimmed.includes('//')) return false
  return true
}

/** 预览地址 = 读取服务基础地址 + encodeURIComponent(fileId)（旧 getPreviewUrl） */
export function buildPreviewUrl(readBaseUrl: string, fileId: string): string {
  if (!readBaseUrl || !fileId || !fileId.trim()) return ''
  return `${readBaseUrl.replace(/\/+$/, '')}${encodeURIComponent(fileId)}`
}

/** 自动路径 = 前缀 + UUID + 原扩展名（旧 watch fileList / resetFileId 里的拼法） */
export function buildAutoFileId(prefix: string, uuid: string, fileName: string): string {
  return joinPath(prefix, uuid + getExtension(fileName))
}
