import type { Paged, Source, Site, Ack, QueueStat, TaskInst } from '../types'
import { SOURCES, mockSourceCreate, setSourceDetached, mockSourceSteps, mockSourceNodeRuns } from './sources'
import { mockFlowLoad, mockFlowSave } from './flows'

// 网站—子源父子模型 mock（0707 优化·Phase2）：网站 = 统一流程模板 + 批量工具（不实际运行），
// 子源（语言/变体）= 真正的采集运行实体。网站统一流程复用既有 flow/save·load 契约，id = `site:${siteId}`。

const SITE_SEEDS: Omit<Site, 'sourceCount' | 'errorCount'>[] = [
  { siteId: 'site-zfb', name: '支付宝评论采集', category: '基金类', categoryPath: '/基金类/支付宝评论', owner: 'dev_zhonghe', tags: ['基金', '支付宝'], updatedAt: '2026-06-18 17:42' },
  { siteId: 'site-ttfund', name: '天天基金采集', category: '基金类', categoryPath: '/基金类/天天基金', owner: 'dev_liang', tags: ['基金', '天天基金'], updatedAt: '2026-06-19 06:33' },
  { siteId: 'site-notice', name: '股票公告采集', category: '股票类', categoryPath: '/股票类/公告', owner: 'dev_zhonghe', tags: ['公告'], updatedAt: '2026-06-19 07:01' },
  { siteId: 'site-quote', name: '行情快照采集', category: '股票类', categoryPath: '/股票类/行情', owner: 'ops_chen', tags: ['行情'], updatedAt: '2026-06-19 08:05' },
  { siteId: 'site-weibo', name: '舆情监控采集', category: '舆情类', categoryPath: '/舆情类', owner: 'data_wang', tags: ['舆情', '微博'], updatedAt: '2026-06-19 08:00' },
  { siteId: 'site-news', name: '财经资讯采集', category: '舆情类', categoryPath: '/舆情类/新闻', owner: 'data_wang', tags: ['新闻', '快讯'], updatedAt: '2026-06-19 08:06' },
  { siteId: 'site-lang-demo', name: '多语种公告监控', category: '股票类', categoryPath: '/股票类/公告', owner: 'dev_zhonghe', tags: ['多语言', '演示'], updatedAt: '2026-07-01 09:00' },
]

// 「子源可能很多」演示数据（0707 会后澄清）：单独一个网站挂 24 个语言子源，
// 供采集资产卡片 chips「+N」浮层与数据/任务视图源筛选下拉的可搜索、溢出收纳交互联调用。
// 0707 优化·Phase3 修正：并入通用 SOURCES（见下方 push）——Phase3 之前曾刻意不并入以避免撑爆采集资产表格，
// 但 Phase3 把 SourceTab.vue 从 sourceApi.sourcePaged 换成了 siteApi.sitePaged，flat 列表已无消费方，
// 顾虑不存在了；不并入的代价是任何按 sourceId 查找（sourceDetail/sourceSteps/nodeRunStats…全部键在 SOURCES 上）
// 都找不到这些 id，命中 mockSourceDetail 的 `SOURCES.find(...) ?? SOURCES[0]` 兜底，
// 会静默加载成 SOURCES[0]（错的源）而不是报错——从卡片点进语言子源实测到了这个问题，因此改为并入。
const LANGUAGES = [
  '中文', '英文', '日文', '韩文', '法文', '德文', '西班牙文', '葡萄牙文', '俄文', '阿拉伯文',
  '意大利文', '荷兰文', '泰文', '越南文', '印尼文', '土耳其文', '波兰文', '瑞典文', '希腊文', '希伯来文',
  '印地文', '孟加拉文', '马来文', '乌克兰文',
]
const LANG_DEMO_SOURCES: Source[] = LANGUAGES.map((lang, i) => {
  const idx = i + 1
  const state: Source['state'] = idx % 11 === 0 ? 'E' : idx % 7 === 0 ? 'L' : 'C'
  return {
    sourceId: `site-lang-demo-${String(idx).padStart(2, '0')}`,
    name: `多语种公告监控 - ${lang}`,
    url: `https://example.com/notice?lang=${encodeURIComponent(lang)}`,
    configId: `82${100 + idx}`,
    mainTable: '2101500',
    owner: 'dev_zhonghe',
    category: '股票类',
    categoryPath: '/股票类/公告',
    cycle: '每日',
    state,
    dataCount: 800 + idx * 37,
    newInCount: idx % 5,
    successCount: 780 + idx * 35,
    lastTaskAt: '2026-07-07 08:00:00',
    lastSuccessAt: state === 'E' ? undefined : '2026-07-07 08:02:00',
    siteId: 'site-lang-demo',
  }
})
SOURCES.push(...LANG_DEMO_SOURCES)

// 新建网站本地持久化（同 sources.ts 的 created 思路）：mock 无真实后端，刷新页面需可恢复。
const CREATED_KEY = 'sjcj.sites.created'
function readCreatedSites(): Site[] {
  try {
    return JSON.parse(localStorage.getItem(CREATED_KEY) || '[]') as Site[]
  } catch {
    return []
  }
}
function persistCreatedSites(list: Site[]) {
  localStorage.setItem(CREATED_KEY, JSON.stringify(list))
}

