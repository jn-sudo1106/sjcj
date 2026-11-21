import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sourceDetail: vi.fn(),
  sourceSteps: vi.fn(),
  entryDetail: vi.fn(),
  searchTables: vi.fn(),
}))

vi.mock('@/api', () => ({
  sourceApi: { sourceDetail: mocks.sourceDetail, sourceSteps: mocks.sourceSteps },
  entryApi: { entryDetail: mocks.entryDetail, searchTables: mocks.searchTables },
  ruleApi: {},
}))

import {
  MAX_PROMPT_COLUMNS,
  MonitorGenerationContextError,
  augmentMonitorSystemPrompt,
  resolveMonitorTableFields,
  resolveSourceResultContext,
  summarizeExecutionResult,
} from './generation'

const ENTRY = {
  tableId: '2100157',
  tableName: 'sense_data.TB_ZJH',
  fields: [
    { prop: 'content', desc: '公告内容', columnName: 'CONTENT' },
    { prop: 'publish_time', desc: '发布时间', columnName: 'PUBLISH_TIME' },
  ],
}

describe('resolveSourceResultContext 源结果检查只读所选表', () => {
  const fallback = { tableName: 'sense_data.TB_ZJH', tableId: '2100157' }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    mocks.entryDetail.mockResolvedValue(ENTRY)
    mocks.searchTables.mockResolvedValue([])
  })

  it('按表单选定的表生成：configId=0、被检表即所选表', async () => {
    const context = await resolveSourceResultContext(fallback)

    expect(context.configId).toBe(0)
    expect(context.sourceTable).toBe('sense_data.TB_ZJH')
    expect(context.targetTable).toBe('sense_data.TB_ZJH')
    expect(context.inputFieldOptions).toHaveLength(2)
    expect(context.inputFields).toEqual([])
  })

  it('不读源流程：源流程接口失败或指向别的表都不影响本条检查', async () => {
    // 即便源有流程、流程里的监控节点绑的是中间表，也绝不能改变本条检查的范围
    mocks.sourceSteps.mockResolvedValue([
      { stepId: '2', sourceId: '301069515', name: '数据监控', nodeType: 'monitor', configId: '2001', inputTable: '2100158' },
    ])
    mocks.sourceDetail.mockRejectedValue(new Error('运行时异常：源未绑定有效流程，sourceId=301069515'))

    const context = await resolveSourceResultContext(fallback)

    expect(context.sourceTable).toBe('sense_data.TB_ZJH')
    expect(mocks.sourceDetail).not.toHaveBeenCalled()
    expect(mocks.sourceSteps).not.toHaveBeenCalled()
  })

  it('没有选表时给出可执行提示，不发字段查询', async () => {
    await expect(resolveSourceResultContext({})).rejects.toBeInstanceOf(MonitorGenerationContextError)
    await expect(resolveSourceResultContext({})).rejects.toThrow(/请先选择要检查的表/)
    expect(mocks.entryDetail).not.toHaveBeenCalled()
  })

  it('表读不到字段清单时不伪造字段', async () => {
    mocks.entryDetail.mockResolvedValue(null)

    await expect(resolveSourceResultContext(fallback)).rejects.toThrow(/字段清单/)
  })

  it('只拿到物理名（没有表 ID）时按物理名精确查一次，查不到也不编造字段', async () => {
    await expect(resolveSourceResultContext({ tableName: 'sense_data.TB_ZJH' })).rejects.toThrow(/字段清单/)
    expect(mocks.searchTables).toHaveBeenCalledWith('sense_data.TB_ZJH', 20)
  })
})

