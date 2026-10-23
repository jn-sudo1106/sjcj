/**
 * 「我的视图」目录版的数据模型与操作（2026-10-13 方案 `设计稿/设计方案/1013-我的视图目录版_开发设计方案_2026-10-13.md`，
 * 10-14 按后端接口调整，见 `1014-我的视图目录版_接口变更核对与疑问_2026-10-14.md`）。
 *
 * 一个视图 = 一棵多级目录树（10-14 定：**没有根目录**，源只能放在目录里）。每个目录是一个「容器」：
 *   - `sources`：单独添加的源 ID；
 *   - `groups`：绑定的来源组 ID（组成员跟着来源组走，查询时现拉）；
 *   - `excluded`：从本目录绑定的来源组里单独移出的源（来源组本身不变，可恢复）；
 *   - `rows`（仅真实接口）：后端目录里实际有的源行（`listSources` 的 sourceIds）。
 * 目录看到的源 = sources ∪（groups 的成员 − excluded）。10-14 定：**父目录暂时不汇总子目录**。
 *
 * 1016：后端绑定来源组时只把组**当时**的成员展开成源行（快照），组里之后新加的源不会自动进目录。
 * 所以有 `rows` 时，来源组成员只算已在 rows 里的；不在的就是「未在视图」（missingOf），由用户勾选后加入。
 * 本机兜底没有 rows，组成员照旧现拉、全部算在视图里。
 * 同一个源可以出现在多个目录里。
 *
 * 全部是纯函数：入参不改，返回新树。存储见 api/sourceViews.ts。
 */

export const VIEW_DIR_NAME_MAX = 40
/** 每个目录单独添加的源 ID 上限（来源组成员不占额度）；changeSources 是整份覆盖，每次传完整清单 */
export const VIEW_SOURCE_LIMIT = 5000

export interface ViewContainer {
  sources: string[]
  groups: string[]
  excluded: string[]
  /** 后端目录里实际有的源行（含来源组展开的快照）；本机兜底没有 */
  rows?: string[]
}
export interface ViewDir extends ViewContainer {
  id: string
  name: string
  /** null = 一级目录 */
  parentId: string | null
  sortNo: number
}
export interface ViewTree {
  v: 2
  dirs: ViewDir[]
  /** 从 1012 的「条件视图」转过来的：条件没法变成源清单，提示用户重新添加；第一次修改后清掉 */
  convertedFromCondition?: boolean
}
/** 来源组 ID → 当前成员源 ID */
export type GroupMembers = Record<string, string[]>

const emptyContainer = (): ViewContainer => ({ sources: [], groups: [], excluded: [] })
export const emptyTree = (): ViewTree => ({ v: 2, dirs: [] })

const uniq = (ids: string[]) => [...new Set(ids.filter(Boolean).map(String))]
const strings = (value: unknown) => (Array.isArray(value) ? uniq(value.map(String)) : [])
const newDirId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
/** 本机存的旧数据里根目录上的源 / 来源组，10-14 起没有根目录了，转成一个一级目录 */
const LEGACY_ROOT_NAME = '未归类'

/** 存的 JSON 读回来做一次清洗：字段缺了补空、重复去掉、悬空的 parentId 挂回一级 */
export function normalizeTree(raw: unknown): ViewTree {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const container = (value: unknown): ViewContainer => {
    const c = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
    return { sources: strings(c.sources), groups: strings(c.groups), excluded: strings(c.excluded), ...(Array.isArray(c.rows) ? { rows: strings(c.rows) } : {}) }
  }
  const rawDirs = Array.isArray(obj.dirs) ? (obj.dirs as Record<string, unknown>[]) : []
  const dirs: ViewDir[] = rawDirs
    .filter((d) => d && d.id != null && d.id !== '' && typeof d.name === 'string')
    .map((d, i) => ({ ...container(d), id: String(d.id), name: String(d.name), parentId: d.parentId == null ? null : String(d.parentId), sortNo: Number(d.sortNo ?? i) }))
  const ids = new Set(dirs.map((d) => d.id))
  for (const d of dirs) if (d.parentId && (!ids.has(d.parentId) || d.parentId === d.id)) d.parentId = null
  const root = container(obj.root)
  if (root.sources.length || root.groups.length) {
    const top = dirs.filter((d) => d.parentId === null)
    let name = LEGACY_ROOT_NAME
    while (top.some((d) => d.name === name)) name += '（旧）'
    dirs.push({ ...root, id: 'legacy-root', name, parentId: null, sortNo: top.length ? Math.max(...top.map((d) => d.sortNo)) + 1 : 0 })
  }
  return { v: 2, dirs, ...(obj.convertedFromCondition ? { convertedFromCondition: true } : {}) }
}

