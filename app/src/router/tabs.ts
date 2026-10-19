// 首页 + 8 个业务模块元数据 — 路由与独立系统导航共用，口径同《采集配置中心_开发方案.md》信息架构。
export interface TabMeta {
  key: string
  path: string
  label: string
  desc: string
  group: 'home' | 'workbench' | 'assets' | 'ops' | 'tools' | 'intelligence' | 'template' | 'settings' | 'config'
  /** 菜单权限码（0924-02）。侧栏与路由守卫都经 canAccess() 判断；不声明 = 放行 */
  permission?: string
}

export const TABS: TabMeta[] = [
  { key: 'overview', path: '/overview', label: '采集资产总览', desc: 'KPI、采集生态、趋势、占比、异常下钻', group: 'home' },
  { key: 'collect', path: '/collect', label: '源管理', desc: '系统目录、个人源分组、源批量操作', group: 'assets' },
  { key: 'flows', path: '/flows', label: '流程中心', desc: '流程、节点与配置、使用范围反查', group: 'config' },
  { key: 'rules', path: '/rules', label: '规则资产', desc: '规则组、表达式、测试集、发布门禁、参数', group: 'config' },
  { key: 'metrics', path: '/metrics', label: '指标中心', desc: '指标数据集、指标定义、口径维护', group: 'config' },
  { key: 'data', path: '/data', label: '数据中心', desc: '实体数据、原始文件、表结构', group: 'ops' },
  { key: 'files', path: '/files', label: '文件中心', desc: '默认全平台，可按网站、源查询文件资源', group: 'ops' },
  // 流程中心（0828 W6-1）：Flow 是与源/规则/指标并列的一类资产，且被多个源复用——
  // 塞进采集资产的 tab 会暗示它从属于某个源，所以提为一级入口。
  // 1003：流程中心与规则、指标归入「流程与规则」，数据中心独立于源工作区。
  // key 必须等于 path 的第一段：useActiveNavKey 按路由段查 TABS，查不到会**静默回退到 TABS[0]**。
  // 2026-09-02 这条曾写成单数 'flow'（path 是 /flows），结果流程中心的面包屑一直显示
  // 「采集资产总览」——不报错，只是显示成了另一个模块。tabs.test.ts 有一条用例锁死这个约定。
  { key: 'tasks', path: '/tasks', label: '任务中心', desc: '全局任务查询、详情与重发', group: 'tools' },
  { key: 'sync', path: '/sync', label: '数据同步', desc: '将现有数据表同步到目标环境', group: 'tools' },
  { key: 'monitor', path: '/monitor', label: '监控中心', desc: '系统健康、MQ、同步状态、告警', group: 'tools' },
  // 问数配置 → 基础配置（1015 迁入，旧 ai-chat-view「基础配置」组 /demo/entity-build + /demo/vector-data）：
  // 侧栏排在「模板配置」之前，子模块（表字段管理、向量表数据浏览、选表规则配置、向量表管理、表改写管理、实体改写管理）在页内以 tab 呈现（见 BASE_CONFIG_TABS 与 views/TemplateConfig/BaseConfig/index.vue）。
  { key: 'base-config', path: '/base-config', label: '基础配置', desc: '表字段管理、向量表数据浏览、选表规则配置、向量表管理、表改写管理、实体改写管理（旧 ai-chat-view「基础配置」域）', group: 'template' },
  // 问数配置 → 模板配置（1014 起从旧 ai-chat-view「模板配置」域迁入的 8 个子模块，1014 迁完）。
  // 侧栏只放这一个入口，8 个子模块在页内以 tab 呈现（见 TemplateConfigTabMeta 与 views/TemplateConfig/index.vue）。
  { key: 'template-config', path: '/template-config', label: '模板配置', desc: 'SQL / 表 / 自动补全 / 问句改写 / 数据索引 / 数据字典 / 提示词 / 分词 八类问数模板配置', group: 'template' },
  // 问数系统配置（1015 迁入）：旧 ai-chat-view「系统配置」组（/config 参数设置 + /page-config 页面配置），
  // 旧平台是两个独立路由页，这里与模板配置同口径收成侧栏一个入口 + 页内两个 tab（默认参数设置）。
  { key: 'system-config', path: '/system-config', label: '问数系统配置', desc: '参数设置、页面配置（旧 ai-chat-view「系统配置」域）', group: 'template' },
  // 系统设置（0924-02）：节点类型（旧平台「源类型」）+ 分类目录（原挂在采集资产的分类下拉底部）。
  // 这是第一个声明了 permission 的入口，给后续人员菜单权限留口子（见 composables/usePermission）。
  { key: 'settings', path: '/settings', label: '系统设置', desc: '节点类型、分类目录、运行机器、代码仓库、部署目录、机器配置、Runner 版本、数据权限设置', group: 'settings', permission: 'settings' },
]

/**
 * 模板配置页内的 8 个子模块（1013 起从旧 ai-chat-view「模板配置」域逐个迁入）。
 * 不进 TABS——侧栏只到「模板配置」这一层，子模块以 tab 呈现（口径同「全局数据 → 数据中心」）。
 * key 就是 URL 上的 ?tab= 值，同时是权限码，与旧侧栏各项一一对应。
 * 接口共用 api/templateConfig.ts 的 CRUD 工厂；
 * 列表页只有「简单字段」的模块才复用 components/templateConfig 的 schema 层，
 * 带远程多选 / 多条件查询的（如表模板、数据字典）在自己的目录里实现。
 */
