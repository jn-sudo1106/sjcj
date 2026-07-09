import { request } from './client'
import type {
  Paged, Source, Site, SourceCategory, Step, Ack, PageQuery,
  Rule, RuleGroup, SharedConfig, RuleTestCase, EvalResult,
  RuleOrchestration, RuleOrchestrationGenerateResult, RuleOrchestrationItem, RuleOrchestrationSaveResult, RuleOrchestrationTestResult,
  Dataset, Measure, DataTableMeta, DataRow, RowQuery, RunRow, RunNode, NodeRunStat, QueueStat, HealthCard, MqQueue, SyncRow, AlarmRow,
  Config, EntryType, Param, CredentialRef, SourceLog, TaskInst, WorkbenchSummary,
  OverviewSummary, TrendPoint,
} from './types'
import type { FlowDef, FlowRecommendation } from '../views/FlowCanvas/flowModel'

export * from './types'
export { isDanger, DANGER_ENDPOINTS } from './client'

// 类型化接口：每个方法一一对应一个真实 /v1 端点。后续按 142 个端点逐域补全。
export const sourceApi = {
  sourcePaged: (p?: PageQuery) => request<Paged<Source>>('source/sourcePaged', p),
  sourceDetail: (sourceId: string) => request<Source>('source/sourceDetail', { sourceId }),
  sourceCategories: () => request<SourceCategory[]>('source/categoryTree'),
  sourceStats: () => request<{ total: number; error: number; externalChanged: number; disabled: number }>('source/stats'),
  sourceSteps: (sourceId: string) => request<Step[]>('item/next/nextConfigPaged', { sourceId }),

  // 写类 / 高危端点：首期 mock 仅回执，UI 统一二次确认占位（呼应权威方案读写边界）。
  changeSourceEnable: (sourceId: string, disabled: boolean) =>
    request<Ack>('source/changeSourceEnable', { sourceId, disabled }),
  // 改为成功状态（0707 Review #1 修复：端点已登记但此前未封装，SourceTab 曾误用 changeSourceEnable）。
  // 注：endpoints.ts:54 只登记 path 无参数契约，按单源封装；批量场景由调用方循环（见 SourceTab.onOperate）。
  changeToSuccess: (sourceId: string) => request<Ack>('source/changeToSuccess', { sourceId }),
  copySource: (sourceId: string) => request<Ack>('source/copySource', { sourceId }),
  sendSnatch: (sourceIds: string[]) => request<Ack>('source/sendSnatch', { sourceIds }),
  deleteSource: (sourceIds: string[]) => request<Ack>('source/deleteSource', { sourceIds }),
  sourceLogs: (sourceId: string) => request<SourceLog[]>('source/logPaged', { sourceId }),
  sourceTasks: (sourceId: string) => request<TaskInst[]>('task/topTaskPaged', { sourceId }),
  credentialRef: (refId: string) => request<CredentialRef | null>('source/credentialDetail', { refId }),
  // 批量导入（0707 Review #3 修复：deep/dir 此前被前端丢弃，现透传）。
  batchImport: (template: string, lines: string, opts?: { deep?: boolean; dir?: string }) =>
    request<Ack>('source/batchImport', { template, lines, deep: opts?.deep ?? false, dir: opts?.dir ?? '' }),
  batchModifyConfig: (sourceIds: string[], configId: string) => request<Ack>('source/batchModifyConfig', { sourceIds, configId }),
  batchSchedule: (sourceIds: string[]) => request<Ack>('source/createJobs', { sourceIds }),
  changeFreqTag: (sourceIds: string[], freqTag: string) => request<Ack>('source/changeFreqTag', { sourceIds, freqTag }),
  markVerified: (sourceIds: string[], verified: string) => request<Ack>('source/markVerified', { sourceIds, verified }),
  generateConfig: (sourceId: string) => request<Ack>('source/generateConfig', { sourceId }),

  // 新建采集源两段式闸门（0706 优化·Phase3）
  sourceCreate: (source: Source) => request<{ ok: boolean; message?: string; sourceId?: string }>('source/createSource', { source }),
  sourceCopy: (fromId: string) => request<Source | null>('source/sourceCopy', { sourceId: fromId }),
  // 源信息编辑抽屉 + 任务视图（0706 优化·Phase4）
  sourceUpdate: (source: Source) => request<Ack>('source/updateSource', { source }),
  sourceNodeRuns: (sourceId: string) => request<NodeRunStat[]>('source/nodeRunStats', { sourceId }),
}

