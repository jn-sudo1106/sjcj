// 首页 + 7 个业务模块元数据 — 路由与独立系统导航共用，口径同《采集配置中心_开发方案.md》信息架构。
export interface TabMeta {
  key: string
  path: string
  label: string
  desc: string
  group: 'home' | 'workbench' | 'assets' | 'ops' | 'tools'
}

export const TABS: TabMeta[] = [
  { key: 'overview', path: '/overview', label: '采集资产总览', desc: 'KPI、采集生态、趋势、占比、异常下钻', group: 'home' },
  { key: 'collect', path: '/collect', label: '采集资产', desc: '源、配置、表、批量操作', group: 'assets' },
  { key: 'rules', path: '/rules', label: '规则资产', desc: '规则组、表达式、测试集、发布门禁、参数', group: 'assets' },
  { key: 'metrics', path: '/metrics', label: '指标中心', desc: '指标数据集、指标定义、口径维护', group: 'assets' },
  { key: 'data', path: '/data', label: '数据查看', desc: '实体数据、原始文件、表结构', group: 'ops' },
  { key: 'runs', path: '/runs', label: '运行记录', desc: '任务实例、节点状态、失败重跑', group: 'ops' },
  { key: 'tools', path: '/tools', label: '监控工具', desc: 'MQ、函数工具、同步状态、告警', group: 'tools' },
]
