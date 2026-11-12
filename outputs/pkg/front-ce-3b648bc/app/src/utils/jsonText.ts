/**
 * JSON 文本格式化（2026-09-28）：OSS 上的 .json 文件（如 TB_KAIPANLA K3「详情json」）存的是一整行
 * 紧凑 JSON，预览时一行到底没法读。能完整解析就按两格缩进展开；解析不了（内容被截断、本来就不是
 * JSON）返回 null，调用方显示原文——宁可原样，也不猜着"修"。
 */
export function prettyJsonText(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return null
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return null
  }
}
