import {
  mockSourcePaged,
  mockSourceDetail,
  mockSourceSame,
  mockSourceCategories,
  mockCategoryQuery,
  mockSourceStats,
  mockSourceSteps,
  mockCredentialRef,
  mockSourceLogs,
  mockSourceTasks,
  mockSourceTaskPaged,
  mockAck,
  mockSourceCreate,
  mockSourceCopy,
  mockSourceUpdate,
  mockBindSite,
  mockChangeSite,
  mockSourceNodeRuns,
  mockChangeSourceEnable,
  mockChangeToSuccess,
  mockBatchImport,
  mockLoadParams,
  mockSendSnatchWithParam,
  mockTagSource,
  mockSourceTags,
  mockSetColor,
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
  mockRuleOrchestrationSaveMeta,
  mockRuleOrchestrationDetail,
  mockRuleOrchestrationLoadScript,
  mockFileDownloadScript,
  mockExecuteCode,
  mockDataProcessGenerate,
  mockDocumentExtract,
  mockRuleOrchestrationGenerate,
  mockRuleOrchestrationTest,
} from './rules'
import { mockDatasets, mockMeasures, mockMetricStats } from './metrics'
import { mockEntryTypesGroup, mockDataRows, mockDataStats, mockDataRowQueryPaged, mockDataTableMeta, mockDataRowUpdate, mockEntryDataUpload, mockDistinctSource } from './dataview'
import { mockRuns, mockRunNodes, mockRunStats } from './runs'
import { mockHealth, mockMq, mockSync, mockAlarms, mockMonitorStats, mockCkSourceList, mockCkSourcePage, mockCkSourceInsert, mockCkSourceUpdate, mockSourceCheckPaged, mockSourceCheckLogs, mockSourceCheckAdd, mockSourceCheckUpdate, mockSourceCheckDelete, mockSourceCheckChangeEnable, mockSourceCheckRunNow, mockSourceCheckCheckOne, mockSourceCheckLastRun } from './monitor'
import {
  mockMqCheckPaged,
  mockMqCheckAdd,
  mockMqCheckUpdate,
  mockMqCheckDelete,
  mockMqCheckChangeEnable,
} from './queueCheck'
import {
  mockCommJobPaged,
  mockCommJobAdd,
  mockCommJobUpdate,
  mockCommJobDelete,
  mockCommJobChangeEnable,
  mockCommJobCopy,
  mockCommJobRun,
} from './commJob'
import { mockWorkbenchSummary } from './workbench'
import { mockOverviewSummary, mockOverviewTrend } from './overview'
import { mockFlowRecommend, mockNodeAiChat } from './flows'
import {
  mockSitePaged,
  mockSiteSummary,
  mockSiteDetail,
  mockSiteCreate,
  mockSiteUpdate,
  mockSiteSourcesOf,
  mockSiteSourceAdd,
  mockSiteCloneSource,
  mockSiteImportSources,
  mockSiteSourceRemove,
  mockSiteSyncFlow,
  mockSiteQueueStats,
  mockQueueTaskPaged,
} from './sites'
import { mockConfigPaged, mockConfigDetail, mockConfigParams, mockConfigActionLogs, mockSameConfigs } from './configs'
import { mockEntryPaged, mockEntryDetail, mockSaveEntryType } from './entries'
import { mockAddParamValues, mockDeleteParamValue, mockDeleteParams, mockGenValues, mockParamCopy, mockParamCreate, mockParamDetail, mockParamPaged, mockParamUpdate } from './params'
import { mockFilePaged, mockFileStats, mockFileResourceTables, mockFileResourceTableMeta, mockFileResourceRows } from './files'

