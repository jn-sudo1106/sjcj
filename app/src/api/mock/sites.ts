import type { Paged, Source, Site, SiteSummary, Ack, QueueStat, TaskInst, SourceCloneRequest, SourceCloneResult } from '../types'
import { SOURCES, mockSourceCreate, setSourceDetached, mockSourceSteps, mockSourceNodeRuns } from './sources'
import { mockFlowLoad, mockFlowSave } from './flows'
import { cloneEntryStructure } from './entries'
import { buildSourceSeed, type FlowDef, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'

// 网站—源父子模型 mock（0707 优化·Phase2）：网站 = 统一流程模板 + 批量工具（不实际运行），
// 源（语言/变体）= 真正的采集运行实体。网站统一流程复用既有 flow/save·load 契约，id = `site:${siteId}`。

// export 给 flows.ts 的 mockFlowLoad：种子演示网站查无模板存档时兜底默认骨架（0710，与用户新建网站区分）
export const SITE_SEEDS: Omit<Site, 'sourceCount' | 'errorCount'>[] = [
  { siteId: 'site-zfb', name: '支付宝评论采集', category: '基金类', categoryPath: '/基金类/支付宝评论', owner: 'dev_zhonghe', tags: ['基金', '支付宝'], updatedAt: '2026-06-18 17:42' },
  { siteId: 'site-ttfund', name: '天天基金采集', category: '基金类', categoryPath: '/基金类/天天基金', owner: 'dev_liang', tags: ['基金', '天天基金'], updatedAt: '2026-06-19 06:33' },
  { siteId: 'site-notice', name: '股票公告采集', category: '股票类', categoryPath: '/股票类/公告', owner: 'dev_zhonghe', tags: ['公告'], updatedAt: '2026-06-19 07:01' },
  { siteId: 'site-quote', name: '行情快照采集', category: '股票类', categoryPath: '/股票类/行情', owner: 'ops_chen', tags: ['行情'], updatedAt: '2026-06-19 08:05' },
  { siteId: 'site-weibo', name: '舆情监控采集', category: '舆情类', categoryPath: '/舆情类', owner: 'data_wang', tags: ['舆情', '微博'], updatedAt: '2026-06-19 08:00' },
  { siteId: 'site-news', name: '财经资讯采集', category: '舆情类', categoryPath: '/舆情类/新闻', owner: 'data_wang', tags: ['新闻', '快讯'], updatedAt: '2026-06-19 08:06' },
  { siteId: 'site-lang-demo', name: '多语种公告监控', category: '股票类', categoryPath: '/股票类/公告', owner: 'dev_zhonghe', tags: ['多语言', '演示'], updatedAt: '2026-07-01 09:00' },
]

// 「源可能很多」演示数据（0707 会后澄清）：单独一个网站挂 24 个语言源，
// 供采集资产卡片 chips「+N」浮层与数据/任务视图源筛选下拉的可搜索、溢出收纳交互联调用。
// 0707 优化·Phase3 修正：并入通用 SOURCES（见下方 push）——Phase3 之前曾刻意不并入以避免撑爆采集资产表格，
// 但 Phase3 把 SourceTab.vue 从 sourceApi.sourcePaged 换成了 siteApi.sitePaged，flat 列表已无消费方，
// 顾虑不存在了；不并入的代价是任何按 sourceId 查找（sourceDetail/sourceSteps/nodeRunStats…全部键在 SOURCES 上）
// 都找不到这些 id，命中 mockSourceDetail 的 `SOURCES.find(...) ?? SOURCES[0]` 兜底，
// 会静默加载成 SOURCES[0]（错的源）而不是报错——从卡片点进语言源实测到了这个问题，因此改为并入。
const LANGUAGES = [
  '中文', '英文', '日文', '韩文', '法文', '德文', '西班牙文', '葡萄牙文', '俄文', '阿拉伯文',
  '意大利文', '荷兰文', '泰文', '越南文', '印尼文', '土耳其文', '波兰文', '瑞典文', '希腊文', '希伯来文',
  '印地文', '孟加拉文', '马来文', '乌克兰文',
]
let cloneSequence = 1
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

// 某网站下的全部源（语言演示数据已并入 SOURCES，见上方 push，这里无需再单独合并）。
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
  // 分类筛选是多选：category 按逗号分隔携带多个目录 ID（与旧契约 categoryIds 同形），任一命中即保留
  const categories = String(p.category ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (categories.length && !categories.some((c) => site.categoryPath?.startsWith(c) || site.category === c)) return false
  const siteName = String(p.name ?? '').trim().toLowerCase()
  if (siteName && !site.name.toLowerCase().includes(siteName)) return false
  const sourceName = String(p.sourceName ?? '').trim().toLowerCase()
  if (sourceName && !sourcesOfSite(site.siteId).some((source) => source.name.toLowerCase().includes(sourceName))) return false
  const kw = String(p.keyword ?? '').trim().toLowerCase()
  if (kw && ![
    site.name,
    site.owner,
    ...sourcesOfSite(site.siteId).map((source) => source.name),
  ].some((f) => String(f ?? '').toLowerCase().includes(kw))) return false
  const tag = String(p.tag ?? '')
  if (tag && !(site.tags ?? []).includes(tag)) return false
  const state = String(p.state ?? '')
  if (state === 'error' && site.errorCount <= 0) return false
  return true
}

export function mockSitePaged(params?: Record<string, unknown>): Paged<Site> {
  const filtered = allSites().map(withAggregate).filter((s) => matches(s, params))
  // 排序在分页前做（0710：原来前端对分页后的单页结果排序，跨页顺序是错的）；缺省按最近修改倒序
  const sort = String(params?.sort ?? 'updated')
  if (sort === 'name') filtered.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  else filtered.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  const page = Number(params?.page ?? 1)
  const size = Number(params?.size ?? 20)
  const start = (page - 1) * size
  return { total: filtered.length, list: filtered.slice(start, start + size) }
}

/** 与网站列表同口径的顶部统计，供关闭真实端点时回退。 */
export function mockSiteSummary(): SiteSummary {
  const sites = allSites().map(withAggregate)
  return {
    total: sites.length,
    sourceTotal: sites.reduce((total, site) => total + site.sourceCount, 0),
    notifyCount: 0,
    errorCount: sites.reduce((total, site) => total + site.errorCount, 0),
  }
}

export function mockSiteDetail(params?: Record<string, unknown>): Site | null {
  const seed = allSites().find((s) => s.siteId === String(params?.siteId ?? ''))
  return seed ? withAggregate(seed) : null
}

// 本地演示仍保持页面原有的一次提交体验；真实 HTTP 适配层会把同一提交拆成多步落库。
export function mockSiteCreate(params?: Record<string, unknown>): { ok: boolean; message?: string; siteId?: string; sourceId?: string } {
  const input = params?.site as Omit<Site, 'sourceCount' | 'errorCount'> | undefined
  const site = input ?? {
    siteId: String(params?.siteId ?? `site-local-${Date.now()}`),
    name: String(params?.siteName ?? ''),
    category: String(params?.category ?? ''),
    categoryPath: params?.categoryPath == null ? undefined : String(params.categoryPath),
    dirId: params?.categoryId == null ? undefined : String(params.categoryId),
    owner: String(params?.owner ?? 'admin'),
  }
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
  return { ok: true, message: '网站已创建（本地演示）', siteId: site.siteId, sourceId: sources[0]?.sourceId }
}

/** 网站基本信息编辑：只更新网站自身的名称、分类和责任人，不改源、标签与网站统一流程。 */
export function mockSiteUpdate(params?: Record<string, unknown>): Ack {
  const site = params?.site as Pick<Site, 'siteId' | 'name' | 'category' | 'categoryPath' | 'owner'> | undefined
  if (!site?.siteId || !site.name.trim() || !site.category.trim()) return { ok: false, message: '请填写网站名称和分类' }
  const patch = {
    ...site,
    name: site.name.trim(),
    category: site.category.trim(),
    categoryPath: site.categoryPath?.trim() || `/${site.category.trim()}`,
    owner: site.owner.trim(),
    updatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
  }
  const created = readCreatedSites()
  if (created.some((item) => item.siteId === site.siteId)) {
    persistCreatedSites(created.map((item) => (item.siteId === site.siteId ? { ...item, ...patch } : item)))
    return { ok: true, message: '网站基本信息已保存（本地演示）' }
  }
  const seed = SITE_SEEDS.find((item) => item.siteId === site.siteId)
  if (!seed) return { ok: false, message: '网站不存在' }
  Object.assign(seed, patch)
  return { ok: true, message: '网站基本信息已保存（本地演示）' }
}

export function mockSiteSourcesOf(params?: Record<string, unknown>): Source[] {
  return sourcesOfSite(String(params?.siteId ?? ''))
}

// 网站下新增源默认只建名称/URL，流程从空白开始；inherit=true 仅保留给旧数据迁移兼容场景。
export function mockSiteSourceAdd(params?: Record<string, unknown>): { ok: boolean; message?: string; sourceId?: string } {
  const siteId = String(params?.siteId ?? '')
  const source = params?.source as Source | undefined
  const inherit = params?.inherit === true
  if (!siteId || !source) return { ok: false, message: '缺少网站或源信息' }
  const res = mockSourceCreate({ source: { ...source, siteId } })
  if (res.ok && res.sourceId && inherit) {
    const siteFlow = mockFlowLoad({ id: `site:${siteId}` })
    if (siteFlow) {
      mockFlowSave({ def: { ...siteFlow, id: res.sourceId, name: source.name || siteFlow.name } })
      // 刚从模板初始化、尚未被用户单独改动：mockFlowSave 的通用副作用会误标 detached，这里立即复位
      setSourceDetached(res.sourceId, false)
    }
  }
  return res
}

function tableIdsOf(flow: FlowDef, source: Source): string[] {
  const tableIds = new Set<string>([source.mainTable])
  Object.values(flow.configs).forEach((cfg) => {
    ;[cfg.collectCfg?.inputTable, cfg.collectCfg?.outputTable, cfg.inputTable, cfg.outputTable]
      .filter(Boolean)
      .forEach((tableId) => tableIds.add(tableId!))
  })
  return [...tableIds]
}

function remapTables(cfg: NodeConfig, tableIdMap: Record<string, string>): void {
  if (cfg.collectCfg?.inputTable) cfg.collectCfg.inputTable = tableIdMap[cfg.collectCfg.inputTable] ?? cfg.collectCfg.inputTable
  if (cfg.collectCfg?.outputTable) cfg.collectCfg.outputTable = tableIdMap[cfg.collectCfg.outputTable] ?? cfg.collectCfg.outputTable
  if (cfg.inputTable) cfg.inputTable = tableIdMap[cfg.inputTable] ?? cfg.inputTable
  if (cfg.outputTable) cfg.outputTable = tableIdMap[cfg.outputTable] ?? cfg.outputTable
}

/** 源复制是原子 BFF 命令：仅复制流程、节点配置及表结构，不读取数据、文件和任务运行实例。 */
export function mockSiteCloneSource(params?: Record<string, unknown>): SourceCloneResult {
  const request = params as unknown as SourceCloneRequest
  const template = SOURCES.find((source) => source.sourceId === request.templateSourceId)
  if (!template) throw new Error(`模板源「${request.templateSourceId}」不存在`)
  if (!allSites().some((site) => site.siteId === request.targetSiteId)) throw new Error(`目标网站「${request.targetSiteId}」不存在`)

  const sourceId = `src-copy-${Date.now().toString(36)}-${cloneSequence++}`
  const source: Source = {
    sourceId,
    name: request.target.name,
    url: request.target.url,
    configId: template.configId,
    mainTable: template.mainTable,
    owner: template.owner,
    state: 'C',
    siteId: request.targetSiteId,
  }
  const created = mockSourceCreate({ source })
  if (!created.ok) throw new Error(created.message)

  const stored = mockFlowLoad({ id: template.sourceId })
  const flow = stored
    ? structuredClone(stored)
    : {
        id: sourceId,
        name: source.name,
        version: 'clone-v1',
        ...buildSourceSeed(source, mockSourceSteps({ sourceId: template.sourceId }).map((step) => ({
          ...step,
          sourceId,
          stepId: step.stepId.replace(template.sourceId, sourceId),
        }))),
        updatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      }
  flow.id = sourceId
  flow.name = source.name
  flow.source = source

  const tableIdMap: Record<string, string> = {}
  tableIdsOf(flow, template).forEach((tableId) => {
    const cloned = cloneEntryStructure(tableId, sourceId)
    if (cloned) tableIdMap[tableId] = cloned.tableId
  })
  Object.values(flow.configs).forEach((cfg) => remapTables(cfg, tableIdMap))
  source.mainTable = tableIdMap[source.mainTable] ?? source.mainTable
  Object.assign(SOURCES.find((item) => item.sourceId === sourceId)!, { mainTable: source.mainTable })
  mockFlowSave({ def: flow })
  setSourceDetached(sourceId, false)
  return { source, flowId: sourceId, tableIdMap }
}

// 按网站批量导入源：一行一条「名称;URL」（URL 可省略），空行/缺名称行跳过；
// 复用新增源创建路径，所有导入项从空白流程开始。
export function mockSiteImportSources(params?: Record<string, unknown>): { ok: boolean; message?: string; added?: number; skipped?: number } {
  const siteId = String(params?.siteId ?? '')
  const lines = String(params?.lines ?? '')
  if (!siteId) return { ok: false, message: '缺少目标网站' }
  if (!allSites().some((s) => s.siteId === siteId)) return { ok: false, message: `网站「${siteId}」不存在` }
  const rows = lines.split(/\r?\n/).map((l) => l.trim())
  let added = 0
  let skipped = 0
  const stamp = Date.now().toString(36)
  rows.forEach((row, i) => {
    if (!row) return
    const [name, url = ''] = row.split(/[;；]/).map((v) => v.trim())
    if (!name) {
      skipped++
      return
    }
    const res = mockSiteSourceAdd({
      siteId,
      inherit: false,
      source: {
        sourceId: `${siteId}-imp-${stamp}-${i + 1}`,
        name, url, configId: '', mainTable: '',
        owner: allSites().find((s) => s.siteId === siteId)?.owner || 'admin',
        state: 'C',
      },
    })
    if (res.ok) added++
    else skipped++
  })
  if (!added) return { ok: false, message: '没有可导入的行，请检查「名称;URL」格式' }
  return { ok: true, added, skipped, message: `已导入 ${added} 条源${skipped ? `、跳过 ${skipped} 条` : ''}（本地演示）` }
}

// 网站下移除源（危险端点）：仅从通用 SOURCES 摘除（语言演示数据是只读种子，不支持移除）。
export function mockSiteSourceRemove(params?: Record<string, unknown>): Ack {
  const siteId = String(params?.siteId ?? '')
  const sourceId = String(params?.sourceId ?? '')
  const idx = SOURCES.findIndex((s) => s.sourceId === sourceId && s.siteId === siteId)
  if (idx < 0) return { ok: false, message: '源不存在或不属于该网站' }
  SOURCES.splice(idx, 1)
  return { ok: true, demo: true, message: '源已移除（本地演示）' }
}

// 源间流程同步（危险端点，0716）：把源头已保存的流程整条覆盖到同网站所选源，
// 不经网站统一模板（0714 后网站本身没有流程）；整条覆盖，不做节点级 diff 合并（首期口径）。
// 同步成功的目标源复位 detached=false（与同步来源一致；此后单独保存会重新标 true）。
export function mockSiteSyncFlow(params?: Record<string, unknown>): Ack {
  const siteId = String(params?.siteId ?? '')
  const fromSourceId = String(params?.fromSourceId ?? '')
  const requestedSourceIds = Array.isArray(params?.sourceIds) ? params.sourceIds.map(String) : []
  const sourceIds = [...new Set(requestedSourceIds.filter((id) => id !== fromSourceId))]
  if (!siteId || !fromSourceId || !sourceIds.length) return { ok: false, message: '缺少网站、源头或目标源' }
  const siteSourceIds = new Set(sourcesOfSite(siteId).map((source) => source.sourceId))
  if (!siteSourceIds.has(fromSourceId)) return { ok: false, message: '源头不存在或不属于该网站' }
  if (sourceIds.some((sourceId) => !siteSourceIds.has(sourceId))) {
    return { ok: false, message: '目标源不存在或不属于该网站' }
  }
  const fromFlow = mockFlowLoad({ id: fromSourceId })
  if (!fromFlow) return { ok: false, message: '源头还没有已保存的流程' }
  sourceIds.forEach((sourceId) => {
    mockFlowSave({ def: { ...fromFlow, id: sourceId } })
    setSourceDetached(sourceId, false)
  })
  return { ok: true, demo: true, message: `已同步到 ${sourceIds.length} 个源（本地演示）` }
}

// 任务视图网站化（0707 优化·Phase5）：队列粒度聚合，网站下全部源节点按队列去重；sourceId 可选进一步收窄到单个源。
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
