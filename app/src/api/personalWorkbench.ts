/**
 * 「我的工作台」数据层（个人工作台，不是首页的 `workbench/summary`）。
 *
 * 只读现有 live 端点，不新增后端契约，也不造假数据。能力边界由核查结论决定：
 *
 * | 能力 | 现状 | 本层做法 |
 * |---|---|---|
 * | 我的收藏 | 已实现（`/v1/favorite/*`） | `loadCollections()`：按类拉收藏行（保留真实 `createDt`），再用列表接口按 ID 反查名称 |
 * | 最近访问 | 已实现（`/v1/log-report/recent`） | `loadRecents()`：重查资源实时名称与权限，**不用**埋点里的旧 `contentTitle` |
 * | 我负责的源 | 缺失 | `loadResources()` 抛 `WorkbenchUnavailableError`，不回退全平台数据 |
 * | 我的相关告警 | 缺失 | `loadAlarms()` 抛 `WorkbenchUnavailableError`，不回退全平台数据 |
 * | 工作台偏好 | 缺失 | 不实现（没有端点，前端不落本地假偏好） |
 *
 * 为什么 owned resources / alarms 是"不支持"而不是空列表：
 * - 源：`cs_source.AUTHOR` 语义是**负责人**（复制源时会被 `copy.setAuthor(userName)` 覆盖），
 *   不是审计创建人；网站 `CfgSite`、表 `CfgEntryType` 连创建人字段都没有。按负责人筛出来的
 *   "我的源"既不准也不完整，等于把别人的资源算给我，所以宁可显式报不支持。
 * - 告警：`ck_source` 只有 `groupId`，没有 siteId / 级别 / 负责人；`source/check/paged` 只有
 *   `state`（E/C）和 `lastRun`，`monitor/alarmPaged` 目前是 mock 且全仓零调用。按 groupId 聚合
 *   出来的是**全组**告警，不是"我的相关告警"，同样不能拿全局数据冒充个人数据。
 *
 * 服务端数据权限：`source/sourcePaged`、`config/entryTypePagedView`、`site/sitePaged` 都由后端
 * 按登录会话的组权限过滤（`AuthResEnum` 编译 SQL）。本层的"权限过滤解析器"= 只用这些列表接口
 * 反查，查不到就说明无权限或已删除，直接丢弃——前端不再叠加规则。
 *
 * 有界与截断：收藏 500/页最多 2 页；网站最多翻 5 页（200/页）；源一批最多 200 个 ID；表逐个查、
 * 最多 60 个。**触到上限时 `truncated: true` 且不给 `total`**（`total` 只代表"本次完整读到的条数"），
 * 视图据此提示 {@link WORKBENCH_TRUNCATED_NOTE}，不能把已知下限当总数。
 * 时间戳一律取后端原值（收藏 `createDt`、埋点 `createDt`），不补 `Date.now()` 之类的假时间。
 */
import type { Ref } from 'vue'
import { entryApi, favoriteApi, siteApi, sourceApi } from './index'
import { request } from './client'
import { logReportApi, type LogAction, type LogContentType, type RecentLogItem } from './logReport'
import type { EntryType } from './types/collect'
import type { Site, Source } from './types/source'

/** 工作台可展示的资源类型；与 `FavoriteItemType` 的公开子集保持一致（工作台不展示 CONFIG/FLOW）。 */
export type ResourceKind = 'SITE' | 'SOURCE' | 'ENTRY_TYPE'

/** 工作台列表项（收藏 / 最近访问共用）。 */
export interface WorkbenchItem {
  /** 资源 ID（字符串，避免 Long 精度问题） */
  id: string
  kind: ResourceKind
  /** 实时资源名：来自资源列表接口，不是埋点快照 */
  name: string
  /** 副标题：网站=分类路径，源=所属网站/主表，表=物理表名 */
  subtitle?: string
  /** 真实时间戳（收藏时间 / 最近访问时间，后端原值），拿不到时省略 */
  at?: string
  /** 源所属网站 ID（SITE 自身即 siteId；表没有网站维度） */
  siteId?: string
}

