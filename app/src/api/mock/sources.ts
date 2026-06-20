import type { Paged, Source, SourceCategory, Step, Ack, CredentialRef, SourceLog, TaskInst } from '../types'

// 样例源数据 — 取自源列表实测记录的字段结构，扩展为多分类 / 多状态以支撑列表、筛选、分类树。
const SOURCES: Source[] = [
  {
    sourceId: '391007768', name: '支付宝评论规则过滤', url: 'undComment-209',
    configId: '81909', mainTable: '2102157', owner: 'dev_zhonghe',
    categoryPath: '/基金类/支付宝评论', cycle: '每日', state: 'C',
    dataCount: 4501, newInCount: 12, successCount: 4489, version: 7,
    lastTaskAt: '2026-06-18 17:40:09', lastSuccessAt: '2026-06-18 17:42:51',
    domain: 'comment.zfb', category: '基金类', subCategory: '支付宝评论', resume: true,
    coreParam: 'fund_code', lastUrl: 'undComment-209?p=2', dirId: '9008845',
    credentialRef: 'cred-zfb', updatedAt: '2026-06-18 17:42', freqTag: '日度', verified: 'normal',
  },
  {
    sourceId: '301287174', name: '004432-南方中证申万有色金属ETF联接A',
    url: 'FundComment-2017052400023003-$PARAM$_913', configId: '70598', mainTable: '2100157',
    owner: 'dev_zhonghe', categoryPath: '/基金类/支付宝评论', cycle: '每日', state: 'E',
    alarm: true, dataCount: 4501, newInCount: 0, successCount: 4120, version: 3,
    lastTaskAt: '2026-06-18 17:40:09', lastSuccessAt: '2026-06-15 18:06:52', remark: '抓取超时，待排查代理',
  },
  {
    sourceId: '301287169', name: '160517-博时中证银行', url: 'FundComment-160517',
    configId: '70598', mainTable: '2100157', owner: 'dev_liang',
    categoryPath: '/基金类/支付宝评论', cycle: '每周', state: 'E', alarm: true,
    dataCount: 880, newInCount: 0, successCount: 870, version: 2,
    lastTaskAt: '2026-06-18 09:10:00', lastSuccessAt: '2026-06-11 09:12:30',
  },
  {
    sourceId: '161725', name: '161725-招商中证白酒指数', url: 'TTFund-161725',
    configId: '70612', mainTable: '2100160', owner: 'dev_liang',
    categoryPath: '/基金类/天天基金', cycle: '每日', state: 'C',
    dataCount: 12044, newInCount: 38, successCount: 12010, version: 11,
    lastTaskAt: '2026-06-19 06:30:00', lastSuccessAt: '2026-06-19 06:33:12',
  },
  {
    sourceId: '005827', name: '005827-易方达蓝筹精选混合', url: 'TTFund-005827',
    configId: '70612', mainTable: '2100160', owner: 'ops_chen',
    categoryPath: '/基金类/天天基金', cycle: '实时', state: 'L',
    dataCount: 30122, newInCount: 5, successCount: 30050, version: 23,
    lastTaskAt: '2026-06-19 08:01:00',
  },
  {
    sourceId: '110022', name: '110022-易方达消费行业股票', url: 'Xueqiu-110022',
    configId: '70770', mainTable: '2100166', owner: 'ops_chen',
    categoryPath: '/基金类/雪球', cycle: '每日', state: 'C',
    externalChanged: true, lastModifiedBy: 'data_wang', syncedAt: '2026-06-17 22:10:00',
    dataCount: 6677, newInCount: 21, successCount: 6650, version: 9,
    lastTaskAt: '2026-06-19 06:30:00', lastSuccessAt: '2026-06-19 06:31:40', remark: '外部修改了登录配置，待确认',
  },
  {
    sourceId: '600519', name: '600519-贵州茅台-公司公告', url: 'StockNotice-600519',
    configId: '80120', mainTable: '2101001', owner: 'dev_zhonghe',
    categoryPath: '/股票类/公告', cycle: '每日', state: 'C',
    dataCount: 2210, newInCount: 3, successCount: 2208, version: 14,
    lastTaskAt: '2026-06-19 07:00:00', lastSuccessAt: '2026-06-19 07:01:05',
  },
  {
    sourceId: '000001', name: '000001-平安银行-公司公告', url: 'StockNotice-000001',
    configId: '80120', mainTable: '2101001', owner: 'dev_liang',
    categoryPath: '/股票类/公告', cycle: '每日', state: 'E', alarm: true,
    dataCount: 1980, newInCount: 0, successCount: 1900, version: 6,
    lastTaskAt: '2026-06-19 07:00:00', lastSuccessAt: '2026-06-17 07:02:11', remark: '解析失败：公告页面改版',
  },
  {
    sourceId: '600036', name: '600036-招商银行-行情快照', url: 'StockQuote-600036',
    configId: '80350', mainTable: '2101020', owner: 'ops_chen',
    categoryPath: '/股票类/行情', cycle: '实时', state: 'C',
    dataCount: 88212, newInCount: 142, successCount: 88200, version: 41,
    lastTaskAt: '2026-06-19 08:05:00', lastSuccessAt: '2026-06-19 08:05:30',
  },
  {
    sourceId: '000858', name: '000858-五粮液-行情快照', url: 'StockQuote-000858',
    configId: '80350', mainTable: '2101020', owner: 'ops_chen',
    categoryPath: '/股票类/行情', cycle: '实时', state: 'L',
    dataCount: 75300, newInCount: 98, successCount: 75280, version: 39,
    lastTaskAt: '2026-06-19 08:05:00',
  },
  {
    sourceId: 'WB100231', name: '微博舆情-财经大V监控', url: 'Weibo-finance-kol',
    configId: '90011', mainTable: '2103300', owner: 'data_wang',
    categoryPath: '/舆情类/微博', cycle: '实时', state: 'C',
    dataCount: 152300, newInCount: 320, successCount: 152000, version: 58,
    lastTaskAt: '2026-06-19 08:00:00', lastSuccessAt: '2026-06-19 08:00:50',
  },
  {
    sourceId: 'WB100232', name: '微博舆情-基金话题聚合', url: 'Weibo-fund-topic',
    configId: '90011', mainTable: '2103300', owner: 'data_wang',
    categoryPath: '/舆情类/微博', cycle: '每日', state: 'E', alarm: true,
    externalChanged: true, lastModifiedBy: 'ops_chen', syncedAt: '2026-06-18 11:00:00',
    dataCount: 44120, newInCount: 0, successCount: 43000, version: 17,
    lastTaskAt: '2026-06-19 06:00:00', lastSuccessAt: '2026-06-16 06:02:00', remark: 'Cookie 失效，外部已更新待确认',
  },
  {
    sourceId: 'NEWS5521', name: '新浪财经-要闻快讯', url: 'SinaNews-flash',
    configId: '90120', mainTable: '2103330', owner: 'data_wang',
    categoryPath: '/舆情类/新闻', cycle: '实时', state: 'C',
    dataCount: 261000, newInCount: 540, successCount: 260800, version: 77,
    lastTaskAt: '2026-06-19 08:06:00', lastSuccessAt: '2026-06-19 08:06:20',
  },
  {
    sourceId: 'NEWS5522', name: '东方财富-7×24快讯', url: 'EastMoney-247',
    configId: '90120', mainTable: '2103330', owner: 'data_wang',
    categoryPath: '/舆情类/新闻', cycle: '每日', state: 'C', disabled: true,
    dataCount: 98000, newInCount: 0, successCount: 97900, version: 33,
    lastTaskAt: '2026-06-10 08:06:00', lastSuccessAt: '2026-06-10 08:06:20', remark: '已停用：与新浪源重复',
  },
]

