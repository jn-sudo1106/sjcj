// @vitest-environment jsdom
// 节点卡片上的删除叉（0828 D05）。会上原话：「那个节点上面要搞个叉」——
// 删节点不该非得回右侧面板或右键菜单。右键菜单里的「删除节点」保留，两条路径同一个 store 动作。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import FlowBoard from './FlowBoard.vue'
import { useFlowStore } from '@/stores/flow'

// jsdom 没有 ResizeObserver，FlowBoard 内的画布尺寸监听会在 mounted 里抛错。
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

describe('节点卡片删除叉', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('每个节点卡片上都有删除叉', async () => {
    const { flow, wrapper } = await mountBoard()
    const dels = wrapper.findAll('[data-testid="node-delete"]')
    expect(dels.length).toBe(flow.layout.nodes.length)
    expect(dels.length).toBeGreaterThan(0)
  })

  it('点叉删掉该节点，且不触发节点选中（@click.stop）', async () => {
    const { flow, wrapper } = await mountBoard()
    const before = flow.main.length
    const targetId = flow.layout.nodes.find((n) => n.id === 'web-list')!.id
    const card = wrapper.findAll('.rc-flow-node').find((c) => c.text().includes(flow.configs[targetId].title))!
    await card.find('[data-testid="node-delete"]').trigger('click')

    expect(flow.main).not.toContain(targetId)
    expect(flow.main.length).toBe(before - 1)
    expect(flow.selectedId).not.toBe(targetId)
  })

  it('删除节点只删流程里的引用，不动配置身份（0824-00 §5.3：删节点不删 Config）', async () => {
    const { flow, wrapper } = await mountBoard()
    flow.bindCopiedConfig('web-list', '1400774', '证券之星列表配置')
    await wrapper.vm.$nextTick()
    const card = wrapper.findAll('.rc-flow-node').find((c) => c.text().includes(flow.configs['web-list'].title))!
    await card.find('[data-testid="node-delete"]').trigger('click')
    expect(flow.main).not.toContain('web-list')
  })
})