function allSites(): Omit<Site, 'sourceCount' | 'errorCount'>[] {
  return [...readCreatedSites(), ...SITE_SEEDS]
}

// 某网站下的全部子源（语言演示数据已并入 SOURCES，见上方 push，这里无需再单独合并）。
function sourcesOfSite(siteId: string): Source[] {
  return SOURCES.filter((s) => s.siteId === siteId)
}

function withAggregate(seed: Omit<Site, 'sourceCount' | 'errorCount'>): Site {
  const children = sourcesOfSite(seed.siteId)
  // 站级聚合列（0707 采集资产表格样式）：数据量合计 / 最常见周期 / 最近任务时间，全部查询时实时派生
  const cycleCount: Record<string, number> = {}
  children.forEach((s) => {
    if (s.cycle) cycleCount[s.cycle] = (cycleCount[s.cycle] ?? 0) + 1
  })
  const cycle = Object.entries(cycleCount).sort((a, b) => b[1] - a[1])[0]?.[0]
  const lastTaskAt = children.map((s) => s.lastTaskAt ?? '').sort().at(-1) || undefined
  return {
    ...seed,
    sourceCount: children.length,
    errorCount: children.filter((s) => !s.disabled && s.state === 'E').length,
    dataCount: children.reduce((n, s) => n + (s.dataCount ?? 0), 0),
    cycle,
    lastTaskAt,
  }
}

function matches(site: Site, p?: Record<string, unknown>): boolean {
  if (!p) return true
  const category = String(p.category ?? '')
  if (category && !site.categoryPath?.startsWith(category) && site.category !== category) return false
  const kw = String(p.keyword ?? '').trim().toLowerCase()
  if (kw && ![site.name, site.siteId, site.owner].some((f) => String(f ?? '').toLowerCase().includes(kw))) return false
  const tag = String(p.tag ?? '')
  if (tag && !(site.tags ?? []).includes(tag)) return false
  const state = String(p.state ?? '')
  if (state === 'error' && site.errorCount <= 0) return false
  return true
}

export function mockSitePaged(params?: Record<string, unknown>): Paged<Site> {
  const filtered = allSites().map(withAggregate).filter((s) => matches(s, params))
  const page = Number(params?.page ?? 1)
  const size = Number(params?.size ?? 20)
  const start = (page - 1) * size
  return { total: filtered.length, list: filtered.slice(start, start + size) }
}

export function mockSiteDetail(params?: Record<string, unknown>): Site | null {
  const seed = allSites().find((s) => s.siteId === String(params?.siteId ?? ''))
  return seed ? withAggregate(seed) : null
}

// 「新建采集」两段式闸门：建网站 + 首批子源（子源沿用 source/createSource 的落库 + 查重逻辑，仅补 siteId）。
export function mockSiteCreate(params?: Record<string, unknown>): { ok: boolean; message?: string; siteId?: string } {
  const site = params?.site as Omit<Site, 'sourceCount' | 'errorCount'> | undefined
  const sources = (params?.sources as Source[] | undefined) ?? []
  if (!site?.siteId || !site.name) return { ok: false, message: '缺少网站 ID / 名称' }
  if (allSites().some((s) => s.siteId === site.siteId)) {
    return { ok: false, message: `网站 ID「${site.siteId}」已存在，请更换` }
  }
  persistCreatedSites([{ ...site, sourceCount: 0, errorCount: 0 }, ...readCreatedSites()])
  for (const src of sources) {
    const res = mockSourceCreate({ source: { ...src, siteId: site.siteId } })
    if (!res.ok) return res
  }
  return { ok: true, message: '网站已创建（本地演示）', siteId: site.siteId }
}

export function mockSiteSourcesOf(params?: Record<string, unknown>): Source[] {
  return sourcesOfSite(String(params?.siteId ?? ''))
}

// 网站下新增子源：默认继承网站统一流程（若已存在），写法与 source/createSource 一致，仅补 siteId 归属。
export function mockSiteSourceAdd(params?: Record<string, unknown>): { ok: boolean; message?: string; sourceId?: string } {
  const siteId = String(params?.siteId ?? '')
  const source = params?.source as Source | undefined
  if (!siteId || !source) return { ok: false, message: '缺少网站或子源信息' }
  const res = mockSourceCreate({ source: { ...source, siteId } })
  if (res.ok && res.sourceId) {
    const siteFlow = mockFlowLoad({ id: `site:${siteId}` })
    if (siteFlow) {
      mockFlowSave({ def: { ...siteFlow, id: res.sourceId, name: source.name || siteFlow.name } })
      // 刚从模板初始化、尚未被用户单独改动：mockFlowSave 的通用副作用会误标 detached，这里立即复位
      setSourceDetached(res.sourceId, false)
    }
  }
  return res
}

