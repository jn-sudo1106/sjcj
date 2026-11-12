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

import { MonitorGenerationContextError, resolveMonitorGenerationContext } from './generation'

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