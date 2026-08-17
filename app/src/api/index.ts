import { request, BASE_URL, appendQuery, usesMockAdapter, ApiError, isMockMode } from './client'
import { ACCESS_TOKEN_HEADER, isSessionExpiredRedirect, readLoginUsername, readStoredToken, triggerSessionExpired } from './auth'
import type {
  Paged, Source, Site, SiteSummary, SiteCreateInput, SiteCreateResult, Ack, PageQuery,
  Rule, RuleGroup, SharedConfig, RuleTestCase, EvalResult,
  RuleOrchestration, RuleOrchestrationGenerateResult, RuleOrchestrationItem, RuleOrchestrationSaveResult, RuleOrchestrationTestRequest, RuleOrchestrationTestResult,
  Dataset, Measure, DataTableMeta, DataRow, RowQuery, EntryTypeGroup, EntryDetail, SummaryRow, RunRow, RunNode, NodeRunStat, QueueStat, HealthCard, MqQueue, SyncRow, AlarmRow,
  TaskInstQuery, SiteTableOption, SiteTablesResult,
  Config, ConfigActionLog, ConfigParamBinding, EntryType, Param, ParamInput, CredentialRef, SourceLog, TaskInst, SourceTaskQuery, WorkbenchSummary,
  OverviewSummary, TrendPoint, FileResourceRecord, FileResourceQuery, SourceCloneRequest, SourceCloneResult,
  FlowTemplate, FlowTemplateSaveInput, LegacyLoginSubmission, LegacySnatchSaveRequest, LegacySnatchSaveResult,
} from './types'
import type { FlowDef, FlowRecommendation } from '@/views/FlowCanvas/canvas/flowModel'
import {
  configFromLegacy,
  configLogFromLegacy,
  configPageFromLegacy,
  configParamFromLegacy,
  configToLegacy,
  dataRowFromLegacy,
  dataTableFromLegacy,
  entryDetailFromLegacy,
  entryTypeFromLegacy,
  entryTypeGroupFromLegacy,
  entryTypePageFromLegacy,
  entryTypeToLegacy,
  paramFromLegacy,
  paramPageFromLegacy,
  paramToLegacy,
  isVruleNumericRuleId,
  parseRuleOrchestrationStreamText,
  pickRuleIdFromComposeList,
  ruleOrchestrationDetailFromLegacy,
  ruleOrchestrationGenerateFormBody,
  ruleOrchestrationGenerateFromLegacy,
  ruleOrchestrationListFromLegacy,
  ruleOrchestrationSaveMetaFromLegacy,
  ruleOrchestrationSaveMetaToLegacy,
  ruleOrchestrationSaveScriptFromLegacy,
  ruleOrchestrationSaveScriptToLegacy,
  ruleOrchestrationTestFromLegacy,
  ruleOrchestrationTestToLegacy,
  siteFromLegacy,
  sitePageFromLegacy,
  siteSummaryFromLegacy,
  siteSourceFromLegacy,
  sourceCategoriesFromLegacy,
  sourceFromLegacy,
  sourceOptionFromLegacy,
  sourcePageFromLegacy,
  sourceStepsFromLegacy,
  summaryRowFromLegacy,
  taskInstFromLegacy,
  assertLegacySnatchSaveLogin,
  legacySnatchSavePayloadFromFlow,
} from './legacyAdapters'
import { encryptLegacyPayload } from './legacyCrypto'

export * from './types'
export { isDanger, DANGER_ENDPOINTS, isMockMode } from './client'

// 对方后端尚未提供对应实现的资产能力强制走 Mock；网站读取链路已在 siteApi 单独切真实。
const assetMockRequest = <T>(endpoint: string, params?: Record<string, unknown>) =>
  request<T>(endpoint, params, { mode: 'mock' })

async function legacySnatchSaveRequest(payload: LegacySnatchSaveRequest): Promise<LegacySnatchSaveResult> {
  const result = await request<LegacySnatchSaveResult>('snatch/snatchSave', payload as unknown as Record<string, unknown>, {
    method: 'POST',
    httpEndpoint: 'snatch/snatchSave',
  })
  if (result?.sourceId || !result?.message) return result
  const sourceId = result.message.match(/源ID[:：]\s*([^\s,，]+)/)?.[1]
  return sourceId ? { ...result, sourceId } : result
}

function ackFromApiResult(result: unknown): Ack {
  const record = result && typeof result === 'object' ? result as Record<string, unknown> : {}
  return {
    ok: record.ok !== false && record.success !== false && String(record.code ?? '0') === '0',
    demo: record.demo === true,
    message: record.message == null ? (record.msg == null ? undefined : String(record.msg)) : String(record.message),
  }
}

function idFromApiResult(result: unknown, keys: string[]): string | undefined {
  if (typeof result === 'string' || typeof result === 'number') return String(result)
  if (!result || typeof result !== 'object') return undefined
  const record = result as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null && String(value).trim()) return String(value)
  }
  return undefined
}

function legacySnatchSavePayloadFromSource(site: Site, source: Source): LegacySnatchSaveRequest {
  return {
    sourceType: source.sourceType ?? '90',
    sourceUrl: source.url ?? '',
    sourceName: source.name,
    categoryId: source.dirId ?? site.dirId ?? '',
    proxy: source.proxy ?? (source.useProxy ? '1' : ''),
    keep: source.resume ? '1' : '',
    cron: source.cron ?? '',
    tags: source.tags?.join(',') ?? '',
    newConfig: source.configMode === 'existing' ? '0' : '1',
    configId: source.configId || undefined,
    isMulti: '1',
    loginTemplete: '',
    entryTypeId: source.mainTable || undefined,
    params: [],
    reqLogin: '0',
  }
}