/**
 * 1012 版（v1）视图转过来：手选清单 → 一级目录「未归类」；条件视图（scopeIds 为 null）→ 空树并打标记提示用户。
 * 10-13 定：条件视图不再保留。
 */
export function treeFromLegacy(query: Record<string, unknown>): ViewTree {
  const scope = query.scopeIds
  if (Array.isArray(scope)) return normalizeTree({ root: { sources: scope } })
  return { ...emptyTree(), convertedFromCondition: true }
}

// ---------------------------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------------------------

export function childrenOf(tree: ViewTree, parentId: string | null): ViewDir[] {
  return tree.dirs.filter((d) => d.parentId === parentId).sort((a, b) => a.sortNo - b.sortNo)
}
export function dirById(tree: ViewTree, id: string): ViewDir | undefined {
  return tree.dirs.find((d) => d.id === id)
}
/** 目录和它所有子孙目录的 ID（自上而下） */
export function descendantIds(tree: ViewTree, id: string): string[] {
  const out = [id]
  for (let i = 0; i < out.length; i++) for (const c of childrenOf(tree, out[i])) out.push(c.id)
  return out
}
export function pathOf(tree: ViewTree, id: string): ViewDir[] {
  const out: ViewDir[] = []
  let cur = dirById(tree, id)
  while (cur) { out.unshift(cur); cur = cur.parentId ? dirById(tree, cur.parentId) : undefined }
  return out
}
export const pathText = (tree: ViewTree, id: string) => pathOf(tree, id).map((d) => d.name).join(' / ')

/** 来源组成员里真正在这个目录里的：有 rows（真实接口）时只算已展开成源行的，没有时全部算 */
export function groupIdsIn(c: ViewContainer, groupId: string, members: GroupMembers): string[] {
  const all = members[groupId] ?? []
  if (!c.rows) return all
  const rows = new Set(c.rows)
  return all.filter((id) => rows.has(id))
}
/** 容器自己的源 */
export function ownIds(c: ViewContainer, members: GroupMembers): string[] {
  const ex = new Set(c.excluded)
  return uniq([...c.sources, ...c.groups.flatMap((g) => groupIdsIn(c, g, members)).filter((id) => !ex.has(id))])
}
/**
 * 绑定来源组里「未在视图」的源（1016）：组的当前成员 − 目录源行 − 单独添加的 − 排除的。
 * 只有真实接口（有 rows）才有；按来源组分开返回，没有缺的组不返回。
 */
export function missingOf(c: ViewContainer, members: GroupMembers): { groupId: string; ids: string[] }[] {
  if (!c.rows) return []
  const known = new Set([...c.rows, ...c.sources, ...c.excluded])
  return c.groups
    .map((groupId) => ({ groupId, ids: uniq((members[groupId] ?? []).filter((id) => !known.has(id))) }))
    .filter((m) => m.ids.length)
}
/** 选中目录看到的源（10-14 定：不汇总子目录） */
export function resolveIds(tree: ViewTree, id: string, members: GroupMembers): string[] {
  const d = dirById(tree, id)
  return d ? ownIds(d, members) : []
}
/** 整个视图里的源（去重） */
export function allIds(tree: ViewTree, members: GroupMembers): string[] {
  return uniq(tree.dirs.flatMap((d) => ownIds(d, members)))
}
/** 视图里绑定过的全部来源组（拉成员用） */
export function boundGroups(tree: ViewTree): string[] {
  return uniq(tree.dirs.flatMap((c) => c.groups))
}

/** 源在视图里的位置：「宏观 / 统计局」「舆情（来源组 twitter1）」 */
export function placesOf(tree: ViewTree, srcId: string, members: GroupMembers, groupName: (id: string) => string): string[] {
  const out: string[] = []
  for (const d of tree.dirs) {
    if (d.sources.includes(srcId)) out.push(pathText(tree, d.id))
    if (!d.excluded.includes(srcId)) for (const g of d.groups) if (groupIdsIn(d, g, members).includes(srcId)) out.push(`${pathText(tree, d.id)}（来源组 ${groupName(g)}）`)
  }
  return out
}
/** 在这个目录里只是随来源组带进来的（没有单独添加）：返回来源组 ID，否则 null */
export function onlyViaGroup(tree: ViewTree, id: string, srcId: string, members: GroupMembers): string | null {
  const d = dirById(tree, id)
  if (!d || d.sources.includes(srcId) || d.excluded.includes(srcId)) return null
  return d.groups.find((g) => groupIdsIn(d, g, members).includes(srcId)) ?? null
}

