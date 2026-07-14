// 端点契约清单 —— 采集配置中心 API 的单一事实源。
// 依据《数据中心现有功能逆向工程_2026-06-17.md》：线上 Data Center 共提取 142 个 /v1 端点。
// 本清单收录已考证端点（path = 真实 /v1 路径，不含前缀），按 14 个前缀域组织；
// 每域注释「逆向统计目标数 / 本清单收录数」，未逐一还原的为登录态待补，真接入时按同名 path 规范补齐。
// danger=写类/高危端点（UI 二次确认占位）；impl=已有专属 mock handler，其余由 client.ts fallback 兜底。

export interface EndpointSpec {
  path: string
  desc: string
  danger?: boolean
  impl?: boolean
}

export const ENDPOINTS: EndpointSpec[] = [
  /* ── source 源（目标 36 / 收录 36） ── */
  { path: 'source/sourcePaged', desc: '源分页列表', impl: true },
  { path: 'source/sourceDetail', desc: '源详情', impl: true },
  { path: 'source/categoryTree', desc: '源分类目录树（计数）', impl: true },
  { path: 'source/stats', desc: '源 KPI 统计', impl: true },
  { path: 'source/logPaged', desc: '源操作日志', impl: true },
  { path: 'source/credentialDetail', desc: '登录凭据引用（脱敏）', impl: true },
  { path: 'source/updateSource', desc: '编辑源', danger: true, impl: true },
  { path: 'source/updateSourceSimple', desc: '简单编辑源', danger: true },
  { path: 'source/deleteSource', desc: '删除源', danger: true, impl: true },
  { path: 'source/copySource', desc: '复制派生源', danger: true, impl: true },
  // 0706 优化·Phase3 新增（前端新流程，非 142 逆向清单原有项）：新建采集源两段式闸门
  { path: 'source/createSource', desc: '新建源（闸门创建，含 ID 查重）', impl: true },
  { path: 'source/sourceCopy', desc: '从现有源复制预填（模板复用，不落库）', impl: true },
  // 0706 优化·Phase4 新增：任务视图 = 节点粒度运行记录（队列/总任务数/已处理数/状态）
  { path: 'source/nodeRunStats', desc: '源的节点粒度运行统计', impl: true },
  { path: 'source/sourceTaskPaged', desc: '子源任务实例分页（支持节点与状态筛选）', impl: true },
  { path: 'source/changeSourceEnable', desc: '启用 / 停用源', danger: true, impl: true },
  { path: 'source/sendSnatch', desc: '发抓取', danger: true, impl: true },
  { path: 'source/sendSnatchWithParam', desc: '带参发抓取', danger: true },
  { path: 'source/createJobs', desc: '生成 / 保存定时（批量定时）', danger: true, impl: true },
  { path: 'source/clear', desc: '清源缓存', danger: true },
  { path: 'source/queryStepDetail', desc: '查询子步骤详情' },
  { path: 'source/nextStep', desc: '手动后续处理', danger: true },
  { path: 'source/nextStep2', desc: '手动后续处理 2', danger: true },
  { path: 'source/batchImport', desc: '模板源批量导入', danger: true, impl: true },
  { path: 'source/batchModifyConfig', desc: '批量改配置', danger: true, impl: true },
  { path: 'source/changeFreqTag', desc: '频率标识', danger: true, impl: true },
  { path: 'source/markVerified', desc: '人工核验标记', danger: true, impl: true },
  { path: 'source/generateConfig', desc: '生成新配置并应用', danger: true, impl: true },
  { path: 'source/check/paged', desc: '源检查列表' },
  { path: 'source/check/syncPaged', desc: '同步状态列表', impl: true },
  { path: 'source/check/add', desc: '新增源检查', danger: true },
  { path: 'source/check/update', desc: '修改源检查', danger: true },
  { path: 'source/check/delete', desc: '删除源检查', danger: true },
  { path: 'source/check/changeEnable', desc: '启停源检查', danger: true },
  { path: 'source/check/check-one', desc: '执行一次源检查', danger: true },
  { path: 'source/check/runNow', desc: '立即运行源检查', danger: true },
  { path: 'source/tagSource', desc: '源打标签', danger: true },
  { path: 'source/setColor', desc: '设颜色标识', danger: true },
  { path: 'source/changeToSuccess', desc: '改为成功状态', danger: true },
  { path: 'source/saveJsonQuery', desc: '保存时 Json 查询' },
  { path: 'source/monitorQuery', desc: '源监控查询' },

  /* ── category 分类（目标 6 / 收录 6） ── */
  { path: 'category/categoryPaged', desc: '分类分页' },
  { path: 'category/categoryQuery', desc: '分类查询' },
  { path: 'category/add', desc: '新增分类', danger: true },
  { path: 'category/addBatch', desc: '批量新增分类', danger: true },
  { path: 'category/update', desc: '修改分类', danger: true },
  { path: 'category/delete', desc: '删除分类', danger: true },

  /* ── config 配置 + 实体 + 参数（目标 35 / 收录 27） ── */
  { path: 'config/configPaged', desc: '配置分页', impl: true },
  { path: 'config/configDetail', desc: '配置详情', impl: true },
  { path: 'config/updateConfig', desc: '修改配置', danger: true, impl: true },
  { path: 'config/copyAll', desc: '复制配置', danger: true, impl: true },
  { path: 'config/delete', desc: '删除配置', danger: true, impl: true },
  { path: 'config/sendConfigTask', desc: '发配置', danger: true, impl: true },
  { path: 'config/updateTopic', desc: '修改主题(队列)', danger: true, impl: true },
  { path: 'config/updateConfigPolicy', desc: '修改运行策略', danger: true, impl: true },
  { path: 'config/clear', desc: '清配置缓存', danger: true, impl: true },
  { path: 'config/entryTypePagedView', desc: '实体表分页', impl: true },
  { path: 'config/entryType', desc: '实体表详情', impl: true },
  { path: 'config/saveEntryType', desc: '新建 / 编辑实体表（upsert）', danger: true, impl: true },
  { path: 'config/entryTypeAddAll', desc: '实体属性批量增加', danger: true },
  { path: 'config/modifyEntryType', desc: '修改实体', danger: true, impl: true },
  { path: 'config/rebuildTable', desc: '重建表', danger: true, impl: true },
  { path: 'config/rebuildIndex', desc: '重建索引', danger: true, impl: true },
  { path: 'config/paramPaged', desc: '参数分页', impl: true },
  { path: 'config/paramDetail', desc: '参数详情', impl: true },
  { path: 'config/genValues', desc: '生成参数值预览', impl: true },
  { path: 'config/addParamValues', desc: '新增参数值', danger: true, impl: true },
  { path: 'config/param-add', desc: '新增参数（0711 R9：URL 参数编辑器发现参数不存在时创建）', danger: true, impl: true },
  { path: 'config/updateParam', desc: '修改参数', danger: true, impl: true },
  { path: 'config/param-copy', desc: '复制参数', danger: true },
  { path: 'config/logPaged', desc: '配置操作日志' },
  { path: 'config/bindParam', desc: '配置绑定参数', danger: true },
  { path: 'config/unbindParam', desc: '配置解绑参数', danger: true },

  /* ── entry 实体数据（目标 11 / 收录 7） ── */
  { path: 'entry/entryDataPaged', desc: '实体数据分页' },
  { path: 'entry/entryDetail', desc: '实体数据详情' },
  { path: 'entry/entryDistinctSource', desc: '实体数据按源去重' },
  { path: 'entry/summaryEntryData', desc: '实体数据汇总' },
  { path: 'entry/re-save', desc: '重存实体数据', danger: true },
  { path: 'entry/delete', desc: '删除实体数据', danger: true },
  { path: 'entry/manualAdd', desc: '手动添加实体数据', danger: true },

  /* ── item/next 子步骤（目标 7 / 收录 5） ── */
  { path: 'item/next/nextConfigPaged', desc: '子步骤分页', impl: true },
  { path: 'item/next/saveItemConfig', desc: '新增子步骤', danger: true },
  { path: 'item/next/stepModify', desc: '修改子步骤', danger: true },
  { path: 'item/next/enable', desc: '启停子步骤', danger: true },
  { path: 'item/next/delete', desc: '删除子步骤', danger: true },

  /* ── job 抓取/定时任务（目标 7 / 收录 7） ── */
  { path: 'job/snatchJobPaged', desc: '抓取任务分页' },
  { path: 'job/runJob', desc: '运行任务', danger: true },
  { path: 'job/enableJob', desc: '启用任务', danger: true },
  { path: 'job/disableJob', desc: '停用任务', danger: true },
  { path: 'job/deleteJob', desc: '删除任务', danger: true },
  { path: 'job/deleteJobs', desc: '批量删除任务', danger: true },
  { path: 'job/updateJob', desc: '修改任务', danger: true },

  /* ── comm-job 通用任务（目标 7 / 收录 7） ── */
  { path: 'comm-job/paged', desc: '通用任务分页' },
  { path: 'comm-job/add', desc: '新增通用任务', danger: true },
  { path: 'comm-job/update', desc: '修改通用任务', danger: true },
  { path: 'comm-job/delete', desc: '删除通用任务', danger: true },
  { path: 'comm-job/run', desc: '运行通用任务', danger: true },
  { path: 'comm-job/enable', desc: '启用通用任务', danger: true },
  { path: 'comm-job/disable', desc: '停用通用任务', danger: true },

  /* ── task 任务实例（目标 2 / 收录 2） ── */
  { path: 'task/topTaskPaged', desc: '任务实例分页（运行记录事实源）', impl: true },
  { path: 'task/resetTaskInsts', desc: '重置任务实例', danger: true },

  /* ── dataset 指标数据集（目标 9 / 收录 9） ── */
  { path: 'dataset/datasetPaged', desc: '数据集分页', impl: true },
  { path: 'dataset/add', desc: '新增数据集', danger: true },
  { path: 'dataset/updateDataSet', desc: '修改数据集', danger: true },
  { path: 'dataset/copy', desc: '复制数据集', danger: true },
  { path: 'dataset/delete', desc: '删除数据集', danger: true },
  { path: 'dataset/changeEnable', desc: '启停数据集', danger: true },
  { path: 'dataset/genFromSource', desc: '由源生成数据集', danger: true },
  { path: 'dataset/run', desc: '运行数据集', danger: true },
  { path: 'dataset/runNow', desc: '立即运行数据集', danger: true },

  /* ── measure 指标定义（目标 8 / 收录 8） ── */
  { path: 'measure/measurePaged', desc: '指标分页', impl: true },
  { path: 'measure/add', desc: '新增指标', danger: true },
  { path: 'measure/update', desc: '修改指标', danger: true },
  { path: 'measure/copy', desc: '复制指标', danger: true },
  { path: 'measure/delete', desc: '删除指标', danger: true },
  { path: 'measure/changeEnable', desc: '启停指标', danger: true },
  { path: 'measure/genMeasureFromSource', desc: '由源生成指标', danger: true },
  { path: 'measure/deleteMeasurePhy', desc: '物理删除指标', danger: true },

  /* ── mq 消息队列（目标 9 / 收录 9） ── */
  { path: 'mq/queuePaged', desc: '队列列表', impl: true },
  { path: 'mq/queueDetail2', desc: '队列详情' },
  { path: 'mq/message', desc: '获取消息' },
  { path: 'mq/purgeQueue', desc: '清空队列', danger: true },
  { path: 'mq/check/paged', desc: '队列检查列表' },
  { path: 'mq/check/add', desc: '新增队列检查', danger: true },
  { path: 'mq/check/update', desc: '修改队列检查', danger: true },
  { path: 'mq/check/delete', desc: '删除队列检查', danger: true },
  { path: 'mq/check/changeEnable', desc: '启停队列检查', danger: true },

  /* ── file 原始文件 / JSON（目标 3 / 收录 3） ── */
  { path: 'file/filePaged', desc: '原始文件分页（0711 R11 文件视图落地，仅子源态查询）', impl: true },
  { path: 'file/fileStats', desc: '原始文件统计：总数/总大小/失败数/最近生成时间（0711 R11 新增，非逆向清单原有项）', impl: true },
  { path: 'file/fileProcess', desc: '文件后续处理', danger: true },
  { path: 'file/fileJsonPaged', desc: '原始 JSON 分页' },

  /* ── flow 流程模板（目标 1 / 收录 5，含本系统流程持久化） ── */
  { path: 'flow/templateCode', desc: '流程模板编码' },
  { path: 'flow/save', desc: '保存流程定义', impl: true },
  { path: 'flow/load', desc: '加载流程定义', impl: true },
  { path: 'flow/list', desc: '流程列表', impl: true },
  { path: 'flow/recommend', desc: '流程推荐（mock 意图匹配 / 二期 LLM 生成）', impl: true },
  { path: 'flow/nodeAiChat', desc: '节点级 AI 对话（mock 关键词回复 / 二期 LLM，0701 问题八）', impl: true },

  /* ── comm 导出（目标 1 / 收录 1） ── */
  { path: 'comm/export', desc: '导出' },

  /* ════ 采集配置中心服务层自有端点（非 Data Center 142，本系统新增） ════ */
  // 规则资产（Data Center SPA 未发现规则路由，规则引擎为本系统纳入范围）
  { path: 'rule/groupTree', desc: '规则组树', impl: true },
  { path: 'rule/rulePaged', desc: '规则分页', impl: true },
  { path: 'rule/stats', desc: '规则 KPI', impl: true },
  { path: 'rule/gateSummary', desc: '发布门禁汇总', impl: true },
  { path: 'rule/sharedConfigPaged', desc: '共享配置', impl: true },
  { path: 'rule/testCasePaged', desc: '测试集', impl: true },
  { path: 'rule/evaluate', desc: '函数测试器求值', impl: true },
  { path: 'rule/orchestrationPaged', desc: '规则编排列表', impl: true },
  { path: 'rule/orchestrationGenerate', desc: '规则编排生成脚本', impl: true },
  { path: 'rule/orchestrationTest', desc: '规则编排测试脚本', impl: true },
  { path: 'rule/orchestrationSave', desc: '规则编排保存脚本', danger: true, impl: true },
  { path: 'rule/publish', desc: '发布规则', danger: true, impl: true },
  { path: 'rule/runBatchTest', desc: '跑批测', impl: true },
  // 运行记录 / 数据查看 / 监控（服务层聚合）
  { path: 'run/runPaged', desc: '运行记录分页', impl: true },
  { path: 'run/nodePaged', desc: 'run 节点明细', impl: true },
  { path: 'run/stats', desc: '运行 KPI', impl: true },
  { path: 'data/tablePaged', desc: '可查看数据表', impl: true },
  { path: 'data/rowPaged', desc: '实体数据行', impl: true },
  { path: 'data/stats', desc: '数据查看 KPI', impl: true },
  { path: 'data/rowQueryPaged', desc: '结果视图：按表+筛选分页查询', impl: true },
  { path: 'data/tableMeta', desc: '单表 schema 元信息', impl: true },
  { path: 'data/rowUpdate', desc: '结果视图：行编辑保存', impl: true },
  { path: 'measure/stats', desc: '指标中心 KPI', impl: true },
  { path: 'monitor/health', desc: '健康卡', impl: true },
  { path: 'monitor/alarmPaged', desc: '告警列表', impl: true },
  { path: 'monitor/stats', desc: '监控 KPI', impl: true },
  { path: 'workbench/summary', desc: '工作台摘要', impl: true },
  // 采集资产总览（首页驾驶舱，服务层聚合）
  { path: 'overview/summary', desc: '采集资产总览聚合（KPI / 生态 / 占比 / Top / 异常）', impl: true },
  { path: 'overview/trend', desc: '采集任务趋势（近 N 天抓取量 / 成功量）', impl: true },

  // 网站—子源父子模型（0707 优化·Phase2 新增：前端新概念，非 142 逆向清单原有项）
  { path: 'site/sitePaged', desc: '网站分页列表（含 sourceCount / errorCount 汇总）', impl: true },
  { path: 'site/siteDetail', desc: '网站详情', impl: true },
  { path: 'site/createSite', desc: '新建采集：网站 + 首批子源', impl: true },
  { path: 'site/updateSite', desc: '编辑网站基本信息', danger: true, impl: true },
  { path: 'site/sourcesOfSite', desc: '网站下的子源列表', impl: true },
  { path: 'site/addSource', desc: '网站下新增子源（默认继承统一流程）', impl: true },
  { path: 'site/cloneSource', desc: '复制子源流程、配置和表结构（不复制数据与运行实例）', danger: true, impl: true },
  { path: 'site/importSources', desc: '按网站批量导入子源，一行一条「名称;URL」（0710 会议批次）', impl: true },
  { path: 'site/removeSource', desc: '网站下移除子源', danger: true, impl: true },
  { path: 'site/syncFlow', desc: '网站统一流程同步覆盖到所选子源', danger: true, impl: true },
  { path: 'site/queueStats', desc: '网站粒度队列汇总（0707 Phase5 任务视图网站化）', impl: true },
  { path: 'site/queueTaskPaged', desc: '队列任务明细分页', impl: true },
]

/** 所有契约端点路径（fallback 判定用） */
export const ENDPOINT_PATHS = new Set(ENDPOINTS.map((e) => e.path))

/** 写类 / 高危端点（UI 统一二次确认占位） */
export const DANGER_ENDPOINTS = new Set(ENDPOINTS.filter((e) => e.danger).map((e) => e.path))