// 类型化接口：每个方法一一对应一个真实 /v1 端点。后续按 142 个端点逐域补全。
export const sourceApi = {
  sourcePaged: async (p?: PageQuery) => {
    const ids = Array.isArray(p?.sourceIds) ? p.sourceIds.join(',') : (p?.sourceIds ?? p?.ids)
    const state = p?.state === 'all' ? undefined : p?.state
    const result = await request<unknown>('source/sourcePaged', p, {
      method: 'POST',
      httpEndpoint: 'source/sourcePaged',
      httpParams: {
        pageNo: p?.page ?? 1,
        pageSize: p?.size ?? 20,
        page: p?.page ?? 1,
        limit: p?.size ?? 20,
        ids,
        siteId: p?.siteId,
        sourceId: p?.sourceId,
        name: p?.name ?? p?.keyword,
        sourceUrl: p?.sourceUrl,
        entryTypeId: p?.entryTypeId,
        configId: p?.configId,
        count: p?.count,
        dataDate: p?.dataDate,
        enable: p?.enable,
        state,
        categorys: p?.categorys ?? p?.category,
        cron: p?.cron,
        topic: p?.topic,
        notify: p?.notify ?? '',
        groupBy: p?.groupBy,
        sorted: p?.sorted ?? -1,
        tags: p?.tags ?? [],
        field: p?.field,
        type: p?.type,
      },
    })
    return sourcePageFromLegacy(result)
  },
  sourceDetail: async (sourceId: string) => {
    const result = await request<unknown>('source/sourceDetail', { sourceId }, {
      method: 'GET',
      httpEndpoint: 'source/sourceDetail',
      httpParams: { sourceId },
    })
    return result ? sourceFromLegacy(result) : null
  },
  // 旧分类接口首屏只返回根节点；展开节点时按 parentId 懒加载子级。
  sourceCategories: async (parentId?: string) => {
    const result = await request<unknown>('source/categoryTree', { parentId }, {
      method: 'GET',
      httpEndpoint: 'category/categoryPaged',
      httpParams: { page: 1, limit: 10000, allSub: false, parentId },
    })
    return sourceCategoriesFromLegacy(result)
  },
  sourceStats: () => assetMockRequest<{ total: number; error: number; externalChanged: number; disabled: number }>('source/stats'),
  sourceSteps: async (sourceId: string) => {
    const result = await request<unknown>('item/next/nextConfigPaged', { sourceId }, {
      method: 'GET',
      httpEndpoint: 'item/next/nextConfigPaged',
      httpParams: { sourceId, page: 1, limit: 10000, svg: true },
    })
    return sourceStepsFromLegacy(result, sourceId)
  },

  // 写类 / 高危端点：首期 mock 仅回执，UI 统一二次确认占位（呼应权威方案读写边界）。
  changeSourceEnable: (sourceId: string, disabled: boolean) =>
    assetMockRequest<Ack>('source/changeSourceEnable', { sourceId, disabled }),
  // 改为成功状态（0707 Review #1 修复：端点已登记但此前未封装，SourceTab 曾误用 changeSourceEnable）。
  // 注：endpoints.ts:54 只登记 path 无参数契约，按单源封装；批量场景由调用方循环（见 SourceTab.onOperate）。
  changeToSuccess: (sourceId: string) => assetMockRequest<Ack>('source/changeToSuccess', { sourceId }),
  copySource: (sourceId: string) => assetMockRequest<Ack>('source/copySource', { sourceId }),
  /** 发起抓取；真实执行器的登录配置选择参数待 P0 契约确认，当前只沿用旧 sourceIds 请求。 */
  sendSnatch: (sourceIds: string[]) =>
    assetMockRequest<Ack>('source/sendSnatch', { sourceIds }),
  /** 将已创建的真实源关联到网站；真实端点，调用方需在同一环境完成受控写入。 */
  bindSite: async (sourceId: string, siteId: string): Promise<Ack> => {
    const result = await request<unknown>('source/bindSite', { sourceId, siteId }, {
      method: 'GET',
      httpEndpoint: 'source/bindSite',
      httpParams: { sourceId, siteId },
    })
    return ackFromApiResult(result)
  },
  /** 批量把已有源关联/迁到某个网站（0812 计划 M4-5，bindSite 的多源版）；真实端点，调用方需在
   *  同一环境完成受控写入。2026-08-15 生产环境实测确认（Q4）：批次里混无效源 ID 不会导致整批
   *  失败，会静默跳过继续处理有效项，响应只有整批一个 success，没有逐条结果。 */
  changeSite: async (sourceIds: string[], siteId: string): Promise<Ack> => {
    const result = await request<unknown>('source/changeSite', { ids: sourceIds, siteId }, {
      method: 'GET',
      httpEndpoint: 'source/changeSite',
      httpParams: { ids: sourceIds.join(','), siteId },
    })
    return ackFromApiResult(result)
  },
  /** 旧平台新建源的一次性提交；请求体字段严格沿用 Step1/2/3 的 snatchSave 契约。 */
  snatchSaveAll: (payload: LegacySnatchSaveRequest) => legacySnatchSaveRequest(payload),
  /** 从当前画布生成旧请求体；请求体字段仍按旧平台命名，待 P0 确认后由明确的新建源动作调用。 */
  snatchSaveFromFlow: (def: FlowDef, loginSubmission?: LegacyLoginSubmission) => {
    const payload = legacySnatchSavePayloadFromFlow(def, loginSubmission)
    assertLegacySnatchSaveLogin(payload)
    return legacySnatchSaveRequest(payload)
  },
  deleteSource: (sourceIds: string[]) => assetMockRequest<Ack>('source/deleteSource', { sourceIds }),
  sourceLogs: (sourceId: string) => assetMockRequest<SourceLog[]>('source/logPaged', { sourceId }),
  sourceTasks: (sourceId: string) => assetMockRequest<TaskInst[]>('task/topTaskPaged', { sourceId }),
  sourceTaskPaged: (q: SourceTaskQuery) => assetMockRequest<Paged<TaskInst>>('source/sourceTaskPaged', q),
  credentialRef: (refId: string) => assetMockRequest<CredentialRef | null>('source/credentialDetail', { refId }),
  // 批量导入（0707 Review #3 修复：deep/dir 此前被前端丢弃，现透传）。
  batchImport: (template: string, lines: string, opts?: { deep?: boolean; dir?: string }) =>
    assetMockRequest<Ack>('source/batchImport', { template, lines, deep: opts?.deep ?? false, dir: opts?.dir ?? '' }),
  batchModifyConfig: (sourceIds: string[], configId: string) => assetMockRequest<Ack>('source/batchModifyConfig', { sourceIds, configId }),
  batchSchedule: (sourceIds: string[]) => assetMockRequest<Ack>('source/createJobs', { sourceIds }),
  changeFreqTag: (sourceIds: string[], freqTag: string) => assetMockRequest<Ack>('source/changeFreqTag', { sourceIds, freqTag }),
  markVerified: (sourceIds: string[], verified: string) => assetMockRequest<Ack>('source/markVerified', { sourceIds, verified }),
  generateConfig: (sourceId: string) => assetMockRequest<Ack>('source/generateConfig', { sourceId }),

  // 新建采集源两段式闸门（0706 优化·Phase3）
  sourceCreate: (source: Source) => assetMockRequest<{ ok: boolean; message?: string; sourceId?: string }>('source/createSource', { source }),
  sourceCopy: (fromId: string) => assetMockRequest<Source | null>('source/sourceCopy', { sourceId: fromId }),
  // 源信息编辑抽屉 + 任务视图（0706 优化·Phase4）
  sourceUpdate: (source: Source) => assetMockRequest<Ack>('source/updateSource', { source }),
  sourceNodeRuns: (sourceId: string) => assetMockRequest<NodeRunStat[]>('source/nodeRunStats', { sourceId }),
  // 数据表页选源下拉（E 包）：同站源列表，sourceId 可空
  sourceSame: async (sourceId?: string) => {
    const result = await request<unknown>('source/sourceSame', { sourceId }, {
      method: 'GET',
      httpEndpoint: 'source/sourceSame',
      httpParams: { sourceId },
    })
    return (Array.isArray(result) ? result : []).map(sourceOptionFromLegacy)
  },
}

// 网站表选择（0812 计划 M2-1）：config/queryEntryTypesGroup 支持逗号分隔的 sourceId，
// 一个网站只请求一次目录，避免为每个源重复请求同一份表目录。网站范围只在选表后的真实
// 数据查询阶段通过 entryDistinctSource + siteSources（失败/空结果时回退逐源查询）判断。
const siteTablesCache = new Map<string, Promise<SiteTablesResult>>()

async function loadSiteTables(
  siteId: string,
  onProgress?: (tables: SiteTableOption[]) => void,
): Promise<SiteTablesResult> {
  const tableMap = new Map<string, SiteTableOption>()
  const sources = await siteApi.siteSources(siteId)
  const sourceIds = sources.map((source) => source.sourceId.trim()).filter(Boolean)
  if (!sourceIds.length) {
    onProgress?.([])
    return { tables: [], sourceCount: 0, overThreshold: false, failedSourceIds: [] }
  }
  const group = await dataApi.entryTypesGroup(sourceIds.join(','))
  for (const entry of [...group.list1, ...group.list2, ...group.list3]) {
    if (!tableMap.has(entry.tableId)) {
      tableMap.set(entry.tableId, { tableId: entry.tableId, tableName: entry.tableName, name: entry.name })
    }
  }
  const tables = [...tableMap.values()]
  onProgress?.(tables)
  return { tables, sourceCount: sourceIds.length, overThreshold: false, failedSourceIds: [] }
}