// ---------------------------------------------------------------------------------------------
// 修改（都返回新树）
// ---------------------------------------------------------------------------------------------

const clone = (tree: ViewTree): ViewTree => JSON.parse(JSON.stringify(tree)) as ViewTree
/** 改过一次就不再提示「从条件视图转来」 */
const touched = (tree: ViewTree): ViewTree => { const t = clone(tree); delete t.convertedFromCondition; return t }
function mutate(tree: ViewTree, id: string, fn: (d: ViewDir) => void): ViewTree {
  const t = touched(tree)
  const d = dirById(t, id)
  if (!d) throw new Error('目录已被删除，请刷新后重试')
  fn(d)
  return t
}

function checkName(tree: ViewTree, parentId: string | null, name: string, selfId?: string): string {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > VIEW_DIR_NAME_MAX) throw new Error(`目录名称为1到${VIEW_DIR_NAME_MAX}个字符`)
  if (childrenOf(tree, parentId).some((d) => d.id !== selfId && d.name === trimmed)) throw new Error('同级已有同名目录')
  return trimmed
}

/** 新建目录：parentId 为 null 时建成一级目录 */
export function addDir(tree: ViewTree, parentId: string | null, name: string): { tree: ViewTree; id: string } {
  if (parentId && !dirById(tree, parentId)) throw new Error('上级目录已被删除，请刷新后重试')
  const t = touched(tree)
  const id = newDirId()
  const siblings = childrenOf(t, parentId)
  t.dirs.push({ id, name: checkName(t, parentId, name), parentId, sortNo: siblings.length ? Math.max(...siblings.map((d) => d.sortNo)) + 1 : 0, ...emptyContainer() })
  return { tree: t, id }
}
export function renameDir(tree: ViewTree, id: string, name: string): ViewTree {
  const d = dirById(tree, id)
  if (!d) throw new Error('目录已被删除，请刷新后重试')
  const trimmed = checkName(tree, d.parentId, name, id)
  return mutate(tree, id, (c) => { c.name = trimmed })
}
/** 删除目录连同子孙目录；目录里的源只是不在这个视图里了，源本身不受影响 */
export function deleteDir(tree: ViewTree, id: string): ViewTree {
  const drop = new Set(descendantIds(tree, id))
  const t = touched(tree)
  t.dirs = t.dirs.filter((d) => !drop.has(d.id))
  return t
}

/** 往目录里加源（已在的忽略；之前从来源组排除过的同时恢复） */
export function addSources(tree: ViewTree, id: string, ids: string[]): ViewTree {
  return mutate(tree, id, (c) => {
    c.sources = uniq([...c.sources, ...ids])
    c.excluded = c.excluded.filter((x) => !ids.includes(x))
    if (c.sources.length > VIEW_SOURCE_LIMIT) throw new Error(`每个目录最多单独添加 ${VIEW_SOURCE_LIMIT} 个源，来源组里的源不算在内；源很多时建议用来源组`)
  })
}
export function bindGroup(tree: ViewTree, id: string, groupId: string): ViewTree {
  return mutate(tree, id, (c) => { if (!c.groups.includes(groupId)) c.groups.push(groupId) })
}
/** 解绑来源组；只属于这个组的排除记录一并清掉 */
export function unbindGroup(tree: ViewTree, id: string, groupId: string, members: GroupMembers): ViewTree {
  return mutate(tree, id, (c) => {
    c.groups = c.groups.filter((g) => g !== groupId)
    c.excluded = c.excluded.filter((x) => c.groups.some((g) => (members[g] ?? []).includes(x)))
  })
}
export function restoreExcluded(tree: ViewTree, id: string): ViewTree {
  return mutate(tree, id, (c) => { c.excluded = [] })
}

/** 从目录移出：单独添加的直接删，随来源组带入的记进 excluded */
export function removeSources(tree: ViewTree, id: string, ids: string[], members: GroupMembers): ViewTree {
  return mutate(tree, id, (c) => {
    for (const s of ids) {
      c.sources = c.sources.filter((x) => x !== s)
      if (c.groups.some((g) => (members[g] ?? []).includes(s)) && !c.excluded.includes(s)) c.excluded.push(s)
    }
  })
}
/** 移到目录：从这里移走再加进目标 */
export function moveSources(tree: ViewTree, fromId: string, toId: string, ids: string[], members: GroupMembers): ViewTree {
  if (fromId === toId) return tree
  return addSources(removeSources(tree, fromId, ids, members), toId, ids)
}
