// @vitest-environment jsdom
// 「更换配置」（0828 §2.1-2b）：配置条保持原静态样式，旁边一个轻量入口，点开走选择弹窗。
// 这里只测**绑定语义**——它是踩过的坑：configs/same 返回精简对象，直接绑会把 entryTypeId/topic 写空。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessageBox } from 'element-plus'
import NodeConfigSelect from './NodeConfigSelect.vue'
import SelectExistingConfigDialog from './SelectExistingConfigDialog.vue'
import { useFlowStore } from '@/stores/flow'
import { useSourceStore } from '@/stores/source'
import { configApi, flowCenterApi, type Config, type FlowRecord } from '@/api'

const PICKED: Config = { configId: '1400774', name: '证券之星列表配置' } as Config
const FULL_DETAIL: Config = {
  configId: '1400774', name: '证券之星列表配置', url: 'http://www.baidu.com', entryTypeId: '2103330', topic: 'q-list',
} as Config

afterEach(() => vi.restoreAllMocks())

function mountOnNode() {
  setActivePinia(createPinia())
  const flow = useFlowStore()
  flow.newFlow('standard')
  flow.sourceCtx = { sourceId: '430016501', name: '测试源' } as never
  const wrapper = mount(NodeConfigSelect, {
    props: { nodeId: 'web-list' },
    global: { plugins: [ElementPlus] },
  })
  return { flow, wrapper }
}

