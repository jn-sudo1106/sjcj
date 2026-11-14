// 流程中心「模板 → 实例」演示数据（1109 方案 §5；C02/C09/C10/C12 后端未就绪时按同一形状返回）。
//
// 数值直接对齐交互原型 `设计稿/设计方案/1109-流程模板与实例_交互原型_2026-11-09.html`，
// 让页面在 mock 模式下的视觉/计数与原型一致；接真实后端后只需把 endpoints.ts 里对应条目标 live，
// 并把 httpEndpoint 指到真实路径，页面不用改。
import type {
  BatchJob,
  ConfigDiffResult,
  InstanceDraftPayload,
  InstanceDraftResult,
  InstancePageCond,
  InstanceRow,
  Paged,
  ScopeIntent,
  ScopePreview,
  StartBatchPayload,
  TemplateMeta,
  UnclassifiedRow,
  UnclassifiedStatus,
} from '../types/flowCenterCenter'

const TPL_ANNOUNCE = 'tpl-announce-detail'
const TPL_SINGLE = 'tpl-single-list'
const TPL_LOGIN = 'tpl-detail-login'
const TPL_FILE = 'tpl-file-download'
const TPL_TRANSLATE = 'tpl-list-translate'
const TPL_SQL = 'tpl-list-sql'

export const TEMPLATES: TemplateMeta[] = [
  {
    id: TPL_ANNOUNCE,
    name: '公告列表→详情',
    sourceCount: 86,
    instanceCount: 312,
    updatedAt: '11-08',
    structure: {
      nodes: [
        { id: 'n1', kind: 'start', label: '开始' },
        { id: 'n2', kind: 'capture', label: '列表采集', code: 'web-list' },
        { id: 'n3', kind: 'capture', label: '详情采集', code: 'web-detail' },
        { id: 'n4', kind: 'rule', label: '规则处理', code: 'rule-1' },
        { id: 'n5', kind: 'out', label: '写入数据库', code: 'db-out' },
        { id: 'n6', kind: 'end', label: '结束' },
      ],
      branches: ['详情采集 → 翻译'],
      fingerprint: '#8f3c-6n-2b',
    },
  },
  {
    id: TPL_SINGLE,
    name: '单页列表入库',
    sourceCount: 23,
    instanceCount: 48,
    updatedAt: '11-05',
    structure: {
      nodes: [
        { id: 'n1', kind: 'start', label: '开始' },
        { id: 'n2', kind: 'capture', label: '列表采集', code: 'web-list' },
        { id: 'n3', kind: 'out', label: '写入数据库', code: 'db-out' },
        { id: 'n4', kind: 'end', label: '结束' },
      ],
      branches: [],
      fingerprint: '#4a12-9k-7d',
    },
  },
  {
    id: TPL_LOGIN,
    name: '详情补采（需登录）',
    sourceCount: 12,
    instanceCount: 12,
    updatedAt: '11-03',
    structure: {
      nodes: [
        { id: 'n1', kind: 'start', label: '开始' },
        { id: 'n2', kind: 'other', label: '登录', code: 'login' },
        { id: 'n3', kind: 'capture', label: '详情采集', code: 'web-detail' },
        { id: 'n4', kind: 'rule', label: '规则处理', code: 'rule-1' },
        { id: 'n5', kind: 'end', label: '结束' },
      ],
      branches: [],
      fingerprint: '#77de-1c-5a',
    },
  },
  {
    id: TPL_FILE,
    name: '文件下载→解压',
    sourceCount: 6,
    instanceCount: 6,
    updatedAt: '11-01',
    structure: {
      nodes: [
        { id: 'n1', kind: 'start', label: '开始' },
        { id: 'n2', kind: 'capture', label: '文件下载', code: 'file-download' },
        { id: 'n3', kind: 'other', label: '解压', code: 'unzip' },
        { id: 'n4', kind: 'out', label: '入库', code: 'db-out' },
        { id: 'n5', kind: 'end', label: '结束' },
      ],
      branches: [],
      fingerprint: '#2b90-ee-31',
    },
  },
  {
    id: TPL_TRANSLATE,
    name: '列表→翻译→入库',
    sourceCount: 3,
    instanceCount: 3,
    updatedAt: '10-30',
    structure: {
      nodes: [
        { id: 'n1', kind: 'start', label: '开始' },
        { id: 'n2', kind: 'capture', label: '列表采集', code: 'web-list' },
        { id: 'n3', kind: 'other', label: '翻译', code: 'translate' },
        { id: 'n4', kind: 'out', label: '入库', code: 'db-out' },
        { id: 'n5', kind: 'end', label: '结束' },
      ],
      branches: [],
      fingerprint: '#915c-4d-8e',
    },
  },
  {
    id: TPL_SQL,
    name: '列表→SQL 直写（旧）',
    sourceCount: 4,
    instanceCount: 4,
    updatedAt: '10-28',
    structure: {
      nodes: [
        { id: 'n1', kind: 'start', label: '开始' },
        { id: 'n2', kind: 'capture', label: '列表采集', code: 'web-list' },
        { id: 'n3', kind: 'out', label: 'SQL 写入', code: 'sql-out' },
        { id: 'n4', kind: 'end', label: '结束' },
      ],
      branches: [],
      fingerprint: '#3f01-a7-62',
    },
  },
]