export interface TemplateConfigTabMeta {
  key: string
  label: string
  desc: string
  permission: string
}

export const TEMPLATE_CONFIG_TABS: TemplateConfigTabMeta[] = [
  { key: 'sql-template', label: 'SQL模板配置', desc: '', permission: 'sql-template' },
  { key: 'table-template', label: '表模板配置', desc: '', permission: 'table-template' },
  { key: 'dic-template', label: '自动补全配置', desc: '', permission: 'dic-template' },
  // ⚠️ question-dic（问句改写）与上面的 table-template（端点域 question-temp）是两个不同模块，名字像不是一个东西。
  { key: 'question-dic', label: '问句改写配置', desc: '', permission: 'question-dic' },
  // ⚠️ 与运行与监控组的 /sync（采集数据同步到目标环境）不是一回事，这一条是旧「数据索引同步」的索引配置。
  { key: 'data-index-sync', label: '数据索引同步', desc: '', permission: 'data-index-sync' },
  // ⚠️ 数据字典配置在旧平台的组件名是 DataIndexList（端点域 data-index-config），与上面的数据索引同步是两个模块。
  { key: 'data-index-config', label: '数据字典配置', desc: '', permission: 'data-index-config' },
  // ⚠️ 提示词配置的标题与端点名不一致：旧路由 /demo/chat-flow-step-list、端点域 /poc/chat-flow-step，
  // 字段全是对话流程步骤口径（步骤编码/流程编码/下一步编码）。key 按端点域取 chat-flow-step，
  // 与 table-template（端点域 question-temp）那种「按菜单取名」不同，是为了避开与 api/prompt.ts（流程画布的提示词）混淆。
  { key: 'chat-flow-step', label: '提示词配置', desc: '', permission: 'chat-flow-step' },
  // 分词配置（1014 迁入，模板域最后一个子模块）：一条 = 分词词典里的一个词条，「数据索引同步」的分词同步往里灌数据。
  // 旧列表没有单条新增入口，新增走批量端点（一行「类型,内容,分词类型」）。
  { key: 'word-segment-config', label: '分词配置', desc: '', permission: 'word-segment-config' },
]

/**
 * 问数系统配置页内的 2 个子模块（1015 从旧 ai-chat-view「系统配置」组迁入）。
 * 口径同 TEMPLATE_CONFIG_TABS：不进 TABS、侧栏只到「问数系统配置」一个入口，子模块以页内 tab 呈现
 * （容器见 views/TemplateConfig/SystemConfig/index.vue）。
 * ⚠️ 顺序即默认：第一项「参数设置」是无 ?tab= 时落地的默认 tab（旧平台 /config 与 /page-config 两个
 * 侧栏子项收成这里，需求明确默认进参数设置）。
 * key 与端点域对应：param-config → /poc/system/config（旧菜单「参数设置」），page-config → /poc/system/page-config。
 */
export const SYSTEM_CONFIG_TABS: TemplateConfigTabMeta[] = [
  { key: 'param-config', label: '参数设置', desc: '', permission: 'param-config' },
  { key: 'page-config', label: '页面配置', desc: '', permission: 'page-config' },
]

/**
 * 基础配置页内的子模块（1015 从旧 ai-chat-view「基础配置」组迁入，落在问数配置组「模板配置」之前）。
 * 口径同 TEMPLATE_CONFIG_TABS / SYSTEM_CONFIG_TABS：不进 TABS、侧栏只到「基础配置」一个入口，子模块以页内 tab 呈现
 * （容器见 views/TemplateConfig/BaseConfig/index.vue）。
 * key 与端点域对应：entity-config → /poc/database/*（旧路由 /demo/entity-build，表头 entityType + 字段 entityItems 整表保存）；
 * vector-data → /poc/vector/*（旧路由 /demo/vector-data，只读浏览）；
 * match-table-config → /poc/match-table-config/*（旧路由 /demo/match-table-config-list，一条规则 = 一张表的选表方式）；
 * vector-config → /poc/vector/config*（旧路由 /config/vector-list，向量表管理：配置 + 列映射 + 同步/删除）；
 * replace-table-config → /poc/replace-table-config/*（旧路由 /demo/replace-table-config-list，一条 = 一张表整体换成另一张表）；
 * entity-rewrite-config → /poc/entity-rewrite-config/*（旧路由 /demo/entity-rewrite-config-list，一条 = 一个实体词的改写规则）。
 * 顺序照旧侧栏（表字段管理 → 向量表数据浏览 → 选表规则配置 → 向量表管理 → 表改写管理 → 实体改写管理），BASE_CONFIG_TABS[0] 是无 ?tab= 时的默认。
 */
export const BASE_CONFIG_TABS: TemplateConfigTabMeta[] = [
  { key: 'entity-config', label: '表字段管理', desc: '', permission: 'entity-config' },
  { key: 'vector-data', label: '向量表数据浏览', desc: '', permission: 'vector-data' },
  { key: 'match-table-config', label: '选表规则配置', desc: '', permission: 'match-table-config' },
  { key: 'vector-config', label: '向量表管理', desc: '', permission: 'vector-config' },
  { key: 'replace-table-config', label: '表改写管理', desc: '', permission: 'replace-table-config' },
  { key: 'entity-rewrite-config', label: '实体改写管理', desc: '', permission: 'entity-rewrite-config' },
]

