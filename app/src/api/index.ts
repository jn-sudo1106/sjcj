import { request } from './client'
import type {
  Paged, Source, SourceCategory, Step, Ack, PageQuery,
  Rule, RuleGroup, SharedConfig, RuleTestCase, EvalResult,
  Dataset, Measure, DataTableMeta, DataRow, RunRow, RunNode, HealthCard, MqQueue, SyncRow, AlarmRow,
  Config, EntryType, Param, CredentialRef, SourceLog, TaskInst, WorkbenchSummary,
} from './types'

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
  copySource: (sourceId: string) => request<Ack>('source/copySource', { sourceId }),
  sendSnatch: (sourceIds: string[]) => request<Ack>('source/sendSnatch', { sourceIds }),
  deleteSource: (sourceIds: string[]) => request<Ack>('source/deleteSource', { sourceIds }),
  sourceLogs: (sourceId: string) => request<SourceLog[]>('source/logPaged', { sourceId }),
  sourceTasks: (sourceId: string) => request<TaskInst[]>('task/topTaskPaged', { sourceId }),
  credentialRef: (refId: string) => request<CredentialRef | null>('source/credentialDetail', { refId }),
  batchImport: (template: string, lines: string) => request<Ack>('source/batchImport', { template, lines }),
  batchModifyConfig: (sourceIds: string[], configId: string) => request<Ack>('source/batchModifyConfig', { sourceIds, configId }),
  batchSchedule: (sourceIds: string[]) => request<Ack>('source/createJobs', { sourceIds }),
  changeFreqTag: (sourceIds: string[], freqTag: string) => request<Ack>('source/changeFreqTag', { sourceIds, freqTag }),
  markVerified: (sourceIds: string[], verified: string) => request<Ack>('source/markVerified', { sourceIds, verified }),
  generateConfig: (sourceId: string) => request<Ack>('source/generateConfig', { sourceId }),
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
  dataStats: () => request<{ tables: number; rows: number; chars: number; review: number }>('data/stats'),
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

// 子步骤（流程画布连线 = item/next）。未实现专属 mock，由 client fallback 回执。
export const itemApi = {
  saveItemConfig: (stepId: string) => request<Ack>('item/next/saveItemConfig', { stepId }),
  stepModify: (stepId: string) => request<Ack>('item/next/stepModify', { stepId }),
  enable: (stepId: string, enabled: boolean) => request<Ack>('item/next/enable', { stepId, enabled }),
  deleteStep: (stepId: string) => request<Ack>('item/next/delete', { stepId }),
}
