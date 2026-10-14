/**
 * 源管理「我的视图」存取（2026-10-12，方案 `设计稿/设计方案/1012-我的视图_开发设计方案_2026-10-12.md`）。
 *
 * 后端 `source-view/list|add|update|delete|sort`（10-12 开发环境 124.223.180.186 联调通过）：
 * - userId 后端从会话取，前端不传，只有本人读写；
 * - `queryJson` / `displayJson` **必须是 JSON 字符串**（传对象会 400），后端只存不解析；
 * - revision 从 0 开始，每次修改 +1；写接口带编辑前 revision，不一致报「视图已变化，请刷新后重试」；
 * - 失败返回 `success:false`、`data` 里是具体原因（「视图名称已存在，请更换名称」「视图名称为1到40个字符」）；
 * - 设为默认时后端自动取消该用户其它视图的默认。
 *
 * **接口还没部署的环境（2026-10-12 实测 217 / 133：`source-view/list` 回 500 空 body）自动退回「暂存本机」**，
 * 页面照常能用；接口上线后第一次打开就切到真实接口，并提示把本机视图导入账号（importLocal）。
 * 只在「接口不存在」这一种明确情况下退回——其它错误（超时、网关 502、业务报错）照常抛出，不会悄悄把数据写到本机造成两边不一致。
 *
 * **10-14 目录改走分类接口**（`设计稿/设计方案/1014-我的视图目录版_接口变更核对与疑问_2026-10-14.md`）：
 * 真实接口下视图的目录 = 带 `rootViewId` 的分类（`category/categoryPaged|add|update|delete`，一级 `parentId=-1`），
 * 目录里的源 = `category/listSources` / `category/changeSources`（整份覆盖）。不传 `rootViewId` 的就是系统目录。
 * 来源组绑定和排除后端还没有接口（10-14 定：功能保留、后端另加），**暂存在 queryJson**（`{ v: 3, dirs: { 分类ID: { groups, excluded } } }`）。
 * 本机兜底照旧整棵树存本机。
 */
import { request } from './client'
import { emptyTree, normalizeTree, pathOf, treeFromLegacy, type ViewContainer, type ViewDir, type ViewTree } from '@/views/CollectAssets/viewDirs'

/** 视图的显示设置（隐藏列、默认排序、每页条数），存 displayJson */
export interface ViewDisplay {
  hiddenColumns: string[]
  sortField: string
  sortDirection: 'asc' | 'desc'
  pageSize: number
}
export const defaultDisplay = (): ViewDisplay => ({ hiddenColumns: [], sortField: '', sortDirection: 'asc', pageSize: 20 })

/** 目录上的来源组绑定和排除（真实接口暂存 queryJson，按分类 ID） */
export type DirExtras = Record<string, Pick<ViewContainer, 'groups' | 'excluded'>>

/**
 * 2026-10-13 目录版：视图 = 多级目录（见 views/CollectAssets/viewDirs.ts）。
 * 本机：整棵树存在 tree 里。真实接口：tree 不用（空树），目录和源用 `loadTree` 现读，`dirExtras` 是 queryJson 里的来源组 / 排除。
 */
export interface SourceView {
  viewId: string
  viewName: string
  tree: ViewTree
  dirExtras: DirExtras
  display: ViewDisplay
  isDefault: boolean
  revision: number
  createdAt: string
  updatedAt: string
}

export const SOURCE_VIEW_LIMIT = 50
export const SOURCE_VIEW_NAME_MAX = 40

export type SourceViewBackend = 'remote' | 'local'

// ---------------------------------------------------------------------------------------------
// 视图 ↔ 后端的两段 JSON：queryJson（真实接口：来源组 / 排除；本机旧数据：整棵树）、displayJson（显示设置）
// ---------------------------------------------------------------------------------------------

function parseObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const value = JSON.parse(raw) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** queryJson → 目录树：v2 直接清洗；1012 的 v1（条件 + 手选清单）转换；解析不了就是空树，不让一条坏数据拖垮整个列表 */
export function treeFromJson(queryJson: unknown): ViewTree {
  const query = parseObject(queryJson)
  if (query.v === 2) return normalizeTree(query)
  if (query.v === 1 || 'scopeIds' in query || 'conditions' in query) return treeFromLegacy(query)
  return emptyTree()
}
export function displayFromJson(displayJson: unknown, legacyQuery?: unknown): ViewDisplay {
  // 1012 早期的本机视图把显示设置也放在 query 里
  const merged = { ...parseObject(legacyQuery), ...parseObject(displayJson) } as Partial<ViewDisplay>
  const d = defaultDisplay()
  return {
    hiddenColumns: Array.isArray(merged.hiddenColumns) ? merged.hiddenColumns.map(String) : d.hiddenColumns,
    sortField: typeof merged.sortField === 'string' ? merged.sortField : d.sortField,
    sortDirection: merged.sortDirection === 'desc' ? 'desc' : 'asc',
    pageSize: Number(merged.pageSize) > 0 ? Number(merged.pageSize) : d.pageSize,
  }
}

/** queryJson v3 → 目录上的来源组 / 排除；更早的（1012/1013 存整棵树的测试数据，10-14 定不迁移）一律当空 */
export function extrasFromJson(queryJson: unknown): DirExtras {
  const query = parseObject(queryJson)
  if (query.v !== 3 || !query.dirs || typeof query.dirs !== 'object') return {}
  const out: DirExtras = {}
  for (const [id, raw] of Object.entries(query.dirs as Record<string, unknown>)) {
    const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const list = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(String))] : [])
    const groups = list(c.groups)
    const excluded = list(c.excluded)
    if (groups.length || excluded.length) out[id] = { groups, excluded }
  }
  return out
}
function extrasOf(tree: ViewTree): DirExtras {
  const out: DirExtras = {}
  for (const d of tree.dirs) if (d.groups.length || d.excluded.length) out[d.id] = { groups: d.groups, excluded: d.excluded }
  return out
}
const extrasJson = (extras: DirExtras) => JSON.stringify({ v: 3, dirs: extras })

function viewFromRow(row: Record<string, unknown>): SourceView {
  return {
    viewId: String(row.viewId),
    viewName: String(row.viewName ?? ''),
    tree: emptyTree(),
    dirExtras: extrasFromJson(row.queryJson),
    display: displayFromJson(row.displayJson),
    isDefault: Number(row.isDefault) === 1,
    revision: Number(row.revision ?? 0),
    createdAt: String(row.createDt ?? ''),
    updatedAt: String(row.updateDt ?? ''),
  }
}

/** 「请求异常 [source-view/add]: 请求失败 500: 视图名称已存在…」→ 只留后端给的原因，页面提示更干净 */
function readable(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  const cleaned = message
    .replace(/^请求异常 \[[^\]]+\]:\s*/, '')
    .replace(/^请求失败 \d+[:：]?\s*/, '')
    .replace(/^错误信息:运行时异常[:：]\s*/, '')
    .trim()
  return new Error(cleaned || message)
}

// ---------------------------------------------------------------------------------------------
// 本机实现（接口没上线时的兜底；校验口径与后端一致）
// ---------------------------------------------------------------------------------------------

export const sourceViewStorageKey = (userId: string) => `ce:source-views:v1:${encodeURIComponent(userId)}`

