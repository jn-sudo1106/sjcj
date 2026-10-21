// 源管理「系统目录」页签的两套目录（2026-10-21，原型：设计稿/原型设计/源管理_系统目录与业务目录_原型_2026-10-21.html）。
//
// 后端只有一张分类表，三套目录靠根节点区分：
// - 系统目录：根 parentId=0 的分类（不带 rootViewId），源上的单个 `categoryId` 指向它，按 `sourcePaged.categorys` 筛；
// - 业务目录：固定根 `-2「业务分类」` 下整棵树，源挂在「分类—源」关系表里（和视图目录同一张表），
//   一个源可以放进多个业务目录（10-21 定暂不限制）；
// - 视图目录：根 `-1` + rootViewId，只在「我的视图」里，这里两棵树都排除。
//
// 两个后端口径要记住（10-21 在 186 实测）：
// - `sourcePaged.categorys` 只匹配直属、不含子级 → 系统目录的子级由前端展开后一起传；
// - `sourcePaged.viewCategoryId` 对业务目录有效，但只认单个目录、也不含子级（传父目录得 0，传两个直接报错）
//   → 业务目录的范围由前端用 `category/listSources` 逐个取源、取并集，再按源 ID 范围查。
import { request } from './client'
import { sourceApi } from './index'
import type { SourceCategory } from './types'

export type DirKind = 'sys' | 'biz'

export const VIEW_DIR_ROOT_ID = '-1'
export const BIZ_DIR_ROOT_ID = '-2'
const RESERVED_ROOTS = new Set([VIEW_DIR_ROOT_ID, BIZ_DIR_ROOT_ID])
const CONCURRENCY = 8

/** 目录节点：比 SourceCategory 多记一个 parentId（根层为 ''），父子联动要往上找 */
export interface DirNode {
  id: string
  name: string
  parentId: string
  /** 后端回了才有：系统目录有的环境带源数，业务目录不带 */
  count?: number
}

const childrenCache = new Map<string, Promise<DirNode[]>>()
const nodeIndex = new Map<string, DirNode>()

function toNode(c: SourceCategory, parentId: string): DirNode {
  const node: DirNode = { id: c.id, name: c.name, parentId, ...(c.count != null ? { count: c.count } : {}) }
  nodeIndex.set(node.id, node)
  return node
}

/**
 * 某个目录的直属子级。parentId 为空 = 这套目录的根层：系统目录取分类表根层并排除 -1、-2，
 * 业务目录取 -2 的子级（它们挂在 -2 下面）。按 (kind, parentId) 缓存，失败不缓存。
 */
export function loadDirChildren(kind: DirKind, parentId = ''): Promise<DirNode[]> {
  const key = parentId ? parentId : `${kind}:root`
  const hit = childrenCache.get(key)
  if (hit) return hit
  const apiParent = parentId || (kind === 'biz' ? BIZ_DIR_ROOT_ID : undefined)
  const task = sourceApi.sourceCategories(apiParent)
    .then((list) => list
      .filter((c) => !(kind === 'sys' && !parentId && RESERVED_ROOTS.has(c.id)))
      .map((c) => toNode(c, parentId)))
    .catch((error: unknown) => {
      childrenCache.delete(key)
      throw error
    })
  childrenCache.set(key, task)
  return task
}

export function dirNode(id: string): DirNode | undefined {
  return nodeIndex.get(id)
}

/** 从根到这个目录的名字链（只用已加载过的节点拼） */
export function dirPath(id: string): string[] {
  const names: string[] = []
  for (let cur = nodeIndex.get(id); cur; cur = cur.parentId ? nodeIndex.get(cur.parentId) : undefined) names.unshift(cur.name)
  return names
}

/** 目录及其全部子孙 ID（逐层拉子级，带缓存；单个子级拉失败只少那一支） */
export async function expandDirIds(kind: DirKind, ids: string[]): Promise<string[]> {
  const collected = new Set(ids)
  let frontier = [...ids]
  for (let depth = 0; frontier.length && depth < 8; depth++) {
    const next: string[] = []
    for (let i = 0; i < frontier.length; i += CONCURRENCY) {
      const batch = frontier.slice(i, i + CONCURRENCY).map((id) => loadDirChildren(kind, id).catch(() => [] as DirNode[]))
      for (const children of await Promise.all(batch)) {
        for (const child of children) {
          if (collected.has(child.id)) continue
          collected.add(child.id)
          next.push(child.id)
        }
      }
    }
    frontier = next
  }
  return [...collected]
}

/** 分类搜索结果属于哪套目录：看自己 / 父级 / 祖先链里有没有 -1、-2 */
export function dirKindOf(c: { id: string; parentId?: string; path?: string }): DirKind | 'view' {
  const chain = `,${c.path ?? ''},${c.parentId ?? ''},${c.id},`
  if (chain.includes(`,${BIZ_DIR_ROOT_ID},`)) return 'biz'
  if (chain.includes(`,${VIEW_DIR_ROOT_ID},`)) return 'view'
  return 'sys'
}

/** 跨层级搜索，只留当前这套目录的（排除 -1、-2 根节点本身和视图目录） */
export async function searchDirs(kind: DirKind, keyword: string): Promise<DirNode[]> {
  const rows = await sourceApi.searchCategories(keyword)
  return rows
    .filter((c) => !RESERVED_ROOTS.has(c.id) && dirKindOf(c) === kind)
    .map((c) => {
      const parentId = c.parentId === BIZ_DIR_ROOT_ID ? '' : (c.parentId ?? '')
      return nodeIndex.get(c.id) ?? toNode(c, parentId)
    })
}

