// 首页 + 8 个业务模块元数据 — 路由与独立系统导航共用，口径同《采集配置中心_开发方案.md》信息架构。
export interface TabMeta {
  key: string
  path: string
  label: string
  desc: string
  group: 'home' | 'workbench' | 'assets' | 'ops' | 'tools' | 'intelligence'
}

export const TABS: TabMeta[] = [
  { key: 'overview', path: '/overview', label: '采集资产总览', desc: 'KPI、采集生态、趋势、占比、异常下钻', group: 'home' },
  { key: 'collect', path: '/collect', label: '采集资产', desc: '源、配置、表、批量操作', group: 'assets' },
  // 流程中心（0828 W6-1）：Flow 是与源/规则/指标并列的一类资产，且被多个源复用——
  // 塞进采集资产的 tab 会暗示它从属于某个源，所以提为一级入口。
  // key 必须等于 path 的第一段：useActiveNavKey 按路由段查 TABS，查不到会**静默回退到 TABS[0]**。
  // 2026-09-02 这条曾写成单数 'flow'（path 是 /flows），结果流程中心的面包屑一直显示
  // 「采集资产总览」——不报错，只是显示成了另一个模块。tabs.test.ts 有一条用例锁死这个约定。
  { key: 'flows', path: '/flows', label: '流程中心', desc: '流程、节点与配置、使用范围反查', group: 'assets' },
  { key: 'rules', path: '/rules', label: '规则资产', desc: '规则组、表达式、测试集、发布门禁、参数', group: 'assets' },
  { key: 'metrics', path: '/metrics', label: '指标中心', desc: '指标数据集、指标定义、口径维护', group: 'assets' },
  { key: 'data', path: '/data', label: '数据中心', desc: '实体数据、原始文件、表结构', group: 'ops' },
  { key: 'files', path: '/files', label: '文件中心', desc: '默认全平台，可按网站、源查询文件资源', group: 'ops' },
  { key: 'tasks', path: '/tasks', label: '任务中心', desc: '任务实例、节点状态、失败重跑', group: 'ops' },
  { key: 'monitor', path: '/monitor', label: '监控中心', desc: '系统健康、MQ、同步状态、告警', group: 'tools' },
]