// 网站下移除子源（危险端点）：仅从通用 SOURCES 摘除（语言演示数据是只读种子，不支持移除）。
export function mockSiteSourceRemove(params?: Record<string, unknown>): Ack {
  const siteId = String(params?.siteId ?? '')
  const sourceId = String(params?.sourceId ?? '')
  const idx = SOURCES.findIndex((s) => s.sourceId === sourceId && s.siteId === siteId)
  if (idx < 0) return { ok: false, message: '子源不存在或不属于该网站' }
  SOURCES.splice(idx, 1)
  return { ok: true, demo: true, message: '子源已移除（本地演示）' }
}

// 网站统一流程同步覆盖到所选子源（危险端点）：整条流程覆盖，不做节点级 diff 合并（首期口径）；
// 同步成功的子源复位 detached=false（不再"已单独调整"）。
export function mockSiteSyncFlow(params?: Record<string, unknown>): Ack {
  const siteId = String(params?.siteId ?? '')
  const sourceIds = (params?.sourceIds as string[] | undefined) ?? []
  if (!siteId || !sourceIds.length) return { ok: false, message: '缺少网站或所选子源' }
  const siteFlow = mockFlowLoad({ id: `site:${siteId}` })
  if (!siteFlow) return { ok: false, message: '网站还没有可同步的统一流程' }
  sourceIds.forEach((sourceId) => {
    mockFlowSave({ def: { ...siteFlow, id: sourceId } })
    setSourceDetached(sourceId, false)
  })
  return { ok: true, demo: true, message: `已同步到 ${sourceIds.length} 个子源（本地演示）` }
}

// 任务视图网站化（0707 优化·Phase5）：队列粒度聚合，网站下全部子源节点按队列去重；sourceId 可选进一步收窄到单个子源。
export function mockSiteQueueStats(params?: Record<string, unknown>): QueueStat[] {
  const siteId = String(params?.siteId ?? '')
  const sourceFilter = String(params?.sourceId ?? '')
  const children = sourcesOfSite(siteId).filter((s) => !sourceFilter || s.sourceId === sourceFilter)
  const agg: Record<string, { total: number; processed: number; states: Set<string> }> = {}
  children.forEach((src) => {
    mockSourceNodeRuns({ sourceId: src.sourceId }).forEach((r) => {
      if (!r.queue) return
      const bucket = agg[r.queue] ?? (agg[r.queue] = { total: 0, processed: 0, states: new Set() })
      bucket.total += r.totalTasks
      bucket.processed += r.processedTasks
      if (r.state) bucket.states.add(r.state)
    })
  })
  return Object.entries(agg)
    .map(([queue, b]): QueueStat => ({
      queue,
      totalTasks: b.total,
      processedTasks: b.processed,
      state: b.states.has('E') ? 'E' : b.states.has('L') ? 'L' : b.total > 0 ? 'C' : undefined,
    }))
    .sort((a, b) => b.totalTasks - a.totalTasks)
}

// 队列任务明细：合成任务行，每节点最多取 DETAIL_CAP 条「已处理」样本 + 1 条代表当前状态（运行中/异常）的行——
// 真实总数已在 siteQueueStats 体现（总任务数−已处理=未处理背压），这里只做有限样本浏览，不物化几万条空任务。
const DETAIL_CAP = 60
export function mockQueueTaskPaged(params?: Record<string, unknown>): Paged<TaskInst> {
  const siteId = String(params?.siteId ?? '')
  const queue = String(params?.queue ?? '')
  const sourceFilter = String(params?.sourceId ?? '')
  const stateFilter = String(params?.state ?? '')
  const children = sourcesOfSite(siteId).filter((s) => !sourceFilter || s.sourceId === sourceFilter)
  const tasks: TaskInst[] = []
  children.forEach((src) => {
    const steps = mockSourceSteps({ sourceId: src.sourceId })
    mockSourceNodeRuns({ sourceId: src.sourceId }).forEach((r) => {
      if (r.queue !== queue) return
      const nodeName = steps.find((s) => s.stepId === r.nodeId)?.name ?? r.nodeId
      const makeTask = (idx: number, state: TaskInst['state']): TaskInst => ({
        taskId: `${r.nodeId}-T${String(idx + 1).padStart(4, '0')}`,
        state,
        typeName: '采集任务',
        taskName: nodeName,
        sourceId: src.sourceId,
        node: r.nodeId, // 原始节点 id（非展示名）：TaskView「任务配置」跳转靠它精确定位画布节点
        topic: queue,
        updatedAt: src.lastTaskAt ?? '',
      })
      const doneSample = Math.min(r.processedTasks, DETAIL_CAP)
      for (let i = 0; i < doneSample; i++) tasks.push(makeTask(i, 'C'))
      if (r.totalTasks > r.processedTasks && (r.state === 'E' || r.state === 'L')) {
        tasks.push(makeTask(doneSample, r.state))
      }
    })
  })
  const filtered = stateFilter ? tasks.filter((t) => t.state === stateFilter) : tasks
  const page = Math.max(1, Number(params?.page ?? 1))
  const size = Math.max(1, Number(params?.size ?? 20))
  const start = (page - 1) * size
  return { total: filtered.length, list: filtered.slice(start, start + size) }
}
