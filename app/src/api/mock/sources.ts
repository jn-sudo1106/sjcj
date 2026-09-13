import type { Paged, Source, SourceCategory, SourceOption, Step, Ack, CredentialRef, SourceLog, TaskInst, NodeRunStat, SourceLoadParamsResult } from '../types'
import { colorFromFlag, mergeIssueTags, parseIssueTags } from '@/utils/sourceMark'

// 样例源数据 — 取自源列表实测记录的字段结构，扩展为多分类 / 多状态以支撑列表、筛选、分类树。
// siteId（0707 优化·Phase2）：按分类归拢进 mock/sites.ts 的演示网站，供网站—源模型联调；导出供 sites.ts 聚合读取。
export const SOURCES: Source[] = [
  {
    sourceId: '391007768', name: '支付宝评论规则过滤', url: 'FundComment-209',
    configId: '81909', mainTable: '2102157', owner: 'dev_zhonghe',
    categoryPath: '/基金类/支付宝评论', cycle: '每日', state: 'C',
    dataCount: 4501, newInCount: 12, successCount: 4489, version: 7,
    lastTaskAt: '2026-06-18 17:40:09', lastSuccessAt: '2026-06-18 17:42:51',
    domain: 'comment.zfb', category: '基金类', subCategory: '支付宝评论', resume: true,
    coreParam: 'fund_code', lastUrl: 'FundComment-209?p=2', dirId: '9008845',
    credentialRef: 'cred-zfb', updatedAt: '2026-06-18 17:42', freqTag: '日度', verified: 'normal',
    siteId: 'site-zfb', tags: ['日期错误待重跑'], color: 'orange',
  },
  {
    sourceId: '301287174', name: '004432-南方中证申万有色金属ETF联接A',
    url: 'FundComment-2017052400023003-$PARAM$_913', configId: '70598', mainTable: '2100157',
    owner: 'dev_zhonghe', categoryPath: '/基金类/支付宝评论', cycle: '每日', state: 'E',
    alarm: true, dataCount: 4501, newInCount: 0, successCount: 4120, version: 3,
    lastTaskAt: '2026-06-18 17:40:09', lastSuccessAt: '2026-06-15 18:06:52', remark: '抓取超时，待排查代理',
    siteId: 'site-zfb', tags: ['正文缺失', '内容重复'], color: 'red',
  },
  {
    sourceId: '301287169', name: '160517-博时中证银行', url: 'FundComment-160517',
    configId: '70598', mainTable: '2100157', owner: 'dev_liang',
    categoryPath: '/基金类/支付宝评论', cycle: '每周', state: 'E', alarm: true,
    dataCount: 880, newInCount: 0, successCount: 870, version: 2,
    lastTaskAt: '2026-06-18 09:10:00', lastSuccessAt: '2026-06-11 09:12:30',
    siteId: 'site-zfb', tags: ['内容重复'], color: 'green',
  },
  {
    sourceId: '161725', name: '161725-招商中证白酒指数', url: 'TTFund-161725',
    configId: '70612', mainTable: '2100160', owner: 'dev_liang',
    categoryPath: '/基金类/天天基金', cycle: '每日', state: 'C',
    dataCount: 12044, newInCount: 38, successCount: 12010, version: 11,
    lastTaskAt: '2026-06-19 06:30:00', lastSuccessAt: '2026-06-19 06:33:12',
    siteId: 'site-ttfund',
  },
  {
    sourceId: '005827', name: '005827-易方达蓝筹精选混合', url: 'TTFund-005827',
    configId: '70612', mainTable: '2100160', owner: 'ops_chen',
    categoryPath: '/基金类/天天基金', cycle: '实时', state: 'L',
    dataCount: 30122, newInCount: 5, successCount: 30050, version: 23,
    lastTaskAt: '2026-06-19 08:01:00',
    siteId: 'site-ttfund',
  },
  {
    sourceId: '110022', name: '110022-易方达消费行业股票', url: 'Xueqiu-110022',
    configId: '70770', mainTable: '2100166', owner: 'ops_chen',
    categoryPath: '/基金类/雪球', cycle: '每日', state: 'C',
    externalChanged: true, lastModifiedBy: 'data_wang', syncedAt: '2026-06-17 22:10:00',
    dataCount: 6677, newInCount: 21, successCount: 6650, version: 9,
    lastTaskAt: '2026-06-19 06:30:00', lastSuccessAt: '2026-06-19 06:31:40', remark: '外部修改了登录配置，待确认',
    siteId: 'site-weibo',
  },
  {
    sourceId: '600519', name: '600519-贵州茅台-公司公告', url: 'StockNotice-600519',
    configId: '80120', mainTable: '2101001', owner: 'dev_zhonghe',
    categoryPath: '/股票类/公告', cycle: '每日', state: 'C',
    dataCount: 2210, newInCount: 3, successCount: 2208, version: 14,
    lastTaskAt: '2026-06-19 07:00:00', lastSuccessAt: '2026-06-19 07:01:05',
    siteId: 'site-notice',
  },
  {
    sourceId: '000001', name: '000001-平安银行-公司公告', url: 'StockNotice-000001',
    configId: '80120', mainTable: '2101001', owner: 'dev_liang',
    categoryPath: '/股票类/公告', cycle: '每日', state: 'E', alarm: true,
    dataCount: 1980, newInCount: 0, successCount: 1900, version: 6,
    lastTaskAt: '2026-06-19 07:00:00', lastSuccessAt: '2026-06-17 07:02:11', remark: '解析失败：公告页面改版',
    siteId: 'site-notice',
  },
  {
    sourceId: '600036', name: '600036-招商银行-行情快照', url: 'StockQuote-600036',
    configId: '80350', mainTable: '2101020', owner: 'ops_chen',
    categoryPath: '/股票类/行情', cycle: '实时', state: 'C',
    dataCount: 88212, newInCount: 142, successCount: 88200, version: 41,
    lastTaskAt: '2026-06-19 08:05:00', lastSuccessAt: '2026-06-19 08:05:30',
    siteId: 'site-quote',
  },
  {
    sourceId: '000858', name: '000858-五粮液-行情快照', url: 'StockQuote-000858',
    configId: '80350', mainTable: '2101020', owner: 'ops_chen',
    categoryPath: '/股票类/行情', cycle: '实时', state: 'L',
    dataCount: 75300, newInCount: 98, successCount: 75280, version: 39,
    lastTaskAt: '2026-06-19 08:05:00',
    siteId: 'site-quote',
  },
  {
    sourceId: 'WB100231', name: '微博舆情-财经大V监控', url: 'Weibo-finance-kol',
    configId: '90011', mainTable: '2103300', owner: 'data_wang',
    categoryPath: '/舆情类/微博', cycle: '实时', state: 'C',
    dataCount: 152300, newInCount: 320, successCount: 152000, version: 58,
    lastTaskAt: '2026-06-19 08:00:00', lastSuccessAt: '2026-06-19 08:00:50',
    siteId: 'site-weibo',
  },
  {
    sourceId: 'WB100232', name: '微博舆情-基金话题聚合', url: 'Weibo-fund-topic',
    configId: '90011', mainTable: '2103300', owner: 'data_wang',
    categoryPath: '/舆情类/微博', cycle: '每日', state: 'E', alarm: true,
    externalChanged: true, lastModifiedBy: 'ops_chen', syncedAt: '2026-06-18 11:00:00',
    dataCount: 44120, newInCount: 0, successCount: 43000, version: 17,
    lastTaskAt: '2026-06-19 06:00:00', lastSuccessAt: '2026-06-16 06:02:00', remark: 'Cookie 失效，外部已更新待确认',
    siteId: 'site-weibo',
  },
  {
    sourceId: 'NEWS5521', name: '新浪财经-要闻快讯', url: 'SinaNews-flash',
    configId: '90120', mainTable: '2103330', owner: 'data_wang',
    categoryPath: '/舆情类/新闻', cycle: '实时', state: 'C',
    dataCount: 261000, newInCount: 540, successCount: 260800, version: 77,
    lastTaskAt: '2026-06-19 08:06:00', lastSuccessAt: '2026-06-19 08:06:20',
    siteId: 'site-news',
  },
  {
    sourceId: 'NEWS5522', name: '东方财富-7×24快讯', url: 'EastMoney-247',
    configId: '90120', mainTable: '2103330', owner: 'data_wang',
    categoryPath: '/舆情类/新闻', cycle: '每日', state: 'C', disabled: true,
    dataCount: 98000, newInCount: 0, successCount: 97900, version: 33,
    lastTaskAt: '2026-06-10 08:06:00', lastSuccessAt: '2026-06-10 08:06:20', remark: '已停用：与新浪源重复',
    siteId: 'site-news',
  },
]

