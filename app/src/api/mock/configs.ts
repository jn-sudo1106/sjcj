import type { Paged, Config, ConfigActionLog, ConfigParamBinding } from '../types'

const CONFIGS: Config[] = [
  { configId: '81909', name: '支付宝评论抓取配置', topic: 'dev_web_snatch_zfb', policy: '交易日 08:30', enabled: true, sourceCount: 3, paramRefs: ['p-date'], isDetail: false, isLogin: false, owner: 'dev_zhonghe', updatedAt: '2026-06-18 14:32' },
  { configId: '70598', name: '基金评论详情配置', topic: 'fund_comment_q', policy: '每日 06:00', enabled: true, sourceCount: 5, paramRefs: ['p-fundcode', 'p-date'], isDetail: true, isLogin: false, owner: 'dev_liang', updatedAt: '2026-06-17 10:05' },
  { configId: '70612', name: '天天基金净值配置', topic: 'ttfund_q', policy: '每日 06:30', enabled: true, sourceCount: 2, paramRefs: ['p-fundcode'], isDetail: false, owner: 'dev_liang', updatedAt: '2026-06-15 09:20' },
  { configId: '80120', name: '股票公告配置', topic: 'stock_notice_q', policy: '交易日 07:00', enabled: true, sourceCount: 2, paramRefs: [], isDetail: true, owner: 'dev_zhonghe', updatedAt: '2026-06-19 07:00' },
  { configId: '80350', name: '行情快照配置', topic: 'stock_quote_q', policy: '实时', enabled: true, sourceCount: 2, isDetail: false, owner: 'ops_chen', updatedAt: '2026-06-19 08:00' },
  { configId: '90011', name: '微博舆情配置', topic: 'weibo_q', policy: '实时', enabled: true, sourceCount: 2, paramRefs: ['p-keyword'], isDetail: false, isLogin: true, owner: 'data_wang', updatedAt: '2026-06-18 11:00' },
  { configId: '90120', name: '财经新闻配置', topic: 'news_q', policy: '实时', enabled: false, sourceCount: 2, isDetail: false, owner: 'data_wang', updatedAt: '2026-06-10 08:06' },
  { configId: '70770', name: '雪球评论配置', topic: 'xueqiu_q', policy: '每日 06:30', enabled: true, sourceCount: 1, isLogin: true, owner: 'ops_chen', updatedAt: '2026-06-17 22:10' },
]

function matches(c: Config, p?: Record<string, unknown>): boolean {
  if (!p) return true
  const kw = String(p.keyword ?? '').trim().toLowerCase()
  if (kw && ![c.configId, c.name, c.topic ?? ''].some((f) => f.toLowerCase().includes(kw))) return false
  const state = String(p.state ?? '')
  if (state === 'enabled' && !c.enabled) return false
  if (state === 'disabled' && c.enabled) return false
  return true
}

export function mockConfigPaged(params?: Record<string, unknown>): Paged<Config> {
  const filtered = CONFIGS.filter((c) => matches(c, params))
  const page = Number(params?.page ?? 1)
  const size = Number(params?.size ?? 20)
  const start = (page - 1) * size
  return { total: filtered.length, list: filtered.slice(start, start + size) }
}

// 不再兜底成 CONFIGS[0]：真实后端查不到就是没有，兜底会让任何未登记的 configId
// （比如按源步骤真实 configId 查询）都静默拿到第一条固定数据，冒充成真实内容。
export function mockConfigDetail(params?: Record<string, unknown>): Config | undefined {
  return CONFIGS.find((c) => c.configId === String(params?.configId))
}

export function mockConfigParams(params?: Record<string, unknown>): Paged<ConfigParamBinding> {
  const config = mockConfigDetail(params)
  const list = (config?.paramRefs ?? []).map((paramId) => ({
    id: `${config!.configId}-${paramId}`,
    paramId,
    paramName: paramId,
    valueShow: '点击参数列表查看',
  }))
  return { total: list.length, list }
}

export function mockConfigActionLogs(params?: Record<string, unknown>): Paged<ConfigActionLog> {
  const configId = String(params?.configId ?? '')
  const list: ConfigActionLog[] = [
    {
      actionId: `${configId}-log-1`,
      configId,
      action: 'UPDATE',
      target: '配置定义',
      result: 'SUCCESS',
      remark: '演示操作日志',
      actionTime: '2026-07-17 10:00:00',
    },
  ]
  return { total: list.length, list }
}