// 网站—子源父子模型（0707 优化·Phase2）：网站=统一流程模板+批量工具（不运行），子源=运行实体
export const siteApi = {
  sitePaged: (p?: PageQuery) => request<Paged<Site>>('site/sitePaged', p),
  siteDetail: (siteId: string) => request<Site | null>('site/siteDetail', { siteId }),
  siteCreate: (site: Omit<Site, 'sourceCount' | 'errorCount'>, sources: Source[]) =>
    request<{ ok: boolean; message?: string; siteId?: string }>('site/createSite', { site, sources }),
  siteSources: (siteId: string) => request<Source[]>('site/sourcesOfSite', { siteId }),
  sourceAdd: (siteId: string, source: Source) =>
    request<{ ok: boolean; message?: string; sourceId?: string }>('site/addSource', { siteId, source }),
  sourceRemove: (siteId: string, sourceId: string) => request<Ack>('site/removeSource', { siteId, sourceId }),
  // 危险端点：整条流程覆盖所选子源，UI 走二次确认 + 多选列表
  siteSyncFlow: (siteId: string, sourceIds: string[]) => request<Ack>('site/syncFlow', { siteId, sourceIds }),
  // 任务视图网站化（0707 优化·Phase5）：队列汇总 + 展开明细，sourceId 可选收窄到单个子源
  siteQueueStats: (siteId: string, sourceId?: string) => request<QueueStat[]>('site/queueStats', { siteId, sourceId }),
  queueTaskPaged: (q: { siteId: string; queue: string; sourceId?: string; state?: string; page?: number; size?: number }) =>
    request<Paged<TaskInst>>('site/queueTaskPaged', q),
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
  tables: () => request<DataTableMeta[]>('data/tablePaged'),
  rows: (tableId: string) => request<DataRow[]>('data/rowPaged', { tableId }),
  // 结果视图：按表 + 多条件 + 分页（独立端点，避免影响 /data 全局数据页）
  rowQueryPaged: (q: RowQuery) => request<Paged<DataRow>>('data/rowQueryPaged', q),
  tableMeta: (tableId: string) => request<DataTableMeta | null>('data/tableMeta', { tableId }),
  dataStats: () => request<{ tables: number; rows: number; chars: number; review: number }>('data/stats'),
  // 结果视图行编辑（Phase 4.4）
  rowUpdate: (tableId: string, dataId: string, values: Record<string, unknown>) =>
    request<{ message?: string; row?: DataRow }>('data/rowUpdate', { tableId, dataId, values }),
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
  configPaged: (p?: PageQuery) => request<Paged<Config>>('config/configPaged', p),
  configDetail: (configId: string) => request<Config>('config/configDetail', { configId }),
  updateConfig: (configId: string) => request<Ack>('config/updateConfig', { configId }),
  copyAll: (configId: string) => request<Ack>('config/copyAll', { configId }),
  deleteConfig: (configId: string) => request<Ack>('config/delete', { configId }),
  sendConfigTask: (configId: string) => request<Ack>('config/sendConfigTask', { configId }),
  updateTopic: (configId: string, topic: string) => request<Ack>('config/updateTopic', { configId, topic }),
  updateConfigPolicy: (configId: string, policy: string) => request<Ack>('config/updateConfigPolicy', { configId, policy }),
  clearConfig: (configId: string) => request<Ack>('config/clear', { configId }),
}

// 实体表（M5 采集资产）
export const entryApi = {
  entryPaged: (p?: PageQuery) => request<Paged<EntryType>>('config/entryTypePagedView', p),
  entryDetail: (tableId: string) => request<EntryType>('config/entryType', { tableId }),
  // 新建 / 编辑表（按 tableId upsert，无则新建并返回 tableId）
  entrySave: (entry: EntryType) => request<{ tableId: string; message?: string }>('config/saveEntryType', { entry }),
  rebuildTable: (tableId: string) => request<Ack>('config/rebuildTable', { tableId }),
  rebuildIndex: (tableId: string) => request<Ack>('config/rebuildIndex', { tableId }),
  modifyEntryType: (tableId: string) => request<Ack>('config/modifyEntryType', { tableId }),
}

// 参数列表（M5 采集资产）
export const paramApi = {
  paramPaged: (p?: PageQuery) => request<Paged<Param>>('config/paramPaged', p),
  paramDetail: (paramId: string) => request<Param>('config/paramDetail', { paramId }),
  genValues: (paramId: string) => request<string[]>('config/genValues', { paramId }),
  addParamValues: (paramId: string) => request<Ack>('config/addParamValues', { paramId }),
  updateParam: (paramId: string) => request<Ack>('config/updateParam', { paramId }),
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

// 子步骤（流程画布连线 = item/next）。未实现专属 mock，由 client fallback 回执。
export const itemApi = {
  saveItemConfig: (stepId: string) => request<Ack>('item/next/saveItemConfig', { stepId }),
  stepModify: (stepId: string) => request<Ack>('item/next/stepModify', { stepId }),
  enable: (stepId: string, enabled: boolean) => request<Ack>('item/next/enable', { stepId, enabled }),
  deleteStep: (stepId: string) => request<Ack>('item/next/delete', { stepId }),
}
