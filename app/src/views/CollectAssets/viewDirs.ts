/**
 * 「我的视图」目录版的数据模型与操作（2026-10-13，方案 `设计稿/设计方案/1013-我的视图目录版_开发设计方案_2026-10-13.md`）。
 *
 * 一个视图 = 根目录 + 一棵多级目录树。根目录和每个目录都是「容器」：
 *   - `sources`：单独添加的源 ID；
 *   - `groups`：绑定的来源组 ID（组成员跟着来源组走，查询时现拉）；
 *   - `excluded`：从本容器绑定的来源组里单独移出的源（来源组本身不变，可恢复）。
 * 容器自己的源 = sources ∪（groups 的成员 − excluded）；目录看到的源 = 自己的 ∪ 子孙目录的（父目录汇总）；
 * 「全部」= 根目录 ∪ 所有目录。同一个源可以出现在多个容器里。
 *
 * 全部是纯函数：入参不改，返回新树。存储见 api/sourceViews.ts（整棵树存进 queryJson）。
 */

export const ROOT_ID = 'root'
export const VIEW_DIR_NAME_MAX = 40
/** 每个视图单独添加的源 ID 总数上限（来源组成员不占额度）。≈ 60KB，后端 queryJson 上限需 ≥ 128KB */
export const VIEW_SOURCE_LIMIT = 5000

export interface ViewContainer {
  sources: string[]
  groups: string[]
  excluded: string[]
}
export interface ViewDir extends ViewContainer {
  id: string
  name: string
  /** null = 挂在根目录下的一级目录 */
  parentId: string | null
  sortNo: number
}
export interface ViewTree {
  v: 2
  root: ViewContainer
  dirs: ViewDir[]
  /** 从 1012 的「条件视图」转过来的：条件没法变成源清单，提示用户重新添加；第一次修改后清掉 */
  convertedFromCondition?: boolean
}
/** 来源组 ID → 当前成员源 ID */
export type GroupMembers = Record<string, string[]>

const emptyContainer = (): ViewContainer => ({ sources: [], groups: [], excluded: [] })
export const emptyTree = (): ViewTree => ({ v: 2, root: emptyContainer(), dirs: [] })

const uniq = (ids: string[]) => [...new Set(ids.filter(Boolean).map(String))]
const strings = (value: unknown) => (Array.isArray(value) ? uniq(value.map(String)) : [])

/** 后端存的 JSON 读回来做一次清洗：字段缺了补空、重复去掉、悬空的 parentId 挂回根下 */
export function normalizeTree(raw: unknown): ViewTree {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const container = (value: unknown): ViewContainer => {
    const c = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
    return { sources: strings(c.sources), groups: strings(c.groups), excluded: strings(c.excluded) }
  }
  const rawDirs = Array.isArray(obj.dirs) ? (obj.dirs as Record<string, unknown>[]) : []
  const dirs: ViewDir[] = rawDirs
    .filter((d) => d && typeof d.id === 'string' && d.id && typeof d.name === 'string')
    .map((d, i) => ({ ...container(d), id: String(d.id), name: String(d.name), parentId: d.parentId == null ? null : String(d.parentId), sortNo: Number(d.sortNo ?? i) }))
  const ids = new Set(dirs.map((d) => d.id))
  for (const d of dirs) if (d.parentId && (!ids.has(d.parentId) || d.parentId === d.id)) d.parentId = null
  return { v: 2, root: container(obj.root), dirs, ...(obj.convertedFromCondition ? { convertedFromCondition: true } : {}) }
}

/**
 * 1012 版（v1）视图转过来：手选清单 → 根目录的单独添加源；条件视图（scopeIds 为 null）→ 空树并打标记提示用户。
 * 10-13 定：条件视图不再保留。
 */