function read(userId: string): SourceView[] {
  const raw = localStorage.getItem(sourceViewStorageKey(userId))
  if (!raw) return []
  const data = JSON.parse(raw) as { version?: number; views?: (SourceView & { state?: unknown })[] }
  if (data?.version !== 1 || !Array.isArray(data.views)) throw new Error('本机视图数据格式异常')
  // 1012 版本机视图存的是 state（条件 + 手选清单 + 显示设置），读到时转成目录树
  return data.views.map(({ state, ...v }) => (v.tree ? { ...v, tree: normalizeTree(v.tree), dirExtras: {}, display: v.display ?? defaultDisplay() } : {
    ...v,
    dirExtras: {},
    tree: state ? treeFromJson(JSON.stringify({ v: 1, ...(state as object) })) : emptyTree(),
    display: displayFromJson(undefined, state ? JSON.stringify(state) : undefined),
  }))
}
function write(userId: string, views: SourceView[]) {
  localStorage.setItem(sourceViewStorageKey(userId), JSON.stringify({ version: 1, views }))
}
function requireUser(userId: string) {
  if (!userId) throw new Error('请先加载当前账号信息')
}
function checkName(views: SourceView[], name: string, selfId?: string): string {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > SOURCE_VIEW_NAME_MAX) throw new Error(`视图名称为1到${SOURCE_VIEW_NAME_MAX}个字符`)
  if (views.some((v) => v.viewId !== selfId && v.viewName === trimmed)) throw new Error('视图名称已存在，请更换名称')
  return trimmed
}
function find(views: SourceView[], viewId: string, revision: number): SourceView {
  const view = views.find((v) => v.viewId === viewId)
  if (!view || view.revision !== revision) throw new Error('视图已变化，请刷新后重试')
  return view
}
const now = () => new Date().toISOString()
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

type AddInput = { viewName: string; tree?: ViewTree; display?: ViewDisplay; isDefault?: boolean }
type UpdateInput = { viewId: string; revision: number; viewName?: string; tree?: ViewTree; display?: ViewDisplay; isDefault?: boolean }
type DeleteInput = { viewId: string; revision: number }

export const localSourceViewApi = {
  list: async (userId: string): Promise<SourceView[]> => {
    requireUser(userId)
    return read(userId)
  },
  add: async (userId: string, input: AddInput): Promise<SourceView> => {
    requireUser(userId)
    const views = read(userId)
    if (views.length >= SOURCE_VIEW_LIMIT) throw new Error(`每人最多 ${SOURCE_VIEW_LIMIT} 个视图，请先删除不用的视图`)
    const viewName = checkName(views, input.viewName)
    const id = `view-${Array.from(crypto.getRandomValues(new Uint32Array(2)), (n) => n.toString(16).padStart(8, '0')).join('')}`
    const view: SourceView = { viewId: id, viewName, tree: clone(input.tree ?? emptyTree()), dirExtras: {}, display: clone(input.display ?? defaultDisplay()), isDefault: !!input.isDefault, revision: 0, createdAt: now(), updatedAt: now() }
    if (view.isDefault) views.forEach((v) => { if (v.isDefault) { v.isDefault = false } })
    write(userId, [...views, view])
    return view
  },
  /** 保存 / 重命名 / 设为默认（只改传了的字段）；revision 不一致时报「视图已变化」 */
  update: async (userId: string, input: UpdateInput): Promise<SourceView> => {
    requireUser(userId)
    const views = read(userId)
    const view = find(views, input.viewId, input.revision)
    if (input.viewName != null) view.viewName = checkName(views, input.viewName, view.viewId)
    if (input.tree) view.tree = clone(input.tree)
    if (input.display) view.display = clone(input.display)
    if (input.isDefault != null) {
      if (input.isDefault) views.forEach((v) => { if (v !== view && v.isDefault) v.isDefault = false })
      view.isDefault = input.isDefault
    }
    view.revision += 1
    view.updatedAt = now()
    write(userId, views)
    return view
  },
  remove: async (userId: string, input: DeleteInput): Promise<void> => {
    requireUser(userId)
    const views = read(userId)
    find(views, input.viewId, input.revision)
    write(userId, views.filter((v) => v.viewId !== input.viewId))
  },
  clear: (userId: string) => localStorage.removeItem(sourceViewStorageKey(userId)),
}

