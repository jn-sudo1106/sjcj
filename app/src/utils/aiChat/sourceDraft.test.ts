import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  isProductionCreateEnabled: () => true,
}))
const createSharedFlow = vi.fn(async () => ({ flowId: '88231', note: '' }))
const addSourcesToBizDirNote = vi.fn(async () => '')
vi.mock('@/utils/source/createCollect', () => ({
  createSharedFlow: (...args: unknown[]) => createSharedFlow(...(args as [])),
  addSourcesToBizDirNote: (...args: unknown[]) => addSourcesToBizDirNote(...(args as [])),
}))

import { siteApi, sourceApi, workflowBindingApi, type Source } from '@/api'
import { convertChatLogsToMessages, type BackendChatLog } from '@/api/aiChat'
import {
  buildSourceDraftPrompt,
  executeSourceDraft,
  extractSourceDraftFromText,
  formatSourceCreatedMessage,
  initialSourceForm,
  isCreateSourceIntent,
  isSourceDraftPrompt,
  stripSourceDraftBlock,
  stripSourceDraftPrompt,
  validateSourceForm,
  type SourceDraft,
  type SourceDraftForm,
  type SourceDraftHints,
  type SourceDraftStep,
} from './sourceDraft'

const ANSWER = `已整理建源草稿：新建网站「南京网上房地产」，2 个源。

\`\`\`source-draft
{
  "siteName": "南京网上房地产",
  "category": "房产",
  "flowTemplate": "列表翻页 + 详情",
  "sources": [
    { "name": "南京二手房挂牌", "url": "http://www.njhouse.com.cn/esf/list" },
    { "name": "南京二手房成交", "url": "" }
  ],
  "remark": "成交源未提供 URL"
}
\`\`\``

const DRAFT: SourceDraft = {
  siteName: '南京网上房地产', category: '房产', flowTemplate: '列表翻页 + 详情', templateSource: '',
  sources: [{ name: '南京二手房挂牌', url: 'http://www.njhouse.com.cn/esf/list' }, { name: '南京二手房成交', url: '' }],
  remark: '成交源未提供 URL',
}

function hints(over: Partial<SourceDraftHints> = {}): SourceDraftHints {
  return {
    existingSite: null, matchedCategory: { dirId: '9009100', category: '房产' },
    templates: [{ id: 't1', name: '通用列表详情' }, { id: 't2', name: '列表翻页 + 详情' }],
    matchedTemplateId: 't2', siteSources: [], duplicates: {}, warnings: [], ...over,
  }
}

function form(over: Partial<SourceDraftForm> = {}): SourceDraftForm {
  return {
    siteMode: 'new', siteName: '南京网上房地产', siteId: '', dirId: '9009100', category: '房产', categoryPath: '房产',
    flowMode: 'template', templateId: 't2', templateName: '列表翻页 + 详情', templateSourceId: '', templateSourceName: '',
    sources: DRAFT.sources.map((s) => ({ ...s })), ...over,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  createSharedFlow.mockClear()
  addSourcesToBizDirNote.mockClear()
})

describe('建源草稿解析', () => {
  it('取 ```source-draft 代码块并归一化，正文剥掉代码块', () => {
    expect(extractSourceDraftFromText(ANSWER)).toEqual(DRAFT)
    expect(stripSourceDraftBlock(ANSWER)).toBe('已整理建源草稿：新建网站「南京网上房地产」，2 个源。')
  })

  it('兼容 ```json + source_draft 外层键与 snake_case，源可以是字符串', () => {
    const text = '说明\n```json\n{"source_draft": {"site_name": "", "sources": ["国家统计局70城房价指数", {"source_name": "B", "source_url": "http://b"}]}}\n```'
    expect(extractSourceDraftFromText(text)).toMatchObject({
      siteName: '', sources: [{ name: '国家统计局70城房价指数', url: '' }, { name: 'B', url: 'http://b' }],
    })
    expect(stripSourceDraftBlock(text)).toBe('说明')
  })

  it('流式未闭合的草稿块先藏掉；没有源的草稿不算', () => {
    expect(stripSourceDraftBlock('说明\n\n```source-draft\n{"siteName": "A"')).toBe('说明')
    expect(extractSourceDraftFromText('```source-draft\n{"siteName": "A", "sources": []}\n```')).toBeNull()
  })
})

