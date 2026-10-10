// @vitest-environment jsdom
// 2026-10-10 流程版本（217）：与旧平台一致——发布版只读，点「编辑草稿」生成草稿后才能改。
import { describe, expect, it, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import FlowBoard from './FlowBoard.vue'
import { useFlowStore } from '@/stores/flow'
import { useFlowVersionStore } from '@/stores/flowVersion'
import { flowVersionApi, sourceApi, type FlowVersionOverview, type Step } from '@/api'

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

describe('FlowVersionBar · 发布版只读，编辑草稿后放开', () => {
  it('发布版：画布只读、不出「+」，版本条给出「编辑草稿」', async () => {
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue(published)
    const { wrapper } = await mountBoard()
    expect(wrapper.get('[data-testid="flow-version-published"]').text()).toBe('当前发布 V1')
    expect(wrapper.find('[data-testid="flow-version-edit-draft"]').exists()).toBe(true)
    expect(wrapper.find('.rc-canvas-body').classes()).toContain('is-version-readonly')
    expect(wrapper.find('.rc-edge-slot').exists()).toBe(false)
    wrapper.unmount()
  })

  it('点「编辑草稿」：生成草稿 V2、重载画布，画布放开、版本条换成发布 / 放弃', async () => {
    const overview = vi.spyOn(flowVersionApi, 'overview').mockResolvedValue(published)
    const action = vi.spyOn(flowVersionApi, 'action').mockImplementation(async () => {
      overview.mockResolvedValue(drafted)
      return { versionId: '1033' }
    })
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue({ sourceId: '430016824', name: 't', url: 'http://x', configId: 'X', mainTable: '900', owner: 'a', state: 'C', flowId: '21000003' } as never)
    const { wrapper } = await mountBoard()
    await wrapper.get('[data-testid="flow-version-edit-draft"]').trigger('click')
    await flushPromises()
    expect(action).toHaveBeenCalledWith('draft', { flowId: '21000003', versionId: '748', ver: 1, expectedPublishId: '748' })
    expect(wrapper.get('[data-testid="flow-version-draft"]').text()).toBe('草稿 V2 · 未发布')
    expect(wrapper.find('[data-testid="flow-version-publish"]').exists()).toBe(true)
    expect(wrapper.find('.rc-canvas-body').classes()).not.toContain('is-version-readonly')
    wrapper.unmount()
  })
})