// ---------------------------------------------------------------------------------------------
// 真实接口
// ---------------------------------------------------------------------------------------------

/** 一律 `mode: 'http'`：不走 mock（mock 里没有这批端点），写操作由 client.ts 的生产写保护白名单放行（只改自己的视图） */
const callOptions = (httpEndpoint: string, method: 'GET' | 'POST', body?: Record<string, unknown>, paramsIn?: 'query') => ({
  method,
  httpEndpoint,
  mode: 'http' as const,
  ...(paramsIn ? { paramsIn } : {}),
  ...(body ? { httpParams: body } : {}),
})
const call = <T>(endpoint: string, method: 'GET' | 'POST', body: Record<string, unknown>, paramsIn?: 'query') =>
  request<T>(endpoint, body, callOptions(endpoint, method, body, paramsIn))

const remoteSourceViewApi = {
  list: async (): Promise<SourceView[]> => {
    const result = await request<unknown>('source-view/list', {}, callOptions('source-view/list', 'GET'))
    return (Array.isArray(result) ? result : []).map((row) => viewFromRow(row as Record<string, unknown>))
  },
  add: async (input: { viewName: string; display?: ViewDisplay; isDefault?: boolean }): Promise<SourceView> => {
    const body = { viewName: input.viewName.trim(), queryJson: extrasJson({}), displayJson: JSON.stringify(input.display ?? defaultDisplay()), isDefault: input.isDefault ? 1 : 0 }
    return viewFromRow(await call<Record<string, unknown>>('source-view/add', 'POST', body))
  },
  update: async (input: Omit<UpdateInput, 'tree'> & { extras?: DirExtras }): Promise<SourceView> => {
    const body: Record<string, unknown> = {
      viewId: input.viewId,
      revision: input.revision,
      ...(input.viewName != null ? { viewName: input.viewName.trim() } : {}),
      ...(input.extras ? { queryJson: extrasJson(input.extras) } : {}),
      ...(input.display ? { displayJson: JSON.stringify(input.display) } : {}),
      ...(input.isDefault != null ? { isDefault: input.isDefault ? 1 : 0 } : {}),
    }
    return viewFromRow(await call<Record<string, unknown>>('source-view/update', 'POST', body))
  },
  remove: async (input: DeleteInput): Promise<void> => {
    await call<unknown>('source-view/delete', 'POST', { viewId: input.viewId, revision: input.revision })
  },
}

// ---------------------------------------------------------------------------------------------
// 真实接口：视图目录 = 带 rootViewId 的分类（10-14）
// ---------------------------------------------------------------------------------------------

/** 一级目录的 parentId（后端约定） */
const TOP_PARENT = '-1'
type CategoryRow = { id: string; name: string; parentId: string; seq: number }

function rowsOf(result: unknown): Record<string, unknown>[] {
  const rec = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>
  const rows = Array.isArray(result) ? result : Array.isArray(rec.list) ? rec.list : Array.isArray(rec.records) ? rec.records : []
  return rows.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
}

