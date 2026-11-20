// 智能体对话建源：草稿协议、回查、校验与执行。
//
// 方案：设计稿/设计方案/1120-智能体对话建源_前端与智能体Skill开发方案_2026-11-20.md
// Skill 契约：设计稿/设计方案/1120-智能体对话建源_智能体Skill需求说明_2026-11-20.md
// 智能体只出草稿（网站名、源名/URL、分类名、模板名、参考源名），不给任何 ID；网站是否存在、分类、
// 流程模板由前端回查后在卡片里让用户确认。落库复用「新建采集」「新增源」现有接口链路。
import {
  flowCenterApi,
  isProductionCreateEnabled,
  siteApi,
  sourceApi,
  workflowBindingApi,
  type Site,
  type Source,
} from '@/api'
import { BIZ_DIR_ROOT_ID, searchDirs } from '@/api/sourceDirs'
import { urlOrPlaceholder } from '@/utils/source/placeholderUrl'
import { addSourcesToBizDirNote, createSharedFlow } from '@/utils/source/createCollect'
import { repairJsonBrackets } from './tableDraft'

// ===== 草稿（智能体输出） =====

export interface SourceDraftItem {
  name: string
  url: string
}

export interface SourceDraft {
  /** 网站名；空 = 不关联网站 */
  siteName: string
  /** 业务分类名称（提示） */
  category: string
  /** 流程模板名称（提示） */
  flowTemplate: string
  /** 参考源名称（「和 XX 源一样」），用于按模板源复制流程 */
  templateSource: string
  sources: SourceDraftItem[]
  remark: string
}

function str(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

/** 归一化智能体草稿（snake_case、外层 source_draft 键也认）；连源都没有返回 null */
export function normalizeSourceDraft(raw: unknown): SourceDraft | null {
  if (!raw || typeof raw !== 'object') return null
  const src = raw as Record<string, unknown>
  const nested = src.source_draft ?? src.sourceDraft
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) return normalizeSourceDraft(nested)
  const rawSources = src.sources ?? src.items
  if (!Array.isArray(rawSources)) return null
  const sources = rawSources
    .map((item): SourceDraftItem | null => {
      if (typeof item === 'string') return item.trim() ? { name: item.trim(), url: '' } : null
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const name = str(row.name ?? row.sourceName ?? row.source_name ?? row.title)
      return name ? { name, url: str(row.url ?? row.sourceUrl ?? row.source_url) } : null
    })
    .filter((item): item is SourceDraftItem => !!item)
  if (!sources.length) return null
  return {
    siteName: str(src.siteName ?? src.site_name ?? src.site),
    category: str(src.category ?? src.categoryName ?? src.category_name),
    flowTemplate: str(src.flowTemplate ?? src.flow_template ?? src.template),
    templateSource: str(src.templateSource ?? src.template_source ?? src.referenceSource),
    sources,
    remark: str(src.remark ?? src.description ?? src.note),
  }
}

const FENCE = /```([\w-]*)[^\n]*\n?([\s\S]*?)```/g
const DRAFT_KEY = /"(?:source_draft|sourceDraft)"\s*:/

function isDraftFence(lang: string, body: string): boolean {
  if (/^source-draft$/i.test(lang)) return true
  return /^(json|json5|javascript|js)?$/i.test(lang) && DRAFT_KEY.test(body)
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    try {
      return JSON.parse(repairJsonBrackets(raw))
    } catch {
      return null
    }
  }
}

/** 正文里是否含建源草稿代码块（含流式中尚未闭合的） */
export function hasSourceDraftBlock(text: string): boolean {
  if (!text) return false
  return /```source-draft/i.test(text) || (/```(json|json5|js|javascript)?\s*\n/i.test(text) && DRAFT_KEY.test(text))
}

/** 从回答正文取建源草稿（取最后一个可解析的；流式未闭合不算） */
export function extractSourceDraftFromText(text: string): SourceDraft | null {
  if (!hasSourceDraftBlock(text)) return null
  const all = [...text.matchAll(FENCE)].filter((m) => isDraftFence(m[1], m[2]))
  for (let i = all.length - 1; i >= 0; i--) {
    const draft = normalizeSourceDraft(parseJson(all[i][2]))
    if (draft) return draft
  }
  return null
}

