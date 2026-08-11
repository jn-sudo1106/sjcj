// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import StepDrawer from './StepDrawer.vue'
import { flowApi, sourceApi, type Source, type Step } from '@/api'

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
    vi.spyOn(flowApi, 'flowLoad').mockResolvedValue(null)
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
})
