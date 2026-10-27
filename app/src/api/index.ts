import { stripTrailingSemicolon } from '@/utils/sqlCondition'
import { request, BASE_URL, appendQuery, usesMockAdapter, ApiError, isMockMode, isProductionBackend, isProductionCreateEnabled, type RequestOptions } from './client'
import { ACCESS_TOKEN_HEADER, isSessionExpiredRedirect, readLoginUsername, readStoredToken, triggerSessionExpired } from './auth'
import { createSseEventParser } from '@/utils/stream/sse'
import type {
  Paged, Source, Site, SiteSummary, SiteCreateInput, SiteCreateResult, Ack, PageQuery, Step, SourceLoadParamsResult, SendSnatchWithParamPayload, SendCodeConfigPayload, SendCodeConfigResult, CodeConfigOption,
  Rule, RuleGroup, SharedConfig, RuleTestCase, EvalResult,
  RuleOrchestration, RuleOrchestrationGenerateResult, RuleOrchestrationItem, RuleOrchestrationTestRequest, RuleOrchestrationTestResult,
  CkSourcePayload, CkSourceRecord, CkSourcePage,
  CodeExecuteRequest,
  Dataset, Measure, DataTableMeta, DataRow, RowQuery, EntryTypeGroup, EntryDetail, SummaryRow, RunRow, RunNode, NodeRunStat, QueueStat, HealthCard, MqQueue, SyncRow, AlarmRow,
  SourceCheck, SourceCheckLog, SourceCheckQuery, SourceCheckLogQuery,
  TaskInstQuery,
  Config, ConfigActionLog, ConfigParamBinding, SourceTypeDict, NodeType, NodeTypeInput, EntryType, Param, ParamInput, ParamKind, CredentialRef, CreateJobsInput, SourceJob, SourceLog, TaskInst, SourceTaskQuery, WorkbenchSummary,
  OverviewSummary, TrendPoint, FileResourceRecord, FileResourceQuery, CopySourceInput, SourceCloneRequest, SourceCloneResult,
  FlowDefinition, FlowRecord, FlowSaveInput, LegacyLoginSubmission, LegacySnatchSaveRequest, LegacySnatchSaveResult,
  SourceCategory,
  SourceFlowBind, SourceFlowsView, WorkflowBinding,
  SourceGroup, SourceGroupState, MembershipRangeResult,
} from './types'
import type { FlowDef, FlowRecommendation } from '@/views/FlowCanvas/canvas/flowModel'
import {
  configFromLegacy,
  createJobsToLegacy,
  configUrlFromLegacy,
  legacyConfigRecord,
  configLogFromLegacy,
  configPageFromLegacy,
  configParamFromLegacy,
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
  paramKindToLegacy,
  isVruleNumericRuleId,
  parseRuleOrchestrationStreamText,
  parseDataProcessStreamText,
  pickRuleIdFromComposeList,
  ruleOrchestrationDetailFromLegacy,
  ruleOrchestrationGenerateFormBody,
  ruleOrchestrationGenerateFromLegacy,
  ruleOrchestrationListFromLegacy,
  ruleOrchestrationSaveMetaFromLegacy,
  ruleOrchestrationSaveMetaToLegacy,
  ruleOrchestrationTestFromLegacy,
  ruleOrchestrationTestToLegacy,
  siteFromLegacy,
  sitePageFromLegacy,
  siteSummaryFromLegacy,
  siteSourceFromLegacy,
  nodeTypeFromLegacy,
  sourceCategoriesFromLegacy,
  sourceFromLegacy,
  sourceOptionFromLegacy,
  sourcePageFromLegacy,
  flowFromLegacy,
  flowPageFromLegacy,
  flowToLegacy,
  sourceToLegacyParams,
  sourceCoreToLegacyParams,
  sourceStepsFromLegacy,
  stepToSaveItemConfigPayload,
  stepToStepModifyPayload,
  summaryRowFromLegacy,
  taskInstFromLegacy,
  assertLegacySnatchSaveLogin,
  legacySnatchSavePayloadFromFlow,
} from './legacyAdapters'
import type { DataProcessGeneratePayload, DocumentExtractPayload } from '@/utils/flow/dataProcess'
export type { ModelProviderOption, ModelOption } from './types'
import { encryptLegacyPayload } from './legacyCrypto'
export { fetchModelProviders, fetchDefaultModels } from './model'
export { fetchPromptList } from './prompt'
export type { PromptTemplateItem } from './prompt'
export type { UsedTable } from '@/utils/site/usedTables'
import { issueTagsForWrite, parseIssueTags } from '@/utils/sourceMark'
import { urlOrPlaceholder } from '@/utils/source/placeholderUrl'
import { aggregateUsedTables, countSourcesWithoutFlow, type UsedTable } from '@/utils/site/usedTables'
import { snatchAckFrom, type SnatchAck } from '@/utils/snatchResult'

export * from './types'
export { isDanger, DANGER_ENDPOINTS, isMockMode, isProductionBackend, isProductionCreateEnabled } from './client'
export * from './logReport'
export { parseNextStepReceipt, type NextStepReceipt, type NextStepReceiptEntry } from './legacyAdapters'

// 对方后端尚未提供对应实现的资产能力强制走 Mock；网站读取链路已在 siteApi 单独切真实。
const assetMockRequest = <T>(endpoint: string, params?: Record<string, unknown>) =>
  request<T>(endpoint, params, { mode: 'mock' })

/**
 * 分页解包：后端有时给 { total, list }，有时直接给数组（无总数时以本页长度兜底）。
 * 与 unwrapTaskInstPage 同一口径，只是不做行映射——字段名与后端一致的接口直接用它。
 */
function unwrapPage<T>(result: unknown): Paged<T> {
  const list = (Array.isArray(result) ? result : ((result as Paged<unknown> | null)?.list ?? [])) as T[]
  const total = Array.isArray(result) ? list.length : ((result as Paged<unknown> | null)?.total ?? list.length)
  return { total, list }
}

/** 源列表任务实例与画布任务视图共用：GET /v1/task/topTaskPaged 的分页解包。 */
function unwrapTaskInstPage(result: unknown): { total: number; list: TaskInst[] } {
  const list = Array.isArray(result) ? result : ((result as Paged<unknown> | null)?.list ?? [])
  const total = Array.isArray(result) ? list.length : ((result as Paged<unknown> | null)?.total ?? list.length)
  return { total, list: list.map(taskInstFromLegacy) }
}

/**
 * snatchSave 的空值剥离（2026-09-03 生产实测两次踩雷后加）。
 *
 * 旧平台 SourceBuildForm 的 form 里，没填的字段是 `undefined`，`JSON.stringify` 直接丢掉——
 * **后端从来没收到过这些 key**，于是它对空值毫无防御。我们这边照着"补齐字段"的直觉一律发 `''`，
 * 每个都会在后端炸开，而且 Jackson/Spring 是遇到第一个就抛，只能一颗一颗踩：
 *   - `proxy: ''`  → `Cannot coerce empty String ("") to element of ArrayList<String>`（DTO 是 List）
 *   - `cron: ''`   → `Cron expression must consist of 6 fields (found 0 in "")`
 * 后面还排着 `keep` / `loginTemplete` / `tags` / `sourceUrl`，同样是旧平台压根不发的字段。
 *
 * 所以不逐个补，在唯一发送点统一剥掉 `undefined` 和 `''`，等价于旧平台的行为。
 * ⚠️ 空数组要留着：`params: []` 是旧平台**确实会发**的（parseParamObj(undefined) 返回 `[]`），
 * 而 proxy 不用代理时由构造方给 `undefined`，不是 `[]`。
 */
function stripEmptyForSnatchSave(payload: LegacySnatchSaveRequest): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload as unknown as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== ''),
  )
}

async function legacySnatchSaveRequest(payload: LegacySnatchSaveRequest, options: Pick<RequestOptions, 'mode'> = {}): Promise<LegacySnatchSaveResult> {
  const result = await request<LegacySnatchSaveResult>('snatch/snatchSave', stripEmptyForSnatchSave(payload), {
    method: 'POST',
    httpEndpoint: 'snatch/snatchSave',
    ...options,
  })
  if (result?.sourceId || !result?.message) return result
  const sourceId = result.message.match(/源ID[:：]\s*([^\s,，]+)/)?.[1]
  return sourceId ? { ...result, sourceId } : result
}

/** 清颜色：旧 markSourceFlag(ids, 1, 1) 的 isClear=1 在现网 500。
 *  usedFlag===0 即无颜色（旧列表徽章条件）；先走能写成功的 setColor flag=0，失败再 updateSource。
 *
 *  ⚠️ 2026-08-31 F01 起本平台**没有颜色 UI 入口**了，但这个函数和 setColor / colorFromLegacy
 *  一律保留：旧平台还在读写同一个 usedFlag 字段，删掉这边只会让两边打架。 */
async function clearSourceColor(sourceIds: string[]): Promise<Ack> {
  if (!sourceIds.length) return { ok: false, message: '请勾选要清除颜色标识的源' }
  try {
    const result = await request<unknown>('source/setColor', { sourceIds, flag: 0, clear: true }, {
      method: 'GET',
      httpEndpoint: 'source/setColor',
      httpParams: { ids: sourceIds.join(','), flag: 0 },
    })
    return ackFromApiResult(result)
  } catch (error) {
    if (usesMockAdapter('source/updateSource', { httpEndpoint: 'source/updateSource' })) throw error
    const results = await Promise.allSettled(
      sourceIds.map((sourceId) =>
        request<unknown>('source/updateSource', { sourceId, usedFlag: 0 }, {
          method: 'POST',
          httpEndpoint: 'source/updateSource',
          httpParams: { sourceId, usedFlag: 0 },
        }),
      ),
    )
    const failed = results.filter((item) => item.status === 'rejected')
    if (failed.length) {
      const first = failed[0] as PromiseRejectedResult
      const detail = first.reason instanceof Error ? first.reason.message : String(first.reason)
      const original = error instanceof Error ? error.message : String(error)
      throw new Error(
        failed.length === sourceIds.length
          ? original
          : `已清除 ${sourceIds.length - failed.length} 个源的颜色标识，${failed.length} 个失败：${detail}`,
      )
    }
    return { ok: true, message: `已清除 ${sourceIds.length} 个源的颜色标识` }
  }
}

/** 清标签：旧 /v1/source/tagSource 没有 clear；备注弹窗同一条 POST updateSource { sourceId, tags: '' }。 */
async function clearSourceTags(sourceIds: string[]): Promise<Ack> {
  if (!sourceIds.length) return { ok: false, message: '请勾选要清除标签的源' }
  if (usesMockAdapter('source/tagSource', { httpEndpoint: 'source/tagSource' })) {
    const result = await request<unknown>('source/tagSource', { sourceIds, tags: [], action: 'clear' }, {
      method: 'GET',
      httpEndpoint: 'source/tagSource',
      httpParams: { ids: sourceIds.join(','), action: 'clear' },
    })
    return ackFromApiResult(result)
  }
  const results = await Promise.allSettled(
    sourceIds.map((sourceId) =>
      request<unknown>('source/updateSource', { sourceId, tags: '' }, {
        method: 'POST',
        httpEndpoint: 'source/updateSource',
        httpParams: { sourceId, tags: '' },
      }),
    ),
  )
  const failed = results.filter((item) => item.status === 'rejected')
  if (failed.length) {
    const first = failed[0] as PromiseRejectedResult
    const detail = first.reason instanceof Error ? first.reason.message : String(first.reason)
    throw new Error(
      failed.length === sourceIds.length
        ? detail
        : `已清除 ${sourceIds.length - failed.length} 个源的标签，${failed.length} 个失败：${detail}`,
    )
  }
  return { ok: true, message: `已清除 ${sourceIds.length} 个源的标签` }
}

/**
 * 启停源。真实路径 `GET /v1/source/changeEnable?ids=a,b&enable=0|1`（旧 `api/source.js:11,355-365`）。
 *
 * `enable` 的极性是**反的**：`0` 启用、`1` 禁用（旧 `SourceList.vue:25-32` 两个菜单项写死的），
 * 与 `sourcePaged` 里 `enable=1` 表示"已停用"同一套口径。读着别扭但两边一致，不要"修正"。
 *
 * 它本来就是批量端点（ids 逗号分隔），单源只是批量的退化情况——调用方不需要自己循环。
 */
async function changeSourceEnableBatch(sourceIds: string[], disabled: boolean): Promise<Ack> {
  if (!sourceIds.length) return { ok: false, message: '请勾选要启停的源' }
  const result = await request<unknown>('source/changeSourceEnable', { sourceIds, disabled }, {
    method: 'GET',
    httpEndpoint: 'source/changeEnable',
    httpParams: { ids: sourceIds.join(','), enable: disabled ? 1 : 0 },
  })
  return ackFromApiResult(result)
}

function ackFromApiResult(result: unknown): Ack {
  const record = result && typeof result === 'object' ? result as Record<string, unknown> : {}
  return {
    ok: record.ok !== false && record.success !== false && String(record.code ?? '0') === '0',
    demo: record.demo === true,
    message: record.message == null ? (record.msg == null ? undefined : String(record.msg)) : String(record.message),
  }
}

/**
 * 从回执里捞主键。写接口的回执长得五花八门（有的直接回 id、有的塞在 data、有的只在 msg 里提），
 * 调用方按自己知道的键名顺序传进来。找不到返回 undefined，由调用方决定怎么兜底。
 */
export function idFromApiResult(result: unknown, keys: string[]): string | undefined {
  if (typeof result === 'string' || typeof result === 'number') return String(result)
  if (!result || typeof result !== 'object') return undefined
  const record = result as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null && String(value).trim()) return String(value)
  }
  return undefined
}

async function sourcesByNameLike(name: string): Promise<Source[]> {
  const trimmed = name.trim()
  if (!trimmed) return []
  const result = await request<unknown>('source/sourcePaged', { name: trimmed, size: 100 }, {
    method: 'POST',
    httpEndpoint: 'source/sourcePaged',
    httpParams: {
      pageNo: 1,
      pageSize: 100,
      page: 1,
      limit: 100,
      name: trimmed,
    },
  })
  return sourcePageFromLegacy(result).list
}

/**
 * 旧 `GET /v1/source/copySource`（`api/source.js`；`SourceList.vue` `handleCopySource`）。
 * 文档出参 `data` 为 null，偶发 `msg` 带「源ID:」时顺手收下；否则靠 `copySourceAndLocate` 差集定位。
 */
async function copySource(input: CopySourceInput): Promise<Ack & { sourceId?: string }> {
  const result = await request<unknown>('source/copySource', input as unknown as Record<string, unknown>, {
    method: 'GET',
    httpEndpoint: 'source/copySource',
    httpParams: {
      sourceId: input.sourceId,
      name: input.name,
      url: input.url,
      flag: input.flag,
    },
  })
  const ack = ackFromApiResult(result)
  const sourceId = idFromApiResult(result, ['sourceId', 'id'])
    ?? ack.message?.match(/源ID[:：]\s*([^\s,，]+)/)?.[1]
  return sourceId ? { ...ack, sourceId } : ack
}

/**
 * 复制源并定位新 ID。`copyAll` 同款：复制前后按名称各查一次，取新增那条。
 * 不要按 `原名_copy` 回查——用户填的是新名称，且同名可能早就存在。
 */
async function copySourceAndLocate(input: CopySourceInput) {
  const name = input.name.trim()
  if (!input.sourceId) return { ok: false as const, message: '请选择要复制的源' }
  if (!name) return { ok: false as const, message: '请填写新的源名称' }
  const before = new Set((await sourcesByNameLike(name)).map((item) => item.sourceId))
  const ack = await copySource({ ...input, name })
  if (!ack.ok) return { ok: false as const, message: ack.message || '复制源失败' }
  if (ack.sourceId && !before.has(ack.sourceId)) return { ok: true as const, sourceId: ack.sourceId, name }
  const added = (await sourcesByNameLike(name)).filter((item) => !before.has(item.sourceId))
  if (added.length !== 1) {
    return { ok: false as const, message: `复制后无法唯一定位新源（匹配到 ${added.length} 条），请刷新源列表确认` }
  }
  return { ok: true as const, sourceId: added[0].sourceId, name: added[0].name }
}

function legacySnatchSavePayloadFromSource(site: Site, source: Source): LegacySnatchSaveRequest {
  return {
    sourceType: source.sourceType ?? '90',
    sourceUrl: source.url ?? '',
    sourceName: source.name,
    categoryId: source.dirId ?? site.dirId ?? '',
    proxy: source.proxy ?? (source.useProxy ? ['1'] : undefined),
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

const CREATE_DISABLED_MESSAGE = '当前环境未开启新建通道（VITE_SITE_CREATE_TARGET=production），无法新增源'

/** 在已有网站下建一个空白流程的源：snatchSave → bindSite（真实写，调用方先过 isProductionCreateEnabled）。 */
async function createSourceInSite(site: Site, source: Source): Promise<{ ok: boolean; message?: string; sourceId?: string }> {
  const liveWrite = { mode: 'http' as const }
  try {
    const saved = await legacySnatchSaveRequest(legacySnatchSavePayloadFromSource(site, source), liveWrite)
    if (!saved.ok || !saved.sourceId) return { ok: false, message: saved.message || '保存失败' }
    const bound = await sourceApi.bindSite(saved.sourceId, site.siteId, liveWrite)
    if (!bound.ok) return { ok: false, sourceId: saved.sourceId, message: `源 ${saved.sourceId} 已建，关联网站失败：${bound.message || '未知错误'}` }
    return { ok: true, sourceId: saved.sourceId }
  } catch (error) {
    return { ok: false, message: (error as Error).message ?? '请求失败' }
  }
}

// item/next/nextConfigPaged 本身不带 topic（旧 config.topic，真实队列）和登录语义；2026-08-26
// 生产实测（源 430016821/430016822/430016516）确认每个 configId 的 topic 各不相同、且有真实业务
// 含义，此前画布只能回退到节点模板的硬编码默认队列，显示的是假值而非缺值；同批实测另发现登录类
// 配置（如 1400968「baidu-登陆」）的步骤名字未必含"登录"字样，画布节点模板路由此前只按步骤名
// 正则猜测，猜不中就把登录节点画成普通采集节点。这里按每个步骤的 configId 去重后查
// config/configDetail 一次性补回 topic 和 isLoginConfig；单条查询失败不阻断整体加载
// （Promise.allSettled），查不到就保持 undefined，由调用方回退到各自的原有默认行为。
async function attachStepConfigDetails(steps: Step[], backendScope?: RequestOptions['backendScope']): Promise<Step[]> {
  const configIds = [...new Set(steps.map((s) => s.configId).filter((id): id is string => !!id))]
  if (!configIds.length) return steps
  // 用原始记录而不是 Config 模型：配置 URL 在旧字段 `configUrl` 上（ConfigEdit 同款），
  // 过一遍模型后再读 `url` 会在适配漏字段时把面板留空。
  const results = await Promise.allSettled(configIds.map((id) => configApi.configDetailRaw(id, { backendScope })))
  type StepConfigDetail = {
    topic?: string; configName?: string; configUrl?: string; configUpdateDt?: string; isLoginConfig?: boolean; multiMode?: number
    configType?: string
    bizType?: string; dedupType?: string; codeRule?: string; contentRule?: string; coreParam?: string
    runPolicy?: string
    paramBindings?: Step['paramBindings']
  }
  const detailByConfigId = new Map<string, StepConfigDetail>()
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled' || !r.value) return
    const mapped = configFromLegacy(r.value)
    // multiMode 是旧 isMulti 的三态原值，只迁不展示（见 Step.multiMode 注释）。
    // params 是配置绑定的参数（旧「使用参数」表），configDetail 响应里就带着，不用另发请求。
    const bindings = (mapped.params ?? []).map((p) => ({ paramId: p.paramId, value: p.valueShow || undefined }))
    detailByConfigId.set(configIds[i], {
      topic: mapped.topic || undefined,
      configName: mapped.name || undefined,
      configUrl: configUrlFromLegacy(r.value),
      configUpdateDt: mapped.updatedAt,
      bizType: mapped.templateCode || undefined,
      dedupType: mapped.dedupType ?? undefined,
      codeRule: mapped.codeRule || undefined,
      contentRule: mapped.contentRule || undefined,
      coreParam: mapped.coreParam || undefined,
      runPolicy: mapped.runPolicy || undefined,
      isLoginConfig: mapped.isLogin,
      multiMode: mapped.multiMode,
      configType: mapped.configType,
      ...(bindings.length ? { paramBindings: bindings } : {}),
    })
  })
  if (!detailByConfigId.size) return steps
  return steps.map((step) => {
    const detail = step.configId ? detailByConfigId.get(step.configId) : undefined
    if (!detail) return step
    return {
      ...step,
      ...(detail.topic ? { topic: detail.topic } : {}),
      ...(detail.configName ? { configName: detail.configName } : {}),
      ...(detail.configUrl !== undefined ? { configUrl: detail.configUrl } : {}),
      ...(detail.configUpdateDt !== undefined ? { configUpdateDt: detail.configUpdateDt } : {}),
      ...(detail.bizType ? { bizType: detail.bizType } : {}),
      ...(detail.dedupType !== undefined ? { dedupType: detail.dedupType } : {}),
      ...(detail.codeRule ? { codeRule: detail.codeRule } : {}),
      ...(detail.contentRule ? { contentRule: detail.contentRule } : {}),
      ...(detail.coreParam ? { coreParam: detail.coreParam } : {}),
      ...(detail.runPolicy ? { runPolicy: detail.runPolicy } : {}),
      ...(detail.isLoginConfig !== undefined ? { isLoginConfig: detail.isLoginConfig } : {}),
      ...(detail.multiMode !== undefined ? { multiMode: detail.multiMode } : {}),
      // ⚠️ configType 一直被取出来却**没有合并回 step**（2026-09-18 修）。
      // 后果是所有靠它做的判定全部落空：数据校验(620/800)、数据监控、以及 AI/媒体处理类
      // (700/710/720/730) 回读后认不出自己是什么，只能靠 nodeType 和标题正则兜底。
      // 实测源 430022794 的「文章生成摘要」节点因此一直顶着采集节点的壳子——
      // 卡片显示「90 网页抓取 / 源配置」，状态也走采集分支去要 URL 和输出表。
      ...(detail.configType ? { configType: detail.configType } : {}),
      ...(detail.paramBindings ? { paramBindings: detail.paramBindings } : {}),
    }
  })
}

// changeSite 是 GET，ids 拼在 URL query 里；一次上千个源会把请求行撑到几十 KB，被网关以
// 414/431 拒掉（2026-09-07 实测：6496 个源 → 431 Request Header Fields Too Large）。
// 超过这个数就在 changeSite 内部串行分片提交，单片 ~300 个 ID（约 3–6KB URL，稳在各网关默认上限内）。
/**
 * changeSite 的分片大小。**导出给调用方**：≤ 这个数就是一次请求打完，
 * 服务端不回报中间进度，UI 不该假装有逐条进度（2026-09-18）。
 */
export const CHANGE_SITE_CHUNK = 300

/**
 * 请求没拿到回执**不等于**后端没写入，所以 changeSite 不能凭异常直接判失败。
 *
 * 2026-09-07 就实测过「客户端 20s 超时 net::ERR_ABORTED，但后端其实已写入」，当时的修法
 * 是把单片 `timeoutMs` 提到 120s——那只治住了 dev 直连。2026-09-16 部署站（wan 网关）复现：
 * 1073 个源分 4 批，**4 批全报失败、后端却一个不少地写进去了**（网关自己的超时比前端 120s 短，
 * 前端等不到回执）。界面于是提示「成功 0 个、失败 1073 个，请对失败部分重试」，全是误报，
 * 还会诱导用户去重跑一遍已经成功的导入。
 *
 * 判定改成回查该网站下的实际归属。只在「没拿到明确 HTTP 响应」时才查：
 * 4xx 是网关/客户端当场拒绝（431 URL 过长、414 等），请求根本没到后端，回查纯属白等几十秒；
 * 超时、连接断开、5xx 则后端可能已经执行完了，必须查。
 */