// mock 注册表：key = 真实 /v1 端点路径，value = 处理函数。
// 真接入时这张表整体被 http 请求取代，端点字符串不变。
export const mockRegistry: Record<string, (params?: Record<string, unknown>) => unknown> = {
  // 采集资产 · 源（M2）
  'source/sourcePaged': mockSourcePaged,
  'source/sourceDetail': mockSourceDetail,
  'source/sourceSame': mockSourceSame,
  'source/categoryTree': mockSourceCategories,
  'category/categoryQuery': mockCategoryQuery,
  'category/add': mockAck,
  'category/addBatch': mockAck,
  'category/update': mockAck,
  'category/delete': mockAck,
  'source/stats': mockSourceStats,
  'item/next/nextConfigPaged': mockSourceSteps,
  'item/next/configs/same': mockSameConfigs,
  // 2026-10-10 流程版本：演示 / 测试环境按「未启用版本」处理，写步骤照旧不带版本信息
  'flow/version/overview': () => ({ enabled: false, curVer: null, nextVer: null, publishId: null, draftId: null, versions: [] }),
  'flow/version/nodes': () => [],
  'source/changeSourceEnable': mockChangeSourceEnable,
  'source/changeToSuccess': mockChangeToSuccess,
  'source/copySource': mockAck,
  'source/createSource': mockSourceCreate,
  'source/sourceCopy': mockSourceCopy,
  'source/updateSource': mockSourceUpdate,
  'source/bindSite': mockBindSite,
  'source/changeSite': mockChangeSite,
  'source/nodeRunStats': mockSourceNodeRuns,
  'source/sendSnatch': mockAck,
  'source/sendSnatchWithParam': mockSendSnatchWithParam,
  'source/deleteSource': mockAck,
  // 采集资产 · 源（M5 补充）
  'source/logPaged': mockSourceLogs,
  'task/topTaskPaged': mockSourceTasks,
  'source/sourceTaskPaged': mockSourceTaskPaged,
  'source/credentialDetail': mockCredentialRef,
  'source/batchImport': mockBatchImport,
  'source/batchModifyConfig': mockAck,
  'source/createJobs': mockAck,
  'source/changeFreqTag': mockAck,
  'source/markVerified': mockAck,
  'source/tagSource': mockTagSource,
  'source/sourceTags': mockSourceTags,
  'source/setColor': mockSetColor,
  'source/generateConfig': mockAck,

  'entry/batch/uploadData': mockEntryDataUpload,

  // 采集资产 · 配置（M5）
  'config/configPaged': mockConfigPaged,
  'config/configDetail': mockConfigDetail,
  'config/modify/updateConfig': mockAck,
  'config/copyAll': mockAck,
  'config/delete': mockAck,
  'config/sendConfigTask': mockAck,
  'config/updateTopic': mockAck,
  'config/updateConfigPolicy': mockAck,
  'config/changeEnable': mockAck,
  'config/configParams': mockConfigParams,
  'config/configParamAdd': mockAck,
  'config/configParamDel': mockAck,
  'config/loadParams': mockLoadParams,
  // 抓取类型字典 mock：只放旧平台下拉里确定见过的数值型取值，不含前端自造的 [BROWSER]/[WECHAT]/[LOGIN]，
  // 真实取值以 live 请求为准（0824-11 §1.2d）。
  'config/sourceTypes': () => [
    { sourceType: '90', typeName: '网页抓取' },
    { sourceType: '95', typeName: 'APP 抓取' },
    { sourceType: '150', typeName: 'OCR 识别' },
    { sourceType: '155', typeName: 'AI 提取' },
    { sourceType: '170', typeName: 'Python 抓取' },
    { sourceType: '800', typeName: '数据校验' },
  ],
  // 节点类型维护（0924-04）：mock 只给只读数据，写操作走通用 ack
  'sourceType/list': (params?: Record<string, unknown>) => {
    const rows = [
      { sourceType: 90, typeName: '网页抓取', downType: 'source-config', topic: null, seq: 0, notes: null, procType: '200', params: null },
      { sourceType: 160, typeName: 'Mail抓取', downType: 'source-config-mail', topic: null, seq: -1, notes: null, procType: '700', params: null },
      { sourceType: 500, typeName: '资讯抓取', downType: 'source-config', topic: null, seq: 19, notes: '单独的资讯抓取逻辑', procType: null, params: null },
      { sourceType: 800, typeName: '翻译助手', downType: 'source-config', topic: null, seq: 800, notes: null, procType: null, params: null },
    ]
    const kw = String(params?.typeName ?? '').trim()
    return kw ? rows.filter((r) => r.typeName.includes(kw)) : rows
  },
  'sourceType/detail': (params?: Record<string, unknown>) => ({ sourceType: Number(params?.sourceType), typeName: '网页抓取', downType: 'source-config', topic: null, seq: 0, notes: null, procType: '200', params: null }),
  'sourceType/add': mockAck,
  'sourceType/update': mockAck,
  'config/configActionPaged': mockConfigActionLogs,
  // 'config/clear' 2026-09-08 下线：configApi.clearConfig 已删，mock handler 一并删；
  // paramApi.clearParams 仍会路由到此 path（mock 模式走 fallback 通用占位，http 模式打真实后端）。
  // 端点本身保留在契约清单（endpoints.ts · danger=true）作写保护 + 记录用途。

  // 采集资产 · 实体表（M5）
  'config/entryTypePagedView': mockEntryPaged,
  'config/entryType': mockEntryDetail,
  'config/saveEntryType': mockSaveEntryType,
  'config/entryTypeAddAll': mockSaveEntryType,
  'config/rebuildTable': mockAck,
  'config/rebuildIndex': mockAck,
  'config/modifyEntryType': mockSaveEntryType,
  'config/deleteEntryType': mockAck,
  'config/entry-type-clear': mockAck,
  'config/entryTypeCopy': mockAck,
  'config/checkTable': mockAck,
  'config/syncTable': mockAck,
  'config/calcEntrySum': mockAck,
  'config/markEntryType': mockAck,

  // 采集资产 · 参数（M5）
  'config/paramPaged': mockParamPaged,
  'config/paramDetail': mockParamDetail,
  'config/genValues': mockGenValues,
  'config/param-add': mockParamCreate,
  'config/addParamValues': mockAddParamValues,
  'config/updateParam': mockParamUpdate,
  'config/paramValueDel': mockDeleteParamValue,
  'config/param-copy': mockParamCopy,
  'config/deleteParam': mockDeleteParams,

  // 原始文件（0711 R11）
  'file/resourceTables': mockFileResourceTables,
  'file/resourceTableMeta': mockFileResourceTableMeta,
  'file/resourceRows': mockFileResourceRows,
  'file/filePaged': mockFilePaged,
  'file/fileStats': mockFileStats,
  'file/upload': () => ({ ok: true, message: '文件已保存' }),

  // 规则资产（M3）
  'rule/groupTree': mockRuleGroups,
  'rule/rulePaged': mockRulePaged,
  'rule/stats': mockRuleStats,
  'rule/gateSummary': mockRuleGateSummary,
  'rule/sharedConfigPaged': mockSharedConfigs,
  'rule/testCasePaged': mockRuleTestCases,
  'rule/evaluate': mockEvaluate,
  'rule/orchestrationPaged': mockRuleOrchestrationPaged,
  'rule/orchestrationSaveMeta': mockRuleOrchestrationSaveMeta,
  'rule/orchestrationDetail': mockRuleOrchestrationDetail,
  'rule/orchestrationLoadScript': mockRuleOrchestrationLoadScript,
  'file/download': mockFileDownloadScript,
  'rule/executeCode': mockExecuteCode,
  'rule/dataProcessGenerate': mockDataProcessGenerate,
  'rule/documentExtract': mockDocumentExtract,
  'rule/orchestrationGenerate': mockRuleOrchestrationGenerate,
  'rule/orchestrationTest': mockRuleOrchestrationTest,
  'rule/publish': mockAck,
  'rule/runBatchTest': mockAck,

  // 指标中心（M4）
  'dataset/datasetPaged': mockDatasets,
  'measure/measurePaged': mockMeasures,
  'measure/stats': mockMetricStats,

  // 数据查看（M4）
  'data/entryTypesGroup': mockEntryTypesGroup,
  'data/rowPaged': mockDataRows,
  'data/stats': mockDataStats,
  'data/rowQueryPaged': mockDataRowQueryPaged,
  'data/distinctSource': mockDistinctSource,
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
  // 队列告警（队列校验配置，1013 从旧平台 QueueCheck.vue 迁入；内存表让写操作在 mock 下也能真落库）
  'mq/check/paged': mockMqCheckPaged,
  'mq/check/add': mockMqCheckAdd,
  'mq/check/update': mockMqCheckUpdate,
  'mq/check/delete': mockMqCheckDelete,
  'mq/check/changeEnable': mockMqCheckChangeEnable,
  // 自定义告警（通用定时任务，1013 从旧平台 CommJobList.vue 迁入；内存表让写操作在 mock 下也能真落库）
  'comm-job/paged': mockCommJobPaged,
  'comm-job/add': mockCommJobAdd,
  'comm-job/update': mockCommJobUpdate,
  'comm-job/delete': mockCommJobDelete,
  'comm-job/changeEnable': mockCommJobChangeEnable,
  'comm-job/copy': mockCommJobCopy,
  'comm-job/run': mockCommJobRun,
  // 源监控（数据源告警，0910 迁入；内存表让写操作在 mock 下也能真落库）
  'source/check/paged': mockSourceCheckPaged,
  'source/check/paged-logs': mockSourceCheckLogs,
  'source/check/add': mockSourceCheckAdd,
  'source/check/update': mockSourceCheckUpdate,
  'source/check/delete': mockSourceCheckDelete,
  'source/check/changeEnable': mockSourceCheckChangeEnable,
  'source/check/runNow': mockSourceCheckRunNow,
  'source/check/check-one': mockSourceCheckCheckOne,
  'source/lastRun': mockSourceCheckLastRun,
  'monitor/alarmPaged': mockAlarms,
  'monitor/stats': mockMonitorStats,
  // ck_source 监控源配置（数据监控节点保存同步，2026-09-05）
  'monitor/ckSourceList': mockCkSourceList,
  'monitor/ckSourcePage': mockCkSourcePage,
  'monitor/ckSourceInsert': mockCkSourceInsert,
  'monitor/ckSourceUpdate': mockCkSourceUpdate,

  // 工作台（首页摘要）
  'workbench/summary': mockWorkbenchSummary,

  // 采集资产总览（首页驾驶舱）
  'overview/summary': mockOverviewSummary,
  'overview/trend': mockOverviewTrend,

  // 流程定义持久化
  'flow/recommend': mockFlowRecommend,
  'flow/nodeAiChat': mockNodeAiChat,

  // 网站—源父子模型（0707 优化·Phase2）
  'site/sitePaged': mockSitePaged,
  'site/summary': mockSiteSummary,
  'site/siteDetail': mockSiteDetail,
  'site/createSite': mockSiteCreate,
  'site/updateSite': mockSiteUpdate,
  'site/sourcesOfSite': mockSiteSourcesOf,
  'site/addSource': mockSiteSourceAdd,
  'site/cloneSource': mockSiteCloneSource,
  'site/importSources': mockSiteImportSources,
  'site/removeSource': mockSiteSourceRemove,
  'site/syncFlow': mockSiteSyncFlow,
  'site/queueStats': mockSiteQueueStats,
  'site/queueTaskPaged': mockQueueTaskPaged,
}