describe('resolveMonitorTableFields 字段清单（与生成同一条解析链）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.searchTables.mockResolvedValue([])
  })

  it('优先使用执行环境实际字段，不被旧登记字段覆盖', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ fields: ['CREATE_DT'] }), { status: 200 })))
    mocks.entryDetail.mockResolvedValue(ENTRY)
    await expect(resolveMonitorTableFields({ tableName: 'sense_data.T' })).resolves.toEqual(['CREATE_DT'])
    expect(mocks.entryDetail).not.toHaveBeenCalled()
  })

  it('请求执行器时带上 Access-Token 头（登录是 token 制，仅靠 Cookie 会在会话过期后 401）', async () => {
    const calls: Array<{ headers: Record<string, string> }> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ headers: (init?.headers ?? {}) as Record<string, string> })
      return new Response(JSON.stringify({ fields: ['CREATE_DT'] }), { status: 200 })
    }))
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'pro__Access-Token' ? JSON.stringify({ value: 'tok-abc' }) : null),
    })
    await resolveMonitorTableFields({ tableName: 'sense_data.T' })
    expect(calls[0].headers['Access-Token']).toBe('tok-abc')
  })

  it('实际字段接口失败时不退回旧清单掩盖问题', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '目标库不可达' }), { status: 503 })))
    await expect(resolveMonitorTableFields({ tableName: 'sense_data.T' })).rejects.toThrow('目标库不可达')
  })

  it('旧环境缺少接口时明确报错，不使用登记字段冒充真实字段', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    await expect(resolveMonitorTableFields({ tableName: 'sense_data.T' })).rejects.toThrow('当前环境已部署字段查询接口')
  })

})

describe('augmentMonitorSystemPrompt 提示词注入真实列', () => {
  it('追加真实字段清单与入库时间列', () => {
    const prompt = augmentMonitorSystemPrompt('基础提示词', ['title', 'publish_time'], 'CREATE_DT')
    expect(prompt).toContain('该表真实字段：title, publish_time（只能用这些列名，不要臆造）\n按 CREATE_DT 统计入库时间')
    expect(prompt).toContain('DQ_TIME_COLUMN')
  })

  it('字段去重并最多列 MAX_PROMPT_COLUMNS 个', () => {
    const fields = ['title', 'title', ...Array.from({ length: 60 }, (_, index) => `col_${index}`)]
    const prompt = augmentMonitorSystemPrompt('', fields)
    expect(prompt).toContain('该表真实字段：title, col_0')
    expect(prompt.split('该表真实字段：')[1]!.split('（只能用这些列名，不要臆造）')[0]!.split(', ')).toHaveLength(MAX_PROMPT_COLUMNS)
  })

  it('拿不到字段清单时跳过该段、保留原提示词；只有 timeColumn 也能单独追加', () => {
    expect(augmentMonitorSystemPrompt('基础提示词')).toContain('DQ_DB_HOST')
    expect(augmentMonitorSystemPrompt('基础提示词', [], 'CREATE_DT')).toContain('按 CREATE_DT 统计入库时间')
  })

  it('明确要求列别名反引号包裹并避开保留字（delayed 实测 1064）', () => {
    const prompt = augmentMonitorSystemPrompt('基础提示词')
    expect(prompt).toContain('列别名同样必须反引号包裹')
    expect(prompt).toContain('delayed')
  })
})

// 1117 前端修改清单 1.5：测试回执里执行端格式（IsSuccess / ErrorMessage）与任务列表同一套解析
describe('summarizeExecutionResult', () => {
  it.each([
    [{ IsSuccess: 'false', StrTaskId: '1', ErrorMessage: '表不存在' }, '执行失败；表不存在'],
    [{ IsSuccess: 'true', StrTaskId: '1', ErrorMessage: '-' }, '执行成功'],
    [{ success: false, message: '超时' }, '执行失败；超时'],
    [{ ok: true }, '执行成功'],
    [{ message: '只有说明' }, '只有说明'],
    [{ status: 'ABNORMAL', message: '异常 3 条' }, '异常 3 条'],
    [null, '执行完成，未返回结构化结果'],
  ])('%j → %s', (raw, expected) => {
    expect(summarizeExecutionResult(raw)).toBe(expected)
  })
})