// ---------------- 业务目录里的源（分类—源关系表） ----------------

const dirSourcesCache = new Map<string, Promise<string[]>>()

/** 一个业务目录直属的源（不含子目录）。`category/listSources` 返回 `{ sourceIds, sourceGroupIds }` */
export function bizDirSourceIds(categoryId: string): Promise<string[]> {
  const hit = dirSourcesCache.get(categoryId)
  if (hit) return hit
  const task = request<unknown>('category/listSources', { categoryId }, {
    method: 'GET', mode: 'http', httpEndpoint: 'category/listSources', httpParams: { categoryId },
  }).then((result) => {
    const rec = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>
    return Array.isArray(rec.sourceIds) ? [...new Set(rec.sourceIds.map(String).filter(Boolean))] : []
  }).catch((error: unknown) => {
    dirSourcesCache.delete(categoryId)
    throw error
  })
  dirSourcesCache.set(categoryId, task)
  return task
}

/** 一组业务目录（调用方已含子级）里所有源的并集 */
export async function bizScopeSourceIds(categoryIds: string[]): Promise<string[]> {
  const union = new Set<string>()
  for (let i = 0; i < categoryIds.length; i += CONCURRENCY) {
    const batch = await Promise.all(categoryIds.slice(i, i + CONCURRENCY).map(bizDirSourceIds))
    batch.forEach((ids) => ids.forEach((id) => union.add(id)))
  }
  return [...union]
}

let membershipTask: Promise<Map<string, string[]>> | null = null

/**
 * 源 → 所在业务目录（目录 ID 列表），给源列表「业务目录」列用。没有反查接口，只能把整棵业务目录树
 * 的每个目录都 listSources 一遍（186 上约 75 个目录），会话内缓存，加入 / 移出后清掉重算。
 */
export function bizMembership(): Promise<Map<string, string[]>> {
  if (membershipTask) return membershipTask
  membershipTask = (async () => {
    const all = await expandDirIds('biz', (await loadDirChildren('biz')).map((n) => n.id))
    const map = new Map<string, string[]>()
    for (let i = 0; i < all.length; i += CONCURRENCY) {
      const ids = all.slice(i, i + CONCURRENCY)
      const lists = await Promise.all(ids.map((id) => bizDirSourceIds(id).catch(() => [] as string[])))
      lists.forEach((sources, k) => sources.forEach((sid) => map.set(sid, [...(map.get(sid) ?? []), ids[k]])))
    }
    return map
  })().catch((error: unknown) => {
    membershipTask = null
    throw error
  })
  return membershipTask
}

function invalidateBizSources(categoryIds: string[]) {
  categoryIds.forEach((id) => dirSourcesCache.delete(id))
  membershipTask = null
}

/** 把源加入一个业务目录（增量，已在里面的后端跳过）。返回后端回的新增数，没回就是 undefined */
export async function addSourcesToBizDir(categoryId: string, sourceIds: string[]): Promise<number | undefined> {
  try {
    const result = await request<unknown>('category/addSources', { categoryId, sourceIds }, {
      method: 'POST', mode: 'http', httpEndpoint: 'category/addSources',
      httpParams: { categoryId: Number(categoryId), sourceIds: sourceIds.map(Number), sourceGroupIds: [] },
    })
    return typeof result === 'number' ? result : undefined
  } finally {
    invalidateBizSources([categoryId])
  }
}

/** 从一组业务目录里移出这些源（只解除归类，不删源）。只对真有这些源的目录发请求 */
export async function removeSourcesFromBizDirs(categoryIds: string[], sourceIds: string[]): Promise<void> {
  const picked = new Set(sourceIds)
  try {
    for (const categoryId of categoryIds) {
      const inDir = (await bizDirSourceIds(categoryId)).filter((id) => picked.has(id))
      if (!inDir.length) continue
      await request<unknown>('category/delSources', { categoryId, sourceIds: inDir }, {
        method: 'POST', mode: 'http', httpEndpoint: 'category/delSources',
        httpParams: { categoryId: Number(categoryId), sourceIds: inDir.map(Number), sourceGroupIds: [] },
      })
    }
  } finally {
    invalidateBizSources(categoryIds)
  }
}

/**
 * 把源从一组业务目录移到另一个目录（10-21）。没有移动接口：**先加入目标、再从原目录移出**，
 * 中途失败最多两边都有，不会两边都没有。`toDirId` 为空 = 仅移出。失败时 error.step 标出卡在哪一步。
 */
export async function moveSourcesInBiz(fromDirIds: string[], toDirId: string | null, sourceIds: string[]): Promise<void> {
  if (toDirId) {
    try {
      await addSourcesToBizDir(toDirId, sourceIds)
    } catch (error) {
      throw Object.assign(new Error((error as Error)?.message ?? String(error)), { step: 'add' as const })
    }
  }
  try {
    await removeSourcesFromBizDirs(fromDirIds.filter((id) => id !== toDirId), sourceIds)
  } catch (error) {
    throw Object.assign(new Error((error as Error)?.message ?? String(error)), { step: 'remove' as const })
  }
}

/** 测试用：清掉模块级缓存 */
export function resetSourceDirCache() {
  childrenCache.clear()
  nodeIndex.clear()
  dirSourcesCache.clear()
  membershipTask = null
}
