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
  resolveMonitorGenerationContext,
  resolveMonitorTableFields,
} from './generation'

const ENTRY = {
  tableId: '2100157',
  tableName: 'sense_data.TB_ZJH',
  fields: [
    { prop: 'content', desc: '公告内容', columnName: 'CONTENT' },
    { prop: 'publish_time', desc: '发布时间', columnName: 'PUBLISH_TIME' },
  ],
}

describe('resolveMonitorGenerationContext 兜底', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.entryDetail.mockResolvedValue(ENTRY)
    mocks.searchTables.mockResolvedValue([])
  })

  it('源未绑定有效流程时，按表单主表生成独立监控上下文（configId=0）', async () => {
    mocks.sourceDetail.mockRejectedValue(new Error('运行时异常：源未绑定有效流程，sourceId=301069515'))
    mocks.sourceSteps.mockRejectedValue(new Error('运行时异常：源未绑定有效流程，sourceId=301069515'))

    const context = await resolveMonitorGenerationContext('301069515', {
      tableName: 'sense_data.TB_ZJH',
      tableId: '2100157',
    })

    expect(context.contextMode).toBe('table')
    expect(context.configId).toBe(0)
    expect(context.sourceTable).toBe('sense_data.TB_ZJH')
    expect(context.inputFieldOptions).toHaveLength(2)
    expect(context.inputFields).toEqual([])
  })

  it('流程存在但没有监控节点时同样退回主表', async () => {
    mocks.sourceDetail.mockResolvedValue({ id: '301069515', name: '证监会公告' })
    mocks.sourceSteps.mockResolvedValue([])

    const context = await resolveMonitorGenerationContext('301069515', {
      tableName: 'sense_data.TB_ZJH',
      tableId: '2100157',
    })

    expect(context.contextMode).toBe('table')
    expect(context.sourceTable).toBe('sense_data.TB_ZJH')
  })

  it('既没有流程也没有可用主表时给出可执行提示', async () => {
    mocks.sourceDetail.mockRejectedValue(new Error('源未绑定有效流程'))
    mocks.sourceSteps.mockRejectedValue(new Error('源未绑定有效流程'))

    await expect(resolveMonitorGenerationContext('301069515', {})).rejects.toBeInstanceOf(MonitorGenerationContextError)
  })

  it('主表读不到字段清单时不伪造字段', async () => {
    mocks.sourceDetail.mockRejectedValue(new Error('源未绑定有效流程'))
    mocks.sourceSteps.mockRejectedValue(new Error('源未绑定有效流程'))
    mocks.entryDetail.mockResolvedValue(null)

    await expect(
      resolveMonitorGenerationContext('301069515', { tableName: 'sense_data.TB_ZJH', tableId: '2100157' }),
    ).rejects.toThrow(/字段清单/)
  })

  it('未选择被监控源时不发任何请求', async () => {
    await expect(resolveMonitorGenerationContext('', { tableName: 'sense_data.TB_ZJH' })).rejects.toThrow(/被监控源/)
    expect(mocks.sourceDetail).not.toHaveBeenCalled()
  })
})
describe('resolveMonitorTableFields 字段清单（与生成同一条解析链）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.searchTables.mockResolvedValue([])
  })

  it('按表 ID 取真实字段（prop 口径），过滤空值', async () => {
    mocks.entryDetail.mockResolvedValue(ENTRY)
    await expect(resolveMonitorTableFields({ tableName: 'sense_data.TB_ZJH', tableId: '2100157' })).resolves.toEqual([
      'content',
      'publish_time',
    ])
  })

  it('表 ID 拿不到字段时按「库.表」物理名精确兜底一次', async () => {
    mocks.entryDetail.mockResolvedValue(null)
    mocks.searchTables.mockResolvedValue([{ ...ENTRY, tableId: '2100158', fields: [] }])
    mocks.entryDetail.mockImplementation(async (tableId: string) => (tableId === '2100158' ? ENTRY : null))
    await expect(resolveMonitorTableFields({ tableName: 'sense_data.TB_ZJH' })).resolves.toEqual(['content', 'publish_time'])
    expect(mocks.entryDetail).toHaveBeenCalledWith('2100158')
  })

  it('拿不到字段清单时返回空数组，不编造列名', async () => {
    mocks.entryDetail.mockResolvedValue(null)
    await expect(resolveMonitorTableFields({})).resolves.toEqual([])
  })
})

describe('augmentMonitorSystemPrompt 提示词注入真实列', () => {
  it('追加真实字段清单与入库时间列', () => {
    const prompt = augmentMonitorSystemPrompt('基础提示词', ['title', 'publish_time'], 'CREATE_DT')
    expect(prompt).toBe(
      '基础提示词\n\n该表真实字段：title, publish_time（只能用这些列名，不要臆造）\n按 CREATE_DT 统计入库时间',
    )
  })

  it('字段去重并最多列 MAX_PROMPT_COLUMNS 个', () => {
    const fields = ['title', 'title', ...Array.from({ length: 60 }, (_, index) => `col_${index}`)]
    const prompt = augmentMonitorSystemPrompt('', fields)
    expect(prompt).toContain('该表真实字段：title, col_0')
    expect(prompt.split('（只能用这些列名，不要臆造）')[0]!.split(', ')).toHaveLength(MAX_PROMPT_COLUMNS)
  })

  it('拿不到字段清单时跳过该段、保留原提示词；只有 timeColumn 也能单独追加', () => {
    expect(augmentMonitorSystemPrompt('基础提示词')).toBe('基础提示词')
    expect(augmentMonitorSystemPrompt('基础提示词', [], 'CREATE_DT')).toBe('基础提示词\n\n按 CREATE_DT 统计入库时间')
  })
})