const viewCategoryApi = {
  children: async (viewId: string, parentId: string): Promise<CategoryRow[]> => {
    const result = await call<unknown>('category/categoryPaged', 'GET', { page: 1, limit: 10000, allSub: false, parentId, rootViewId: viewId })
    return rowsOf(result)
      .map((r) => ({ id: String(r.categoryId ?? r.id ?? ''), name: String(r.categoryName ?? r.name ?? ''), parentId: String(r.parentId ?? parentId), seq: Number(r.seq ?? 0) }))
      .filter((r) => r.id && r.name)
  },
  /** 新建后返回分类 ID：接口回了就用；没回就按「同级同名」再查一次（同级不重名由前端保证） */
  add: async (viewId: string, parentId: string, name: string, seq: number): Promise<string> => {
    const result = await call<unknown>('category/add', 'POST', { categoryName: name, parentId, rootViewId: viewId, isDelete: 0, seq }, 'query')
    const rec = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>
    const direct = typeof result === 'number' || (typeof result === 'string' && /^\d+$/.test(result)) ? String(result) : rec.categoryId ?? rec.id
    if (direct != null && direct !== '') return String(direct)
    const found = (await viewCategoryApi.children(viewId, parentId)).find((r) => r.name === name)
    if (!found) throw new Error(`目录「${name}」已提交新建，但没查到它的 ID，请刷新后查看`)
    return found.id
  },
  update: async (viewId: string, categoryId: string, patch: { name?: string; parentId?: string; seq?: number }) => {
    await call<unknown>('category/update', 'POST', {
      categoryId,
      rootViewId: viewId,
      ...(patch.name != null ? { categoryName: patch.name } : {}),
      ...(patch.parentId != null ? { parentId: patch.parentId } : {}),
      ...(patch.seq != null ? { seq: patch.seq } : {}),
    }, 'query')
  },
  remove: async (categoryId: string) => {
    await call<unknown>('category/delete', 'POST', { id: categoryId }, 'query')
  },
  listSources: async (categoryId: string): Promise<string[]> => {
    const result = await call<unknown>('category/listSources', 'GET', { categoryId })
    return [...new Set(rowsOf(result)
      .filter((r) => r.state == null || r.state === 'ACTIVE')
      .map((r) => String(r.sourceId ?? ''))
      .filter(Boolean))]
  },
  /** 整份覆盖：传的就是这个目录最终的源清单 */
  changeSources: async (categoryId: string, sourceIds: string[]) => {
    await call<unknown>('category/changeSources', 'POST', { categoryId: Number(categoryId), sourceIds: sourceIds.map(Number) })
  },
}

/** 一次并发几个请求（目录多时逐个拉 listSources） */
async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)))
  return out
}