/** 有界读取结果。 */
export interface WorkbenchPage<T = WorkbenchItem> {
  list: T[]
  /**
   * 精确条数：**只在本次读取没被上限截断时**给出。触到上限时为 `undefined`，
   * 避免把"已读到的下限"当成服务端总数。
   */
  total?: number
  /** true = `list` 只是受上限约束的子集，UI 用 {@link WORKBENCH_TRUNCATED_NOTE} 提示 */
  truncated?: boolean
}

/** 被上限截断时的统一提示文案（视图直接展示，避免各页自己编）。 */
export const WORKBENCH_TRUNCATED_NOTE = '数据量较大，仅展示最近一部分；完整列表请到对应页面查看'

/** 「我负责的源」列表项（当前不可用，先定类型给视图对齐）。 */
export interface WorkbenchSource extends WorkbenchItem {
  kind: 'SOURCE'
  /** 由 `source/check/paged` 的 state 推导：E=异常、C=正常；运行中暂无可靠来源 */
  state?: 'ok' | 'error' | 'running'
  /** 最近一次运行时间（`SourceCheck.lastRun`，真实时间） */
  lastRun?: string
  /** 近 7 日异常次数（暂无该端点，占位字段，视图需容忍 undefined） */
  abnormalCount?: number
}

/** 告警级别：执行失败 / 数据异常 / 已恢复（对齐原型三档）。 */
export type WorkbenchAlarmLevel = 'error' | 'fail' | 'recover'

/** 「我的相关告警」列表项（当前不可用，先定类型给视图对齐）。 */
export interface WorkbenchAlarm {
  id: string
  sourceId: string
  name: string
  description?: string
  level: WorkbenchAlarmLevel
  /** 真实发生时间 */
  at?: string
  resolved?: boolean
}

/** 本层支持探测的"缺失能力"标识。 */
export type WorkbenchCapability = 'resources' | 'alarms'

/** 显式"后端不支持"错误：视图据此渲染「暂不支持」，不要当成空态。 */
export class WorkbenchUnavailableError extends Error {
  readonly code = 'WORKBENCH_UNAVAILABLE' as const
  readonly capability: WorkbenchCapability

  constructor(capability: WorkbenchCapability, message: string) {
    super(message)
    this.name = 'WorkbenchUnavailableError'
    this.capability = capability
  }
}

export function isWorkbenchUnavailableError(value: unknown): value is WorkbenchUnavailableError {
  return value instanceof WorkbenchUnavailableError
}

/** 各能力当前是否可用（视图可直接据此渲染入口，避免先请求再 catch）。 */
export const WORKBENCH_CAPABILITIES = {
  collections: true,
  recents: true,
  resources: true,
  alarms: true,
} as const

// ---- 有界请求参数 ----
/** 收藏单页上限（后端校验 1~500） */
const FAVORITE_PAGE_LIMIT = 500
/** 单类收藏最多翻几页：1000 条上限足够个人工作台，也防异常数据把请求拖死 */
const MAX_FAVORITE_PAGES = 2
/** 网站反查最多翻几页；网站列表没有按 ID 查询的口径，只能翻服务端已鉴权的列表 */
const SITE_PAGE_SIZE = 200
const MAX_SITE_PAGES = 5
/** 源反查单批上限（`sourcePaged` 的 `sourceIds` → 后端 `ids` 逗号串） */
const MAX_SOURCE_LOOKUPS = 200
/** 表反查：后端 `cond` 实测不生效（10-22，186），只能按 ID 逐个查，最多 60 个 */
const MAX_ENTRY_LOOKUPS = 60
const ENTRY_LOOKUP_CONCURRENCY = 6
/** 最近访问每类最多取多少条（`log-report/recent` 上限 100） */
const MAX_RECENTS_PER_KIND = 20
const DEFAULT_RECENTS = 8