describe('建源意图与格式要求', () => {
  it('明确要建源 / 建采集时命中', () => {
    for (const t of ['帮我建个采集，网站是南京网上房地产', '在贝壳找房下面加一个南京二手房成交的源', '新建一个源采国家统计局数据', '建 3 个源：A、B、C', '新建采集「江苏省统计局」']) {
      expect(isCreateSourceIntent(t), t).toBe(true)
    }
  })
  it('查询说法和建源结果回传不命中', () => {
    for (const t of ['新建的源有哪些', '最近加了多少个源', '查一下没有数据的源', '【建源结果】已创建 1 个源（不关联网站）：A（源 ID 1）。', '']) {
      expect(isCreateSourceIntent(t), t).toBe(false)
    }
  })
  it('格式要求带标记，回放时剥回用户原文', () => {
    const prompt = buildSourceDraftPrompt('  帮我建个采集 ')
    expect(isSourceDraftPrompt(prompt)).toBe(true)
    expect(prompt).toContain('```source-draft')
    expect(stripSourceDraftPrompt(prompt)).toBe('帮我建个采集')
  })
})

describe('卡片初始表单与校验', () => {
  it('没有网站名 → 不关联网站', () => {
    const f = initialSourceForm({ ...DRAFT, siteName: '' }, hints())
    expect(f.siteMode).toBe('none')
    expect(f.flowMode).toBe('template')
  })
  it('没查到同名网站 → 新建网站，按建议预选模板与分类', () => {
    const f = initialSourceForm(DRAFT, hints())
    expect(f).toMatchObject({ siteMode: 'new', dirId: '9009100', templateId: 't2', flowMode: 'template' })
  })
  it('查到同名网站且没匹配到模板 → 加到已有网站，默认复制参考源（点名的优先，否则第一个源）', () => {
    const h = hints({
      existingSite: { siteId: '1024', name: '贝壳找房', sourceCount: 37 }, matchedTemplateId: '',
      siteSources: [{ sourceId: '1', name: '贝壳北京二手房' }, { sourceId: '2', name: '贝壳南京二手房挂牌' }],
    })
    expect(initialSourceForm({ ...DRAFT, siteName: '贝壳找房', templateSource: '贝壳南京二手房挂牌' }, h))
      .toMatchObject({ siteMode: 'existing', siteId: '1024', flowMode: 'copy', templateSourceId: '2' })
    expect(initialSourceForm({ ...DRAFT, siteName: '贝壳找房', flowTemplate: '' }, h).templateSourceId).toBe('1')
  })
  it('校验：新建网站必选分类、按模板必选模板、源名不能重复', () => {
    expect(validateSourceForm(form())).toEqual([])
    expect(validateSourceForm(form({ dirId: '' }))).toContain('新建网站需要选择业务分类')
    expect(validateSourceForm(form({ siteMode: 'none', dirId: '' }))).toEqual(['不关联网站也需要选择业务分类（源的业务目录）'])
    expect(validateSourceForm(form({ siteMode: 'none', dirId: '9009100' }))).toEqual([])
    expect(validateSourceForm(form({ templateId: '' }))).toContain('请选择流程模板，或改选「暂不建流程」')
    expect(validateSourceForm(form({ sources: [{ name: 'A', url: '' }, { name: 'A', url: '' }] }))).toContain('源名称有重复')
    expect(validateSourceForm(form({ flowMode: 'copy' }))).toContain('只有加到已有网站时才能复制参考源的流程')
  })
  it('校验：库中已有同名网站时不能再「新建网站」，改名后放行（1123 网站名不可重复）', () => {
    const existing = { existingSite: { siteId: '2536', name: '同花顺', sourceCount: 5 } }
    expect(validateSourceForm(form({ siteName: ' 同花顺 ' }), existing)).toContain('已存在同名网站「同花顺」（ID 2536），请改名或选择「加入已有网站」')
    expect(validateSourceForm(form({ siteName: '同花顺F10' }), existing)).toEqual([])
    expect(validateSourceForm(form({ siteName: '同花顺' }), null)).toEqual([])
  })
})

