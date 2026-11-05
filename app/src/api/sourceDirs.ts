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
import { flowCenterApi, sourceApi, sourceGroupApi, workflowBindingApi } from './index'
import type { Source, SourceCategory, SourceFlowsView } from './types'
import { drainQueue } from '@/utils/concurrency'

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
  const queue = [...ids]
  // 连续保持 CONCURRENCY 个请求在途，子级一回来就入队，不按层、按批等最慢的那个。
  // 10-28 在 186 实测全选系统目录（2053 个目录，绝大多数是叶子）：逐层分批 27s → 连续并发 17s。
  // 父子成环由 collected 去重拦住。
  await new Promise<void>((resolve) => {
    let active = 0
    const pump = () => {
      while (active < CONCURRENCY && queue.length) {
        const id = queue.shift()!
        active++
        void loadDirChildren(kind, id).catch(() => [] as DirNode[]).then((children) => {
          for (const child of children) {
            if (collected.has(child.id)) continue
            collected.add(child.id)
            queue.push(child.id)
          }
          active--
          pump()
        })
      }
      if (!active && !queue.length) resolve()
    }
    pump()
  })
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

/** 业务目录树规模 / 枚举并发：比 CONCURRENCY=8 低，别把浏览器每域 6 条连接占满 */
const MEMBERSHIP_CONCURRENCY = 3

interface ScopeTreeRow {
  id: string
  name: string
  parentId: string
}

/**
 * `category/scopeTree`：全量目录 + 每目录源数，一次请求给扁平的 `{ id, name, parentId, ... }`。
 * 2026-10-30 为数据权限范围选择器加的接口，源管理这边也用它：
 * 拿不到（老环境没这个接口 / 无权限 / 返回格式不认识）返回 null，由调用方退回逐层展开。
 */
async function readScopeTree(): Promise<ScopeTreeRow[] | null> {
  let result: unknown
  try {
    result = await request<unknown>('category/scopeTree', undefined, { method: 'GET', mode: 'http' })
  } catch {
    return null
  }
  const rows: unknown[] | null = Array.isArray(result)
    ? result
    : (result && typeof result === 'object' && Array.isArray((result as { list?: unknown }).list)
      ? (result as { list: unknown[] }).list
      : null)
  if (!rows) return null
  const parsed: ScopeTreeRow[] = []
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const rec = raw as Record<string, unknown>
    const id = rec.id == null ? '' : String(rec.id)
    const name = rec.name == null ? '' : String(rec.name)
    if (!id || !name) continue
    parsed.push({ id, name, parentId: rec.parentId == null ? '' : String(rec.parentId) })
  }
  return parsed
}

let bizTreeTask: Promise<string[]> | null = null

/** 业务目录整棵树（含子级）的目录 ID，一次拿全；注册进 nodeIndex 让「业务目录」列能拼出路径 */
async function bizTreeIdsViaScopeTree(): Promise<string[] | null> {
  const rows = await readScopeTree()
  if (!rows || !rows.length) return null
  const children = new Map<string, ScopeTreeRow[]>()
  for (const row of rows) {
    const bucket = children.get(row.parentId)
    if (bucket) bucket.push(row)
    else children.set(row.parentId, [row])
  }
  // 认不出 -2 这棵树就说明口径不对，交给逐层展开兜底
  if (!children.has(BIZ_DIR_ROOT_ID)) return null
  const ids: string[] = []
  const seen = new Set<string>([BIZ_DIR_ROOT_ID])
  const queue = [BIZ_DIR_ROOT_ID]
  while (queue.length) {
    const parent = queue.shift()!
    for (const child of children.get(parent) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      ids.push(child.id)
      // -2 的直接子级在这套目录里是根层（parentId 记 ''），和 loadDirChildren('biz') 的口径对齐
      toNode({ id: child.id, name: child.name }, child.parentId === BIZ_DIR_ROOT_ID ? '' : child.parentId)
      queue.push(child.id)
    }
  }
  return ids.length ? ids : null
}

/**
 * 退回逐层展开时用低并发（MEMBERSHIP_CONCURRENCY=3，不是 expandDirIds 的 8）：
 * 这一步正在和左侧目录树、列表、翻页抢同一批浏览器连接，慢一点没关系，别把别人挤死。
 */
async function expandBizTreeIds(): Promise<string[]> {
  const collected = new Set((await loadDirChildren('biz')).map((n) => n.id))
  const queue = [...collected]
  for (let i = 0; i < queue.length; i += MEMBERSHIP_CONCURRENCY) {
    const batch = queue.slice(i, i + MEMBERSHIP_CONCURRENCY)
    const children = await Promise.all(batch.map((id) => loadDirChildren('biz', id).catch(() => [] as DirNode[])))
    for (const list of children) {
      for (const child of list) {
        if (collected.has(child.id)) continue
        collected.add(child.id)
        queue.push(child.id)
      }
    }
  }
  return [...collected]
}