function row(row: Omit<InstanceRow, 'templateName'> & { templateName?: string }): InstanceRow {
  const tpl = TEMPLATES.find(item => item.id === row.templateId)
  return { ...row, templateName: row.templateName ?? tpl?.name ?? '' }
}

export const INSTANCES: InstanceRow[] = [
  row({
    id: '3812',
    name: '证监会公告·沪深',
    templateId: TPL_ANNOUNCE,
    sites: ['上市公司网站', '深交所网站', '上交所网站'],
    summary: ['tb_announcement → tb_notice_detail', '脚本 v3'],
    sourceCount: 86,
    defaultSourceCount: 86,
    maintainer: '张工',
    updatedAt: '11-08 14:22',
  }),
  row({
    id: '3901',
    name: '深交所公告·列表',
    templateId: TPL_ANNOUNCE,
    sites: ['深交所网站'],
    summary: ['tb_szse_list → tb_szse_notice', '脚本 v2'],
    sourceCount: 8,
    defaultSourceCount: 8,
    updatedAt: '11-07 09:15',
  }),
  row({
    id: '3877',
    name: '上交所公告·规则版',
    templateId: TPL_ANNOUNCE,
    sites: ['上市公司网站'],
    summary: ['tb_sse_raw → tb_sse_std', '脚本 v4'],
    sourceCount: 6,
    defaultSourceCount: 6,
    updatedAt: '11-06 18:03',
  }),
  row({
    id: '3770',
    name: '公告详情抓取',
    templateId: TPL_ANNOUNCE,
    sites: ['上市公司网站', '深交所网站'],
    summary: ['tb_announce_detail', '脚本 v2'],
    sourceCount: 12,
    defaultSourceCount: 12,
    updatedAt: '11-05 10:41',
  }),
  row({
    id: '3502',
    name: '公告归档（历史）',
    templateId: TPL_ANNOUNCE,
    sites: ['上市公司网站'],
    summary: ['仅归档', '无输出表'],
    sourceCount: 5,
    defaultSourceCount: 5,
    updatedAt: '10-21 11:40',
  }),
  row({
    id: '3555',
    name: '公告补采·旧版',
    templateId: TPL_ANNOUNCE,
    sites: ['上市公司网站'],
    summary: ['tb_notice_old', '脚本 v1'],
    sourceCount: 3,
    defaultSourceCount: 3,
    updatedAt: '10-18 16:22',
  }),
  row({
    id: '3601',
    name: '北交所公告·草稿',
    templateId: TPL_ANNOUNCE,
    sites: ['上市公司网站'],
    summary: ['待补齐：输出表 / 脚本模板'],
    sourceCount: 0,
    defaultSourceCount: 0,
    updatedAt: '11-10 09:12',
    draft: true,
    scopeIntentCount: 12,
  }),
  row({
    id: '3640',
    name: '公告列表·只入库',
    templateId: TPL_ANNOUNCE,
    sites: ['上市公司网站'],
    summary: ['tb_list_only'],
    sourceCount: 1,
    defaultSourceCount: 1,
    updatedAt: '10-09 09:03',
  }),
  row({
    id: '4100',
    name: '新浪财经·单页入库',
    templateId: TPL_SINGLE,
    sites: ['新浪财经'],
    summary: ['tb_sina_news'],
    sourceCount: 6,
    defaultSourceCount: 6,
    updatedAt: '11-04 15:12',
  }),
  row({
    id: '4112',
    name: '同花顺·快讯入库',
    templateId: TPL_SINGLE,
    sites: ['同花顺'],
    summary: ['tb_ths_flash'],
    sourceCount: 3,
    defaultSourceCount: 3,
    updatedAt: '10-30 11:20',
  }),
  row({
    id: '4201',
    name: '巨潮·登录补采',
    templateId: TPL_LOGIN,
    sites: ['巨潮资讯'],
    summary: ['tb_cninfo_detail'],
    sourceCount: 2,
    defaultSourceCount: 2,
    updatedAt: '11-02 09:33',
  }),
  row({
    id: '4301',
    name: '招股书·下载解压',
    templateId: TPL_FILE,
    sites: ['上市公司网站'],
    summary: ['tb_prospectus'],
    sourceCount: 1,
    defaultSourceCount: 1,
    updatedAt: '10-27 14:05',
  }),
]

