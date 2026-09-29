/**
 * 文件视图的候选表（0929）。
 *
 * 旧平台 FileList2 只认表名带 `file_resource` 的表（`fileApi.resourceTables` 按 name 过滤），
 * 流程下载节点写进别的文件表就看不到——站 124 的「下载PDF」写 6200037 `TB_PDFWJB`（与 133 的
 * 2101765 同构），任务完成了文件视图却是空的，像是下载失败。所以把流程节点的输出表里"结构是
 * 文件表"的也并进候选，并默认选中当前范围内真有文件的那张。
 */

/** 表结构里能用来判断的最小形状（DataTableMeta / ResourceTable 都满足） */
export interface FileTableLike {
  tableId: string
  fields?: { columnName?: string; desc?: string }[]
}

/**
 * 是否按文件表的固定列位建的。文件视图按固定 K 列渲染（K1 文件名 / K3 路径 / K5 md5 …），
 * 所以按列位判断，而不是看有没有"路径"字样的任意列——列位不对的表硬塞进来，展示全是错位的。
 */
export function isFileLikeTable(table: FileTableLike): boolean {
  const descOf = (column: string) => table.fields?.find((f) => f.columnName === column)?.desc ?? ''
  return descOf('K3').includes('路径') && /md5/i.test(descOf('K5'))
}

/**
 * 从一组表（流程节点的输出表）里挑出文件表。取表结构的函数由调用方传入（fileApi.resourceMeta），
 * 单张取失败直接跳过，不影响原有 file_resource 候选。
 */
export async function loadFlowFileTables<T extends FileTableLike>(
  tableIds: (string | undefined)[],
  loadMeta: (tableId: string) => Promise<T | null>,
): Promise<T[]> {
  const ids = [...new Set(tableIds.filter((id): id is string => !!id && id !== '0'))]
  const metas = await Promise.allSettled(ids.map(loadMeta))
  return metas.flatMap((r) => (r.status === 'fulfilled' && r.value && isFileLikeTable(r.value) ? [r.value] : []))
}

/** 流程产出的文件表排前面（它们才是这个源/网站真正写文件的地方），再接 file_resource 表，按 tableId 去重 */
export function mergeFileTableCandidates<T extends { tableId: string }>(flowTables: T[], resourceTables: T[]): T[] {
  const seen = new Set<string>()
  return [...flowTables, ...resourceTables].filter((t) => (seen.has(t.tableId) ? false : (seen.add(t.tableId), true)))
}

/**
 * 默认选中"当前范围内有文件"的表：按候选顺序逐张探测，命中即停；都没有（或探测失败）就退回第一张。
 * 只有一张候选时不探测，省一次请求。
 */
export async function pickTableWithFiles<T>(candidates: T[], hasFiles: (table: T) => Promise<boolean>): Promise<T | undefined> {
  if (candidates.length <= 1) return candidates[0]
  for (const candidate of candidates) {
    try {
      if (await hasFiles(candidate)) return candidate
    } catch {
      // 单张表探测失败不影响其他表，继续下一张
    }
  }
  return candidates[0]
}