/**
 * 业务目录整棵树的目录 ID。
 *
 * 早先是 `expandDirIds` 逐层拉子级：186 上业务目录 108 个 → 108 个 categoryPaged。这一步和后面
 * 每个目录一次 listSources 一起发，11-05 在生产实测直接打满浏览器连接，左侧目录树、首屏列表、
 * 翻页全被排队（用户看到的「疯狂加载」）。现在优先 scopeTree 一次拿全，失败才退回逐层展开。
 */
function resolveBizTreeIds(): Promise<string[]> {
  if (bizTreeTask) return bizTreeTask
  bizTreeTask = (async () => {
    const fast = await bizTreeIdsViaScopeTree()
    if (fast) return fast
    return expandBizTreeIds()
  })().catch((error: unknown) => {
    bizTreeTask = null
    throw error
  })
  return bizTreeTask
}

/** 每枚举完一个目录回调一次：目录 ID + 该目录直属的源 ID（「业务目录」列靠它渐进显示） */
export type BizMembershipListener = (dirId: string, sourceIds: string[]) => void

let membershipTask: Promise<Map<string, string[]>> | null = null
let membershipSeq = 0
let membershipDone = false
const membershipListeners = new Set<BizMembershipListener>()

function startMembership(): Promise<Map<string, string[]>> {
  const seq = ++membershipSeq
  membershipDone = false
  const task = (async () => {
    const all = await resolveBizTreeIds()
    const map = new Map<string, string[]>()
    for (let i = 0; i < all.length; i += MEMBERSHIP_CONCURRENCY) {
      const ids = all.slice(i, i + MEMBERSHIP_CONCURRENCY)
      const lists = await Promise.all(ids.map(bizDirSourceIds))
      // 中途加入 / 移出源会作废重算，这批结果不再往订阅方推（避免旧结果盖新结果）
      if (seq !== membershipSeq) return map
      lists.forEach((sources, k) => {
        const dirId = ids[k]!
        sources.forEach((sid) => map.set(sid, [...(map.get(sid) ?? []), dirId]))
        if (!sources.length) return
        membershipListeners.forEach((listen) => {
          try {
            listen(dirId, sources)
          } catch {
            // 订阅方自己抛错不影响继续枚举
          }
        })
      })
    }
    return map
  })()
  membershipTask = task.then((map) => {
    if (seq === membershipSeq) {
      membershipDone = true
      membershipListeners.clear()
    }
    return map
  }, (error: unknown) => {
    if (seq === membershipSeq) {
      membershipDone = false
      membershipListeners.clear()
      membershipTask = null
    }
    throw error
  })
  return membershipTask
}

/**
 * 源 → 所在业务目录（目录 ID 列表），给源列表「业务目录」列用。没有反查接口，只能把整棵业务目录树
 * 的每个目录都 listSources 一遍（186 上约 75 个目录），会话内缓存，加入 / 移出后清掉重算。
 *
 * `onDir` 传了就在每枚举完一个目录时回调一次，调用方可以边算边渲染，不用整列等到最后
 * （生产上一次全量要几十秒，整列「加载中…」就是这么来的）。不传就是原来的一次性结果。
 */
export function bizMembership(onDir?: BizMembershipListener): Promise<Map<string, string[]>> {
  if (!membershipTask) startMembership()
  if (onDir && !membershipDone && membershipTask) membershipListeners.add(onDir)
  return membershipTask!
}

/** 一个目录的统计：进度挂在任务上，中途再次选中同一目录（复用进行中的任务）也能接着看进度 */
interface DirGroupTask {
  task: Promise<string[]>
  done: number
  total: number
  listeners: Set<(done: number, total: number) => void>
}
const dirGroupCache = new Map<string, DirGroupTask>()
const DIR_GROUP_PAGE_SIZE = 5000
const DIR_GROUP_CONCURRENCY = 3

/**
 * 业务目录（含子目录）里的源分属哪些来源组（1030 会议议题 5）。来源组本身没挂业务目录
 *（cfg_category_source_bind.SOURCE_GROUP_ID 在 186 上没有数据），10-31 定按成员推导、只读：
 * 组内有源在这个目录里，组就算在这个目录下。sourcePaged 的 directory 条件由后端展开子目录，
 * 按 5000 一页翻完取 sourceGroupId；大目录（186 产业数据 6.2 万源）要十几页，3 页并发。
 * 按目录缓存，失败不缓存；某页失败后剩下的页不再发。
 */
export function bizDirGroupIds(categoryId: string, onProgress?: (done: number, total: number) => void): Promise<string[]> {
  let entry = dirGroupCache.get(categoryId)
  if (!entry) {
    entry = startDirGroupTask(categoryId)
    dirGroupCache.set(categoryId, entry)
  }
  if (onProgress) {
    const current = entry
    current.listeners.add(onProgress)
    if (current.total) onProgress(current.done, current.total)
    const off = () => { current.listeners.delete(onProgress) }
    current.task.then(off, off)
  }
  return entry.task
}

