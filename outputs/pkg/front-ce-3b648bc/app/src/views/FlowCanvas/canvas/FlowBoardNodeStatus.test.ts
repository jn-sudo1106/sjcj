// @vitest-environment jsdom
// 2026-09-18 用户报：节点右侧明明「已有配置 #1401008」、卡片上也写着「⊞ 通用新闻表」，
// 底部状态却是「待配置」（title：还缺输出表）。
//
// 根因是两处口径不一致：卡片那行表名用 effectiveOutputTable（没显式设就继承上游），
// 状态判定只认 nodeOutputTable（显式值）。本文件锁住"两边必须一致"。
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import FlowBoard from './FlowBoard.vue'
import { useFlowStore } from '@/stores/flow'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

async function mountBoard() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/canvas', component: { template: '<div />' } }],
  })
  await router.push({ path: '/canvas', query: { sourceId: 'source-a' } })
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  const flow = useFlowStore()
  flow.newFlow('standard')
  const wrapper = mount(FlowBoard, { global: { plugins: [pinia, router, ElementPlus] } })
  await flushPromises()
  return { flow, wrapper }
}

describe('FlowBoard · 节点状态与卡片上的表名必须一致', () => {
  const cardOf = (wrapper: ReturnType<typeof mount>, cfg: { title: string }) =>
    wrapper.findAll('.rc-flow-node').find((c) => c.text().includes(cfg.title))!

  // 0926 补记：原用例走 vm.tableChip/footFor（script setup 内部函数未 expose，Vue3.3+ 拿不到），
  // 改为 DOM 断言——表标签与状态 chip 都要在卡片上真实渲染出来，断言更贴近用户所见。
  it('非采集节点继承上游输出表时算「已配置」，不再是「待配置」', async () => {
    const { flow, wrapper } = await mountBoard()
    const targetId = flow.main.find((id) => id !== 'start' && id !== 'end')!
    const cfg = flow.configs[targetId]
    // 造一个处理型节点（文章生成摘要这类）：没有采集配置、没显式输出表，只继承上游的表
    delete cfg.collectCfg
    cfg.inputTable = '900'
    cfg.outputTable = ''
    await wrapper.vm.$nextTick()

    const card = cardOf(wrapper, cfg)
    // 卡片那行表名认这张表（title 里写清是继承来的输入表）
    expect(card.find('.rc-node-table').exists()).toBe(true)
    expect(card.find('.rc-node-table').classes()).not.toContain('unset')
    expect(card.find('.rc-node-table').attributes('title')).toContain('默认继承输入表')
    // 状态必须跟着它走
    expect(card.findAll('.rc-chip').some((c) => c.text() === '待配置')).toBe(false)
  })

  // 节点种子里几乎每个模板的初始 status 都写着 '待配置'，配好之后没人清它。
  // 此前 footFor 原样把它当运行态吐出来，于是「已配置」的节点仍然显示「待配置」，
  // 而 missingFor 又查不出缺什么——卡片上只剩一个没有任何解释的标签（用户报的就是这个）。
  it('种子里的初始 status「待配置」不当运行态用', async () => {
    const { flow, wrapper } = await mountBoard()
    const targetId = flow.main.find((id) => id !== 'start' && id !== 'end')!
    const cfg = flow.configs[targetId]
    delete cfg.collectCfg
    cfg.inputTable = '900'
    cfg.outputTable = '900'
    cfg.status = '待配置'          // 种子里带来的占位值
    await wrapper.vm.$nextTick()

    const card = cardOf(wrapper, cfg)
    const chip = card.find('.rc-chip')
    expect(chip.text()).toBe('运行')

    // 真正的运行态照常显示
    cfg.status = '运行中'
    await wrapper.vm.$nextTick()
    expect(cardOf(wrapper, cfg).find('.rc-chip').text()).toBe('运行中')
  })

  it('上下游都没有表才是真的「待配置」，并说明缺什么', async () => {
    const { flow, wrapper } = await mountBoard()
    const targetId = flow.main.find((id) => id !== 'start' && id !== 'end')!
    const cfg = flow.configs[targetId]
    delete cfg.collectCfg
    cfg.inputTable = ''
    cfg.outputTable = ''
    await wrapper.vm.$nextTick()

    const card = cardOf(wrapper, cfg)
    expect(card.find('.rc-node-table').exists()).toBe(false)
    const chip = card.findAll('.rc-chip').find((c) => c.text() === '待配置')!
    expect(chip.attributes('title')).toContain('输出表')
  })
})


describe('FlowBoard · 无关联流程', () => {
  it('空列表或加载失败时隐藏兜底节点，关联后恢复画布', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
    await router.push('/canvas?sourceId=100')
    await router.isReady()
    const pinia = createPinia()
    setActivePinia(pinia)
    const flow = useFlowStore()
    flow.loadFromSource({ sourceId: '100', name: '测试源', url: 'https://example.com', mainTable: '900', configId: '123', owner: '', state: 'C' }, [])
    expect(flow.layout.nodes.length).toBeGreaterThan(0)
    const tabs = defineComponent({ name: 'WorkflowTabsStub', emits: ['status'], template: '<div />' })
    const wrapper = mount(FlowBoard, { global: { plugins: [pinia, router, ElementPlus], stubs: { SourceWorkflowTabs: tabs, CanvasHeader: true } } })
    const tab = wrapper.getComponent(tabs)
    tab.vm.$emit('status', 'empty')
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="workflow-canvas-status"]').text()).toContain('暂无关联流程')
    expect(wrapper.find('.rc-flow-node').exists()).toBe(false)
    tab.vm.$emit('status', 'error')
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="workflow-canvas-status"]').text()).toContain('加载失败')
    tab.vm.$emit('status', 'ready')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="workflow-canvas-status"]').exists()).toBe(false)
    expect(wrapper.find('.rc-flow-node').exists()).toBe(true)
    wrapper.unmount()
  })
})
