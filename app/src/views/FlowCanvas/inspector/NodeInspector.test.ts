// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import NodeInspector from './NodeInspector.vue'
import { useFlowStore } from '@/stores/flow'
import { NODE_CONFIGS, cloneConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { entryApi, paramApi, ruleApi } from '@/api'

function mockAssets() {
  vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 0, list: [] })
  vi.spyOn(paramApi, 'paramPaged').mockResolvedValue({ total: 0, list: [] })
  vi.spyOn(ruleApi, 'ruleGroups').mockResolvedValue([])
  vi.spyOn(ruleApi, 'rulePaged').mockResolvedValue({ total: 0, list: [] })
  vi.spyOn(ruleApi, 'sharedConfigs').mockResolvedValue([])
  vi.spyOn(ruleApi, 'orchestrationPaged').mockResolvedValue({ total: 0, list: [] })
}

// review 0723 #9 修正：文档原描述（onMounted 无条件加载 6 个 API）已经不成立，当前代码已有 isRule 判断；
// 但 NodeInspector 只 mount 一次、isRule 只在那一次 onMounted 判断，导致真实问题更严重——
// 打开画布时若没恰好选中规则节点，规则相关数据会永远加载不出来。这里验证懒加载 + 响应式补拉的修复。
afterEach(() => vi.restoreAllMocks())

describe('NodeInspector 规则数据懒加载（review 0723 #9 修正）', () => {
  it('打开画布选中非规则节点：规则相关 4 个 API 不调用；之后切到规则节点才补拉，且只拉一次', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = cloneConfig(NODE_CONFIGS['web-list'])
    flow.configs['rule-1'] = cloneConfig(NODE_CONFIGS['rule'])
    flow.configs['rule-2'] = cloneConfig(NODE_CONFIGS['rule'])
    flow.select('web-1')

    mount(NodeInspector)
    await flushPromises()

    expect(ruleApi.ruleGroups).not.toHaveBeenCalled()
    expect(ruleApi.rulePaged).not.toHaveBeenCalled()
    expect(ruleApi.sharedConfigs).not.toHaveBeenCalled()
    expect(ruleApi.orchestrationPaged).not.toHaveBeenCalled()

    flow.select('rule-1')
    await flushPromises()

    expect(ruleApi.ruleGroups).toHaveBeenCalledTimes(1)
    expect(ruleApi.rulePaged).toHaveBeenCalledTimes(1)
    expect(ruleApi.sharedConfigs).toHaveBeenCalledTimes(1)
    expect(ruleApi.orchestrationPaged).toHaveBeenCalledTimes(1)

    // 切到另一个规则节点：数据已经拉过，不重复请求
    flow.select('rule-2')
    await flushPromises()
    expect(ruleApi.ruleGroups).toHaveBeenCalledTimes(1)
  })

  it('打开画布时就选中规则节点：mount 时直接拉规则数据', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['rule-1'] = cloneConfig(NODE_CONFIGS['rule'])
    flow.select('rule-1')

    mount(NodeInspector)
    await flushPromises()

    expect(ruleApi.ruleGroups).toHaveBeenCalledTimes(1)
  })
})

