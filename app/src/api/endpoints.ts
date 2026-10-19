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
  // 2026-09-01：侧栏「按模板源添加」每天都在调。旧 GET /v1/source/copySource?sourceId&name&url&flag，
  // 响应 data 通常是 null，新源 ID 靠复制前后 sourcePaged 差集定位。
  { path: 'source/copySource', desc: '复制派生源（制作源副本 / 源+配置副本）', danger: true, impl: true, live: true },
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
  // 2026-09-18 接上：节点配置里改完定时策略、点保存时写回 job 表（旧平台 saveSourceCron）。
  // ⚠️ POST 但参数走 **query**，不是 body——旧 api/source-job.js 用的就是 `method:'post', params`。
  { path: 'source/createJobs', desc: '给源新建定时（**只新建**，改已有的要用 job/updateJob）', danger: true, live: true },
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
  // 源监控（数据源告警）。0910 从旧平台 MonitorList 迁入；2026-10-12 按「对齐旧页面全量操作」
  // 把这套端点的写接口一并放行真实调用——旧平台这一页的行开关 / 批量启停 / 立即运行 / 删除 /
  // 新增 / 编辑保存本来就是全部直连后端，新页面若只放行分页，用户在页面上点的这些操作只会落到
  // mock（演示口径）：看着能点、提示"操作成功（演示）"、后端一条都没收到，正是要修的问题。
  // 0916 用户提供 source/check/paged 真实契约（首屏 page/limit，选源后再带 sourceId）。
  // ⚠️ 放行不等于已联调：这套接口 2026-09-10 曾被后端告知要重做，路径与字段可能再变；
  // 生产上写类端点还会被 client.ts 的写保护白名单拦，需要真落库的联调请把目标指向非生产环境
  // （或按需增删那份白名单），别在生产上拿真实监控配置试。
  { path: 'source/check/paged', desc: '源检查列表', impl: true, live: true },
  { path: 'source/check/syncPaged', desc: '同步状态列表', impl: true },
  { path: 'source/check/add', desc: '新增源检查 → POST body', danger: true, impl: true, live: true },
  { path: 'source/check/update', desc: '修改源检查 → POST body（提交体需剔除 createDt/updateDt/lastRun/nextRun）', danger: true, impl: true, live: true },
  { path: 'source/check/delete', desc: '删除源检查 → POST ?ids=a,b（参数在 query，不是 body）', danger: true, impl: true, live: true },
  { path: 'source/check/changeEnable', desc: '启停源检查 → GET ?ids=&enable=（0=启用/1=停用，与 isDelete 同向）', danger: true, impl: true, live: true },
  { path: 'source/check/check-one', desc: '执行一次源检查（CheckAdd「验证」）→ POST body', danger: true, impl: true, live: true },
  { path: 'source/check/runNow', desc: '立即运行源检查 → GET ?ids=', danger: true, impl: true, live: true },
  { path: 'source/check/paged-logs', desc: '源检查历史日志 → GET ?sourceId=&jobId=&state=&name=&page=&limit=', impl: true, live: true },
  // 定时预览：旧平台 `GET /v1/source/lastRun?cron=<urlencoded>`（api/util.js checkCron），
  // 返回该 cron 的最近若干次运行时间（**裸数组**）；CheckAdd 的「定时」弹窗「测试」用它。
  // cron 含 `*` / `?` / `/`，必须 URL 编码，否则 `?` 会被当成新参数的起始。
  { path: 'source/lastRun', desc: '按 cron 计算最近运行时间（定时预览）', impl: true, live: true },
  // 2026-09-01 实测报错：source/tagSource 在真实后端根本不存在（GET 500）——对照旧平台
  // api/source.js 确认，打标签走的是 POST /v1/source/markBatch（markBatch(ids, flag, freq,
  // notify, tags)），tagSource 这个端点名是臆造的，从没在旧平台出现过。live 标记挪到下面
  // 真实路径的 source/markBatch 条目，这条只留给 mock。
  { path: 'source/tagSource', desc: '源打标签', danger: true, impl: true },
  { path: 'source/markBatch', desc: '批量打标签（源打标签真实路径，见上方 source/tagSource 的说明）', danger: true, live: true },
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
  // 2026-09-18 接上：新建/编辑网站的分类选择器靠它做跨层级模糊搜索——懒加载树的本地
  // filter 只能过滤**已展开**的节点，深层分类搜不到。实测 `?wd=主流媒体` 返回 4 条，
  // 带 categoryId / categoryName / level / parentId / path（祖先 id 链）。
  { path: 'category/categoryQuery', desc: '分类关键词查询（跨层级）', live: true },
  { path: 'category/add', desc: '新增分类', danger: true, live: true },
  { path: 'category/addBatch', desc: '批量新增分类', danger: true, live: true },
  { path: 'category/update', desc: '修改分类', danger: true, live: true },
  { path: 'category/delete', desc: '删除分类', danger: true, live: true },
  // 2026-10-14「我的视图」目录：视图目录 = 带 rootViewId 的分类（categoryPaged / add / update 加 rootViewId，一级 parentId=-1）。
  // 前端按调用强制走真实（mode: 'http'），与 source-view/* 同口径，不标 live。
  // 10-15 V3：changeSources 已删（调用 500），改成增量的 addSources / delSources；sourcePaged 加 viewCategoryId
  { path: 'category/listSources', desc: '视图目录的源行和来源组（GET categoryId；返回 { sourceIds, sourceGroupIds }，sourceIds 含来源组展开的成员，不含子目录）' },
  { path: 'category/addSources', desc: '视图目录加入源 / 来源组（POST { categoryId, sourceIds[], sourceGroupIds[] }，增量，重复跳过；来源组会把当前成员展开成源行；返回新增源数）', danger: true },
  { path: 'category/delSources', desc: '视图目录移出源 / 来源组（POST 同 addSources；删来源组连当前成员的源行一起删；同时传源和来源组只删一部分，前端分开调）', danger: true },

  /* ── config 配置 + 实体 + 参数（目标 35 / 收录 27） ── */
  { path: 'config/configPaged', desc: '配置分页', impl: true, live: true },
  { path: 'config/configDetail', desc: '配置详情', impl: true, live: true },
  { path: 'config/modify/updateConfig', desc: '修改配置', danger: true, impl: true, live: true },
  { path: 'config/copyAll', desc: '复制配置', danger: true, impl: true, live: true },
  // 2026-09-02 config_api.md §十六补齐：**唯一的"从零建配置"接口**，语义是仅新增
  // （configId 传了也被忽略，走自增），入参与 updateConfig 同一个 ConfigWithBLOBs 实体。
  // 后端自动补 state=C / isDelete=0 / createDt / topic（缺省 dev_web_snatch_{用户名}），
  // 并写一条 CONF_ADD 动作流水——这正解释了 0828 的实测困惑：当时用 updateConfig 不带
  // configId 想新增，返回 success 但日志里没有 CONF_ADD，因为写 CONF_ADD 的是这条 add。
  // ⚠️ 新 configId **只在 msg 文本里**（"新增成功，id:1001"），data 恒为 null，要自己解析。
  // 旧平台 config.js 没封装它，所以照旧前端代码是找不到的。
  { path: 'config/add', desc: '新增配置（仅新增，新 configId 在 msg 里）', danger: true, live: true },
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
  // 节点类型维护（0924-04，系统设置 → 节点类型；旧平台「配置 → 源类型」）。2026-09-24 生产逐个实测：
  // 读接口不分页；add/update 是 JSON body，update 为增量更新；临时类型 99901 新增→修改→删除闭环已清理。
  // sourceType/delete：2026-10-14 在 186 实测被配置引用时后端拒绝（连软删除的配置也算），可安全接入。
  { path: 'sourceType/list', desc: '节点类型列表（typeName 模糊，不分页）', impl: true, live: true },
  { path: 'sourceType/detail', desc: '节点类型详情', impl: true, live: true },
  { path: 'sourceType/add', desc: '新增节点类型（sourceType 可不填，后端取 max+1）', danger: true, impl: true, live: true },
  { path: 'sourceType/update', desc: '修改节点类型（增量更新）', danger: true, impl: true, live: true },
  { path: 'sourceType/delete', desc: '删除节点类型（被配置 / 有效源引用时后端拒绝）', danger: true, impl: true, live: true },
  { path: 'config/configParamAdd', desc: '配置绑定参数', danger: true, impl: true, live: true },
  { path: 'config/configParamDel', desc: '配置解绑参数', danger: true, impl: true, live: true },
  { path: 'config/configActionPaged', desc: '配置操作日志分页', impl: true, live: true },
  // 2026-09-08 按 0908 核对结论下线：2026-08-11 长期约定（AGENTS.md）弹窗不提供「清缓存」入口、
  // 列表统一刷新重查。configApi.clearConfig 已删（无调用方），paramApi.clearParams 仍保留
  // （被 ParamTab.test.ts 5 个回归测试 + 1 个 HTTP 契约测试钉死"不再调 config/clear"），
  // 未来真要做清缓存请照本条 + client.ts:158 的教训恢复注册与白名单。
  // 保留为 danger 契约记录：留在 DANGER_ENDPOINTS 中，生产写保护仍会拦误用。
  { path: 'config/clear', desc: '清配置/参数缓存（前端已下线；configApi.clearConfig 封装 2026-09-08 删除，paramApi.clearParams 保留作回归测试桩）', danger: true },
  { path: 'config/entryTypePagedView', desc: '实体表分页', impl: true, live: true },
  { path: 'config/queryEntryTypesGroup', desc: '按源加载实体表分组', live: true },
  { path: 'config/entryType', desc: '实体表详情', impl: true, live: true },
  { path: 'config/saveEntryType', desc: '⚠️ mock 时代占位，旧仓库无此路径，非真实契约端点，仅 mock/index.ts 引用', danger: true, impl: true },
  { path: 'config/entryTypeAddAll', desc: '新建实体表', danger: true, impl: true, live: true },
  { path: 'config/modifyEntryType', desc: '修改实体', danger: true, impl: true, live: true },
  { path: 'config/deleteEntryType', desc: '删除实体表', danger: true, impl: true, live: true },
  { path: 'config/entry-type-clear', desc: '清除实体表缓存（前端已下线，列表改刷新重查）', danger: true, impl: true, live: true },
  // 旧 EntryDataImport.vue：前端解析 Excel 生成 items（覆盖字段定义）+ 表头之后的行作为 data，整体 POST。
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

  /* ── poc 模板配置（旧 ai-chat-view「模板配置」域，1013 迁入 sql 模板配置） ──
     POC 服务是独立进程（dev 代理 /api/poc → 186:9093，见 vite.config.ts），不在 9999 业务后端上；
     四个端点的调用形态见 api/templateConfig.ts 顶部注释。 */
  { path: 'poc/sql-temp/page', desc: 'sql 模板分页 → POST /api/poc/sql-temp/page（body: pageNo/pageSize/name）', impl: true, live: true },
  { path: 'poc/sql-temp', desc: 'sql 模板新增/编辑 → POST /api/poc/sql-temp（body 带 id 即更新）', danger: true, impl: true, live: true },
  { path: 'poc/sql-temp/status', desc: 'sql 模板启停 → POST /api/poc/sql-temp/status?id=&status=（0 启用 / 1 禁用）', danger: true, impl: true, live: true },
  { path: 'poc/sql-temp/copy', desc: 'sql 模板复制 → POST /api/poc/sql-temp/copy?id=', danger: true, impl: true, live: true },

  // 表模板配置（1013 迁入）。⚠️ 未标 live：本轮沙箱访问不到 186 POC 服务，question-temp 的真实响应
  // 还没实测核对过（旧平台契约来自 src/demoApi/EntityApi.js:323-345）。联调验证后逐条补 live。
  // 旧平台没有 poc/question-temp/copy —— 表模板不提供复制，见 api/templateConfig.ts 的 tableTemplateApi。
  { path: 'poc/question-temp/page', desc: '表模板分页 → POST /api/poc/question-temp/page（body: pageNo/pageSize/name）', impl: true, live: true },
  { path: 'poc/question-temp', desc: '表模板新增/编辑 → POST /api/poc/question-temp（body 带 id 即更新；tableArr/sqlTempConfigIds 是 JSON 字符串）', danger: true, impl: true, live: true },
  { path: 'poc/question-temp/status', desc: '表模板启停 → POST /api/poc/question-temp/status?id=&status=（0 启用 / 1 禁用）', danger: true, impl: true, live: true },
  { path: 'poc/database/entry-list', desc: '数据表选项（表模板「使用表范围」下拉）→ GET /api/poc/database/entry-list?name=', impl: true, live: true },
  // 表字段管理（1015 迁入，旧 ai-chat-view「基础配置 → 表字段管理」src/demo/EntityConfig.vue，同 database 域）。
  // 契约来自旧 src/demoApi/EntityApi.js:4-6；与 entry-list 同域同进程，live 对齐同域口径。
  // ⚠️ config 是**整表覆盖**：一次保存同时写表头（entityType）与全部字段行（entityItems）。
  { path: 'poc/database/table-info', desc: '表字段列表（表字段管理）→ GET /api/poc/database/table-info?tableId=', impl: true, live: true },
  { path: 'poc/database/config', desc: '表字段配置保存 → POST /api/poc/database/config（body {entityType, entityItems}，整表覆盖）', danger: true, impl: true, live: true },

  // 向量表数据浏览（1015 迁入，旧 ai-chat-view「基础配置 → 向量表数据浏览」src/demo/VectorDataShowTop.vue + VectorDataShow.vue）。
  // 契约来自旧 src/demoApi/VectorApi.js:12-13（config/all、data），两条都是只读；同 database 域走 186 POC 服务。
  // ⚠️ config/all 的 name 是**必填**查询参数（缺参数后端回 code:400，2026-10-15 实测），空关键词也要发 ?name=；
  // ⚠️ data 用旧页面原载荷实测回 code:500「服务器繁忙」（186 上向量检索链路未起），形状按旧页面读法落地，待后端可用后复核。
  { path: 'poc/vector/config/all', desc: '向量表选项（浏览页表名下拉）→ GET /api/poc/vector/config/all?name=（name 必填，空关键词也带）', impl: true, live: true },
  { path: 'poc/vector/data', desc: '向量表数据查询 → POST /api/poc/vector/data（body: input/type/pageSize/pageNo，返回整份 JSON 展示）', impl: true, live: true },

  // 向量表管理（1015 迁入，旧 ai-chat-view「基础配置 → 向量表管理」src/demo/VectorTableList.vue + modal/VectorMapping.vue）。
  // 契约来自旧 src/demoApi/VectorApi.js:4-8、11；同 vector 域走 186 POC 服务。
  // ⚠️ 未标 live：本轮没拿到这 5 个端点的真实响应（写链路要浏览器登录会话），联调核对后逐条补（同 question-temp 先例）。
  // 旧域里剩下的 data-match（POST /poc/vector/data-match）是聊天侧 ChatTipsModal 用的，不属于本页面，未迁。
  { path: 'poc/vector/config/page', desc: '向量表管理分页 → POST /api/poc/vector/config/page（body: pageNo/pageSize/name/sourceTable，两个都模糊筛）', impl: true, live: true },
  { path: 'poc/vector/config', desc: '向量表配置保存 → POST /api/poc/vector/config（body {config, items}，config 带 id 即更新；列映射整份覆盖）', danger: true, impl: true, live: true },
  { path: 'poc/vector/mapping/info', desc: '向量表列映射明细 → GET /api/poc/vector/mapping/info?configId=（弹窗回显三行 编码/内容/别名 映射）', impl: true, live: true },
  { path: 'poc/vector/sync', desc: '向量表同步 → POST /api/poc/vector/sync（body 是 **id 数组** [id]，不是包装对象；后端重建向量并回写 lastSync）', danger: true, impl: true, live: true },
  { path: 'poc/vector/delete', desc: '向量表删除 → POST /api/poc/vector/delete（body {type: 向量表名称}，⚠️ 按 name 删不按 id，旧平台独有口径）', danger: true, impl: true, live: true },

  // 选表规则配置（1015 迁入，旧 ai-chat-view「基础配置 → 选表规则配置」src/demo/MatchTableConfigList.vue + modal/MatchTableConfigEditor.vue）。
  // 契约来自旧 src/demoApi/MatchTableConfigApi.js:3-8，同为 186 POC 服务；分页已在 186 实测（2026-10-15 浏览器会话，共 2 条）。
  // 与 sql 模板同形态：新增与修改是**同一个根端点**（body 带 id 即更新）；没有 copy。
  // ⚠️ status 与 delete 的参数都走 **query**（旧 changeConfigStatus / deleteConfig 用的是 axios params，
  //    与 chat-flow-step / data-index-config / system 那几个 body 传参的域不同）。
  // ⚠️ 实测两条口径照旧、不改：name 确实是按 tableName 模糊筛；分页的 status 筛选**后端不生效**
  //    （传 '0' / '1' / 数字 / 不传都回全量），旧平台同行为，所以 status 下拉按 1:1 保留、不在前端兜底过滤。
  //    真实行的 status 回的是**数字** 1，比较走 String(row.status)。
  { path: 'poc/match-table-config/page', desc: '选表规则分页 → POST /api/poc/match-table-config/page（body: pageNo/pageSize/name/status，name 是旧「表名称」搜索框的参数名、按 tableName 模糊筛；status 后端不生效）', impl: true, live: true },
  { path: 'poc/match-table-config', desc: '选表规则新增/编辑 → POST /api/poc/match-table-config（body 带 id 即更新：tableName/selectionType/rule/status）', danger: true, impl: true, live: true },
  { path: 'poc/match-table-config/status', desc: '选表规则启停 → POST /api/poc/match-table-config/status?id=&status=（0 启用 / 1 禁用）', danger: true, impl: true, live: true },
  { path: 'poc/match-table-config/delete', desc: '选表规则删除 → POST /api/poc/match-table-config/delete?id=（旧平台少见的删除端点，只发 id）', danger: true, impl: true, live: true },

  // 表改写管理（1015 迁入，旧 ai-chat-view「基础配置 → 表改写管理」src/demo/ReplaceTableConfigList.vue + modal/ReplaceTableConfigEditor.vue）。
  // 契约来自旧 src/demoApi/ReplaceTableConfigApi.js:4-6 —— 旧接口文件只有这三个函数：
  // 与选表规则配置同形态（新增与修改**同一个根端点**、body 带 id 即更新；status 参数走 **query**），
  // 没有 copy，也**没有删除**（旧列表操作列只有「编辑」和「启用/禁用」），所以本域就是 CRUD 工厂去掉 copy 的形状。
  // 三条端点：分页 2026-10-15 在 186 只读实测（全库 2 条：两张表互相对换、都是 unionall + 禁用）；
  // save / status 按旧契约接线并标 live，但本轮**没做写验证**（不往开发库造数据），联调跑通一条真实新增后再复核。
  // 与选表规则配置**不同**的两点：
  // ⚠️ 本域分页的 status 筛选后端**是生效的**（'0' 回 0 条、'1' 回全量 2 条，数字与字符串都认）；
  // ⚠️ name 按 tableName 模糊筛但**大小写敏感**（name=JX 回 1 条、name=jx 回 0 条）。
  // 另实测 replaceTableName / tableName 当筛选参数上送会被后端忽略（回全量），旧页面也没有这两个查询入口，不迁。
  // 真实行的 status 回的是**数字** 1，比较走 String(row.status)；行里还带 delFlag（恒 '0'，页面不展示、编辑整行带回）。
  { path: 'poc/replace-table-config/page', desc: '表改写分页 → POST /api/poc/replace-table-config/page（body: pageNo/pageSize/name/status，name 按 tableName 模糊筛、大小写敏感；status 后端生效）', impl: true, live: true },
  { path: 'poc/replace-table-config', desc: '表改写新增/编辑 → POST /api/poc/replace-table-config（body 带 id 即更新：tableName/replaceType/replaceTableName/status）', danger: true, impl: true, live: true },
  { path: 'poc/replace-table-config/status', desc: '表改写启停 → POST /api/poc/replace-table-config/status?id=&status=（0 启用 / 1 禁用）', danger: true, impl: true, live: true },

  // 实体改写管理（1015 迁入「基础配置」，旧「基础配置 → 实体改写管理」src/demo/EntityRewriteConfigList.vue +
  // modal/EntityRewriteConfigEditor.vue，旧接口 src/demoApi/EntityRewriteConfigApi.js:4-7）。
  // 端点形状与选表规则配置完全一致（page body / 根端点新增与编辑两用 body / status query / delete query），
  // 差别只在字段口径：查询框上送的参数名是 **entityName**（不像另两个域改名叫 name），列字段是 cleanType。
  // ⚠️ 四条都**没标 live**：2026-10-16 在 186 实测 POST /api/poc/entity-rewrite-config/page 回后端通用 500
  //（同前缀下不存在的路径 entity-rewrite/page 是 Tomcat 404，说明控制器在、查询时炸，疑 186 库缺该域表）。
  // 先按旧契约接线走 mock，后端把这一页打通并抓到真实行（含 status 是数字还是字符串、有无 delFlag 等额外列）后再逐条补 live。
  { path: 'poc/entity-rewrite-config/page', desc: '实体改写分页 → POST /api/poc/entity-rewrite-config/page（body: pageNo/pageSize/entityName/status；186 实测 500，未联调）', impl: true, live: true },
  { path: 'poc/entity-rewrite-config', desc: '实体改写新增/编辑 → POST /api/poc/entity-rewrite-config（body 带 id 即更新：entityName/cleanType/content/targetContent/status）', danger: true, impl: true, live: true },
  { path: 'poc/entity-rewrite-config/status', desc: '实体改写启停 → POST /api/poc/entity-rewrite-config/status?id=&status=（0 启用 / 1 禁用）', danger: true, impl: true, live: true },
  { path: 'poc/entity-rewrite-config/delete', desc: '实体改写删除 → POST /api/poc/entity-rewrite-config/delete?id=（只发 id，走 query）', danger: true, impl: true, live: true },

  // 自动补全配置（1013 迁入，已联调 186 POC 服务）。
  // 与其他模块不同：新增与修改是两个端点（/poc/dic 与 /poc/dic/update），且没有 status/copy。
  { path: 'poc/dic/page', desc: '自动补全分页 → POST /api/poc/dic/page（body: pageNo/pageSize/name，name 模糊匹配「内容」）', impl: true, live: true },
  { path: 'poc/dic', desc: '自动补全新增 → POST /api/poc/dic（body: content/keyWords/type=1，不带 id）', danger: true, impl: true, live: true },
  { path: 'poc/dic/update', desc: '自动补全修改 → POST /api/poc/dic/update（body 带 id）', danger: true, impl: true, live: true },

  // 问句改写配置（1013 迁入）。⚠️ 未标 live：真实响应还没实测核对过
  // （旧平台契约来自 src/demoApi/EntityApi.js:176-206、408-415；直连 186 探测返回 302，需要登录态）。
  // 联调验证后逐条补 live。与 dic 域同款：新增/修改是两个端点；另有 status（query）
  // 与 deleteQuestionDic（旧平台唯一的删除端点，body 发整行）。
  { path: 'poc/question-dic/page', desc: '问句改写分页 → POST /api/poc/question-dic/page（body: pageNo/pageSize/name/stepCode/type/status）', impl: true, live: true },
  { path: 'poc/question-dic', desc: '问句改写新增 → POST /api/poc/question-dic（body: stepCode/type/receiveRule/content/targetContent/tag，不带 id）', danger: true, impl: true, live: true },
  { path: 'poc/question-dic/update', desc: '问句改写修改 → POST /api/poc/question-dic/update（body 带 id）', danger: true, impl: true, live: true },
  { path: 'poc/question-dic/status', desc: '问句改写启停 → POST /api/poc/question-dic/status?id=&status=（0 启用 / 1 禁用）', danger: true, impl: true, live: true },
  { path: 'poc/question-dic/deleteQuestionDic', desc: '问句改写删除 → POST /api/poc/question-dic/deleteQuestionDic（旧页面发整行，后端按 id 删）', danger: true, impl: true, live: true },

  // 数据索引同步配置（1013 迁入，分页已在 186 POC 服务实测：46 条、name 模糊匹配 comment、status 空串=全部）。
  // 与 dic / question-dic 同款：新增/修改是两个端点；没有 status/copy（旧列表与旧弹窗都没有启停入口）。
  // ⚠️ sync 是**写操作**：后端按行里的 beforeSql/syncSql/afterSql 真跑一遍索引重建，旧页面点「同步」即执行、无二次确认。
  { path: 'poc/data-index-sync/page', desc: '数据索引同步分页 → POST /api/poc/data-index-sync/page（body: pageNo/pageSize/name/status，name 模糊匹配「同步名称」comment）', impl: true, live: true },
  { path: 'poc/data-index-sync', desc: '数据索引同步新增 → POST /api/poc/data-index-sync（body: comment/tableName/type/columnName/syncSql/beforeSql/afterSql，不带 id）', danger: true, impl: true, live: true },
  { path: 'poc/data-index-sync/update', desc: '数据索引同步修改 → POST /api/poc/data-index-sync/update（body 带 id）', danger: true, impl: true, live: true },
  { path: 'poc/data-index-sync/sync', desc: '数据索引同步执行 → POST /api/poc/data-index-sync/sync（body 是 id **数组**，如 [56]）', danger: true, impl: true, live: true },

  // 数据字典配置（1014 迁入）。⚠️ 未标 live：真实响应还没实测核对过
  // （旧平台契约来自 src/demoApi/EntityApi.js:34-38、104-150；沙箱直连 186 POC 服务不通，需登录态）。
  // 与 dic / question-dic 同款：新增/修改是两个端点；没有 copy。
  // ⚠️ status 的参数走 **body**（旧 dataIndexConfigStatus 用的是 axios data，与 question-dic/status 的 query 不同）。
  { path: 'poc/data-index-config/page', desc: '数据字典分页 → POST /api/poc/data-index-config/page（body: pageNo/pageSize/name/code/type/status）', impl: true, live: true },
  { path: 'poc/data-index-config', desc: '数据字典新增 → POST /api/poc/data-index-config（body: code/type/content/alias/contentCode，不带 id）', danger: true, impl: true, live: true },
  { path: 'poc/data-index-config/update', desc: '数据字典修改 → POST /api/poc/data-index-config/update（body 带 id，只有 alias 可改）', danger: true, impl: true, live: true },
  { path: 'poc/data-index-config/status', desc: '数据字典启停 → POST /api/poc/data-index-config/status（body: id/status，0 启用 / 1 禁用）', danger: true, impl: true, live: true },
  { path: 'poc/data-index-config/all-code', desc: '数据字典编码选项（「编码」筛选下拉）→ GET /api/poc/data-index-config/all-code', impl: true, live: true },

  // 提示词配置（1014 迁入，旧菜单「模板配置 → 提示词配置」）。
  // 菜单叫「提示词配置」，端点域是 chat-flow-step（旧路由 /demo/chat-flow-step-list），1:1 不改名。
  // 契约来自 src/demoApi/ChatFlowStepApi.js:3-8；与 dic / question-dic 同款：新增/修改是两个端点；
  // 没有 copy、也没有删除端点（旧列表只有编辑与启停）。
  // ⚠️ status 的参数走 **body**（旧 chatFlowStepStatus 用的是 axios data，与 question-dic/status 的 query 不同）。
  // ⚠️ live 与同域其余模块一致（都走 186 的 POC 代理），但本轮沙箱直连探测返回 302（需登录态），
  //    真实行样本没取到，mock 种子是按旧字段形状构造的示例（见 api/mock/templateConfig.ts）——
  //    首次联调请核对 chat-flow-step 的列名与 status 口径后再确认。
  { path: 'poc/chat-flow-step/page', desc: '提示词配置分页 → POST /api/poc/chat-flow-step/page（body: pageNo/pageSize/name/status，name 恒为空串）', impl: true, live: true },
  { path: 'poc/chat-flow-step', desc: '提示词配置新增 → POST /api/poc/chat-flow-step（body: stepCode/flowCode/stepName/templateDef 等 16 个表单字段，不带 id）', danger: true, impl: true, live: true },
  { path: 'poc/chat-flow-step/update', desc: '提示词配置修改 → POST /api/poc/chat-flow-step/update（body 带 id）', danger: true, impl: true, live: true },
  { path: 'poc/chat-flow-step/status', desc: '提示词配置启停 → POST /api/poc/chat-flow-step/status（body: id/status，0 启用 / 1 禁用）', danger: true, impl: true, live: true },

  // 分词配置（1014 迁入，模板域最后一个子模块）。契约来自旧 src/demoApi/EntityApi.js:40-44、64-100。
  // 分页已在 186 POC 服务实测（2026-10-14）：434 条，type/token 是字符串字面量（PERSON/ORGANIZATION/base…），
  // status 回的是**数字** 0。update / status / batch 三条写端点同域同进程，未逐条实测，联调时先核对。
  // 与 dic / question-dic 同款是新增/修改分端点的域，但本域**没有单条新增**：旧列表没有任何入口触发
  // wordSegmentConfigAdd（见 api/templateConfig.ts 的 wordSegmentApi），新增一律走 batch。
  // ⚠️ status 的参数走 **body**（旧 wordSegmentConfigStatus 用的是 axios data，与 question-dic/status 的 query 不同）。
  { path: 'poc/word-segment-config/page', desc: '分词配置分页 → POST /api/poc/word-segment-config/page（body: pageNo/pageSize/name/type/token/status，name 模糊匹配「内容」content）', impl: true, live: true },
  { path: 'poc/word-segment-config/batch', desc: '分词配置批量新增 → POST /api/poc/word-segment-config/batch（body 是 {type,content,token} **对象数组**）', danger: true, impl: true, live: true },
  { path: 'poc/word-segment-config/update', desc: '分词配置修改 → POST /api/poc/word-segment-config/update（body 带 id，type/content/token 都可改）', danger: true, impl: true, live: true },
  { path: 'poc/word-segment-config/status', desc: '分词配置启停 → POST /api/poc/word-segment-config/status（body: id/status，0 启用 / 1 禁用）', danger: true, impl: true, live: true },

  // 问数系统配置（1015 迁入，旧 ai-chat-view「系统配置」组 → 问数配置组「问数系统配置」页内两 tab）。
  // 契约来自旧 src/api/system/config.js 与 src/api/system/pageConfig.js，端点域 /poc/system/*，同为 186 POC 服务。
  // 参数设置：分页 + 详情（id 走**路径段**，逻辑键固定 poc/system/config/detail，真实请求靠 httpEndpoint 拼 id）+ 修改；
  // 旧页面没有新增/删除/导出/刷新缓存入口（对应按钮全部注释掉），那几条端点不登记。
  { path: 'poc/system/config/page', desc: '参数设置分页 → POST /api/poc/system/config/page（body: pageNo/pageSize/configKey/configName）', impl: true, live: true },
  { path: 'poc/system/config/detail', desc: '参数设置详情 → GET /api/poc/system/config/{configId}（id 走路径段）', impl: true, live: true },
  { path: 'poc/system/config', desc: '参数设置修改 → POST /api/poc/system/config（body 带 id 的整表单；该端点亦可新增，但旧页面没有新增入口）', danger: true, impl: true, live: true },
  // 页面配置：分页 + batch（body 是 {content} **对象数组**）+ update + status（**body** 传参，同 word-segment-config）。
  // 没有单条新增与 copy —— 旧弹窗 add 分支已注释、旧列表无入口，新增一律走 batch（见 api/templateConfig.ts 的 pageConfigApi）。
  { path: 'poc/system/page-config/page', desc: '页面配置分页 → POST /api/poc/system/page-config/page（body: pageNo/pageSize/name/status/type，name/type 旧页面已注释但参数照发空串）', impl: true, live: true },
  { path: 'poc/system/page-config/batch', desc: '页面配置批量新增 → POST /api/poc/system/page-config/batch（body 是 {content} **对象数组**）', danger: true, impl: true, live: true },
  { path: 'poc/system/page-config/update', desc: '页面配置修改 → POST /api/poc/system/page-config/update（body 带 id）', danger: true, impl: true, live: true },
  { path: 'poc/system/page-config/status', desc: '页面配置启停 → POST /api/poc/system/page-config/status（body: id/status，0 启用 / 1 禁用）', danger: true, impl: true, live: true },

  /* ── entry 实体数据（收录 12，见「单表数据查看迁移」方案 §1.1 的 16 个旧端点核对） ── */
  { path: 'entry/entryDataPaged', desc: '实体数据分页', live: true },
  { path: 'entry/queryEntryType', desc: '实体数据动态表结构', live: true },
  { path: 'entry/entryDetail', desc: '实体数据详情', live: true },
  { path: 'entry/entryDistinctSource', desc: '实体数据按源去重', live: true },
  // 0812 已在 118.25.96.217 以当前表 + 发布时间字段验证真实请求；空结果属于正常响应。
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
  // 按 sourceId 查（原有用法）：`svg=true` 时列表首位会多出一条 itemConfig=0 的行。
  // 2026-09-02 逐字段对比 3 个不同源实测确认：**这行不是 cs_item_config 里的真实记录**（没有
  // itemId，真子步骤都有）——是接口拿"当前查的这个源自己的 configId"对应的 cs_config 记录，
  // 现算拼出来的：configId/mainConfig/flowCode/outEntry 这些字段在不同源之间完全相同，只有
  // name/url/sourceId 跟着传入的 sourceId 变（就是源名、源 URL）。以前在这套代码里管它叫
  // "主配置行"是不准确的措辞——它从来不是一份配置，也不是流程级的东西，本质是"该源自己的
  // configId 记录套壳成 itemConfig=0"，天然依赖"查的是哪个源"才算得出来。
  // 画布节点数 = 这一行 1 个 + 子步骤 N 个，即不带 svg 时的 count + 1
  // （实测源 430022404：stepCnt=1 → svg 模式 count=2）。
  //
  // ⚠️ 上一段结尾原来写的"画布节点数 = 不带 svg 时的 count + 1"**是错的**，2026-09-04 实测推翻，
  // 见下面「svg 会筛行」。
  //
  // 按 flowId 查（2026-09-04 重新实测，**推翻 09-02 的结论**）：
  // 09-02 这里写的是"恒不返回起点那一行，svg 参数在 flowId 模式下不生效"。**两句都不成立。**
  // `flowId=F&svg=true` 会返回一条 **`isRoot: 1` 的真实 cs_item_config 行**——这就是
  // `flow_api.md` 说的 saveFlow 自动建的那条根节点。实测 5 个流程（1400330/1400935/1400977/
  // 1400979/1400984）**每个都恰好有 1 条**。它的形状：
  //   itemConfig=41352(真实ID) / isRoot=1 / itemId=null / sourceId=null / lastStep=null
  //   / name=配置名 / configId=mainConfig=flowId / type='entry' / flowCode='WEB_SNATCH' / outEntry=900
  //
  // **它和 sourceId 模式那行 itemConfig=0 不是同一条记录，但占同一个位置**：对同一个流程
  // 1400935，两种查法的子节点完全相同（40597/40598/40620），差别只在起点长什么样、以及
  // 子节点的 lastStep 指向谁——
  //   sourceId=430016824&svg=true → 起点 itemConfig=0（现算套壳，带源名/源URL），40597.lastStep='0'
  //   flowId=1400935&svg=true     → 起点 itemConfig=41352（真实行，带流程名），40597.lastStep='41352'
  // 即 **`lastStep='0'` 是"挂在根上"的哨兵值**，flowId 模式下后端把它改写成真实根节点 ID。
  //
  // **`svg=true` 还会筛掉行，不只是加一行。** 流程 1400935：不带 svg 返回 6 条
  // （40589/40596/40597/40598/40599/40620），带 svg 只剩 40597/40598/40620 + 根。被筛掉的是
  // 另外两条 lastStep='0' 的（40589/40596，同一个根位置上的重复起点）和 40599（configId 与
  // lastStep 都跟 40598 相同的重复分支）。**画布看到的是后端整理过的单一连通拓扑，不是全量。**
  // 要"这个流程/源底下到底有哪些行"必须不带 svg 查。
  //
  // **sourceId 不带 svg 查到的又是另一个集合**：源 430016824 返回 5 条 SOURCE_ID=430016824 的
  // 步骤（mainConfig=1400278/1400982），跟流程 1400935 的步骤零交集，画布上永远看不见。
  // 这批是 09-03 修 mainConfig 兜底之前建的规则节点留下的（见 useStepWrite.ts 的 mainConfig 注释）。
  //
  // 多源会不会把子步骤重复返回这个疑问已排除：子步骤挂在 mainConfig（=configId=flowId）上、
  // sourceId 恒为 -1，跟这个流程挂几个源无关。
  // flowId===configId 对全部 735 条存量流程恒成立。FlowCenter/FlowDetailDrawer.vue 的
  // deriveFromFlowConfig（还原历史流程画布）直接查流程自己的 config/configDetail(flowId) 拼起点，
  // 不走 sourcePaged/sourceSteps 两跳，也不依赖任何具体的关联源。
  { path: 'item/next/nextConfigPaged', desc: '子步骤分页 / 流程图读取（按 sourceId 或 flowId；svg=true 既加起点行也筛重复行，两种模式的起点不是同一条记录，见上方注释）', impl: true, live: true },
  { path: 'item/next/configs/same', desc: '同资源配置（选择已有配置的候选来源，list1 同域 / list2 其它域）', impl: true, live: true },
  // 2026-08-31 联调：画布节点名 / 进入条件 / 增删节点走这 4 条，不走配置。
  // payload 已按 2026-08-26 源 430016398 / itemConfig 40600 实测对过；标 live 后日常 mock 模式也会打真实后端。
  { path: 'item/next/saveItemConfig', desc: '新增子步骤（POST query，不是 JSON body）', danger: true, live: true },
  { path: 'item/next/stepModify', desc: '修改子步骤（节点名 / 进入条件 / lastStep；JSON body）', danger: true, live: true },
  { path: 'item/next/enable', desc: '启停子步骤（GET ?id=&state=；0 启用 / 1 停用）', danger: true, live: true },
  { path: 'item/next/delete', desc: '删除子步骤（GET ?id=itemConfig）', danger: true, live: true },
  // 2026-10-10 流程版本（217 旧平台 src/api/flow.js 同款）：v1 已发布只读，改步骤先建草稿；
  // 草稿里 saveItemConfig / stepModify / delete / enable 额外带 flowId + versionId + ver（乐观锁，版本行计数）
  { path: 'flow/version/overview', desc: '流程版本概览（enabled / publishId / draftId / versions[versionId, flowVer, ver, state W/C, isLock, baseId]）', impl: true, live: true },
  { path: 'flow/version/nodes', desc: '某个版本的步骤（GET flowId + versionId；草稿里步骤 itemConfig 与发布版相同）', impl: true, live: true },
  { path: 'flow/version/draft', desc: '从当前发布版建草稿（body flowId / versionId / ver / expectedPublishId，回 data.versionId）', danger: true, live: true },
  { path: 'flow/version/publish', desc: '发布草稿（新任务用新版本，已启动任务用原版本）', danger: true, live: true },
  { path: 'flow/version/abandon', desc: '放弃草稿（不占发布版本号）', danger: true, live: true },

  /* ── job 抓取/定时任务（目标 7 / 收录 7） ── */
  // 2026-09-18 接上：源的**定时任务**就存在这儿（旧平台「定时列表」页同款接口）。
  // 此前节点配置的「定时策略」只认 source/config 上的字段，而那边实测恒为 null
  // （抽查 20 个源全空），真正的 cron 在 job 表里——源 430016942 → `0 0 16 * * ?`。
  { path: 'job/snatchJobPaged', desc: '源的定时任务分页（定时列表）', live: true },
  { path: 'job/runJob', desc: '运行任务', danger: true },
  // 2026-09-18 接上：节点配置的定时策略那一栏右上角的开关。与源启停（source/changeEnable）
  // 同性质——可逆、不删数据，所以同样放进生产白名单。
  { path: 'job/enableJob', desc: '启用定时任务', danger: true, live: true },
  { path: 'job/disableJob', desc: '停用定时任务', danger: true, live: true },
  { path: 'job/deleteJob', desc: '删除任务', danger: true },
  { path: 'job/deleteJobs', desc: '批量删除任务', danger: true },
  { path: 'job/updateJob', desc: '改已有定时的 cron（原地改，jobId 不变）', danger: true, live: true },

  /* ── comm-job 通用任务（目标 7 / 收录 7） ── */
  // 2026-10-13 按旧前端 src/api/comm-job.js 校正：
  //   · 原登记的 comm-job/enable 与 comm-job/disable 两条是早期按后缀猜的，真实前端从未调用过；
  //     实际只有**单条** changeEnable（GET ?ids=a,b&enable=0|1，与 source/check、mq/check 同款）。
  //   · comm-job/copy 此前整条缺失（表格行内「复制」用的就是它：POST ?id=xx）。
  //   · copy / run 都是 POST 但参数走 query（旧层写的是 `method:'post', params`），见 api/commJob.ts。
  { path: 'comm-job/paged', desc: '通用任务分页（自定义告警列表）', impl: true, live: true },
  { path: 'comm-job/add', desc: '新增通用任务', danger: true, impl: true, live: true },
  { path: 'comm-job/update', desc: '修改通用任务', danger: true, impl: true, live: true },
  { path: 'comm-job/delete', desc: '删除通用任务', danger: true, impl: true, live: true },
  { path: 'comm-job/changeEnable', desc: '启停通用任务 → GET /v1/comm-job/changeEnable?ids=&enable=', danger: true, impl: true, live: true },
  { path: 'comm-job/copy', desc: '复制通用任务 → POST /v1/comm-job/copy?id=', danger: true, impl: true, live: true },
  { path: 'comm-job/run', desc: '运行通用任务 → POST /v1/comm-job/run?id=', danger: true, impl: true, live: true },
   /* ── task 任务实例（目标 2 / 收录 5：topTaskPaged + taskListPaged 别名 + stat + resetTaskInsts） ── */
  { path: 'task/topTaskPaged', desc: '任务实例分页（运行记录事实源）', impl: true, live: true },
  // 1013：任务实例页（旧 page/inst/TaskInst.vue）专属逻辑名 —— 它要 1:1 渲染旧 column.config 的
  // 原始字段名（actionName/nodeCode/taskTopic/updateDt），而 task/topTaskPaged 那份 mock 返回的是
  // 平台归一化后的 TaskInst（typeName/node/topic/updatedAt），对不上。真实请求仍打
  // httpEndpoint: 'task/topTaskPaged'（上面那条 live 端点），所以这里不标 live——它只是
  // 「逻辑名 + 真实 path」的别名（同 source/sourceTaskPaged 的写法）。
  { path: 'task/taskListPaged', desc: '任务实例分页（任务实例页） → GET /v1/task/topTaskPaged', impl: true },
  // 1013：任务统计页（旧 page/inst/TaskStat.vue）的统计端点。旧 api/task.js 的 taskStat → GET /v1/task/stat
  // （?date=|startTime=&endTime=&group=source|config|both&sourceId=&configId=&state=），
  // 响应是**行数组**（不是分页信封）：{sourceId, configId, cnt, state?}；带 state 的行说明后端支持多状态聚合。
  // 全部队列名（任务中心队列名下拉的候选；后端 2026-10-19 提供，217 实测还是 500 → 调用方失败时退回已加载行累计）
  { path: 'task/taskTopicList', desc: '全部队列名 → GET /v1/task/taskTopicList', impl: true, live: true },
  { path: 'task/stat', desc: '任务统计（按来源/配置分组聚合）', impl: true, live: true },
  // 2026-08-13 测试环境实测放行：E / L 都能重跑、都变 W1、响应无逐条结果、无效 ID 静默忽略、幂等。
  // live-only（同 source/delete 等）：无专属 mock handler，靠真实后端。
  { path: 'task/resetTaskInsts', desc: '重置任务实例', danger: true, live: true },

  /* ── dataset 指标数据集（目标 9 / 收录 10） ── */
  // 1013 迁移「指标数据集」页（旧 page/config/DatasetList.vue）时核对的路径问题：
  // 真实路径是 /v1/dataset/dataSetPaged（**大写 S**，旧前端 src/api/dataset.js:6 就是这么写的），
  // 而下面第一条 dataset/datasetPaged 是本清单早期从逆向文档抄下来的**全小写逻辑名**——它能查表、
  // 能命中 mock，但拿去当 URL 打后端会 404。所以真实分页走 dataset/dataSetPaged 这条（live 标在它上面，
  // usesMockAdapter 按真实 httpEndpoint 查表），逻辑名那条只留给 api/index.ts 的 M4 演示服务。
  // ⚠ 这一页的 7 个写端点（updateDataSet / copy / delete / changeEnable / genFromSource / runNow）
  // 在旧平台本来就是全部直连后端：只放行分页、把写操作留在 mock，会让页面上的按钮看着能用、
  // 其实后端一条都没收到。已按 mq/check、comm-job 的同款口径标 live，并在 client.ts 的
  // PRODUCTION_CREATE_ENDPOINTS 里放行（生产写保护仍会再拦一次）。
  // 未收录 dataset/add：旧页没有任何入口调它（「增加数据集」走的是 genFromSource），保持 danger 记录。
  { path: 'dataset/datasetPaged', desc: '数据集分页（逻辑名，仅 mock；真实路径见 dataset/dataSetPaged）', impl: true },
  { path: 'dataset/dataSetPaged', desc: '数据集分页 → GET /v1/dataset/dataSetPaged（真实路径）', impl: true, live: true },
  { path: 'dataset/add', desc: '新增数据集', danger: true },
  { path: 'dataset/updateDataSet', desc: '修改数据集 → POST body（提交体需剔除 createDt/updateDt/lastRun/nextRun）', danger: true, impl: true, live: true },
  { path: 'dataset/copy', desc: '复制数据集 → GET ?id=&name=&sourceId=', danger: true, impl: true, live: true },
  { path: 'dataset/delete', desc: '删除数据集 → POST ?ids=a,b（参数在 query，不是 body）', danger: true, impl: true, live: true },
  { path: 'dataset/changeEnable', desc: '启停数据集 → GET ?ids=a,b&enable=（同 isDelete：0=在用 / 1=停用）', danger: true, impl: true, live: true },
  { path: 'dataset/genFromSource', desc: '由源快速生成数据集 → GET ?sourceId=&entryTypeId=', danger: true, impl: true, live: true },
  { path: 'dataset/run', desc: '运行数据集', danger: true },
  { path: 'dataset/runNow', desc: '立即执行指标 → GET ?ids=a,b&last= 开始 ID', danger: true, impl: true, live: true },

  /* ── measure 指标定义（目标 8 / 收录 8） ── */
  // 1014 迁移「指标列表」页（旧 page/config/MeasureList.vue）时整体接真实后端：这一页在旧平台
  // 分页 / 新增 / 修改 / 复制 / 批量启停 / 批量删除 / 物理删除**本来就全部直连后端**，
  // 只放行分页会把写操作留在 mock，页面按钮看着能用、后端一条都收不到。
  // ① 逻辑名与真实路径同名（旧 URL 就是 /v1/measure/measurePaged），不存在 dataset 那种大小写别名；
  // ② 原注册在这条上的 mockMeasures（M4 演示形状，字段名是 name/caliber/cycle）已下线——
  //    新 handler 是 mock/measure.ts 的 mockMeasurePaged，按旧平台字段名（measureCode/measureName/...）分页；
  // ③ measure/stats（M4 KPI）保持 impl 未 live，它只服务 api/index.ts 里那套已无消费方的演示服务。
  { path: 'measure/measurePaged', desc: '指标分页 → GET /v1/measure/measurePaged', impl: true, live: true },
  { path: 'measure/add', desc: '新增指标 → POST body（提交体需剔除 updateDt）', danger: true, impl: true, live: true },
  { path: 'measure/update', desc: '修改指标 → POST body', danger: true, impl: true, live: true },
  { path: 'measure/copy', desc: '复制指标 → GET ?id=&name=&sourceId=', danger: true, impl: true, live: true },
  { path: 'measure/delete', desc: '批量删除指标 → POST ?ids=a,b（参数在 query，不是 body）', danger: true, impl: true, live: true },
  { path: 'measure/changeEnable', desc: '启停指标 → GET ?ids=a,b&enable=（同 isDelete：0=在用 / 1=停用）', danger: true, impl: true, live: true },
  { path: 'measure/genMeasureFromSource', desc: '由源生成指标 → GET ?sourceId=&entryTypeId=（旧 MeasureList 无入口，契约先接上）', danger: true, impl: true, live: true },
  { path: 'measure/deleteMeasurePhy', desc: '物理删除单条指标 → POST ?id=单个（无法恢复）', danger: true, impl: true, live: true },

  /* ── mq 消息队列（目标 9 / 收录 9） ── */
  { path: 'mq/queuePaged', desc: '队列列表', impl: true },
  { path: 'mq/queueDetail2', desc: '队列详情' },
  { path: 'mq/message', desc: '获取消息' },
  { path: 'mq/purgeQueue', desc: '清空队列', danger: true },
  // 队列告警（队列校验配置）。1013 从旧平台 page/config/QueueCheck.vue 迁入；这一页在旧平台
  // 的分页 / 新增 / 编辑 / 批量启停 / 批量删除**本来就全部直连后端**，所以这 5 条一起标 live：
  // 只放行分页、把写操作留在 mock，会让页面上的按钮看着能用、其实后端一条都没收到。
  // 契约照旧平台 api/queue-check.js：paged 用 page/limit；delete 的 ids 在 query（POST 无 body）；
  // changeEnable 是 GET ?ids=&enable=，且 **enable 与 isDelete 同向（0=在用 / 1=停用）**。
  // ⚠️ 放行 ≠ 已联调，生产上写类端点仍会被 client.ts 的写保护白名单拦一次。
  { path: 'mq/check/paged', desc: '队列校验配置列表 → GET ?queue=&queueId=&name=&enable=&page=&limit=', impl: true, live: true },
  { path: 'mq/check/add', desc: '新增队列校验配置 → POST body', danger: true, impl: true, live: true },
  { path: 'mq/check/update', desc: '修改队列校验配置 → POST body（提交体需剔除 createDt/updateDt/lastRun/nextRun）', danger: true, impl: true, live: true },
  { path: 'mq/check/delete', desc: '删除队列校验配置 → POST ?ids=a,b（参数在 query，不是 body）', danger: true, impl: true, live: true },
  { path: 'mq/check/changeEnable', desc: '启停队列校验配置 → GET ?ids=&enable=（0=启用/1=停用，与 isDelete 同向）', danger: true, impl: true, live: true },

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
  // 2026-09-10：规则脚本工作区「保存脚本」对接，POST /api/file/upload，
  // JSON body={"fileId":"<脚本路径>","body":"<脚本内容>"}。
  { path: 'file/upload', desc: '上传/保存脚本文件（POST /api/file/upload，JSON body=fileId + 内容）', danger: true, impl: true, live: true },
  // 2026-09-07：规则脚本工作区结果框按 fileId 拉脚本正文。
  { path: 'file/download', desc: '下载脚本文件正文（GET /api/file/download?fileId=路径）', impl: true, live: true },

  /* ── flow 自造逻辑端点（只剩推荐与节点 AI 两条） ── */
  // flow-template/list|detail|save 那套 localStorage 兼容存储（mockFlowTemplateList/Detail/Save）
  // 已删除：2026-09-02 接了真实 cs_flow 后 flowCenterApi 全面改走 flow/flowPaged 等真实端点，
  // flow-template/* 从那时起就没有任何调用方了。
  //
  // flow/save|load|list|templateCode 这四条 2026-09-03（Y0-7）一并删除：它们是更早的自造逻辑名，
  // 跟下面 cs_flow 真实端点里的 flow/saveFlow 等不是一回事，且 grep 确认已无任何调用方
  // （flowApi.flowSave/flowLoad/flowList 三个门面方法同批删除）。
  // 注意 mock 层的 mockFlowSave/mockFlowLoad **函数本体保留**——api/mock/sites.ts 的建站/克隆
  // 逻辑内部还在直接调它们，只是不再作为端点对外注册。
  { path: 'flow/recommend', desc: '流程模板推荐（mock 意图匹配 / 二期 LLM 推荐）', impl: true },
  { path: 'flow/nodeAiChat', desc: '节点级 AI 对话（mock 关键词回复 / 二期 LLM，0701 问题八）', impl: true },

  /* ── flow 真实流程表 cs_flow（2026-09-02 接入，路径照抄旧平台 src/api/flow.js） ── */
  // 真实后端共九条，其中 flowList / updateFlowConf 两条 2026-09-02 联调后确认代码里没有任何
  // 调用方（当时 flowCenterApi.list() 是拿 paged() 拼的；updateFlowConf 这种"只改 flowConf"的专用
  // 端点从没被走过，保存永远用全量的 saveFlow）——已删除注册，生产写白名单里配套的两条也一并
  // 删了（见 client.ts 同一次改动）。changeFlowEnable 2026-09-29 F6 按 flowPaged/saveFlow 的
  // 样子加回来了（流程中心行内启停），见下面登记行。
  // flowList 2026-10-13 加回：flowPaged 拉 500 条在 186 要 ~30s、超前端 20s 超时，下拉候选被 catch 成空
  // （源流程配置抽屉「无数据」）；旧平台下拉本来就走 flowList，flowCenterApi.list() 改回它。
  { path: 'flow/flowList', desc: '有效流程列表（下拉/选择器用：全量、不分页、不含 flowConf；旧平台 FlowIdSelect / SourceList / SourceGroupModal 同款；186 实测 759 条 ~0.1s）', live: true },
  { path: 'flow/flowPaged', desc: '流程分页 + 多条件检索（不含 flowConf，含计算列 sourceCnt；templateFlag=0/1 服务端过滤模板，2026-09-04 实测生效）', live: true },
  { path: 'flow/flowSources', desc: '本地流程反查关联源（仅启用流程分流时调用）', live: true },
  { path: 'flow/flowDetail', desc: '流程详情（含 flowConf 大字段与 sourceCnt）', live: true },
  { path: 'flow/saveFlow', desc: '新增 / 修改流程（不带 flowId = 新增）；update 分支不校验 state=D，前端保存后回查详情兜底（0929 F8）', danger: true, live: true },
  { path: 'flow/deleteFlow', desc: '批量删除流程（逻辑删除 is_delete=-1 + state=D；有源挂载即拒绝，前端先换绑/解绑再删，0929 F1）', danger: true, live: true },
  { path: 'flow/changeFlowEnable', desc: '批量启停流程（GET ids 逗号串 + enable 0=启用/1=禁用，置 cs_flow.IS_DELETE，排除 state=D）——0929 F6 重新注册，流程中心行内启停', live: true },
  // 绑定源到流程。写的是 **cs_source.FLOW_ID**（存量生产表），不是 cs_flow，单次上限 5000。
  { path: 'flow/changeFlowBatch', desc: '批量关联 / 解绑源到流程（Body 版；flowId=0 为解绑）', danger: true, live: true },
  // 0903 Y8：后端把"复制"这件重活做掉了，前端不再自己逐个 saveItemConfig 建节点。
  // 2026-09-04 探活确认三条都在（GET 探测答 "Request method 'GET' not supported" = 端点存在但仅 POST；
  // flowTemplateList 走 GET）。0925 REVIEW 核对 bee-top：flowTemplateList 返回 templateFlag=1
  // 且 is_delete=0、state≠D 的全量模板（不分页、不含 flowConf），不再是「空数组」。
  { path: 'flow/copyFlow', desc: '复制流程（连 cs_item_config 步骤一起复制并重映射上下游；源是模板时新流程 refFlowId 回指模板；不复制根节点，后端自动建；回执 msg=「复制成功，新流程ID:N」；0927 P2-2：data 为标量新 ID 但 client 按标量字段丢弃，新流程 ID 只从 msg 解析）', danger: true, live: true },
  { path: 'flow/copyTemplateSteps', desc: '把模板下的普通步骤复制到目标流程（自动改 FLOW_ID、重映射上下游、根节点依赖保持 0、不复制模板自身根节点）', danger: true, live: true },
  { path: 'flow/flowTemplateList', desc: '流程模板下拉候选（templateFlag=1 全量、不分页、不含 flowConf；等价于 flowPaged + onlyTemplate 但不分页）', live: true },
  // 一个源可关联多条流程，有一条默认流程（来源组接口文档，bee-config SourceGroupController，2026-10-08 上线 217）。
  // 入组的源统一使用组的流程，不能单独改绑。10-09 起画布流程标签栏接 sourceFlows/bindSourceFlows；
  // 10-12 起来源组本身的增删改查与成员/绑定管理（1008-02/03/04）用下面这 14 条。
  { path: 'source-group/list', desc: '来源组列表（不分页）', live: true },
  { path: 'source-group/detail', desc: '来源组详情（含 flowIds/revision）', live: true },
  { path: 'source-group/members', desc: '来源组成员分页（无 total，前端请求 limit+1 条判下一页）', live: true },
  { path: 'source-group/add', desc: '新建来源组（admin）', danger: true, live: true },
  { path: 'source-group/update', desc: '修改来源组（admin；必须带编辑前 revision）', danger: true, live: true },
  { path: 'source-group/delete', desc: '删除来源组（admin；必须带编辑前 revision）', danger: true, live: true },
  { path: 'source-group/changeMembers', desc: '按源 ID 列表调整组成员（target/expected 为 null 时 JSON 必须显式写 null；target=-1 退组）', danger: true, live: true },
  { path: 'source-group/changeMembersByRange', desc: '按筛选范围批量调整组成员（参数全在 query；target=-1 退组；无范围条件必须 confirmAll=true）', danger: true, live: true },
  { path: 'source-group/bindFlows', desc: '来源组整体绑定流程（admin；带 revision 并发快照）', danger: true, live: true },
  { path: 'source-group/bindings', desc: '来源（或来源组）的流程绑定行（含停用行）', live: true },
  { path: 'source-group/updateBindingState', desc: '启用/停用一条流程绑定（admin；回传 id/sourceId/sourceGroupId/flowId/revision）', danger: true, live: true },
  { path: 'source-group/flowIds', desc: '来源列表当前生效流程并集（GET sourceIds 逗号串；上限 5000，超过分片）', live: true },
  // 源管理「我的视图」（2026-10-12 开发环境 124.223.180.186 联调通过，217 / 133 还没部署）。userId 取自会话，只能读写自己的视图；
  // queryJson / displayJson 必须是 JSON 字符串；revision 从 0 起。前端按调用强制走真实（mode: 'http'）并在接口不存在时退回本机，
  // 所以这里不标 live：标了就会在所有环境强制走真实，217 / 133 上整页报错。
  { path: 'source-view/list', desc: '当前用户的全部视图（不分页，按 sortNo）' },
  { path: 'source-view/add', desc: '新建视图（viewName 1–40 字同用户不重名；queryJson / displayJson 为 JSON 字符串；isDefault=1 会取消其它视图的默认）' },
  { path: 'source-view/update', desc: '保存 / 重命名 / 设为默认（带编辑前 revision，不一致报「视图已变化」，只改传了的字段）' },
  { path: 'source-view/delete', desc: '删除视图（软删，带 revision）' },
  { path: 'source-view/sort', desc: '调整左侧顺序（viewIds[]）；前端暂未用' },
  { path: 'source-group/sourceFlows', desc: '来源（或来源组）的流程绑定：生效列表、默认流程、原始绑定行；入组的源自动跟随其组', live: true },
  { path: 'source-group/bindSourceFlows', desc: '来源独立流程整体保存（admin；带并发快照，入组的源会被后端拒绝）', danger: true, live: true },
  // 只登记不接：旧平台「生成配置」入口，本平台没有对应场景（Y8-16）。
  { path: 'source/genConfig', desc: '旧平台「生成配置」（SourceList.vue 的行操作）；本平台无调用方，仅登记备查' },

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
  // orchestrationTest 等其它 vrule 端点同样重复）。可以给 ENDPOINTS 表加一个
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
  { path: 'rule/dataProcessGenerate', desc: '规则处理生成脚本 → /api/answer/data-process', impl: true, live: true },
  // 1005：PDF 抓取节点编排配置的「解析内容」——上传样本 PDF + 当前提示词，流式回抽取正文。
  // 与 data-process 的关键区别是**无任何落库/落盘副作用**，且附件白名单只有 pdf（data-process 仍只吃 xls/xlsx）。
  // 2026-10-05 后端已落地并本地联调通过（中文 PDF → PDFBox 取文 → DeepSeek 流式抽取 → done 带 charCount/truncated），
  // 转发链见 §6.6：vite 代理与 nginx 各有独立的 /api/answer/document-extract 条目。
  { path: 'rule/documentExtract', desc: 'PDF 样本按提示词解析 → /api/answer/document-extract', impl: true, live: true },
  { path: 'rule/executeCode', desc: '执行脚本 → /vrule/fastapi/execute/code', impl: true, live: true },
  // generate 已接真实流式（form-urlencoded）；需数字 ruleId（由 saveMeta live 提供）
  { path: 'rule/orchestrationGenerate', desc: '规则编排生成脚本 → /vrule/ai/dashscope/stream', impl: true, live: true },
  { path: 'rule/orchestrationTest', desc: '规则编排测试脚本 → /vrule/fastapi/execute/dynamic', impl: true, live: true },
  // ck_source 监控源配置（vanv-data-engine SourceController，2026-09-05）：数据监控节点保存时
  // 按 sourceId 查存在性，无则 insert、有则 update。走 /api/source 代理（同 data-process 8080 服务）。
  { path: 'monitor/ckSourceList', desc: '监控源配置查询 → /api/source/list', impl: true, live: true },
  { path: 'monitor/ckSourceInsert', desc: '监控源配置新增 → /api/source/insert', impl: true, live: true },
  { path: 'monitor/ckSourceUpdate', desc: '监控源配置更新 → /api/source/update', impl: true, live: true },
  // 2026-09-18：ck_source 分页查询（/api/source/page，list 的分页版），监控配置 Tab 列表用
  { path: 'monitor/ckSourcePage', desc: '监控源配置分页查询 → /api/source/page', impl: true, live: true },
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
  // 批量版 bindSite（0812 计划 M4-5）；2026-08-15 生产实测契约（Q4：无效 ID 静默跳过，不是整批失败）。
  // 2026-09-01：侧栏「导入已有源 / 更换网站」每天都在调，不标 live 等于界面骗人；UI 已有二次确认。
  { path: 'source/changeSite', desc: '批量关联/变更源所属网站', danger: true, impl: true, live: true },
  { path: 'site/siteDetail', desc: '网站详情', impl: true },
  { path: 'site/createSite', desc: '新建采集：网站 + 首批源', impl: true },
  // 真实路径是 /v1/site/update（POST，body 为 cfg_site 实体），见旧前端 src/api/site.js:95。
  // live 必须标在下面 site/update 这一条上，不是这条逻辑名——usesMockAdapter 按真实 httpEndpoint
  // 查表（client.ts:181）。2026-08-27 曾把 live 标在这里，导致改网站名称表面接了真实接口，实际
  // 仍悄悄落回 mock（mockSiteUpdate 还是旧的 category/owner 必填形状，传新形状直接 `.trim()` 报错）。
  { path: 'site/updateSite', desc: '编辑网站基本信息 → POST /v1/site/update', danger: true, impl: true },
  { path: 'site/update', desc: '编辑网站基本信息（真实路径，见上方 site/updateSite 的说明）', danger: true, live: true },
  // 1014：删除网站（旧平台 SiteList 同款，GET /v1/site/delete?siteId=，逻辑删除 is_delete=1）。
  // 后端 SiteController.delete 会校验网站下的源数量（countBySiteId），调用方先二次确认。
  { path: 'site/delete', desc: '删除网站 → GET /v1/site/delete?siteId=', danger: true, live: true },
  // 0915-14：后端 2026-09-16 交付的网站标签两件套——本条给候选清单，筛选走 sitePaged 的 tags 入参。
  // 返回的是**拆分去重后的数组**（如 ["服务","测试"]），不是各站原始的分号串。
  { path: 'site/siteTags', desc: '全局已用网站标签（候选清单）', live: true },
  // 0918-01：**清空网站标签的唯一办法**。site/update 传空串清不掉（后端按"非空才写"跳过，
  // 回执还报"更新成功"），2026-09-18 在站 10 原样复现过；这条传空串能真清掉（回查 tags: null）。
  // 语义实测：**覆盖式**（打 `丙;丁` 后再打 `戊`，结果只剩 `戊`，不是追加）；
  // 中文分号后端会归一化（传 `己；庚` 存成 `己;庚`）；收 ids 数组，天然支持批量。
  { path: 'site/batchChangeTags', desc: '批量改网站标签（覆盖式，传空串=清空）', danger: true, live: true },
  // 用户收藏（后端 2026-09-23，favorite-api.md；B30）。userId 取自会话，不由前端传。
  // 只用 list / add / remove：网站列表要「收藏置顶 + 只看收藏」，需要全部收藏 ID，按页查的 states 用不上。
  { path: 'favorite/list', desc: '当前用户收藏列表（按 itemType，limit ≤ 500）', live: true },
  // 1019 通用埋点（LogReportController，接口见 `接口文档-通用埋点.md`）。
  // ⚠️ 这三条**绝不能标 danger**：client.ts 的生产写守卫只认 DANGER_ENDPOINTS，
  //    标了 danger 生产环境埋点会被当作高危写直接拦掉，一条都报不上去。
  //     另：`report`/`recent` 是 RspResult（code 字符串、判 success），`page` 是 Paged（code 数字）。
  { path: 'log-report/report', desc: '通用埋点上报（ENTER/EXIT/CLICK/EDIT/CREATE/DELETE/SEARCH）→ POST body', impl: true, live: true },
  { path: 'log-report/recent', desc: '最近列表（按 contentId 去重、时间倒序；action 默认 ENTER，limit ≤ 100）', impl: true, live: true },
  { path: 'log-report/page', desc: '埋点行为明细分页（Paged：code 数字，参数非法返回 1）', impl: true, live: true },
  { path: 'favorite/add', desc: '收藏（幂等）', live: true },
  { path: 'favorite/remove', desc: '取消收藏（幂等）', live: true },
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