// 网站—源父子模型（0707 优化·Phase2）：网站=统一流程模板+批量工具（不运行），源=运行实体
export const siteApi = {
  sitePaged: async (p?: PageQuery) => {
    const state = String(p?.state ?? '')
    const result = await request<Paged<unknown>>('site/sitePaged', p, {
      method: 'POST',
      httpParams: {
        page: p?.page ?? 1,
        limit: p?.size ?? 20,
        name: p?.keyword || undefined,
        state: state === 'error' ? 'ERROR' : undefined,
      },
    })
    return sitePageFromLegacy(result)
  },
  siteSummary: async (): Promise<SiteSummary> => {
    const result = await request<unknown>('site/summary', undefined, { method: 'GET' })
    return siteSummaryFromLegacy(result)
  },
  siteDetail: async (siteId: string) => {
    const result = await request<unknown>('site/siteDetail', { siteId }, {
      method: 'GET',
      httpEndpoint: 'site/detail',
      httpParams: { siteId },
    })
    return result ? siteFromLegacy(result) : null
  },
  /**
   * 页面仍提交网站和首批源；真实适配层拆成 site/add → snatchSave → bindSite。
   * site/add 不标记为默认 live，避免本地默认测试代理误触发建站；生产联调需显式切到 HTTP + 118 环境。
   */
  siteCreate: async (site: Site, sources: Source[] = []): Promise<SiteCreateResult> => {
    if (isMockMode()) {
      return assetMockRequest<SiteCreateResult>('site/createSite', { site, sources })
    }
    if (!isMockMode() && import.meta.env.VITE_SITE_CREATE_TARGET !== 'production') {
      return { ok: false, message: '新建网站仅允许生产环境，请设置 VITE_SITE_CREATE_TARGET=production' }
    }

    const siteName = site.name.trim()
    const sitePayload: SiteCreateInput = {
      siteName,
      stdSiteName: siteName,
      categoryId: site.dirId && /^\d+$/.test(site.dirId) ? Number(site.dirId) : undefined,
    }
    const result = await request<unknown>('site/createSite', sitePayload as unknown as Record<string, unknown>, {
      method: 'POST',
      httpEndpoint: 'site/add',
      httpParams: sitePayload as unknown as Record<string, unknown>,
    })

    const siteAck = ackFromApiResult(result)
    if (!siteAck.ok) return siteAck
    let siteId = idFromApiResult(result, ['siteId', 'siteID', 'siteid', 'id'])
    if (!siteId) {
      const matched = (await siteApi.sitePaged({ keyword: siteName, page: 1, size: 20 })).list
        .filter((item) => item.name.trim() === siteName)
      if (matched.length !== 1) {
        return {
          ...siteAck,
          ok: false,
          message: matched.length > 1
            ? `网站「${siteName}」回查到多个同名结果，未继续保存源`
            : `网站「${siteName}」已创建，但未能回查 siteId，未继续保存源`,
        }
      }
      siteId = matched[0].siteId
    }

    let firstSourceId: string | undefined
    for (const source of sources) {
      let saved: LegacySnatchSaveResult
      try {
        saved = await legacySnatchSaveRequest(legacySnatchSavePayloadFromSource(site, source))
      } catch (error) {
        return {
          ok: false,
          siteId,
          message: `网站「${siteName}」已创建，但源「${source.name}」保存请求失败：${(error as Error).message ?? '未知错误'}`,
        }
      }
      if (!saved.ok) {
        return { ...saved, ok: false, siteId, message: saved.message || `源「${source.name}」保存失败，网站已创建` }
      }
      const sourceId = saved.sourceId
      if (!sourceId) {
        return { ok: false, siteId, message: `源「${source.name}」已提交，但未能解析 sourceId，未继续关联网站` }
      }
      firstSourceId ||= sourceId
      let bound: Ack
      try {
        bound = await sourceApi.bindSite(sourceId, siteId)
      } catch (error) {
        return {
          ok: false,
          siteId,
          sourceId,
          message: `网站「${siteName}」和源「${source.name}」已创建，但关联网站请求失败：${(error as Error).message ?? '未知错误'}`,
        }
      }
      if (!bound.ok) {
        return { ...bound, ok: false, siteId, sourceId, message: bound.message || `源「${source.name}」已创建，但关联网站失败` }
      }
    }
    return {
      ...siteAck,
      ok: true,
      message: sources.length ? '网站、源已按顺序保存并完成关联' : '网站已创建',
      siteId,
      sourceId: firstSourceId,
    }
  },
  siteUpdate: (site: Pick<Site, 'siteId' | 'name' | 'category' | 'categoryPath' | 'owner'>) =>
    assetMockRequest<Ack>('site/updateSite', { site }),
  siteSources: async (siteId: string) => {
    const result = await request<Paged<unknown> | Source[]>('site/sourcesOfSite', { siteId }, {
      method: 'GET',
      httpEndpoint: 'site/sources',
      httpParams: { siteId, page: 1, limit: 1000 },
    })
    const list = Array.isArray(result) ? result : result.list
    return list.map(siteSourceFromLegacy)
  },
  // 网站范围表聚合（M2-1）：同一 siteId 的并发/重复调用共享同一个进行中的请求；
  // 只有触发首次请求的调用方能实时收到 onProgress，后到的调用方直接等最终结果。
  siteTables: (siteId: string, options: { onProgress?: (tables: SiteTableOption[]) => void; force?: boolean } = {}) => {
    if (options.force) siteTablesCache.delete(siteId)
    let cached = siteTablesCache.get(siteId)
    if (!cached) {
      cached = loadSiteTables(siteId, options.onProgress)
      siteTablesCache.set(siteId, cached)
      cached.catch(() => siteTablesCache.delete(siteId)) // 失败态不缓存，允许下次重试
    } else if (options.onProgress) {
      const notify = options.onProgress
      cached.then((result) => notify(result.tables)).catch(() => {})
    }
    return cached
  },
  refreshSiteTables: (siteId: string) => {
    siteTablesCache.delete(siteId)
  },
  // 新增源默认从空白流程开始；inherit=true 仅保留给旧数据迁移兼容场景。
  sourceAdd: (siteId: string, source: Source, inherit = false) =>
    assetMockRequest<{ ok: boolean; message?: string; sourceId?: string }>('site/addSource', { siteId, source, inherit }),
  cloneSource: (requestBody: SourceCloneRequest) =>
    assetMockRequest<SourceCloneResult>('site/cloneSource', requestBody as unknown as Record<string, unknown>),
  sourceRemove: (siteId: string, sourceId: string) => assetMockRequest<Ack>('site/removeSource', { siteId, sourceId }),
  // 按网站批量导入源：一行一条「名称;URL」，导入后从空白流程开始。
  siteImportSources: (siteId: string, lines: string) =>
    assetMockRequest<{ ok: boolean; message?: string; added?: number; skipped?: number }>('site/importSources', { siteId, lines }),
  // 危险端点：把源头已保存的流程整条覆盖到同网站所选源，UI 走多选列表 + 危险确认
  siteSyncFlow: (siteId: string, fromSourceId: string, sourceIds: string[]) =>
    assetMockRequest<Ack>('site/syncFlow', { siteId, fromSourceId, sourceIds }),
  // 任务视图网站化（0707 优化·Phase5）：队列汇总 + 展开明细，sourceId 可选收窄到单个源
  siteQueueStats: (siteId: string, sourceId?: string) => assetMockRequest<QueueStat[]>('site/queueStats', { siteId, sourceId }),
  queueTaskPaged: (q: { siteId: string; queue: string; sourceId?: string; state?: string; page?: number; size?: number }) =>
    assetMockRequest<Paged<TaskInst>>('site/queueTaskPaged', q),
}

/** 保存后 list/compose 回查数字 ruleId（旧页 F() 刷列表的等价） */
async function fetchNewestComposeRuleId(cfg: RuleOrchestration): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = readStoredToken()
  if (token) headers[ACCESS_TOKEN_HEADER] = token
  const res = await fetch('/vrule/ai/dashscope/list/compose', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ pageNum: 1, pageSize: 30, ruleType: '数据处理' }),
  })
  if (!res.ok) throw new Error(`回查规则列表失败 ${res.status}`)
  const payload = (await res.json()) as { records?: unknown }
  const ruleId = pickRuleIdFromComposeList(payload.records, cfg)
  if (!ruleId) throw new Error('业务规则已保存，但未能解析 ruleId，请确认规则名称后重试')
  return ruleId
}

/** vrule 文本响应（GET dashscope/code 返回纯文本，不能走 request 的 JSON 解析） */
async function fetchVruleText(url: string, init?: RequestInit): Promise<string> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) }
  const token = readStoredToken()
  if (token) headers[ACCESS_TOKEN_HEADER] = token
  const res = await fetch(url, { credentials: 'include', ...init, headers })
  if (isSessionExpiredRedirect(res)) {
    triggerSessionExpired()
    throw new Error('登录失效,请重新登录')
  }
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.text()).trim() } catch { /* ignore */ }
    throw new Error(detail ? `请求失败 ${res.status}: ${detail.slice(0, 200)}` : `请求失败 ${res.status}`)
  }
  return res.text()
}