// 新建源本地持久化（0706 优化·Phase3）：mock 无真实后端，SOURCES 只是内存数组，刷新页面会重新求值丢失新建的源；
// 借 localStorage 补一份「创建/复制」的追加记录，与 mock/flows.ts 的 flowSave 同一思路，保证「创建并进入编排」后刷新可恢复。
const CREATED_KEY = 'sjcj.sources.created'
function readCreatedSources(): Source[] {
  try {
    return JSON.parse(localStorage.getItem(CREATED_KEY) || '[]') as Source[]
  } catch {
    return []
  }
}
function persistCreatedSources(list: Source[]) {
  localStorage.setItem(CREATED_KEY, JSON.stringify(list))
}
SOURCES.unshift(...readCreatedSources())

// 编辑源本地持久化（0706 Phase4·源信息编辑抽屉）：内置演示源的修改以 overrides 覆盖层保存，
// 新建源的修改直接回写 created 列表；模块加载时先合并 created 再套 overrides。
const UPDATED_KEY = 'sjcj.sources.updated'
function readUpdatedOverrides(): Record<string, Partial<Source>> {
  try {
    return JSON.parse(localStorage.getItem(UPDATED_KEY) || '{}') as Record<string, Partial<Source>>
  } catch {
    return {}
  }
}
function persistUpdatedOverride(sourceId: string, patch: Partial<Source>) {
  const all = readUpdatedOverrides()
  all[sourceId] = { ...all[sourceId], ...patch }
  localStorage.setItem(UPDATED_KEY, JSON.stringify(all))
}
Object.entries(readUpdatedOverrides()).forEach(([sid, patch]) => {
  const s = SOURCES.find((x) => x.sourceId === sid)
  if (s) Object.assign(s, patch)
})

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
  const siteId = String(p.siteId ?? '')
  if (siteId === '0') {
    if (s.siteId) return false
  } else if (siteId && s.siteId !== siteId) return false
  // siteIds 统一入参（InfoSourceController.sourcePaged 新契约）：'-1' 只查未关联（SITE_ID IS NULL），
  // 逗号列表按 SITE_ID IN (…) 过滤；不传/空则不做 site 维度过滤。
  const siteIds = String(p.siteIds ?? '').trim()
  if (siteIds) {
    if (siteIds === '-1') {
      if (s.siteId) return false
    } else {
      const ids = siteIds.split(/[，,]/).map((id) => id.trim()).filter(Boolean)
      if (ids.length && (!s.siteId || !ids.includes(s.siteId))) return false
    }
  }
  const category = String(p.category ?? '')
  if (category && !s.categoryPath?.startsWith(category)) return false
  const sourceIds = String(p.sourceIds ?? p.ids ?? '').split(/[，,\s]+/).map((id) => id.trim()).filter(Boolean)
  if (sourceIds.length && !sourceIds.includes(s.sourceId)) return false
  const name = String(p.name ?? '').trim().toLowerCase()
  if (name && !s.name.toLowerCase().includes(name)) return false
  const configId = String(p.configId ?? '').trim()
  if (configId && !s.configId.includes(configId)) return false
  const sourceUrl = String(p.sourceUrl ?? '').trim().toLowerCase()
  if (sourceUrl && !s.url.toLowerCase().includes(sourceUrl)) return false
  const entryTypeId = String(p.entryTypeId ?? '').trim()
  if (entryTypeId && !s.mainTable.includes(entryTypeId)) return false
  const kw = String(p.keyword ?? '').trim().toLowerCase()
  if (kw && ![s.name, s.sourceId, s.url, s.owner].some((f) => String(f ?? '').toLowerCase().includes(kw))) return false
  const state = String(p.state ?? '')
  if (state && state !== 'all') {
    if (state === 'disabled') { if (!s.disabled) return false }
    else if (state === 'external') { if (!s.externalChanged) return false }
    else if (s.disabled || s.state !== state) return false
  }
  const enable = String(p.enable ?? '')
  if (enable === '0' && s.disabled) return false
  if (enable === '1' && !s.disabled) return false
  const count = String(p.count ?? '').trim()
  if (count && !String(s.dataCount ?? '').includes(count)) return false
  const dataDate = String(p.dataDate ?? '').trim()
  if (dataDate && ![s.lastTaskAt, s.lastSuccessAt, s.updatedAt].some((date) => String(date ?? '').startsWith(dataDate))) return false
  const tagFilters = parseIssueTags(p.tags)
  if (tagFilters.length && !tagFilters.some((tag) => (s.tags ?? []).includes(tag))) return false
  const colorKey = typeof p.color === 'string' && p.color ? p.color : colorFromFlag(p.flag)
  if (colorKey && s.color !== colorKey) return false
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

