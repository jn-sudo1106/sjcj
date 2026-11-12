/**
 * 搜索框输入是否是一组 ID：纯数字，单个或用中英文逗号 / 空格分隔多个。是则返回 ID 列表，否则 null。
 * 流程中心、画布「更换流程」共用（口径照旧平台 FlowList.buildQueryParams：单 ID → flowId，多 ID → ids）。
 */
export function parseIdList(raw: string): string[] | null {
  const parts = raw.trim().split(/[,，\s]+/).filter(Boolean)
  if (!parts.length || !parts.every((p) => /^\d+$/.test(p))) return null
  return parts
}