/** 规则编排生成脚本：流式读 /vrule/ai/dashscope/stream（对齐旧页 Rt，非 JSON） */
async function fetchRuleOrchestrationStream(
  ruleCfg: RuleOrchestration,
  externalSignal?: AbortSignal,
): Promise<RuleOrchestrationGenerateResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  const token = readStoredToken()
  if (token) headers[ACCESS_TOKEN_HEADER] = token
  const controller = new AbortController()
  const onExternalAbort = () => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }
  // 生成可能较慢，放宽到 120s（旧页无超时，仅 AbortController 取消）
  const timeout = window.setTimeout(() => controller.abort(), 120_000)
  let res: Response
  try {
    res = await fetch('/vrule/ai/dashscope/stream', {
      method: 'POST',
      credentials: 'include',
      headers,
      body: ruleOrchestrationGenerateFormBody(ruleCfg),
      signal: controller.signal,
    })
  } finally {
    window.clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
  if (isSessionExpiredRedirect(res)) {
    triggerSessionExpired()
    throw new Error('登录失效,请重新登录')
  }
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.text()).trim()
    } catch { /* ignore */ }
    throw new Error(detail ? `请求失败 ${res.status}: ${detail.slice(0, 200)}` : `请求失败 ${res.status}`)
  }
  let text = ''
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } else {
    text = await res.text()
  }
  return parseRuleOrchestrationStreamText(text)
}

// 规则资产（M3）
export const ruleApi = {
  ruleGroups: () => request<RuleGroup[]>('rule/groupTree'),
  rulePaged: (p?: PageQuery) => request<Paged<Rule>>('rule/rulePaged', p),
  ruleStats: () => request<{ groups: number; exprs: number; sharedConfigs: number; passRate: string }>('rule/stats'),
  gateSummary: () =>
    request<{ syntaxFail: number; referenceWarn: number; batchTestPassRate: number; pendingCount: number }>(
      'rule/gateSummary',
    ),
  sharedConfigs: () => request<SharedConfig[]>('rule/sharedConfigPaged'),
  testCases: (ruleId: string) => request<RuleTestCase[]>('rule/testCasePaged', { ruleId }),
  evaluate: (expr: string, context: string) => request<EvalResult>('rule/evaluate', { expr, context }),
  // 编排列表（0803 追加）：真实端点 POST /vrule/ai/dashscope/list/compose 已核实存在（对照
  // vanv-rule-center-main 源码），仅用于给规则名称 combobox 提供候选、按需拉一页，不做服务端关键词搜索
  // （该接口的 customQuery 是对 nlDescribe 的精确 eq，不支持按名称模糊查）。
  orchestrationPaged: async (p?: PageQuery) => {
    const endpoint = 'rule/orchestrationPaged'
    const opts = {
      method: 'POST' as const,
      httpEndpoint: '/vrule/ai/dashscope/list/compose',
      httpParams: { pageNum: p?.page ?? 1, pageSize: p?.size ?? 100 },
    }
    if (usesMockAdapter(endpoint, opts)) {
      return request<Paged<RuleOrchestrationItem>>(endpoint, p, { mode: 'mock' })
    }
    try {
      const result = await request<unknown>(endpoint, p, opts)
      return ruleOrchestrationListFromLegacy(result)
    } catch (e) {
      throw e instanceof ApiError ? e : new ApiError(endpoint, e)
    }
  },
  // 0805 追加（恢复 D3 砍掉的「引用已有规则」能力，但按会议原话"新建是新建、选是选"分开做，
  // 不再混进规则名称输入框——见 ConfigTab.vue 的「选择已有规则」按钮）：只列当前登录账号自己的规则，
  // 跟 orchestrationSaveMeta 默认 userCode 口径对齐（同一个人存的规则才该出现在他自己的候选列表里）。
  // 复用 orchestrationPaged，不新增端点；接口不支持按 userCode 服务端过滤，客户端按 size:100 拉一页后过滤。
  orchestrationOwnRules: async (): Promise<RuleOrchestrationItem[]> => {
    const userCode = (readLoginUsername() || 'admin').trim()
    const paged = await ruleApi.orchestrationPaged({ size: 100 })
    return paged.list.filter((item) => item.userCode === userCode)
  },
  // 路径 B 回灌：POST /vrule/api/custom-compose/getComposeById?id=（对齐旧 handleOpenRecord）
  orchestrationDetail: async (ruleId: string) => {
    const endpoint = 'rule/orchestrationDetail'
    const opts = {
      method: 'POST' as const,
      httpEndpoint: '/vrule/api/custom-compose/getComposeById',
      paramsIn: 'query' as const,
      httpParams: { id: ruleId },
    }
    if (usesMockAdapter(endpoint, opts)) {
      const result = await request<unknown>(endpoint, { ruleId }, { mode: 'mock' })
      if (result && typeof result === 'object' && 'describe' in (result as object)) {
        return result as RuleOrchestration
      }
      return ruleOrchestrationDetailFromLegacy(result)
    }
    try {
      const result = await request<unknown>(endpoint, { ruleId }, opts)
      return ruleOrchestrationDetailFromLegacy(result)
    } catch (e) {
      throw e instanceof ApiError ? e : new ApiError(endpoint, e)
    }
  },
  // 读脚本正文：GET /vrule/ai/dashscope/code?file_name=（响应纯文本，非 JSON）
  orchestrationLoadScript: async (scriptPath: string) => {
    const endpoint = 'rule/orchestrationLoadScript'
    const path = scriptPath.trim()
    if (!path) throw new Error('脚本路径为空')
    if (usesMockAdapter(endpoint)) {
      const result = await request<unknown>(endpoint, { scriptPath: path }, { mode: 'mock' })
      return String(result ?? '')
    }
    try {
      return await fetchVruleText(`/vrule/ai/dashscope/code?file_name=${encodeURIComponent(path)}`, { method: 'GET' })
    } catch (e) {
      throw e instanceof ApiError ? e : new ApiError(endpoint, e)
    }
  },
  // 路径 A：保存业务规则元数据换 ruleId。
  // mock 收 { cfg, userCode }；live → POST /vrule/api/custom-compose/save。
  // 旧页保存成功不读响应体、只刷列表；响应无 id 时再 GET list/compose 按名称回查。
  orchestrationSaveMeta: async (cfg: RuleOrchestration, userCode?: string) => {
    const resolvedUser = (userCode || readLoginUsername() || 'admin').trim()
    const endpoint = 'rule/orchestrationSaveMeta'
    const opts = {
      method: 'POST' as const,
      httpEndpoint: '/vrule/api/custom-compose/save',
      httpParams: ruleOrchestrationSaveMetaToLegacy(cfg, resolvedUser),
    }
    if (usesMockAdapter(endpoint, opts)) {
      const result = await request<unknown>(endpoint, { cfg, userCode: resolvedUser }, { mode: 'mock' })
      return ruleOrchestrationSaveMetaFromLegacy(result, cfg)
    }
    try {
      const result = await request<unknown>(endpoint, { cfg, userCode: resolvedUser }, opts)
      try {
        return ruleOrchestrationSaveMetaFromLegacy(result, cfg)
      } catch {
        // 响应无 ruleId：对齐旧页刷列表回查
        const ruleId = await fetchNewestComposeRuleId(cfg)
        return { ruleId, message: '业务规则保存成功' }
      }
    } catch (e) {
      throw e instanceof ApiError ? e : new ApiError(endpoint, e)
    }
  },
  // 传整个 ruleCfg：mock 按 inputFields/outputFields 生成多参骨架。
  // 真实：POST /vrule/ai/dashscope/stream（form-urlencoded + 流式文本，见 rule-orchestration 页 Rt）。
  // 注意：saveMeta 未 live 时拿到的是 orch-* mock id，真实 stream 会 400——此时回退 mock 生成。
  orchestrationGenerate: async (ruleCfg: RuleOrchestration, signal?: AbortSignal) => {
    const endpoint = 'rule/orchestrationGenerate'
    const useMock = usesMockAdapter(endpoint) || !isVruleNumericRuleId(ruleCfg.ruleId)
    if (useMock) {
      const result = await request<unknown>(endpoint, { ruleCfg }, { mode: 'mock' })
      if (result && typeof result === 'object' && 'script' in (result as object)) {
        return result as RuleOrchestrationGenerateResult
      }
      return ruleOrchestrationGenerateFromLegacy(result)
    }
    try {
      return await fetchRuleOrchestrationStream(ruleCfg, signal)
    } catch (e) {
      if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError') || (e as Error)?.name === 'AbortError') {
        throw e instanceof ApiError ? e : new ApiError(endpoint, new Error('已取消生成'))
      }
      throw e instanceof ApiError ? e : new ApiError(endpoint, e)
    }
  },
  // req → 旧体 { rule_id, params, timeout }；响应 result 数组 → outputs（0801 §4.4）
  orchestrationTest: async (req: RuleOrchestrationTestRequest) => {
    const endpoint = 'rule/orchestrationTest'
    const opts = {
      method: 'POST' as const,
      httpEndpoint: '/vrule/fastapi/execute/dynamic',
      httpParams: ruleOrchestrationTestToLegacy(req),
    }
    const result = await request<unknown>(endpoint, { ...req }, opts)
    // mock 已是新体；http 为旧体。用 success/outputs 判别，避免双重包装
    if (result && typeof result === 'object' && 'outputs' in (result as object)) {
      return result as RuleOrchestrationTestResult
    }
    return ruleOrchestrationTestFromLegacy(result)
  },
  orchestrationSave: async (ruleCfg: RuleOrchestration) => {
    const result = await request<unknown>('rule/orchestrationSave', { ruleCfg }, {
      method: 'POST',
      httpEndpoint: '/vrule/ai/dashscope/script/edit',
      // format 缺省即 'python'（规则节点零回归）；采集节点抓取配置传 'xml'，codeFileName 后缀跟着纠正（S3-2/S3-3）
      httpParams: ruleOrchestrationSaveScriptToLegacy(ruleCfg, ruleCfg.format ?? 'python'),
    })
    if (result && typeof result === 'object' && 'scriptPath' in (result as object) && 'ruleId' in (result as object)) {
      return result as RuleOrchestrationSaveResult
    }
    return ruleOrchestrationSaveScriptFromLegacy(result, ruleCfg)
  },

  // 写类 / 重操作：mock 仅回执，UI 二次确认占位
  publishRule: (ruleId: string) => request<Ack>('rule/publish', { ruleId }),
  runBatchTest: (ruleId: string) => request<Ack>('rule/runBatchTest', { ruleId }),
}