/** 渲染正文时去掉草稿代码块（由卡片承载）；流式中未闭合的块也藏掉 */
export function stripSourceDraftBlock(text: string): string {
  if (!text) return text
  let out = text.replace(FENCE, (whole, lang: string, body: string) => (isDraftFence(lang, body) ? '' : whole))
  out = out.replace(/```source-draft[\s\S]*$/i, '')
  const open = out.match(/```(json|json5|js|javascript)?[^\n]*\n(?![\s\S]*```)([\s\S]*)$/i)
  if (open && DRAFT_KEY.test(open[2])) out = out.slice(0, open.index)
  return out.trim()
}

// ===== 意图识别与格式要求（智能体路由不稳定时的兜底，同建表） =====

export const SOURCE_DRAFT_INSTRUCTION_MARKER = '<!-- source-draft-mode -->'
const CREATED_PREFIX = '【建源结果】'

/**
 * 用户消息是否明确要新建源 / 新建采集（「建个采集」「加一个…源」「新建…源」）。
 * 排除结果回传和「新建的源有哪些 / 多少个源」这类查询说法。建表意图优先，由调用方先判。
 */
export function isCreateSourceIntent(text: string): boolean {
  const content = (text || '').trim()
  if (!content || content.startsWith(CREATED_PREFIX)) return false
  if (/有哪些|有多少|多少个|查询|查一下|查查|列出|统计一下|看看|是否有|有没有/.test(content)) return false
  return /(新建|创建|建|加|添加|新增)(一个|一些|几个|两个|个|\d+\s*个)?[^，。,.\n]{0,20}(源|采集)|新建采集|建(个|一个)?采集/.test(content)
}

export function buildSourceDraftPrompt(userText: string): string {
  return `${userText.trim()}

${SOURCE_DRAFT_INSTRUCTION_MARKER}
【建源模式】请把上面的需求整理成建源草稿。只输出草稿，不要查询数据、不要执行 SQL、不要实际建源，也不要说平台不支持。
先用一两句话说明整理结果和假设，然后输出一个 \`\`\`source-draft 代码块，内容是一个 JSON 对象：
{"siteName":"网站名称；用户说不挂网站或没有网站概念时为空字符串","category":"业务分类名称，可空","flowTemplate":"流程模板名称，可空","templateSource":"用户说和某个源一样时填那个源的名称，可空","sources":[{"name":"源名称","url":"源地址，没有就空字符串"}],"remark":"你的假设与提醒"}
要求：至少一个源，源名称不重复；不要编造 URL；不要输出任何 ID（网站/分类/模板/源 ID 由系统回查）。`
}

export function stripSourceDraftPrompt(text: string): string {
  if (!text) return text
  const idx = text.indexOf(SOURCE_DRAFT_INSTRUCTION_MARKER)
  return idx >= 0 ? text.slice(0, idx).trim() : text
}

export function isSourceDraftPrompt(text: string): boolean {
  return !!text && text.includes(SOURCE_DRAFT_INSTRUCTION_MARKER)
}

// ===== 卡片表单（回查后、用户确认的版本） =====

export type SourceSiteMode = 'new' | 'existing' | 'none'
/** template：按流程模板新建；copy：复制参考源的默认流程（仅已有网站）；none：暂不建流程 */
export type SourceFlowMode = 'template' | 'copy' | 'none'

export interface SourceDraftForm {
  siteMode: SourceSiteMode
  /** new：要新建的网站名；existing：所选网站名 */
  siteName: string
  /** existing：所选网站 ID */
  siteId: string
  /** 业务目录（new 必选，none 选填） */
  dirId: string
  category: string
  categoryPath: string
  flowMode: SourceFlowMode
  templateId: string
  templateName: string
  /** copy：参考源 */
  templateSourceId: string
  templateSourceName: string
  sources: SourceDraftItem[]
}

export interface SourceDraftHints {
  /** 按名称回查到的同名网站 */
  existingSite: Pick<Site, 'siteId' | 'name' | 'sourceCount'> | null
  /** 智能体给的分类名匹配到的业务目录 */
  matchedCategory: { dirId: string; category: string } | null
  templates: Array<{ id: string; name: string }>
  /** 智能体给的模板名匹配到的模板 */
  matchedTemplateId: string
  /** 已有网站下的源（参考源候选） */
  siteSources: Array<{ sourceId: string; name: string }>
  /** 同名源（name → 已存在的源 ID） */
  duplicates: Record<string, string>
  /** 回查失败的说明（不阻断，用户可手动选） */
  warnings: string[]
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

async function settle<T>(task: Promise<T>, fallback: T, warnings: string[], label: string): Promise<T> {
  try {
    return await task
  } catch (error) {
    warnings.push(`${label}失败：${(error as Error)?.message ?? String(error)}`)
    return fallback
  }
}

/** 已有网站下的源（参考源候选） */
export async function loadSiteSourceOptions(siteId: string): Promise<Array<{ sourceId: string; name: string }>> {
  if (!siteId) return []
  const rows = await siteApi.siteSources(siteId)
  return rows.map((s: Source) => ({ sourceId: String(s.sourceId), name: s.name }))
}

/** 按网站名搜索网站（已有网站下拉用） */
export async function searchSites(keyword: string): Promise<Array<Pick<Site, 'siteId' | 'name' | 'sourceCount'>>> {
  const kw = keyword.trim()
  if (!kw) return []
  const page = await siteApi.sitePaged({ name: kw, page: 1, size: 20 })
  return page.list.map((s) => ({ siteId: String(s.siteId), name: s.name, sourceCount: s.sourceCount }))
}

/** 回查：同名网站、分类、模板、参考源、同名源。任何一项失败只记 warning，不阻断卡片 */
export async function resolveSourceDraft(draft: SourceDraft): Promise<SourceDraftHints> {
  const warnings: string[] = []
  const [sites, dirs, templates, dupLists] = await Promise.all([
    draft.siteName ? settle(searchSites(draft.siteName), [], warnings, '回查网站') : Promise.resolve([]),
    draft.category ? settle(searchDirs('biz', draft.category), [], warnings, '匹配业务分类') : Promise.resolve([]),
    settle(flowCenterApi.templates(), [], warnings, '读取流程模板'),
    Promise.all(draft.sources.map((s) => settle(sourceApi.sourcesByNameLike(s.name), [] as Source[], warnings, `查重「${s.name}」`))),
  ])
  const existingSite = sites.find((s) => sameName(s.name, draft.siteName)) ?? null
  const dir = dirs.find((d) => sameName(d.name, draft.category)) ?? (dirs.length === 1 ? dirs[0] : undefined)
  const templateOptions = templates
    .filter((t) => !t.disabled && t.state !== 'D')
    .map((t) => ({ id: String(t.id), name: t.name }))
  const tpl = draft.flowTemplate
    ? templateOptions.find((t) => sameName(t.name, draft.flowTemplate))
      ?? templateOptions.find((t) => t.name.includes(draft.flowTemplate) || draft.flowTemplate.includes(t.name))
    : undefined
  const siteSources = existingSite
    ? await settle(loadSiteSourceOptions(existingSite.siteId), [], warnings, '读取网站下的源')
    : []
  const duplicates: Record<string, string> = {}
  draft.sources.forEach((s, i) => {
    const hit = dupLists[i].find((row) => sameName(row.name, s.name))
    if (hit) duplicates[s.name] = String(hit.sourceId)
  })
  return {
    existingSite,
    matchedCategory: dir ? { dirId: dir.id, category: dir.name } : null,
    templates: templateOptions,
    matchedTemplateId: tpl?.id ?? '',
    siteSources,
    duplicates,
    warnings,
  }
}

/** 由草稿 + 回查结果得到卡片初始表单 */
export function initialSourceForm(draft: SourceDraft, hints: SourceDraftHints): SourceDraftForm {
  const siteMode: SourceSiteMode = !draft.siteName ? 'none' : hints.existingSite ? 'existing' : 'new'
  const refSource = draft.templateSource
    ? hints.siteSources.find((s) => sameName(s.name, draft.templateSource))
    : undefined
  const firstSiteSource = hints.siteSources[0]
  const template = hints.templates.find((t) => t.id === hints.matchedTemplateId) ?? hints.templates[0]
  // 已有网站：有参考源（智能体点名或网站第一个源）就默认复制它的流程，和手动「添加源 → 按模板源」一致
  const flowMode: SourceFlowMode = siteMode === 'existing' && (refSource || firstSiteSource) && !hints.matchedTemplateId
    ? 'copy'
    : template ? 'template' : 'none'
  const ref = refSource ?? firstSiteSource
  return {
    siteMode,
    siteName: siteMode === 'existing' ? hints.existingSite!.name : draft.siteName,
    siteId: siteMode === 'existing' ? hints.existingSite!.siteId : '',
    dirId: hints.matchedCategory?.dirId ?? '',
    category: hints.matchedCategory?.category ?? '',
    categoryPath: hints.matchedCategory?.category ?? '',
    flowMode,
    templateId: template?.id ?? '',
    templateName: template?.name ?? '',
    templateSourceId: ref?.sourceId ?? '',
    templateSourceName: ref?.name ?? '',
    sources: draft.sources.map((s) => ({ ...s })),
  }
}

export function validateSourceForm(form: SourceDraftForm): string[] {
  const errors: string[] = []
  if (form.siteMode === 'new' && !form.siteName.trim()) errors.push('请填写网站名称')
  if (form.siteMode === 'new' && !form.dirId) errors.push('新建网站需要选择业务分类')
  if (form.siteMode === 'existing' && !form.siteId) errors.push('请选择要加入的网站')
  if (form.flowMode === 'template' && !form.templateId) errors.push('请选择流程模板，或改选「暂不建流程」')
  if (form.flowMode === 'copy' && form.siteMode !== 'existing') errors.push('只有加到已有网站时才能复制参考源的流程')
  if (form.flowMode === 'copy' && !form.templateSourceId) errors.push('请选择参考源，或改选其它流程方式')
  if (!form.sources.length) errors.push('至少需要一个源')
  const names = form.sources.map((s) => s.name.trim())
  if (names.some((n) => !n)) errors.push('源名称不能为空')
  const filled = names.filter(Boolean)
  if (new Set(filled).size !== filled.length) errors.push('源名称有重复')
  return errors
}

// ===== 执行 =====

export type SourceStepStatus = 'running' | 'done' | 'failed' | 'skipped'
export interface SourceDraftStep {
  key: string
  label: string
  status: SourceStepStatus
  detail?: string
}

export interface SourceDraftResult {
  ok: boolean
  siteMode: SourceSiteMode
  siteId?: string
  siteName?: string
  sources: Array<{ name: string; sourceId: string }>
  flowIds: string[]
  /** 未建流程（用户选「暂不建流程」） */
  flowSkipped: boolean
  dirCategory?: string
  /** 失败或部分失败说明 */
  error?: string
}

type StepFn = (step: SourceDraftStep) => void

/**
 * 复制参考源失败的说明。186 实测（2026-11-20）：参考源的流程刚按模板建出来、还没配入口配置时，
 * 后端 copySource 直接拒绝（「流程…无法运行：ROOT未配置有效入口配置」），此时什么都没建。
 */
function copyFailureMessage(refName: string, raw?: string): string {
  const detail = (raw || '复制参考源失败').replace(/^请求异常 \[[^\]]*\]:\s*/, '')
  if (/入口配置|无法运行|没有发布|未发布/.test(detail)) {
    return `参考源「${refName}」的流程还没配置好，不能复制（${detail}）。请改选「按流程模板新建」或换一个参考源`
  }
  return `复制参考源「${refName}」失败：${detail}`
}

function blankSource(item: SourceDraftItem): Source {
  return {
    sourceId: '',
    name: item.name.trim(),
    url: urlOrPlaceholder(item.url.trim(), ''),
    configId: '',
    mainTable: '',
    owner: 'admin',
    state: 'C',
    // 分类只选业务目录：走分类—源关系表，源的系统目录 categoryId 留空（同新建采集）
    dirId: '',
  }
}

/**
 * 按表单执行建源。顺序执行、任一步失败立即停止，不回滚（与手动新建一致，回滚等于删数据），
 * 返回已成功的部分和失败原因。每一步通过 onStep 回报进度。
 */
export async function executeSourceDraft(form: SourceDraftForm, onStep: StepFn = () => {}): Promise<SourceDraftResult> {
  const result: SourceDraftResult = {
    ok: false,
    siteMode: form.siteMode,
    siteId: form.siteId || undefined,
    siteName: form.siteName.trim() || undefined,
    sources: [],
    flowIds: [],
    flowSkipped: form.flowMode === 'none',
  }
  const fail = (step: SourceDraftStep, message: string) => {
    onStep({ ...step, status: 'failed', detail: message })
    result.error = message
    return result
  }
  if (!isProductionCreateEnabled()) {
    return fail({ key: 'gate', label: '检查新建通道', status: 'running' }, '当前环境未开启新建通道（VITE_SITE_CREATE_TARGET=production），无法新建源')
  }
  const items = form.sources.filter((s) => s.name.trim())

  if (form.siteMode === 'new') {
    const siteStep = { key: 'site', label: `建网站并建源（${items.length} 个）`, status: 'running' as const }
    onStep(siteStep)
    const site: Site = {
      siteId: '', name: form.siteName.trim(), category: form.category, categoryPath: form.categoryPath, dirId: form.dirId,
      owner: 'admin', sourceCount: items.length, errorCount: 0, tags: [],
    }
    let res
    try {
      res = await siteApi.siteCreate(site, items.map((item) => blankSource(item)))
    } catch (error) {
      return fail(siteStep, `建网站请求失败：${(error as Error)?.message ?? String(error)}。请先回查网站是否已建，勿重复确认`)
    }
    if (res.siteId) result.siteId = String(res.siteId)
    const ids = (res.sourceIds ?? []).map(String)
    result.sources = ids.map((sourceId, i) => ({ name: items[i]?.name.trim() ?? '', sourceId }))
    if (!res.ok) return fail(siteStep, res.message || '建网站失败')
    onStep({ ...siteStep, status: 'done', detail: `网站 ID ${result.siteId}，源 ID ${ids.join('、')}` })

    const flowStep = { key: 'flow', label: '建共用流程并绑定', status: 'running' as const }
    if (form.flowMode === 'none') {
      onStep({ ...flowStep, status: 'skipped', detail: '已选「暂不建流程」，进画布后用流程标签栏「＋」新建' })
    } else {
      onStep(flowStep)
      const shared = await createSharedFlow(form.siteName.trim(), ids, form.templateId)
      if (shared.flowId) result.flowIds.push(shared.flowId)
      if (shared.note) return fail(flowStep, shared.note)
      onStep({ ...flowStep, status: 'done', detail: `流程 #${shared.flowId}` })
    }
  } else {
    const label = form.siteMode === 'existing' ? `建源并关联网站「${form.siteName}」` : '建源（不关联网站）'
    for (const [i, item] of items.entries()) {
      const step = { key: `source-${i}`, label: `${label}：${item.name.trim()}`, status: 'running' as const }
      onStep(step)
      let sourceId = ''
      try {
        if (form.flowMode === 'copy') {
          // 同网站详情「添加源 → 按模板源 → 复制默认流程」：copySource flag=1 复制源和默认流程（独立一份含配置），再归入本网站
          let copied
          try {
            copied = await sourceApi.copySourceAndLocate({ sourceId: form.templateSourceId, name: item.name.trim(), url: urlOrPlaceholder(item.url.trim(), ''), flag: 1 })
          } catch (error) {
            copied = { ok: false as const, message: (error as Error)?.message ?? String(error) }
          }
          if (!copied.ok) return fail(step, copyFailureMessage(form.templateSourceName, copied.message))
          sourceId = String(copied.sourceId)
          result.sources.push({ name: item.name.trim(), sourceId })
          const bound = await sourceApi.changeSite([sourceId], form.siteId)
          if (!bound.ok) return fail(step, `源 ${sourceId} 已按参考源复制，但归入网站失败：${bound.message || '未知错误'}`)
        } else {
          const res = form.siteMode === 'existing'
            ? await siteApi.sourceAdd(form.siteId, blankSource(item))
            : await sourceApi.createUnboundSource(blankSource(item))
          if (res.sourceId) {
            sourceId = String(res.sourceId)
            result.sources.push({ name: item.name.trim(), sourceId })
          }
          if (!res.ok) return fail(step, res.message || '建源失败')
        }
      } catch (error) {
        return fail(step, `建源请求失败：${(error as Error)?.message ?? String(error)}。请先回查源是否已建，勿重复确认`)
      }
      const detail = form.flowMode === 'copy' ? `源 ID ${sourceId}，已复制「${form.templateSourceName}」的默认流程` : `源 ID ${sourceId}`
      onStep({ ...step, status: 'done', detail })

      if (form.flowMode === 'template') {
        const flowStep = { key: `flow-${i}`, label: `为「${item.name.trim()}」建流程`, status: 'running' as const }
        onStep(flowStep)
        try {
          const created = await workflowBindingApi.createForSource({ sourceId, name: item.name.trim(), templateId: form.templateId, primary: true })
          result.flowIds.push(String(created.workflowId))
          onStep({ ...flowStep, status: 'done', detail: `流程 #${created.workflowId}` })
        } catch (error) {
          return fail(flowStep, `源已创建，但建流程失败：${(error as Error)?.message ?? String(error)}。可进画布用流程标签栏「＋」补建`)
        }
      }
    }
    if (form.flowMode === 'none') onStep({ key: 'flow', label: '建流程', status: 'skipped', detail: '已选「暂不建流程」，进画布后用流程标签栏「＋」新建' })
  }

  if (form.siteMode !== 'existing' && form.dirId) {
    const dirStep = { key: 'dir', label: `加入业务目录「${form.category}」`, status: 'running' as const }
    onStep(dirStep)
    const note = await addSourcesToBizDirNote({ dirId: form.dirId, category: form.category }, result.sources.map((s) => s.sourceId))
    if (note) return fail(dirStep, note)
    result.dirCategory = form.category
    onStep({ ...dirStep, status: 'done' })
  }
  result.ok = true
  return result
}

// ===== 结果回传：告诉智能体，也是历史回放时判定「已创建」的依据 =====

export function formatSourceCreatedMessage(result: SourceDraftResult): string {
  const srcText = result.sources.map((s) => `${s.name}（源 ID ${s.sourceId}）`).join('、')
  const where = result.siteMode === 'none'
    ? `已创建 ${result.sources.length} 个源（不关联网站）`
    : result.siteMode === 'new'
      ? `已新建网站「${result.siteName}」（网站 ID ${result.siteId}），创建 ${result.sources.length} 个源`
      : `已在网站「${result.siteName}」（网站 ID ${result.siteId}）下创建 ${result.sources.length} 个源`
  const flow = result.flowSkipped
    ? '未建流程（进画布再建）'
    : result.flowIds.length
      ? (result.siteMode === 'new' ? `共用流程 #${result.flowIds[0]}` : `流程 ${result.flowIds.map((id) => `#${id}`).join('、')}`)
      : ''
  const parts = [`${where}：${srcText || '无'}`]
  if (flow) parts.push(flow)
  if (result.dirCategory) parts.push(`已加入业务目录「${result.dirCategory}」`)
  let text = `${CREATED_PREFIX}${parts.join('，')}。`
  if (!result.ok && result.error) text += `未全部完成：${result.error}`
  return text
}

export function isSourceCreatedMessage(text: string): boolean {
  return !!text && text.trim().startsWith(CREATED_PREFIX)
}

// ===== 消息上挂的卡片状态 =====

export type SourceDraftStatus = 'pending' | 'creating' | 'created' | 'failed' | 'cancelled'

export interface SourceDraftState {
  draft: SourceDraft
  status: SourceDraftStatus
  steps?: SourceDraftStep[]
  result?: SourceDraftResult
  error?: string
  /** 历史回放时从回传消息恢复的结果文本 */
  resultText?: string
}

export { BIZ_DIR_ROOT_ID }
