import {
  mockSourcePaged,
  mockSourceDetail,
  mockSourceCategories,
  mockSourceStats,
  mockSourceSteps,
  mockCredentialRef,
  mockSourceLogs,
  mockSourceTasks,
  mockAck,
  mockSourceCreate,
  mockSourceCopy,
  mockSourceUpdate,
  mockSourceNodeRuns,
  mockChangeSourceEnable,
  mockChangeToSuccess,
  mockBatchImport,
} from './sources'
import {
  mockRuleGroups,
  mockRulePaged,
  mockRuleStats,
  mockRuleGateSummary,
  mockSharedConfigs,
  mockRuleTestCases,
  mockEvaluate,
  mockRuleOrchestrationPaged,
  mockRuleOrchestrationGenerate,
  mockRuleOrchestrationTest,
  mockRuleOrchestrationSave,
} from './rules'
import { mockDatasets, mockMeasures, mockMetricStats } from './metrics'
import { mockDataTables, mockDataRows, mockDataStats, mockDataRowQueryPaged, mockDataTableMeta, mockDataRowUpdate } from './dataview'
import { mockRuns, mockRunNodes, mockRunStats } from './runs'
import { mockHealth, mockMq, mockSync, mockAlarms, mockMonitorStats } from './monitor'
import { mockWorkbenchSummary } from './workbench'
import { mockOverviewSummary, mockOverviewTrend } from './overview'
import { mockFlowSave, mockFlowLoad, mockFlowList, mockFlowRecommend, mockNodeAiChat } from './flows'
import {
  mockSitePaged,
  mockSiteDetail,
  mockSiteCreate,
  mockSiteSourcesOf,
  mockSiteSourceAdd,
  mockSiteImportSources,
  mockSiteSourceRemove,
  mockSiteSyncFlow,
  mockSiteQueueStats,
  mockQueueTaskPaged,
} from './sites'
import { mockConfigPaged, mockConfigDetail } from './configs'
import { mockEntryPaged, mockEntryDetail, mockSaveEntryType } from './entries'
import { mockParamPaged, mockParamDetail, mockParamCreate, mockParamUpdate, mockGenValues } from './params'
import { mockFilePaged, mockFileStats } from './files'

// mock 注册表：key = 真实 /v1 端点路径，value = 处理函数。
// 真接入时这张表整体被 http 请求取代，端点字符串不变。
export const mockRegistry: Record<string, (params?: Record<string, unknown>) => unknown> = {
  // 采集资产 · 源（M2）
  'source/sourcePaged': mockSourcePaged,
  'source/sourceDetail': mockSourceDetail,
  'source/categoryTree': mockSourceCategories,
  'source/stats': mockSourceStats,
  'item/next/nextConfigPaged': mockSourceSteps,
  'source/changeSourceEnable': mockChangeSourceEnable,
  'source/changeToSuccess': mockChangeToSuccess,
  'source/copySource': mockAck,
  'source/createSource': mockSourceCreate,
  'source/sourceCopy': mockSourceCopy,
  'source/updateSource': mockSourceUpdate,
  'source/nodeRunStats': mockSourceNodeRuns,
  'source/sendSnatch': mockAck,
  'source/deleteSource': mockAck,
  // 采集资产 · 源（M5 补充）
  'source/logPaged': mockSourceLogs,
  'task/topTaskPaged': mockSourceTasks,
  'source/credentialDetail': mockCredentialRef,
  'source/batchImport': mockBatchImport,
  'source/batchModifyConfig': mockAck,
  'source/createJobs': mockAck,
  'source/changeFreqTag': mockAck,
  'source/markVerified': mockAck,
  'source/generateConfig': mockAck,

  // 采集资产 · 配置（M5）
  'config/configPaged': mockConfigPaged,
  'config/configDetail': mockConfigDetail,
  'config/updateConfig': mockAck,
  'config/copyAll': mockAck,
  'config/delete': mockAck,
  'config/sendConfigTask': mockAck,
  'config/updateTopic': mockAck,
  'config/updateConfigPolicy': mockAck,
  'config/clear': mockAck,

  // 采集资产 · 实体表（M5）
  'config/entryTypePagedView': mockEntryPaged,
  'config/entryType': mockEntryDetail,
  'config/saveEntryType': mockSaveEntryType,
  'config/rebuildTable': mockAck,
  'config/rebuildIndex': mockAck,
  'config/modifyEntryType': mockAck,

  // 采集资产 · 参数（M5）
  'config/paramPaged': mockParamPaged,
  'config/paramDetail': mockParamDetail,
  'config/genValues': mockGenValues,
  'config/param-add': mockParamCreate,
  'config/addParamValues': mockAck,
  'config/updateParam': mockParamUpdate,

  // 原始文件（0711 R11）
  'file/filePaged': mockFilePaged,
  'file/fileStats': mockFileStats,

  // 规则资产（M3）
  'rule/groupTree': mockRuleGroups,
  'rule/rulePaged': mockRulePaged,
  'rule/stats': mockRuleStats,
  'rule/gateSummary': mockRuleGateSummary,
  'rule/sharedConfigPaged': mockSharedConfigs,
  'rule/testCasePaged': mockRuleTestCases,
  'rule/evaluate': mockEvaluate,
  'rule/orchestrationPaged': mockRuleOrchestrationPaged,
  'rule/orchestrationGenerate': mockRuleOrchestrationGenerate,
  'rule/orchestrationTest': mockRuleOrchestrationTest,
  'rule/orchestrationSave': mockRuleOrchestrationSave,
  'rule/publish': mockAck,
  'rule/runBatchTest': mockAck,

  // 指标中心（M4）
  'dataset/datasetPaged': mockDatasets,
  'measure/measurePaged': mockMeasures,
  'measure/stats': mockMetricStats,

  // 数据查看（M4）
  'data/tablePaged': mockDataTables,
  'data/rowPaged': mockDataRows,
  'data/stats': mockDataStats,
  'data/rowQueryPaged': mockDataRowQueryPaged,
  'data/tableMeta': mockDataTableMeta,
  'data/rowUpdate': mockDataRowUpdate,

  // 运行记录（M4）
  'run/runPaged': mockRuns,
  'run/nodePaged': mockRunNodes,
  'run/stats': mockRunStats,

  // 监控工具（M4）
  'monitor/health': mockHealth,
  'mq/queuePaged': mockMq,
  'source/check/syncPaged': mockSync,
  'monitor/alarmPaged': mockAlarms,
  'monitor/stats': mockMonitorStats,

  // 工作台（首页摘要）
  'workbench/summary': mockWorkbenchSummary,

  // 采集资产总览（首页驾驶舱）
  'overview/summary': mockOverviewSummary,
  'overview/trend': mockOverviewTrend,

  // 流程定义持久化
  'flow/save': mockFlowSave,
  'flow/load': mockFlowLoad,
  'flow/list': mockFlowList,
  'flow/recommend': mockFlowRecommend,
  'flow/nodeAiChat': mockNodeAiChat,

  // 网站—子源父子模型（0707 优化·Phase2）
  'site/sitePaged': mockSitePaged,
  'site/siteDetail': mockSiteDetail,
  'site/createSite': mockSiteCreate,
  'site/sourcesOfSite': mockSiteSourcesOf,
  'site/addSource': mockSiteSourceAdd,
  'site/importSources': mockSiteImportSources,
  'site/removeSource': mockSiteSourceRemove,
  'site/syncFlow': mockSiteSyncFlow,
  'site/queueStats': mockSiteQueueStats,
  'site/queueTaskPaged': mockQueueTaskPaged,
}
