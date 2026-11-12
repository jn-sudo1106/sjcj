// @vitest-environment jsdom
// 2026-09-30：节点卡片展示步骤 ID（cs_item_config 行 ID，旧平台节点图上的 #41800）。
// 只有已落库的节点（纯数字 ID）才显示；本地草稿节点是临时 ID，不显示。
import { describe, expect, it } from 'vitest'
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

describe('FlowBoard · 节点卡片的步骤 ID', () => {
  it('草稿节点不显示步骤 ID；已落库节点显示 #步骤ID', async () => {
    const { flow, wrapper } = await mountBoard()
    expect(wrapper.find('[data-testid="node-step-id"]').exists()).toBe(false)

    const draftId = flow.main.find((id) => id !== 'start' && id !== 'end')!
    flow.configs['41800'] = { ...flow.configs[draftId] }
    flow.main.splice(flow.main.indexOf(draftId), 1, '41800')
    await wrapper.vm.$nextTick()

    const tag = wrapper.get('[data-testid="node-step-id"]')
    expect(tag.text()).toBe('#41800')
    expect(tag.attributes('title')).toContain('步骤 ID 41800')
  })
})
