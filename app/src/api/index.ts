import { request } from './client'
import type {
  Paged, Source, Site, SourceCategory, Step, Ack, PageQuery,
  Rule, RuleGroup, SharedConfig, RuleTestCase, EvalResult,
  RuleOrchestration, RuleOrchestrationGenerateResult, RuleOrchestrationItem, RuleOrchestrationSaveResult, RuleOrchestrationTestResult,
  Dataset, Measure, DataTableMeta, DataRow, RowQuery, RunRow, RunNode, NodeRunStat, QueueStat, HealthCard, MqQueue, SyncRow, AlarmRow,
  Config, ConfigActionLog, ConfigParamBinding, EntryType, Param, ParamInput, CredentialRef, SourceLog, TaskInst, SourceTaskQuery, WorkbenchSummary,
  OverviewSummary, TrendPoint, RawFile, RawFileQuery, RawFileStats, SourceCloneRequest, SourceCloneResult,
  FlowTemplate, FlowTemplateSaveInput,
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
  entryTypeFromLegacy,
  entryTypePageFromLegacy,
  entryTypeToLegacy,
  paramFromLegacy,
  paramPageFromLegacy,
  paramToLegacy,
} from './legacyAdapters'
import { encryptLegacyPayload } from './legacyCrypto'

export * from './types'
export { isDanger, DANGER_ENDPOINTS } from './client'

// 网站/子源域尚未迁移真实后端，始终使用现有 Mock；参数等已迁移域仍由全局模式决定。
const assetMockRequest = <T>(endpoint: string, params?: Record<string, unknown>) =>
  request<T>(endpoint, params, { mode: 'mock' })

// 类型化接口：每个方法一一对应一个真实 /v1 端点。后续按 142 个端点逐域补全。
export const sourceApi = {
  sourcePaged: (p?: PageQuery) => assetMockRequest<Paged<Source>>('source/sourcePaged', p),
  sourceDetail: (sourceId: string) => assetMockRequest<Source | null>('source/sourceDetail', { sourceId }),
  sourceCategories: () => assetMockRequest<SourceCategory[]>('source/categoryTree'),
  sourceStats: () => assetMockRequest<{ total: number; error: number; externalChanged: number; disabled: number }>('source/stats'),
  sourceSteps: (sourceId: string) => assetMockRequest<Step[]>('item/next/nextConfigPaged', { sourceId }),

  // 写类 / 高危端点：首期 mock 仅回执，UI 统一二次确认占位（呼应权威方案读写边界）。
  changeSourceEnable: (sourceId: string, disabled: boolean) =>
    assetMockRequest<Ack>('source/changeSourceEnable', { sourceId, disabled }),
  // 改为成功状态（0707 Review #1 修复：端点已登记但此前未封装，SourceTab 曾误用 changeSourceEnable）。
  // 注：endpoints.ts:54 只登记 path 无参数契约，按单源封装；批量场景由调用方循环（见 SourceTab.onOperate）。
  changeToSuccess: (sourceId: string) => assetMockRequest<Ack>('source/changeToSuccess', { sourceId }),
  copySource: (sourceId: string) => assetMockRequest<Ack>('source/copySource', { sourceId }),
  sendSnatch: (sourceIds: string[]) => assetMockRequest<Ack>('source/sendSnatch', { sourceIds }),
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
}