/** 读整棵目录树：一级 parentId=-1，逐层往下；每个目录再拉绑定的源；来源组 / 排除从 queryJson 合进来 */
async function loadRemoteTree(view: SourceView): Promise<ViewTree> {
  const dirs: ViewDir[] = []
  let level: string[] = [TOP_PARENT]
  while (level.length) {
    const rows = (await inBatches(level, 6, (pid) => viewCategoryApi.children(view.viewId, pid))).flat()
    const known = new Set(dirs.map((d) => d.id))
    const fresh = rows.filter((r) => !known.has(r.id))
    for (const r of fresh) {
      const extra = view.dirExtras[r.id]
      dirs.push({ id: r.id, name: r.name, parentId: r.parentId === TOP_PARENT ? null : r.parentId, sortNo: r.seq, sources: [], groups: extra?.groups ?? [], excluded: extra?.excluded ?? [] })
    }
    level = fresh.map((r) => r.id)
  }
  const sources = await inBatches(dirs, 6, (d) => viewCategoryApi.listSources(d.id))
  dirs.forEach((d, i) => { d.sources = sources[i] })
  return normalizeTree({ dirs })
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
const depth = (tree: ViewTree, id: string) => pathOf(tree, id).length

/**
 * 把目录树的修改写到后端：删目录（先清源关系，深的先删）→ 建目录（浅的先建，换成真实分类 ID）→ 改名 / 移动 / 排序 →
 * 源有变化的目录整份覆盖 → 来源组 / 排除有变化时写 queryJson（带 revision）。返回换成真实 ID 的树和最新视图。
 * 中途失败时前面的步骤已经生效，调用方应重读。
 */
async function saveRemoteTree(view: SourceView, prev: ViewTree, next: ViewTree): Promise<{ view: SourceView; tree: ViewTree }> {
  const before = new Map(prev.dirs.map((d) => [d.id, d]))
  const nextIds = new Set(next.dirs.map((d) => d.id))
  const idMap = new Map<string, string>()
  const real = (id: string) => idMap.get(id) ?? id
  const parentOf = (d: ViewDir) => (d.parentId ? real(d.parentId) : TOP_PARENT)

  const removed = prev.dirs.filter((d) => !nextIds.has(d.id)).sort((a, b) => depth(prev, b.id) - depth(prev, a.id))
  for (const d of removed) {
    if (d.sources.length) await viewCategoryApi.changeSources(d.id, [])
    await viewCategoryApi.remove(d.id)
  }
  const added = next.dirs.filter((d) => !before.has(d.id)).sort((a, b) => depth(next, a.id) - depth(next, b.id))
  for (const d of added) idMap.set(d.id, await viewCategoryApi.add(view.viewId, parentOf(d), d.name, d.sortNo))
  for (const d of next.dirs) {
    const old = before.get(d.id)
    if (!old) continue
    const patch = {
      ...(old.name !== d.name ? { name: d.name } : {}),
      ...(old.parentId !== d.parentId ? { parentId: parentOf(d) } : {}),
      ...(old.sortNo !== d.sortNo ? { seq: d.sortNo } : {}),
    }
    if (Object.keys(patch).length) await viewCategoryApi.update(view.viewId, d.id, patch)
  }
  for (const d of next.dirs) {
    if (!sameList(before.get(d.id)?.sources ?? [], d.sources)) await viewCategoryApi.changeSources(real(d.id), d.sources)
  }

  const tree: ViewTree = {
    ...next,
    dirs: next.dirs.map((d) => ({ ...d, id: real(d.id), parentId: d.parentId ? real(d.parentId) : null })),
  }
  const extras = extrasOf(tree)
  const saved = extrasJson(extras) === extrasJson(view.dirExtras)
    ? view
    : await remoteSourceViewApi.update({ viewId: view.viewId, revision: view.revision, extras })
  return { view: saved, tree }
}

/** 删视图：先删它的目录（连同源关系，源本身不动），再删视图 */
async function removeRemoteView(view: SourceView, input: DeleteInput) {
  const tree = await loadRemoteTree(view)
  await saveRemoteTree({ ...view, dirExtras: {} }, tree, emptyTree())
  await remoteSourceViewApi.remove(input)
}

// ---------------------------------------------------------------------------------------------
// 对外：自动选真实接口 / 本机
// ---------------------------------------------------------------------------------------------

let backend: SourceViewBackend | null = null

/** 当前用的存储；还没探测过时为 null（第一次 list 时探测） */
export function sourceViewBackend(): SourceViewBackend | null {
  return backend
}
/** 测试 / 排障用：强制指定存储，或传 null 重新探测 */
export function setSourceViewBackend(next: SourceViewBackend | null) {
  backend = next
}

/**
 * 「接口不存在」：404 / 405，或 500 且没有任何业务说明（217 实测 `source-view/list` 回 HTTP 500 空 body）。
 * 后端自己返回的业务报错（带 msg / data）、网关 502/503/504、网络错误都**不算**——那些要照常报错。
 */
export function isEndpointMissing(error: unknown): boolean {
  const cause = (error as { cause?: { status?: number } } | null)?.cause
  const status = cause?.status ?? (error as { status?: number } | null)?.status
  if (status === 404 || status === 405) return true
  const message = error instanceof Error ? error.message : ''
  return status === 500 && /请求失败 500\s*$/.test(message)
}

async function listWithProbe(userId: string): Promise<SourceView[]> {
  if (backend === 'local') return localSourceViewApi.list(userId)
  try {
    const views = await remoteSourceViewApi.list()
    backend = 'remote'
    return views
  } catch (error) {
    if (!isEndpointMissing(error)) throw readable(error)
    backend = 'local'
    return localSourceViewApi.list(userId)
  }
}

async function ensureBackend(userId: string): Promise<SourceViewBackend> {
  if (!backend) await listWithProbe(userId)
  return backend ?? 'local'
}

/** 真实接口下新建视图；带了目录树（加入视图时当场新建、本机导入）就接着把目录和源写进去 */
async function addRemote(input: AddInput): Promise<SourceView> {
  const created = await remoteSourceViewApi.add(input)
  if (!input.tree?.dirs.length) return created
  return (await saveRemoteTree(created, emptyTree(), input.tree)).view
}

export const sourceViewApi = {
  /** 当前用户的全部视图。第一次调用顺带探测接口是否可用 */
  list: listWithProbe,
  add: async (userId: string, input: AddInput): Promise<SourceView> => {
    if ((await ensureBackend(userId)) === 'local') return localSourceViewApi.add(userId, input)
    try { return await addRemote(input) } catch (e) { throw readable(e) }
  },
  /** 改名 / 设为默认 / 显示设置。目录树的修改走 saveTree */
  update: async (userId: string, input: Omit<UpdateInput, 'tree'>): Promise<SourceView> => {
    if ((await ensureBackend(userId)) === 'local') return localSourceViewApi.update(userId, input)
    try { return await remoteSourceViewApi.update(input) } catch (e) { throw readable(e) }
  },
  remove: async (userId: string, view: SourceView): Promise<void> => {
    const input = { viewId: view.viewId, revision: view.revision }
    if ((await ensureBackend(userId)) === 'local') return localSourceViewApi.remove(userId, input)
    try { await removeRemoteView(view, input) } catch (e) { throw readable(e) }
  },
  /** 视图的目录树：本机就在视图里；真实接口从分类目录 + 源关系现读 */
  loadTree: async (userId: string, view: SourceView): Promise<ViewTree> => {
    if ((await ensureBackend(userId)) === 'local') return view.tree
    try { return await loadRemoteTree(view) } catch (e) { throw readable(e) }
  },
  /** 保存目录树的修改（prev = 修改前，next = 修改后）。返回最新视图和保存后的树（真实接口下新目录换成了分类 ID） */
  saveTree: async (userId: string, view: SourceView, prev: ViewTree, next: ViewTree): Promise<{ view: SourceView; tree: ViewTree }> => {
    if ((await ensureBackend(userId)) === 'local') {
      const saved = await localSourceViewApi.update(userId, { viewId: view.viewId, revision: view.revision, tree: next })
      return { view: saved, tree: saved.tree }
    }
    try { return await saveRemoteTree(view, prev, next) } catch (e) { throw readable(e) }
  },
  /** 本机还留着的视图（接口上线后用来提示导入） */
  localViews: (userId: string): SourceView[] => {
    try { return userId ? read(userId) : [] } catch { return [] }
  },
  /**
   * 把本机视图导入账号（接口上线后第一次打开）：逐个 add（连同目录和源），重名的加「（本机）」后缀；
   * 全部成功才清掉本机数据，中途失败保留剩下的，下次还能再导。返回导入个数。
   */
  importLocal: async (userId: string): Promise<{ imported: number; failed: string[] }> => {
    if ((await ensureBackend(userId)) !== 'remote') throw new Error('接口还没上线，不能导入')
    const locals = sourceViewApi.localViews(userId)
    const remote = await remoteSourceViewApi.list()
    const taken = new Set(remote.map((v) => v.viewName))
    const failed: string[] = []
    const rest: SourceView[] = []
    let imported = 0
    for (const view of locals) {
      let name = view.viewName
      while (taken.has(name)) name = `${name}（本机）`.slice(-SOURCE_VIEW_NAME_MAX)
      try {
        await addRemote({ viewName: name, tree: view.tree, display: view.display, isDefault: false })
        taken.add(name)
        imported += 1
      } catch (e) {
        failed.push(`${view.viewName}：${readable(e).message}`)
        rest.push(view)
      }
    }
    if (rest.length) write(userId, rest)
    else localSourceViewApi.clear(userId)
    return { imported, failed }
  },
}