/** 覆盖网站下拉候选（原型只有「上市公司网站」，另外补两个让筛选看起来是真的）。 */
export const SITES = ['上市公司网站', '深交所网站', '上交所网站']

const drafts: InstanceRow[] = []
let draftSeq = 5000
const jobs = new Map<string, BatchJob>()
let jobSeq = 8821

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function asScope(value: unknown): ScopeIntent {
  const raw = asRecord(value)
  const mode = String(raw.mode ?? 'site-all')
  return {
    sites: Array.isArray(raw.sites) ? raw.sites.map(String) : [],
    mode: mode === 'unbound' || mode === 'manual' || mode === 'skip' ? mode : 'site-all',
    manualSourceIds: Array.isArray(raw.manualSourceIds) ? raw.manualSourceIds.map(String) : [],
    setDefault: Boolean(raw.setDefault),
  }
}

function matchInstance(item: InstanceRow, cond: InstancePageCond): boolean {
  if (cond.templateId && item.templateId !== cond.templateId) return false
  if (cond.status === 'draft' && !item.draft) return false
  if (cond.status === 'active' && item.draft) return false
  if (cond.site && !item.sites.includes(cond.site)) return false
  if (cond.keyword) {
    const kw = cond.keyword.trim().toLowerCase()
    const haystack = [item.name, item.id, item.summary.join(' '), item.templateName].join(' ').toLowerCase()
    if (!haystack.includes(kw)) return false
  }
  return true
}

export function mockFlowCenterTemplateMetas(): TemplateMeta[] {
  return TEMPLATES.map(tpl => ({
    ...tpl,
    instanceCount: tpl.instanceCount + drafts.filter(item => item.templateId === tpl.id).length,
  }))
}

export function mockFlowCenterInstancePaged(params?: Record<string, unknown>): Paged<InstanceRow> {
  const raw = asRecord(params)
  const cond: InstancePageCond = {
    templateId: raw.templateId ? String(raw.templateId) : undefined,
    site: raw.site ? String(raw.site) : undefined,
    status: (raw.status as InstancePageCond['status']) ?? 'all',
    keyword: raw.keyword ? String(raw.keyword) : undefined,
    page: Number(raw.page ?? 1) || 1,
    pageSize: Number(raw.pageSize ?? 20) || 20,
  }
  const all = [...drafts, ...INSTANCES].filter(item => matchInstance(item, cond))
  const start = (cond.page! - 1) * cond.pageSize!
  return { list: all.slice(start, start + cond.pageSize!), total: all.length, page: cond.page!, pageSize: cond.pageSize! }
}

export function mockFlowCenterScopePreview(params?: Record<string, unknown>): ScopePreview {
  const raw = asRecord(params)
  const scope = asScope(raw.scope)
  if (scope.mode === 'skip') {
    return { templateId: String(raw.templateId ?? ''), total: 0, toAdd: 0, toSkip: 0, groupSources: 0, expectedUnavailable: 0, defaultFilled: 0 }
  }
  if (scope.mode === 'manual') {
    const total = scope.manualSourceIds.length
    return { templateId: String(raw.templateId ?? ''), total, toAdd: total, toSkip: 0, groupSources: 0, expectedUnavailable: 0, defaultFilled: scope.setDefault ? total : 0 }
  }
  // 与原型截图一致：该网站全部源 6,564；预计新增 6,553 / 跳过 0 / 组内源 5 / 预计不可操作 6。
  const total = scope.mode === 'unbound' ? 5988 : 6564
  const groupSources = 5
  const expectedUnavailable = scope.mode === 'unbound' ? 4 : 6
  const toSkip = 0
  const toAdd = total - groupSources - expectedUnavailable - toSkip
  return {
    templateId: String(raw.templateId ?? ''),
    total,
    toAdd,
    toSkip,
    groupSources,
    expectedUnavailable,
    defaultFilled: scope.setDefault ? toAdd : 0,
  }
}