// 指标中心（M4）
export const metricApi = {
  datasets: () => request<Dataset[]>('dataset/datasetPaged'),
  measures: (datasetId?: string) => request<Measure[]>('measure/measurePaged', { datasetId }),
  metricStats: () =>
    request<{ datasets: number; measures: number; canvasRefs: number; sqlPending: number }>('measure/stats'),
}

// 结果视图查询载荷组装（entryDataPaged/entryDistinctSource/summaryEntryData/exportUrl 共用，
// 避免四处口径漂移——见「单表数据查看迁移」方案 §3.1）
// 真实联调实测（2026-07-31）：entryType/entryId/sourceId/configId 这类系统指针字段，
// 后端非 AES 的 POST JSON 接口（saveEntryOne/entryUpdate 等）按 Integer 反序列化，
// 字符串会报 Integer 转换异常；此处对 entryType 一并数值化仅为口径统一防御，
// 不改变 entryClearParent 的"业务类型不存在"报错（该报错已排除类型/字段名问题，
// 是后端接口内部问题，详见联调发现文档第 3 节）。
// 业务字段（K1.. 动态列/state/more 等）类型不定，不做转换。
function numericId(value: unknown): unknown {
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return value
}

function escapeLegacySqlString(value: string) {
  return value.replaceAll("'", "''")
}

function buildLegacyMore(q: RowQuery) {
  const parts: string[] = []
  if (q.startTime) parts.push(`CREATE_DT >= '${escapeLegacySqlString(q.startTime)}'`)
  if (q.endTime) parts.push(`CREATE_DT <= '${escapeLegacySqlString(q.endTime)}'`)
  if (q.sql?.trim()) parts.push(q.startTime || q.endTime ? `(${q.sql.trim()})` : q.sql.trim())
  return parts.join(' AND ') || undefined
}

function buildLegacyRowQuery(q: RowQuery) {
  return {
    page: q.page ?? 1,
    limit: q.size ?? 20,
    entryType: numericId(q.tableId),
    sourceId: q.sourceId,
    entryId: q.dataId,
    parentId: q.parentId,
    // 多选由调用方 join(',') 传入；旧 AES 载荷无值时不带该键（不兜底 'ALL'，见方案开放项 2）
    state: q.state || undefined,
    nextFlag: q.nextFlag,
    // SQL 条件的旧后端字段名是 more（不是 sql）；发错会被后端静默忽略，筛选失效。
    // 时间范围同样合并进 more，保留旧端点和 AES 载荷契约。
    min: q.sql ? q.min || 0 : q.min,
    max: q.max,
    more: buildLegacyMore(q),
    // 对照真实源码 EntryList2.vue：该页排序一律走 field/type 数值化 hack（含 ENTRY_ID 本身），
    // sorted 恒为 '0'；entry.js 里 sortField==='ENTRY_ID' 触发 sorted±1 的分支是给另一套表格组件
    // （s-table/AntD sorter）准备的，此页从不设置 sortField/sortOrder，是死分支，不迁移。
    sorted: '0',
    field: q.sortField ? `(${q.sortField}+ 0)` : undefined,
    type: q.sortField ? (q.sortOrder === 'descend' ? ' DESC ' : ' ASC ') : undefined,
    enable: '0',
  }
}

async function rowQueryPagedAt(
  logicalEndpoint: string,
  q: RowQuery,
  options: DataRequestOptions = {},
): Promise<Paged<DataRow>> {
  const result = await request<Paged<unknown>>(logicalEndpoint, q, {
    method: 'POST',
    ...options,
    httpEndpoint: 'entry/entryDataPaged',
    httpParams: { data: encryptLegacyPayload(buildLegacyRowQuery(q)) },
  })
  return { total: result.total, list: result.list.map(dataRowFromLegacy) }
}

function escapeFileResourceLike(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "''").replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function fileResourceSql(q: FileResourceQuery): string | undefined {
  const parts: string[] = []
  if (q.fileName?.trim()) {
    const value = escapeFileResourceLike(q.fileName.trim())
    parts.push(`(K1 LIKE '%${value}%' OR K6 LIKE '%${value}%')`)
  }
  if (q.ext?.trim()) {
    const value = escapeFileResourceLike(q.ext.trim().replace(/^\./, ''))
    parts.push(`K7 LIKE '%${value}%'`)
  }
  return parts.join(' AND ') || undefined
}

function fileResourceFromDataRow(row: DataRow): FileResourceRecord {
  return {
    dataId: row.dataId,
    sourceId: row.sourceId,
    state: row.state,
    createDt: row.createDt,
    updateDt: row.updateDt,
    fileId: row.fileId,
    values: row.values ?? {},
  }
}

// 数据查看（M4）
type DataRequestOptions = { mode?: 'mock' | 'http' }
export interface EntryDataImportInput {
  file: File
  tableId: string
  sourceId: string
  configId: string
}
export interface EntryDataImportResult {
  success: boolean
  message?: string
}

async function importEntryData(input: EntryDataImportInput): Promise<EntryDataImportResult> {
  const endpoint = 'entry/batch/uploadData'
  const options = { method: 'POST' as const, httpEndpoint: endpoint }
  if (usesMockAdapter(endpoint, options)) {
    return request<EntryDataImportResult>(endpoint, {
      fileName: input.file.name,
      tableId: input.tableId,
      sourceId: input.sourceId,
      configId: input.configId,
    }, { mode: 'mock' })
  }

  const form = new FormData()
  form.append('file', input.file)
  form.append('entryTypeId', input.tableId)
  form.append('sourceId', input.sourceId)
  form.append('configId', input.configId)
  const headers: Record<string, string> = {}
  const token = readStoredToken()
  if (token) headers[ACCESS_TOKEN_HEADER] = token
  try {
    const response = await fetch(BASE_URL + endpoint, { method: 'POST', credentials: 'include', headers, body: form })
    if (isSessionExpiredRedirect(response)) {
      triggerSessionExpired()
      throw new Error('登录失效,请重新登录')
    }
    const payload = await response.json().catch(() => null) as { success?: unknown; msg?: unknown; message?: unknown } | null
    if (!response.ok) throw new Error(String(payload?.msg ?? payload?.message ?? `请求失败 ${response.status}`))
    return {
      success: Boolean(payload?.success),
      message: String(payload?.msg ?? payload?.message ?? (payload?.success ? '导入成功' : '导入失败')),
    }
  } catch (error) {
    throw error instanceof ApiError ? error : new ApiError(endpoint, error)
  }
}

