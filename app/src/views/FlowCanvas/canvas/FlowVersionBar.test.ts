// @vitest-environment jsdom
// 2026-10-10 流程版本（217）：10-11 定发布版直接改、首次保存自动生成草稿；锁定的草稿只读。
import { describe, expect, it, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import FlowBoard from './FlowBoard.vue'
import { useFlowStore } from '@/stores/flow'
import { useFlowVersionStore } from '@/stores/flowVersion'
import { flowVersionApi, type FlowVersionOverview, type Step } from '@/api'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

afterEach(() => vi.restoreAllMocks())

const mk = (stepId: string, dependsOn: string[]): Step => ({
  stepId, sourceId: '430016824', name: `n${stepId}`, dependsOn, inputTable: '900', outputTable: '900', enabled: true,
} as Step)
const row = (versionId: string, over: Partial<FlowVersionOverview['versions'][number]> = {}) => ({
  versionId, flowVer: 1, ver: 1, state: 'C', isLock: 0, isDelete: 0, baseId: null, ...over,
})
const published: FlowVersionOverview = { enabled: true, curVer: 1, nextVer: 2, publishId: '748', draftId: null, versions: [row('748')] }
const drafted: FlowVersionOverview = { ...published, draftId: '1033', versions: [row('1033', { flowVer: 2, state: 'W', baseId: '748' }), row('748')] }

async function mountBoard() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
  await router.push({ path: '/canvas', query: { sourceId: '430016824' } })
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  const flow = useFlowStore()
  const steps = [mk('1', ['0']), mk('2', ['1']), mk('3', ['1'])]
  flow.loadFromSource(
    { sourceId: '430016824', name: 't', url: 'http://x', configId: 'X', mainTable: '900', owner: 'a', state: 'C', flowId: '21000003' } as never,
    steps,
  )
  const version = useFlowVersionStore()
  await version.load('21000003')
  const wrapper = mount(FlowBoard, { global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
  await flushPromises()
  return { flow, version, wrapper }
}

describe('FlowVersionBar · 发布版直接改、首次保存自动生成草稿（10-11 定）', () => {
  it('发布版：画布可编辑、有「+」，流程标签栏里一个「已发布 v1」小徽标，没有「编辑草稿」按钮', async () => {
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue(published)
    const { wrapper } = await mountBoard()
    expect(wrapper.get('[data-testid="flow-version-published"]').text()).toBe('已发布 v1')
    // 10-11：不再单独占一行，嵌在流程标签栏（说明文字在悬停提示里）
    expect(wrapper.find('[data-testid="source-workflow-tabs"] [data-testid="flow-version-bar"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="flow-version-edit-draft"]').exists()).toBe(false)
    expect(wrapper.find('.rc-canvas-body').classes()).not.toContain('is-version-readonly')
    expect(wrapper.find('.rc-edge-slot').exists()).toBe(true)
    wrapper.unmount()
  })

  it('有草稿：徽标换成「草稿 v2 · 未发布」+ 放弃 / 发布 v2', async () => {
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue(drafted)
    const { wrapper } = await mountBoard()
    expect(wrapper.get('[data-testid="flow-version-draft"]').text()).toBe('草稿 v2 · 未发布')
    expect(wrapper.get('[data-testid="flow-version-publish"]').text()).toBe('发布 v2')
    expect(wrapper.find('[data-testid="flow-version-publish"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="flow-version-abandon"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('发布前统一检查（1014 ensureFlowReady）：有未保存的新节点就不发布，并选中该节点', async () => {
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue(drafted)
    const action = vi.spyOn(flowVersionApi, 'action').mockResolvedValue(undefined as never)
    const { flow, wrapper } = await mountBoard()
    const localId = flow.insertAfter('3', 'rule')!
    await wrapper.get('[data-testid="flow-version-publish"]').trigger('click')
    await flushPromises()
    expect(action).not.toHaveBeenCalled()
    expect(flow.selectedId).toBe(localId)
    wrapper.unmount()
  })

  it('草稿已锁定：只读但能看——不出「+」/ 删除 ✕ / 节点库，点节点照常选中', async () => {
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue({ ...drafted, versions: [row('1033', { flowVer: 2, state: 'W', baseId: '748', isLock: 1 }), row('748')] })
    const { flow, wrapper } = await mountBoard()
    expect(wrapper.find('[data-testid="flow-version-locked"]').exists()).toBe(true)
    expect(wrapper.find('.rc-canvas-body').classes()).toContain('is-version-readonly')
    expect(wrapper.find('.rc-edge-slot').exists()).toBe(false)
    expect(wrapper.find('[data-testid="node-delete"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="node-library-toggle"]').exists()).toBe(false)
    const node = wrapper.findAll('.rc-flow-node').find((n) => n.text().includes('#2'))!
    await node.trigger('click')
    expect(flow.selectedId).toBe('2')
    wrapper.unmount()
  })
})
