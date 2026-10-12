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
 */
import { request } from './client'
import { blankSourceListViewState, type SourceListViewState } from '@/views/FlowCanvas/result/sourceListViewState'

export interface SourceView {
  viewId: string
  viewName: string
  state: SourceListViewState
  isDefault: boolean
  revision: number
  createdAt: string
  updatedAt: string
}

export const SOURCE_VIEW_LIMIT = 50
export const SOURCE_VIEW_NAME_MAX = 40

export type SourceViewBackend = 'remote' | 'local'

// ---------------------------------------------------------------------------------------------
// 状态 ↔ 后端的两段 JSON：queryJson（条件 + 手选清单）、displayJson（显示设置）
// ---------------------------------------------------------------------------------------------

export function stateToJson(state: SourceListViewState): { queryJson: string; displayJson: string } {
  const { hiddenColumns, sortField, sortDirection, pageSize, ...query } = state
  return {
    queryJson: JSON.stringify(query),
    displayJson: JSON.stringify({ hiddenColumns, sortField, sortDirection, pageSize }),
  }
}

function parseObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const value = JSON.parse(raw) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** 后端存的是前端写进去的 JSON；解析不了 / 缺字段时用空白状态兜底，不让一条坏数据拖垮整个列表 */
export function stateFromJson(queryJson: unknown, displayJson: unknown): SourceListViewState {
  const blank = blankSourceListViewState()
  const query = parseObject(queryJson)
  const display = parseObject(displayJson)
  return { ...blank, ...(query as Partial<SourceListViewState>), ...(display as Partial<SourceListViewState>), v: 1 }
}

function viewFromRow(row: Record<string, unknown>): SourceView {
  return {
    viewId: String(row.viewId),
    viewName: String(row.viewName ?? ''),
    state: stateFromJson(row.queryJson, row.displayJson),
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
  const data = JSON.parse(raw) as { version?: number; views?: SourceView[] }
  if (data?.version !== 1 || !Array.isArray(data.views)) throw new Error('本机视图数据格式异常')
  return data.views
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

type AddInput = { viewName: string; state: SourceListViewState; isDefault?: boolean }
type UpdateInput = { viewId: string; revision: number; viewName?: string; state?: SourceListViewState; isDefault?: boolean }
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
    const view: SourceView = { viewId: id, viewName, state: clone(input.state), isDefault: !!input.isDefault, revision: 0, createdAt: now(), updatedAt: now() }
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
    if (input.state) view.state = clone(input.state)
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
const callOptions = (httpEndpoint: string, method: 'GET' | 'POST', body?: Record<string, unknown>) => ({
  method,
  httpEndpoint,
  mode: 'http' as const,
  ...(body ? { httpParams: body } : {}),
})

const remoteSourceViewApi = {
  list: async (): Promise<SourceView[]> => {
    const result = await request<unknown>('source-view/list', {}, callOptions('source-view/list', 'GET'))
    return (Array.isArray(result) ? result : []).map((row) => viewFromRow(row as Record<string, unknown>))
  },
  add: async (input: AddInput): Promise<SourceView> => {
    const body = { viewName: input.viewName.trim(), ...stateToJson(input.state), isDefault: input.isDefault ? 1 : 0 }
    return viewFromRow(await request<Record<string, unknown>>('source-view/add', body, callOptions('source-view/add', 'POST', body)))
  },
  update: async (input: UpdateInput): Promise<SourceView> => {
    const body: Record<string, unknown> = {
      viewId: input.viewId,
      revision: input.revision,
      ...(input.viewName != null ? { viewName: input.viewName.trim() } : {}),
      ...(input.state ? stateToJson(input.state) : {}),
      ...(input.isDefault != null ? { isDefault: input.isDefault ? 1 : 0 } : {}),
    }
    return viewFromRow(await request<Record<string, unknown>>('source-view/update', body, callOptions('source-view/update', 'POST', body)))
  },
  remove: async (input: DeleteInput): Promise<void> => {
    const body = { viewId: input.viewId, revision: input.revision }
    await request<unknown>('source-view/delete', body, callOptions('source-view/delete', 'POST', body))
  },
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

export const sourceViewApi = {
  /** 当前用户的全部视图。第一次调用顺带探测接口是否可用 */
  list: listWithProbe,
  add: async (userId: string, input: AddInput): Promise<SourceView> => {
    if ((await ensureBackend(userId)) === 'local') return localSourceViewApi.add(userId, input)
    try { return await remoteSourceViewApi.add(input) } catch (e) { throw readable(e) }
  },
  update: async (userId: string, input: UpdateInput): Promise<SourceView> => {
    if ((await ensureBackend(userId)) === 'local') return localSourceViewApi.update(userId, input)
    try { return await remoteSourceViewApi.update(input) } catch (e) { throw readable(e) }
  },
  remove: async (userId: string, input: DeleteInput): Promise<void> => {
    if ((await ensureBackend(userId)) === 'local') return localSourceViewApi.remove(userId, input)
    try { await remoteSourceViewApi.remove(input) } catch (e) { throw readable(e) }
  },
  /** 本机还留着的视图（接口上线后用来提示导入） */
  localViews: (userId: string): SourceView[] => {
    try { return userId ? read(userId) : [] } catch { return [] }
  },
  /**
   * 把本机视图导入账号（接口上线后第一次打开）：逐个 add，重名的加「（本机）」后缀；
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
        await remoteSourceViewApi.add({ viewName: name, state: view.state, isDefault: false })
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
