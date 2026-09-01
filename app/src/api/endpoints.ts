// 端点契约清单 —— 采集配置中心 API 的单一事实源。
// 依据《数据中心现有功能逆向工程_2026-06-17.md》：线上 Data Center 共提取 142 个 /v1 端点。
// 本清单收录已考证端点（path = 真实 /v1 路径，不含前缀），按 14 个前缀域组织；
// 每域注释「逆向统计目标数 / 本清单收录数」，未逐一还原的为登录态待补，真接入时按同名 path 规范补齐。
// danger=写类/高危端点（UI 二次确认占位）；impl=已有专属 mock handler，其余由 client.ts fallback 兜底；
// live=已完成真实后端联调验证、可上线（client.ts 据此逐端点切真实，而非全局 VITE_API_MODE 一刀切）。

export interface EndpointSpec {
  path: string
  desc: string
  danger?: boolean
  impl?: boolean
  live?: boolean
}

export const ENDPOINTS: EndpointSpec[] = [
  /* ── source 源（目标 36 / 收录 36） ── */
  { path: 'source/sourcePaged', desc: '源分页列表', impl: true, live: true },
  { path: 'source/sourceDetail', desc: '源详情', impl: true, live: true },
  { path: 'source/sourceSame', desc: '同站源下拉（数据表页选源用）', impl: true, live: true },
  { path: 'source/categoryTree', desc: '源分类目录树（计数）', impl: true },
  { path: 'source/stats', desc: '源 KPI 统计', impl: true },
  { path: 'source/logPaged', desc: '源操作日志', impl: true },
  { path: 'source/credentialDetail', desc: '登录凭据引用（脱敏）', impl: true },
  { path: 'source/updateSource', desc: '编辑源', danger: true, impl: true, live: true },
  { path: 'source/updateSourceSimple', desc: '简单编辑源', danger: true },
  // 真实路径是 /v1/source/delete（GET ?ids=a,b），不是 source/deleteSource——后者是本项目早期自造的
  // 逻辑名。2026-08-27 接真实写入时按旧前端 src/api/source.js:241 的契约修正，httpEndpoint 显式指定。
  // usesMockAdapter 的 live 判定按真实 httpEndpoint 查表（见 client.ts:181 注释），live 必须标在
  // 下面 source/delete 这一条上；标在这条逻辑名上不生效——2026-08-27 曾把 live 错标在这里，
  // 导致「删除源」表面上像是接了真实接口，实际仍然悄悄走 mock（旧平台 SITE 编辑同款踩坑，见 §site/update）。
  { path: 'source/deleteSource', desc: '删除源 → GET /v1/source/delete?ids=', danger: true, impl: true },
  { path: 'source/delete', desc: '删除源（真实路径，见上方 source/deleteSource 的说明）', danger: true, live: true },
  { path: 'source/copySource', desc: '复制派生源', danger: true, impl: true },
  // 0706 优化·Phase3 新增（前端新流程，非 142 逆向清单原有项）：新建采集源两段式闸门
  { path: 'source/createSource', desc: '新建源（闸门创建，含 ID 查重）', impl: true },
  { path: 'source/sourceCopy', desc: '从现有源复制预填（模板复用，不落库）', impl: true },
  // 0706 优化·Phase4 新增：任务视图 = 节点粒度运行记录（队列/总任务数/已处理数/状态）
  { path: 'source/nodeRunStats', desc: '源的节点粒度运行统计', impl: true },
  // 逻辑名：画布任务视图。真实路径是 task/topTaskPaged（与源列表任务实例同一接口，已 live）。
  { path: 'source/sourceTaskPaged', desc: '源任务实例分页 → GET /v1/task/topTaskPaged', impl: true },
  // 逻辑名。真实路径是 GET /v1/source/changeEnable（旧 api/source.js:11），live 必须标在
  // 下面 source/changeEnable 那条上——usesMockAdapter 按真实 httpEndpoint 查表。
  { path: 'source/changeSourceEnable', desc: '启用 / 停用源 → GET /v1/source/changeEnable', danger: true, impl: true },
  { path: 'source/changeEnable', desc: '启用 / 停用源（真实路径，见上方 source/changeSourceEnable 的说明）', danger: true, live: true },
  { path: 'source/sendSnatch', desc: '发抓取', danger: true, impl: true, live: true },
  { path: 'snatch/snatchSave', desc: '旧平台新建源（Step1/2/3 一次性提交）', danger: true },
  { path: 'source/sendSnatchWithParam', desc: '带参发抓取', danger: true, impl: true, live: true },
  { path: 'source/createJobs', desc: '生成 / 保存定时（批量定时）', danger: true, impl: true },
  { path: 'source/clear', desc: '清源缓存', danger: true },
  { path: 'source/queryStepDetail', desc: '查询子步骤详情' },
  { path: 'source/nextStep', desc: '手动后续处理', danger: true, live: true },
  // nextStep2（发全部/大量后续）2026-08-19 起真实接线（M3-0G 复议，见方案；前端已加数量上限
  // 校验）；但这条请求路径本身从未真实调用过（AES 载荷形状、后端真实响应仅凭读源码推断），
  // 标 live 只是让"功能一个个上线"的默认流程生效，不代表已联调验证——上生产前必须先在测试
  // 环境用真实小批量数据走一遍完整链路，不能假设代码读对了就等于接口对了。
  { path: 'source/nextStep2', desc: '手动后续处理 2', danger: true, live: true },
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
  { path: 'source/tagSource', desc: '源打标签', danger: true, impl: true, live: true },
  // 0831 F03：当前查询条件下真实存在的标签（旧 querySourceTags）。读接口，无 danger。
  // 接它是为了看见**程序打进去**的标签——本机「最近使用」只记得手工打过的。
  { path: 'source/sourceTags', desc: '标签候选（按当前查询条件）', impl: true, live: true },
  // 0831 F01 起 UI 已无颜色入口；端点保留，旧平台仍在读写同一个 usedFlag。
  { path: 'source/setColor', desc: '设颜色标识（旧 usedFlag，本平台已无 UI 入口）', danger: true, impl: true, live: true },
  { path: 'source/changeToSuccess', desc: '改为成功状态', danger: true },
  { path: 'source/saveJsonQuery', desc: '保存时 Json 查询' },
  { path: 'source/monitorQuery', desc: '源监控查询' },

  /* ── category 分类（目标 6 / 收录 6） ── */
  // 源选择器沿用旧平台 categoryPaged 根节点读取；子节点仍需按 parentId 懒加载，暂不把 categoryTree 误标为完整 live。
  { path: 'category/categoryPaged', desc: '分类分页', live: true },
  { path: 'category/categoryQuery', desc: '分类查询' },
  { path: 'category/add', desc: '新增分类', danger: true },
  { path: 'category/addBatch', desc: '批量新增分类', danger: true },
  { path: 'category/update', desc: '修改分类', danger: true },
  { path: 'category/delete', desc: '删除分类', danger: true },

  /* ── config 配置 + 实体 + 参数（目标 35 / 收录 27） ── */
  { path: 'config/configPaged', desc: '配置分页', impl: true, live: true },
  { path: 'config/configDetail', desc: '配置详情', impl: true, live: true },
  { path: 'config/modify/updateConfig', desc: '修改配置', danger: true, impl: true, live: true },
  { path: 'config/copyAll', desc: '复制配置', danger: true, impl: true, live: true },
  { path: 'config/delete', desc: '删除配置', danger: true, impl: true, live: true },
  { path: 'config/sendConfigTask', desc: '发配置（把配置下发成采集任务；不是保存，也不是发抓取）', danger: true, impl: true, live: true },
  { path: 'config/updateTopic', desc: '修改主题(队列)', danger: true, impl: true, live: true },
  { path: 'config/updateConfigPolicy', desc: '修改运行策略', danger: true, impl: true, live: true },
  { path: 'config/changeEnable', desc: '启停配置', danger: true, impl: true, live: true },
  { path: 'config/configParams', desc: '配置绑定参数分页', impl: true, live: true },
  { path: 'config/loadParams', desc: '读取源配置的可选参数（发抓取参数弹窗）', impl: true, live: true },
  // 抓取类型字典（= 节点类型 = 配置的 configType，2026-08-28 确认）。旧平台 `api/source-type.js` 的
  // allSourceTypes，供旧「配置编辑」弹窗的「抓取类型」下拉用。取值形如 { sourceType: 90, typeName: '网页抓取' }。
  // 前端 SNATCH_TYPES / TEMPLATE_TO_SNATCH 目前是硬编码，且含 [BROWSER]/[WECHAT]/[LOGIN] 三个自造值，
  // 要以这个字典为准校正（0824-11 §1.2d：枚举一律照抄后端，不许自造）。
  { path: 'config/sourceTypes', desc: '抓取类型字典（节点类型 / configType 的权威取值）', impl: true, live: true },
  { path: 'config/configParamAdd', desc: '配置绑定参数', danger: true, impl: true, live: true },
  { path: 'config/configParamDel', desc: '配置解绑参数', danger: true, impl: true, live: true },
  { path: 'config/configActionPaged', desc: '配置操作日志分页', impl: true, live: true },
  { path: 'config/clear', desc: '清配置缓存（前端已下线，列表改刷新重查；同一端点也曾被参数清缓存复用）', danger: true, impl: true, live: true },
  { path: 'config/entryTypePagedView', desc: '实体表分页', impl: true, live: true },
  { path: 'config/queryEntryTypesGroup', desc: '按源加载实体表分组', live: true },
  { path: 'config/entryType', desc: '实体表详情', impl: true, live: true },
  { path: 'config/saveEntryType', desc: '⚠️ mock 时代占位，旧仓库无此路径，非真实契约端点，仅 mock/index.ts 引用', danger: true, impl: true },
  { path: 'config/entryTypeAddAll', desc: '新建实体表', danger: true, impl: true, live: true },
  { path: 'config/modifyEntryType', desc: '修改实体', danger: true, impl: true, live: true },
  { path: 'config/deleteEntryType', desc: '删除实体表', danger: true, impl: true, live: true },
  { path: 'config/entry-type-clear', desc: '清除实体表缓存（前端已下线，列表改刷新重查）', danger: true, impl: true, live: true },
  { path: 'config/entryTypeCopy', desc: '复制实体表', danger: true, impl: true, live: true },
  { path: 'config/checkTable', desc: '检查物理表结构', impl: true, live: true },
  { path: 'config/syncTable', desc: '同步物理表结构', danger: true, impl: true, live: true },
  { path: 'config/calcEntrySum', desc: '重新计算实体表数据量', danger: true, impl: true, live: true },
  { path: 'config/markEntryType', desc: '切换正式表/测试表', danger: true, impl: true, live: true },
  { path: 'config/rebuildTable', desc: '重建表', danger: true, impl: true, live: true },
  { path: 'config/rebuildIndex', desc: '重建索引', danger: true, impl: true, live: true },
  { path: 'config/paramPaged', desc: '参数分页', impl: true, live: true },
  { path: 'config/paramDetail', desc: '参数详情', impl: true, live: true },
  { path: 'config/genValues', desc: '生成参数值预览', impl: true, live: true },
  { path: 'config/addParamValues', desc: '新增参数值', danger: true, impl: true, live: true },
  { path: 'config/paramValueDel', desc: '删除参数值', danger: true, live: true },
  { path: 'config/paramValueUpdate', desc: '修改参数值', danger: true },
  { path: 'config/param-add', desc: '新增参数（0711 R9：URL 参数编辑器发现参数不存在时创建）', danger: true, impl: true, live: true },
  { path: 'config/updateParam', desc: '修改参数', danger: true, impl: true, live: true },
  { path: 'config/param-copy', desc: '复制参数', danger: true, live: true },
  { path: 'config/deleteParam', desc: '删除参数', danger: true, live: true },
  { path: 'config/logPaged', desc: '配置操作日志' },
  { path: 'config/bindParam', desc: '配置绑定参数', danger: true },
  { path: 'config/unbindParam', desc: '配置解绑参数', danger: true },

  /* ── entry 实体数据（收录 12，见「单表数据查看迁移」方案 §1.1 的 16 个旧端点核对） ── */
  { path: 'entry/entryDataPaged', desc: '实体数据分页', live: true },
  { path: 'entry/queryEntryType', desc: '实体数据动态表结构', live: true },
  { path: 'entry/entryDetail', desc: '实体数据详情', live: true },
  { path: 'entry/entryDistinctSource', desc: '实体数据按源去重', live: true },
  // 0812 已在 115.227.21.133 以当前表 + 发布时间字段验证真实请求；空结果属于正常响应。
  { path: 'entry/summaryEntryData', desc: '实体数据汇总', live: true },
  // re-save 未见明确真实联调验证记录，暂不标 live
  { path: 'entry/re-save', desc: '重存实体数据', danger: true },
  // 旧仓库实际路径是 entryDelete（此前登记为 delete 是权宜猜测，单表数据查看方案 §1.1 核对修正）
  { path: 'entry/entryDelete', desc: '删除实体数据（单条/按源/整表 × 当日/全量）', danger: true, live: true },
  { path: 'entry/entryDeleteBatch', desc: '按 IDs 批量删除实体数据', danger: true, live: true },
  // entryClearParent 契约已核实正确（字段名/类型排除），但后端对该接口本身有 bug（见联调发现文档 §3），标 live 是因为前端对接完成、真实报错也是预期内的已知问题
  { path: 'entry/entryClearParent', desc: '清除父表后续标识', danger: true, live: true },
  { path: 'entry/entryUpdate', desc: '手动修改实体数据', danger: true, live: true },
  { path: 'entry/batch/saveEntryOne', desc: '手动新增实体数据', danger: true, live: true },
  { path: 'entry/batch/uploadData', desc: '批量导入实体数据（Excel）', danger: true, impl: true, live: true },
  { path: 'entry/entryExportAll', desc: '导出 Excel（URL 直开，同源 Cookie 鉴权）。0831 G7：旧 api/entry.js 没有这条，本平台 DataView 已在用；不标 live——exportUrl 不走 request()' },

  /* ── item/next 子步骤（目标 7 / 收录 5） ── */
  { path: 'item/next/nextConfigPaged', desc: '子步骤分页 / 流程图读取', impl: true, live: true },
  { path: 'item/next/configs/same', desc: '同资源配置（选择已有配置的候选来源，list1 同域 / list2 其它域）', impl: true, live: true },
  // 2026-08-31 联调：画布节点名 / 进入条件 / 增删节点走这 4 条，不走配置。
  // payload 已按 2026-08-26 源 430016398 / itemConfig 40600 实测对过；标 live 后日常 mock 模式也会打真实后端。
  { path: 'item/next/saveItemConfig', desc: '新增子步骤（POST query，不是 JSON body）', danger: true, live: true },
  { path: 'item/next/stepModify', desc: '修改子步骤（节点名 / 进入条件 / lastStep；JSON body）', danger: true, live: true },
  { path: 'item/next/enable', desc: '启停子步骤（GET ?id=&state=；0 启用 / 1 停用）', danger: true, live: true },
  { path: 'item/next/delete', desc: '删除子步骤（GET ?id=itemConfig）', danger: true, live: true },

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
  { path: 'task/topTaskPaged', desc: '任务实例分页（运行记录事实源）', impl: true, live: true },
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

  /* ── file 原始文件 / JSON（目标 3 / 收录 5） ── */
  // 2026-08-17 核实：现役 FileList2.vue 不使用 filePaged，而是 file_resource 表的通用实体表接口。
  { path: 'file/resourceTables', desc: '文件资源表目录（映射 config/entryTypePagedView?name=file_resource）', impl: true },
  { path: 'file/resourceTableMeta', desc: '文件资源表结构（映射 entry/queryEntryType）', impl: true },
  { path: 'file/resourceRows', desc: '文件资源记录分页（映射 entry/entryDataPaged）', impl: true },
  // 以下两项仅为旧 mock/兼容测试保留，禁止新增业务调用；真实旧平台没有对应接口。
  { path: 'file/filePaged', desc: '已废弃：旧原始文件分页兼容 mock', impl: true },
  { path: 'file/fileStats', desc: '已废弃：新平台自造统计端点，无旧平台契约', impl: true },
  { path: 'file/fileProcess', desc: '文件后续处理', danger: true },
  { path: 'file/fileJsonPaged', desc: '原始 JSON 分页' },

  /* ── flow 流程模板（目标 1 / 收录 5，含本系统流程持久化） ── */
  { path: 'flow/templateCode', desc: '流程模板编码' },
  { path: 'flow/save', desc: '保存流程定义', impl: true },
  { path: 'flow/load', desc: '加载流程定义', impl: true },
  { path: 'flow/list', desc: '流程列表', impl: true },
  { path: 'flow/recommend', desc: '流程模板推荐（mock 意图匹配 / 二期 LLM 推荐）', impl: true },
  { path: 'flow/nodeAiChat', desc: '节点级 AI 对话（mock 关键词回复 / 二期 LLM，0701 问题八）', impl: true },
  { path: 'flow-template/list', desc: '流程列表（临时兼容存储，版本化）', impl: true },
  { path: 'flow-template/detail', desc: '流程详情（临时兼容存储，可指定版本）', impl: true },
  { path: 'flow-template/save', desc: '保存流程（临时兼容存储）', impl: true },

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
  // TODO(REVIEW-2026-08-04 P2 #8)：desc 里的真实路径和 index.ts 里 httpEndpoint 硬编码的字符串是两份
  // 拷贝，改路径要改两处（这里 + rule/orchestrationSaveMeta/orchestrationDetail/orchestrationGenerate/
  // orchestrationTest/orchestrationSave 等其它 vrule 端点同样重复）。可以给 ENDPOINTS 表加一个
  // httpEndpoint 字段统一管理、desc 只负责人话描述，但这个改动会触及全部 impl:true 端点的写法，
  // 影响面不止 vrule 这几个，值得单独立一个 PR 做，这里先留个标记。
  { path: 'rule/orchestrationPaged', desc: '规则编排列表 → /vrule/ai/dashscope/list/compose', impl: true, live: true },
  // 0803 曾把规则节点表来源改走 vrule 搜索（news-getTableSearch/TableFields），0805 撤回：
  // 实测确认采集中心 entryType 和 vrule 是同一份底层表注册表（entryTypeId/itemCode 编号空间共享），
  // 改回统一用 config/entryTypePagedView + config/entryType（见下方 entryApi 相关端点），两个 vrule
  // 专用端点随之删除，不再需要。
  // 0801 方案：逻辑键；http 时 ruleApi 经 adapter 打到 /vrule/...（见 ruleHttp.test.ts）
  { path: 'rule/orchestrationSaveMeta', desc: '规则编排保存业务规则元数据 → /vrule/api/custom-compose/save', danger: true, impl: true, live: true },
  { path: 'rule/orchestrationDetail', desc: '规则编排详情 → /vrule/api/custom-compose/getComposeById', impl: true, live: true },
  { path: 'rule/orchestrationLoadScript', desc: '读取规则脚本正文 → /vrule/ai/dashscope/code', impl: true, live: true },
  // generate 已接真实流式（form-urlencoded）；需数字 ruleId（由 saveMeta live 提供）
  { path: 'rule/orchestrationGenerate', desc: '规则编排生成脚本 → /vrule/ai/dashscope/stream', impl: true, live: true },
  { path: 'rule/orchestrationTest', desc: '规则编排测试脚本 → /vrule/fastapi/execute/dynamic', impl: true, live: true },
  { path: 'rule/orchestrationSave', desc: '规则编排保存脚本 → /vrule/ai/dashscope/script/edit', danger: true, impl: true, live: true },
  { path: 'rule/publish', desc: '发布规则', danger: true, impl: true },
  { path: 'rule/runBatchTest', desc: '跑批测', impl: true },
  // 运行记录 / 数据查看 / 监控（服务层聚合）
  { path: 'run/runPaged', desc: '运行记录分页', impl: true },
  { path: 'run/nodePaged', desc: 'run 节点明细', impl: true },
  { path: 'run/stats', desc: '运行 KPI', impl: true },
  { path: 'data/entryTypesGroup', desc: '选表分组（聚合摊平供 /data 选表用）', impl: true },
  { path: 'data/rowPaged', desc: '实体数据行', impl: true },
  { path: 'data/stats', desc: '数据查看 KPI', impl: true },
  { path: 'data/rowQueryPaged', desc: '结果视图：按表+筛选分页查询', impl: true },
  { path: 'data/tableMeta', desc: '单表 schema 元信息', impl: true },
  { path: 'data/rowUpdate', desc: '结果视图：行编辑保存', impl: true },
  // 以下 E 包新增方法暂无专属 mock handler（尚无 UI 消费），演示环境走 client.ts 的通用 fallback 兜底
  { path: 'data/rowDetail', desc: '数据详情（entryId+type，含 showItems/subs）' },
  { path: 'data/distinctSource', desc: '提取去重源 ID' },
  { path: 'data/summaryData', desc: '统计（未加密 POST）' },
  { path: 'data/nextStep', desc: '发选中/本页后续', danger: true },
  { path: 'data/nextStepBatch', desc: '发大批量后续（180s 超时）', danger: true },
  { path: 'data/rowDelete', desc: '删除：单条/该源/整表 × 当日/全量', danger: true },
  { path: 'data/rowDeleteBatch', desc: '按 IDs 批量删除', danger: true },
  { path: 'data/clearParent', desc: '清除父表后续标识', danger: true },
  { path: 'data/rowAdd', desc: '手动新增', danger: true },
  { path: 'data/reSave', desc: '重新保存原始 JSON', danger: true },
  { path: 'measure/stats', desc: '指标中心 KPI', impl: true },
  { path: 'monitor/health', desc: '健康卡', impl: true },
  { path: 'monitor/alarmPaged', desc: '告警列表', impl: true },
  { path: 'monitor/stats', desc: '监控 KPI', impl: true },
  { path: 'workbench/summary', desc: '工作台摘要', impl: true },
  // 采集资产总览（首页驾驶舱，服务层聚合）
  { path: 'overview/summary', desc: '采集资产总览聚合（KPI / 生态 / 占比 / Top / 异常）', impl: true },
  { path: 'overview/trend', desc: '采集任务趋势（近 N 天抓取量 / 成功量）', impl: true },

  // 网站—源父子模型：0810 对接 data-view 的网站读取接口；写类仅按明确流程逐步联调。
  // 0812 已在 W1 测试环境完成只读联调。建站三条（site/add、snatchSave、bindSite）不标默认 live，
  // 避免测试代理误写入；生产新建由 siteCreate 在 isProductionCreateEnabled 时单次强制 http。
  { path: 'site/sitePaged', desc: '网站分页列表（真实 cfg_site，含 sourceCnt / errorCnt 汇总）', impl: true, live: true },
  { path: 'site/summary', desc: '网站统计摘要（网站/源/告警网站/出错源）', live: true },
  { path: 'site/detail', desc: '网站详情（真实路径）', live: true },
  { path: 'site/sources', desc: '网站下的源分页（真实路径）', live: true },
  { path: 'site/add', desc: '独立新建网站', danger: true },
  // 关系写入必须显式切 HTTP + 受控环境；不能因默认 mock 下的 live 机制误触发真实绑定。
  { path: 'source/bindSite', desc: '将源关联到网站', danger: true, impl: true },
  // 批量版 bindSite（0812 计划 M4-5）；2026-08-15 生产环境已实测确认契约（Q4：无效 ID 静默跳过，
  // 不是整批失败），同样不给默认 live，联调需显式切 HTTP + 受控环境。
  { path: 'source/changeSite', desc: '批量关联/变更源所属网站', danger: true, impl: true },
  { path: 'site/siteDetail', desc: '网站详情', impl: true },
  { path: 'site/createSite', desc: '新建采集：网站 + 首批源', impl: true },
  // 真实路径是 /v1/site/update（POST，body 为 cfg_site 实体），见旧前端 src/api/site.js:95。
  // live 必须标在下面 site/update 这一条上，不是这条逻辑名——usesMockAdapter 按真实 httpEndpoint
  // 查表（client.ts:181）。2026-08-27 曾把 live 标在这里，导致改网站名称表面接了真实接口，实际
  // 仍悄悄落回 mock（mockSiteUpdate 还是旧的 category/owner 必填形状，传新形状直接 `.trim()` 报错）。
  { path: 'site/updateSite', desc: '编辑网站基本信息 → POST /v1/site/update', danger: true, impl: true },
  { path: 'site/update', desc: '编辑网站基本信息（真实路径，见上方 site/updateSite 的说明）', danger: true, live: true },
  { path: 'site/sourcesOfSite', desc: '网站下的源列表', impl: true },
  { path: 'site/addSource', desc: '网站下新增源（默认继承统一流程）', impl: true },
  { path: 'site/cloneSource', desc: '复制源流程、配置和表结构（不复制数据与运行实例）', danger: true, impl: true },
  { path: 'site/importSources', desc: '按网站批量导入源，一行一条「名称;URL」（0710 会议批次）', impl: true },
  { path: 'site/removeSource', desc: '网站下移除源', danger: true, impl: true },
  { path: 'site/syncFlow', desc: '源流程覆盖同步到同网站所选源（fromSourceId → sourceIds，网站本身无流程）', danger: true, impl: true },
  { path: 'site/queueStats', desc: '网站粒度队列汇总（0707 Phase5 任务视图网站化）', impl: true },
  { path: 'site/queueTaskPaged', desc: '队列任务明细分页', impl: true },
]

/** 所有契约端点路径（fallback 判定用） */
export const ENDPOINT_PATHS = new Set(ENDPOINTS.map((e) => e.path))

/** 写类 / 高危端点（UI 统一二次确认占位） */
export const DANGER_ENDPOINTS = new Set(ENDPOINTS.filter((e) => e.danger).map((e) => e.path))

/** 已联调验证、可上线走真实后端的端点（client.ts 按此逐端点切真实，不受全局 mock/http 开关限制） */
export const LIVE_ENDPOINTS = new Set(ENDPOINTS.filter((e) => e.live).map((e) => e.path))