export const dataApi = {
  // 选表分组（旧 EntryTypeSelectMulti 分组下拉的数据源）；sourceId 可空
  entryTypesGroup: async (sourceId?: string) => {
    const result = await request<unknown>('data/entryTypesGroup', { sourceId }, {
      method: 'GET',
      httpEndpoint: 'config/queryEntryTypesGroup',
      httpParams: sourceId ? { sourceId } : {},
    })
    return entryTypeGroupFromLegacy(result)
  },
  tables: async (): Promise<DataTableMeta[]> => {
    // group.main 不是列表（是默认选中的 entryTypeId 标量），真正的三个分组是 list1/list2/list3
    const group: EntryTypeGroup = await dataApi.entryTypesGroup()
    return [...group.list1, ...group.list2, ...group.list3].map(dataTableFromLegacy)
  },
  rows: async (tableId: string) => (await dataApi.rowQueryPaged({ tableId, page: 1, size: 100 })).list,
  // 结果视图：按表 + 多条件 + 分页（独立端点，避免影响 /data 全局数据页）
  rowQueryPaged: (q: RowQuery, options: DataRequestOptions = {}) => rowQueryPagedAt('data/rowQueryPaged', q, options),
  tableMeta: async (tableId: string, options: DataRequestOptions = {}) => {
    // 对照真实源码 loadEntryTypeDetail：res.data 就是扁平的实体表记录（含 items[]），
    // curEntryType 只是旧前端本地变量名，响应体里没有这层包装，不需要解包
    const result = await request<unknown>('data/tableMeta', { tableId }, {
      method: 'GET',
      ...options,
      httpEndpoint: 'entry/queryEntryType',
      httpParams: { type: tableId },
    })
    return result ? dataTableFromLegacy(result) : null
  },
  dataStats: async () => {
    const tables = await dataApi.tables()
    return { tables: tables.length, rows: tables.reduce((sum, table) => sum + table.rowCount, 0), chars: 0, review: 0 }
  },
  // 结果视图行编辑（Phase 4.4）
  rowUpdate: (tableId: string, dataId: string, values: Record<string, unknown>) =>
    // 方案 §1.1：真实载荷是大写 {ENTRY_ID, ENTRY_TYPE_ID, K1...}（不是 entryTypeId/entryId）；数值化见 numericId。
    request<{ message?: string; row?: DataRow }>('data/rowUpdate', { tableId, dataId, values }, {
      method: 'POST',
      httpEndpoint: 'entry/entryUpdate',
      httpParams: { ...values, ENTRY_TYPE_ID: numericId(tableId), ENTRY_ID: numericId(dataId) },
    }),
  // 数据详情：entryId + type（非 entryTypeId），返回行 + showItems + subs
  rowDetail: async (tableId: string, dataId: string): Promise<EntryDetail | null> => {
    const result = await request<unknown>('data/rowDetail', { tableId, dataId }, {
      method: 'GET',
      httpEndpoint: 'entry/entryDetail',
      httpParams: { entryId: dataId, type: tableId },
    })
    return result ? entryDetailFromLegacy(result) : null
  },
  // 提取去重源 ID：与分页查询同款字段（含 sorted/min 同款预处理），复用 buildLegacyRowQuery 避免口径漂移
  distinctSource: async (q: RowQuery): Promise<string[]> => {
    const result = await request<unknown>('data/distinctSource', q, {
      method: 'GET',
      httpEndpoint: 'entry/entryDistinctSource',
      httpParams: buildLegacyRowQuery(q),
    })
    return Array.isArray(result) ? result.map(String) : []
  },
  // 统计：POST JSON 未加密（旧代码注释掉了 AES），结果全部本地排序，不做服务端分页
  summaryData: async (q: RowQuery, summaryFields: string[]): Promise<SummaryRow[]> => {
    const result = await request<unknown>('data/summaryData', q, {
      method: 'POST',
      httpEndpoint: 'entry/summaryEntryData',
      httpParams: { ...buildLegacyRowQuery(q), page: 1, summaryFields: summaryFields.join(', ') },
    })
    const list = Array.isArray(result) ? result : ((result as Paged<unknown> | null)?.list ?? [])
    return list.map(summaryRowFromLegacy)
  },
  // 任务实例分页（方案 §1.6-5 TaskInst）：GET，参数按旧 page/limit 口径（task.js 内部由 pageNo/pageSize 映射而来）
  taskInstPaged: async (q: TaskInstQuery): Promise<{ total: number; list: TaskInst[] }> => {
    const result = await request<unknown>('data/taskInstPaged', q, {
      method: 'GET',
      httpEndpoint: 'task/topTaskPaged',
      httpParams: {
        page: q.page ?? 1, limit: q.size ?? 20,
        taskId: q.taskId, sourceId: q.sourceId, configId: q.configId,
        parentId: q.parentId, fileId: q.fileId, taskSpecId: q.taskSpecId, state: q.state,
      },
    })
    const list = Array.isArray(result) ? result : ((result as Paged<unknown> | null)?.list ?? [])
    const total = Array.isArray(result) ? list.length : ((result as Paged<unknown> | null)?.total ?? list.length)
    return { total, list: list.map(taskInstFromLegacy) }
  },
  // 重发任务实例：ids 逗号连接（危险，endpoints.ts 已登记 danger:true）
  resendTask: (taskIds: string[]) =>
    request<{ message?: string }>('data/resendTask', { taskIds }, {
      method: 'GET',
      httpEndpoint: 'task/resetTaskInsts',
      httpParams: { ids: taskIds.join(',') },
    }),
  // 发选中/本页后续：entryIds 逗号连接（危险）
  nextStep: (sourceId: string, tableId: string, entryIds: string[]) =>
    request<{ message?: string }>('data/nextStep', { sourceId, tableId, entryIds }, {
      method: 'GET',
      httpEndpoint: 'source/nextStep',
      httpParams: { sourceId, entryTypeId: tableId, entryIds: entryIds.join(',') },
    }),
  // 大批量后续：POST AES，180s 超时（危险）
  nextStepBatch: (params: {
    tableId: string; sourceId?: string; state?: string
    size: number; start: number; end?: number; nextFlag?: string; cond?: string
  }) =>
    request<{ message?: string }>('data/nextStepBatch', params, {
      method: 'POST',
      timeoutMs: 180_000,
      httpEndpoint: 'source/nextStep2',
      httpParams: {
        data: encryptLegacyPayload({
          entryTypeId: params.tableId, sourceId: params.sourceId, state: params.state,
          size: params.size, start: params.start, end: params.end,
          nextFlag: params.nextFlag, cond: params.cond,
        }),
      },
    }),
  // 删除：单条/该源/整表 × 当日/全量；key=当前小时数是必带的防呆参数（危险）
  rowDelete: (tableId: string, opts: { sourceId?: string; all: 0 | 1; entryId?: string }) =>
    request<{ success?: number }>('data/rowDelete', { tableId, ...opts }, {
      method: 'GET',
      httpEndpoint: 'entry/entryDelete',
      httpParams: {
        entryTypeId: tableId, sourceId: opts.sourceId, all: opts.all, entryId: opts.entryId,
        key: new Date().getHours(),
      },
    }),
  // 按 IDs 批量删除（危险）
  rowDeleteBatch: (tableId: string, ids: string[]) =>
    request<{ success: number; all: number; not_found: number }>('data/rowDeleteBatch', { tableId, ids }, {
      method: 'POST',
      httpEndpoint: 'entry/entryDeleteBatch',
      httpParams: { ids, entryTypeId: tableId },
    }),
  // 清父表后续标识：整个查询条件 + 选中 ids + flag:'-1'（危险）
  clearParent: (q: RowQuery, ids: string[]) =>
    request<{ message?: string }>('data/clearParent', { ...q, ids }, {
      method: 'POST',
      httpEndpoint: 'entry/entryClearParent',
      httpParams: { ...buildLegacyRowQuery(q), ids, flag: '-1' },
    }),
  // 手动新增：平铺字段体，null 字段提交前删除（危险）
  rowAdd: (tableId: string, values: Record<string, unknown>) => {
    const body: Record<string, unknown> = { ENTRY_TYPE_ID: tableId, ...values }
    Object.keys(body).forEach((key) => { if (body[key] == null) delete body[key] })
    // ENTRY_TYPE_ID/SOURCE_ID/CONFIG_ID 数值化（见 numericId）；动态列(K1..)值类型不定，不转换。
    for (const key of ['ENTRY_TYPE_ID', 'SOURCE_ID', 'CONFIG_ID']) {
      if (key in body) body[key] = numericId(body[key])
    }
    return request<{ message?: string }>('data/rowAdd', { tableId, values }, {
      method: 'POST',
      httpEndpoint: 'entry/batch/saveEntryOne',
      httpParams: body,
    })
  },
  // 旧 UploadData：multipart/form-data，字段名固定为 file / entryTypeId / sourceId / configId。
  importData: (input: EntryDataImportInput) => importEntryData(input),
  // 重新保存原始 JSON：jsonId = 行的 K0（危险）
  reSave: (sourceId: string, jsonId: string) =>
    request<{ message?: string }>('data/reSave', { sourceId, jsonId }, {
      method: 'GET',
      httpEndpoint: 'entry/re-save',
      httpParams: { sourceId, jsonId },
    }),
  // 导出 Excel：旧平台只透传这 5 个查询字段；不把内部查询字段 more 误传给导出接口。
  // 纯 URL 直开，不走 request/axios，由同源 Cookie 完成鉴权。
  exportUrl: (q: RowQuery): string => {
    const built = buildLegacyRowQuery(q)
    return appendQuery(BASE_URL + 'entry/entryExportAll', {
      entryType: built.entryType, sourceId: built.sourceId, state: built.state,
      min: q.min, max: q.max,
    })
  },
}

