// 组级「源数据权限」范围的读写 —— 系统设置 → 数据权限设置 的可见/排除范围编辑器用。
//
// 落库口径（后端 SysGroupResService.saveSourceScope 负责，前端只传用户点选的结果）：
//   · 整目录 → resType=SOURCE / condType=STRUCT，后端把目录展开成「自身+全部后代 CATEGORY_ID」
//     编译成 CATEGORY_ID IN (...)，remarks 存 {roots:[...]} 供回显还原成用户点选的最小集。
//     展开必须在后端做：读取侧 AuthResEnum.SOURCE 只跑一遍 `SELECT SOURCE_ID from cs_source where <cond>`，
//     不会自己向下级联，而且 ID 列表长度已经不是 varchar(2000) 能装的（见 V3.5.0 迁移）。
//   · 单源   → resType=SOURCE / condType=ID，resCond=逗号 SOURCE_ID 串。
// 一个组本面板最多维护 4 条规则（可见/排除 × 目录/源）；其它 resType（CONFIG/ENTRY_TYPE/PARAM/CATEGORY）
// 以及 SOURCE/SQL 存量规则不归本面板管，保存时后端也不动它们。
import { request } from './client'

const EP = {
  scope: 'group-res/source-scope',
  saveScope: 'group-res/modify-source-scope',
  scopeTree: 'category/scopeTree',
  categorySources: 'source/categorySources',
} as const

export interface SourceGrant {
  /** 用户选中的“整目录”CATEGORY_ID（最小集，未展开） */
  dirIds: string[]
  /** 用户选中的单个源 SOURCE_ID */
  sourceIds: string[]
}

export interface GroupSourceScope {
  accept: SourceGrant
  reject: SourceGrant
}

/** 保存回执：后端按方向回报落库结果，expandedCategoryIds 是整目录展开后的目录数 */
export interface ScopeSaveSummary {
  groupId: number
  accept: { dirIds: number; expandedCategoryIds: number; sourceIds: number }
  reject: { dirIds: number; expandedCategoryIds: number; sourceIds: number }
}

/** category/scopeTree 的扁平节点（一次给全量目录 + 源计数，替代逐层 categoryPaged） */
export interface ScopeCategoryNode {
  id: string
  name: string
  parentId: string | null
  level: number
  /** 本目录直属源数 */
  directCount: number
  /** 含全部后代的源数 */
  subtreeCount: number
  hasChildren: boolean
}

interface ScopeSourceRow {
  sourceId?: number | string
  sourceName?: string
}

const uniq = (arr: string[]): string[] => Array.from(new Set(arr.filter(Boolean)))

const asText = (v: unknown): string => (v == null ? '' : String(v))

function grantFrom(raw: unknown): SourceGrant {
  const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    dirIds: uniq(Array.isArray(rec.dirIds) ? rec.dirIds.map(asText) : []),
    sourceIds: uniq(Array.isArray(rec.sourceIds) ? rec.sourceIds.map(asText) : []),
  }
}

/** 读某组的源数据权限（后端已把 SOURCE 规则归并成 目录/单源 两类） */
export async function getGroupSourceScope(groupId: number): Promise<GroupSourceScope> {
  const data = await request<Partial<GroupSourceScope> | null>(EP.scope, { groupId }, { method: 'GET' })
  return {
    accept: grantFrom(data?.accept),
    reject: grantFrom(data?.reject),
  }
}

/** 保存某组的源数据权限：一次请求、后端一个事务重建 4 个槽 */
export async function saveGroupSourceScope(groupId: number, scope: GroupSourceScope): Promise<ScopeSaveSummary> {
  const data = await request<ScopeSaveSummary>(EP.saveScope, {
    groupId,
    accept: { dirIds: uniq(scope.accept.dirIds), sourceIds: uniq(scope.accept.sourceIds) },
    reject: { dirIds: uniq(scope.reject.dirIds), sourceIds: uniq(scope.reject.sourceIds) },
  }, { method: 'POST' })
  return data
}

/** 全量目录 + 每目录源数（一次请求）。后端按当前账号的目录权限过滤，admin 为全量。 */
export async function listScopeCategories(): Promise<ScopeCategoryNode[]> {
  const rows = await request<unknown[] | null>(EP.scopeTree, undefined, { method: 'GET' })
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const r = (row ?? {}) as Record<string, unknown>
    return {
      id: asText(r.id),
      name: asText(r.name),
      parentId: r.parentId == null || Number(r.parentId) === 0 ? null : asText(r.parentId),
      level: Number(r.level ?? 0),
      directCount: Number(r.directCount ?? 0),
      subtreeCount: Number(r.subtreeCount ?? 0),
      hasChildren: !!r.hasChildren,
    }
  })
}

/**
 * 某目录下的源（一次给全，供「全选 / 清空本目录」与每目录已选计数用）。
 *
 * `allSub=true` 时由后端展开后代目录，前端不需要自己拼 categorys 串。
 * total>list.length 说明被 limit 截断（目录太大），调用方据此提示改用整目录授权。
 */
export async function listCategorySources(
  categoryId: string,
  opts: { allSub?: boolean; keyword?: string; limit?: number } = {},
): Promise<{ total: number; list: { id: string; name: string }[] }> {
  const result = await request<{ list?: ScopeSourceRow[]; total?: number }>(EP.categorySources, {
    categoryId,
    allSub: opts.allSub === true,
    keyword: opts.keyword?.trim() || undefined,
    limit: opts.limit ?? 500,
  }, { method: 'GET' })
  const list = (Array.isArray(result?.list) ? result.list : []).map((row) => ({
    id: asText(row.sourceId),
    name: asText(row.sourceName),
  }))
  return { total: Number(result?.total ?? list.length), list }
}

/**
 * 把“整目录” ID 集合收敛成最小集：任一祖先也在集合里就丢掉子节点。
 *
 * 存量/手工配的 STRUCT 规则里存的是展开后的全量 CATEGORY_ID（remarks 没有 roots 时后端只能原样回），
 * 直接铺开会把每个后代都显示成一个已选整目录；编辑器有完整目录树，按树收敛一次即可还原用户点选层级。
 */
export function minimizeDirIds(dirIds: string[], parentIdOf: Record<string, string | null | undefined>): string[] {
  const set = new Set(uniq(dirIds))
  return [...set].filter((id) => {
    let p = parentIdOf[id]
    while (p) {
      if (set.has(p)) return false
      p = parentIdOf[p]
    }
    return true
  })
}