function startDirGroupTask(categoryId: string): DirGroupTask {
  const directory = { kind: 'biz' as const, mode: 'selected' as const, selections: [{ id: categoryId, includeDescendants: true }] }
  const entry: DirGroupTask = { task: Promise.resolve([]), done: 0, total: 0, listeners: new Set() }
  const report = () => entry.listeners.forEach((fn) => fn(entry.done, entry.total))
  entry.task = (async () => {
    const groups = new Set<string>()
    const collect = (list: Source[]) => list.forEach((s) => { if (s.sourceGroupId) groups.add(String(s.sourceGroupId)) })
    const first = await sourceApi.sourcePaged({ page: 1, size: DIR_GROUP_PAGE_SIZE, directory })
    collect(first.list)
    entry.total = Math.max(1, Math.ceil((first.total || 0) / DIR_GROUP_PAGE_SIZE))
    entry.done = 1
    report()
    const queue = Array.from({ length: entry.total - 1 }, (_, i) => i + 2)
    // 某页失败时 drainQueue 清空队列，剩下的页不再发
    await drainQueue(queue, DIR_GROUP_CONCURRENCY, async (page) => {
      collect((await sourceApi.sourcePaged({ page, size: DIR_GROUP_PAGE_SIZE, directory })).list)
      entry.done++
      report()
    })
    return [...groups]
  })().catch((error: unknown) => {
    // 统计期间缓存可能已被作废并换成新任务，只删自己
    if (dirGroupCache.get(categoryId) === entry) dirGroupCache.delete(categoryId)
    throw error
  })
  return entry
}
/** 来源组成员变了：目录 → 组的推导结果作废（下次选目录重新统计） */
export function resetBizDirGroupCache() {
  dirGroupCache.clear()
}

function invalidateBizSources(categoryIds: string[]) {
  categoryIds.forEach((id) => dirSourcesCache.delete(id))
  // 按祖先目录缓存（含子目录），子目录变动也会影响上层，整体作废
  dirGroupCache.clear()
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
  /** 源建出来了，但归网站 / 挂流程或入组 / 进目录有一步没成：要手动补 */
  partial: string[]
}

/**
 * 业务目录「按模板批量新增」（10-22）：一行一条「源名称;URL」，每行按模板源复制一个源。
 * 复用模板源的配置和流程（共用同一条流程，不另复制），归入模板源的网站，最后统一加入业务目录 `dirId`。
 * 模板源在来源组内时，新源直接加入同组，保留自有绑定；组内使用组流程，退组后自有流程恢复。
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
        if (!bind.ok) misses.push('归入网站失败')
      }
    } catch {
      misses.push('归入网站失败')
    }
    let flowStep = '读取流程归属'
    try {
      const view = await workflowBindingApi.view(id)
      if (tplFlows.sourceGroupId) {
        if (view.sourceGroupId !== tplFlows.sourceGroupId) {
          flowStep = '加入来源组'
          const joined = await sourceGroupApi.changeMembers({ sourceIds: [id], sourceGroupId: tplFlows.sourceGroupId, expectedSourceGroupId: view.sourceGroupId ?? null })
          if (!joined.ok) throw new Error(joined.message || '加入来源组失败')
        }
      } else if (!sameFlows(view, tplFlows)) {
        await workflowBindingApi.save(id, () => ({ flowIds: tplFlows.ownFlowIds, defaultFlowId: tplFlows.ownDefaultFlowId ?? null }))
      }
    } catch (error) {
      misses.push(tplFlows.sourceGroupId ? `${flowStep}失败：${(error as Error)?.message ?? String(error)}` : '关联流程失败')
    }
    if (misses.length) result.partial.push(`#${id} ${name}（${misses.join('、')}）`)
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
// 口径（10-28 孙总确认）：目录下的表 = 目录直属源涉及的输出表 = 源默认流程各节点的输出表（outEntry）。
// **不并源的主表**（源上的 entryTypeId）：它是旧平台「源所用配置的输出表」，有了流程后源实际跑默认流程，
// 根节点可能是另一套配置，主表常常过时或悬空（186 宝都国际：主表 6200033 不存在，流程写的是 2101918 等）。
// 后端没有「目录 → 表」接口，表上也没有目录字段（entryTypePagedView 只有 groupId，不是目录），只能这样拼：
// listSources → sourcePaged 按源 ID 取默认流程（POST body，不怕 ID 多）→ 按流程去重查节点。
// 流程通常被大量源共用（公众号 6028 个源共 1 个流程），按流程缓存后跨目录复用。

const SOURCE_BATCH = 500
const FLOW_CONCURRENCY = 4
const dirTablesCache = new Map<string, Promise<BizDirTables>>()

export interface BizDirTables {
  tableIds: string[]
  /** 节点没查回来的流程（186 上有流程报「请先进入流程草稿编辑」）：用这些流程的源没统计到表 */
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
        const flowId = realId(source.flowId)
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
  dirGroupCache.clear()
  membershipTask = null
  bizTreeTask = null
  membershipListeners.clear()
  pathTasks.clear()
  dirTablesCache.clear()
  flowOutputCache.clear()
}