function mayHaveLandedDespiteError(error: unknown): boolean {
  // HTTP 状态挂在 client.ts 构造的原始 Error 上，而 request() 会把它包进 ApiError 的 cause
  // （client.ts:401），所以要顺着 cause 链找，不能只看最外层——只看外层的话 status 恒为
  // undefined，431 也会白白多查一次归属。
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth++) {
    const status = (current as { status?: unknown }).status
    if (typeof status === 'number') return status < 400 || status >= 500
    current = (current as { cause?: unknown }).cause
  }
  // 没有 HTTP 状态 = 压根没拿到响应（超时 / 连接断开），后端很可能已经写完了
  return true
}

/** 回查这批源里实际已经挂到目标网站的部分。绕开 siteSourcesCache：回查要的就是最新归属。 */
async function landedInSite(siteId: string, candidates: string[]): Promise<string[]> {
  const actual = new Set((await requestSiteSources(siteId, 10000, 60_000)).map((s) => s.sourceId))
  return candidates.filter((id) => actual.has(id))
}

/** 节点类型写入体：去掉 undefined；数字字段转 number（后端 sourceType / seq 是 Integer） */
function nodeTypeBody(input: NodeTypeInput): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    if (key === 'sourceType') {
      if (value !== '' && value !== null) body.sourceType = Number(value)
      continue
    }
    body[key] = value
  }
  return body
}

/**
 * 页面筛选条件 → 后端 SourceCond 参数（不含分页 / 排序）。`sourcePaged` 与
 * `source-group/changeMembersByRange` 共用，保证「按范围调整」改到的就是列表里看到的源
 * （页面叫 `sourceIds`，后端读 `ids`，各自拼会丢条件）。
 */
function sourceCondParams(p?: PageQuery) {
  return {
    ids: Array.isArray(p?.sourceIds) ? p.sourceIds.join(',') : (p?.sourceIds ?? p?.ids),
    // 只发复数 siteIds：source-api.md §1.1 明确后端不读单数 siteId（传 -1 查未关联源也走复数）
    siteIds: p?.siteIds,
    sourceId: p?.sourceId,
    name: p?.name ?? p?.keyword,
    sourceUrl: p?.sourceUrl,
    entryTypeId: p?.entryTypeId,
    configId: p?.configId,
    // 按流程反查源（流程中心「使用源数」下钻）。2026-09-02 生产实测确认后端认这个条件：
    // 无条件 16929 条 → flowId=1400330 得 46 条（与该流程的 sourceCnt 一致）→ 传不存在的
    // flowId 得 0 条。**不是静默忽略**，可以放心当过滤条件用。
    // （注意 apis/source-site-api.md 里列的 sourceCond 参数表没写 flowId，那份文档比 flow 功能早。）
    flowId: p?.flowId,
    // 1008-03 来源组：按组筛源（2026-10-09 实测 sourceGroupId=3 得 255 条）。只接受正数。
    sourceGroupId: p?.sourceGroupId,
    // 1008-04 默认流程：sourcePaged 认这个条件（2026-10-09 实测只匹配默认流程）
    defaultFlowId: p?.defaultFlowId,
    count: p?.count,
    dataDate: p?.dataDate,
    enable: p?.enable,
    state: p?.state === 'all' ? undefined : p?.state,
    categorys: p?.categorys ?? p?.category,
    cron: p?.cron,
    topic: p?.topic,
    // 0831 F04 备注检索。**后端支持**——生产源列表页（118.25.96.217:9999/source/source-list）
    // 的筛选区就有「备注」。本地这份旧代码快照（2606-rule 分支）比线上旧，queryParam 里还没有，
    // 别再照它下"后端不支持"的结论。字段名取旧列表列 `SourceList.vue:369` 的 prop。
    // 旁边那个「责任人」（author）线上也有，但 0831 明确暂不做，别顺手加。
    remark: p?.remark,
    flag: p?.flag,
  }
}