/** 限制并发地跑一批异步任务；`fn` 的顺序结果按入参顺序返回。 */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index] as T)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * 列表信封校验：返回的 `list` 必须是数组。
 *
 * 接口返回不认识的结构时要报错，**不能当成"没有数据"**——否则工作台会把契约变更 /
 * 网关错误渲染成"暂无收藏"，用户以为数据丢了。
 */
function asList<T>(value: unknown, label: string): T[] {
  if (!Array.isArray(value)) throw new Error(`${label}返回格式异常`)
  return value as T[]
}

// ---- 收藏行读取 ----

interface FavoriteRow {
  itemId: string
  /** 收藏时间（后端 `CREATE_DT`，原值，例如 `2026-11-08 10:00:00`） */
  createDt?: string
}

interface FavoriteRowsResult {
  rows: FavoriteRow[]
  /** 触到单类 1000 条上限（或后端声明还有更多） */
  truncated: boolean
}

/**
 * 读某一类的收藏行。`favoriteApi.listIds` 会把 `createDt` 丢掉，而工作台要展示收藏时间，
 * 所以这里直接复用同一条 live 端点 `favorite/list`（HTTP 参数与 `listIds` 一致）。
 */
async function loadFavoriteRows(kind: ResourceKind): Promise<FavoriteRowsResult> {
  const rows: FavoriteRow[] = []
  let truncated = false
  for (let page = 1; page <= MAX_FAVORITE_PAGES; page++) {
    const result = await request<{ list?: unknown; total?: number }>('favorite/list', { itemType: kind, page }, {
      method: 'GET',
      httpParams: { itemType: kind, page, limit: FAVORITE_PAGE_LIMIT },
    })
    const pageRows = asList<unknown>(result?.list, '收藏列表')
    for (const raw of pageRows) {
      const record = (raw ?? {}) as Record<string, unknown>
      const id = record.itemId == null ? '' : String(record.itemId).trim()
      if (!id) continue
      const createDt = typeof record.createDt === 'string' ? record.createDt.trim() : ''
      rows.push({ itemId: id, createDt: createDt || undefined })
    }
    // 后端声明还有更多（total 只用于判"是否读全"，不拿它当精确总数展示）
    const total = Number(result?.total)
    if (Number.isFinite(total) && total > rows.length) truncated = true
    if (pageRows.length < FAVORITE_PAGE_LIMIT) break
    // 整页读满且已到页数上限：后面还有，只是不读了
    if (page === MAX_FAVORITE_PAGES) truncated = true
  }
  return { rows, truncated }
}

// ---- 权限过滤解析器：按 ID 反查真实资源 ----

interface ResolveResult {
  items: Map<string, WorkbenchItem>
  /** 受查询上限截断（并非"资源不存在"，只是没继续查） */
  truncated: boolean
}

function siteSubtitle(site: Site): string | undefined {
  const path = site.categoryPath || site.category
  return path || undefined
}

function sourceSubtitle(source: Source): string | undefined {
  const label = source.siteName || source.mainTable
  return label || undefined
}

function siteItem(site: Site): WorkbenchItem | null {
  const id = String(site.siteId ?? '').trim()
  if (!id) return null
  return {
    id,
    kind: 'SITE',
    name: site.name?.trim() || id,
    subtitle: siteSubtitle(site),
    siteId: id,
  }
}

function sourceItem(source: Source): WorkbenchItem | null {
  const id = String(source.sourceId ?? '').trim()
  if (!id) return null
  return {
    id,
    kind: 'SOURCE',
    name: source.name?.trim() || id,
    subtitle: sourceSubtitle(source),
    siteId: source.siteId ? String(source.siteId) : undefined,
  }
}

function entryItem(entry: EntryType): WorkbenchItem | null {
  const id = String(entry.tableId ?? '').trim()
  if (!id) return null
  return {
    id,
    kind: 'ENTRY_TYPE',
    name: (entry.name || entry.tableName || id).trim(),
    subtitle: entry.tableName || undefined,
  }
}

