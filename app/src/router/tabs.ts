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
  // 模板配置（1013）：旧 ai-chat-view「模板配置」域的落位，与运行与监控、系统设置同级。
  // 这一组会随迁移逐个长出来（自动补全 / 问句改写 / 数据索引同步 / 数据字典 / 提示词 / 分词），
  // 接口共用 api/templateConfig.ts 的 CRUD 工厂；列表页只有「简单字段」的模块才复用
  // components/templateConfig 的 schema 层，带远程多选的（如表模板）在自己的目录里实现。
  { key: 'sql-template', path: '/sql-template', label: 'SQL模板配置', desc: 'SQL 模板内容与通过/拒绝条件、select/table/where/group by 校验表达式', group: 'template', permission: 'sql-template' },
  { key: 'table-template', path: '/table-template', label: '表模板配置', desc: '问句样例与匹配规则、使用表范围、关联 sql 模板（旧接口域 question-temp）', group: 'template', permission: 'table-template' },
  { key: 'dic-template', path: '/dic-template', label: '自动补全配置', desc: '自动补全词典的内容与简称维护、导出（旧接口域 /poc/dic）', group: 'template', permission: 'dic-template' },
  // 系统设置（0924-02）：节点类型（旧平台「源类型」）+ 分类目录（原挂在采集资产的分类下拉底部）。
  // 这是第一个声明了 permission 的入口，给后续人员菜单权限留口子（见 composables/usePermission）。
  { key: 'settings', path: '/settings', label: '系统设置', desc: '节点类型、分类目录、运行机器、代码仓库、部署目录、机器配置、Runner 版本', group: 'settings', permission: 'settings' },
]