describe('执行建源', () => {
  function collect() {
    const steps: SourceDraftStep[] = []
    return { steps, onStep: (s: SourceDraftStep) => { const i = steps.findIndex((x) => x.key === s.key); if (i >= 0) steps[i] = s; else steps.push(s) } }
  }

  it('新建网站：siteCreate → 共用流程 → 加入业务目录；占位 URL 补上', async () => {
    const siteCreate = vi.spyOn(siteApi, 'siteCreate').mockResolvedValue({ ok: true, siteId: '9001', sourceId: '430101', sourceIds: ['430101', '430102'] })
    const { steps, onStep } = collect()
    const result = await executeSourceDraft(form(), onStep)
    expect(result).toMatchObject({ ok: true, siteId: '9001', flowIds: ['88231'], dirCategory: '房产' })
    expect(result.sources).toEqual([{ name: '南京二手房挂牌', sourceId: '430101' }, { name: '南京二手房成交', sourceId: '430102' }])
    const sent = siteCreate.mock.calls[0][1] as Source[]
    expect(sent[1].url).toMatch(/^http:\/\/placeholder\.invalid\//)
    expect(createSharedFlow).toHaveBeenCalledWith('南京网上房地产', ['430101', '430102'], 't2')
    expect(addSourcesToBizDirNote).toHaveBeenCalledWith({ dirId: '9009100', category: '房产' }, ['430101', '430102'])
    expect(steps.map((s) => s.status)).toEqual(['done', 'done', 'done'])
    expect(formatSourceCreatedMessage(result)).toBe('【建源结果】已新建网站「南京网上房地产」（网站 ID 9001），创建 2 个源：南京二手房挂牌（源 ID 430101）、南京二手房成交（源 ID 430102），共用流程 #88231，已加入业务目录「房产」。')
  })

  it('已有网站 + 复制参考源：copySource flag=1 → changeSite，不再建流程', async () => {
    const copy = vi.spyOn(sourceApi, 'copySourceAndLocate').mockResolvedValue({ ok: true, sourceId: '430103', name: '贝壳南京二手房成交' })
    const change = vi.spyOn(sourceApi, 'changeSite').mockResolvedValue({ ok: true })
    const createForSource = vi.spyOn(workflowBindingApi, 'createForSource')
    const result = await executeSourceDraft(form({
      siteMode: 'existing', siteId: '1024', siteName: '贝壳找房', flowMode: 'copy', templateSourceId: '2', templateSourceName: '贝壳南京二手房挂牌',
      sources: [{ name: '贝壳南京二手房成交', url: 'https://nj.ke.com/chengjiao/' }],
    }))
    expect(copy).toHaveBeenCalledWith({ sourceId: '2', name: '贝壳南京二手房成交', url: 'https://nj.ke.com/chengjiao/', flag: 1 })
    expect(change).toHaveBeenCalledWith(['430103'], '1024')
    expect(createForSource).not.toHaveBeenCalled()
    expect(addSourcesToBizDirNote).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    expect(formatSourceCreatedMessage(result)).toContain('已在网站「贝壳找房」（网站 ID 1024）下创建 1 个源')
  })

  it('不关联网站：只 snatchSave（createUnboundSource）+ 每源按模板建流程', async () => {
    const create = vi.spyOn(sourceApi, 'createUnboundSource').mockResolvedValue({ ok: true, sourceId: '430104' })
    const flow = vi.spyOn(workflowBindingApi, 'createForSource').mockResolvedValue({ workflowId: '88233' } as never)
    const result = await executeSourceDraft(form({ siteMode: 'none', siteName: '', dirId: '', category: '', sources: [{ name: '国家统计局70城房价指数', url: 'https://www.stats.gov.cn/sj/zxfb/' }] }))
    expect(create).toHaveBeenCalledTimes(1)
    expect(flow).toHaveBeenCalledWith({ sourceId: '430104', name: '国家统计局70城房价指数', templateId: 't2', primary: true })
    expect(addSourcesToBizDirNote).not.toHaveBeenCalled()
    expect(formatSourceCreatedMessage(result)).toBe('【建源结果】已创建 1 个源（不关联网站）：国家统计局70城房价指数（源 ID 430104），流程 #88233。')
  })

  it('参考源流程没配好时 copySource 被拒：说明原因并建议改用模板，什么都没建', async () => {
    vi.spyOn(sourceApi, 'copySourceAndLocate').mockRejectedValue(new Error('请求异常 [source/copySource]: 错误信息:运行时异常：流程「X」（ID：1）无法运行：ROOT未配置有效入口配置'))
    const change = vi.spyOn(sourceApi, 'changeSite')
    const result = await executeSourceDraft(form({ siteMode: 'existing', siteId: '2527', siteName: 'X', flowMode: 'copy', templateSourceId: '491000003', templateSourceName: 'AI建源测试-挂牌', sources: [{ name: '租赁', url: '' }] }))
    expect(result.ok).toBe(false)
    expect(result.sources).toEqual([])
    expect(change).not.toHaveBeenCalled()
    expect(result.error).toBe('参考源「AI建源测试-挂牌」的流程还没配置好，不能复制（错误信息:运行时异常：流程「X」（ID：1）无法运行：ROOT未配置有效入口配置）。请改选「按流程模板新建」或换一个参考源')
  })

  it('任一步失败立即停止，保留已成功的部分', async () => {
    vi.spyOn(sourceApi, 'createUnboundSource')
      .mockResolvedValueOnce({ ok: true, sourceId: '1' })
      .mockResolvedValueOnce({ ok: false, message: '源名称重复' })
    const result = await executeSourceDraft(form({ siteMode: 'none', flowMode: 'none', dirId: '', sources: [{ name: 'A', url: '' }, { name: 'B', url: '' }, { name: 'C', url: '' }] }))
    expect(result.ok).toBe(false)
    expect(result.sources).toEqual([{ name: 'A', sourceId: '1' }])
    expect(result.error).toBe('源名称重复')
    expect(formatSourceCreatedMessage(result)).toBe('【建源结果】已创建 1 个源（不关联网站）：A（源 ID 1），未建流程（进画布再建）。未全部完成：源名称重复')
  })
})

describe('历史回放', () => {
  it('草稿后有「建源结果」回传 → 标成已创建，并剥掉建源格式要求', () => {
    const logs: BackendChatLog[] = [
      { id: 1, sessionId: 9, msg: buildSourceDraftPrompt('帮我建个采集'), modelMsg: ANSWER, status: 'SUCCESS' },
      { id: 2, sessionId: 9, msg: '【建源结果】已新建网站「南京网上房地产」（网站 ID 9001），创建 2 个源：…', modelMsg: '好的，已建好。', status: 'SUCCESS' },
      { id: 3, sessionId: 9, msg: '再建一个', modelMsg: ANSWER, status: 'SUCCESS' },
    ]
    const messages = convertChatLogsToMessages(logs)
    expect(messages[0].content).toBe('帮我建个采集')
    expect(messages[1].draftMode).toBe('source')
    expect(messages[1].sourceDraft).toMatchObject({ status: 'created' })
    expect(messages[1].sourceDraft?.resultText).toContain('网站 ID 9001')
    expect(messages[3].chartData).toBeUndefined()
    expect(messages[5].sourceDraft?.status).toBe('pending')
  })
})
