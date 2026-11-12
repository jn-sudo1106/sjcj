// @vitest-environment jsdom
// 1008-BR-01：旧平台能勾选多个上级（lastStep="A,B"）。画布只按第一个上级连线，
// 其余上级在节点卡片上标「另有上级」，悬停列出是哪几个——不画额外连线（217 存量 0 条）。
import { describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import FlowBoard from './FlowBoard.vue'
import { useFlowStore } from '@/stores/flow'
import { useSourceStore } from '@/stores/source'
import type { Step } from '@/api'

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
  const draftId = flow.main.find((id) => id !== 'start' && id !== 'end')!
  flow.configs['41801'] = { ...flow.configs[draftId], title: '列表抓取' }
  flow.main.splice(flow.main.indexOf(draftId), 1, '41801')
  const wrapper = mount(FlowBoard, { global: { plugins: [pinia, router, ElementPlus] } })
  await flushPromises()
  return { flow, wrapper, source: useSourceStore() }
}

const step = (stepId: string, dependsOn: string[]): Step =>
  ({ stepId, sourceId: 'source-a', name: stepId, dependsOn, enabled: true }) as Step

describe('FlowBoard · 多上级步骤标「另有上级」', () => {
  it('只有一个上级时不显示', async () => {
    const { wrapper, source } = await mountBoard()
    source.rememberSteps([step('41801', ['0'])], 'merge')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="node-extra-parents-41801"]').exists()).toBe(false)
  })

  it('有多个上级时显示，悬停列出画布没连线的上级', async () => {
    const { wrapper, source } = await mountBoard()
    source.rememberSteps([step('41801', ['0', '41790', '41795'])], 'merge')
    await wrapper.vm.$nextTick()
    const tag = wrapper.get('[data-testid="node-extra-parents-41801"]')
    expect(tag.text()).toBe('另有上级')
    expect(tag.attributes('title')).toContain('#41790')
    expect(tag.attributes('title')).toContain('#41795')
    expect(tag.attributes('title')).toContain('流程入口')
  })
})
