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
import { flowCenterApi, sourceApi, workflowBindingApi } from './index'
import type { Source, SourceCategory, SourceFlowsView } from './types'

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

// 列表只带系统目录 ID 时，复用精确分类查询补齐祖先；同一目录 / 父级不重复请求。
const pathTasks = new Map<string, Promise<string[]>>()
export function loadDirPath(id: string): Promise<string[]> {
  const cached = pathTasks.get(id)
  if (cached) return cached
  const task = (async () => {
    let node = nodeIndex.get(id)
    if (!node) {
      const category = await sourceApi.categoryById(id)
      if (!category) throw new Error(`系统目录 #${id} 不存在`)
      node = toNode(category, category.parentId && category.parentId !== '0' ? category.parentId : '')
    }
    return [...(node.parentId ? await loadDirPath(node.parentId) : []), node.name]
  })().catch((error: unknown) => {
    pathTasks.delete(id)
    throw error
  })
  pathTasks.set(id, task)
  return task
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
      const lists = await Promise.all(ids.map(bizDirSourceIds))
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

export interface TemplateImportResult {
  added: string[]
  skipped: number
  /** 这一行连源都没建出来 */
  failed: string[]
  /** 源建出来了，但归网站 / 挂流程 / 进目录有一步没成：要手动补 */
  partial: string[]
}

/**
 * 业务目录「按模板批量新增」（10-22）：一行一条「源名称;URL」，每行按模板源复制一个源。
 * 复用模板源的配置和流程（共用同一条流程，不另复制），归入模板源的网站，最后统一加入业务目录 `dirId`。
 * 逐行执行，某行失败不影响其他行；源已建出但后续步骤失败的不回滚（回滚等于删源），记进 partial。
 */
export async function importFromTemplateToBizDir(template: Source, lines: string, dirId: string): Promise<TemplateImportResult> {
  const result: TemplateImportResult = { added: [], skipped: 0, failed: [], partial: [] }
  const tplFlows = await workflowBindingApi.view(template.sourceId)
  const siteId = template.siteId && template.siteId !== '0' ? template.siteId : ''
  for (const row of lines.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    // 只按第一个分号切：URL 里可能自带分号
    const sep = row.search(/[;；]/)
    const name = (sep < 0 ? row : row.slice(0, sep)).trim()
    const url = sep < 0 ? '' : row.slice(sep + 1).trim()
    if (!name) { result.skipped++; continue }
    let copied: Awaited<ReturnType<typeof sourceApi.copySourceAndLocate>>
    try {
      // flag=0：仅制作源副本，复用模板源的配置；URL 留空时沿用模板源的
      copied = await sourceApi.copySourceAndLocate({ sourceId: template.sourceId, name, url: url || template.url, flag: 0 })
    } catch (error) {
      result.failed.push(`${name}（${(error as Error)?.message ?? String(error)}）`)
      continue
    }
    if (!copied.ok) { result.failed.push(`${name}（${copied.message}）`); continue }
    const id = copied.sourceId
    result.added.push(id)
    // copySource 实测（186，10-22）会连网站、配置、系统目录、流程绑定一起复制；这里只兜底，不一致才补写
    const misses: string[] = []
    try {
      const created = await sourceApi.sourceDetail(id)
      if (siteId && created?.siteId !== siteId) {
        const bind = await sourceApi.changeSite([id], siteId)
        if (!bind.ok) misses.push('归入网站')
      }
    } catch {
      misses.push('归入网站')
    }
    try {
      const view = await workflowBindingApi.view(id)
      if (!sameFlows(view, tplFlows)) {
        await workflowBindingApi.save(id, () => ({ flowIds: tplFlows.ownFlowIds, defaultFlowId: tplFlows.ownDefaultFlowId ?? null }))
      }
    } catch {
      misses.push('关联流程')
    }
    if (misses.length) result.partial.push(`#${id} ${name}（${misses.join('、')}失败）`)
  }
  if (result.added.length) {
    try {
      await addSourcesToBizDir(dirId, result.added)
    } catch (error) {
      result.partial.push(`${result.added.length} 个新源加入业务目录失败（${(error as Error)?.message ?? String(error)}），新源 ID：${result.added.join(',')}`)
    }
  }
  return result
}

// ---------------- 业务目录里的表（数据查询左栏「业务目录」页签，10-28） ----------------
// 口径（10-28 孙总确认）：目录下的表 = 目录直属源涉及的输出表 = 源的主表 ∪ 源所用流程各节点的输出表（outEntry）。
// 后端没有「目录 → 表」接口，表上也没有目录字段（entryTypePagedView 只有 groupId，不是目录），只能这样拼：
// listSources → sourcePaged 按源 ID 取 flowId / 主表（POST body，不怕 ID 多）→ 按流程去重查节点。
// 流程通常被大量源共用（公众号 6028 个源共 1 个流程），按流程缓存后跨目录复用。

const SOURCE_BATCH = 500
const FLOW_CONCURRENCY = 4
const dirTablesCache = new Map<string, Promise<BizDirTables>>()

export interface BizDirTables {
  tableIds: string[]
  /** 节点没查回来的流程（186 上有流程报「请先进入流程草稿编辑」）：用这些流程的源只统计了主表 */
  failedFlowIds: string[]
}
const flowOutputCache = new Map<string, Promise<string[]>>()

/** 空 / '0' 都不是真实的表或流程（后端对"没设"有时给 0） */
function realId(id: unknown): string {
  const value = String(id ?? '').trim()
  return value && value !== '0' ? value : ''
}

function flowOutputTables(flowId: string): Promise<string[]> {
  const hit = flowOutputCache.get(flowId)
  if (hit) return hit
  const task = flowCenterApi.steps(flowId, { withConfigDetails: false })
    .then((steps) => [...new Set(steps.map((s) => realId(s.outputTable)).filter(Boolean))])
    .catch((error: unknown) => {
      flowOutputCache.delete(flowId)
      throw error
    })
  flowOutputCache.set(flowId, task)
  return task
}

/** 一个业务目录直属源涉及的输出表 ID（不含子目录）。按目录缓存；取源失败整体报错不缓存，单个流程失败只记下来 */
export function bizDirTables(categoryId: string): Promise<BizDirTables> {
  const hit = dirTablesCache.get(categoryId)
  if (hit) return hit
  const task = (async () => {
    const sourceIds = await bizDirSourceIds(categoryId)
    const tables = new Set<string>()
    const flowIds = new Set<string>()
    for (let i = 0; i < sourceIds.length; i += SOURCE_BATCH) {
      const ids = sourceIds.slice(i, i + SOURCE_BATCH)
      const page = await sourceApi.sourcePaged({ sourceIds: ids, page: 1, size: ids.length })
      for (const source of page.list) {
        const main = realId(source.mainTable)
        const flowId = realId(source.flowId)
        if (main) tables.add(main)
        if (flowId) flowIds.add(flowId)
      }
    }
    const flows = [...flowIds]
    const failedFlowIds: string[] = []
    for (let i = 0; i < flows.length; i += FLOW_CONCURRENCY) {
      const batch = flows.slice(i, i + FLOW_CONCURRENCY)
      const results = await Promise.allSettled(batch.map(flowOutputTables))
      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') result.value.forEach((id) => tables.add(id))
        else failedFlowIds.push(batch[idx]!)
      })
    }
    return { tableIds: [...tables], failedFlowIds }
  })().catch((error: unknown) => {
    dirTablesCache.delete(categoryId)
    throw error
  })
  dirTablesCache.set(categoryId, task)
  return task
}

function sameFlows(a: SourceFlowsView, b: SourceFlowsView) {
  return (a.ownDefaultFlowId ?? '') === (b.ownDefaultFlowId ?? '')
    && a.ownFlowIds.length === b.ownFlowIds.length
    && a.ownFlowIds.every((id) => b.ownFlowIds.includes(id))
}

/** 测试用：清掉模块级缓存 */
export function resetSourceDirCache() {
  childrenCache.clear()
  nodeIndex.clear()
  dirSourcesCache.clear()
  membershipTask = null
  pathTasks.clear()
  dirTablesCache.clear()
  flowOutputCache.clear()
}
