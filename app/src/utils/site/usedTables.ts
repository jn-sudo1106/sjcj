/**
 * 网站「用到哪些表」的聚合（0924-09，全部源 · 数据视图左栏的数据表列表）。
 *
 * 后端没有"网站 → 表"的接口（0924 方案 B-1，用户定暂不排期），前端用现有接口拼：
 * - 每个源的主表：`site/sources` 行上的 `entryTypeId`（适配后是 `Source.mainTable`）；
 * - 流程各节点的输入 / 输出表：`item/next/nextConfigPaged?flowId&svg=true` 每行的
 *   `entryTypeId` / `outEntry`（适配后是 `Step.inputTable` / `Step.outputTable`）。
 * 一个网站的源通常共用很少几个流程（2026-09-24 实测：站 89 的 1368 个源只有 3 个流程，
 * 站 12 的 6028 个源共用 1 个），按流程去重后请求量很小。
 *
 * ⚠️ 节点**不在** `flow/flowDetail` 里——它的 flowConf 实测是 `{}`，别从那儿取。
 *
 * 本文件只做纯聚合，不发请求；请求编排在 `siteApi.siteUsedTables`。
 */

export interface UsedTableSource {
  sourceId: string
  flowId?: string
  /** 源的主表 ID（entryTypeId） */
  mainTable?: string
}

export interface UsedTableStep {
  inputTable?: string
  outputTable?: string
}

export interface UsedTableCatalogEntry {
  tableId: string
  tableName: string
  name?: string
}

export interface UsedTable {
  tableId: string
  /** 表中文名；目录里查不到时退回表 ID */
  name: string
  /** 物理表名；目录里查不到时为空 */
  tableName: string
  sourceIds: string[]
  sourceCnt: number
  /** MAIN = 至少是一个源的主表；STEP = 只出现在流程节点上（子节点的输入 / 输出表） */
  role: 'MAIN' | 'STEP'
}

/** 空 / '0' 都不是真实的表（后端对"没设"有时给 0） */
function realTableId(id: string | undefined | null): string {
  const value = String(id ?? '').trim()
  return value && value !== '0' ? value : ''
}

export function aggregateUsedTables(
  sources: UsedTableSource[],
  stepsByFlow: Map<string, UsedTableStep[]>,
  catalog: UsedTableCatalogEntry[],
): UsedTable[] {
  const sourceIdsByTable = new Map<string, Set<string>>()
  const mainTables = new Set<string>()
  const add = (tableId: string, sourceId: string) => {
    if (!tableId) return
    let set = sourceIdsByTable.get(tableId)
    if (!set) sourceIdsByTable.set(tableId, (set = new Set()))
    set.add(sourceId)
  }

  // 流程 → 它用到的表（去重），按流程只算一次
  const tablesByFlow = new Map<string, string[]>()
  for (const [flowId, steps] of stepsByFlow) {
    const set = new Set<string>()
    for (const step of steps) {
      const input = realTableId(step.inputTable)
      const output = realTableId(step.outputTable)
      if (input) set.add(input)
      if (output) set.add(output)
    }
    tablesByFlow.set(flowId, [...set])
  }

  for (const source of sources) {
    const main = realTableId(source.mainTable)
    if (main) {
      mainTables.add(main)
      add(main, source.sourceId)
    }
    const flowId = realTableId(source.flowId)
    for (const tableId of (flowId && tablesByFlow.get(flowId)) || []) add(tableId, source.sourceId)
  }

  const catalogById = new Map(catalog.map((entry) => [entry.tableId, entry]))
  return [...sourceIdsByTable.entries()]
    .map(([tableId, ids]) => {
      const entry = catalogById.get(tableId)
      return {
        tableId,
        name: entry?.name || tableId,
        tableName: entry?.tableName ?? '',
        sourceIds: [...ids],
        sourceCnt: ids.size,
        role: mainTables.has(tableId) ? 'MAIN' as const : 'STEP' as const,
      }
    })
    .sort((a, b) => b.sourceCnt - a.sourceCnt || a.tableId.localeCompare(b.tableId))
}

/** 没关联流程的源：只统计了主表，子节点表看不到，列表底部要提示 */
export function countSourcesWithoutFlow(sources: UsedTableSource[]): number {
  return sources.filter((s) => !realTableId(s.flowId)).length
}