export function mockSourceDetail(params?: Record<string, unknown>): Source | null {
  return SOURCES.find((s) => s.sourceId === String(params?.sourceId)) ?? null
}

// 数据表页选源下拉：同站源列表；sourceId 不存在或未落站时兜底返回全量
export function mockSourceSame(params?: Record<string, unknown>): SourceOption[] {
  const siteId = SOURCES.find((s) => s.sourceId === String(params?.sourceId))?.siteId
  return SOURCES
    .filter((s) => !siteId || s.siteId === siteId)
    .map((s) => ({ sourceId: s.sourceId, name: s.name }))
}

function categoryWithCount(node: Omit<SourceCategory, 'count'>): SourceCategory {
  return {
    id: node.id,
    name: node.name,
    count: countUnder(node.id),
    children: node.children?.map(categoryWithCount),
  }
}

function findCategory(nodes: Omit<SourceCategory, 'count'>[], id: string): Omit<SourceCategory, 'count'> | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const child = node.children && findCategory(node.children, id)
    if (child) return child
  }
}

export function mockSourceCategories(params?: Record<string, unknown>): SourceCategory[] {
  const parentId = String(params?.parentId ?? '')
  if (parentId) {
    return (findCategory(CATEGORY_TREE, parentId)?.children ?? []).map(categoryWithCount)
  }
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
// 用户新建的源（created 持久化里的）没有真实步骤，返回空 → 画布走空白引导卡模式（0710：新建源不预置骨架）；
// 演示种源保持默认两步骨架，模拟"后端已有配置的存量源"。
export function mockSourceSteps(params?: Record<string, unknown>): Step[] {
  const sourceId = String(params?.sourceId ?? '')
  const src = SOURCES.find((s) => s.sourceId === sourceId)
  if (!src) return []
  if (readCreatedSources().some((c) => c.sourceId === sourceId)) return []
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

// 启用 / 停用源（0707 Review #2 修复：原 mockAck 不落库，演示环境看不出启用/停用效果）：
// 真改 SOURCES.disabled + 本地持久化（沿用 mockSourceUpdate 的 overrides/created 双写口径），与真实后端按 payload 禁用一致。
export function mockChangeSourceEnable(params?: Record<string, unknown>): Ack {
  const sourceId = String(params?.sourceId ?? '')
  const disabled = Boolean(params?.disabled)
  const s = SOURCES.find((x) => x.sourceId === sourceId)
  if (!s) return { ok: false, message: `源「${sourceId}」不存在` }
  s.disabled = disabled
  persistUpdatedOverride(sourceId, { disabled })
  return { ok: true, message: disabled ? '已停用（本地演示）' : '已启用（本地演示）' }
}
// 改为成功状态（0707 Review #1 修复：端点 source/changeToSuccess 此前未封装、未注册，SourceTab 误用 changeSourceEnable）：
// 真改 SOURCES.state='C' + 清告警 + 本地持久化。
export function mockChangeToSuccess(params?: Record<string, unknown>): Ack {
  const sourceId = String(params?.sourceId ?? '')
  const s = SOURCES.find((x) => x.sourceId === sourceId)
  if (!s) return { ok: false, message: `源「${sourceId}」不存在` }
  s.state = 'C'
  s.alarm = false
  persistUpdatedOverride(sourceId, { state: 'C', alarm: false })
  return { ok: true, message: '已标记为成功（本地演示）' }
}

// 模板源批量导入（0707 Review #3 修复：原 mockAck 不落库 + deep/dir 字段被前端丢弃）：
// 以 template 源为底板，按 lines（每行 "名称;url"）逐条派生新源，真落库到 SOURCES + created 持久化。
// deep=true 时为每行生成独立配置副本（演示口径：configId 加行号后缀）；dir 覆盖分类路径。
export function mockBatchImport(params?: Record<string, unknown>): Ack {
  const template = String(params?.template ?? '').trim()
  const lines = String(params?.lines ?? '').trim()
  const deep = Boolean(params?.deep)
  const dir = String(params?.dir ?? '').trim()
  if (!template) return { ok: false, message: '请填写模板源 ID' }
  const tpl = SOURCES.find((s) => s.sourceId === template || s.name === template)
  if (!tpl) return { ok: false, message: `模板源「${template}」不存在` }
  const rows = lines.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!rows.length) return { ok: false, message: '请至少填写一行「名称;url」' }
  const created: Source[] = []
  rows.forEach((row, i) => {
    const [name, url] = row.split(';').map((x) => (x ?? '').trim())
    const newId = `${tpl.sourceId}-imp${Date.now().toString().slice(-6)}${i}`
    const base: Source = {
      ...tpl,
      sourceId: newId,
      name: name || `${tpl.name}-派生${i + 1}`,
      url: url || tpl.url,
      disabled: false,
      state: 'C',
      alarm: false,
      updatedAt: undefined,
    }
    if (dir) base.categoryPath = dir
    if (deep) base.configId = `${tpl.configId || ''}-d${i + 1}`
    created.push(base)
    SOURCES.push(base)
  })
  persistCreatedSources([...created, ...readCreatedSources()])
  return { ok: true, message: `已导入 ${created.length} 个源（本地演示）` }
}

// 写类 / 高危端点：首期 mock 仅回执，不落库；UI 走二次确认占位。
export function mockAck(): Ack {
  return { ok: true, demo: true, message: '演示环境：操作已记录，未实际执行写入' }
}

// 旧平台 /v1/config/loadParams：返回选中源配置下挂的可选参数定义。
// 演示环境无真实配置，返回空对象 {} —— 对应前端「无参数，直接发抓取」分支。
export function mockLoadParams(_params?: Record<string, unknown>): SourceLoadParamsResult {
  return {}
}

// 旧平台 /v1/source/sendSnatchWithParam：带参发抓取，回执形状与 sendSnatch 一致。
export function mockSendSnatchWithParam(_params?: Record<string, unknown>): Ack {
  return mockAck()
}

function parseSourceIds(params?: Record<string, unknown>): string[] {
  const raw = params?.sourceIds ?? params?.ids
  if (Array.isArray(raw)) return raw.map(String).map((id) => id.trim()).filter(Boolean)
  return String(raw ?? '').split(/[，,\s]+/).map((id) => id.trim()).filter(Boolean)
}

/**
 * 旧 querySourceTags（`POST /v1/source/sourceTags`）：当前查询条件下真实存在的标签。
 * mock 里就按 siteIds / name 缩一下范围再把 tags 摊平去重——真实后端也是这个语义。
 */
export function mockSourceTags(params?: Record<string, unknown>): string[] {
  const siteIds = String(params?.siteIds ?? params?.siteId ?? '').split(/[，,\s]+/).filter(Boolean)
  const name = String(params?.name ?? '').trim()
  const scoped = SOURCES.filter((source) => {
    if (siteIds.length && !siteIds.includes(String(source.siteId))) return false
    if (name && !source.name.includes(name)) return false
    return true
  })
  return parseIssueTags(scoped.flatMap((source) => source.tags ?? []))
}

export function mockTagSource(params?: Record<string, unknown>): Ack {
  const ids = parseSourceIds(params)
  const action = String(params?.action ?? 'add') === 'clear' ? 'clear' : 'add'
  const incoming = parseIssueTags(params?.tags)
  if (!ids.length) return { ok: false, message: '请勾选要标记的源' }
  let changed = 0
  ids.forEach((sourceId) => {
    const source = SOURCES.find((item) => item.sourceId === sourceId)
    if (!source) return
    const tags = action === 'clear' ? [] : mergeIssueTags(source.tags, incoming)
    source.tags = tags
    persistUpdatedOverride(sourceId, { tags })
    changed += 1
  })
  return { ok: true, message: action === 'clear' ? `已清除 ${changed} 个源的标签` : `已更新 ${changed} 个源的标签` }
}

export function mockSetColor(params?: Record<string, unknown>): Ack {
  const ids = parseSourceIds(params)
  const flagNum = Number(params?.flag)
  const clear = params?.clear === true || params?.isClear === 1 || params?.isClear === '1' || flagNum === 0
  const color = clear ? '' : (typeof params?.color === 'string' && params.color ? params.color : colorFromFlag(params?.flag) ?? '')
  if (!ids.length) return { ok: false, message: '请勾选要标记的源' }
  if (!clear && !color) return { ok: false, message: '请选择颜色标识' }
  let changed = 0
  ids.forEach((sourceId) => {
    const source = SOURCES.find((item) => item.sourceId === sourceId)
    if (!source) return
    source.color = color || undefined
    persistUpdatedOverride(sourceId, { color: color || '' })
    changed += 1
  })
  return { ok: true, message: clear ? `已清除 ${changed} 个源的颜色标识` : `已更新 ${changed} 个源的颜色标识` }
}

// 新建采集源闸门（0706 优化·Phase3）：真落库到 SOURCES（本地演示持久化），含源 ID 查重。
export function mockSourceCreate(params?: Record<string, unknown>): { ok: boolean; message?: string; sourceId?: string } {
  const source = params?.source as Source | undefined
  if (!source?.sourceId) return { ok: false, message: '缺少源 ID' }
  if (SOURCES.some((s) => s.sourceId === source.sourceId)) {
    return { ok: false, message: `源 ID「${source.sourceId}」已存在，请更换` }
  }
  SOURCES.unshift({ ...source })
  persistCreatedSources([{ ...source }, ...readCreatedSources()])
  return { ok: true, message: '源已创建（本地演示）', sourceId: source.sourceId }
}

// 从现有源复制预填（0706 优化·主题四「模板复用」）：只读派生一份草稿，sourceId 置空待用户确认，不落库。
export function mockSourceCopy(params?: Record<string, unknown>): Source | null {
  const src = SOURCES.find((s) => s.sourceId === String(params?.sourceId ?? ''))
  if (!src) return null
  return { ...src, sourceId: '', name: `${src.name}（复制）`, disabled: false, state: 'C', updatedAt: undefined }
}

// 编辑源（0706 Phase4·源信息编辑抽屉）：真写 SOURCES + 本地持久化，保证摘要头/源列表刷新后仍可见变更。
export function mockSourceUpdate(params?: Record<string, unknown>): Ack {
  const patch = params?.source as Source | undefined
  if (!patch?.sourceId) return { ok: false, message: '缺少源 ID' }
  const s = SOURCES.find((x) => x.sourceId === patch.sourceId)
  if (!s) return { ok: false, message: `源「${patch.sourceId}」不存在` }
  Object.assign(s, patch)
  const created = readCreatedSources()
  if (created.some((c) => c.sourceId === patch.sourceId)) {
    persistCreatedSources(created.map((c) => (c.sourceId === patch.sourceId ? { ...c, ...patch } : c)))
  } else {
    persistUpdatedOverride(patch.sourceId, patch)
  }
  return { ok: true, message: '源信息已保存（本地演示）' }
}

// 绑定已有源到网站：与真实 source/bindSite 保持单源写入口径，供绑定弹窗本地演示后刷新左侧源列表。
export function mockBindSite(params?: Record<string, unknown>): Ack {
  const sourceId = String(params?.sourceId ?? '')
  const siteId = String(params?.siteId ?? '')
  if (!sourceId || !siteId) return { ok: false, message: '缺少源 ID / 网站 ID' }
  const source = SOURCES.find((item) => item.sourceId === sourceId)
  if (!source) return { ok: false, message: `源「${sourceId}」不存在` }
  source.siteId = siteId
  source.siteName = undefined
  persistUpdatedOverride(sourceId, { siteId, siteName: undefined })
  return { ok: true, message: '源已关联网站（本地演示）' }
}

// 批量关联/变更源所属网站（0812 计划 M4-5，bindSite 的多源版）：真改多个 SOURCES.siteId + 本地持久化，
// 无效/不存在的源 ID 静默跳过——2026-08-15 生产环境真实实测确认（Q4）：批次里混无效 ID 不会让
// 整批失败，是静默跳过、有效项照常处理，这里的 mock 口径跟真实行为保持一致，不做"部分失败"提示。
export function mockChangeSite(params?: Record<string, unknown>): Ack {
  const ids = String(params?.ids ?? '').split(',').map((id) => id.trim()).filter(Boolean)
  const siteId = String(params?.siteId ?? '')
  if (!ids.length || !siteId) return { ok: false, message: '缺少源 ID / 网站 ID' }
  let changed = 0
  ids.forEach((sourceId) => {
    const source = SOURCES.find((item) => item.sourceId === sourceId)
    if (!source) return
    source.siteId = siteId === '0' ? undefined : siteId
    source.siteName = undefined
    persistUpdatedOverride(sourceId, { siteId: source.siteId, siteName: undefined })
    changed += 1
  })
  return { ok: true, message: `批量更改网站成功（本地演示，实际关联 ${changed} 个源）` }
}

// 源流程与网站统一模板的脱离状态（0707 优化·Phase2）：
// - flows.ts 的 mockFlowSave 在保存某个源自身的流程时调用 setSourceDetached(sourceId, true)；
// - sites.ts 的 mockSiteSyncFlow 用网站模板覆盖某源后调用 setSourceDetached(sourceId, false) 复位。
// 仅对已归属网站（siteId 非空）的源生效；无 siteId 的历史/草稿源没有"脱离模板"这个概念。
export function setSourceDetached(sourceId: string, detached: boolean): void {
  const s = SOURCES.find((x) => x.sourceId === sourceId)
  if (!s || !s.siteId) return
  if (s.detached === detached) return
  s.detached = detached
  const created = readCreatedSources()
  if (created.some((c) => c.sourceId === sourceId)) {
    persistCreatedSources(created.map((c) => (c.sourceId === sourceId ? { ...c, detached } : c)))
  } else {
    persistUpdatedOverride(sourceId, { detached })
  }
}

// 节点粒度运行统计（0706 Phase4·任务视图=运行视图）：与 mockSourceSteps 的两个步骤同 id 口径，
// 数字从源的 dataCount/successCount 派生（确定性，非随机），保证任务视图与源列表统计对得上。
export function mockSourceNodeRuns(params?: Record<string, unknown>): NodeRunStat[] {
  const sourceId = String(params?.sourceId ?? '')
  const src = SOURCES.find((s) => s.sourceId === sourceId)
  if (!src) return []
  const total = src.dataCount ?? 0
  const done = src.successCount ?? total
  const s2Total = Math.floor(total * 0.8)
  const queue = src.configTopic || (src.configId ? `queue_${src.configId}` : '')
  return [
    { nodeId: `${sourceId}-s1`, queue, totalTasks: total, processedTasks: Math.min(done, total), state: src.disabled ? undefined : (src.state as NodeRunStat['state']) },
    { nodeId: `${sourceId}-s2`, queue: queue ? `${queue}.detail` : '', totalTasks: s2Total, processedTasks: Math.min(Math.floor(done * 0.8), s2Total), state: src.disabled ? undefined : (src.state as NodeRunStat['state']) },
  ]
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

/**
 * 源任务视图的运行记录：默认由当前源的流程步骤派生；不传 sourceId 时汇总同网站全部源。
 * 每个节点保留两条完成记录和一条当前/最近记录，便于节点、状态、分页筛选联调。
 */
export function mockSourceTaskPaged(params?: Record<string, unknown>): Paged<TaskInst> {
  const sourceId = String(params?.sourceId ?? '')
  const siteId = String(params?.siteId ?? '')
  if (!siteId) return { total: 0, list: [] }
  const scopedSources = sourceId
    ? SOURCES.filter((source) => source.sourceId === sourceId && source.siteId === siteId)
    : SOURCES.filter((source) => source.siteId === siteId)
  if (!scopedSources.length) return { total: 0, list: [] }

  const tasks = scopedSources.flatMap((source) => {
    const latestState = source.disabled ? 'C' : source.state === 'E' || source.state === 'L' ? source.state : 'C'
    return mockSourceSteps({ sourceId: source.sourceId }).flatMap((step, stepIndex) =>
      (['C', 'C', latestState] as const).map((state, taskIndex): TaskInst => ({
        taskId: `${source.sourceId}-${stepIndex + 1}-${taskIndex + 1}`,
        state,
        typeName: '采集任务',
        taskName: step.name,
        sourceId: source.sourceId,
        configId: step.configId,
        node: step.stepId,
        topic: source.configTopic || (source.configId ? `queue_${source.configId}` : ''),
        updatedAt: source.lastTaskAt || '2026-07-13 10:00',
      })),
    )
  })
  const nodeId = String(params?.nodeId ?? '')
  const configId = String(params?.configId ?? '')
  const state = String(params?.state ?? '')
  const queue = String(params?.queue ?? params?.topic ?? params?.taskTopic ?? '').trim()
  const filtered = tasks.filter((task) =>
    (!nodeId || task.node === nodeId)
    && (!configId || task.configId === configId)
    && (!state || task.state === state)
    && (!queue || (task.topic && task.topic.includes(queue))),
  )
  const page = Math.max(1, Number(params?.page ?? 1))
  const size = Math.max(1, Number(params?.size ?? 20))
  const start = (page - 1) * size
  return { total: filtered.length, list: filtered.slice(start, start + size) }
}