export function mockFlowCenterCreateDraft(params?: Record<string, unknown>): InstanceDraftResult {
  const payload = asRecord(params) as unknown as InstanceDraftPayload
  const scope = asScope(payload.scope)
  const preview = mockFlowCenterScopePreview({ templateId: payload.templateId, scope })
  const tpl = TEMPLATES.find(item => item.id === payload.templateId)
  const id = String(++draftSeq)
  const draft: InstanceRow = {
    id,
    name: payload.name || '未命名实例',
    templateId: payload.templateId,
    templateName: tpl?.name ?? '',
    sites: scope.sites.length ? scope.sites : SITES.slice(0, 1),
    summary: ['待补齐：输出表 / 脚本模板'],
    sourceCount: 0,
    defaultSourceCount: 0,
    updatedAt: '刚刚',
    draft: true,
    scopeIntentCount: preview.total,
  }
  drafts.unshift(draft)
  return { id, name: draft.name, templateId: draft.templateId, scopeIntentCount: preview.total, createdAt: new Date().toISOString() }
}

function advance(job: BatchJob): BatchJob {
  if (job.status !== 'running' && job.status !== 'pending') return job
  if (job.processed >= job.total) {
    job.status = 'done'
    job.pending = 0
    job.running = 0
    return job
  }
  const batchSize = job.batchSize
  const step = Math.min(batchSize, job.total - job.processed)
  job.processed += step
  job.batchIndex = Math.min(job.batchTotal, Math.floor(job.processed / batchSize) + (job.processed % batchSize ? 1 : 0))
  // 失败只在冻结时预计过的少数并发锁冲突上出现（与原型「失败 6（并发锁）」一致）。
  const failQuota = 6
  const addedSoFar = Math.max(0, job.processed - Math.min(job.processed, job.skipped + job.failed))
  job.added = Math.max(job.added, addedSoFar)
  job.failed = Math.min(failQuota, Math.floor(job.processed / 1100))
  job.skipped = Math.min(46, Math.floor(job.processed / 160))
  job.added = Math.max(0, job.processed - job.skipped - job.failed)
  job.pending = Math.max(0, job.total - job.processed - Math.min(batchSize, job.total - job.processed))
  job.running = job.processed >= job.total ? 0 : Math.min(batchSize, job.total - job.processed)
  if (job.failed > 0) {
    job.failures = Array.from({ length: job.failed }, (_, index) => ({
      sourceId: `S${900000 + index}`,
      sourceName: ['东方财富公告', '中证网公告', '证券时报公告', '上交所披露', '深交所披露', '巨潮公告'][index] ?? `源 ${index + 1}`,
      reason: '并发锁冲突（源绑定快照已变化），可重试',
    }))
  }
  if (job.processed >= job.total) {
    job.status = 'done'
    job.pending = 0
    job.running = 0
  }
  return job
}

export function mockFlowCenterStartBatch(params?: Record<string, unknown>): BatchJob {
  const payload = asRecord(params) as unknown as StartBatchPayload
  const preview = mockFlowCenterScopePreview({ scope: payload.scope })
  const total = preview.total
  const jobId = `job-${++jobSeq}`
  const job: BatchJob = {
    jobId,
    instanceId: payload.instanceId,
    scopeToken: payload.scopeToken,
    batchIndex: 0,
    batchTotal: Math.max(1, Math.ceil(total / 200)),
    batchSize: 200,
    total,
    processed: 0,
    added: 0,
    skipped: 0,
    failed: 0,
    defaultFilled: 0,
    status: 'running',
    pending: total,
    running: Math.min(200, total),
    failures: [],
  }
  jobs.set(jobId, job)
  return { ...job }
}

export function mockFlowCenterBatchJob(params?: Record<string, unknown>): BatchJob {
  const jobId = String(asRecord(params).jobId ?? '')
  const job = jobs.get(jobId)
  if (!job) throw new Error('批量绑定作业不存在或已过期')
  advance(job)
  return { ...job, failures: [...job.failures] }
}