/**
 * 网站反查：`site/sitePaged` 只支持名称/分类筛选，没有 ID 集合入参，只能按页翻服务端已鉴权的列表，
 * 命中即取。找不到 = 无权限或已删除，丢弃（不退回 `siteDetail`，详情接口不做列表级权限过滤）。
 * 翻满 5 页仍有目标没找到 → `truncated`（可能只是不在前 1000 条里）。
 */
async function resolveSites(wanted: Set<string>): Promise<ResolveResult> {
  const items = new Map<string, WorkbenchItem>()
  if (!wanted.size) return { items, truncated: false }
  for (let page = 1; page <= MAX_SITE_PAGES; page++) {
    const paged = await siteApi.sitePaged({ page, size: SITE_PAGE_SIZE })
    const list = asList<Site>(paged?.list, '网站列表')
    for (const site of list) {
      const item = siteItem(site)
      if (!item || !wanted.has(item.id) || items.has(item.id)) continue
      items.set(item.id, item)
    }
    if (items.size >= wanted.size) return { items, truncated: false }
    // 已翻到列表末尾：剩下没解析出来的确实是无权限/已删，不是截断
    if (list.length < SITE_PAGE_SIZE) return { items, truncated: false }
  }
  return { items, truncated: true }
}

/** 源反查：`source/sourcePaged` 的 `sourceIds`→后端 `ids` 是既有契约（DataQueryTab / CondValueInput 已在用），服务端按组权限过滤。 */
async function resolveSources(wanted: Set<string>): Promise<ResolveResult> {
  const items = new Map<string, WorkbenchItem>()
  const ids = [...wanted]
  if (!ids.length) return { items, truncated: false }
  const batch = ids.slice(0, MAX_SOURCE_LOOKUPS)
  const paged = await sourceApi.sourcePaged({ sourceIds: batch, page: 1, size: batch.length })
  const list = asList<Source>(paged?.list, '源列表')
  for (const source of list) {
    const item = sourceItem(source)
    if (!item || !wanted.has(item.id) || items.has(item.id)) continue
    items.set(item.id, item)
  }
  // 超出一批的部分没查：可能是"确实没权限"，但我们并不知道，按截断处理
  return { items, truncated: ids.length > MAX_SOURCE_LOOKUPS }
}

/**
 * 表反查：`entryTypePagedView` 的 `cond=id1,id2` 在 186 实测不过滤（见 `EntryTab.vue` 注释），
 * 因此按 `entryTypeId` 精确逐个查（与 EntryTab 的"只看收藏"同款口径），并发 6、上限 60 个。
 */
async function resolveEntries(wanted: Set<string>): Promise<ResolveResult> {
  const items = new Map<string, WorkbenchItem>()
  const ids = [...wanted]
  if (!ids.length) return { items, truncated: false }
  const batch = ids.slice(0, MAX_ENTRY_LOOKUPS)
  const pages = await mapLimit(batch, ENTRY_LOOKUP_CONCURRENCY, (id) =>
    entryApi.entryPaged({ entryTypeId: id, page: 1, size: 5 }),
  )
  pages.forEach((paged, index) => {
    const wantedId = batch[index] as string
    const list = asList<EntryType>(paged?.list, '表列表')
    const hit = list.find((entry) => String(entry.tableId ?? '').trim() === wantedId)
    const item = hit ? entryItem(hit) : null
    if (item && item.id === wantedId) items.set(item.id, item)
  })
  return { items, truncated: ids.length > MAX_ENTRY_LOOKUPS }
}

const RESOLVERS: Record<ResourceKind, (wanted: Set<string>) => Promise<ResolveResult>> = {
  SITE: resolveSites,
  SOURCE: resolveSources,
  ENTRY_TYPE: resolveEntries,
}

/** 按收藏/访问时间倒序；缺时间的排后面（不伪造时间）。 */
function byAtDesc(a: { at?: string }, b: { at?: string }): number {
  const left = a.at ?? ''
  const right = b.at ?? ''
  if (left === right) return 0
  return right.localeCompare(left)
}