// 运行记录（M4）
export const runApi = {
  runs: () => request<RunRow[]>('run/runPaged'),
  runNodes: (runId: string) => request<RunNode[]>('run/nodePaged', { runId }),
  runStats: () => request<{ completed: number; failed: number; running: number; ruleHits: number }>('run/stats'),
}

// 监控工具（M4）
export const monitorApi = {
  health: () => request<HealthCard[]>('monitor/health'),
  mq: () => request<MqQueue[]>('mq/queuePaged'),
  sync: () => request<SyncRow[]>('source/check/syncPaged'),
  alarms: () => request<AlarmRow[]>('monitor/alarmPaged'),
  monitorStats: () =>
    request<{ healthText: string; queueAlarms: number; cacheWindow: string; dangerOpen: number }>('monitor/stats'),
}

// 配置列表（M5 采集资产）
export const configApi = {
  configPaged: async (p: PageQuery = {}) => {
    const keyword = String(p.keyword ?? '').trim()
    const httpParams: Record<string, unknown> = {
      ...p,
      page: p.page ?? 1,
      limit: p.size ?? 20,
      size: undefined,
      keyword: undefined,
      state: undefined,
      configId: p.configId ?? (/^\d+$/.test(keyword) ? keyword : undefined),
      name: p.name ?? (!/^\d+$/.test(keyword) ? keyword : undefined),
      enable: p.enable ?? (p.state === 'enabled' ? '0' : p.state === 'disabled' ? '1' : undefined),
      templetCode: p.templateCode,
      templateCode: undefined,
    }
    const result = await request<Paged<unknown>>('config/configPaged', p, { method: 'GET', httpParams })
    return configPageFromLegacy(result)
  },
  configDetail: async (configId: string) => {
    const result = await request<unknown>('config/configDetail', { configId }, { method: 'GET' })
    return result && typeof result === 'object' && !('ok' in result) ? configFromLegacy(result) : null
  },
  updateConfig: (config: Config) =>
    request<Ack>('config/modify/updateConfig', { config }, { method: 'POST', httpParams: configToLegacy(config) }),
  copyAll: (configId: string) => request<Ack>('config/copyAll', { configId }, { method: 'GET', httpParams: { id: configId } }),
  deleteConfig: (configIds: string[] | string) => {
    const ids = Array.isArray(configIds) ? configIds : [configIds]
    return request<Ack>('config/delete', { configIds: ids }, { method: 'GET', httpParams: { ids } })
  },
  sendConfigTask: (configIds: string[] | string) => {
    const ids = Array.isArray(configIds) ? configIds : [configIds]
    return request<Ack>('config/sendConfigTask', { configIds: ids }, { method: 'GET', httpParams: { ids } })
  },
  updateTopic: (configIds: string[] | string, topic: string) => {
    const ids = Array.isArray(configIds) ? configIds : [configIds]
    return request<Ack>('config/updateTopic', { configIds: ids, topic }, { method: 'GET', httpParams: { ids, topic } })
  },
  updateConfigPolicy: (configId: string, policy: Record<string, unknown>) =>
    request<Ack>('config/updateConfigPolicy', { configId, policy }, {
      method: 'POST',
      paramsIn: 'query',
      httpParams: { configId, runPolicy: { snatch: policy } },
    }),
  clearConfig: (configIds: string[] | string) => {
    const ids = Array.isArray(configIds) ? configIds : [configIds]
    return request<Ack>('config/clear', { configIds: ids }, { method: 'GET', httpParams: { ids } })
  },
  changeEnable: (configIds: string[], enabled: boolean) =>
    request<Ack>('config/changeEnable', { configIds, enabled }, {
      method: 'GET',
      httpParams: { ids: configIds, enable: enabled ? 0 : 1 },
    }),
  configParams: async (configId: string, p: PageQuery = {}) => {
    const result = await request<Paged<unknown>>('config/configParams', { configId, ...p }, {
      method: 'GET',
      httpParams: { configId, page: p.page ?? 1, limit: p.size ?? 20 },
    })
    return { total: result.total, list: result.list.map(configParamFromLegacy) } as Paged<ConfigParamBinding>
  },
  bindParam: (configId: string, paramId: string) =>
    request<Ack>('config/configParamAdd', { configId, paramId }, {
      method: 'POST',
      paramsIn: 'query',
      httpParams: { configId, paramId, pollMode: 1 },
    }),
  unbindParam: (bindingId: string) =>
    request<Ack>('config/configParamDel', { bindingId }, { method: 'GET', httpParams: { id: bindingId } }),
  actionLogs: async (configId: string, p: PageQuery = {}) => {
    const result = await request<Paged<unknown>>('config/configActionPaged', { configId, ...p }, {
      method: 'GET',
      httpParams: { configId, action: p.action, page: p.page ?? 1, limit: p.size ?? 20 },
    })
    return { total: result.total, list: result.list.map(configLogFromLegacy) } as Paged<ConfigActionLog>
  },
}

// 实体表（M5 采集资产）
export const entryApi = {
  // 旧 EntryTypeList 检索是 ID/名称两个独立框，不猜词——UI 层显式传 entryTypeId/name；
  // enable 同理由 UI 显式传（初始 '0'、重置后不带），API 层不拍默认值。
  entryPaged: async (p: PageQuery = {}) => {
    const httpParams = {
      page: p.page ?? 1,
      limit: p.size ?? 20,
      entryTypeId: p.entryTypeId,
      name: p.name,
      enable: p.enable,
    }
    const result = await request<Paged<unknown>>('config/entryTypePagedView', p, { method: 'GET', httpParams })
    return entryTypePageFromLegacy(result)
  },
  entryDetail: async (tableId: string) =>
    entryTypeFromLegacy(await request<unknown>('config/entryType', { tableId }, {
      method: 'GET',
      httpParams: { typeId: tableId },
    })),
  // 新建 / 编辑表（按 tableId upsert，无则新建并返回 tableId）
  entrySave: async (entry: EntryType) => {
    const endpoint = entry.tableId ? 'config/modifyEntryType' : 'config/entryTypeAddAll'
    const result = await request<unknown>(endpoint, { entry }, { method: 'POST', httpParams: entryTypeToLegacy(entry) })
    if (result && typeof result === 'object' && 'tableId' in result) {
      return result as { tableId: string; message?: string }
    }
    // 旧 EntryTypeEdit.handleSubmit 提示文案「处理成功, 后端返回:{msg}」，真实后端不带 tableId 时也要透传 msg
    const msg = result && typeof result === 'object' && 'message' in result ? String((result as { message?: string }).message ?? '') : ''
    return { tableId: entry.tableId || '', message: msg ? `处理成功, 后端返回:${msg}` : '实体表已保存' }
  },
  rebuildTable: (tableIds: string[] | string) => {
    const ids = Array.isArray(tableIds) ? tableIds : [tableIds]
    return request<Ack>('config/rebuildTable', { tableIds: ids }, { method: 'GET', httpParams: { ids } })
  },
  rebuildIndex: (tableId: string) =>
    request<Ack>('config/rebuildIndex', { tableId }, { method: 'GET', httpParams: { entryTypeId: tableId } }),
  deleteEntries: (tableIds: string[]) =>
    request<Ack>('config/deleteEntryType', { tableIds }, { method: 'GET', httpParams: { ids: tableIds } }),
  clearCache: (tableIds: string[]) =>
    request<Ack>('config/entry-type-clear', { tableIds }, { method: 'POST', paramsIn: 'query', httpParams: { ids: tableIds } }),
  copyEntry: (tableId: string, tableName: string) =>
    request<Ack>('config/entryTypeCopy', { tableId, tableName }, {
      method: 'POST',
      paramsIn: 'query',
      httpParams: { id: tableId, tableName },
    }),
  checkTable: (tableId: string) =>
    request<string[]>('config/checkTable', { tableId }, { method: 'GET', httpParams: { entryTypeId: tableId } }),
  syncTable: (tableId: string) =>
    request<Ack>('config/syncTable', { tableId }, { method: 'GET', httpParams: { entryTypeId: tableId } }),
  calcEntrySum: (tableId: string) =>
    request<Ack>('config/calcEntrySum', { tableId }, { method: 'GET', httpParams: { entryTypeId: tableId } }),
  markEntryType: (tableId: string, state: 'C' | 'AC') =>
    request<Ack>('config/markEntryType', { tableId, state }, {
      method: 'POST',
      paramsIn: 'query',
      httpParams: { entryTypeId: tableId, state },
    }),
}