// 分类目录骨架（名称+路径），计数由 SOURCES 实时统计，保证树与列表对账一致。
const CATEGORY_TREE: Omit<SourceCategory, 'count'>[] = [
  {
    id: '/基金类', name: '基金类', children: [
      { id: '/基金类/支付宝评论', name: '支付宝评论', count: 0 },
      { id: '/基金类/天天基金', name: '天天基金', count: 0 },
      { id: '/基金类/雪球', name: '雪球', count: 0 },
    ],
  },
  {
    id: '/股票类', name: '股票类', children: [
      { id: '/股票类/公告', name: '公告', count: 0 },
      { id: '/股票类/行情', name: '行情', count: 0 },
    ],
  },
  {
    id: '/舆情类', name: '舆情类', children: [
      { id: '/舆情类/微博', name: '微博', count: 0 },
      { id: '/舆情类/新闻', name: '新闻', count: 0 },
    ],
  },
]

const countUnder = (prefix: string) => SOURCES.filter((s) => s.categoryPath?.startsWith(prefix)).length

function matches(s: Source, p?: Record<string, unknown>): boolean {
  if (!p) return true
  const category = String(p.category ?? '')
  if (category && !s.categoryPath?.startsWith(category)) return false
  const kw = String(p.keyword ?? '').trim().toLowerCase()
  if (kw && ![s.name, s.sourceId, s.url, s.owner].some((f) => String(f ?? '').toLowerCase().includes(kw))) return false
  const state = String(p.state ?? '')
  if (state && state !== 'all') {
    if (state === 'disabled') { if (!s.disabled) return false }
    else if (s.disabled || s.state !== state) return false
  }
  if (p.alarm === true && !s.alarm) return false
  const cycle = String(p.cycle ?? '')
  if (cycle && cycle !== 'all' && s.cycle !== cycle) return false
  return true
}

