// 组级「源数据权限」范围的读写 —— 系统设置 → 数据权限设置 的可见/排除范围编辑器用。
//
// 落库口径（后端 SysGroupResService.saveSourceScope 负责，前端只传用户点选的结果）：
//   · 目录 → resType=SOURCE / condType=STRUCT，后端把目录展开成「自身+全部后代 CATEGORY_ID」
//     编译成 CATEGORY_ID IN (...)，remarks 存 {roots:[...]} 供回显还原成用户点选的最小集。
//     展开必须在后端做：ID 列表长度已经不是 varchar(2000) 能装的（见 V3.5.0 迁移）。
//   · 单源   → resType=SOURCE / condType=ID，resCond=逗号 SOURCE_ID 串。
// ⚠️ cfg_category 一张表里是两套目录，取源方式不同（口径照源管理左侧，见 api/sourceDirs.ts）：
//   · 系统目录 = 源上的单个 cs_source.CATEGORY_ID；
//   · 业务目录 = 固定根 -2 下的树，成员只在 cfg_category_source_bind，一个源可进多个业务目录。
// 所以「某目录下有哪些源」一律走 sourcePaged 的 directory{kind,includeDescendants}，由后端按 kind 生成各自谓词；
// 不要用 source/categorySources（它只把 ID 塞进 CATEGORY_ID IN (...)，业务目录永远查不到源）。
// 权限读取侧也按这两套口径取并集（bee-config 的 AuthResEnum.sourceStructSql），选择器命中数与实际授权才对得上。
// 一个组本面板最多维护 4 条规则（可见/排除 × 目录/源）；其它 resType（CONFIG/ENTRY_TYPE/PARAM/CATEGORY）
// 以及 SOURCE/SQL 存量规则不归本面板管，保存时后端也不动它们。
import { request } from './client'
import { sourceApi } from './index'
import type { DirKind } from './sourceDirs'

const EP = {
  scope: 'group-res/source-scope',
  saveScope: 'group-res/modify-source-scope',
} as const

export interface SourceGrant {
  /** 用户选中的目录 CATEGORY_ID（系统目录与业务目录共用这一列，最小集、未展开） */
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

/**
 * 某目录（含全部子级）下的源，一次取到 limit 条。
 *
 * 走的是源管理左侧同一条查询口：sourcePaged 的 `directory{kind,mode:'selected',selections[].includeDescendants}`，
 * 后端按 kind 生成两套谓词（系统目录=`cs_source.CATEGORY_ID IN 目录树`，
 * 业务目录=`SOURCE_ID IN cfg_category_source_bind 与目录树的 ACTIVE 绑定`，见 SiteSourceScopeMapper.xml）。
 * 老口 source/categorySources 只把 ID 塞进 CATEGORY_ID IN (...)，业务目录取到的是空列表，别再用它。
 *
 * total>list.length 说明被 limit 截断（目录太大），调用方据此提示改为勾选该目录而不是逐条选源。
 */
export async function listDirectorySources(
  kind: DirKind,
  categoryId: string,
  opts: { keyword?: string; limit?: number } = {},
): Promise<{ total: number; list: { id: string; name: string }[] }> {
  const page = await sourceApi.sourcePaged({
    page: 1,
    size: opts.limit ?? 2000,
    ...(opts.keyword?.trim() ? { name: opts.keyword.trim() } : {}),
    directory: { kind, mode: 'selected', selections: [{ id: categoryId, includeDescendants: true }] },
  })
  const list = (page?.list ?? [])
    .map((row) => ({ id: asText(row.sourceId), name: asText(row.name) }))
    .filter((row) => row.id)
  return { total: Number(page?.total ?? list.length), list }
}
