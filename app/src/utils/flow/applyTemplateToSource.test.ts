// @vitest-environment jsdom
// 2026-10-27：发布 / 放弃草稿后的画布重载要补 configDetail，否则 type='rule' 的 730 打标签步骤被画成规则节点
//（217 流程 14007240 实测：重载后选中节点即被标脏，发起抓取被拦）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Step } from '@/api'

const mockSourceDetail = vi.fn()
const mockSteps = vi.fn()
const mockStepConfigDetails = vi.fn()
const mockConfigDetail = vi.fn()
const mockOverview = vi.fn(async () => ({ enabled: false, versions: [], draftId: null as string | null }))

vi.mock('@/api', () => ({
  sourceApi: {
    sourceDetail: (...args: unknown[]) => mockSourceDetail(...args),
    sourceSteps: vi.fn(),
    stepConfigDetails: (...args: unknown[]) => mockStepConfigDetails(...args),
  },
  flowCenterApi: { steps: (...args: unknown[]) => mockSteps(...args) },
  configApi: { configDetail: (...args: unknown[]) => mockConfigDetail(...args) },
  flowVersionApi: { overview: (...args: unknown[]) => mockOverview(...(args as [])), action: vi.fn() },
  versionArgs: (ref: unknown) => (ref ? [ref] : []),
}))

import { reloadFlowIntoCanvas, reloadSourceIntoCanvas } from './applyTemplateToSource'
import { useFlowStore } from '@/stores/flow'

// 首屏快速路径（withConfigDetails=false）的步骤没有 configType，只有 type='rule'
const bareSteps = (): Step[] => [
  { stepId: 'st1', sourceId: 's1', name: '列表抓取', inputTable: '-', outputTable: '900', nodeType: 'list', enabled: true },
  { stepId: 'st2', sourceId: '-1', name: '文章打标签', inputTable: '900', outputTable: '900', nodeType: 'rule', configId: '1401052', dependsOn: ['st1'], enabled: true },
] as Step[]
const withDetails = (steps: Step[]): Step[] => steps.map((s) => (s.stepId === 'st2' ? { ...s, configType: '730' } : s))

describe('画布重载补 configDetail', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockStepConfigDetails.mockImplementation(async (steps: Step[]) => withDetails(steps))
  })

  it('源画布重载后 730 步骤落成文章打标签节点，不带 ruleCfg', async () => {
    mockSourceDetail.mockResolvedValue({ sourceId: 's1', name: '源', url: 'http://x', mainTable: '900', flowId: '14007240' })
    mockSteps.mockResolvedValue(bareSteps())

    expect(await reloadSourceIntoCanvas('s1')).toBe(true)

    const cfg = useFlowStore().configs.st2
    expect(mockStepConfigDetails).toHaveBeenCalledTimes(1)
    expect(cfg.template).toBe('article-tag')
    expect(cfg.ruleCfg).toBeUndefined()
    expect(useFlowStore().dirtyConfigNodes).toEqual([])
  })

  it('流程工作区重载同样补齐（在清 stub 源上下文之前）', async () => {
    mockConfigDetail.mockResolvedValue({ name: '流程', url: 'http://x', entryTypeId: '900' })
    mockSteps.mockResolvedValue(bareSteps())

    await reloadFlowIntoCanvas('14007240')

    const cfg = useFlowStore().configs.st2
    expect(cfg.template).toBe('article-tag')
    expect(cfg.ruleCfg).toBeUndefined()
  })

  it('源画布重载后保留 job 表回填的定时 cron，且不置脏', async () => {
    mockSourceDetail.mockResolvedValue({ sourceId: 's1', name: '源', url: 'http://x', mainTable: '900', flowId: '14007240' })
    mockSteps.mockResolvedValue(bareSteps())
    expect(await reloadSourceIntoCanvas('s1')).toBe(true)
    const flow = useFlowStore()
    flow.setSourceJob({ jobId: 'j1', schedule: '0 0 * * * ?' } as never)
    flow.markSaved()

    // 发布 / 放弃草稿后的重载：sourceDetail 不带 cron
    expect(await reloadSourceIntoCanvas('s1')).toBe(true)

    expect(flow.sourceCtx?.cron).toBe('0 0 * * * ?')
    expect(flow.dirtyConfigNodes).toEqual([])
  })

  it('发布或放弃辅助流程后重载指定流程，不回到源的默认流程', async () => {
    mockSourceDetail.mockResolvedValue({ sourceId: 's1', name: '源', url: 'http://x', mainTable: '900', flowId: '11' })
    mockSteps.mockResolvedValue(bareSteps())

    expect(await reloadSourceIntoCanvas('s1', '12')).toBe(true)

    expect(mockSteps).toHaveBeenCalledWith('12', { withConfigDetails: false })
    expect(useFlowStore().sourceCtx?.flowId).toBe('12')
    expect(useFlowStore().sourceCtx?.primaryFlowId).toBe('11')
  })

  it('补充失败不影响重载结果', async () => {
    mockSourceDetail.mockResolvedValue({ sourceId: 's1', name: '源', url: 'http://x', mainTable: '900', flowId: '14007240' })
    mockSteps.mockResolvedValue(bareSteps())
    mockStepConfigDetails.mockRejectedValue(new Error('网络异常'))

    expect(await reloadSourceIntoCanvas('s1')).toBe(true)
    expect(useFlowStore().configs.st2).toBeTruthy()
  })
})