// 网站—子源父子模型（0707 优化·Phase2）：网站=统一流程模板+批量工具（不运行），子源=运行实体
export const siteApi = {
  sitePaged: (p?: PageQuery) => assetMockRequest<Paged<Site>>('site/sitePaged', p),
  siteDetail: (siteId: string) => assetMockRequest<Site | null>('site/siteDetail', { siteId }),
  siteCreate: (site: Omit<Site, 'sourceCount' | 'errorCount'>, sources: Source[]) =>
    assetMockRequest<{ ok: boolean; message?: string; siteId?: string }>('site/createSite', { site, sources }),
  siteUpdate: (site: Pick<Site, 'siteId' | 'name' | 'category' | 'categoryPath' | 'owner'>) =>
    assetMockRequest<Ack>('site/updateSite', { site }),
  siteSources: (siteId: string) => assetMockRequest<Source[]>('site/sourcesOfSite', { siteId }),
  // 新增子源默认从空白流程开始；inherit=true 仅保留给旧数据迁移兼容场景。
  sourceAdd: (siteId: string, source: Source, inherit = false) =>
    assetMockRequest<{ ok: boolean; message?: string; sourceId?: string }>('site/addSource', { siteId, source, inherit }),
  cloneSource: (requestBody: SourceCloneRequest) =>
    assetMockRequest<SourceCloneResult>('site/cloneSource', requestBody as unknown as Record<string, unknown>),
  sourceRemove: (siteId: string, sourceId: string) => assetMockRequest<Ack>('site/removeSource', { siteId, sourceId }),
  // 按网站批量导入子源：一行一条「名称;URL」，导入后从空白流程开始。
  siteImportSources: (siteId: string, lines: string) =>
    assetMockRequest<{ ok: boolean; message?: string; added?: number; skipped?: number }>('site/importSources', { siteId, lines }),
  // 危险端点：把来源子源已保存的流程整条覆盖到同网站所选子源，UI 走多选列表 + 危险确认
  siteSyncFlow: (siteId: string, fromSourceId: string, sourceIds: string[]) =>
    assetMockRequest<Ack>('site/syncFlow', { siteId, fromSourceId, sourceIds }),
  // 任务视图网站化（0707 优化·Phase5）：队列汇总 + 展开明细，sourceId 可选收窄到单个子源
  siteQueueStats: (siteId: string, sourceId?: string) => assetMockRequest<QueueStat[]>('site/queueStats', { siteId, sourceId }),
  queueTaskPaged: (q: { siteId: string; queue: string; sourceId?: string; state?: string; page?: number; size?: number }) =>
    assetMockRequest<Paged<TaskInst>>('site/queueTaskPaged', q),
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
  orchestrationPaged: (p?: PageQuery) => request<Paged<RuleOrchestrationItem>>('rule/orchestrationPaged', p),
  orchestrationGenerate: (describe: string, systemPrompt?: string) =>
    request<RuleOrchestrationGenerateResult>('rule/orchestrationGenerate', { describe, systemPrompt }),
  orchestrationTest: (script: string, params: Record<string, unknown>) =>
    request<RuleOrchestrationTestResult>('rule/orchestrationTest', { script, params }),
  orchestrationSave: (ruleCfg: RuleOrchestration) =>
    request<RuleOrchestrationSaveResult>('rule/orchestrationSave', { ruleCfg }),

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

// 数据查看（M4）
export const dataApi = {
  tables: async () => {
    const result = await request<DataTableMeta[] | Paged<unknown>>('data/tablePaged', undefined, {
      method: 'GET',
      httpEndpoint: 'config/entryTypePagedView',
      httpParams: { page: 1, limit: 1000 },
    })
    return Array.isArray(result) ? result : result.list.map(dataTableFromLegacy)
  },
  rows: async (tableId: string) => (await dataApi.rowQueryPaged({ tableId, page: 1, size: 100 })).list,
  // 结果视图：按表 + 多条件 + 分页（独立端点，避免影响 /data 全局数据页）
  rowQueryPaged: async (q: RowQuery) => {
    const legacyQuery = {
      page: q.page ?? 1,
      limit: q.size ?? 20,
      entryType: q.tableId,
      sourceId: q.sourceId,
      entryId: q.dataId,
      parentId: q.parentId,
      state: q.state || 'ALL',
      nextFlag: q.nextFlag,
      // SQL 条件的旧后端字段名是 more（不是 sql）；发错会被后端静默忽略，筛选失效
      min: q.sql ? q.min || 0 : q.min,
      max: q.max,
      more: q.sql,
      sorted: q.sorted ?? 0,
    }
    const result = await request<Paged<unknown>>('data/rowQueryPaged', q, {
      method: 'POST',
      httpEndpoint: 'entry/entryDataPaged',
      httpParams: { data: encryptLegacyPayload(legacyQuery) },
    })
    return { total: result.total, list: result.list.map(dataRowFromLegacy) }
  },
  tableMeta: async (tableId: string) => {
    const result = await request<unknown>('data/tableMeta', { tableId }, {
      method: 'GET',
      httpEndpoint: 'config/entryType',
      httpParams: { typeId: tableId },
    })
    return result ? dataTableFromLegacy(result) : null
  },
  dataStats: async () => {
    const tables = await dataApi.tables()
    return { tables: tables.length, rows: tables.reduce((sum, table) => sum + table.rowCount, 0), chars: 0, review: 0 }
  },
  // 结果视图行编辑（Phase 4.4）
  rowUpdate: (tableId: string, dataId: string, values: Record<string, unknown>) =>
    request<{ message?: string; row?: DataRow }>('data/rowUpdate', { tableId, dataId, values }, {
      method: 'POST',
      httpEndpoint: 'entry/entryUpdate',
      httpParams: { ...values, entryTypeId: tableId, entryId: dataId },
    }),
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

// 原始文件（0711 R11：文件视图，仅子源态使用）
export const fileApi = {
  filePaged: (q: RawFileQuery) => request<Paged<RawFile>>('file/filePaged', q),
  fileStats: (q: Omit<RawFileQuery, 'page' | 'size'>) => request<RawFileStats>('file/fileStats', q),
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

// 流程模板（0714 会议 Task 5）：结构与子源动态绑定分开保存；version 用于固定已绑定子源。
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
