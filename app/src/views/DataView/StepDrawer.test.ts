// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import StepDrawer from './StepDrawer.vue'
import { sourceApi, type Source, type Step } from '@/api'

const source: Source = {
  sourceId: 'src-1', name: '步骤测试源', url: 'https://example.com', configId: 'cfg-1', mainTable: 'TB_LIST', owner: 'tester', state: 'C',
}
const steps: Step[] = [
  { stepId: 'src-1-s1', sourceId: 'src-1', name: '列表抓取', outputTable: 'TB_LIST', enabled: true },
  { stepId: 'src-1-s2', sourceId: 'src-1', name: '详情解析', inputTable: 'TB_LIST', outputTable: 'TB_DETAIL', enabled: true },
]

describe('StepDrawer', () => {
  afterEach(() => vi.restoreAllMocks())

  it('复用流程节点轨道，名称、顺序和节点状态由同一份源步骤数据产生', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(source)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(steps)
    vi.spyOn(sourceApi, 'sourceNodeRuns').mockResolvedValue([
      { nodeId: 'src-1-s1', queue: 'queue_cfg-1', totalTasks: 1, processedTasks: 0, state: 'L' },
      { nodeId: 'src-1-s2', queue: 'queue_cfg-1.detail', totalTasks: 1, processedTasks: 0, state: 'E' },
    ])
    const wrapper = mount(StepDrawer, {
      props: { modelValue: true, sourceId: 'src-1' },
      global: { directives: { loading: {} }, stubs: { ElDrawer: { template: '<section><slot /></section>' } } },
    })
    await flushPromises()

    expect(wrapper.get('[data-testid="data-step-rail"]').text()).toContain('列表抓取')
    expect(wrapper.get('[data-testid="data-step-rail"]').text()).toContain('详情解析')
    expect(wrapper.find('[data-node-id="src-1-s1"] .pnr-node-state').classes()).toContain('state-L')
    expect(wrapper.find('[data-node-id="src-1-s2"] .pnr-node-state').classes()).toContain('state-E')

    await wrapper.get('[data-node-id="src-1-s2"]').trigger('click')
    expect(wrapper.emitted('select-table')?.at(-1)).toEqual(['TB_DETAIL'])
  })

  // 1016：源 430003100（流程 14009350）分叉后节点整段不显示——flowDef 漏传 branchGroups
  it('流程有分叉时，分叉之后各支的节点都显示', async () => {
    const branched = (stepId: string, name: string, dependsOn: string[]): Step =>
      ({ stepId, sourceId: 'src-1', name, dependsOn, inputTable: '900', outputTable: '900', enabled: true }) as Step
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(source)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([
      branched('41756', 'html下载机器', ['0']),
      branched('41758', 'html解析-A', ['41756']),
      branched('41760', 'html下载机器_chrome', ['41756']),
      branched('41767', 'html解析-B', ['41760']),
      branched('41783', '网页抓取', ['41767']),
    ])
    vi.spyOn(sourceApi, 'sourceNodeRuns').mockResolvedValue([])
    const wrapper = mount(StepDrawer, {
      props: { modelValue: true, sourceId: 'src-1' },
      global: { directives: { loading: {} }, stubs: { ElDrawer: { template: '<section><slot /></section>' } } },
    })
    await flushPromises()

    for (const id of ['41756', '41758', '41760', '41767', '41783']) {
      expect(wrapper.find(`[data-node-id="${id}"]`).exists(), id).toBe(true)
    }
  })
})
