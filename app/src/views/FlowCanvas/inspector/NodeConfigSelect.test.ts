// @vitest-environment jsdom
// 「更换配置」（0828 §2.1-2b）：配置条保持原静态样式，旁边一个轻量入口，点开走选择弹窗。
// 这里只测**绑定语义**——它是踩过的坑：configs/same 返回精简对象，直接绑会把 entryTypeId/topic 写空。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import NodeConfigSelect from './NodeConfigSelect.vue'
import SelectExistingConfigDialog from './SelectExistingConfigDialog.vue'
import { useFlowStore } from '@/stores/flow'
import { configApi, type Config } from '@/api'

const PICKED: Config = { configId: '1400774', name: '证券之星列表配置' } as Config
const FULL_DETAIL: Config = {
  configId: '1400774', name: '证券之星列表配置', entryTypeId: '2103330', topic: 'q-list',
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
})