export function treeFromLegacy(query: Record<string, unknown>): ViewTree {
  const scope = query.scopeIds
  if (Array.isArray(scope)) return { ...emptyTree(), root: { ...emptyContainer(), sources: strings(scope) } }
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
export function containerOf(tree: ViewTree, id: string): ViewContainer | undefined {
  return id === ROOT_ID ? tree.root : dirById(tree, id)
}
/** 目录和它所有子孙目录的 ID（自上而下） */
export function descendantIds(tree: ViewTree, id: string): string[] {
  const out = [id]
  for (let i = 0; i < out.length; i++) for (const c of childrenOf(tree, out[i])) out.push(c.id)
  return out
}
/** 看到的范围涉及的容器：根 = 整个视图；目录 = 它和子孙 */
export function scopeContainers(tree: ViewTree, id: string): ViewContainer[] {
  if (id === ROOT_ID) return [tree.root, ...tree.dirs]
  return descendantIds(tree, id).map((d) => dirById(tree, d)).filter((d): d is ViewDir => !!d)
}
export function pathOf(tree: ViewTree, id: string): ViewDir[] {
  const out: ViewDir[] = []
  let cur = dirById(tree, id)
  while (cur) { out.unshift(cur); cur = cur.parentId ? dirById(tree, cur.parentId) : undefined }
  return out
}
export const pathText = (tree: ViewTree, id: string) => (id === ROOT_ID ? '根目录' : pathOf(tree, id).map((d) => d.name).join(' / '))

/** 容器自己的源 */
export function ownIds(c: ViewContainer, members: GroupMembers): string[] {
  const ex = new Set(c.excluded)
  return uniq([...c.sources, ...c.groups.flatMap((g) => members[g] ?? []).filter((id) => !ex.has(id))])
}
/** 选中目录（或根）看到的全部源：父目录汇总子目录 */
export function resolveIds(tree: ViewTree, id: string, members: GroupMembers): string[] {
  return uniq(scopeContainers(tree, id).flatMap((c) => ownIds(c, members)))
}
/** 视图里绑定过的全部来源组（拉成员用） */
export function boundGroups(tree: ViewTree): string[] {
  return uniq([tree.root, ...tree.dirs].flatMap((c) => c.groups))
}
/** 视图里单独添加的源 ID 总数（同一个源在多个目录里各算一次，按存储体积算） */
export function directCount(tree: ViewTree): number {
  return [tree.root, ...tree.dirs].reduce((n, c) => n + c.sources.length + c.excluded.length, 0)
}

/** 源在视图里的位置：「宏观 / 统计局」「舆情（来源组 twitter1）」 */
export function placesOf(tree: ViewTree, srcId: string, members: GroupMembers, groupName: (id: string) => string): string[] {
  const out: string[] = []
  for (const [id, c] of [[ROOT_ID, tree.root] as const, ...tree.dirs.map((d) => [d.id, d] as const)]) {
    if (c.sources.includes(srcId)) out.push(pathText(tree, id))
    if (!c.excluded.includes(srcId)) for (const g of c.groups) if ((members[g] ?? []).includes(srcId)) out.push(`${pathText(tree, id)}（来源组 ${groupName(g)}）`)
  }
  return out
}
/** 在当前范围里只是随来源组带进来的（没有单独添加）：返回来源组 ID，否则 null */
export function onlyViaGroup(tree: ViewTree, id: string, srcId: string, members: GroupMembers): string | null {
  const scope = scopeContainers(tree, id)
  if (scope.some((c) => c.sources.includes(srcId))) return null
  for (const c of scope) {
    if (c.excluded.includes(srcId)) continue
    const g = c.groups.find((x) => (members[x] ?? []).includes(srcId))
    if (g) return g
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// 修改（都返回新树）
// ---------------------------------------------------------------------------------------------

const clone = (tree: ViewTree): ViewTree => JSON.parse(JSON.stringify(tree)) as ViewTree
/** 改过一次就不再提示「从条件视图转来」 */
const touched = (tree: ViewTree): ViewTree => { const t = clone(tree); delete t.convertedFromCondition; return t }
function mutate(tree: ViewTree, id: string, fn: (c: ViewContainer, t: ViewTree) => void): ViewTree {
  const t = touched(tree)
  const c = containerOf(t, id)
  if (!c) throw new Error('目录已被删除，请刷新后重试')
  fn(c, t)
  return t
}

function checkName(tree: ViewTree, parentId: string | null, name: string, selfId?: string): string {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > VIEW_DIR_NAME_MAX) throw new Error(`目录名称为1到${VIEW_DIR_NAME_MAX}个字符`)
  if (childrenOf(tree, parentId).some((d) => d.id !== selfId && d.name === trimmed)) throw new Error('同级已有同名目录')
  return trimmed
}
const newDirId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** 新建目录：parentId 为 ROOT_ID / null 时建在根下 */
export function addDir(tree: ViewTree, parentId: string | null, name: string): { tree: ViewTree; id: string } {
  const parent = parentId === ROOT_ID ? null : parentId
  if (parent && !dirById(tree, parent)) throw new Error('上级目录已被删除，请刷新后重试')
  const t = touched(tree)
  const id = newDirId()
  const siblings = childrenOf(t, parent)
  t.dirs.push({ id, name: checkName(t, parent, name), parentId: parent, sortNo: siblings.length ? Math.max(...siblings.map((d) => d.sortNo)) + 1 : 0, ...emptyContainer() })
  return { tree: t, id }
}
export function renameDir(tree: ViewTree, id: string, name: string): ViewTree {
  const d = dirById(tree, id)
  if (!d) throw new Error('目录已被删除，请刷新后重试')
  const trimmed = checkName(tree, d.parentId, name, id)
  return mutate(tree, id, (c) => { (c as ViewDir).name = trimmed })
}
/** 删除目录连同子孙目录；目录里的源只是不在这个视图里了，源本身不受影响 */
export function deleteDir(tree: ViewTree, id: string): ViewTree {
  const drop = new Set(descendantIds(tree, id))
  const t = touched(tree)
  t.dirs = t.dirs.filter((d) => !drop.has(d.id))
  return t
}

function checkLimit(tree: ViewTree) {
  if (directCount(tree) > VIEW_SOURCE_LIMIT) throw new Error(`每个视图最多单独添加 ${VIEW_SOURCE_LIMIT} 个源，来源组里的源不算在内；源很多时建议用来源组`)
}
/** 往容器里加源（已在的忽略；之前从来源组排除过的同时恢复） */
export function addSources(tree: ViewTree, id: string, ids: string[]): ViewTree {
  const t = mutate(tree, id, (c) => {
    c.sources = uniq([...c.sources, ...ids])
    c.excluded = c.excluded.filter((x) => !ids.includes(x))
  })
  checkLimit(t)
  return t
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

function dropFrom(c: ViewContainer, srcId: string, members: GroupMembers) {
  c.sources = c.sources.filter((s) => s !== srcId)
  if (c.groups.some((g) => (members[g] ?? []).includes(srcId)) && !c.excluded.includes(srcId)) c.excluded.push(srcId)
}
/**
 * 从当前范围移出：单独添加的直接删，随来源组带入的记进 excluded。
 * 根（「全部」）= 从整个视图移出；目录 = 从它和子孙目录移出（看到什么移什么）。
 */
export function removeSources(tree: ViewTree, id: string, ids: string[], members: GroupMembers): ViewTree {
  const t = touched(tree)
  for (const c of scopeContainers(t, id)) for (const s of ids) dropFrom(c, s, members)
  return t
}
/** 移到目录：在根（「全部」）里是加进目标目录、原来的位置保留；在某个目录里是从这里移走再加进目标 */
export function moveSources(tree: ViewTree, fromId: string, toId: string, ids: string[], members: GroupMembers): ViewTree {
  if (fromId === toId) return tree
  const t = fromId === ROOT_ID ? touched(tree) : removeSources(tree, fromId, ids, members)
  return addSources(t, toId, ids)
}