/** 三类资源并行反查（优先使用 W11 批量名称解析端点，异常时平滑降级）。 */
async function resolveAll(wantedByKind: Record<ResourceKind, Set<string>>): Promise<Record<ResourceKind, ResolveResult>> {
  const kinds: ResourceKind[] = ['SITE', 'SOURCE', 'ENTRY_TYPE']
  const resolved = {
    SITE: { items: new Map<string, WorkbenchItem>(), truncated: false },
    SOURCE: { items: new Map<string, WorkbenchItem>(), truncated: false },
    ENTRY_TYPE: { items: new Map<string, WorkbenchItem>(), truncated: false },
  } as Record<ResourceKind, ResolveResult>

  const allItems: { kind: ResourceKind; id: number }[] = []
  for (const kind of kinds) {
    for (const idStr of wantedByKind[kind]) {
      const num = Number(idStr)
      if (Number.isFinite(num) && num > 0) allItems.push({ kind, id: num })
    }
  }

  if (allItems.length > 0 && allItems.length <= 200) {
    try {
      const resp = await request<Array<{
        kind: ResourceKind
        id: number | string
        exists: boolean
        name?: string
        subtitle?: string
        siteId?: number | string
      }>>('workbench/resolve-items', { items: allItems }, {
        method: 'POST',
      })
      if (Array.isArray(resp)) {
        for (const item of resp) {
          if (!item.exists || !item.name) continue
          const id = String(item.id)
          const kind = item.kind
          if (!resolved[kind]) continue
          resolved[kind].items.set(id, {
            id,
            kind,
            name: item.name,
            subtitle: item.subtitle,
            siteId: item.siteId != null ? String(item.siteId) : undefined,
          })
        }
        return resolved
      }
    } catch {
      // 批量接口未响应或在单元测试 mock 场景下，走单类并行反查
    }
  }

  await Promise.all(
    kinds.map(async (kind) => {
      resolved[kind] = await RESOLVERS[kind](wantedByKind[kind])
    }),
  )
  return resolved
}

/**
 * 我的收藏（网站 / 源 / 表混排，按收藏时间倒序）。
 *
 * 名称、副标题、所属网站全部来自资源列表接口的实时数据；`favorite/list` 只提供 ID 与收藏时间。
 * 反查不到的收藏（无权限 / 已删除）不会出现在结果里。
 */
export async function loadCollections(): Promise<WorkbenchPage<WorkbenchItem>> {
  const kinds: ResourceKind[] = ['SITE', 'SOURCE', 'ENTRY_TYPE']
  const favoriteResults = await Promise.all(kinds.map((kind) => loadFavoriteRows(kind)))
  const wantedByKind: Record<ResourceKind, Set<string>> = { SITE: new Set(), SOURCE: new Set(), ENTRY_TYPE: new Set() }
  kinds.forEach((kind, index) => {
    for (const row of (favoriteResults[index] as FavoriteRowsResult).rows) wantedByKind[kind].add(row.itemId)
  })
  const resolved = await resolveAll(wantedByKind)

  const items: WorkbenchItem[] = []
  kinds.forEach((kind, index) => {
    for (const row of (favoriteResults[index] as FavoriteRowsResult).rows) {
      const hit = resolved[kind].items.get(row.itemId)
      if (!hit) continue
      items.push(row.createDt ? { ...hit, at: row.createDt } : { ...hit })
    }
  })
  items.sort(byAtDesc)

  const truncated = favoriteResults.some((result) => result.truncated) || kinds.some((kind) => resolved[kind].truncated)
  return truncated ? { list: items, truncated: true } : { list: items, total: items.length, truncated: false }
}

/**
 * 最近访问使用的资源类型 → 埋点 contentType/action（只取工作台展示的三类）。
 *
 * 表的既有埋点在数据查看页用的是 `CLICK`（`DataQueryTab.vue`），所以表要同时取 `ENTER` 和 `CLICK`，
 * 否则「最近访问的表」会缺一半历史。后端 `LogReportController.recent` 的 javadoc 明确 `action`
 * 支持逗号分隔多值（示例正是 `SOURCE&action=ENTER,CLICK`），组合值是真契约，不是猜测。
 */