export function mockFlowCenterDiff(params?: Record<string, unknown>): ConfigDiffResult {
  const raw = asRecord(params)
  const baseId = String(raw.baseId ?? '')
  const compareId = String(raw.compareId ?? '')
  const all = [...drafts, ...INSTANCES]
  const base = all.find(item => item.id === baseId) ?? all[0]
  const compare = all.find(item => item.id === compareId) ?? all[1] ?? all[0]
  const result: ConfigDiffResult = {
    base: { id: base.id, name: base.name },
    compare: { id: compare.id, name: compare.name },
    baseSourceCount: base.sourceCount,
    compareSourceCount: compare.sourceCount,
    changedCount: 5,
    sections: [
      {
        title: '全局配置',
        items: [
          { label: '输出表（一）', base: 'tb_announcement', compare: 'tb_sse_raw' },
          { label: '输出表（二）· 回填', base: 'tb_notice_detail', compare: '未启用' },
          { label: '写入模式', base: '增量写入', compare: '增量写入' },
          { label: '增量字段', base: 'NOTICE_ID', compare: 'NOTICE_ID' },
        ],
      },
      {
        title: '步骤级配置',
        items: [
          { label: '详情采集 · 请求头', base: '含 Referer', compare: '未配置 Referer' },
          { label: '规则处理 · 清洗规则', base: '3 条规则', compare: '2 条规则' },
          { label: '脚本模板', base: '脚本 v3', compare: '脚本 v2' },
        ],
      },
    ],
    schedules: [
      { sourceName: '证监会公告·沪深', taskName: '公告抓取 A', at: '每天 06:00' },
      { sourceName: '深交所公告列表', taskName: '公告抓取 B', at: '每天 07:30' },
      { sourceName: '上交所公告规则版', taskName: '公告抓取 C', at: '每天 06:00' },
    ],
  }
  return result
}

export const UNCLASSIFIED: UnclassifiedRow[] = [
  {
    id: '2001',
    name: '上交所公告·旧',
    oldTemplate: '上市公司公告',
    chain: '列表采集→详情采集→规则处理',
    suggestedTemplateId: TPL_ANNOUNCE,
    suggestedTemplateName: '公告列表→详情',
    reason: '结构一致，仅配置不同',
    status: 'pending',
  },
  {
    id: '2180',
    name: '新浪财经要闻',
    oldTemplate: '',
    chain: '列表采集→详情采集',
    suggestedTemplateId: TPL_SINGLE,
    suggestedTemplateName: '单页列表入库',
    reason: '节点数与连接不同',
    status: 'pending',
  },
  {
    id: '2301',
    name: '贵州茅台公告',
    oldTemplate: '公告归档',
    chain: '列表采集→详情采集',
    suggestedTemplateId: null,
    suggestedTemplateName: '—',
    reason: '边信息不完整',
    status: 'pending',
  },
  {
    id: '2450',
    name: '招股说明书下载',
    oldTemplate: '',
    chain: '文件下载→解压→入库',
    suggestedTemplateId: TPL_FILE,
    suggestedTemplateName: '文件下载→解压',
    reason: '结构一致，仅启停不同',
    status: 'pending',
  },
  {
    id: '2512',
    name: '巨潮公告',
    oldTemplate: '',
    chain: '列表采集→详情采集→规则处理→写入数据库',
    suggestedTemplateId: TPL_ANNOUNCE,
    suggestedTemplateName: '公告列表→详情',
    reason: '多一条失败回退分支，待确认是否升级模板',
    status: 'pending',
  },
]

export function mockFlowCenterUnclassified(params?: Record<string, unknown>): { list: UnclassifiedRow[]; total: number; scannedAt: string } {
  const raw = asRecord(params)
  const keyword = raw.keyword ? String(raw.keyword).trim().toLowerCase() : ''
  const list = UNCLASSIFIED.filter(item => !keyword || [item.name, item.chain, item.oldTemplate].join(' ').toLowerCase().includes(keyword))
  return { list: list.map(item => ({ ...item })), total: 27, scannedAt: '11-10 09:31' }
}

export function mockFlowCenterAssignUnclassified(params?: Record<string, unknown>): { ok: boolean } {
  const raw = asRecord(params)
  const id = String(raw.id ?? '')
  const templateId = String(raw.templateId ?? '')
  const target = UNCLASSIFIED.find(item => item.id === id)
  if (!target) throw new Error('流程不存在')
  const tpl = TEMPLATES.find(item => item.id === templateId)
  if (!tpl) throw new Error('目标模板不存在')
  target.oldTemplate = tpl.name
  target.suggestedTemplateId = tpl.id
  target.suggestedTemplateName = tpl.name
  target.status = 'confirmed' as UnclassifiedStatus
  return { ok: true }
}

/** 直接修改一条归类状态（批量归集本期不做，只支持单条确认/忽略）。 */
export function mockFlowCenterSetUnclassifiedStatus(params?: Record<string, unknown>): { ok: boolean } {
  const raw = asRecord(params)
  const id = String(raw.id ?? '')
  const status = String(raw.status ?? '') as UnclassifiedStatus
  const target = UNCLASSIFIED.find(item => item.id === id)
  if (!target) throw new Error('流程不存在')
  if (status !== 'pending' && status !== 'confirmed' && status !== 'skipped') throw new Error('状态不合法')
  target.status = status
  return { ok: true }
}