describe('更换配置', () => {
  it('点「更换」打开选择弹窗，不直接改节点', async () => {
    const { flow, wrapper } = mountOnNode()
    await wrapper.find('[data-testid="node-config-select"]').trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(SelectExistingConfigDialog).props('open')).toBe(true)
    expect(flow.configs['web-list'].configId).toBeUndefined()
  })

  it('选中后先取 configDetail 再绑，绑的是完整配置而不是精简对象', async () => {
    const detail = vi.spyOn(configApi, 'configDetail').mockResolvedValue(FULL_DETAIL)
    const { flow, wrapper } = mountOnNode()
    wrapper.findComponent(SelectExistingConfigDialog).vm.$emit('select', PICKED)
    await flushPromises()
    expect(detail).toHaveBeenCalledWith('1400774')
    expect(flow.configs['web-list'].configId).toBe('1400774')
    // 精简对象没有 entryTypeId，直接绑会把输出表写空——必须来自 configDetail
    expect(flow.configs['web-list'].collectCfg?.outputTable).toBe('2103330')
    expect(flow.configs['web-list'].configUrl).toBe('http://www.baidu.com')
  })

  it('configDetail 读不到就不绑定，宁可不绑也不绑错', async () => {
    vi.spyOn(configApi, 'configDetail').mockResolvedValue(undefined as never)
    const { flow, wrapper } = mountOnNode()
    wrapper.findComponent(SelectExistingConfigDialog).vm.$emit('select', PICKED)
    await flushPromises()
    expect(flow.configs['web-list'].configId).toBeUndefined()
  })

  it('非源画布时入口禁用（按源查同资源配置需要 sourceId）', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.newFlow('standard')
    const wrapper = mount(NodeConfigSelect, {
      props: { nodeId: 'web-list' },
      global: { plugins: [ElementPlus] },
    })
    expect(wrapper.find('[data-testid="node-config-select"]').attributes('disabled')).toBeDefined()
  })

  // 0927 G1：流程工作区里画布第一个节点就是真实 ROOT（isRoot=1）——它的配置可换（ROOT 权威
  // 方案下首任务配置=ROOT.CONFIG_ID，新流程是未配置草稿，不换就永远无法调度）；换配置走 ROOT
  // 专属通道，候选不受源限制（后端 ROOT 可挂任意有效配置）。
  it('flowIdMode 下真实 ROOT 节点放行更换配置，弹窗不带源限制', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.newFlow('standard')
    flow.setFlowIdMode(true)
    const source = useSourceStore()
    source.rememberSteps([{
      stepId: '41352', sourceId: '', name: '流程入口', isRoot: true, enabled: true,
    } as never], 'replace')
    const wrapper = mount(NodeConfigSelect, {
      props: { nodeId: '41352' },
      global: { plugins: [ElementPlus] },
    })
    expect(wrapper.find('[data-testid="node-config-select"]').attributes('disabled')).toBeUndefined()
    await wrapper.find('[data-testid="node-config-select"]').trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(SelectExistingConfigDialog).props('open')).toBe(true)
    expect(wrapper.findComponent(SelectExistingConfigDialog).props('sourceId')).toBeUndefined()
  })

  it('flowIdMode 下普通节点仍禁用（无源上下文，按源查不了同资源配置）', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.newFlow('standard')
    flow.setFlowIdMode(true)
    const wrapper = mount(NodeConfigSelect, {
      props: { nodeId: 'web-list' },
      global: { plugins: [ElementPlus] },
    })
    expect(wrapper.find('[data-testid="node-config-select"]').attributes('disabled')).toBeDefined()
  })

  // 0927 P1-8：虚拟根（svg 回退行 stepId='0'、isRoot=1）不是真实物化 ROOT——isRootNode 排除
  // '0' 后与普通节点同规则禁用，不触发 rootConfigUpdate（那会把虚拟根物化成真根）。
  it('flowIdMode 下虚拟根（stepId=0 的 isRoot 行）不按 ROOT 放行：与普通节点同规则禁用', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.newFlow('standard')
    flow.setFlowIdMode(true)
    const source = useSourceStore()
    source.rememberSteps([{
      stepId: '0', sourceId: '', name: '虚拟根', isRoot: true, enabled: true,
    } as never], 'replace')
    const wrapper = mount(NodeConfigSelect, {
      props: { nodeId: '0' },
      global: { plugins: [ElementPlus] },
    })
    expect(wrapper.find('[data-testid="node-config-select"]').attributes('disabled')).toBeDefined()
  })

  // 0928：源画布里入口节点是流程的真实 ROOT，换配置影响该流程下全部源——必须先确认。
  function mountRootInSourceCanvas() {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.newFlow('standard')
    flow.sourceCtx = { sourceId: '430016501', name: '测试源', flowId: '1400976' } as never
    useSourceStore().rememberSteps([{
      stepId: '41352', sourceId: '-1', name: '流程入口', isRoot: true, enabled: true,
    } as never], 'replace')
    flow.configs['41352'] = { ...flow.configs['web-list'], configId: '1400976' }
    const wrapper = mount(NodeConfigSelect, {
      props: { nodeId: '41352' },
      global: { plugins: [ElementPlus] },
    })
    return { flow, wrapper }
  }

  it('源画布换 ROOT 配置：先弹确认并写明影响源数，确认后才绑定', async () => {
    vi.spyOn(configApi, 'configDetail').mockResolvedValue(FULL_DETAIL)
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue({ id: '1400976', sourceCnt: 6028 } as FlowRecord)
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const { flow, wrapper } = mountRootInSourceCanvas()
    wrapper.findComponent(SelectExistingConfigDialog).vm.$emit('select', PICKED)
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(String(confirm.mock.calls[0][0])).toContain('6028 个源')
    expect(String(confirm.mock.calls[0][0])).toContain('#1400976')
    expect(flow.configs['41352'].configId).toBe('1400774')
  })

  it('源画布换 ROOT 配置：取消确认则不取详情、不绑定', async () => {
    const detail = vi.spyOn(configApi, 'configDetail').mockResolvedValue(FULL_DETAIL)
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(null)
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const { flow, wrapper } = mountRootInSourceCanvas()
    wrapper.findComponent(SelectExistingConfigDialog).vm.$emit('select', PICKED)
    await flushPromises()
    expect(detail).not.toHaveBeenCalled()
    expect(flow.configs['41352'].configId).toBe('1400976')
  })

  it('源画布普通节点与流程工作区 ROOT 不弹确认', async () => {
    vi.spyOn(configApi, 'configDetail').mockResolvedValue(FULL_DETAIL)
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    const { wrapper } = mountOnNode()
    wrapper.findComponent(SelectExistingConfigDialog).vm.$emit('select', PICKED)
    await flushPromises()

    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.newFlow('standard')
    flow.setFlowIdMode(true)
    useSourceStore().rememberSteps([{
      stepId: '41352', sourceId: '', name: '流程入口', isRoot: true, enabled: true,
    } as never], 'replace')
    flow.configs['41352'] = { ...flow.configs['web-list'] }
    const drawer = mount(NodeConfigSelect, { props: { nodeId: '41352' }, global: { plugins: [ElementPlus] } })
    drawer.findComponent(SelectExistingConfigDialog).vm.$emit('select', PICKED)
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect(flow.configs['41352'].configId).toBe('1400774')
  })
})
