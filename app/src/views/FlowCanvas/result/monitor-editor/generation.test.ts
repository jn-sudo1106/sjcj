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
  describeTableFallback,
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
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
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
    expect(context.fallbackReason).toBe('no-monitor-node')
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

describe('resolveMonitorGenerationContext 流程节点识别', () => {
  const SOURCE = { id: '301069515', name: '证监会公告' }
  const fallback = { tableName: 'sense_data.TB_ZJH', tableId: '2100157' }

  const listStep = {
    stepId: '1', sourceId: '301069515', name: '列表抓取', configId: '1001',
    inputTable: '-', outputTable: '2100157', enabled: true,
  }
  const monitorStep = (overrides: Record<string, unknown> = {}) => ({
    stepId: '2', sourceId: '301069515', name: '数据监控', nodeType: 'monitor',
    configId: '2001', inputTable: '2100157', dependsOn: ['1'], enabled: true,
    ...overrides,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    mocks.entryDetail.mockResolvedValue(ENTRY)
    mocks.searchTables.mockResolvedValue([])
    mocks.sourceDetail.mockResolvedValue(SOURCE)
  })

  it('主链上的监控节点走 flow 上下文', async () => {
    mocks.sourceSteps.mockResolvedValue([listStep, monitorStep()])

    const context = await resolveMonitorGenerationContext('301069515', fallback)

    expect(context.contextMode).toBe('flow')
    expect(context.configId).toBe(2001)
    expect(context.sourceTable).toBe('sense_data.TB_ZJH')
  })

  it('监控节点在分叉下游的分支上也能识别（不再误报没有绑定流程）', async () => {
    // 1 有两个后继（2 详情、3 分类）→ 主链在 1 处中断，4（监控）挂在 3 的分支链上
    mocks.sourceSteps.mockResolvedValue([
      listStep,
      { stepId: '2', sourceId: '301069515', name: '详情解析', configId: '1002', inputTable: '2100157', outputTable: '2100158', dependsOn: ['1'], enabled: true },
      { stepId: '3', sourceId: '301069515', name: '分类提取', configId: '1003', inputTable: '2100157', outputTable: '2100159', dependsOn: ['1'], enabled: true },
      monitorStep({ stepId: '4', configId: '2002', dependsOn: ['3'] }),
    ])

    const context = await resolveMonitorGenerationContext('301069515', fallback)

    expect(context.contextMode).toBe('flow')
    expect(context.configId).toBe(2002)
  })

  it('节点没有保存出 configId 时提示节点未保存，而不是说没有绑定流程', async () => {
    mocks.sourceSteps.mockResolvedValue([listStep, monitorStep({ configId: undefined })])

    const context = await resolveMonitorGenerationContext('301069515', fallback)

    expect(context.contextMode).toBe('table')
    expect(context.fallbackReason).toBe('node-not-saved')
  })

  it('节点没有绑定输入表时给出对应原因', async () => {
    mocks.sourceSteps.mockResolvedValue([listStep, monitorStep({ inputTable: '-' })])

    const context = await resolveMonitorGenerationContext('301069515', fallback)

    expect(context.contextMode).toBe('table')
    expect(context.fallbackReason).toBe('node-no-input-table')
  })
})

describe('describeTableFallback 独立监控提示', () => {
  const base = {
    contextMode: 'table' as const, configId: 0, sourceTable: 'sense_data.TB_ZJH',
    targetTable: 'sense_data.TB_ZJH', inputFields: [], outputFields: [],
    inputFieldOptions: [], outputFieldOptions: [],
  }

  it('有流程但没监控节点：说清没有节点，并指出怎么才能随流程触发', () => {
    const text = describeTableFallback({ ...base, fallbackReason: 'no-monitor-node' })
    expect(text).toContain('没有数据监控节点')
    expect(text).toContain('sense_data.TB_ZJH')
    expect(text).toContain('添加数据监控节点')
    expect(text).not.toContain('没有绑定流程')
  })

  it('节点未保存 / 未绑表：分别指向保存节点与选表', () => {
    expect(describeTableFallback({ ...base, fallbackReason: 'node-not-saved' })).toContain('还没有保存')
    expect(describeTableFallback({ ...base, fallbackReason: 'node-no-input-table' })).toContain('没有绑定输入表')
  })

  it('读不到流程时注明独立监控按自己的执行计划运行', () => {
    const text = describeTableFallback({ ...base, fallbackReason: 'flow-unavailable' })
    expect(text).toContain('没有读到该源的可用流程')
    expect(text).toContain('按自己的执行计划运行')
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
})