const RECENT_KINDS: { kind: ResourceKind; contentType: LogContentType; action: LogAction }[] = [
  { kind: 'SITE', contentType: 'SITE', action: 'ENTER' },
  { kind: 'SOURCE', contentType: 'SOURCE', action: 'ENTER' },
  { kind: 'ENTRY_TYPE', contentType: 'ENTRY_TYPE', action: 'ENTER,CLICK' as LogAction },
]

/**
 * 最近访问（网站 / 源 / 表混排，按访问时间倒序）。
 *
 * 关键：埋点返回的 `contentTitle` 是**上报时的快照**，资源改名 / 被移出权限后就是过期信息。
 * 这里只把它当线索，实际展示名与权限一律用资源列表接口重新解析；查不到的直接丢弃。
 * 同类型同 ID 多次访问只保留最近一次（`log-report/recent` 后端也按 contentId 去重，这里再兜一层）。
 */
export async function loadRecents(limit = DEFAULT_RECENTS): Promise<WorkbenchPage<WorkbenchItem>> {
  const perKind = Math.min(Math.max(Math.trunc(Number(limit)) || DEFAULT_RECENTS, 1), MAX_RECENTS_PER_KIND)
  const feeds = await Promise.all(
    RECENT_KINDS.map(({ contentType, action }) => logReportApi.recentRaw({ contentType, action, limit: perKind })),
  )

  const latest = new Map<string, { kind: ResourceKind; itemId: string; at?: string }>()
  /** 每类都取不满一页、且总数没超过展示上限，才算"读全" */
  let complete = true
  feeds.forEach((envelope, index) => {
    if (!envelope || envelope.success !== true) {
      // 埋点读取失败要显式报出来：工作台不能把"没查到"伪装成"没有访问记录"
      throw new Error(`最近访问读取失败：${envelope?.msg || '接口未返回成功'}`)
    }
    const list = asList<RecentLogItem>(envelope.data, '最近访问')
    if (list.length >= perKind) complete = false
    const kind = (RECENT_KINDS[index] as { kind: ResourceKind }).kind
    for (const row of list) {
      const itemId = row?.contentId == null ? '' : String(row.contentId).trim()
      if (!itemId) continue
      const at = typeof row.createDt === 'string' ? row.createDt.trim() : ''
      const key = `${kind}:${itemId}`
      const prev = latest.get(key)
      if (!prev || (at && at > (prev.at ?? ''))) latest.set(key, { kind, itemId, at: at || undefined })
    }
  })

  const rows = [...latest.values()]
  const wantedByKind: Record<ResourceKind, Set<string>> = { SITE: new Set(), SOURCE: new Set(), ENTRY_TYPE: new Set() }
  rows.forEach((row) => wantedByKind[row.kind].add(row.itemId))
  const resolved = await resolveAll(wantedByKind)

  const items: WorkbenchItem[] = []
  for (const row of rows) {
    const hit = resolved[row.kind].items.get(row.itemId)
    if (!hit) continue
    items.push(row.at ? { ...hit, at: row.at } : { ...hit })
  }
  items.sort(byAtDesc)

  const shown = items.slice(0, perKind * RECENT_KINDS.length)
  if (items.length > shown.length) complete = false
  return complete ? { list: shown, total: shown.length, truncated: false } : { list: shown, truncated: true }
}

/**
 * 「我负责的源」（对接 W8 GET /api/v1/workbench/my-sources）。
 */
