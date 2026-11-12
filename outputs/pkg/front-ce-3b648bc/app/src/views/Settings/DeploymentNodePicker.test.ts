// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { flowCenterApi, type FlowRecord, type Step } from '@/api'
import DeploymentNodePicker from './DeploymentNodePicker.vue'

vi.mock('@/api', () => ({ flowCenterApi: { paged: vi.fn(), steps: vi.fn() } }))
const flows = [{ id: '101', name: '新闻列表' }, { id: '102', name: '详情流程' }] as FlowRecord[]
const steps: Step[] = [{ stepId: 's1', sourceId: '1', name: '抓列表', configId: '123', enabled: true }, { stepId: 's2', sourceId: '1', name: '未保存', configId: '', enabled: true }]
beforeEach(() => {
  vi.mocked(flowCenterApi.paged).mockResolvedValue({ list: flows, total: 2 })
  vi.mocked(flowCenterApi.steps).mockResolvedValue(steps)
})
afterEach(() => { vi.resetAllMocks(); document.body.innerHTML = '' })
async function setup() {
  const wrapper = mount(DeploymentNodePicker, { props: { modelValue: false, busy: false, error: '' }, global: { plugins: [ElementPlus], stubs: { teleport: true } } })
  await wrapper.setProps({ modelValue: true }); await flushPromises()
  return wrapper
}
it('先选流程再选已保存配置的节点，返回明确的来源关系', async () => {
  const wrapper = await setup()
  expect(flowCenterApi.steps).toHaveBeenCalledWith('101', { withConfigDetails: false, backendScope: 'flow' })
  const table = wrapper.getComponent({ name: 'ElTable' })
  table.vm.$emit('current-change', steps[1]); await flushPromises()
  expect(wrapper.get('[data-testid="deployment-node-confirm"]').attributes('disabled')).toBeDefined()
  table.vm.$emit('current-change', steps[0]); await flushPromises()
  await wrapper.get('[data-testid="deployment-node-confirm"]').trigger('click')
  expect(wrapper.emitted('select')?.[0]?.[0]).toEqual({ flowId: '101', flowName: '新闻列表', stepId: 's1', nodeName: '抓列表', configId: '123' })
  wrapper.unmount()
})
it('快速切换流程忽略旧节点响应，查询失败清除旧选择', async () => {
  const wrapper = await setup()
  let resolveOld!: (value: Step[]) => void
  vi.mocked(flowCenterApi.steps).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
  await wrapper.findAll('.node-picker-flow')[0]!.trigger('click')
  await wrapper.findAll('.node-picker-flow')[1]!.trigger('click'); await flushPromises()
  resolveOld([{ stepId: 'old', sourceId: '', name: '旧响应', configId: 'old', enabled: true }]); await flushPromises()
  expect(wrapper.getComponent({ name: 'ElTable' }).props('data')).toEqual(steps)
  vi.mocked(flowCenterApi.paged).mockRejectedValue(new Error('流程查询失败'))
  await wrapper.get('input[aria-label="搜索来源流程"]').setValue('102')
  await wrapper.get('input[aria-label="搜索来源流程"]').trigger('keyup.enter'); await flushPromises()
  expect(flowCenterApi.paged).toHaveBeenLastCalledWith({ page: 1, size: 10, flowIds: ['102'] })
  expect(wrapper.text()).toContain('流程查询失败')
  expect(wrapper.get('[data-testid="deployment-node-confirm"]').attributes('disabled')).toBeDefined()
  wrapper.unmount()
})