// 参数子源的 urlTemplate 只灌给主链首个采集节点（flowModel.applyParamSourceUrlToFirstCollectNode），
// 之前「参数配置」tab 的展示条件只看 isParamSource（源级），导致非首个采集节点也误展示参数子源摘要，
// 挡掉了它自己本该有的 UrlParamEditor（节点级单值绑定）入口。这里验证按 isFirstCollectorNode 收窄后的展示。
// 0802 重构·方案 A：参数子源编辑入口整体挪到 ConfigTab 源 URL 区，ParamsTab 不再重复展示摘要/跳转按钮；
// 仅在「非首个采集节点 + 是参数源」时给一行提示，避免用户误以为本节点能编辑参数子源。
describe('NodeInspector 参数子源编辑入口在 ConfigTab（0802 重构）', () => {
  function setupParamSource() {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.sourceCfg = {
      sourceId: 's-1', name: '参数子源', url: '', configId: '', mainTable: 'T1', owner: 'admin', state: 'C',
      kind: 'param', baseUrl: 'http://base', urlTemplate: 'http://base-$PARAM$_913',
      paramRefs: [{ paramId: '913', group: null }],
    }
    const first = cloneConfig(NODE_CONFIGS['web-list'])
    if (first.collectCfg) first.collectCfg.url = 'http://base-$PARAM$_913'
    const second = cloneConfig(NODE_CONFIGS['web-list'])
    flow.main = ['web-1', 'web-2']
    flow.configs['web-1'] = first
    flow.configs['web-2'] = second
    return flow
  }

  it('首个采集节点 + 是参数子源：ParamsTab 不展示「非首个」提示，照常展示 UrlParamEditor（URL 取自参数子源）', async () => {
    mockAssets()
    const flow = setupParamSource()
    flow.select('web-1')
    flow.setActiveTab('params')

    const wrapper = mount(NodeInspector)
    await flushPromises()

    // 编辑入口在 ConfigTab：ParamsTab 没有任何「去配置」按钮或摘要块
    expect(wrapper.find('[data-testid="params-jump-to-config"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('去「配置」编辑参数子源')
    // 首节点：URL 由参数子源管理，不展示「本源为参数子源…本节点的 URL 参数按下方单独配置」的非首节点提示
    expect(wrapper.text()).not.toContain('本源为参数子源')
    // 节点级 UrlParamEditor 仍展示，URL 由 applyParamSourceUrlToFirstCollectNode 同步进 cc.url
    expect(wrapper.find('.upe').exists()).toBe(true)
    // 源级 urlTemplate 已被灌进首节点 cc.url，UrlParamEditor 拿到的 url prop 应当带 $PARAM$_913
    const upeUrl = (wrapper.findComponent({ name: 'UrlParamEditor' }) as any)?.props('url')
      ?? wrapper.find('.upe').attributes('data-url')
    expect(typeof upeUrl === 'string' ? upeUrl : '').toContain('$PARAM$_913')
  })

  it('非首个采集节点：展示提示 + 自己的 UrlParamEditor，不展示参数子源摘要/跳转按钮', async () => {
    mockAssets()
    const flow = setupParamSource()
    flow.select('web-2')
    flow.setActiveTab('params')

    const wrapper = mount(NodeInspector)
    await flushPromises()

    expect(wrapper.text()).toContain('本源为参数子源')
    expect(wrapper.find('[data-testid="params-jump-to-config"]').exists()).toBe(false)
    expect(wrapper.find('.upe').exists()).toBe(true)
  })

  it('首个采集节点 + 切到「配置」tab：源 URL 下方挂载 ParamSourceEditor（编辑态），不是只读', async () => {
    mockAssets()
    const flow = setupParamSource()
    flow.select('web-1')
    flow.setActiveTab('config')

    const wrapper = mount(NodeInspector)
    await flushPromises()

    expect(wrapper.find('[data-testid="param-source-pick"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="param-source-template"]').exists()).toBe(true)
    expect(wrapper.find('.ssw-readonly-template').exists()).toBe(false)
  })

  it('非首个采集节点 + 切到「配置」tab：源 URL 下方不挂载 ParamSourceEditor', async () => {
    mockAssets()
    const flow = setupParamSource()
    flow.select('web-2')
    flow.setActiveTab('config')

    const wrapper = mount(NodeInspector)
    await flushPromises()

    expect(wrapper.find('[data-testid="param-source-pick"]').exists()).toBe(false)
  })

  it('非参数源 + 首个采集节点 + 切到「配置」tab：源 URL 下方也不挂载 ParamSourceEditor', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.sourceCfg = {
      sourceId: 's-2', name: '普通子源', url: 'http://x.com', configId: '', mainTable: 'T1', owner: 'admin', state: 'C',
      // kind 缺省 = 'normal'
    }
    const first = cloneConfig(NODE_CONFIGS['web-list'])
    flow.main = ['web-1']
    flow.configs['web-1'] = first
    flow.select('web-1')
    flow.setActiveTab('config')

    const wrapper = mount(NodeInspector)
    await flushPromises()

    expect(wrapper.find('[data-testid="param-source-pick"]').exists()).toBe(false)
  })
})