// 参数列表（M5 采集资产）
export const paramApi = {
  paramPaged: async (p: PageQuery = {}) => {
    const keyword = String(p.keyword ?? '').trim()
    const httpParams: Record<string, unknown> = {
      ...p,
      page: p.page ?? 1,
      limit: p.size ?? 10,
      size: undefined,
      keyword: undefined,
      kind: undefined,
      paramId: p.paramId ?? (/^\d+$/.test(keyword) ? keyword : undefined),
      paramName: p.paramName ?? (!/^\d+$/.test(keyword) ? keyword : undefined),
      // 旧 ParamList 初始查询固定带 enable='0'（未删除标记，见 0717 参数方案 D1），不随前端「重置」清除
      enable: '0',
    }
    const result = await request<Paged<unknown>>('config/paramPaged', p, { method: 'GET', httpParams })
    return paramPageFromLegacy(result)
  },
  // 0711 R9：找不到返回 null（而不是静默兜底成别的参数），供 URL 参数编辑器判断"是否需要引导创建"
  paramDetail: async (paramId: string) => {
    const result = await request<unknown>('config/paramDetail', { paramId }, { method: 'GET' })
    // data:null 走 fallback 后 result 是 {ok:true, message:...}，不是真实数据，按"未找到"处理
    return result && typeof result === 'object' && !('ok' in result) ? paramFromLegacy(result) : null
  },
  genValues: (paramId: string) => request<string[]>('config/genValues', { paramId }, { method: 'GET' }),
  addParamValues: (paramId: string, paramValues: string) =>
    request<Ack>('config/addParamValues', { paramId, paramValues }, { method: 'POST' }),
  deleteParamValue: (valueId: string) =>
    request<Ack>('config/paramValueDel', { valueId }, { method: 'GET', httpParams: { id: valueId } }),
  // 0711 R9：URL 参数编辑器发现 URL 引用的参数 id 不存在时，就地创建
  paramCreate: async (param: ParamInput) => {
    const result = await request<unknown>('config/param-add', { param }, { method: 'POST', httpParams: paramToLegacy(param) })
    if (result && typeof result === 'object' && 'ok' in result) {
      const ack = result as { ok: boolean; message?: string; param?: Param }
      return { ...ack, param: ack.param ?? ({ ...param, paramId: param.paramId ?? '' } as Param) }
    }
    const paramId = typeof result === 'string' || typeof result === 'number' ? String(result) : param.paramId ?? ''
    return { ok: true, message: '参数已创建', param: result && typeof result === 'object' ? paramFromLegacy(result) : ({ ...param, paramId } as Param) }
  },
  paramUpdate: async (param: Param) => {
    const result = await request<unknown>('config/updateParam', { param }, {
      method: 'POST',
      paramsIn: 'query',
      httpParams: paramToLegacy(param),
    })
    if (result && typeof result === 'object' && 'ok' in result) {
      const ack = result as { ok: boolean; message?: string; param?: Param }
      return { ...ack, param: ack.param ?? param }
    }
    return { ok: true, message: '参数已更新', param: result ? paramFromLegacy(result) : param }
  },
  paramCopy: (paramId: string) =>
    request<Ack>('config/param-copy', { paramId }, { method: 'POST', paramsIn: 'query' }),
  deleteParams: (paramIds: string[]) =>
    request<Ack>('config/deleteParam', { paramIds }, { method: 'GET', httpParams: { ids: paramIds } }),
  clearParams: (paramIds: string[]) =>
    request<Ack>('config/clear', { paramIds }, { method: 'GET', httpParams: { ids: paramIds } }),
}

// 文件资源（M3-1）：旧平台现役 FileList2.vue 使用 file_resource 表 + entryDataPaged，
// 不再调用废弃的 filePaged，也不提供新平台自造的 fileStats。
export const fileApi = {
  resourceTables: async (options: DataRequestOptions = {}) => {
    const result = await request<Paged<unknown>>('file/resourceTables', { page: 1, size: 100, name: 'file_resource' }, {
      method: 'GET',
      ...options,
      httpEndpoint: 'config/entryTypePagedView',
      httpParams: { page: 1, limit: 100, name: 'file_resource', enable: '0' },
    })
    return entryTypePageFromLegacy(result).list
  },
  resourceMeta: async (tableId: string, options: DataRequestOptions = {}) => {
    const result = await request<unknown>('file/resourceTableMeta', { tableId }, {
      method: 'GET',
      ...options,
      httpEndpoint: 'entry/queryEntryType',
      httpParams: { type: tableId },
    })
    return result ? dataTableFromLegacy(result) : null
  },
  resourceRows: async (q: FileResourceQuery, options: DataRequestOptions = {}) => {
    const result = await rowQueryPagedAt('file/resourceRows', {
      tableId: q.tableId,
      sourceId: q.sourceId,
      state: q.state,
      sql: fileResourceSql(q),
      page: q.page,
      size: q.size,
    }, options)
    return { total: result.total, list: result.list.map(fileResourceFromDataRow) }
  },
}

// 工作台摘要（首页）
export const workbenchApi = {
  summary: () => request<WorkbenchSummary[]>('workbench/summary'),
}

// 采集资产总览（首页驾驶舱）
export const overviewApi = {
  summary: () => request<OverviewSummary>('overview/summary'),
  trend: (days = 30) => request<TrendPoint[]>('overview/trend', { days }),
}

// 流程定义持久化（流程画布保存 / 加载 / 多流程）
export const flowApi = {
  flowSave: (def: FlowDef) => request<Ack>('flow/save', { def }),
  flowLoad: (id: string) => request<FlowDef | null>('flow/load', { id }),
  flowList: () => request<{ id: string; name: string; updatedAt: string }[]>('flow/list'),
  flowRecommend: (prompt: string, intent?: string) =>
    request<FlowRecommendation>('flow/recommend', { prompt, intent }),
  // 节点级 AI 对话（0701 问题八）：mock 关键词回复，二期换真 LLM BFF，签名不变
  nodeAiChat: (params: { nodeId: string; question: string; nodeTitle: string; outputTable?: string; disabled?: boolean }) =>
    request<{ reply: string }>('flow/nodeAiChat', params),
}

// 流程模板（0714 会议 Task 5）：结构与源动态绑定分开保存；version 用于固定已绑定源。
export const flowTemplateApi = {
  list: () => request<FlowTemplate[]>('flow-template/list'),
  detail: (id: string, version?: number) => request<FlowTemplate | null>('flow-template/detail', { id, version }),
  save: (template: FlowTemplateSaveInput) => request<FlowTemplate>('flow-template/save', { template }),
}

// 子步骤（流程画布连线 = item/next）。未实现专属 mock，由 client fallback 回执。
export const itemApi = {
  saveItemConfig: (stepId: string) => request<Ack>('item/next/saveItemConfig', { stepId }),
  stepModify: (stepId: string) => request<Ack>('item/next/stepModify', { stepId }),
  enable: (stepId: string, enabled: boolean) => request<Ack>('item/next/enable', { stepId, enabled }),
  deleteStep: (stepId: string) => request<Ack>('item/next/delete', { stepId }),
}
