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
  { path: 'source/updateSource', desc: '编辑源', danger: true },
  { path: 'source/updateSourceSimple', desc: '简单编辑源', danger: true },
  { path: 'source/deleteSource', desc: '删除源', danger: true, impl: true },
  { path: 'source/copySource', desc: '复制派生源', danger: true, impl: true },
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
  { path: 'config/entryTypeAddAll', desc: '实体属性批量增加', danger: true },
  { path: 'config/modifyEntryType', desc: '修改实体', danger: true, impl: true },
  { path: 'config/rebuildTable', desc: '重建表', danger: true, impl: true },
  { path: 'config/rebuildIndex', desc: '重建索引', danger: true, impl: true },
  { path: 'config/paramPaged', desc: '参数分页', impl: true },
  { path: 'config/paramDetail', desc: '参数详情', impl: true },
  { path: 'config/genValues', desc: '生成参数值预览', impl: true },
  { path: 'config/addParamValues', desc: '新增参数值', danger: true, impl: true },
  { path: 'config/param-add', desc: '新增参数', danger: true },
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
  { path: 'file/filePaged', desc: '原始文件分页' },
  { path: 'file/fileProcess', desc: '文件后续处理', danger: true },
  { path: 'file/fileJsonPaged', desc: '原始 JSON 分页' },

  /* ── flow 流程模板（目标 1 / 收录 5，含本系统流程持久化） ── */
  { path: 'flow/templateCode', desc: '流程模板编码' },
  { path: 'flow/save', desc: '保存流程定义', impl: true },
  { path: 'flow/load', desc: '加载流程定义', impl: true },
  { path: 'flow/list', desc: '流程列表', impl: true },
  { path: 'flow/recommend', desc: '流程推荐（mock 意图匹配 / 二期 LLM 生成）', impl: true },

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
  { path: 'rule/publish', desc: '发布规则', danger: true, impl: true },
  { path: 'rule/runBatchTest', desc: '跑批测', impl: true },
  // 运行记录 / 数据查看 / 监控（服务层聚合）
  { path: 'run/runPaged', desc: '运行记录分页', impl: true },
  { path: 'run/nodePaged', desc: 'run 节点明细', impl: true },
  { path: 'run/stats', desc: '运行 KPI', impl: true },
  { path: 'data/tablePaged', desc: '可查看数据表', impl: true },
  { path: 'data/rowPaged', desc: '实体数据行', impl: true },
  { path: 'data/stats', desc: '数据查看 KPI', impl: true },
  { path: 'measure/stats', desc: '指标中心 KPI', impl: true },
  { path: 'monitor/health', desc: '健康卡', impl: true },
  { path: 'monitor/alarmPaged', desc: '告警列表', impl: true },
  { path: 'monitor/stats', desc: '监控 KPI', impl: true },
  { path: 'workbench/summary', desc: '工作台摘要', impl: true },
]

/** 所有契约端点路径（fallback 判定用） */
export const ENDPOINT_PATHS = new Set(ENDPOINTS.map((e) => e.path))

/** 写类 / 高危端点（UI 统一二次确认占位） */
export const DANGER_ENDPOINTS = new Set(ENDPOINTS.filter((e) => e.danger).map((e) => e.path))