export async function loadResources(params: { page?: number; limit?: number; state?: string; keyword?: string } = {}): Promise<WorkbenchPage<WorkbenchSource>> {
  const result = await request<{ list?: unknown; total?: number }>('workbench/my-sources', params, {
    method: 'GET',
    httpParams: { page: params.page ?? 1, limit: params.limit ?? 20, state: params.state, keyword: params.keyword },
  })
  const rawList = asList<Record<string, unknown>>(result?.list, '我负责的源列表')
  const list: WorkbenchSource[] = rawList.map((row) => {
    const id = String(row.sourceId ?? '').trim()
    const stateVal = String(row.state ?? '')
    const siteName = typeof row.siteName === 'string' ? row.siteName.trim() : ''
    const entryTypeName = typeof row.entryTypeName === 'string' ? row.entryTypeName.trim() : ''
    return {
      id,
      kind: 'SOURCE',
      name: String(row.sourceName ?? id).trim(),
      subtitle: siteName || entryTypeName || undefined,
      at: typeof row.updateDt === 'string' ? row.updateDt.trim() : undefined,
      siteId: row.siteId != null ? String(row.siteId) : undefined,
      state: stateVal === '0' || stateVal === 'C' ? 'ok' : 'error',
      alarmLevel: (row.alarmLevel as 'error' | 'fail' | null) ?? null,
    }
  })
  return {
    list,
    total: typeof result?.total === 'number' ? result.total : list.length,
    truncated: false,
  }
}

/**
 * 「我的相关告警」（对接 W9 GET /api/v1/workbench/my-alarms）。
 */
export async function loadAlarms(scope: 'open' | 'all' = 'all', limit = 20): Promise<WorkbenchPage<WorkbenchAlarm>> {
  const result = await request<{ list?: unknown; total?: number }>('workbench/my-alarms', { scope, limit }, {
    method: 'GET',
    httpParams: { scope, page: 1, limit },
  })
  const rawList = asList<Record<string, unknown>>(result?.list, '我的相关告警')
  const list: WorkbenchAlarm[] = rawList.map((row) => {
    const id = String(row.alarmId ?? '').trim()
    const sourceId = String(row.targetId ?? '').trim()
    const level = (row.level as WorkbenchAlarmLevel) || 'fail'
    return {
      id,
      sourceId,
      name: String(row.targetName ?? sourceId).trim(),
      description: typeof row.title === 'string' ? row.title.trim() : undefined,
      level,
      at: typeof row.occurDt === 'string' ? row.occurDt.trim() : undefined,
      resolved: level === 'recover',
    }
  })
  return {
    list,
    total: typeof result?.total === 'number' ? result.total : list.length,
    truncated: false,
  }
}

/**
 * 取消收藏后同步本地收藏集合（`favorite{Site,Source,Entry}Ids`）。
 *
 * 只允许在**后端回执成功之后**更新：先改本地会让"取消失败"的星标停在一个后端没记下的状态。
 * 动态引入是为了避免 api 层静态依赖带 `ElMessage` 的 UI 模块；同步失败不影响"取消失败"的真实结果。
 */
async function dropFavoriteId(kind: ResourceKind, id: string): Promise<void> {
  let ids: Ref<Set<string>>
  try {
    if (kind === 'SITE') ids = (await import('../utils/siteFavorites')).favoriteSiteIds
    else if (kind === 'SOURCE') ids = (await import('../utils/sourceFavorites')).favoriteSourceIds
    else ids = (await import('../utils/entryFavorites')).favoriteEntryIds
  } catch {
    return
  }
  if (!ids.value.has(id)) return
  const next = new Set(ids.value)
  next.delete(id)
  ids.value = next
}

/**
 * 取消收藏。只接受工作台展示的三类资源；ID 走后端正整数校验口径（`itemId` 会被转 Number）。
 * 失败抛出真实错误（含后端回执 message），由视图决定是否提示。
 */
export async function removeFavorite(item: Pick<WorkbenchItem, 'id' | 'kind'>): Promise<void> {
  const id = String(item?.id ?? '').trim()
  if (!/^[1-9]\d*$/.test(id)) throw new Error('收藏 ID 无效')
  const ack = await favoriteApi.remove(item.kind, id)
  if (ack && ack.ok === false) throw new Error(ack.message || '取消收藏失败')
  await dropFavoriteId(item.kind, id)
}

/** 视图可直接消费的对象形态（与具名导出等价）。 */
export const personalWorkbenchApi = {
  collections: loadCollections,
  recents: loadRecents,
  resources: loadResources,
  alarms: loadAlarms,
  removeFavorite,
}