export function mockSourcePaged(params?: Record<string, unknown>): Paged<Source> {
  const filtered = SOURCES.filter((s) => matches(s, params))
  const page = Number(params?.page ?? 1)
  const size = Number(params?.size ?? 20)
  const start = (page - 1) * size
  return { total: filtered.length, list: filtered.slice(start, start + size) }
}

export function mockSourceDetail(params?: Record<string, unknown>): Source {
  return SOURCES.find((s) => s.sourceId === String(params?.sourceId)) ?? SOURCES[0]
}

export function mockSourceCategories(): SourceCategory[] {
  return CATEGORY_TREE.map((g) => ({
    id: g.id,
    name: g.name,
    count: countUnder(g.id),
    children: g.children?.map((c) => ({ ...c, count: countUnder(c.id) })),
  }))
}

export function mockSourceStats(): { total: number; error: number; externalChanged: number; disabled: number } {
  return {
    total: SOURCES.length,
    error: SOURCES.filter((s) => !s.disabled && s.state === 'E').length,
    externalChanged: SOURCES.filter((s) => s.externalChanged).length,
    disabled: SOURCES.filter((s) => s.disabled).length,
  }
}

// 子步骤（连线详情字段口径）— 详情抽屉「子步骤」分页。
export function mockSourceSteps(params?: Record<string, unknown>): Step[] {
  const sourceId = String(params?.sourceId ?? '')
  const src = SOURCES.find((s) => s.sourceId === sourceId)
  if (!src) return []
  return [
    {
      stepId: `${sourceId}-s1`, sourceId, name: '列表抓取', inputTable: '-',
      outputTable: src.mainTable, configId: src.configId, urlSourceField: 'seed_url',
      condition: '', failAction: '重试3次后告警', enabled: true,
    },
    {
      stepId: `${sourceId}-s2`, sourceId, name: '详情解析', inputTable: src.mainTable,
      outputTable: `${src.mainTable}_DETAIL`, configId: src.configId, urlSourceField: 'detail_url',
      condition: 'IF(status=="ok")', failAction: '跳过', enabled: !src.disabled,
    },
  ]
}

// 写类 / 高危端点：首期 mock 仅回执，不落库；UI 走二次确认占位。
export function mockAck(): Ack {
  return { ok: true, demo: true, message: '演示环境：操作已记录，未实际执行写入' }
}

// 登录凭据：只存引用与脱敏信息，不存明文密码。
const CREDENTIALS: Record<string, CredentialRef> = {
  'cred-zfb': { refId: 'cred-zfb', name: '支付宝采集账号', loginUrl: 'https://auth.zfb.example/login', account: 'dev_***', hasSecret: true },
}
export function mockCredentialRef(params?: Record<string, unknown>): CredentialRef | null {
  return CREDENTIALS[String(params?.refId)] ?? null
}

export function mockSourceLogs(params?: Record<string, unknown>): SourceLog[] {
  const sourceId = String(params?.sourceId ?? '')
  return [
    { logId: 'L1', sourceId, action: 'SEND_SNATCH', result: 'OK', remark: 'TASK_20260619', at: '2026-06-19 07:00' },
    { logId: 'L2', sourceId, action: 'ENTRY_CHECK', result: 'OK', remark: '-', at: '2026-06-18 17:42' },
    { logId: 'L3', sourceId, action: 'CONFIG_UPDATE', result: 'OK', remark: 'topic 调整', at: '2026-06-17 10:05' },
  ]
}

export function mockSourceTasks(params?: Record<string, unknown>): TaskInst[] {
  const sourceId = String(params?.sourceId ?? '')
  return [
    { taskId: '8348509120', state: 'C', typeName: '浏览器抓取', taskName: '最近抓取任务', sourceId, configId: '70598', node: 'dev_web_snatch_zfb', topic: 'dev_web_snatch_zfb', updatedAt: '2026-06-19 07:02' },
    { taskId: '8348508001', state: 'L', typeName: '浏览器抓取', taskName: '进行中任务', sourceId, configId: '70598', node: 'dev_web_snatch_zfb', topic: 'dev_web_snatch_zfb', updatedAt: '2026-06-19 08:05' },
  ]
}