// 类型化接口：每个方法一一对应一个真实 /v1 端点。后续按 142 个端点逐域补全。
export const sourceApi = {
  sourcePaged: async (p?: PageQuery) => {
    const result = await request<unknown>('source/sourcePaged', p, {
      method: 'POST',
      httpEndpoint: import.meta.env.VITE_FLOW_PROXY_TARGET && p?.flowId ? 'flow/flowSources' : 'source/sourcePaged',
      httpParams: {
        pageNo: p?.page ?? 1,
        pageSize: p?.size ?? 20,
        page: p?.page ?? 1,
        limit: p?.size ?? 20,
        ...sourceCondParams(p),
        notify: p?.notify ?? '',
        groupBy: p?.groupBy,
        sorted: p?.sorted ?? -1,
        tags: p?.tags ?? [],
        field: p?.field,
        type: p?.type,
        // 10-15「我的视图」目录：后端按视图目录取源（目录里的源 ∪ 绑定来源组的当前成员）。
        // **只放在 sourcePaged 里，不进 sourceCondParams**：changeMembersByRange 等其它按条件的接口不认它，
        // 混进去会变成「不限」（按范围调整来源组甚至会带 confirmAll 改全平台）。
        viewCategoryId: p?.viewCategoryId,
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
  /**
   * 编辑源（旧平台 `POST /v1/source/updateSource`，参数同时进 body 与 query）。
   *
   * 旧 `config/column.config.js` 的「备注」列就是靠它保存的：
   * `save: (record) => updateSource({ sourceId, remark, author, tags })`。
   * ⚠️ 注意 save 回调把 **author / tags 也一起回传**——只发 remark 会把这两个字段清空，
   * 详情抽屉里改备注时必须照旧带上。
   * `client.ts` 已把该端点列进写白名单（2026-08-28 拍板放开源重命名），生产环境可直接发。
   */
  updateSource: async (payload: Record<string, unknown> & { sourceId: string }): Promise<Ack> => {
    const result = await request<unknown>('source/updateSource', payload, {
      method: 'POST',
      httpEndpoint: 'source/updateSource',
      httpParams: payload,
    })
    return ackFromApiResult(result)
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
  /**
   * 按 ID 取单个分类（2026-09-18）。
   *
   * 用处只有一个：**懒加载树的回显**。编辑网站时手里只有 `dirId`，而 `sitePaged` 的
   * `categoryName` 实测恒为 null（2026-09-18 生产实测），树又还没展开到那一层，
   * 选择器只能显示一个裸 ID（用户报的就是这个）。
   *
   * 走的还是 `category/categoryPaged`，加 `categoryId` 参数即精确命中——实测
   * `categoryId=9009302` 返回 1 条「中国网财经」（level 4，path `0,9009005,9009253,9009258`）。
   * ⚠️ **不支持逗号批量**（实测传 `a,b,c` 返回 0 条），一次只能查一个。
   */
  categoryById: async (categoryId: string): Promise<SourceCategory | null> => {
    if (!categoryId) return null
    const result = await request<unknown>('source/categoryTree', { categoryId }, {
      method: 'GET',
      httpEndpoint: 'category/categoryPaged',
      httpParams: { page: 1, limit: 10, allSub: false, categoryId },
    })
    return sourceCategoriesFromLegacy(result)[0] ?? null
  },
  /**
   * 按关键词跨层级搜分类（2026-09-18）。
   *
   * 返回**平铺**结果，不装配成树——搜索命中的父子节点可能同时出现，装成树会把子节点
   * 藏进父节点里，选择器上就看不见了。`path` 是祖先 id 链（如 `0,9009005,9009253,`），
   * 调用方用它拼展示路径。
   */
  searchCategories: async (keyword: string): Promise<(SourceCategory & { path: string })[]> => {
    const wd = keyword.trim()
    if (!wd) return []
    const result = await request<unknown>('category/categoryQuery', { wd }, {
      method: 'GET',
      httpEndpoint: 'category/categoryQuery',
      httpParams: { wd },
    })
    const rec = (result && typeof result === 'object') ? (result as Record<string, unknown>) : {}
    const rows = Array.isArray(result)
      ? result
      : (Array.isArray(rec.list)
        ? rec.list
        : (Array.isArray(rec.data) ? rec.data : []))
    return rows
      .map((row) => {
        const r = row as Record<string, unknown>
        const count = r.count != null ? Number(r.count) : undefined
        const seq = r.seq != null ? Number(r.seq) : undefined
        // 2026-10-16 补：这里以前也漏了 remark（同 sourceCategoriesFromLegacy 的毛病）——
        // 搜索态下点「编辑」同样要看这个字段回填备注。
        const remark = r.remark == null ? undefined : String(r.remark)
        return {
          id: String(r.categoryId ?? r.id ?? ''),
          name: String(r.categoryName ?? r.name ?? ''),
          parentId: r.parentId == null || r.parentId === 0 ? '' : String(r.parentId),
          path: String(r.path ?? ''),
          ...(count != null ? { count } : {}),
          ...(seq != null ? { seq } : {}),
          ...(remark == null ? {} : { remark }),
        }
      })
      .filter((item) => item.id && item.name)
  },
  /**
   * 源的定时任务（2026-09-18）。
   *
   * 旧平台「定时列表」那一页同款接口。**定时不在 source/config 上**——`sourceDetail.schedule`
   * 实测恒为 null（抽查列表前 20 个源全空），真正的 cron 落在 job 表：
   * 源 430016942 → `{ jobId: 14666, schedule: '0 0 16 * * ?', nextRun: '2026-09-19 16:00:00' }`。
   * 节点配置里的「定时策略」要显示的就是它。
   *
   * `sourceId` 与 `ids`（批量，逗号分隔）两个参数后端都认，这里只用单源。
   */
  sourceJobs: async (sourceId: string): Promise<SourceJob[]> => {
    if (!sourceId) return []
    const result = await request<unknown>('source/sourceJobs', { sourceId }, {
      method: 'GET',
      httpEndpoint: 'job/snatchJobPaged',
      httpParams: { page: 1, limit: 50, sourceId },
    })
    const record = result as { list?: unknown[]; records?: unknown[] } | unknown[]
    const rows = Array.isArray(record) ? record : (record?.list ?? record?.records ?? [])
    return (Array.isArray(rows) ? rows : []).map((row) => {
      const r = row as Record<string, unknown>
      return {
        jobId: String(r.jobId ?? ''),
        jobName: String(r.jobName ?? ''),
        sourceId: String(r.sourceId ?? ''),
        schedule: String(r.schedule ?? ''),
        nextRun: r.nextRun == null ? undefined : String(r.nextRun),
        lastRun: r.lastRun == null ? undefined : String(r.lastRun),
        runCount: Number(r.runCnt ?? 0),
        successCount: Number(r.successCnt ?? 0),
        // ⚠️ 启用与否看的是 `isDelete`，不是 `state`——旧平台 SourceCronList.vue:201
        // 就是这么判的：`obj.enabled = (obj.isDelete === 0)`。
        // （旧平台的详情弹窗把 isDelete 的原值按"是/否"枚举显示成「启用：否[0]」，
        //  那是它自己的显示 bug：0 表示"未删除"= 启用，列表里的开关才是对的。）
        // `state` 是运行状态（实测在用的定时是 'C'），与启停无关。
        disabled: Number(r.isDelete ?? 0) !== 0,
      }
    }).filter((job) => job.jobId)
  },
  /**
   * 保存源的定时。**两条路**，选哪条看源上有没有已经存在的定时：
   *
   *   - 有（传 `jobId`）→ `GET job/updateJob`，原地改 cron，jobId 不变；
   *   - 没有 → `POST source/createJobs`，新建一条。
   *
   * ⚠️ 别图省事只用 createJobs：它**只会新建、从不更新**。2026-09-18 实测，
   * 对同一个源连存两次不同的 cron，得到的是 16368 / 16369 两条**同时启用**的定时，
   * 源会被抓两遍；存 N 次就攒 N 条。旧平台也是分两条路走的——列表页编辑走
   * `updateCallback` → `updateJob`（SourceCronList.vue:303），只有源上还没有定时时
   * 才从源列表弹窗走 createJobs。
   *
   * createJobs 另外三个坑，照旧平台 `api/source-job.js` + `SourceCron.vue` 对出来、
   * 并在生产上实测过：
   *   1. **POST 但参数走 query**（旧代码 `method:'post', params: param`），不是 body；
   *   2. `configId` 是后端 `@RequestParam` 的必传参数（缺了直接 400：
   *      `Required request parameter 'configId' ... is not present`）。旧 api 层强制
   *      `param['configId'] = ''` 也能过——axios 保留空串参数；本客户端 query 走
   *      URLSearchParams 序列化（client.ts `appendQuery`），**空串会被跳过**，
   *      所以必须给真实 configId（画布侧传节点配置 ID，见 NodeInspector.syncSourceCron）；
   *   3. **`monitorEnable` 是必填的**，少了直接 500：
   *      `Required request parameter 'monitorEnable' for method parameter type Boolean is not present`。
   *      它是旧弹窗里那个「加监控」开关，默认 false，配套的 `monitorAfter`（N 分钟后）默认 30。
   *
   * `enable` 对应旧弹窗那两个按钮（「提交并启用」/「仅提交」），只在新建时有意义——
   * 改已有定时不动它的启停，那是右上角开关的事。实测传 false 建出来的记录 `isDelete = 1`，
   * 又一次印证启停状态存的就是 isDelete。
   */
  saveSourceCron: async (
    sourceIds: string[],
    cron: string,
    opts: {
      jobId?: string
      enable?: boolean
      configId?: string
      monitor?: { enable?: boolean; afterMinutes?: number }
    } = {},
  ): Promise<Ack> => {
    const trimmed = cron.trim()
    if (!trimmed) return { ok: false, message: '缺少 cron 表达式' }

    if (opts.jobId) {
      const result = await request<unknown>('job/updateJob', { id: opts.jobId, cron: trimmed }, {
        method: 'GET',
        httpEndpoint: 'job/updateJob',
        httpParams: { id: opts.jobId, cron: trimmed },
      })
      return ackFromApiResult(result)
    }

    const ids = sourceIds.filter(Boolean)
    if (!ids.length) return { ok: false, message: '缺少源' }
    const monitor = opts.monitor ?? {}
    const result = await request<unknown>('source/createJobs', { ids, cron: trimmed }, {
      method: 'POST',
      httpEndpoint: 'source/createJobs',
      paramsIn: 'query',
      httpParams: {
        ids: ids.join(','),
        cron: trimmed,
        enable: opts.enable ?? true,
        configId: opts.configId ?? '',
        monitorEnable: monitor.enable ?? false,
        monitorAfter: monitor.afterMinutes ?? 30,
      },
    })
    return ackFromApiResult(result)
  },

  /**
   * 批量配定时（2026-10-23，旧源列表「定时任务变更 → 批量配定时」）。
   *
   * `POST source/createJobs`，参数全在 query（旧 `method:'post', params`）。和上面 saveSourceCron
   * 的新建分支是同一个端点，区别是这里照旧弹窗 1:1 多带 `flowId`，且 `configId` 发空串
   * （批量没有单个节点配置；186 实测不带 configId 报 not present，`configId=` 正常）。
   * ⚠️ 只会新建：源上已有定时也会再建一条，旧平台就是这个行为。
   */
  createJobs: async (input: CreateJobsInput): Promise<Ack> => {
    const httpParams = createJobsToLegacy(input)
    if (!httpParams.ids) return { ok: false, message: '缺少源' }
    if (!httpParams.cron) return { ok: false, message: '缺少 cron 表达式' }
    const result = await request<unknown>('source/createJobs', { ids: input.sourceIds, cron: httpParams.cron }, {
      method: 'POST',
      httpEndpoint: 'source/createJobs',
      paramsIn: 'query',
      keepEmptyParams: ['configId'],
      httpParams,
    })
    return ackFromApiResult(result)
  },
  /**
   * 启用 / 停用定时任务（2026-09-18）。
   *
   * 旧平台 `changeJobState`：启用打 `job/enableJob`、停用打 `job/disableJob`，
   * 都是 GET + `ids` 逗号串。**注意启停状态存的是 `isDelete`**（见 sourceJobs 的说明），
   * 所以停用之后再查，`isDelete` 会变成 1。
   */
  setJobEnabled: async (jobIds: string[], enabled: boolean): Promise<Ack> => {
    const ids = jobIds.filter(Boolean)
    if (!ids.length) return { ok: false, message: '没有可操作的定时任务' }
    const endpoint = enabled ? 'job/enableJob' : 'job/disableJob'
    const result = await request<unknown>(endpoint, { ids }, {
      method: 'GET',
      httpEndpoint: endpoint,
      httpParams: { ids: ids.join(',') },
    })
    return ackFromApiResult(result)
  },
  sourceStats: () => assetMockRequest<{ total: number; error: number; externalChanged: number; disabled: number }>('source/stats'),
  /**
   * 源的子步骤。默认连 config/configDetail 的补充一起返回（topic / 配置名 / 登录语义 /
   * isMulti / 参数绑定），调用方拿到的就是完整数据。
   *
   * `withConfigDetails: false` 只发 nextConfigPaged 就返回——画布用这条快路：
   * 补充那一轮必须等本轮出 configId 才能发，串在首屏前面等于白等一个 RTT
   * （实测切源 nextConfigPaged 115ms → configDetail 124ms → 数据视图自己的查询才开始）。
   * 跳过后由 `stepConfigDetails` 在首屏之后异步补，见 flowModel.seeds 的 applyStepDetails。
   */
  sourceSteps: async (sourceId: string, options: { withConfigDetails?: boolean } = {}) => {
    const result = await request<unknown>('item/next/nextConfigPaged', { sourceId }, {
      method: 'GET',
      httpEndpoint: 'item/next/nextConfigPaged',
      httpParams: { sourceId, page: 1, limit: 10000, svg: true },
    })
    const steps = sourceStepsFromLegacy(result, sourceId)
    return options.withConfigDetails === false ? steps : attachStepConfigDetails(steps)
  },
  /** 步骤的 configDetail 补充，单独拿出来给「先画后补」用 */
  stepConfigDetails: (steps: Step[], backendScope?: RequestOptions['backendScope']) => attachStepConfigDetails(steps, backendScope),

  // 写类 / 高危端点：首期 mock 仅回执，UI 统一二次确认占位（呼应权威方案读写边界）。
  changeSourceEnable: (sourceId: string, disabled: boolean) => changeSourceEnableBatch([sourceId], disabled),
  changeSourceEnableBatch,
  // 改为成功状态（0707 Review #1 修复：端点已登记但此前未封装，SourceTab 曾误用 changeSourceEnable）。
  // 注：endpoints.ts:54 只登记 path 无参数契约，按单源封装；批量场景由调用方循环（见 SourceTab.onOperate）。
  changeToSuccess: (sourceId: string) => assetMockRequest<Ack>('source/changeToSuccess', { sourceId }),
  /**
   * 复制源。旧 `GET /v1/source/copySource?sourceId&name&url&flag`（`SourceList.handleCopySource`）。
   * `flag=1` 同时复制配置，`flag=0` 只复制源、共用原配置。响应 `data` 通常是 null，
   * 新源 ID 请走 `copySourceAndLocate`，不要猜名字。
   */
  copySource,
  copySourceAndLocate,
  /** 发起抓取；真实执行器的登录配置选择参数待 P0 契约确认，当前只沿用旧 sourceIds 请求。 */
  sendSnatch: (sourceIds: string[]) =>
    assetMockRequest<Ack>('source/sendSnatch', { sourceIds }),
  /** 读取源配置的可选参数定义（旧 /v1/config/loadParams）：返回 { [configId]: 参数定义[] }，空对象表示无参数直接发。 */
  loadParams: (sourceIds: string[]) =>
    request<SourceLoadParamsResult>('config/loadParams', { ids: sourceIds }, {
      method: 'GET',
      httpEndpoint: 'config/loadParams',
      httpParams: { ids: sourceIds.join(',') },
    }),
  /** 带参发抓取（旧 /v1/source/sendSnatchWithParam）：query 传 ids/all/skip/include/queue，body 仅传 param（{ "configId_paramId": "v1;v2" }）。 */
  /** 回执经 snatchAckFrom 整理：一个都没发出去时抛错（原因已翻成人话），部分发出时带回 failed（2026-10-22） */
  sendSnatchWithParam: (payload: SendSnatchWithParamPayload): Promise<SnatchAck> =>
    request<unknown>('source/sendSnatchWithParam', payload.param, {
      method: 'POST',
      httpEndpoint: 'source/sendSnatchWithParam',
      query: {
        ids: payload.ids.join(','),
        all: payload.all,
        skip: payload.skip,
        ...(payload.include.length ? { include: payload.include.join(',') } : {}),
        ...(payload.queue ? { queue: payload.queue } : {}),
        // 1008-04「指定流程运行一次」：用这条流程跑这一次，不影响定时与默认流程（旧平台 source.js 同口径）
        ...(payload.flowId ? { flowId: payload.flowId } : {}),
      },
    }).then(snatchAckFrom),
  /** 只读查询启用的 201 派发配置，和发送接口使用同一后端。 */
  codeConfigOptions: (): Promise<CodeConfigOption[]> =>
    request<CodeConfigOption[]>('source/codeConfigOptions', undefined, { method: 'GET', mode: 'http' }),
  /** 独立 MQ 代码生成；configId 为 201 派发配置，queue 省略时使用该配置的 TOPIC。 */
  sendCodeConfig: async (payload: SendCodeConfigPayload): Promise<SendCodeConfigResult> => {
    try {
      return await request<SendCodeConfigResult>('source/sendCodeConfig', { ...payload }, {
        method: 'POST', httpEndpoint: 'source/sendCodeConfig', mode: 'http',
      })
    } catch (error) {
      // 后端部分失败仍携带真实任务回执，让界面保留已派发的任务 ID 和逐项错误。
      const cause = error instanceof ApiError ? error.cause as { payload?: { data?: SendCodeConfigResult } } | undefined : undefined
      const receipt = cause?.payload?.data
      if (receipt && receipt.failCnt > 0 && Array.isArray(receipt.tasks) && Array.isArray(receipt.taskIds)) return receipt
      throw error
    }
  },
  /** 将已创建的真实源关联到网站；真实端点，调用方需在同一环境完成受控写入。 */
  bindSite: async (sourceId: string, siteId: string, options?: Pick<RequestOptions, 'mode'>): Promise<Ack> => {
    const result = await request<unknown>('source/bindSite', { sourceId, siteId }, {
      method: 'GET',
      httpEndpoint: 'source/bindSite',
      httpParams: { sourceId, siteId },
      ...options,
    })
    return ackFromApiResult(result)
  },
  /** 批量把已有源关联/迁到某个网站（0812 计划 M4-5，bindSite 的多源版）；真实端点，调用方需在
   *  同一环境完成受控写入。2026-08-15 生产环境实测确认（Q4）：批次里混无效源 ID 不会导致整批
   *  失败，会静默跳过继续处理有效项，响应只有整批一个 success，没有逐条结果。 */
  changeSite: async (
    sourceIds: string[],
    siteId: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Ack> => {
    const callOnce = async (ids: string[]): Promise<Ack> => {
      const result = await request<unknown>('source/changeSite', { ids, siteId }, {
        method: 'GET',
        httpEndpoint: 'source/changeSite',
        httpParams: { ids: ids.join(','), siteId },
        // 一片几百个源，后端逐条改归属会超过默认 20s（2026-09-07 实测 300 个 → 客户端 20s 超时
        // net::ERR_ABORTED，但后端其实已写入）。给足 2 分钟，让客户端能收到整批回执。
        timeoutMs: 120_000,
      })
      return ackFromApiResult(result)
    }
    if (sourceIds.length <= CHANGE_SITE_CHUNK) {
      try {
        const ack = await callOnce(sourceIds)
        onProgress?.(sourceIds.length, sourceIds.length)
        return ack
      } catch (error) {
        if (!mayHaveLandedDespiteError(error)) throw error
        const landed = await landedInSite(siteId, sourceIds).catch(() => [] as string[])
        onProgress?.(sourceIds.length, sourceIds.length)
        // 一个都没落地时抛回原异常：431 URL 过长 / 5xx 的原文对调用方的错误提示有用，
        // 换成自造的「失败 N 个」反而丢信息。
        if (!landed.length) throw error
        if (landed.length === sourceIds.length) return { ok: true, message: `已导入 ${landed.length} 个源（未收到回执，按实际归属核对）` }
        return {
          ok: false,
          message: `共 ${sourceIds.length} 个源：成功 ${landed.length} 个、失败 ${sourceIds.length - landed.length} 个，请对失败部分重试`,
        }
      }
    }

    // 分片串行提交（不并发：避免网关限流 / 后端锁竞争），逐片累计，最后汇总成一个 Ack。
    const chunks: string[][] = []
    for (let i = 0; i < sourceIds.length; i += CHANGE_SITE_CHUNK) {
      chunks.push(sourceIds.slice(i, i + CHANGE_SITE_CHUNK))
    }
    let succeeded = 0
    let failed = 0
    // 没拿到回执的片：成败不当场算，攒到最后一次性回查（大站 site/sources 一次 8~36s，
    // 逐片查会把一次导入拖成几分钟）。
    const unconfirmed: string[] = []
    for (const chunk of chunks) {
      try {
        if ((await callOnce(chunk)).ok) succeeded += chunk.length
        else failed += chunk.length
      } catch (error) {
        if (mayHaveLandedDespiteError(error)) unconfirmed.push(...chunk)
        else failed += chunk.length
      }
      onProgress?.(succeeded + failed + unconfirmed.length, sourceIds.length)
    }
    if (unconfirmed.length) {
      const landed = await landedInSite(siteId, unconfirmed).catch(() => [] as string[])
      succeeded += landed.length
      failed += unconfirmed.length - landed.length
    }
    if (!failed) return { ok: true, message: `已导入 ${succeeded} 个源（分 ${chunks.length} 批提交）` }
    return {
      ok: false,
      message: `共 ${sourceIds.length} 个源分 ${chunks.length} 批提交：成功 ${succeeded} 个、失败 ${failed} 个，请对失败部分重试`,
    }
  },
  /** 旧平台新建源的一次性提交；请求体字段严格沿用 Step1/2/3 的 snatchSave 契约。 */
  snatchSaveAll: (payload: LegacySnatchSaveRequest) => legacySnatchSaveRequest(payload),
  /** 从当前画布生成旧请求体；请求体字段仍按旧平台命名，待 P0 确认后由明确的新建源动作调用。 */
  snatchSaveFromFlow: (def: FlowDef, loginSubmission?: LegacyLoginSubmission) => {
    const payload = legacySnatchSavePayloadFromFlow(def, loginSubmission)
    assertLegacySnatchSaveLogin(payload)
    return legacySnatchSaveRequest(payload)
  },
  /** 删除源（高危、不可恢复）。契约按旧前端 src/api/source.js:241：GET /v1/source/delete?ids=a,b。
   *  逻辑端点名沿用 source/deleteSource，真实路径用 httpEndpoint 显式指定。 */
  deleteSource: async (sourceIds: string[]): Promise<Ack> => {
    const result = await request<unknown>('source/deleteSource', { ids: sourceIds }, {
      method: 'GET',
      httpEndpoint: 'source/delete',
      httpParams: { ids: sourceIds.join(',') },
    })
    return ackFromApiResult(result)
  },
  sourceLogs: (sourceId: string) => assetMockRequest<SourceLog[]>('source/logPaged', { sourceId }),
  sourceTasks: (sourceId: string) => assetMockRequest<TaskInst[]>('task/topTaskPaged', { sourceId }),
  /** 画布任务视图：与源列表/数据查看「任务实例」同一条 GET /v1/task/topTaskPaged。
   *  逻辑名仍用 source/sourceTaskPaged，便于 vitest 关 live 时走 mock；真实路径按 httpEndpoint 判 live。 */
  sourceTaskPaged: async (q: SourceTaskQuery): Promise<Paged<TaskInst>> => {
    const topic = q.topic || q.queue
    const result = await request<unknown>('source/sourceTaskPaged', q, {
      method: 'GET',
      httpEndpoint: 'task/topTaskPaged',
      // 2026-10-10：只按创建时间查（任务中心「今天」）217 上要 16～25 秒，默认 20 秒会被中断成
      // 「signal is aborted without reason」。疑似 CREATE_DT 没走索引，已提后端（1010-任务中心查询慢_后端需求）。
      timeoutMs: 60_000,
      httpParams: {
        page: q.page ?? 1,
        limit: q.size ?? 20,
        sourceId: q.sourceId,
        // 按网站圈定来源（后端 2026-09-16 加、2026-09-17 修好 SQL；早先版本少一个右括号，
        // 任何值都回 500 语法错）。
        // ⚠️ 取的是 `siteScopeId` 而**不是** `q.siteId`：后者是「当前在看哪个网站」的上下文、
        // 源态也一直带着，直接透传会让源态查询多一层站点过滤，语义就变了。只有网站态看
        // 「全部源」时调用方才会设 siteScopeId，见 types/source.ts 的说明。
        siteId: q.siteScopeId,
        configId: q.configId,
        state: q.state,
        // 任务 ID 精确匹配。2026-09-23 实测生效：站 11 异常任务 5401 条，带真实 taskId → 1 条、
        // taskId=1 → 0 条。同一轮试了数据 ID（bizId/entryId/dataId…）和任务 URL（taskUrl/url…）
        // 近 20 种参数名，全部被忽略（count 恒 5401），已提后端（0923 汇总 B32），别再换名字试。
        taskId: q.taskId,
        // 按数据 ID 查任务（精确匹配）。2026-09-28 实测：源 430017712 共 83 条，parentId=1035124 → 2 条、
        // 不存在的 → 0 条。上面那 20 种参数名里恰好漏了它；数据 ID 就是任务的 parentId（见 TaskView 的 taskIds.ts）。
        parentId: q.parentId,
        // 按任务自身 URL（task_inst.TASK_URL）子串匹配，纯空白视为未传（后端 2026-09-29 加，
        // topTaskPaged-api.md）。实测站 11：mp.weixin.qq.com → 536、某条 URL 路径片段 → 4、不存在 → 0。
        taskUrl: q.taskUrl,
        // 队列名，子串匹配（TASK_TOPIC LIKE %?%）。后端 2026-09-23 加的（B24，topTaskPaged-api.md）；
        // 实测站 11 异常任务 5405 条：news_cont → 5332、qinglong → 7、不存在的名字 → 0。
        // 此前前端顺带发的 topic / queue 两个参数名后端从来不认，已删。
        taskTopic: topic,
        // 按 task_inst.CREATE_DT 的创建时间区间（B27，同一批加的），闭区间，可只传一端。
        // 只给日期时后端自动补成当天 00:00:00.000 ~ 23:59:59.999。格式非法或结束早于开始
        // → 返回 code=1 + msg、不查询（请求层会把 msg 抛成错误）。
        startTime: q.startTime,
        endTime: q.endTime,
      },
    })
    return unwrapTaskInstPage(result)
  },
  credentialRef: (refId: string) => assetMockRequest<CredentialRef | null>('source/credentialDetail', { refId }),
  // 批量导入（0707 Review #3 修复：deep/dir 此前被前端丢弃，现透传）。
  batchImport: (template: string, lines: string, opts?: { deep?: boolean; dir?: string }) =>
    assetMockRequest<Ack>('source/batchImport', { template, lines, deep: opts?.deep ?? false, dir: opts?.dir ?? '' }),
  batchModifyConfig: (sourceIds: string[], configId: string) => assetMockRequest<Ack>('source/batchModifyConfig', { sourceIds, configId }),
  batchSchedule: (sourceIds: string[]) => assetMockRequest<Ack>('source/createJobs', { sourceIds }),
  changeFreqTag: (sourceIds: string[], freqTag: string) => assetMockRequest<Ack>('source/changeFreqTag', { sourceIds, freqTag }),
  markVerified: (sourceIds: string[], verified: string) => assetMockRequest<Ack>('source/markVerified', { sourceIds, verified }),
  /** 源打标签，只追加。2026-09-01 实测报错才发现 source/tagSource 是臆造的端点名，
   *  真实后端从来没有这条路由（真机 GET 500）——对照旧平台 api/source.js 改回真实的
   *  POST /v1/source/markBatch（markBatch(ids, flag, freq, notify, tags)，flag/freq/notify
   *  三个源字段这里不动，传 null）。清标没有 action=clear：旧备注弹窗用 updateSource 把 tags
   *  写成空串覆盖。 */
  tagSource: async (sourceIds: string[], tags: string[], action: 'add' | 'clear' = 'add'): Promise<Ack> => {
    if (action === 'clear') return clearSourceTags(sourceIds)
    const result = await request<unknown>('source/tagSource', { sourceIds, tags, action }, {
      httpEndpoint: 'source/markBatch',
      httpParams: {
        ids: sourceIds,
        flag: null,
        freq: null,
        notify: null,
        tags: issueTagsForWrite(tags),
      },
    })
    return ackFromApiResult(result)
  },
  /**
   * 当前查询条件下真实存在的标签（旧 querySourceTags，`POST /v1/source/sourceTags`，
   * `api/source.js:4,45-52`；旧平台用在 SourceSearch.vue:199-207 渲染 tag 云）。
   *
   * 入参就是 sourcePaged 那套查询条件，所以候选跟着筛选走。
   * 这条比本机的「最近使用」重要：程序打进去的标签（会上「标签一般是程序来打的」）
   * 永远不会出现在本机记录里，不接这个接口就等于看不见它们。
   */
  sourceTags: async (p?: PageQuery): Promise<string[]> => {
    const result = await request<unknown>('source/sourceTags', p, {
      method: 'POST',
      httpEndpoint: 'source/sourceTags',
      httpParams: {
        ids: Array.isArray(p?.sourceIds) ? p.sourceIds.join(',') : (p?.sourceIds ?? p?.ids),
        siteIds: p?.siteIds,
        name: p?.name,
        state: p?.state === 'all' ? undefined : p?.state,
        enable: p?.enable,
        remark: p?.remark,
      },
    })
    return parseIssueTags(Array.isArray(result) ? result : [])
  },
  /**
   * 只改标签与备注，不碰源的其他字段（0831 F02/F04）。
   *
   * 与旧平台「备注信息」弹窗（`SourceList.vue:1519-1561`）同一条接口、同样的 `dataIndex` 命名
   * （tags / remark）。旧弹窗还带一个 `author`（责任人），0831 明确暂不做，所以这里不发它——
   * 不发比发空串安全：万一 updateSource 真是全字段覆盖，发空串会把责任人抹掉。
   *
   * 刻意不复用 `sourceUpdate`：那个走 `sourceToLegacyParams(source)`，会把整个 Source 铺开成
   * 几十个参数发出去，行内改一个标签不该有那么大的作用面。
   *
   * ⚠️ 门禁 G5 未实测：`updateSource` 到底是部分更新还是全字段覆盖没验过。旧平台十几年就这么调，
   * 大概率是部分更新；真要是覆盖，少发字段反而更安全。实测方式见开发计划 G5。
   */
  /**
   * 标签 + 备注的行级写入。`tags` **可缺省**：拿不到这条源当前的标签时（例如批量备注时
   * 勾选来自别的分页、当前页数据里没有它），必须整个不传这个字段，不能退化成空数组——
   * `issueTagsForWrite([])` 是空串，而空串在两种后端语义下都会把标签清掉：全量覆盖自不必说，
   * 就算是 MyBatis-Plus 那种「null 不覆盖」的部分更新，`''` 也不是 null。
   * 0831 后端接口需求 §3 定的策略正是「没答复之前少发字段」，空串属于多发。
   * 旧平台批量备注同款做法（SourceList.vue:1755-1757 `if (row.tags !== undefined)`）。
   * undefined 的字段会被 JSON.stringify 丢掉，body 里不会出现 tags 键。
   */
  updateSourceMark: async (sourceId: string, patch: { tags?: string[]; remark: string }): Promise<Ack> => {
    const result = await request<unknown>('source/updateSource', { sourceId, ...patch }, {
      method: 'POST',
      httpEndpoint: 'source/updateSource',
      httpParams: {
        sourceId,
        tags: patch.tags === undefined ? undefined : issueTagsForWrite(patch.tags),
        remark: patch.remark,
      },
    })
    return ackFromApiResult(result)
  },
  /** 设/清颜色标识。GET /v1/source/setColor 写入 usedFlag 1–8；清除写 flag=0（isClear=1 现网 500）。
   *  0831 F01 起 UI 无入口，保留供旧平台数据兼容与将来的"颜色转标签"迁移，勿删。 */
  setColor: async (sourceIds: string[], flag: number | undefined, clear = false): Promise<Ack> => {
    if (clear) return clearSourceColor(sourceIds)
    const result = await request<unknown>('source/setColor', { sourceIds, flag, clear }, {
      method: 'GET',
      httpEndpoint: 'source/setColor',
      httpParams: {
        ids: sourceIds.join(','),
        flag: flag ?? 1,
        isClear: 0,
      },
    })
    return ackFromApiResult(result)
  },
  generateConfig: (sourceId: string) => assetMockRequest<Ack>('source/generateConfig', { sourceId }),

  // 新建采集源两段式闸门（0706 优化·Phase3）
  sourceCreate: (source: Source) => assetMockRequest<{ ok: boolean; message?: string; sourceId?: string }>('source/createSource', { source }),
  sourceCopy: (fromId: string) => assetMockRequest<Source | null>('source/sourceCopy', { sourceId: fromId }),
  // 源信息编辑抽屉 + 任务视图（0706 优化·Phase4）
  sourceUpdate: async (source: Source) => {
    const result = await request<unknown>('source/updateSource', { source }, {
      method: 'POST',
      httpEndpoint: 'source/updateSource',
      httpParams: sourceToLegacyParams(source),
    })
    return ackFromApiResult(result)
  },
  updateSourceCore: async (sourceId: string, patch: { name?: string; url?: string; coreParam: string }): Promise<Ack> => {
    const result = await request<unknown>('source/updateSource', { source: { sourceId, ...patch } }, {
      method: 'POST',
      httpEndpoint: 'source/updateSource',
      httpParams: sourceCoreToLegacyParams(sourceId, patch),
    })
    return ackFromApiResult(result)
  },
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

// 分类子级缓存：categoryPaged 一次只给一层，展开子树要按 parentId 逐层拉，同一个父节点
// 在一次会话里只拉一次。失败不留缓存，允许下次重试。
const categoryChildrenCache = new Map<string, Promise<SourceCategory[]>>()
const CATEGORY_EXPAND_CONCURRENCY = 8

/** 清理分类树缓存，在分类增删改后调用 */
export function clearCategoryCache(): void {
  categoryChildrenCache.clear()
}

function cachedCategoryChildren(parentId: string): Promise<SourceCategory[]> {
  const cached = categoryChildrenCache.get(parentId)
  if (cached) return cached
  const promise = sourceApi.sourceCategories(parentId)
  categoryChildrenCache.set(parentId, promise)
  void promise.catch(() => {
    if (categoryChildrenCache.get(parentId) === promise) categoryChildrenCache.delete(parentId)
  })
  return promise
}

/**
 * 把选中的分类 ID 展开成「自身 + 全部后代」，给 site/sitePaged 的 categoryIds 用。
 *
 * 后端 `categoryIds` 是**精确匹配 CATEGORY_ID、不含子级**（2026-09-16 生产实测）：选父分类
 * 「财经资讯」(9009005) 只出直接挂在它名下的 1 个网站，子分类「市场主体」(9009336) 下的 4 个
 * 站一个都看不到，跟用户对目录树的预期不符。后端也没有「含子级」开关——`categoryPaged` 的
 * `allSub` 参数实测是死的（true/false 都只返回 5 个根节点），所以子树只能前端自己 BFS 拉。
 *
 * 实测「财经资讯」：81 个后代、82 次请求、约 2s（8 路并发）；展开后筛出 6 个网站。
 * 分类总量 159 个、最深 4 层，属于一次性可接受的量；缓存命中后第二次几乎零开销。
 */
export async function expandCategoryIds(ids: string[]): Promise<string[]> {
  if (!ids.length) return []
  const collected = new Set(ids)
  let frontier = ids
  // 实测最深 4 层；给到 8 层纯粹是防脏数据把父子关系连成环时死循环（collected 去重已能拦住，
  // 这里是第二道闸）。
  for (let depth = 0; frontier.length && depth < 8; depth++) {
    const next: string[] = []
    for (let i = 0; i < frontier.length; i += CATEGORY_EXPAND_CONCURRENCY) {
      const batch = frontier.slice(i, i + CATEGORY_EXPAND_CONCURRENCY).map(
        // 单个分类拉子级失败不该让整个筛选失败：最坏结果是少筛出它那一支，
        // 比直接报错、整页空白要好。
        (id) => cachedCategoryChildren(id).catch(() => [] as SourceCategory[]),
      )
      for (const children of await Promise.all(batch)) {
        for (const child of children) {
          if (!child.id || collected.has(child.id)) continue
          collected.add(child.id)
          next.push(child.id)
        }
      }
    }
    frontier = next
  }
  return [...collected]
}

// 同一 siteId 的 site/sources 在建站画布里会被侧栏、数据视图、选表器等前后脚各拉一遍。
// 共享进行中的请求，并短暂缓存（10s）覆盖「侧栏刚拉完，切到数据视图又拉」这种紧邻场景；
// 写后要读新数据的调用方传 { force: true } 绕过。
// （2026-09-18 实测：site/sources 其实支持分页，6497 个源 limit=20 只要 154ms、全量 4333ms，
//  这里仍按"一次取全"用，因为调用方要的就是整站源集合。）
const siteSourcesCache = new Map<string, { at: number; promise: Promise<Source[]>; value?: Source[] }>()
const SITE_SOURCES_TTL = 10_000

async function requestSiteSources(siteId: string, limit: number, timeoutMs?: number): Promise<Source[]> {
  const result = await request<Paged<unknown> | Source[]>('site/sourcesOfSite', { siteId }, {
    method: 'GET',
    httpEndpoint: 'site/sources',
    httpParams: { siteId, page: 1, limit },
    timeoutMs,
  })
  const list = Array.isArray(result) ? result : result.list
  return list.map(siteSourceFromLegacy)
}

// 全库表目录 `config/queryEntryTypesGroup`（entryTypesGroup）的两条实测口径（2026-09-20）。
// 原写在已删除的 loadSiteTables 上；0924-12 起网站选表下拉改用下面的 siteUsedTables。
//
// 1. **不按源 / 网站过滤**：`sourceId` 只决定分组（哪张进 list1/list2，其余进 list3），
//    list1+list2+list3 的并集恒为全库表（实测带任意源、别站的源、不传，并集都是 83 张）。
//    所以要"本站的表"只能从源的主表 + 流程节点的输入 / 输出表聚合，不能靠这个接口。
//    ⚠️ 判断后端是否改了：不传 sourceId 的并集若小于带 sourceId 的并集，就说明开始按源过滤了。
// 2. **并发别占满连接**：浏览器对单域名只有 6 个连接，client.ts 的 20s 超时从**入队**算起。
//    当年按源分 6 路并发查目录，把同期的 entry/queryEntryType（表结构）、data/rowQueryPaged
//    挤到超时——「表结构暂不可用，已根据当前数据生成列」「N 个源本次查询失败：signal is aborted」
//    都是这么来的。批量请求要自己限并发（见 FLOW_STEPS_CONCURRENCY）。

/**
 * 网站用到的表（0924-09）。聚合规则见 utils/site/usedTables.ts。
 *
 * 请求编排：
 * 1. `siteSources`（已有 10s 缓存，数据视图本来就要拉）→ 按 flowId 去重；
 * 2. 每批 4 个调 `flowCenterApi.steps(flowId, { withConfigDetails: false })`。
 *    **并发上限不能省**：client.ts 的超时从入队算，6 路占满连接会把同期的数据查询挤到超时
 *    （见上方 entryTypesGroup 口径第 2 条）；单个流程失败不阻断，记进 failedFlowIds；
 * 3. `entryTypesGroup`（全库表目录）补表名。
 * 按 siteId 缓存，失败不缓存。失效两道：
 * - 节点写接口（itemApi 的 saveItemConfig / stepModify / deleteStep，会写 entryTypeId / outEntry）成功后整体清空；
 * - 60s 有效期兜底：源换网站、换流程、改主表的入口太散，不逐个接。
 */
export interface SiteUsedTablesResult {
  tables: UsedTable[]
  /** 没关联流程的源数：这些源只统计了主表 */
  noFlowSourceCnt: number
  /** 节点没查回来的流程：用到这些流程的源只统计了主表 */
  failedFlowIds: string[]
}
const siteUsedTablesCache = new Map<string, { at: number; promise: Promise<SiteUsedTablesResult> }>()
const SITE_USED_TABLES_TTL = 60_000
const FLOW_STEPS_CONCURRENCY = 4
/** 节点的输入 / 输出表可能变了：所有网站的"用到的表"一起作废（重算只是按流程查几次，不贵） */
function invalidateSiteUsedTables<T>(result: Promise<T>): Promise<T> {
  return result.then((value) => {
    siteUsedTablesCache.clear()
    return value
  })
}

async function loadSiteUsedTables(siteId: string): Promise<SiteUsedTablesResult> {
  const [sources, group] = await Promise.all([siteApi.siteSources(siteId), dataApi.entryTypesGroup()])
  const flowIds = [...new Set(sources.map((s) => String(s.flowId ?? '')).filter((id) => id && id !== '0'))]
  const stepsByFlow = new Map<string, Step[]>()
  const failedFlowIds: string[] = []
  for (let i = 0; i < flowIds.length; i += FLOW_STEPS_CONCURRENCY) {
    const batch = flowIds.slice(i, i + FLOW_STEPS_CONCURRENCY)
    const results = await Promise.allSettled(batch.map((flowId) => flowCenterApi.steps(flowId, { withConfigDetails: false })))
    results.forEach((result, idx) => {
      if (result.status === 'fulfilled') stepsByFlow.set(batch[idx]!, result.value)
      else failedFlowIds.push(batch[idx]!)
    })
  }
  const catalog = [...group.list1, ...group.list2, ...group.list3]
  return {
    tables: aggregateUsedTables(sources, stepsByFlow, catalog),
    noFlowSourceCnt: countSourcesWithoutFlow(sources),
    failedFlowIds,
  }
}

// 网站—源父子模型（0707 优化·Phase2）：网站=统一流程模板+批量工具（不运行），源=运行实体
export const siteApi = {
  /** 网站源实际用到的表（主表 ∪ 流程节点的输入/输出表），带每张表的源名单（0924-09） */
  siteUsedTables: (siteId: string, options: { force?: boolean } = {}): Promise<SiteUsedTablesResult> => {
    const hit = siteUsedTablesCache.get(siteId)
    if (!options.force && hit && Date.now() - hit.at < SITE_USED_TABLES_TTL) return hit.promise
    const promise = loadSiteUsedTables(siteId)
    const entry = { at: Date.now(), promise }
    siteUsedTablesCache.set(siteId, entry)
    promise.catch(() => {
      if (siteUsedTablesCache.get(siteId) === entry) siteUsedTablesCache.delete(siteId)
    })
    return promise
  },
  refreshSiteUsedTables: (siteId: string) => {
    siteUsedTablesCache.delete(siteId)
  },
  sitePaged: async (p?: PageQuery) => {
    const state = String(p?.state ?? '')
    const category = String(p?.category ?? '')
    const result = await request<Paged<unknown>>('site/sitePaged', p, {
      method: 'POST',
      // **POST 但参数走 query**：真实后端只读 query string，JSON body 整个不看。
      // 2026-09-16 生产实测：body 里传 `name:'新浪'` / `limit:2` / `categoryIds:'9009005'`
      // 一律无效，恒返回全量第一页；同样的键挪到 query 立刻生效（name=新浪→3 条、limit=2→2 条、
      // categoryIds=9009005→1 条）。少这一行，分类筛选 / 网站名筛选 / 分页三个都是**静默失效**，
      // 网站少时完全看不出来，界面表现就是「选了分类，卡片一个没少」。
      paramsIn: 'query',
      httpParams: {
        page: p?.page ?? 1,
        limit: p?.size ?? 20,
        name: p?.name ?? p?.keyword ?? undefined,
        // 源名筛选**不**走这里：真实 site/sitePaged 只按网站名筛，传 sourceName 会被忽略并原样
        // 返回整页（旧实现的 name∪sourceName 并集因此把无关网站也带出来）。源名匹配改由调用方
        // 走 source/sourcePaged?name= 取 siteId 交集，见 SourceTab.loadList。
        state: state === 'error' ? 'ERROR' : undefined,
        // 旧 SiteList 契约：分类筛选走 categoryIds，逗号分隔可传多个，OR 语义
        // （实测 9009005,9009336 → 5 条 = 两个分类各自的并集）。
        // ⚠️ 后端是**精确匹配 CATEGORY_ID，不含子级**：选父分类「财经资讯」(9009005) 只出
        // 直接挂在它名下的网站，子分类「市场主体」(9009336) 下的 4 个站不会带出来。
        categoryIds: category || undefined,
        // 0915-14：按标签筛（后端 2026-09-16 加的 tags 入参）。
        // ⚠️ 实测是**子串匹配**——`服务` 会把 `服务号` 一起筛出来，已反馈后端改精确匹配（B10-2）。
        tags: (p?.tag as string) || (p?.tags as string) || undefined,
      },
    })
    return sitePageFromLegacy(result)
  },
  /** 全局已用网站标签（0915-14）。后端返回的就是拆分去重后的数组，不用前端再聚合。 */
  siteTags: async (): Promise<string[]> => {
    const result = await request<unknown>('site/siteTags', undefined, { method: 'GET' })
    return Array.isArray(result) ? result.map((t) => String(t)).filter(Boolean) : []
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
   * 这三条不标默认 live，避免测试代理误建站。生产新建走 isProductionCreateEnabled + 单次 mode:'http'，
   * 其余未迁移页面继续 mock，不要切全局 VITE_API_MODE=http。
   */
  siteCreate: async (site: Site, sources: Source[] = []): Promise<SiteCreateResult> => {
    if (!isProductionCreateEnabled()) {
      // 已连生产后端却没开新建闸时，**不能**退回 mock（2026-09-03 实测踩到）：mock 只在浏览器本地
      // 落库并回一个前端自造的假 ID（`site-123456` / `src-654321`，见 NewSiteWizard.suggestId），
      // 而读取侧的 source/sourceDetail、item/next/nextConfigPaged、site/sources 都已经是 live，
      // 拿假 ID 打真实后端必然查不到 —— 表现是画布卡在「正在加载源…」、侧栏「该网站暂无源」，
      // 用户还以为建成功了。宁可当场拒绝，也别造出一个只有自己看得见的网站。
      if (isMockMode() && !isProductionBackend()) {
        return assetMockRequest<SiteCreateResult>('site/createSite', { site, sources })
      }
      if (isMockMode()) {
        return {
          ok: false,
          message: '当前已连生产后端但未开启新建通道：mock 只会造出查不到的假 ID。请以 VITE_SITE_CREATE_TARGET=production 启动后重试',
        }
      }
      return { ok: false, message: '新建网站仅允许生产环境，请设置 VITE_SITE_CREATE_TARGET=production' }
    }
    const liveWrite = { mode: 'http' as const }

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
      ...liveWrite,
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
    const savedSourceIds: string[] = []
    for (const source of sources) {
      let saved: LegacySnatchSaveResult
      try {
        saved = await legacySnatchSaveRequest(legacySnatchSavePayloadFromSource(site, source), liveWrite)
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
      savedSourceIds.push(sourceId)
      let bound: Ack
      try {
        bound = await sourceApi.bindSite(sourceId, siteId, liveWrite)
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
      sourceIds: savedSourceIds,
    }
  },
  /** 编辑网站基本信息。契约按旧前端 src/api/site.js:95：POST /v1/site/update，body 为 cfg_site 实体。
   *  只提交本次真正要改的字段 + siteId，不回填整实体，避免把没读到的字段覆盖成空。
   *  2026-08-27 实测：site/detail 真实响应没有 owner/author 这个字段（siteFromLegacy 里
   *  Site.owner 恒为 ''），旧平台真实网站编辑表单（SiteList.vue submitEdit）也没有这一项——
   *  之前塞进 httpParams 的 author 是没有实据的猜测，已删掉，改成只提交 siteId/siteName/categoryId。
   *  categoryId 字段名对齐旧平台 CATEGORY 列配置（dataIndex: 'categoryId'）。 */
  siteUpdate: async (site: Pick<Site, 'siteId' | 'name' | 'dirId' | 'tags'>): Promise<Ack> => {
    const result = await request<unknown>('site/updateSite', { site }, {
      method: 'POST',
      httpEndpoint: 'site/update',
      httpParams: {
        siteId: Number(site.siteId),
        siteName: site.name,
        ...(site.dirId ? { categoryId: Number(site.dirId) } : {}),
        // 0915-14 标签：**分号分隔、不带 `#`**，与源标签的 `issueTagsForWrite`（会补 `#`）不是一套，
        // 所以这里自己 join，不复用那个函数。
        //
        // `undefined` = 本次不动标签（调用方没管这个字段）；后端对没传的字段不会清空。
        // **空数组不在这里发**——空串会被后端当作"未提供"跳过（见下方 siteSetTags），
        // 由外层改走 site/batchChangeTags。
        ...(site.tags === undefined || site.tags.length === 0 ? {} : { tags: site.tags.join(';') }),
      },
    })
    const ack = ackFromApiResult(result)
    // 清空标签得单独发一次：非空标签走上面那一路（一次请求把名称、分类、标签一起存了），
    // 只有清空要补这一次。site/update 本身成功了才补，不然会在一次失败的保存上留下半个副作用。
    if (ack.ok && site.tags?.length === 0) return siteApi.siteSetTags([site.siteId], [])
    return ack
  },
  /**
   * 覆盖式写网站标签（0918-01）。**清空标签的唯一办法。**
   *
   * `site/update` 传空串清不掉：后端按"非空才写"处理，空串被当作"未提供"跳过，
   * 回执照样报"更新成功"但值纹丝不动。2026-09-18 在站 10 原样复现（打 `甲;乙` → 删到 `甲` →
   * 传空串，回查还是 `甲`）。旧平台新版代码里写着「编辑时显式传空串以清空」，那只是前端意图，
   * 后端那条路径没改——别再试 site/update 了。
   *
   * 这条能真清掉：同一次实测传空串后回查 `tags: null`，回执 `{affectedSites: 1}`。
   *
   * 语义（都是实测的）：
   *   - **覆盖式**，不是追加：打 `丙;丁` 后再打 `戊`，结果只剩 `戊`；
   *   - 中文分号后端会归一化：传 `己；庚` 存成 `己;庚`（所以前端不用自己转）；
   *   - 收 `ids` 数组，天然支持批量——网站列表要做批量打标签时直接用，不用另接接口。
   */
  siteSetTags: async (siteIds: string[], tags: string[]): Promise<Ack> => {
    const ids = siteIds.filter(Boolean).map(Number)
    if (!ids.length) return { ok: false, message: '缺少网站' }
    const result = await request<unknown>('site/batchChangeTags', { ids, tags }, {
      method: 'POST',
      httpEndpoint: 'site/batchChangeTags',
      httpParams: { ids, tags: tags.join(';') },
    })
    return ackFromApiResult(result)
  },
  /**
   * 删除网站（旧平台 SiteList 同款，真实路径 GET /v1/site/delete）。逻辑删除（is_delete=1），
   * 后端会校验网站下的源数量；调用方需先二次确认再调。单个删除走 siteId。
   */
  siteDelete: async (siteId: string): Promise<Ack> => {
    if (!siteId?.trim()) return { ok: false, message: '缺少网站' }
    const result = await request<unknown>('site/siteDelete', {}, {
      method: 'GET',
      httpEndpoint: 'site/delete',
      httpParams: { siteId },
    })
    return ackFromApiResult(result)
  },
  siteSources: (siteId: string, options: { force?: boolean } = {}): Promise<Source[]> => {
    const cached = siteSourcesCache.get(siteId)
    // 进行中的完整请求无论耗时多久都必须复用；TTL 只约束已经完成的值，否则一个 36s 请求
    // 到第 10s 后会被侧栏/选表器再次各发一遍，越慢重复请求越多。
    if (!options.force && cached && (!cached.value || Date.now() - cached.at < SITE_SOURCES_TTL)) return cached.promise
    const promise = (async () => {
      // limit 取 10000（与 sourceSteps / sourceCategories 的「一次取全」口径一致）：
      // 1000 会把源多的网站截断，侧栏「源列表 (N)」只显示前 1000 个（2026-09-07 实测 6496 个源的站）。
      // 几千行一次拉回来，默认 20s 会超时（实测 6496 行侧栏偶发 signal aborted → 源列表 (0)）。
      return requestSiteSources(siteId, 10000, 60_000)
    })()
    const entry: { at: number; promise: Promise<Source[]>; value?: Source[] } = { at: Date.now(), promise }
    siteSourcesCache.set(siteId, entry)
    void promise.then((value) => {
      if (siteSourcesCache.get(siteId)?.promise === promise) {
        entry.value = value
        entry.at = Date.now()
      }
    }).catch(() => {})
    void promise.catch(() => {
      // 失败态不留缓存，允许下次重试
      if (siteSourcesCache.get(siteId)?.promise === promise) siteSourcesCache.delete(siteId)
    })
    return promise
  },
  // 采集资产卡片首屏只展示 4 个源 chip，不应为了这 4 个名字下载单站数千条完整源对象。
  // 若画布等页面刚拉过全量则直接切片复用；否则走同一真实端点的小分页请求。
  siteSourcePreview: (siteId: string, limit = 4): Promise<Source[]> => {
    const cached = siteSourcesCache.get(siteId)
    if (cached?.value && Date.now() - cached.at < SITE_SOURCES_TTL) {
      return Promise.resolve(cached.value.slice(0, limit))
    }
    // 完整列表仍在请求中时也单独发轻量预览；不能跟着 cached.promise 等几十秒，否则预览失去意义。
    return requestSiteSources(siteId, limit)
  },
  refreshSiteSources: (siteId: string) => {
    siteSourcesCache.delete(siteId)
  },
  /**
   * 新增源默认从空白流程开始；inherit=true 仅保留给旧数据迁移兼容场景（只在 mock 有效）。
   * site/addSource 是自造的 mock 名；真实路径同 siteCreate：snatchSave → bindSite，开关也同 siteCreate。
   */
  sourceAdd: async (siteId: string, source: Source, inherit = false): Promise<{ ok: boolean; message?: string; sourceId?: string }> => {
    if (!isProductionCreateEnabled()) {
      if (isMockMode() && !isProductionBackend()) {
        return assetMockRequest('site/addSource', { siteId, source, inherit })
      }
      return { ok: false, message: CREATE_DISABLED_MESSAGE }
    }
    // 参数源的 baseUrl/urlTemplate/paramRefs 在 snatchSave 里没有对应字段，硬建会丢参数
    if (source.kind === 'param') return { ok: false, message: '参数源暂未接入真实后端，请先用普通源 + $PARAM$ 占位符' }
    const site = await siteApi.siteDetail(siteId)
    if (!site) return { ok: false, message: `网站「${siteId}」不存在` }
    return createSourceInSite(site, source)
  },
  cloneSource: (requestBody: SourceCloneRequest) =>
    // 侧栏「按模板源添加」已改走 source/copySource；本方法是自造 BFF，保留给旧测试与 mock。
    assetMockRequest<SourceCloneResult>('site/cloneSource', requestBody as unknown as Record<string, unknown>),
  sourceRemove: (siteId: string, sourceId: string) => assetMockRequest<Ack>('site/removeSource', { siteId, sourceId }),
  /**
   * 按网站批量导入源：一行一条「名称;URL」，导入后从空白流程开始。
   * 后端没有批量导入端点（site/importSources 是自造的 mock 名），真实路径逐行走 siteCreate 同一套
   * snatchSave → bindSite；开关同 siteCreate。之前只接了 mock，真实网站在夹具里查不到，报「网站「126」不存在」。
   */
  siteImportSources: async (siteId: string, lines: string): Promise<{ ok: boolean; message?: string; added?: number; skipped?: number }> => {
    if (!isProductionCreateEnabled()) {
      if (isMockMode() && !isProductionBackend()) {
        return assetMockRequest('site/importSources', { siteId, lines })
      }
      return { ok: false, message: CREATE_DISABLED_MESSAGE }
    }
    const rows = lines.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const site = await siteApi.siteDetail(siteId)
    if (!site) return { ok: false, message: `网站「${siteId}」不存在` }
    let added = 0
    let skipped = 0
    const failures: string[] = []
    for (const row of rows) {
      // 只按第一个分号切：URL 里可能自带分号
      const sep = row.search(/[;；]/)
      const name = (sep < 0 ? row : row.slice(0, sep)).trim()
      const url = sep < 0 ? '' : row.slice(sep + 1).trim()
      if (!name) {
        skipped++
        continue
      }
      const source: Source = { sourceId: '', name, url: urlOrPlaceholder(url), configId: '', mainTable: '', owner: site.owner || 'admin', state: 'C' }
      const res = await createSourceInSite(site, source)
      if (res.ok) added++
      else failures.push(`${name}（${res.message}）`)
    }
    if (!added && !failures.length) return { ok: false, message: '没有可导入的行，请检查「名称;URL」格式' }
    const parts = [`已导入 ${added} 条源`]
    if (skipped) parts.push(`跳过 ${skipped} 条`)
    if (failures.length) parts.push(`失败 ${failures.length} 条：${failures.join('；')}`)
    return { ok: added > 0, added, skipped: skipped + failures.length, message: parts.join('，') }
  },
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
  // 生成可能较慢，放宽到 5min（旧页无超时，仅 AbortController 取消）
  const timeout = window.setTimeout(() => controller.abort(), 300_000)
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

/** data-process 生成脚本的流式选项：onChunk 收到增量文本（打字机效果） */
export interface DataProcessGenerateOptions {
  file?: File
  signal?: AbortSignal
  onThinking?: (delta: string) => void
  onContent?: (delta: string) => void
  onDone?: (payload: { message?: string; scriptPath?: string; script?: string }) => void
  onEvent?: (event: { event: string; data: string }) => void
  onChunk?: (delta: string) => void
}

async function fetchDataProcessGenerate(
  payload: DataProcessGeneratePayload,
  options?: DataProcessGenerateOptions,
): Promise<RuleOrchestrationGenerateResult> {
  const endpoint = 'rule/dataProcessGenerate'
  try {
    if (usesMockAdapter(endpoint)) {
      const result = await request<unknown>(endpoint, payload as unknown as Record<string, unknown>, { mode: 'mock' })
      if (result && typeof result === 'object' && 'script' in (result as object)) {
        return result as RuleOrchestrationGenerateResult
      }
      return ruleOrchestrationGenerateFromLegacy(result)
    }
    // 真实接口（0903）：SSE 结构化事件流。POST 不能用原生 EventSource，改用 fetch + ReadableStream，
    // 按 event/data 行解析 thinking/content/done，UI 负责思考面板和代码区回显；若后端仍回纯文本，
    // 保留旧流式兜底。
    const headers: Record<string, string> = { Accept: 'text/event-stream' }
    if (!options?.file) headers['Content-Type'] = 'application/json'
    const token = readStoredToken()
    if (token) headers[ACCESS_TOKEN_HEADER] = token
    const controller = new AbortController()
    const onExternalAbort = () => controller.abort()
    if (options?.signal) {
      if (options.signal.aborted) controller.abort()
      else options.signal.addEventListener('abort', onExternalAbort, { once: true })
    }
    // 生成可能较慢，放宽到 5min（与 fetchRuleOrchestrationStream 对齐；旧页无超时，仅 AbortController 取消）
    const timeout = window.setTimeout(() => controller.abort(), 300_000)
    let res: Response
    try {
      res = await fetch('/api/answer/data-process', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: options?.file
          ? (() => {
              const formData = new FormData()
              formData.append('request', new Blob([JSON.stringify(payload)], { type: 'application/json' }))
              formData.append('file', options.file as File)
              return formData
            })()
          : JSON.stringify(payload),
        signal: controller.signal,
      })
      if (isSessionExpiredRedirect(res)) {
        triggerSessionExpired()
        throw new Error('登录失效,请重新登录')
      }
      if (!res.ok) {
        let detail = ''
        try {
          const raw = await res.text()
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>
            detail = String(parsed.error ?? parsed.message ?? parsed.msg ?? '')
          } catch {
            detail = raw.trim()
          }
        } catch { /* ignore */ }
        if (!detail && res.status === 413) detail = '文件或请求体超过大小限制，请压缩或更换文件'
        throw new Error(detail ? `请求失败 ${res.status}: ${detail.slice(0, 200)}` : `请求失败 ${res.status}`)
      }
      let text = ''
      // vanv-data-engine 的 ServerSentEvent 序列化结果是 `data:<正文>`，没有 SSE
      // 规范中的可选分隔空格；data 后的首个空格可能就是 Python token/缩进的一部分。
      const parser = createSseEventParser({ preserveDataLeadingSpace: true })
      let structured = false
      let content = ''
      let scriptPath = ''
      let doneMessage = ''
      let doneScript = ''
      let doneSeen = false
      const emitEvent = (event: { event: string; data: string }) => {
        structured = true
        options?.onEvent?.(event)
        if (doneSeen) return
        if (event.event === 'thinking') {
          options?.onThinking?.(event.data)
          return
        }
        if (event.event === 'content' || event.event === 'message') {
          if (!event.data) return
          content += event.data
          options?.onContent?.(event.data)
          options?.onChunk?.(event.data)
          return
        }
        if (event.event === 'done') {
          doneSeen = true
          const trimmed = event.data.trim()
          if (!trimmed) return
          try {
            const parsed = JSON.parse(trimmed) as Record<string, unknown>
            if (parsed.message != null) doneMessage = String(parsed.message)
            if (parsed.scriptPath != null) scriptPath = String(parsed.scriptPath)
            if (parsed.script != null) doneScript = String(parsed.script)
          } catch {
            doneMessage = trimmed
          }
          if (!scriptPath) {
            scriptPath = doneMessage.match(/(?:当前文件已保存到|保存到|保存至)\s*([^\s]+)/)?.[1] || ''
          }
          return
        }
        if (event.data) {
          options?.onContent?.(event.data)
          options?.onChunk?.(event.data)
        }
      }
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          const delta = decoder.decode(value, { stream: true })
          if (delta) {
            text += delta
            const events = parser.push(delta)
            for (const event of events) emitEvent(event)
          }
        }
        const tail = decoder.decode()
        if (tail) {
          text += tail
          const events = parser.push(tail)
          for (const event of events) emitEvent(event)
        }
      } else {
        text = await res.text()
        const events = parser.push(text)
        for (const event of events) emitEvent(event)
      }
      const tailEvents = parser.finish()
      for (const event of tailEvents) emitEvent(event)
      if (!structured) {
        if (text) {
          options?.onContent?.(text)
          options?.onChunk?.(text)
        }
        return parseDataProcessStreamText(text)
      }
      const finalScript = doneScript || content
      if (!finalScript.trim()) throw new Error('生成脚本未返回内容')
      const result = { script: finalScript, scriptPath }
      options?.onDone?.({ ...result, message: doneMessage })
      return result
    } finally {
      window.clearTimeout(timeout)
      options?.signal?.removeEventListener('abort', onExternalAbort)
    }
  } catch (e) {
    throw e instanceof ApiError ? e : new ApiError(endpoint, e)
  }
}

/**
 * PDF 抓取节点「解析内容」（1005 方案 §5.2、§11）：样本 PDF + 当前节点提示词 → 后端抽正文喂模型 → 流式回抽取结果。
 *
 * 与 fetchDataProcessGenerate 刻意不同，四条都不能"顺手对齐"：
 * 1. 端点 `/api/answer/document-extract`，附件白名单只有 pdf（data-process 仍只吃 xls/xlsx）；
 * 2. done 事件不解析 scriptPath、不做「已保存到 /code01/….py」的正则兜底——这条链路不产脚本；
 * 3. 返回 `DocumentExtractResult`（content/charCount/truncated/chunkCount/…），不是 RuleOrchestrationGenerateResult；
 * 4. 对数据库和文件服务**零副作用**，调用方只把 content 显示出来。
 *
 * 分块（§11）：正文长到一次调用装不下时后端会分块抽取再合并，期间多两类事件——
 * `chunk`（分块进度，合并轮 index 回到 1 表示结果要重新开始铺）和 `error`
 * （流已经开了，状态码改不了，失败只能带内回）。空闲超时按事件重置，不再按总时长掐。
 */
export interface DocumentExtractOptions {
  file: File
  signal?: AbortSignal
  onThinking?: (delta: string) => void
  onContent?: (delta: string) => void
  onChunk?: (progress: DocumentExtractChunkProgress) => void
  onDone?: (payload: {
    message?: string
    charCount?: number
    truncated?: boolean
    chunkCount?: number
    sourceCharCount?: number
    mergeRounds?: number
  }) => void
}

/** 后端 `event: chunk` 的载荷；phase=merge 且 index=1 时调用方应清空已铺的分段结果。 */
export interface DocumentExtractChunkProgress {
  phase: 'map' | 'merge'
  index: number
  total: number
  pages?: string
  charCount: number
  last: boolean
}

export interface DocumentExtractResult {
  content: string
  charCount: number
  truncated: boolean
  chunkCount: number
  sourceCharCount: number
  mergeRounds: number
}

/** 空闲超时：分块链路靠每块的 chunk 事件保活，只要还在出事件就不掐。 */
const DOCUMENT_EXTRACT_IDLE_TIMEOUT_MS = 300_000

function parseChunkProgress(raw: string): DocumentExtractChunkProgress | null {
  let record: Record<string, unknown>
  try {
    record = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  if (record.phase !== 'map' && record.phase !== 'merge') return null
  const index = Number(record.index) || 0
  const total = Number(record.total) || 0
  if (index < 1 || total < 1) return null
  return {
    phase: record.phase,
    index,
    total,
    pages: typeof record.pages === 'string' && record.pages ? record.pages : undefined,
    charCount: Number(record.charCount) || 0,
    last: record.last === true || record.last === 'true',
  }
}

async function fetchDocumentExtract(
  payload: DocumentExtractPayload,
  options: DocumentExtractOptions,
): Promise<DocumentExtractResult> {
  const endpoint = 'rule/documentExtract'
  try {
    if (usesMockAdapter(endpoint)) {
      const result = await request<unknown>(endpoint, { ...payload, fileName: options.file.name }, { mode: 'mock' })
      const record = (result ?? {}) as Record<string, unknown>
      const content = String(record.content ?? '')
      if (!content.trim()) throw new Error('解析未返回内容')
      const truncated = record.truncated === true
      const charCount = Number(record.charCount ?? 0) || content.length
      const chunkCount = Number(record.chunkCount ?? 0) || 1
      const done = {
        message: String(record.message ?? '解析完成'),
        charCount,
        truncated,
        chunkCount,
        sourceCharCount: Number(record.sourceCharCount ?? 0) || 0,
        mergeRounds: Number(record.mergeRounds ?? 0) || 0,
      }
      options.onContent?.(content)
      options.onDone?.(done)
      return { ...done, content }
    }
    const headers: Record<string, string> = { Accept: 'text/event-stream' }
    const token = readStoredToken()
    if (token) headers[ACCESS_TOKEN_HEADER] = token
    const controller = new AbortController()
    const onExternalAbort = () => controller.abort()
    if (options.signal) {
      if (options.signal.aborted) controller.abort()
      else options.signal.addEventListener('abort', onExternalAbort, { once: true })
    }
    let timeout = window.setTimeout(() => controller.abort(), DOCUMENT_EXTRACT_IDLE_TIMEOUT_MS)
    const resetIdleTimeout = () => {
      window.clearTimeout(timeout)
      timeout = window.setTimeout(() => controller.abort(), DOCUMENT_EXTRACT_IDLE_TIMEOUT_MS)
    }
    try {
      const formData = new FormData()
      formData.append('request', new Blob([JSON.stringify(payload)], { type: 'application/json' }))
      formData.append('file', options.file)
      // 不手写 Content-Type：boundary 必须由浏览器补，后端按 @RequestPart 绑定 request/file
      const res = await fetch('/api/answer/document-extract', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: formData,
        signal: controller.signal,
      })
      if (isSessionExpiredRedirect(res)) {
        triggerSessionExpired()
        throw new Error('登录失效,请重新登录')
      }
      if (!res.ok) {
        let detail = ''
        try {
          const raw = await res.text()
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>
            detail = String(parsed.error ?? parsed.message ?? parsed.msg ?? '')
          } catch {
            detail = raw.trim()
          }
        } catch { /* ignore */ }
        if (!detail && res.status === 413) detail = '文件或请求体超过大小限制，请压缩或更换文件'
        throw new Error(detail ? `请求失败 ${res.status}: ${detail.slice(0, 200)}` : `请求失败 ${res.status}`)
      }
      let text = ''
      // 后端 Spring SSE writer 输出 `data:<正文>`，没有规范里的可选空格，首空格可能属于正文
      const parser = createSseEventParser({ preserveDataLeadingSpace: true })
      let structured = false
      let content = ''
      let doneMessage = ''
      let doneCharCount = 0
      let doneTruncated = false
      let doneChunkCount = 0
      let doneSourceCharCount = 0
      let doneMergeRounds = 0
      let doneSeen = false
      let streamError = ''
      const emitEvent = (event: { event: string; data: string }) => {
        structured = true
        if (doneSeen) return
        if (event.event === 'thinking') {
          options.onThinking?.(event.data)
          return
        }
        if (event.event === 'content' || event.event === 'message') {
          if (!event.data) return
          content += event.data
          options.onContent?.(event.data)
          return
        }
        if (event.event === 'chunk') {
          const progress = parseChunkProgress(event.data)
          if (progress) {
            // 合并轮次从第一段起就是新的正文，之前累积的分块结果不再展示
            if (progress.phase === 'merge' && progress.index === 1) content = ''
            options.onChunk?.(progress)
          }
          return
        }
        // SSE 已经发出，HTTP 状态早就是 200，中途失败只能靠 in-band 的 error 事件
        if (event.event === 'error') {
          streamError = event.data.trim()
          return
        }
        if (event.event === 'done') {
          doneSeen = true
          const trimmed = event.data.trim()
          if (!trimmed) return
          try {
            const parsed = JSON.parse(trimmed) as Record<string, unknown>
            if (parsed.message != null) doneMessage = String(parsed.message)
            if (parsed.charCount != null) doneCharCount = Number(parsed.charCount) || 0
            if (parsed.truncated != null) doneTruncated = parsed.truncated === true || parsed.truncated === 'true'
            if (parsed.chunkCount != null) doneChunkCount = Number(parsed.chunkCount) || 0
            if (parsed.sourceCharCount != null) doneSourceCharCount = Number(parsed.sourceCharCount) || 0
            if (parsed.mergeRounds != null) doneMergeRounds = Number(parsed.mergeRounds) || 0
          } catch {
            doneMessage = trimmed
          }
          return
        }
        // 陌生事件名不能拼进正文，只忽略
      }
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          const delta = decoder.decode(value, { stream: true })
          if (delta) {
            text += delta
            resetIdleTimeout()
            for (const event of parser.push(delta)) emitEvent(event)
          }
        }
        const tail = decoder.decode()
        if (tail) {
          text += tail
          for (const event of parser.push(tail)) emitEvent(event)
        }
      } else {
        text = await res.text()
        for (const event of parser.push(text)) emitEvent(event)
      }
      for (const event of parser.finish()) emitEvent(event)
      // 后端退化成纯文本时，整段正文就是抽取结果（不做脚本那套解析）
      if (!structured && text) {
        content += text
        options.onContent?.(text)
      }
      if (streamError) throw new Error(streamError)
      if (!content.trim()) throw new Error('解析未返回内容')
      const charCount = doneCharCount || content.length
      const result: DocumentExtractResult = {
        content,
        charCount,
        truncated: doneTruncated,
        chunkCount: doneChunkCount || 1,
        sourceCharCount: doneSourceCharCount,
        mergeRounds: doneMergeRounds,
      }
      options.onDone?.({
        message: doneMessage || '解析完成',
        charCount,
        truncated: result.truncated,
        chunkCount: result.chunkCount,
        sourceCharCount: result.sourceCharCount,
        mergeRounds: result.mergeRounds,
      })
      return result
    } finally {
      window.clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onExternalAbort)
    }
  } catch (e) {
    throw e instanceof ApiError ? e : new ApiError(endpoint, e)
  }
}

// 规则资产（M3）
// ck_source 监控源配置（2026-09-05，vanv-data-engine SourceController）：
// 数据监控节点保存时同步落库。list 按 sourceId 查存在性（SOURCE_ID 不唯一，可能多行）；
// insert 返回自增主键；update 按 sourceId 匹配，body 里为 null 的字段保留原列值。
export const ckSourceApi = {
  list: (sourceId: string) =>
    request<CkSourceRecord[]>('monitor/ckSourceList', { sourceId }, {
      method: 'GET',
      httpEndpoint: '/api/source/list',
    }),
  /**
   * 分页查 ck_source（2026-09-18，监控配置 Tab 列表）。pageNum 从 1 开始；
   * sourceId / name 为可选筛选，缺省翻整表。后端按主键倒序返回。
   */
  page: (query: { pageNum: number; pageSize: number; sourceId?: string; name?: string }) =>
    request<CkSourcePage>('monitor/ckSourcePage', query as unknown as Record<string, unknown>, {
      method: 'GET',
      httpEndpoint: '/api/source/page',
    }),
  insert: (source: CkSourcePayload) =>
    request<number>('monitor/ckSourceInsert', source as unknown as Record<string, unknown>, {
      httpEndpoint: '/api/source/insert',
    }),
  update: (source: CkSourcePayload) =>
    request<boolean>('monitor/ckSourceUpdate', source as unknown as Record<string, unknown>, {
      httpEndpoint: '/api/source/update',
    }),
}

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
  // 「引用已有规则」（0805 的 orchestrationOwnRules）**已删除**（2026-09-04）：它列的是旧规则
  // 平台的 compose 记录，用户确认那个平台已废弃、现在统一走配置。要恢复得先接新平台的列表接口。
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
  // 下载脚本正文：GET /api/file/download?fileId=（响应纯文本/原文）
  fileDownloadScript: async (fileId: string) => {
    const endpoint = 'file/download'
    const path = fileId.trim()
    if (!path) throw new Error('文件路径为空')
    if (usesMockAdapter(endpoint)) {
      const result = await request<unknown>(endpoint, { fileId: path }, { mode: 'mock' })
      return String(result ?? '')
    }
    try {
      return await fetchVruleText(`/api/file/download?fileId=${encodeURIComponent(path)}`, { method: 'GET' })
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
      // 默认 hybrid：真实 stream 挂了（生产 dashscope 4xx/超时）时回退 mock 骨架，避免「生成脚本」死路。
      if (isMockMode()) {
        const result = await request<unknown>(endpoint, { ruleCfg }, { mode: 'mock' })
        if (result && typeof result === 'object' && 'script' in (result as object)) {
          return result as RuleOrchestrationGenerateResult
        }
        return ruleOrchestrationGenerateFromLegacy(result)
      }
      throw e instanceof ApiError ? e : new ApiError(endpoint, e)
    }
  },
  dataProcessGenerate: fetchDataProcessGenerate,
  documentExtract: fetchDocumentExtract,
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
  // 脚本测试：POST /vrule/fastapi/execute/code，按文件路径执行当前行参数
  executeCode: async (req: CodeExecuteRequest) => {
    const endpoint = 'rule/executeCode'
    const opts = {
      method: 'POST' as const,
      httpEndpoint: '/vrule/fastapi/execute/code',
      paramsIn: 'body' as const,
      timeoutMs: req.timeout * 1000 + 5000,
    }
    const payload: { code_path: string; params?: Record<string, string>; timeout: number } = {
      code_path: req.codePath,
      timeout: req.timeout,
    }
    if (req.params) payload.params = req.params
    if (usesMockAdapter(endpoint, opts)) {
      return request<unknown>(endpoint, payload, { mode: 'mock' })
    }
    try {
      return await request<unknown>(endpoint, payload, opts)
    } catch (e) {
      throw e instanceof ApiError ? e : new ApiError(endpoint, e)
    }
  },
  // 2026-09-10：规则脚本工作区「保存脚本」对接 POST /api/file/upload，
  // JSON body={"fileId":"<脚本路径>","body":"<脚本内容>"}。
  fileUploadScript: async (fileId: string, body: string) => {
    return request<Ack>('file/upload', { fileId, body }, {
      method: 'POST',
      httpEndpoint: '/api/file/upload',
      paramsIn: 'body',
      responseType: 'json-or-text',
    })
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
  // 末尾分号在这里必然出错：条件是拼进 WHERE 的片段，带时间范围时还会被包成 `(条件;)`。
  // 用户从数据库客户端复制语句过来常常带着它（2026-09-09 实测报错）。
  const sql = q.sql ? stripTrailingSemicolon(q.sql.trim()) : ''
  if (sql) parts.push(q.startTime || q.endTime ? `(${sql})` : sql)
  return parts.join(' AND ') || undefined
}

/**
 * 导出用的 more（0930-14A）：导出必须和页面查出来的是同一批数据。
 *
 * 查询时数据 ID / 父 ID 走单独参数（entryId / parentId），导出接口认不认没验证过；
 * 后端认 more 是实测过的（2026-10-03，217：同一源 76 行，带 `ENTRY_ID = 991919` 只导出 1 行），
 * 所以统一折成 `ENTRY_ID in (...)` / `PARENT_ID in (...)` 写进 more。
 * ID 只留纯数字（拼进 SQL 片段）；填了内容但一个合法 ID 都没有时写 `ENTRY_ID is null`——
 * 页面上这时查不到数据，导出也不能因为条件被丢掉而变成整表。
 */
function buildExportMore(q: RowQuery) {
  // 带引号写法与 backTraceSources 一致（10-16 186 实测导出认）；空数组不加条件，调用方自己保证非空
  const sourceClause = q.sourceIds?.length
    ? `SOURCE_ID in (${q.sourceIds.map((id) => `'${escapeLegacySqlString(id)}'`).join(',')})`
    : undefined
  return joinMore([idInClause('ENTRY_ID', q.dataId), idInClause('PARENT_ID', q.parentId), sourceClause], buildLegacyMore(q))
}

/**
 * 数据 ID / 父 ID 输入框的内容折成 SQL 片段：空 → undefined；填了但一个合法 ID 都没有 → `ENTRY_ID is null`（主键不为空，恒查不到）。
 * 不能写 `1 = 0`：查询和导出接口都报「传到的条件含有非法注入风险」（2026-10-08 217 实测）；
 * 也不用 `PARENT_ID in (0)` / `is null`——根数据的父 ID 就是 0 或空。
 */
function idInClause(column: string, raw?: string): string | undefined {
  if (!raw?.trim()) return undefined
  const ids = raw.split(/[\s,，]+/).filter((id) => /^\d+$/.test(id))
  return ids.length ? `${column} in (${ids.join(',')})` : 'ENTRY_ID is null'
}

function isSingleId(raw?: string) {
  return !!raw && /^\s*\d+\s*$/.test(raw)
}

/** ID 片段与 SQL / 时间范围合成 more；后者可能含 OR，有 ID 片段时加括号隔开 */
function joinMore(idParts: Array<string | undefined>, more?: string) {
  const parts = idParts.filter((part): part is string => !!part)
  if (more) parts.push(parts.length ? `(${more})` : more)
  return parts.join(' AND ') || undefined
}

const SORT_FIELD_MAP: Record<string, string> = {
  updateDt: 'UPDATE_DT',
  createDt: 'CREATE_DT',
  dataId: 'ENTRY_ID',
  sourceId: 'SOURCE_ID',
  parentId: 'PARENT_ID',
  state: 'STATE',
}

function resolveSortField(field?: string): string | undefined {
  if (!field) return undefined
  return SORT_FIELD_MAP[field] ?? field
}

function buildLegacyRowQuery(q: RowQuery) {
  const mappedField = resolveSortField(q.sortField)
  const isTimeField = mappedField === 'UPDATE_DT' || mappedField === 'CREATE_DT'
  // 后端 entryId / parentId 是单个 Long：填多个 ID（或非数字）原样发过去整个查询 500（2026-10-08 217 实测）。
  // 单个 ID 照旧走参数；其余折成 `ENTRY_ID in (...)` 并进 more，与导出（buildExportMore）同一口径。
  const singleDataId = isSingleId(q.dataId)
  const singleParentId = isSingleId(q.parentId)
  return {
    page: q.page ?? 1,
    limit: q.size ?? 20,
    entryType: numericId(q.tableId),
    sourceId: q.sourceId,
    entryId: singleDataId ? q.dataId!.trim() : undefined,
    parentId: singleParentId ? q.parentId!.trim() : undefined,
    // 多选由调用方 join(',') 传入；旧 AES 载荷无值时不带该键（不兜底 'ALL'，见方案开放项 2）
    state: q.state || undefined,
    nextFlag: q.nextFlag,
    // SQL 条件的旧后端字段名是 more（不是 sql）；发错会被后端静默忽略，筛选失效。
    // 时间范围同样合并进 more，保留旧端点和 AES 载荷契约。
    min: q.sql ? q.min || 0 : q.min,
    max: q.max,
    more: joinMore([
      singleDataId ? undefined : idInClause('ENTRY_ID', q.dataId),
      singleParentId ? undefined : idInClause('PARENT_ID', q.parentId),
    ], buildLegacyMore(q)),
    // 对照真实源码 EntryList2.vue：该页排序一律走 field/type 数值化 hack（含 ENTRY_ID 本身），
    // sorted 恒为 '0'；entry.js 里 sortField==='ENTRY_ID' 触发 sorted±1 的分支是给另一套表格组件
    // （s-table/AntD sorter）准备的，此页从不设置 sortField/sortOrder，是死分支，不迁移。
    // 时间列（UPDATE_DT/CREATE_DT）直接使用物理列名排序，不需要 (+ 0) 数值化。
    sorted: '0',
    field: mappedField ? (isTimeField ? mappedField : `(${mappedField}+ 0)`) : undefined,
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
  // 按产出节点筛选（2026-08-22）：CONFIG_ID 是文件行自带的物理列，走等值条件由后端过滤，
  // 不能在前端按页过滤——那样只筛得到当前这一页，翻页就露馅。
  if (q.configId?.trim()) parts.push(`CONFIG_ID = '${escapeFileResourceLike(q.configId.trim())}'`)
  // 自定义 SQL（对齐旧平台 FileList2.vue 的"自定义SQL, 如 K1 IS NULL"，此前迁移遗漏，见 M3-2 补漏）：
  // 用户输入可能本身含 OR，加括号后再与其他条件 AND，避免优先级被吃掉。
  const customSql = q.sql ? stripTrailingSemicolon(q.sql.trim()) : ''
  if (customSql) parts.push(`(${customSql})`)
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
    configId: row.configId,
    detailId: row.detailId,
    parentId: row.parentId,
    categoryId: row.categoryId,
    seq: row.seq,
    times: row.times,
    k0: row.k0,
    nextFlag: row.nextFlag,
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
  entryTypesGroup: async (sourceId?: string, dsKind?: EntryType['dsKind']) => {
    const result = await request<unknown>('data/entryTypesGroup', { sourceId, dsKind }, {
      method: 'GET',
      httpEndpoint: 'config/queryEntryTypesGroup',
      httpParams: { sourceId, dsKind },
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
    return { tables: tables.length, rows: tables.reduce((sum, table) => sum + (table.rowCount ?? 0), 0), chars: 0, review: 0 }
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
    const topic = q.topic || q.queue
    const result = await request<unknown>('data/taskInstPaged', q, {
      method: 'GET',
      httpEndpoint: 'task/topTaskPaged',
      httpParams: {
        page: q.page ?? 1, limit: q.size ?? 20,
        taskId: q.taskId, sourceId: q.sourceId, configId: q.configId,
        parentId: q.parentId, fileId: q.fileId, taskSpecId: q.taskSpecId, state: q.state,
        taskTopic: topic, topic, queue: topic,
      },
    })
    return unwrapTaskInstPage(result)
  },
  // 重发任务实例：ids 逗号连接（危险，endpoints.ts 已登记 danger:true）
  resendTask: (taskIds: string[]) =>
    request<{ message?: string }>('data/resendTask', { taskIds }, {
      method: 'GET',
      httpEndpoint: 'task/resetTaskInsts',
      httpParams: { ids: taskIds.join(',') },
    }),
  // 发选中/本页后续：entryIds 逗号连接（危险）。同时带上后续步骤/配置标识（configId / itemConfig / stepId / nextStep）
  nextStep: (
    sourceId: string,
    tableId: string,
    entryIds: string[],
    configOptions?: string | { configId?: string; itemConfig?: string; stepId?: string; nextStep?: string },
  ) => {
    const opts = typeof configOptions === 'string'
      ? { configId: configOptions }
      : (configOptions ?? {})
    return request<{ message?: string }>('data/nextStep', { sourceId, tableId, entryIds, ...opts }, {
      method: 'GET',
      httpEndpoint: 'source/nextStep',
      httpParams: {
        sourceId,
        entryTypeId: tableId,
        entryIds: entryIds.join(','),
        ...(opts.configId ? { configId: opts.configId } : {}),
        ...(opts.itemConfig ? { itemConfig: opts.itemConfig } : {}),
        ...(opts.stepId ? { stepId: opts.stepId } : {}),
        ...(opts.nextStep ? { nextStep: opts.nextStep } : {}),
      },
    })
  },
  // 大批量后续：POST AES，180s 超时（危险）
  nextStepBatch: (params: {
    tableId: string; sourceId?: string; state?: string
    size: number; start: number; end?: number; nextFlag?: string; cond?: string
    configId?: string; itemConfig?: string; stepId?: string
  }) =>
    request<{ message?: string }>('data/nextStepBatch', params, {
      method: 'POST',
      timeoutMs: 180_000,
      httpEndpoint: 'source/nextStep2',
      httpParams: {
        data: encryptLegacyPayload({
          entryTypeId: params.tableId, sourceId: params.sourceId, state: params.state,
          size: params.size, start: params.start, end: params.end,
          nextFlag: params.nextFlag,
          configId: params.configId,
          itemConfig: params.itemConfig,
          stepId: params.stepId,
          cond: params.cond ? stripTrailingSemicolon(params.cond.trim()) || undefined : params.cond,
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
  // 按当前查询条件导出。旧平台 EntryList2.vue handleExport 也带 more；此前这里漏了它，
  // 页面筛了 SQL / 时间 / 数据 ID / 父 ID，导出的仍是整表（或整源）——见 buildExportMore。
  // nextFlag 原样透传：后端导出是否认它未验证（旧平台导出没带）。
  exportUrl: (q: RowQuery): string => {
    const built = buildLegacyRowQuery(q)
    return appendQuery(BASE_URL + 'entry/entryExportAll', {
      entryType: built.entryType, sourceId: built.sourceId, state: built.state,
      min: q.min, max: q.max, nextFlag: q.nextFlag,
      more: buildExportMore(q),
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

/**
 * 源监控（数据源告警）。0910 从旧平台 MonitorList 迁入，接口对齐 api/monitor.js。
 *
 * ⚠️ **这套接口契约大部分仍是临时的**：2026-09-10 确认后端要重做，路径与字段都会变。
 * 0916 用户提供了 source/check/paged 的真实调用契约，首屏只传 page/limit；
 * 其余端点暂不 live（见 endpoints.ts 同名分组说明）。下面的参数名、字段映射除 paged
 * 与 pagedLogs 已按 0915 口径外，其余仍照旧平台口径写，**接口定稿后需逐项对齐**——
 * 尤其是分页参数（现按后端认的 page/limit 传，不是 pageNo/pageSize）、
 * isDelete 的反向语义、以及 lastMsg 那串带时间戳前缀的文本格式。
 * UI 层不受影响：SiteMonitorView / CheckLogDialog 只消费 SourceCheck / SourceCheckLog
 * 这两个类型，接口怎么变都只需要改这一层的映射。
 *
 * 分页参数注意：旧平台发出去的是 `page` / `limit`，不是 `pageNo` / `pageSize`
 * （它在 api 层临时改了名再发），这里直接按后端认的名字传。
 *
 * `sourceId` 是可选单值：首屏不传 sourceId，用户主动选择具体源后再透传。
 */
export const sourceCheckApi = {
  paged: async (q: SourceCheckQuery): Promise<Paged<SourceCheck>> => {
    const result = await request<unknown>('source/check/paged', q, {
      method: 'GET',
      httpParams: {
        sourceId: q.sourceId,
        enable: q.enable || undefined,
        state: q.state || undefined,
        name: q.name || undefined,
        page: q.page ?? 1,
        limit: q.size ?? 10,
      },
    })
    return unwrapPage<SourceCheck>(result)
  },
  pagedLogs: async (q: SourceCheckLogQuery): Promise<Paged<SourceCheckLog>> => {
    const result = await request<unknown>('source/check/paged-logs', q, {
      method: 'GET',
      httpParams: {
        sourceId: q.sourceId,
        jobId: q.jobId,
        state: q.state || undefined,
        name: q.name || undefined,
        page: q.page ?? 1,
        limit: q.size ?? 10,
      },
    })
    return unwrapPage<SourceCheckLog>(result)
  },
  /** 启停。enable 传后端口径：0=在用、1=停用，与 isDelete 同义（不是布尔） */
  changeEnable: async (ids: string[], enable: 0 | 1): Promise<Ack> => {
    const result = await request<unknown>('source/check/changeEnable', { ids, enable }, {
      method: 'GET',
      httpParams: { ids: ids.join(','), enable },
    })
    return ackFromApiResult(result)
  },
  runNow: async (ids: string[]): Promise<Ack> => {
    const result = await request<unknown>('source/check/runNow', { ids }, {
      method: 'GET',
      httpParams: { ids: ids.join(',') },
    })
    return ackFromApiResult(result)
  },
}

/**
 * 按配置名精确查已有配置。抽成模块级函数是为了打断循环推断——
 * 在 configApi 的成员里互相引用 configApi 会让 TS 推不出对象类型。
 */
/** 按名**模糊**查（后端 name 就是模糊匹配）。用于复制后定位新配置：`原名_copy` 一定包含原名。 */
async function configsByNameLike(name: string): Promise<Config[]> {
  const trimmed = name.trim()
  if (!trimmed) return []
  const result = await request<Paged<unknown>>('config/configPaged', { name: trimmed, page: 1, size: 100 }, {
    method: 'GET',
    httpParams: { page: 1, limit: 100, name: trimmed },
  })
  return configPageFromLegacy(result).list
}

async function configsByExactName(name: string): Promise<Config[]> {
  const trimmed = name.trim()
  if (!trimmed) return []
  // 直接发请求而不是走 configApi.configPaged：在 configApi 成员里引用 configApi 会形成
  // 循环推断，TS 推不出整个对象的类型（表现是后面新加的成员"不存在于类型上"）。
  const result = await request<Paged<unknown>>('config/configPaged', { name: trimmed, page: 1, size: 50 }, {
    method: 'GET',
    httpParams: { page: 1, limit: 50, name: trimmed },
  })
  return configPageFromLegacy(result).list.filter((item) => item.name === trimmed)
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
  configDetail: async (configId: string, options: Pick<RequestOptions, 'backendScope'> = {}) => {
    const result = await request<unknown>('config/configDetail', { configId }, { method: 'GET', ...options })
    return result && typeof result === 'object' && !('ok' in result) ? configFromLegacy(result) : null
  },
  /**
   * 更新配置。入参已经是**旧平台字段名的完整记录**（`buildConfigPayload` 在 configDetail 原始记录上改出来的），
   * 直接原样 POST——**不要再过 configToLegacy**：那个函数是"模型 → 旧字段"的转换，读的是 `name`/`multiMode`/
   * `templateCode` 这些模型键，对已经是旧字段名的 payload 全部读成 undefined，
   * 结果只有键名恰好相同的几个字段（configId/topic/entryTypeId/codeRule/contentRule）侥幸活下来，
   * 配置名称/是否列表/业务类型/去重/输入表 全部写空 —— 表现就是"点了保存但没更新"。
   */
  updateConfig: (payload: Record<string, unknown>) =>
    request<Ack>('config/modify/updateConfig', { config: payload }, { method: 'POST', httpParams: payload }),
  /**
   * 「选择已有配置」的候选来源（旧平台 ConfigSelect.vue 同款）：按源查同资源配置，
   * list1 = 同域/local、list2 = 其它域。旧前端合并顺序是 [...list2, ...list1]，这里照搬，
   * 免得同一个源在新旧平台看到的候选顺序不一样。configId 传当前值，后端用来排除自身。
   */
  sameConfigs: async (sourceId: string, configId?: string) => {
    const result = await request<unknown>('item/next/configs/same', { sourceId, configId }, {
      method: 'GET',
      httpParams: { sourceId, configId },
    })
    const record = (result ?? {}) as { list1?: unknown[]; list2?: unknown[] }
    return [...(record.list2 ?? []), ...(record.list1 ?? [])].map(configFromLegacy)
  },
  /**
   * 配置详情的原始记录。「另存为新配置」要在后端原样字段上改 —— 我们的 Config 模型没有覆盖
   * clearRule/transRule/checkRule 等 BLOB 字段，从建模值重建 payload 会把它们清空。
   */
  configDetailRaw: async (configId: string, options: Pick<RequestOptions, 'backendScope'> = {}) => {
    const result = await request<unknown>('config/configDetail', { configId }, { method: 'GET', ...options })
    if (!result || typeof result !== 'object' || 'ok' in result) return null
    const record = legacyConfigRecord(result)
    return Object.keys(record).length ? record : null
  },
  /**
   * 配置名是否已被占用（精确同名）。
   * 「另存为新配置」要求用户填一个不与现有配置重名的新名字：copyAll 复制出来的叫 `原名_copy`，
   * 紧接着要用这个新名字改名；重名会让配置列表里出现两条同名记录，后续按名定位全乱。
   */
  configNameExists: async (name: string, excludeConfigId?: string): Promise<boolean> => {
    const hits = await configsByExactName(name)
    return hits.some((item) => item.configId !== excludeConfigId)
  },
  /**
   * 「另存为新配置」的第一步：复制原配置并定位复制出来的那条。
   *
   * **为什么不用 `updateConfig` 不带 configId 新建**：2026-08-28 生产实测，那样**不会创建任何配置**
   * （接口返回 success，但配置操作日志里没有对应的 CONF_ADD，全库当天只新增了一条 `copy from`）。
   * `config_api.md` §二「configId 缺省即为新增」与实际行为对不上。旧平台也从没这么用过——
   * 它的配置列表连「新增」按钮都没有，`updateConfig` 三个调用点全带 configId；
   * 建配置只有三条路：新建源向导 `snatch/snatchSave`、源列表 `source/genConfig`、配置列表 `config/copyAll`。
   *
   * **为什么按 ID 差集定位而不是猜名字**：copyAll 生成的名字是 `原名_copy`，但那个名字可能**早就被占用**
   * （生产上就有一条历史遗留的 `test2_copy`），按名字回查会认错。改成复制前后各查一次同名前缀，
   * 取新增的 ID——不依赖任何命名规则。
   */
  copyConfigAndLocate: async (sourceConfigId: string, sourceName: string) => {
    const before = new Set((await configsByNameLike(sourceName)).map((item) => item.configId))
    const ack = await request<Ack>('config/copyAll', { configId: sourceConfigId }, {
      method: 'GET',
      httpParams: { id: sourceConfigId },
    })
    if (ack && 'ok' in ack && !ack.ok) return { ok: false as const, message: ack.message }
    const added = (await configsByNameLike(sourceName)).filter((item) => !before.has(item.configId))
    if (added.length !== 1) {
      // 0 条 = 没复制成功；多条 = 同时有别人在复制，认不准。两种都不绑定，交给用户确认。
      return { ok: false as const, message: `复制后无法唯一定位新配置（匹配到 ${added.length} 条），请刷新确认` }
    }
    return { ok: true as const, configId: added[0].configId, name: added[0].name }
  },
  /**
   * 新增配置（config_api.md §十六 `POST /v1/config/add`）。**唯一的"从零建配置"通路**——
   * `updateConfig` 不带 configId 不会创建（0828 实测：返回 success 但无 CONF_ADD 流水）。
   *
   * 新 configId **只在 msg 里**（`"新增成功，id:1001"`），`data` 恒为 null，所以按文本解析；
   * 解析不出来就明确报错，不返回一条没有 ID 的"成功"，那会让调用方把节点绑到 undefined 上。
   */
  addConfig: async (payload: Record<string, unknown>): Promise<{ ok: boolean; configId?: string; message?: string }> => {
    const result = await request<unknown>('config/add', payload, {
      method: 'POST',
      httpEndpoint: 'config/add',
      httpParams: payload,
      // 必须是表单：后端 addConfig(ConfigWithBLOBs) 没有 @RequestBody，走 Spring 对象绑定。
      // 2026-09-02 实测发 JSON 的后果是**静默失败**——返回「新增成功，id:xxx」、配置也确实建了，
      // 但 configName / configUrl / configType / isMulti 全是 null。表单和 query 都能绑上，
      // 选表单是因为配置带 BLOB 字段（codeRule / contentRule 等），走 query 有请求行长度风险。
      paramsIn: 'form',
    })
    const ack = ackFromApiResult(result)
    if (!ack.ok) return { ok: false, message: ack.message }
    const configId = idFromApiResult(result, ['configId', 'id'])
      ?? ack.message?.match(/id\s*[:：]\s*(\d+)/)?.[1]
    if (!configId) {
      return { ok: false, message: `配置已新增，但未能从回执解析出配置 ID（后端回执：${ack.message ?? '无'}），请刷新配置列表确认` }
    }
    return { ok: true, configId, message: ack.message }
  },
  /** 复制配置：生成一条 `原名_copy`。画布「复制节点」走 copyConfigAndLocate，不要直接调这个。 */
  copyAll: (configId: string) => request<Ack>('config/copyAll', { configId }, { method: 'GET', httpParams: { id: configId } }),
  /** 删除配置（高危、永久）。旧配置列表批量删除；0828 口径：闲置配置由后端清理，前端不提供入口。 */
  deleteConfig: (configIds: string[] | string) => {
    const ids = Array.isArray(configIds) ? configIds : [configIds]
    return request<Ack>('config/delete', { configIds: ids }, { method: 'GET', httpParams: { ids } })
  },
  /**
   * 发配置（旧配置列表 / 源列表「发配置」）。把选定配置下发成采集任务，采集端才会按这份配置跑。
   * 不是保存配置（那是 updateConfig），也不是立刻抓网页（那是 source/sendSnatchWithParam），
   * 更不是 0828 D31 的规则发布 `rule/publish`。
   */
  sendConfigTask: (configIds: string[] | string) => {
    const ids = Array.isArray(configIds) ? configIds : [configIds]
    return request<Ack>('config/sendConfigTask', { configIds: ids }, { method: 'GET', httpParams: { ids } })
  },
  /** 批量改配置的主题（MQ 队列名）。旧配置列表「更改主题」；新平台队列改完走整份 updateConfig。 */
  updateTopic: (configIds: string[] | string, topic: string) => {
    const ids = Array.isArray(configIds) ? configIds : [configIds]
    return request<Ack>('config/updateTopic', { configIds: ids, topic }, { method: 'GET', httpParams: { ids, topic } })
  },
  /** 改运行策略（重试/超时/并行数等，落在 runPolicy.snatch）。画布侧目前只读，没有调用方。 */
  updateConfigPolicy: (configId: string, policy: Record<string, unknown>) =>
    request<Ack>('config/updateConfigPolicy', { configId, policy }, {
      method: 'POST',
      paramsIn: 'query',
      httpParams: { configId, runPolicy: { snatch: policy } },
    }),
  // 2026-09-08 删除 clearConfig 封装：2026-08-11 长期约定（AGENTS.md 弹窗约定）下，前端不提供
  // 清缓存入口；列表靠刷新重查。config/clear 端点本身保留在契约清单（danger=true）作写保护。
  // paramApi.clearParams 仍保留：被 ParamTab.test.ts 5 个回归测试 + 1 个 HTTP 契约测试钉死
  // "不再调 config/clear"，是有意的回归保护。
  /**
   * 启停配置。旧列表 enable 口径：`0` = 启用、`1` = 停用（isDelete）。
   * 0828：前端不提供入口。
   */
  changeEnable: (configIds: string[], enabled: boolean) =>
    request<Ack>('config/changeEnable', { configIds, enabled }, {
      method: 'GET',
      httpParams: { ids: configIds, enable: enabled ? 0 : 1 },
    }),
  /**
   * 抓取类型字典（旧 `api/source-type.js` 的 allSourceTypes）。
   *
   * 2026-08-28 确认：**节点类型就是抓取类型**，落在配置的 `configType` 上（旧「配置编辑」弹窗那一项，
   * 旧 `column.config.js:661` dataIndex=configType，type=SOURCE_TYPE）。
   * 它是**后端字典**，不是前端枚举——`SNATCH_TYPES` / `TEMPLATE_TO_SNATCH` 目前作为
   * 静态兜底/测试对照，节点库展示与新建节点已优先使用本接口返回的字典；
   * `[BROWSER]`/`[WECHAT]`/`[LOGIN]` 仅为前端入口/显示标识，禁止作为后端
   * configType/sourceType 写入；模板映射必须取数字字典值（0824-11 §1.2d）。
   */
  sourceTypes: async (): Promise<SourceTypeDict[]> => {
    const result = await request<{ list?: unknown[] } | unknown[]>('config/sourceTypes', {}, { method: 'GET' })
    const rows = Array.isArray(result) ? result : (result?.list ?? [])
    return rows.map((row) => {
      const r = row as Record<string, unknown>
      return { sourceType: String(r.sourceType ?? ''), typeName: String(r.typeName ?? '') }
    }).filter((item) => item.sourceType)
  },
  /**
   * 节点类型维护（0924-04，系统设置 → 节点类型）。旧平台 `api/source-type.js`，2026-09-24 生产逐个实测：
   * - list **不分页**，`typeName` 模糊匹配；读接口成功时 `code` 是 null（client 只把非空非 '0' 的 code 当失败，正好兼容）；
   * - add / update 走 **JSON body**；add 可不传 sourceType（后端取 max+1），返回 data = 新类型 ID；
   * - update 是**增量更新**：只传改动字段，其余不动——所以调用方只发变更字段，别把表单空值整份发过去；
   * - delete：GET `sourceType/delete?sourceType=`。2026-10-14 在 186 实测：类型被配置引用时后端拒绝
   *   （success:false，msg「该源类型已被配置引用，无法删除」），**软删除的配置也算引用**；没被引用才删得掉。
   */
  nodeTypeGroups: async (): Promise<string[]> => {
    const result = await request<unknown>('sourceType/typeGroups', undefined, { method: 'GET' })
    if (!Array.isArray(result) || result.some((value) => typeof value !== 'string' || !value.trim())) {
      throw new Error('分组类型配置格式错误')
    }
    return [...new Set((result as string[]).map((value) => value.trim()))]
  },
  nodeTypeList: async (typeName?: string, typeGroup?: string): Promise<NodeType[]> => {
    const result = await request<unknown>('sourceType/list', { typeName, typeGroup }, {
      method: 'GET',
      httpParams: { typeName: typeName?.trim() || undefined, typeGroup: typeGroup?.trim() || undefined },
    })
    const rows = Array.isArray(result) ? result : ((result as { list?: unknown[] } | null)?.list ?? [])
    return rows.map(nodeTypeFromLegacy).filter((t) => t.sourceType)
  },
  nodeTypeDetail: async (sourceType: string): Promise<NodeType | null> => {
    const result = await request<unknown>('sourceType/detail', { sourceType }, {
      method: 'GET',
      httpParams: { sourceType },
    })
    return result ? nodeTypeFromLegacy(result) : null
  },
  nodeTypeAdd: async (input: NodeTypeInput): Promise<Ack> => {
    const body = nodeTypeBody(input)
    return request<Ack>('sourceType/add', body, { method: 'POST', httpParams: body })
  },
  /** 删除节点类型（旧 deleteSourceType：GET，被配置 / 有效源引用时后端拒绝并回 msg） */
  nodeTypeDelete: async (sourceType: string): Promise<Ack> =>
    request<Ack>('sourceType/delete', { sourceType }, { method: 'GET', httpParams: { sourceType } }),
  /** `patch` 只放改动的字段；sourceType 是主键，必带 */
  nodeTypeUpdate: async (sourceType: string, patch: NodeTypeInput): Promise<Ack> => {
    const body = { ...nodeTypeBody(patch), sourceType: Number(sourceType) }
    return request<Ack>('sourceType/update', body, { method: 'POST', httpParams: body })
  },
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
      dsKind: p.dsKind || undefined,
      // 1013：只看收藏 ids 过滤（后端 entryTypePagedView 的 cond 参数，逗号分隔，见设计文档 §一）
      cond: p.cond,
      // 1022：排序（白名单 entryTypeId/typeName/tableName/keyField/state/updateDt，order=asc|desc）；不传 = 表 ID 倒序
      field: p.field,
      order: p.order,
    }
    const result = await request<Paged<unknown>>('config/entryTypePagedView', p, { method: 'GET', httpParams })
    return entryTypePageFromLegacy(result)
  },
  /**
   * 表下拉的搜索（2026-09-23，规则节点与其他节点表配置共用）：名称关键字之外支持按表 ID 找。
   *
   * 后端 `name` 只匹配名称，传数字 ID 命中 0 条；按 ID 要走 `entryTypeId`（精确）——实测
   * name=2101720 → 0、entryTypeId=2101720 → 1（TB_YOUTUBE）。所以输入是纯数字时两路一起查、
   * 合并去重，ID 精确命中的排最前；名字里恰好带这串数字的表也不会丢。
   */
  searchTables: async (keyword: string, size = 20): Promise<EntryType[]> => {
    const kw = keyword.trim()
    const byName = entryApi.entryPaged({ name: kw || undefined, size }).then((r) => r.list)
    if (!/^\d+$/.test(kw)) return byName
    const [idHits, nameHits] = await Promise.all([
      entryApi.entryPaged({ entryTypeId: kw, size: 5 }).then((r) => r.list).catch(() => [] as EntryType[]),
      byName,
    ])
    const seen = new Set<string>()
    return [...idHits, ...nameHits].filter((t) => (seen.has(t.tableId) ? false : (seen.add(t.tableId), true)))
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
    return request<Ack & { exists?: string[]; rebuilds?: string[] }>('config/rebuildTable', { tableIds: ids }, { method: 'GET', httpParams: { ids } })
  },
  rebuildIndex: (tableId: string) =>
    request<Ack>('config/rebuildIndex', { tableId }, { method: 'GET', httpParams: { entryTypeId: tableId } }),
  deleteEntries: (tableIds: string[]) =>
    request<Ack>('config/deleteEntryType', { tableIds }, { method: 'GET', httpParams: { ids: tableIds } }),
  /** 清实体表缓存。前端已下线：列表靠刷新重查，不再调用。 */
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
  /**
   * 单独改数据源标识（DS_KIND），1026 快速同步到 CK 建完任务后回写用。
   * 刻意不走 entrySave：那条路径是整对象更新，后端会按传入 items 做字段 diff，
   * 而调用方手里可能只有列表行（列表不返回 items），回写等于把字段配置清空。
   */
  setEntryDsKind: (tableId: string, dsKind: 'MYSQL' | 'CK') =>
    request<Ack>('config/entry-type-ds-kind', { tableId, dsKind }, {
      method: 'POST',
      paramsIn: 'query',
      httpParams: { entryTypeId: tableId, dsKind },
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
      paramType: p.kind && p.kind !== 'all' ? paramKindToLegacy(p.kind as ParamKind) : undefined,
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
  /** 清参数缓存（与配置清缓存同一端点）。前端已下线：列表靠刷新重查，不再调用。 */
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
  flowRecommend: (prompt: string, intent?: string) =>
    request<FlowRecommendation>('flow/recommend', { prompt, intent }),
  // 节点级 AI 对话（0701 问题八）：mock 关键词回复，二期换真 LLM BFF，签名不变
  nodeAiChat: (params: { nodeId: string; question: string; nodeTitle: string; outputTable?: string; disabled?: boolean }) =>
    request<{ reply: string }>('flow/nodeAiChat', params),
}

/**
 * 流程中心正式 API 门面。2026-09-02 起接真实 `cs_flow`（/v1/flow/*），不再走 flow-template mock。
 * 业务代码只依赖 FlowRecord/FlowSaveInput。「流程模板」是流程上的一个标记（0903 H24，字段待后端
 * 答复 H7 后补），不是另一类对象，也不另起一套端点——读写都走 flowPaged / flowDetail / saveFlow。
 *
 * 三件事先记在这儿，免得后面按旧印象改坏：
 * 1. **没有版本**。0818 B4 要的版本化后端没做，`detail` 也就没有 version 入参了（原来那个参数
 *    只有 mock 认，真实后端不认）。见 FlowRecord.version 的注释。
 * 2. **列表不含 flowConf**。flowPaged / flowList 都不返回大字段，所以列表里每条的 definition
 *    是空流程；要画布结构必须单独 `detail(id)`。
 * 3. **绑定即生效**（2026-09-03 后端答复订正）。执行时**按 `FLOW_ID` 反查后执行**——后端原话
 *    「执行就按 flowID 去反选，去执行」。所以 changeFlowBatch 把 cs_source.FLOW_ID 置上之后，
 *    这批源就会按该流程的那套配置跑，**不需要**再把 flowConf 下发成 config、也不需要顺带写
 *    CONFIG_ID。配套口径见 0903 H01：一个流程一套配置，可以关联很多源，这些源**共用**它。
 *
 *    ⚠️ 这一条此前写的是「绑定不驱动执行……执行器不读它。绑了流程 ≠ 源会按这个流程跑」，
 *    那是 mock 时代的推断，**已被后端答复推翻**。不要按旧注释的前提改代码——尤其别再去实现
 *    "把流程实例化到每个源"那套：配置本来就挂在流程上，不需要为每个源复制一份。
 */
/**
 * 「这条流程不存在」——`flow/flowDetail` 对悬空 flowId 的回法（见 flowCenterApi.detail）。
 * code 单看不够：`-1` 是旧平台的通用失败码，权限、参数错也是它，所以还要认那句文案。
 */
function isFlowNotFound(e: unknown): boolean {
  const cause = (e as { cause?: { payload?: Record<string, unknown> } } | undefined)?.cause
  const code = String(cause?.payload?.code ?? '')
  const message = String((e as Error | undefined)?.message ?? '')
  return code === '-1' && message.includes('未找到相关流程')
}

/** source-group/sourceFlows 返回的原始行 → 前端口径（ID 一律字符串，isDefault 1/0 → 布尔） */
function sourceFlowsViewFromApi(value: unknown): SourceFlowsView {
  const view = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const text = (v: unknown) => (v == null || v === '' ? undefined : String(v))
  const bindRows = (list: unknown) => (Array.isArray(list) ? list : []).map((item): SourceFlowBind => {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    return {
      id: String(row.id ?? ''),
      sourceId: text(row.sourceId),
      sourceGroupId: text(row.sourceGroupId),
      flowId: String(row.flowId ?? ''),
      isDefault: row.isDefault === true || row.isDefault === 1 || row.isDefault === '1',
      state: row.state === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
      revision: Number(row.revision) || 0,
      updatedAt: text(row.updateDt ?? row.updatedAt),
    }
  })
  const sourceGroupId = text(view.sourceGroupId)
  const flowIds = (Array.isArray(view.flowIds) ? view.flowIds : []).map(String)
  const defaultFlowId = text(view.defaultFlowId)
  const bindings = bindRows(view.bindings)
  // 2026-10-15 起后端多返回 own*（源自有流程）。未入组时 own* 与顶层三项相同；
  // 旧后端没有 own*：未入组回落到顶层，入组视为没有自有流程。
  const hasOwn = 'ownFlowIds' in view || 'ownBindings' in view
  return {
    sourceId: text(view.sourceId),
    sourceGroupId,
    flowIds,
    defaultFlowId,
    bindings,
    ownFlowIds: hasOwn ? (Array.isArray(view.ownFlowIds) ? view.ownFlowIds : []).map(String) : (sourceGroupId ? [] : flowIds),
    ownDefaultFlowId: hasOwn ? text(view.ownDefaultFlowId) : (sourceGroupId ? undefined : defaultFlowId),
    ownBindings: hasOwn ? bindRows(view.ownBindings) : (sourceGroupId ? [] : bindings),
  }
}

/** source-group/* 返回的成员行 → 前端口径（ID 一律字符串） */
function sourceGroupMemberFromApi(value: unknown): { sourceId: string; sourceName: string; [key: string]: unknown } {
  const row = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    ...row,
    sourceId: String(row.sourceId ?? ''),
    sourceName: row.sourceName == null ? '' : String(row.sourceName),
  }
}

/** source-group/list 或 detail 的原始行 → SourceGroup（ID 转字符串，flowIds 归一为字符串数组） */
function sourceGroupFromApi(value: unknown): SourceGroup {
  const row = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const text = (v: unknown) => (v == null || v === '' ? undefined : String(v))
  return {
    sourceGroupId: String(row.sourceGroupId ?? row.id ?? ''),
    sourceGroupCode: row.sourceGroupCode == null ? '' : String(row.sourceGroupCode),
    sourceGroupName: row.sourceGroupName == null ? '' : String(row.sourceGroupName),
    description: text(row.description),
    state: row.state === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
    authGroupId: row.authGroupId == null ? undefined : Number(row.authGroupId),
    defaultFlowId: text(row.defaultFlowId),
    flowIds: (Array.isArray(row.flowIds) ? row.flowIds : []).map(String),
    revision: Number(row.revision) || 0,
    updatedAt: text(row.updateDt ?? row.updatedAt),
  }
}

/**
 * 来源组（source-group/*，bee-config SourceGroupController，2026-10-08 上线 217）。
 * 1008-02 API 层：来源组本身的增删改查、成员管理、组绑定流程。与 leo 的本地「我的分组」
 * （stores/sourceGroups.ts，个人目录）是两个概念。
 *
 * 适配约定（1008-02）：所有 ID 转字符串；isDefault 转布尔；错误直接展示后端 msg 不再包一层；
 * 任何写操作完成后（包括失败）重新拉 list / sourceFlows 刷新 revision（调用方做，这里只管发请求）。
 */
export const sourceGroupApi = {
  /** 来源组列表（不分页） */
  list: async (): Promise<SourceGroup[]> => {
    const result = await request<unknown>('source-group/list', {}, {
      method: 'GET', httpEndpoint: 'source-group/list',
    })
    const rows = Array.isArray(result) ? result : []
    return rows.map(sourceGroupFromApi)
  },
  detail: async (sourceGroupId: string): Promise<SourceGroup | null> => {
    const result = await request<unknown>('source-group/detail', { sourceGroupId }, {
      method: 'GET', httpEndpoint: 'source-group/detail', httpParams: { sourceGroupId },
    })
    // 空载荷：normalizeHttpPayload 对 data:null 会包成 { ok: true, message }，没有来源组字段 → 视为不存在
    if (result == null) return null
    if (typeof result === 'object' && !('sourceGroupId' in result) && !('id' in result)) return null
    return sourceGroupFromApi(result)
  },
  /** 组成员分页：没有 total，请求 limit+1 条判断是否有下一页（同旧平台） */
  members: async (sourceGroupId: string, offset: number, limit: number): Promise<{ rows: ReturnType<typeof sourceGroupMemberFromApi>[]; hasMore: boolean }> => {
    const result = await request<unknown>('source-group/members', { sourceGroupId }, {
      method: 'GET', httpEndpoint: 'source-group/members', httpParams: { sourceGroupId, offset, limit: limit + 1 },
    })
    const rows = (Array.isArray(result) ? result : []).map(sourceGroupMemberFromApi)
    const hasMore = rows.length > limit
    return { rows: hasMore ? rows.slice(0, limit) : rows, hasMore }
  },
  /** 新建来源组（admin） */
  add: async (input: { sourceGroupCode: string; sourceGroupName: string; description?: string }): Promise<Ack> => {
    const result = await request<unknown>('source-group/add', input, {
      method: 'POST', httpEndpoint: 'source-group/add', httpParams: input,
    })
    return ackFromApiResult(result)
  },
  /** 修改来源组（admin；必须带编辑前 revision） */
  update: async (input: { sourceGroupId: string; sourceGroupCode?: string; sourceGroupName?: string; description?: string; state?: SourceGroupState; revision: number }): Promise<Ack> => {
    const result = await request<unknown>('source-group/update', input, {
      method: 'POST', httpEndpoint: 'source-group/update', httpParams: input,
    })
    return ackFromApiResult(result)
  },
  /** 删除来源组（admin；必须带编辑前 revision） */
  remove: async (input: { sourceGroupId: string; revision: number }): Promise<Ack> => {
    const result = await request<unknown>('source-group/delete', input, {
      method: 'POST', httpEndpoint: 'source-group/delete', httpParams: input,
    })
    return ackFromApiResult(result)
  },
  /**
   * 按源 ID 列表调整组成员（旧平台 SourceGroupModal.membership 同口径）。
   * body 字段名是后端的 `sourceGroupId` / `expectedSourceGroupId`（不是抽象层的 target/expected）：
   * `sourceGroupId` 为目标组，null = 退组；`expectedSourceGroupId` 为当前归属组（并发校验）。
   * 两者为 null 时 JSON 里**必须显式写 null**（退组语义，不能丢字段）。
   */
  changeMembers: async (input: { sourceIds: string[]; sourceGroupId: string | null; expectedSourceGroupId: string | null }): Promise<Ack> => {
    const body = {
      sourceIds: input.sourceIds.map((id) => Number(id)),
      sourceGroupId: input.sourceGroupId,
      expectedSourceGroupId: input.expectedSourceGroupId,
    }
    const result = await request<unknown>('source-group/changeMembers', body, {
      method: 'POST', httpEndpoint: 'source-group/changeMembers', httpParams: body,
    })
    return ackFromApiResult(result)
  },
  /**
   * 按筛选范围批量调整组成员：参数全放 query；targetSourceGroupId=-1 表示退组；无范围条件必须 confirmAll=true。
   * `filter` 是列表页的筛选条件（与 `sourcePaged` 同一份），这里按 sourcePaged 同口径转成后端参数，
   * 只带非空的范围字段（旧平台 source-group.js 约定），不带分页 / 排序。
   */
  changeMembersByRange: async (input: { targetSourceGroupId: string; confirmAll?: boolean; filter: PageQuery }): Promise<MembershipRangeResult | Ack> => {
    // appendQuery 会跳过 undefined / null / ''，但空数组会变成 `key=`，这里先去掉
    const cond = Object.fromEntries(Object.entries({ ...sourceCondParams(input.filter), tags: input.filter.tags })
      .filter(([, value]) => !(Array.isArray(value) && !value.filter(Boolean).length)))
    const httpParams = {
      ...cond,
      targetSourceGroupId: input.targetSourceGroupId,
      ...(input.confirmAll ? { confirmAll: true } : {}),
    }
    const result = await request<unknown>('source-group/changeMembersByRange', httpParams, {
      method: 'POST', httpEndpoint: 'source-group/changeMembersByRange', paramsIn: 'query', httpParams,
    })
    if (result == null) return ackFromApiResult(result)
    const row = result as Record<string, unknown>
    return {
      total: Number(row.total) || 0,
      joined: Number(row.joined) || 0,
      moved: Number(row.moved) || 0,
      left: Number(row.left) || 0,
      unchanged: Number(row.unchanged) || 0,
    }
  },
  /** 来源组整体绑定流程（admin；带 revision 并发快照；flowIds 为完整列表，空列表 + null 清空） */
  bindFlows: async (input: { sourceGroupId: string; revision: number; flowIds: string[]; defaultFlowId: string | null }): Promise<Ack> => {
    const body = {
      sourceGroupId: input.sourceGroupId,
      revision: input.revision,
      flowIds: input.flowIds.map((id) => Number(id)),
      defaultFlowId: input.defaultFlowId == null ? null : Number(input.defaultFlowId),
    }
    const result = await request<unknown>('source-group/bindFlows', body, {
      method: 'POST', httpEndpoint: 'source-group/bindFlows', httpParams: body,
    })
    return ackFromApiResult(result)
  },
  /** 来源（或来源组）的流程绑定行，含停用行；sourceId 有值时后端优先按单源处理 */
  bindings: async (input: { sourceId?: string; sourceGroupId?: string }): Promise<SourceFlowBind[]> => {
    const result = await request<unknown>('source-group/bindings', input, {
      method: 'GET', httpEndpoint: 'source-group/bindings', httpParams: input,
    })
    const rows = Array.isArray(result) ? result : []
    return rows.map((item): SourceFlowBind => {
      const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
      const text = (v: unknown) => (v == null || v === '' ? undefined : String(v))
      return {
        id: String(row.id ?? ''),
        sourceId: text(row.sourceId),
        sourceGroupId: text(row.sourceGroupId),
        flowId: String(row.flowId ?? ''),
        isDefault: row.isDefault === true || row.isDefault === 1 || row.isDefault === '1',
        state: row.state === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
        revision: Number(row.revision) || 0,
        updatedAt: text(row.updateDt ?? row.updatedAt),
      }
    })
  },
  /** 启用 / 停用一条流程绑定（admin）；回传 id/sourceId/sourceGroupId/flowId/revision */
  updateBindingState: async (row: SourceFlowBind, state: SourceGroupState): Promise<Ack> => {
    const body = {
      id: Number(row.id),
      sourceId: row.sourceId == null ? null : Number(row.sourceId),
      sourceGroupId: row.sourceGroupId == null ? null : Number(row.sourceGroupId),
      flowId: Number(row.flowId),
      revision: row.revision,
      state,
    }
    const result = await request<unknown>('source-group/updateBindingState', body, {
      method: 'POST', httpEndpoint: 'source-group/updateBindingState', httpParams: body,
    })
    return ackFromApiResult(result)
  },
  /** 来源列表当前生效流程并集（GET sourceIds 逗号串；上限 5000，超过分片） */
  sourceFlowIds: async (sourceIds: string[]): Promise<string[]> => {
    const ids = sourceIds.filter((id) => /^\d+$/.test(id))
    const chunks: string[][] = []
    for (let i = 0; i < ids.length; i += 5000) chunks.push(ids.slice(i, i + 5000))
    const results: string[] = []
    for (const chunk of chunks) {
      if (!chunk.length) continue
      const result = await request<unknown>('source-group/flowIds', {}, {
        method: 'GET', httpEndpoint: 'source-group/flowIds', httpParams: { sourceIds: chunk.join(',') },
      })
      if (Array.isArray(result)) results.push(...result.map(String))
    }
    return results
  },
}

/**
 * 源的多流程绑定（画布流程标签栏 / 流程列表用）。底层是来源组接口文档里的 `source-group/*`
 * （bee-config SourceGroupController，2026-10-08 上线 217）：一个源可关联多条流程，有一条默认流程；
 * 入组的源只走来源组的流程（只读，改要去来源组；1021-02），运行入口是组默认；独立源维护自己的流程，运行入口是本源默认。
 *
 * 保存只有一个端点 `bindSourceFlows`——**整体替换**绑定列表并指定默认，带并发快照。所以每次写都先读一遍
 * 最新绑定（sourceFlows），在它的基础上增 / 改 / 删，再连同读到的快照一起提交；别人刚改过会被后端拒绝
 * （「来源流程关联已变化，请重新查询」），界面把后端原因直接展示。
 *
 * 没有版本 / 草稿 / 发布：后端还在评估（JSON 快照方案），行上 `versionManaged` 恒为 false，界面据此不显示版本相关入口。
 */
export const workflowBindingApi = {
  /** 流程版本（草稿 / 发布）接口是否可用。后端没有，恒为 false；流程中心据此不走版本流程。 */
  available: (): boolean => false,
  /** 读来源的流程绑定原始视图：生效列表、默认流程、是否入组、并发快照 */
  view: async (sourceId: string): Promise<SourceFlowsView> => {
    const result = await request<unknown>('source-group/sourceFlows', { sourceId }, {
      method: 'GET', httpEndpoint: 'source-group/sourceFlows', httpParams: { sourceId },
    })
    return sourceFlowsViewFromApi(result)
  },
  /** `withNames: false` 不逐条取流程详情（名字退回「流程 #ID」）：画布加载只用 ID，别让慢的 flowDetail 挡住整页 */
  list: async (sourceId: string, options: { withNames?: boolean } = {}): Promise<WorkflowBinding[]> =>
    (await workflowBindingApi.load(sourceId, options)).rows,
  /**
   * 绑定行 + 源所在的来源组。来源组还没绑流程时 rows 是空的，标签栏仍要知道源在组里（不给「＋」）。
   * 入组的源只列来源组的流程，运行入口是组默认（1021-02：组内源只走组流程；186 实测后端也只认组绑定，
   * 入组前留下的自有绑定不生效、也改不了，这里不列）。
   */
  load: async (sourceId: string, options: { withNames?: boolean } = {}): Promise<{ rows: WorkflowBinding[]; sourceGroupId: string | null }> => {
    // 本地演示源里保留了字母 ID；Spring 接口收 Long，发过去只会得到 400。
    if (!/^\d+$/.test(sourceId)) return { rows: [], sourceGroupId: null }
    const view = await workflowBindingApi.view(sourceId)
    const groupId = view.sourceGroupId
    const groupActive = groupId ? view.bindings.filter((binding) => binding.state === 'ACTIVE') : []
    const ownActive = groupId ? [] : view.ownBindings.filter((binding) => binding.state === 'ACTIVE')
    const byDefault = (a: SourceFlowBind, b: SourceFlowBind) => Number(b.isDefault) - Number(a.isDefault)
    const groupDefaultId = groupActive.find((binding) => binding.isDefault)?.flowId
    const mainFlowId = groupId ? groupDefaultId : ownActive.find((binding) => binding.isDefault)?.flowId
    const ownIds = new Set(ownActive.map((binding) => binding.flowId))
    const groupIds = new Set(groupActive.map((binding) => binding.flowId))
    const ordered = [...(groupId ? groupActive : ownActive)].sort(byDefault)
    // 流程名 / 是否禁用：绑定行里没有，逐条取详情（一个源关联的流程不多）；取不到就显示 ID、按启用处理
    const names = new Map<string, string>()
    const disabledFlows = new Set<string>()
    if (options.withNames !== false) await Promise.all(ordered.map(async (binding) => {
      const flow = await flowCenterApi.detail(binding.flowId).catch(() => null)
      if (flow?.name) names.set(binding.flowId, flow.name)
      if (flow?.disabled) disabledFlows.add(binding.flowId)
    }))
    const rows = ordered.map((binding, index): WorkflowBinding => {
      const inherited = groupIds.has(binding.flowId)
      const primary = binding.flowId === mainFlowId
      return {
        id: binding.id,
        bindType: inherited ? 'SOURCE_GROUP' : 'SOURCE',
        bindId: inherited ? String(groupId) : sourceId,
        workflowId: binding.flowId,
        workflowCode: `FLOW-${binding.flowId}`,
        workflowName: names.get(binding.flowId) ?? `流程 #${binding.flowId}`,
        publishedFlowId: binding.flowId,
        versionStatus: 'PUBLISHED',
        // 流程禁用（flow/changeFlowEnable，cs_flow.IS_DELETE=1）：禁用后手动抓取 / 指定流程运行 / 定时都不跑（10-22 后端）
        workflowStatus: disabledFlows.has(binding.flowId) ? 'DISABLED' : 'ACTIVE',
        versionManaged: false,
        followsCurrentVersion: true,
        role: primary ? 'MAIN' : 'AUX',
        primary,
        priority: index,
        status: 'ACTIVE',
        inherited,
        own: ownIds.has(binding.flowId),
        groupDefault: inherited && binding.flowId === groupDefaultId,
        updatedAt: binding.updatedAt,
      }
    })
    return { rows, sourceGroupId: groupId ?? null }
  },
  /**
   * 整体保存源自有的流程：读最新快照 → 交给 change 算出新的 { flowIds, defaultFlowId } → 连快照一起提交。
   * 只动 own* 那一套，来源组的流程不经这里改。入组的源后端一律拒绝（10-21 186 实测），界面上组内源不给入口。
   */
  save: async (
    sourceId: string,
    change: (view: SourceFlowsView) => { flowIds: string[]; defaultFlowId: string | null },
  ): Promise<void> => {
    const view = await workflowBindingApi.view(sourceId)
    const next = change(view)
    const body = {
      sourceId,
      expectedFlowIds: view.ownFlowIds,
      // 停用后也要提交读到的原值；没有默认就是 null
      expectedDefaultFlowId: view.ownDefaultFlowId ?? null,
      flowIds: next.flowIds,
      defaultFlowId: next.defaultFlowId,
    }
    await request<unknown>('source-group/bindSourceFlows', body, {
      method: 'POST', httpEndpoint: 'source-group/bindSourceFlows', httpParams: body,
    })
  },
  /** 关联一条已有流程；源上还没有默认流程、或明确要求 primary 时，把它设为默认 */
  bind: async (input: { sourceId: string; workflowId: string; primary?: boolean }) =>
    workflowBindingApi.save(input.sourceId, (view) => ({
      flowIds: view.ownFlowIds.includes(input.workflowId) ? view.ownFlowIds : [...view.ownFlowIds, input.workflowId],
      defaultFlowId: input.primary || !view.ownDefaultFlowId ? input.workflowId : view.ownDefaultFlowId,
    })),
  setPrimary: async (sourceId: string, workflowId: string) =>
    workflowBindingApi.save(sourceId, (view) => {
      if (!view.ownFlowIds.includes(workflowId)) throw new Error('这条流程当前没有关联到本源，请刷新后重试')
      return { flowIds: view.ownFlowIds, defaultFlowId: workflowId }
    }),
  /** `nextPrimaryId`：解绑的是默认流程时，同一次提交把默认换到这条（10-21 画布右键「解绑流程」） */
  unbind: async (sourceId: string, workflowId: string, nextPrimaryId?: string) =>
    workflowBindingApi.save(sourceId, (view) => {
      const rest = view.ownFlowIds.filter((id) => id !== workflowId)
      if (nextPrimaryId && rest.includes(nextPrimaryId)) return { flowIds: rest, defaultFlowId: nextPrimaryId }
      // 默认标记只能切换，不能直接删：还有别的流程时，要先把默认切走（与后端对「取消默认关联」的口径一致）
      if (view.ownDefaultFlowId === workflowId && rest.length) throw new Error('这是默认流程，请先把其他流程设为默认，再解除这一条')
      return { flowIds: rest, defaultFlowId: rest.length ? (view.ownDefaultFlowId ?? null) : null }
    }),
  /** 新建一条空白流程并关联到源：两步（先建流程、再关联），第二步失败时说明流程已建出来，别留下谁也不知道的孤儿 */
  createForSource: async (input: { sourceId: string; name: string; definition: FlowDefinition; primary?: boolean }): Promise<WorkflowBinding> => {
    const created = await flowCenterApi.save({ name: input.name, definition: input.definition })
    try {
      await workflowBindingApi.bind({ sourceId: input.sourceId, workflowId: created.id, primary: input.primary })
    } catch (error) {
      throw new Error(`已新建流程 #${created.id}，但关联到本源失败：${(error as Error)?.message ?? String(error)}。可在流程中心找到它手动关联`, { cause: error })
    }
    const rows = await workflowBindingApi.list(input.sourceId)
    const hit = rows.find((row) => row.workflowId === created.id)
    if (!hit) throw new Error(`已新建流程 #${created.id} 并关联，但刷新绑定列表时没找到它，请刷新页面`)
    return hit
  },
  /** 版本（草稿 / 发布）接口后端还没有；只为保持流程中心抽屉的调用形状，`available()` 为 false 时不会走到这里 */
  ensureDraft: async (_workflowId: string): Promise<WorkflowBinding> => {
    throw new Error('流程版本（草稿 / 发布）接口尚未上线')
  },
  publish: async (_workflowId: string): Promise<WorkflowBinding> => {
    throw new Error('流程版本（草稿 / 发布）接口尚未上线')
  },
}

export const flowCenterApi = {
  /**
   * 分页 + 检索 + 排序，全部在服务端。
   * `field` 走后端白名单（flowId/flowName/flowCode/flowType/siteId/categoryId/groupId/
   * updateDt/createDt/sourceCnt/templateFlag/refFlowId——0925 REVIEW 按 bee-top
   * FlowController.FLOW_ORDER_FIELD_MAP 补齐后两项），传白名单外的值后端会报参数错误。
   * **注意没有「节点数」**：那要解析 flowConf，而列表接口根本不返回这个字段。
   */
  paged: async (cond: {
    page?: number
    size?: number
    keywords?: string
    field?: 'updateDt' | 'createDt' | 'flowName' | 'sourceCnt' | 'flowId'
    order?: 'asc' | 'desc'
    /** 只看模板 / 只看普通流程；不传 = 全部。**服务端过滤**（2026-09-04 实测：传 1 得 0 条、
     *  传 0 得 738 条）。不要改成本地筛——分页之后本地只能筛当前这一页，见 FlowCenter 的注释。 */
    onlyTemplate?: boolean
    /** 按目录分类过滤（`cs_flow.category_id`）。同样是服务端筛。 */
    categoryId?: string
    /** 按标签过滤。
     *  ⚠️ **请求参数名是 `tags`，不是 `flowTags`**（2026-09-05 实测：出参字段叫 `flowTags`，
     *  但入参用 `flowTags` 会被**静默忽略**——乱填一个标签仍返回全部 740 条；
     *  换成 `tags` 才真的筛，给测试流程打上标签后传 `tags` 得 1 条）。
     *  出入参不同名这种坑，写代码时按出参名猜必然踩。 */
    tag?: string
    /** 按流程 ID 精确查（对齐旧平台 FlowList：单个传 `flowId`，多个逗号拼成 `ids`）。 */
    flowIds?: string[]
  } = {}) => {
    const ids = cond.flowIds ?? []
    const result = await request<unknown>('flow/flowPaged', cond, {
      method: 'POST',
      httpEndpoint: 'flow/flowPaged',
      httpParams: {
        page: cond.page ?? 1,
        limit: cond.size ?? 20,
        keywords: cond.keywords || undefined,
        field: cond.field ?? 'updateDt',
        order: cond.order ?? 'desc',
        templateFlag: cond.onlyTemplate === undefined ? undefined : (cond.onlyTemplate ? 1 : 0),
        categoryId: cond.categoryId || undefined,
        tags: cond.tag || undefined,
        flowId: ids.length === 1 ? Number(ids[0]) : undefined,
        ids: ids.length > 1 ? ids.join(',') : undefined,
      },
    })
    return flowPageFromLegacy(result)
  },
  /**
   * 模板下拉候选（0903 H24）。等价于 `paged({ onlyTemplate: true })` 但不分页，
   * 后端专门给了这条。**模板是流程的一个属性，不是另一类对象**——不要据此再造一个"模板中心"。
   */
  templates: async (): Promise<FlowRecord[]> => {
    const result = await request<unknown>('flow/flowTemplateList', {}, {
      method: 'GET',
      httpEndpoint: 'flow/flowTemplateList',
    })
    return flowPageFromLegacy(result).list
  },
  /**
   * 复制整个流程（含 `cs_item_config` 步骤，后端重映射上下游）。
   * 源是模板时，新流程为普通流程且 `refFlowId` 自动回指模板；不复制根节点——目标流程
   * 自己已有一条 `isRoot=1`，子步骤的 `lastStep='0'` 会自然落到它身上（2026-09-04 已核）。
   * 新 ID 与 saveFlow 同款：回执 data 为 null，从 msg 里解析。
   */
  copy: async (flowId: string, flowName?: string): Promise<string> => {
    if (!flowId) throw new Error('请先选择要复制的流程')
    const payload: Record<string, unknown> = { flowId }
    if (flowName?.trim()) payload.flowName = flowName.trim()
    // ⚠️ `paramsIn: 'query'`：后端这两条复制端点是 `@RequestParam`，POST 但参数走 query string，
    // 不是 JSON body（2026-09-05 实测：发 body 报 "Required request parameter 'flowId' ...
    // is not present"）。跟 item/next/saveItemConfig 同一种写法。
    const result = await request<unknown>('flow/copyFlow', payload, {
      method: 'POST',
      httpEndpoint: 'flow/copyFlow',
      httpParams: payload,
      paramsIn: 'query',
    })
    const ack = ackFromApiResult(result)
    if (!ack.ok) throw new Error(ack.message || '复制流程失败')
    // 0927 P2-1：主正则锚定「新流程ID:」；拿不到时退化到 `\bid`（单词边界）兜底兼容
    // 无前缀小写 "id:939" 的老回执——原 `/id.../i` 无锚定，message 里更早出现的
    // "id:123" 字样（如其它字段回显）会抢先命中绑错 ID。
    const id = idFromApiResult(result, ['flowId', 'id'])
      || ack.message?.match(/新流程\s*id\s*[:：]\s*(\d+)/i)?.[1]
      || ack.message?.match(/\bid\s*[:：]\s*(\d+)/i)?.[1]
    if (!id) throw new Error(`流程已复制，但未能解析新流程 ID（后端回执：${ack.message ?? '无'}），请刷新列表确认`)
    return id
  },
  /**
   * 把模板下的普通步骤复制到一个**已存在**的目标流程（新建源选模板走这条）。
   * 后端自动改 `FLOW_ID`、重映射步骤上下游、根节点依赖保持 `0`、不复制模板自身的根节点；
   * 目标是普通流程时自动把 `refFlowId` 指向模板。
   * 回执是「复制成功，共复制 N 个步骤」或明确错误（模板不存在 / 不是模板 / 目标不存在 / 复制到自身）。
   */
  copyTemplateSteps: async (templateFlowId: string, targetFlowId: string): Promise<Ack> => {
    if (!templateFlowId || !targetFlowId) return { ok: false, message: '请先选择模板与目标流程' }
    if (templateFlowId === targetFlowId) return { ok: false, message: '不能把模板复制到它自己' }
    const payload = { templateFlowId, targetFlowId }
    const result = await request<unknown>('flow/copyTemplateSteps', payload, {
      method: 'POST',
      httpEndpoint: 'flow/copyTemplateSteps',
      httpParams: payload,
      paramsIn: 'query',  // 同 copyFlow：@RequestParam，参数走 query
    })
    return ackFromApiResult(result)
  },
  /** 批量删除流程（逻辑删除：is_delete=-1 + state=D）。高危，调用方必须已做二次确认。 */
  remove: async (flowIds: string[]): Promise<Ack> => {
    if (!flowIds.length) return { ok: false, message: '请先选择要删除的流程' }
    const result = await request<unknown>('flow/deleteFlow', { ids: flowIds }, {
      method: 'GET',
      httpEndpoint: 'flow/deleteFlow',
      httpParams: { ids: flowIds.join(',') },
    })
    return ackFromApiResult(result)
  },
  /**
   * 批量启停流程（F6，2026-09-29 接入）。enable：0 = 启用，1 = 禁用。
   * 后端 changeEnable 只置 cs_flow.IS_DELETE（0/1），并排除 state=D 的流程；
   * 与 cs_source 的 is_delete 同形——禁用 ≠ 删除，流程仍在列表/有效集合里。
   * 旧平台的 flowList/updateFlowConf/changeFlowEnable 三条端点当初没有调用方，
   * 注册从 endpoints.ts 删过一轮；本方法是按 flowPaged/saveFlow 的样子加回来的。
   */
  changeFlowEnable: async (flowIds: string[], enable: 0 | 1): Promise<Ack> => {
    if (!flowIds.length) return { ok: false, message: '请选择流程' }
    const result = await request<unknown>('flow/changeFlowEnable', { ids: flowIds, enable }, {
      method: 'GET',
      httpEndpoint: 'flow/changeFlowEnable',
      httpParams: { ids: flowIds.join(','), enable },
    })
    return ackFromApiResult(result)
  },
  /**
   * 下拉/选择器用：走旧平台同款 `flow/flowList`（有效流程全量、不分页、不含 flowConf，旧 FlowIdSelect 等下拉都用它）。
   * 不再拿 `flowPaged` 拼：flowPaged 带 sourceCnt 计算列，186 上 500 条要 ~30s、超过前端 20s 超时，
   * 调用方 catch 成空数组后下拉就只剩「无数据」（源流程配置抽屉实测）；flowList 759 条 ~0.1s，也没有 500 条上限。
   * 要完整分页 / 排序 / 检索请改用 paged。
   */
  list: async (): Promise<FlowRecord[]> => {
    const result = await request<unknown>('flow/flowList', {}, {
      method: 'GET',
      httpEndpoint: 'flow/flowList',
    })
    return flowPageFromLegacy(result).list
  },
  /**
   * 流程详情。**查不到返回 `null`，不抛错**——调用方（画布头的「所属流程」）要靠这个
   * 区分"这个流程被删了"和"请求没打通"。
   *
   * ⚠️ 后端把"不存在"也报成业务失败（2026-09-21 生产实测 `flowId=999999999`）：
   * `HTTP 200` + `{success:false, code:'-1', msg:'未找到相关流程 flowId=999999999', data:null}`。
   * 走到 `normalizeHttpPayload` 就是一个 throw，`data:null` 那条路根本到不了。
   * 所以这里**只把这一种业务失败翻译回 `null`**，其余照抛——不能一概吞掉，
   * 否则权限、参数错也会被说成"流程已删除"。
   *
   * 判据依赖后端那句文案，不够硬。后端哪天给个稳定的 code（或干脆 data:null + success:true），
   * 这段可以整个删掉。
   */
  detail: async (id: string): Promise<FlowRecord | null> => {
    if (!id) return null
    let result: unknown
    try {
      result = await request<unknown>('flow/flowDetail', { flowId: id }, {
        method: 'GET',
        httpEndpoint: 'flow/flowDetail',
        httpParams: { flowId: id },
      })
    } catch (e) {
      if (isFlowNotFound(e)) return null
      throw e
    }
    return result ? flowFromLegacy(result) : null
  },
  /**
   * 新增（不带 id）/ 修改（带 id）。响应 `data` 是 null，新 ID 只在 msg 里——
   * 文案是「保存成功，id:1001」（旧平台 saveFlow 同款），所以新增后按 msg 取 ID 再回查详情。
   * 取不到就直接报错，不返回一条 id 为空的假记录让调用方往列表里塞。
   */
  save: async (flow: FlowSaveInput): Promise<FlowRecord> => {
    const name = flow.name.trim()
    if (!name) throw new Error('流程名称不能为空')
    const payload = flowToLegacy({ ...flow, name })
    const result = await request<unknown>('flow/saveFlow', payload, {
      method: 'POST',
      httpEndpoint: 'flow/saveFlow',
      httpParams: payload,
    })
    const ack = ackFromApiResult(result)
    if (!ack.ok) throw new Error(ack.message || '保存流程失败')
    const id = idFromApiResult(result, ['flowId', 'id'])
      || flow.id
      || ack.message?.match(/id\s*[:：]\s*(\d+)/)?.[1]
    if (!id) throw new Error(`流程「${name}」已保存，但未能解析流程 ID（后端回执：${ack.message ?? '无'}），请刷新列表确认`)
    const saved = await flowCenterApi.detail(id)
    if (saved) {
      // F8（0929）：saveFlow 的 update 分支不校验 state，并发/多端下可对已删除流程"静默成功"。
      // 保存后回查详情发现 state=D（paged 永远过滤，只有这里会碰到）→ 明确报错而不是假装成功。
      if (saved.state === 'D') {
        throw new Error(`流程「${name}」已被删除（可能被其它端删掉了），本次保存未生效，请刷新列表`)
      }
      return saved
    }
    return { id, name, definition: flow.definition, updatedAt: '' }
  },
  /**
   * 把一批源绑到流程；`flowId` 传空表示解绑（后端约定 0 / 负数 / 不传 = 解绑）。
   * sourceIds 走 **body**，不是 query——旧平台的 changeFlow（query 版）在批量上千时会撞
   * Nginx/Tomcat 请求行上限触发 414/400，已被后端标废弃。单次上限 5000 条。
   * `currentFlowId`（1008-02）：多流程场景按关联替换 / 解绑时，指定从哪条流程上移走这批源
   * （不传 = 沿用旧的单流程口径，改 cs_source.FLOW_ID）。
   */
  bindSources: async (sourceIds: string[], flowId?: string, currentFlowId?: string): Promise<Ack> => {
    if (!sourceIds.length) return { ok: false, message: '请先选择要关联的源' }
    if (sourceIds.length > 5000) return { ok: false, message: `单次最多关联 5000 个源，当前 ${sourceIds.length} 个` }
    const result = await request<unknown>('flow/changeFlowBatch', { sourceIds, flowId, currentFlowId }, {
      method: 'POST',
      httpEndpoint: 'flow/changeFlowBatch',
      httpParams: {
        sourceIds: sourceIds.map(Number),
        flowId: flowId ? Number(flowId) : 0,
        ...(currentFlowId ? { currentFlowId: Number(currentFlowId) } : {}),
      },
    })
    return ackFromApiResult(result)
  },
  /**
   * 流程的步骤拓扑（svg+flowId 视图的说明见下方注释块——svg=true 已返回真实根行 isRoot=1，
   * 不再需要 configDetail(flowId) 拼起点；configDetail 那条是 09-02 的旧结论，0927 起
   * FlowDetailDrawer 的 deriveFromFlowConfig 已是**工作区默认展示路径**（有步骤行就按步骤
   * 还原），它只在步骤响应里没有 isRoot 根行时才回退查 configDetail 合成起点）。
   * 子步骤记录自带 sourceId=-1（不挂在具体某个源上），stepFromLegacy 的 sourceId 兜底参数
   * 用不上，传空串即可。
   */
  /**
   * 流程的步骤拓扑。**必须带 `svg=true` 且只传 flowId、绝不能带 sourceId**（0925 REVIEW 核对
   * bee-top SourceNextController.nextConfigPaged：svg 下按 `sourceId != null` 二选一，带
   * sourceId 会**静默**改走源视角查询 `_queryBySourceId`——没有根锚、lastStep 不改写，前端会
   * 把挂根步骤误判成孤儿）。svg 模式后端按 FLOW_ID 全量返回（含真实根行 `isRoot=1`、
   * 过滤 IS_ROOT=0 之外的删除行），本流程自己的全部步骤 + 根；子步骤 lastStep 的哨兵 `'0'`
   * 会改写成根节点真实 ID（`toViewLastStep`），拓扑天然连得上。
   * 对比：不带 svg 的查询（老参数分支）行数更多——那是 MAIN_CONFIG/SOURCE_ID 过滤口径的旧视图，
   * 不是「多了孤儿」，孤儿判定在 buildSourceSeed 按 lastStep 语义做（0925）。
   */
  steps: async (flowId: string, options: { withConfigDetails?: boolean; backendScope?: RequestOptions['backendScope']; versionId?: string | null } = {}): Promise<Step[]> => {
    // 2026-10-10 流程版本：传 versionId 读该版本的步骤（画布编辑草稿时）；草稿里步骤 itemConfig 与发布版相同，
    // 返回结构同 svg 视图（根行 isRoot=1、子步骤 lastStep 已改写成根 ID）。不传 = 原来的流程步骤（运行中的发布版）。
    const result = options.versionId
      ? await request<unknown>('flow/version/nodes', { flowId, versionId: options.versionId }, {
        method: 'GET',
        httpEndpoint: 'flow/version/nodes',
        httpParams: { flowId, versionId: options.versionId },
        backendScope: options.backendScope ?? 'flow',
      })
      : await request<unknown>('item/next/nextConfigPaged', { flowId }, {
        method: 'GET',
        httpEndpoint: 'item/next/nextConfigPaged',
        httpParams: { flowId, page: 1, limit: 10000, svg: true },
        backendScope: options.backendScope ?? 'flow',
      })
    const steps = sourceStepsFromLegacy(result, '')
    // 只要表 ID 的调用方（siteUsedTables）跳过逐配置补查，与 sourceApi.sourceSteps 同一个开关
    return options.withConfigDetails === false ? steps : attachStepConfigDetails(steps, options.backendScope ?? 'flow')
  },
}

/**
 * 流程版本的写入引用（2026-10-10）：217 后端起全部流程进版本模式，v1 已发布只读；
 * 改步骤必须写在草稿里，增 / 改 / 删 / 启停都额外带 flowId + versionId + ver（217 旧平台
 * src/api/source-step.js editRefs 同款）。ver 是**版本行**的乐观锁计数：每写一次 +1，响应不回新值，
 * 要重读 overview；拿旧 ver 写会被拒「内容已变更，请重新加载」。不传 = 未启用版本的流程，照旧写。
 */
export interface FlowVersionRef { flowId: string; versionId: string; ver: number }

/** 调用写接口时的尾参：没有版本信息就不传，调用形状与版本对接前一致 */
export function versionArgs(ref: FlowVersionRef | null | undefined): [] | [FlowVersionRef] {
  return ref ? [ref] : []
}

function versionRefParams(ref?: FlowVersionRef | null): Record<string, unknown> {
  return ref ? { flowId: Number(ref.flowId), versionId: ref.versionId, ver: ref.ver } : {}
}

export interface FlowVersionRow {
  versionId: string
  flowVer: number
  ver: number
  /** W 草稿 / C 已发布（含历史发布） */
  state: string
  isLock: number
  /** 0 正常；-1 已放弃 / 归档 */
  isDelete: number
  baseId: string | null
  /** 2026-10-14 历史版本列表用（217 实测 overview 都有返回）：创建 / 发布 / 放弃或归档的时间和人 */
  createDt?: string | null
  createBy?: string | null
  publishDt?: string | null
  publishBy?: string | null
  deleteDt?: string | null
  deleteBy?: string | null
  /** 版本内容指纹：放弃的草稿与基线相同 = 草稿里什么都没改 */
  contentHash?: string | null
}

export interface FlowVersionOverview {
  enabled: boolean
  curVer: number | null
  nextVer: number | null
  publishId: string | null
  draftId: string | null
  versions: FlowVersionRow[]
}

/** 流程版本（2026-10-10，217 旧平台 FlowNodeDrawer 同一套接口）。 */
export const flowVersionApi = {
  overview: async (flowId: string): Promise<FlowVersionOverview> => {
    const raw = await request<Record<string, unknown> | null>('flow/version/overview', { flowId }, {
      method: 'GET',
      httpEndpoint: 'flow/version/overview',
      httpParams: { flowId },
    })
    const str = (v: unknown) => (v == null || v === '' ? null : String(v))
    const num = (v: unknown) => (v == null || v === '' ? null : Number(v))
    const rows = Array.isArray(raw?.versions) ? raw!.versions as Record<string, unknown>[] : []
    return {
      enabled: !!raw?.enabled,
      curVer: num(raw?.curVer),
      nextVer: num(raw?.nextVer),
      publishId: str(raw?.publishId),
      draftId: str(raw?.draftId),
      versions: rows.map((v) => ({
        versionId: String(v.versionId),
        flowVer: Number(v.flowVer),
        ver: Number(v.ver),
        state: String(v.state ?? ''),
        isLock: Number(v.isLock ?? 0),
        isDelete: Number(v.isDelete ?? 0),
        baseId: str(v.baseId),
        createDt: str(v.createDt),
        createBy: str(v.createBy),
        publishDt: str(v.publishDt),
        publishBy: str(v.publishBy),
        deleteDt: str(v.deleteDt),
        deleteBy: str(v.deleteBy),
        contentHash: str(v.contentHash),
      })),
    }
  },
  /** 动作：draft（从发布版建草稿，回 versionId）/ publish / abandon。body 同旧平台 versionAction。 */
  action: async (action: 'draft' | 'publish' | 'abandon', body: { flowId: string; versionId: string; ver: number; expectedPublishId: string | null }) => {
    const raw = await request<Record<string, unknown> | Ack>(`flow/version/${action}`, body, {
      method: 'POST',
      httpEndpoint: `flow/version/${action}`,
      httpParams: { ...body, flowId: Number(body.flowId) },
    })
    const versionId = raw && typeof raw === 'object' && 'versionId' in raw ? String((raw as Record<string, unknown>).versionId) : null
    return { versionId }
  },
}

// 子步骤（流程画布连线 = item/next）。未实现专属 mock，由 client fallback 回执。
export const itemApi = {
  /** 新建步骤。旧平台真实调用是 `axios({method:'post', params})`——POST 但走 query string，
   *  不是 JSON body，所以这里显式 `paramsIn: 'query'`。响应 data 为 null，不回新 itemConfig，
   *  调用方要再查 nextConfigPaged 用差集定位。新建默认停用，随后 enable(id, '0')。 */
  saveItemConfig: (step: Step, ref?: FlowVersionRef | null) => invalidateSiteUsedTables(request<Ack>('item/next/saveItemConfig', { ...stepToSaveItemConfigPayload(step), ...versionRefParams(ref) }, {
    method: 'POST',
    httpEndpoint: 'item/next/saveItemConfig',
    paramsIn: 'query',
  })),
  /** 修改步骤。旧平台真实调用是 `axios({method:'post', data})`，JSON body。字段契约
   *  2026-08-26 用测试源 430016398（itemConfig 40600）原样提交实测确认。
   *  必须带齐快照字段（url / itemId / lastStep / mainConfig），只改 name/cond 也会整包提交。 */
  stepModify: (step: Step, ref?: FlowVersionRef | null) => invalidateSiteUsedTables(request<Ack>('item/next/stepModify', { ...stepToStepModifyPayload(step), ...versionRefParams(ref) }, {
    method: 'POST',
    httpEndpoint: 'item/next/stepModify',
  })),
  /** 流程入口（ROOT）配置更新（0927 G1）。ROOT 是 isRoot=1 的真实根行，后端
   *  `validateRootUpdate` 只接受 configId（>0）与流程生命周期字段：sourceId/lastStep/
   *  entryTypeId/cond 传非空一律拒绝、mainConfig 不能改、enabled:false 反算出的 isDelete:1
   *  也会被拒（根节点不能单独删除）——所以**不能走普通 stepModify 整包**，只交最小集
   *  `{ itemConfig, flowId, isRoot: 1, configId }`，其余字段保持库中值（updateByPrimaryKeySelective 不更新 null）。
   *  2026-09-29 对齐 118 上线版旧平台「步骤列表1」的 handleSaveRoot：请求体原样带 `flowId` 与
   *  `isRoot: 1`（此前只交 itemConfig + configId，后端按 isRoot 走 ROOT 更新分支时可能认不出）。
   *  flowId 拿不到有效值（空 / '0' / 非数字）时不带该键，交后端按库中值处理。
   *  0929：可选 `outEntry`（入口行输出表，数字表 ID 串）——不在 validateRootUpdate 拒绝清单里，
   *  有非空值才携带；空/缺失时省略，selective update 保持库中值（不能拿 null 去"清空"输出表）。 */
  rootConfigUpdate: (stepId: string, configId: string, flowId?: string, outEntry?: string | null, ref?: FlowVersionRef | null) => invalidateSiteUsedTables(request<Ack>('item/next/stepModify', {
    itemConfig: Number(stepId),
    ...(flowId && /^\d+$/.test(flowId) && flowId !== '0' ? { flowId: Number(flowId) } : {}),
    isRoot: 1,
    configId: Number(configId),
    ...(outEntry != null && String(outEntry).trim() !== '' ? { outEntry: Number(outEntry) } : {}),
    ...versionRefParams(ref),
  }, {
    method: 'POST',
    httpEndpoint: 'item/next/stepModify',
  })),
  /** 启停步骤。GET `id` + `state`。state：`'0'` 启用 / `'1'` 停用，与 isDelete 同口径。
   *  后端操作日志文案可能写反，以 isDelete / enabled 为准。 */
  enable: (stepId: string, state: string, ref?: FlowVersionRef | null) => request<Ack>('item/next/enable', { id: stepId, state }, {
    method: 'GET',
    httpEndpoint: 'item/next/enable',
    httpParams: { id: stepId, state, ...versionRefParams(ref) },
  }),
  /** 删除步骤。GET `id` = itemConfig。虚拟起点 0 和本地草稿 id 不要调。 */
  deleteStep: (stepId: string, ref?: FlowVersionRef | null) => invalidateSiteUsedTables(request<Ack>('item/next/delete', { id: stepId }, {
    method: 'GET',
    httpEndpoint: 'item/next/delete',
    httpParams: { id: stepId, ...versionRefParams(ref) },
  })),
}

export interface CategoryCreateParams {
  categoryName: string
  parentId?: string | number
  level?: number
  isDelete?: number
  seq?: number
  remark?: string
}

export interface CategoryUpdateParams {
  categoryId: string | number
  categoryName?: string
  parentId?: string | number
  seq?: number
  remark?: string
}

/** 分类目录管理 API（对应老平台 CategoryTree.vue） */
export const categoryApi = {
  add: async (params: CategoryCreateParams): Promise<unknown> => {
    clearCategoryCache()
    return request('category/add', params as unknown as Record<string, unknown>, {
      method: 'POST',
      paramsIn: 'query',
      httpEndpoint: 'category/add',
      httpParams: {
        categoryName: params.categoryName,
        parentId: params.parentId ?? 0,
        level: params.level ?? (params.parentId && String(params.parentId) !== '0' ? undefined : 1),
        isDelete: params.isDelete ?? 0,
        ...(params.seq !== undefined ? { seq: params.seq } : {}),
        ...(params.remark ? { remark: params.remark } : {}),
      },
    })
  },

  update: async (params: CategoryUpdateParams): Promise<unknown> => {
    clearCategoryCache()
    return request('category/update', params as unknown as Record<string, unknown>, {
      method: 'POST',
      paramsIn: 'query',
      httpEndpoint: 'category/update',
      httpParams: {
        categoryId: params.categoryId,
        ...(params.categoryName ? { categoryName: params.categoryName } : {}),
        // ⚠️ 老平台 CategoryTree.vue:359 updateCallback 明确 delete obj.parentId；
        // 根分类或普通属性更新千万不能带 parentId=0，否则后端找不存在的分类 ID 0 会报 500 服务器异常。
        ...(params.parentId !== undefined && params.parentId !== '' && params.parentId !== 0 && params.parentId !== '0'
          ? { parentId: params.parentId }
          : {}),
        ...(params.seq !== undefined ? { seq: params.seq } : {}),
        ...(params.remark !== undefined ? { remark: params.remark } : {}),
      },
    })
  },

  delete: async (id: string | number): Promise<unknown> => {
    clearCategoryCache()
    return request('category/delete', { id }, {
      method: 'POST',
      paramsIn: 'query',
      httpEndpoint: 'category/delete',
      httpParams: { id },
    })
  },

  addBatch: async (parentId: string | number, txt: string): Promise<unknown> => {
    clearCategoryCache()
    return request('category/addBatch', { parentId, txt }, {
      method: 'POST',
      paramsIn: 'query',
      httpEndpoint: 'category/addBatch',
      httpParams: { parentId, txt },
    })
  },
}


/**
 * 用户收藏（后端 2026-09-23，`favorite-api.md`；B30）。
 *
 * userId 由后端从会话取，前端不传——所以换浏览器 / 换电脑同一账号看到的是同一份。
 * itemType 必须大写（后端正则 `[A-Z_]{1,32}`，小写判非法）；itemId 必须是正整数。
 */
export type FavoriteItemType = 'SITE' | 'SOURCE' | 'CONFIG' | 'FLOW' | 'ENTRY_TYPE'

/** list 单页上限（后端校验 1~500） */
const FAVORITE_PAGE_LIMIT = 500

export const favoriteApi = {
  /**
   * 当前用户某类收藏的**全部** ID（最新收藏在前）。按 500 一页翻完——网站列表要「收藏置顶 +
   * 只看收藏」，需要完整集合，不能只查当前页（所以不用 states）。
   */
  listIds: async (itemType: FavoriteItemType): Promise<string[]> => {
    const ids: string[] = []
    for (let page = 1; ; page++) {
      const result = await request<{ list?: unknown[]; total?: number }>('favorite/list', { itemType, page }, {
        method: 'GET',
        httpParams: { itemType, page, limit: FAVORITE_PAGE_LIMIT },
      })
      const rows = result?.list ?? []
      for (const row of rows) {
        const id = (row as { itemId?: unknown })?.itemId
        if (id != null && id !== '') ids.push(String(id))
      }
      // 翻到不足一页，或者已经够总数，就停；页数再加个硬上限防异常接口死循环
      if (rows.length < FAVORITE_PAGE_LIMIT || ids.length >= Number(result?.total ?? 0) || page >= 20) break
    }
    return ids
  },
  /** 收藏（幂等：重复收藏不报错、不更新收藏时间） */
  add: (itemType: FavoriteItemType, itemId: string) =>
    request<Ack>('favorite/add', { itemType, itemId }, {
      method: 'POST',
      httpParams: { itemType, itemId: Number(itemId) },
    }),
  /** 取消收藏（幂等：未收藏也返回成功） */
  remove: (itemType: FavoriteItemType, itemId: string) =>
    request<Ack>('favorite/remove', { itemType, itemId }, {
      method: 'POST',
      httpParams: { itemType, itemId: Number(itemId) },
    }),
}
