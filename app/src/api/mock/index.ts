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
// mockMeasures（M4 演示形状）已不再注册：1014 迁移「指标列表」页时，measure/measurePaged
// 改成真实契约的分页端点（live），handler 换成 mock/measure.ts 的 mockMeasurePaged（旧平台字段名）。
// metrics.ts 仍保留该导出，避免动到与它同源的 mockDatasets / mockMetricStats。
import { mockDatasets, mockMetricStats } from './metrics'
import { mockEntryTypesGroup, mockDataRows, mockDataStats, mockDataRowQueryPaged, mockDataTableMeta, mockDataRowUpdate, mockEntryDataUpload, mockDistinctSource } from './dataview'
import { mockGroupResMeta, mockGroupResList, mockGroupResDetail, mockGroupResAdd, mockGroupResModify, mockGroupResDelete, mockGroupResPreview, mockGroupIds } from './groupRes'
import { mockSysUserList, mockSysUserDetail, mockSysUserAdd, mockSysUserUpdate, mockSysUserStatus, mockSysUserPassword, mockSysUserRoles } from './sysUser'
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
import { mockTaskListPaged } from './taskList'
import { mockTaskStat } from './taskStat'
import {
  mockMeasurePaged,
  mockMeasureAdd,
  mockMeasureUpdate,
  mockMeasureDelete,
  mockMeasureDeletePhy,
  mockMeasureChangeEnable,
  mockMeasureCopy,
  mockMeasureGenFromSource,
} from './measure'
import {
  mockDatasetPaged,
  mockDatasetUpdate,
  mockDatasetDelete,
  mockDatasetChangeEnable,
  mockDatasetCopy,
  mockDatasetGenFromSource,
  mockDatasetRunNow,
} from './dataset'
import {
  mockPocDatabaseEntryList,
  mockPocDatabaseTableInfo,
  mockPocDatabaseConfigSave,
  mockPocVectorConfigList,
  mockPocVectorDataQuery,
  mockVectorConfigPaged,
  mockVectorConfigSave,
  mockVectorMappingInfo,
  mockVectorConfigSync,
  mockVectorConfigDelete,
  mockMatchTableConfigPaged,
  mockMatchTableConfigSave,
  mockMatchTableConfigChangeStatus,
  mockMatchTableConfigDelete,
  mockReplaceTableConfigPaged,
  mockReplaceTableConfigSave,
  mockReplaceTableConfigChangeStatus,
  mockEntityRewriteConfigPaged,
  mockEntityRewriteConfigSave,
  mockEntityRewriteConfigChangeStatus,
  mockEntityRewriteConfigDelete,
  mockSqlTemplatePaged,
  mockSqlTemplateSave,
  mockSqlTemplateChangeStatus,
  mockSqlTemplateCopy,
  mockSqlTemplateDelete,
  mockTableTemplatePaged,
  mockTableTemplateSave,
  mockTableTemplateChangeStatus,
  mockDicTemplatePaged,
  mockDicTemplateAdd,
  mockDicTemplateUpdate,
  mockQuestionDicPaged,
  mockQuestionDicAdd,
  mockQuestionDicUpdate,
  mockQuestionDicChangeStatus,
  mockQuestionDicDelete,
  mockDataIndexSyncPaged,
  mockDataIndexSyncAdd,
  mockDataIndexSyncUpdate,
  mockDataIndexSyncRun,
  mockDataIndexConfigPaged,
  mockDataIndexConfigAllCode,
  mockDataIndexConfigAdd,
  mockDataIndexConfigUpdate,
  mockDataIndexConfigChangeStatus,
  mockChatFlowStepPaged,
  mockChatFlowStepAdd,
  mockChatFlowStepUpdate,
  mockChatFlowStepChangeStatus,
  mockWordSegmentPaged,
  mockWordSegmentUpdate,
  mockWordSegmentChangeStatus,
  mockWordSegmentBatchAdd,
  mockSystemConfigPaged,
  mockSystemConfigDetail,
  mockSystemConfigSave,
  mockPageConfigPaged,
  mockPageConfigBatchAdd,
  mockPageConfigUpdate,
  mockPageConfigChangeStatus,
} from './templateConfig'
import { mockWorkbenchSummary } from './workbench'
import { mockOverviewSummary, mockOverviewTrend } from './overview'
import { mockFlowRecommend, mockNodeAiChat } from './flows'
import {
  mockSitePaged,
  mockSiteSourceScopePaged,
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
import { mockEntryPaged, mockEntryDetail, mockEntrySetDsKind, mockGenerateAiCommont, mockBatchGenerateAiCommont, mockSaveEntryType } from './entries'
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
  'task/taskListPaged': mockTaskListPaged,
  'task/stat': mockTaskStat,
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
  // 抓取类型 mock 与当前数字字典快照对齐；真实环境仍以 config/sourceTypes 返回值为准。
  'config/sourceTypes': () => [
    { sourceType: '90', typeName: '网页抓取' },
    { sourceType: '95', typeName: '文件下载' },
    { sourceType: '110', typeName: 'EXCEL抓取' },
    { sourceType: '120', typeName: 'DOC抓取' },
    { sourceType: '130', typeName: 'PDF抓取' },
    { sourceType: '140', typeName: 'App抓取' },
    { sourceType: '150', typeName: 'OCR抓取' },
    { sourceType: '160', typeName: 'Mail抓取' },
    { sourceType: '170', typeName: 'Python抓取' },
    { sourceType: '300', typeName: '校验类' },
    { sourceType: '400', typeName: '提取数据发邮件' },
    { sourceType: '500', typeName: '资讯抓取' },
    { sourceType: '600', typeName: '规则处理' },
    { sourceType: '610', typeName: '数据监控' },
    { sourceType: '620', typeName: '数据校验' },
    { sourceType: '700', typeName: '视频提取音频' },
    { sourceType: '710', typeName: '音频提取文字' },
    { sourceType: '720', typeName: '文章生成摘要' },
    { sourceType: '730', typeName: '文章打标签' },
    { sourceType: '800', typeName: '翻译助手' },
    { sourceType: '801', typeName: '网页抓取CS' },
    { sourceType: '802', typeName: 'PDF转MD' },
  ],
  // 节点类型维护（0924-04）：mock 只给只读数据，写操作走通用 ack
  'sourceType/typeGroups': () => ['采集类', '规则类'],
  'sourceType/list': (params?: Record<string, unknown>) => {
    const rows = [
      { sourceType: 90, typeName: '网页抓取', typeGroup: '采集类', downType: 'source-config', topic: null, seq: 0, notes: null, procType: '200', params: null },
      { sourceType: 160, typeName: 'Mail抓取', typeGroup: '采集类', downType: 'source-config-mail', topic: null, seq: -1, notes: null, procType: '700', params: null },
      { sourceType: 500, typeName: '资讯抓取', typeGroup: null, downType: 'source-config', topic: null, seq: 19, notes: '单独的资讯抓取逻辑', procType: null, params: null },
      { sourceType: 800, typeName: '翻译助手', typeGroup: '规则类', downType: 'source-config', topic: null, seq: 800, notes: null, procType: null, params: null },
    ]
    const kw = String(params?.typeName ?? '').trim()
    const group = String(params?.typeGroup ?? '').trim()
    return rows.filter((r) => (!kw || r.typeName.includes(kw)) && (!group || r.typeGroup === group))
  },
  'sourceType/detail': (params?: Record<string, unknown>) => ({ sourceType: Number(params?.sourceType), typeName: '网页抓取', downType: 'source-config', topic: null, seq: 0, notes: null, procType: '200', params: null }),
  'sourceType/add': mockAck,
  'sourceType/update': mockAck,
  'sourceType/delete': mockAck,
  // 组级数据权限（系统设置 → 数据权限设置，接口文档-组数据权限.md）：内存表增删改查 + meta + 试算
  'group-res/list': mockGroupResList,
  'group-res/detail': mockGroupResDetail,
  'group-res/meta': mockGroupResMeta,
  'group-res/add': mockGroupResAdd,
  'group-res/modify': mockGroupResModify,
  'group-res/delete': mockGroupResDelete,
  'group-res/preview': mockGroupResPreview,
  'group-res/groups': mockGroupIds,
  // 用户管理（系统设置 → 用户管理，SysUserAdminController）：内存表 SYS_USER + 角色绑定
  'sys-user/list': mockSysUserList,
  'sys-user/detail': mockSysUserDetail,
  'sys-user/add': mockSysUserAdd,
  'sys-user/update': mockSysUserUpdate,
  'sys-user/update-status': mockSysUserStatus,
  'sys-user/change-password': mockSysUserPassword,
  'sys-user/roles': mockSysUserRoles,
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
  // 1026：单独改数据源 DS_KIND（快速同步到 CK 的回写），mock 里真改 ENTRIES 那一条
  'config/entry-type-ds-kind': mockEntrySetDsKind,
  // AI 综合描述：真实后端采样 + LLM，mock 按表结构拼一句并写回 ENTRIES（批量只回执，不同步生成）
  // 3768d15 起端点新增了拼写正确的 `AiComment` 版本（旧拼写 `AiCommont` 作为兼容别名保留），
  // 两个都标了 impl，mock 里复用同一 handler，否则端点契约测试会判「标 impl 的端点缺 mock handler」。
  // 合并（2026-11-03）：两端各自注册了这 4 个键，去重后只留一份。
  'config/entryType/generateAiComment': mockGenerateAiCommont,
  'config/entryType/generateAiCommont': mockGenerateAiCommont,
  'config/entryType/batchGenerateAiComment': mockBatchGenerateAiCommont,
  'config/entryType/batchGenerateAiCommont': mockBatchGenerateAiCommont,

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
  'measure/stats': mockMetricStats,
  // 指标中心（M4）
  // dataset/datasetPaged = 逆向清单的逻辑名，只服务 api/index.ts 的 M4 演示服务（metricApi.datasets）。
  // 真实路径是 dataset/dataSetPaged（大写 S），1013 迁移「指标数据集」页（旧 page/config/DatasetList.vue）
  // 时新增，7 个写端点一起接上——旧页面这些操作本来就全部直连后端。
  'dataset/dataSetPaged': mockDatasetPaged,
  'dataset/updateDataSet': mockDatasetUpdate,
  'dataset/delete': mockDatasetDelete,
  'dataset/changeEnable': mockDatasetChangeEnable,
  'dataset/copy': mockDatasetCopy,
  'dataset/genFromSource': mockDatasetGenFromSource,
  'dataset/runNow': mockDatasetRunNow,

  // 指标定义（1014 迁移「指标列表」页，旧 page/config/MeasureList.vue）。
  // 这一页在旧平台的分页 / 新增 / 修改 / 批量启停 / 批量删除 / 物理删除 / 复制**本来就全部直连后端**，
  // 所以这 8 条一起标 live：只放行分页、把写操作留在 mock，会让页面上的按钮看着能用、其实后端一条都没收到。
  // 注意 `measure/measurePaged` 这条的**逻辑名与真实路径同名**（旧 URL 就是 /v1/measure/measurePaged），
  // 不存在 dataset 那种大小写别名问题；原来注册在这里的 mockMeasures（M4 演示形状）已随之下线。
  'measure/measurePaged': mockMeasurePaged,
  'measure/add': mockMeasureAdd,
  'measure/update': mockMeasureUpdate,
  'measure/delete': mockMeasureDelete,
  'measure/deleteMeasurePhy': mockMeasureDeletePhy,
  'measure/changeEnable': mockMeasureChangeEnable,
  'measure/copy': mockMeasureCopy,
  'measure/genMeasureFromSource': mockMeasureGenFromSource,

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
  'site/sourceScopePaged': mockSiteSourceScopePaged,
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

  // 模板配置（旧 ai-chat-view 的 /api/poc 域，1013 迁入 sql 模板配置）
  // key 是 `poc/` 前缀的逻辑键：POC 服务的真实路径是站点根相对 /api/poc/…，
  // 端点清单见 api/endpoints.ts 的 poc 段，调用侧见 api/templateConfig.ts。
  'poc/sql-temp/page': mockSqlTemplatePaged,
  'poc/sql-temp': mockSqlTemplateSave,
  'poc/sql-temp/status': mockSqlTemplateChangeStatus,
  'poc/sql-temp/copy': mockSqlTemplateCopy,
  'poc/sql-temp/delete': mockSqlTemplateDelete,

  // 表模板配置（1013 迁入）：端点域是旧 question-temp，菜单标题才叫「表模板」。
  // 没有 poc/question-temp/copy —— 旧平台不提供表模板复制（见 api/templateConfig.ts 的 tableTemplateApi）。
  'poc/question-temp/page': mockTableTemplatePaged,
  'poc/question-temp': mockTableTemplateSave,
  'poc/question-temp/status': mockTableTemplateChangeStatus,
  // 表模板「使用表范围」下拉的数据表选项
  'poc/database/entry-list': mockPocDatabaseEntryList,
  // 表字段管理（1015 迁入「基础配置」）：字段列表 + 整表覆盖保存，与 entry-list 同一张内存表
  'poc/database/table-info': mockPocDatabaseTableInfo,
  'poc/database/config': mockPocDatabaseConfigSave,

  // 向量表（1015 迁入「基础配置」）：数据浏览两条只读 + 向量表管理五条（分页/保存/列映射/同步/删除），
  // 浏览下拉与管理列表共用 VECTOR_TABLES 一张内存表（管理页增删改会同步影响浏览页的表名下拉）。
  // 旧域里剩下的 data-match 是聊天侧 ChatTipsModal 用的，未迁。见 api/templateConfig.ts 的 vectorConfigApi。
  'poc/vector/config/all': mockPocVectorConfigList,
  'poc/vector/data': mockPocVectorDataQuery,
  'poc/vector/config/page': mockVectorConfigPaged,
  'poc/vector/config': mockVectorConfigSave,
  'poc/vector/mapping/info': mockVectorMappingInfo,
  'poc/vector/sync': mockVectorConfigSync,
  'poc/vector/delete': mockVectorConfigDelete,

  // 选表规则配置（1015 迁入「基础配置」，旧「基础配置 → 选表规则配置」，端点域 /poc/match-table-config）：
  // 与 sql 模板同形态 —— 新增/编辑同一个根端点（带 id 即更新）+ status（**query** 传参）+ delete（**query** 只发 id）；
  // 没有 copy（旧域没有该端点）。见 api/templateConfig.ts 的 matchTableConfigApi。
  'poc/match-table-config/page': mockMatchTableConfigPaged,
  'poc/match-table-config': mockMatchTableConfigSave,
  'poc/match-table-config/status': mockMatchTableConfigChangeStatus,
  'poc/match-table-config/delete': mockMatchTableConfigDelete,

  // 表改写管理（1015 迁入「基础配置」，旧「基础配置 → 表改写管理」，端点域 /poc/replace-table-config）：
  // 比选表规则配置还少一个端点 —— 旧域只有 page / 根（新增与编辑同一个）/ status（**query** 传参），
  // 没有 copy 也没有删除，所以这里只有三个 handler。见 api/templateConfig.ts 的 replaceTableConfigApi。
  'poc/replace-table-config/page': mockReplaceTableConfigPaged,
  'poc/replace-table-config': mockReplaceTableConfigSave,
  'poc/replace-table-config/status': mockReplaceTableConfigChangeStatus,

  // 实体改写管理（1015 迁入「基础配置」，旧「基础配置 → 实体改写管理」，端点域 /poc/entity-rewrite-config）：
  // 端点形状与选表规则配置一字不差 —— page / 根（新增与编辑同一个，body 带 id 即更新）/ status（**query**）/ delete（**query** 只发 id），
  // 没有 copy。差别在查询参数字段名：这一页上送的是 entityName（另两个域叫 name）。
  // ⚠️ 四条端点在 186 后端上还没打通（分页回通用 500，见 api/endpoints.ts），未标 live，所以现在**只走 mock**；
  // 这里的种子是按旧页面字段形状构造的示例，不是真实行。见 api/templateConfig.ts 的 entityRewriteConfigApi。
  'poc/entity-rewrite-config/page': mockEntityRewriteConfigPaged,
  'poc/entity-rewrite-config': mockEntityRewriteConfigSave,
  'poc/entity-rewrite-config/status': mockEntityRewriteConfigChangeStatus,
  'poc/entity-rewrite-config/delete': mockEntityRewriteConfigDelete,

  // 自动补全配置（1013 迁入）：新增与修改是两个端点（旧 dicAdd / dicUpdate），没有 status/copy。
  'poc/dic/page': mockDicTemplatePaged,
  'poc/dic': mockDicTemplateAdd,
  'poc/dic/update': mockDicTemplateUpdate,

  // 问句改写配置（1013 迁入）：新增/修改两个端点 + status（query）+ deleteQuestionDic（模板域唯一的删除）。
  'poc/question-dic/page': mockQuestionDicPaged,
  'poc/question-dic': mockQuestionDicAdd,
  'poc/question-dic/update': mockQuestionDicUpdate,
  'poc/question-dic/status': mockQuestionDicChangeStatus,
  'poc/question-dic/deleteQuestionDic': mockQuestionDicDelete,

  // 数据索引同步（1013 迁入）：新增/修改两个端点，没有 status/copy；sync 的 body 是 id 数组。
  'poc/data-index-sync/page': mockDataIndexSyncPaged,
  'poc/data-index-sync': mockDataIndexSyncAdd,
  'poc/data-index-sync/update': mockDataIndexSyncUpdate,
  'poc/data-index-sync/sync': mockDataIndexSyncRun,

  // 数据字典配置（1014 迁入）：新增/修改两个端点 + status（**body** 传参，与 question-dic 的 query 不同），没有 copy；
  // all-code 是「编码」筛选下拉的只读数据源，返回 {code,type} 裸数组。
  'poc/data-index-config/page': mockDataIndexConfigPaged,
  'poc/data-index-config/all-code': mockDataIndexConfigAllCode,
  'poc/data-index-config': mockDataIndexConfigAdd,
  'poc/data-index-config/update': mockDataIndexConfigUpdate,
  'poc/data-index-config/status': mockDataIndexConfigChangeStatus,

  // 提示词配置（1014 迁入，旧菜单「模板配置 → 提示词配置」，端点域 /poc/chat-flow-step）：
  // 新增/修改两个端点 + status（**body** 传参，与 question-dic 的 query 不同）；没有 copy、没有删除。
  'poc/chat-flow-step/page': mockChatFlowStepPaged,
  'poc/chat-flow-step': mockChatFlowStepAdd,
  'poc/chat-flow-step/update': mockChatFlowStepUpdate,
  'poc/chat-flow-step/status': mockChatFlowStepChangeStatus,

  // 分词配置（1014 迁入，模板域最后一个子模块）：修改 + status（**body** 传参）+ batch（body 是对象数组）；
  // 没有单条新增与 copy —— 旧列表的 showAdd 没绑任何按钮，新增一律走 batch（见 api/templateConfig.ts 的 wordSegmentApi）。
  'poc/word-segment-config/page': mockWordSegmentPaged,
  'poc/word-segment-config/update': mockWordSegmentUpdate,
  'poc/word-segment-config/status': mockWordSegmentChangeStatus,
  'poc/word-segment-config/batch': mockWordSegmentBatchAdd,

  // 问数系统配置（1015 迁入，旧 ai-chat-view「系统配置」组）：
  // 参数设置 分页/详情/修改（没有新增/删除/导出/刷新缓存入口，见 api/templateConfig.ts 的 systemConfigApi）；
  // 页面配置 分页/batch（对象数组）/update/status（**body** 传参），没有单条新增与 copy。
  'poc/system/config/page': mockSystemConfigPaged,
  'poc/system/config/detail': mockSystemConfigDetail,
  'poc/system/config': mockSystemConfigSave,
  'poc/system/page-config/page': mockPageConfigPaged,
  'poc/system/page-config/batch': mockPageConfigBatchAdd,
  'poc/system/page-config/update': mockPageConfigUpdate,
  'poc/system/page-config/status': mockPageConfigChangeStatus,
}
