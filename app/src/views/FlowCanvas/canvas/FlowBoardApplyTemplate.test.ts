// @vitest-environment jsdom
// 0903 Y8-C：「从流程模板套用」。
// **落点在画布，不在新建向导**（2026-09-04 用户订正：「新建选模板的时候不需要，进画布模式的才需要」）。
// H03 的口径是把模板里那套配置**复制出一套新的**给本源，不是引用模板——所以走后端复制端点，
// 不走 flow.applyTemplate 那套前端逐个建节点的老路（Y8-20 已作废）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import FlowBoard from './FlowBoard.vue'
import { useFlowStore } from '@/stores/flow'
import { flowCenterApi, sourceApi, type FlowRecord, type Source } from '@/api'

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

const TEMPLATE = { id: '1400760', name: '新闻标准模板', definition: { main: [], branches: [], configs: {} }, updatedAt: '', isTemplate: true } as unknown as FlowRecord
const SOURCE = { sourceId: '430016398', name: 'test1', url: 'http://x.test/', configId: '1400917', mainTable: '6200026', owner: 'a', state: 'C' } as Source

afterEach(() => vi.restoreAllMocks())

async function mountEmptyCanvas(source: Source = SOURCE) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
  await router.push({ path: '/canvas', query: { sourceId: source.sourceId } })
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  const flow = useFlowStore()
  // 空画布：源没有任何步骤，也没有可合成的起点（url/mainTable 缺一即不合成）
  flow.loadFromSource({ ...source, url: '', mainTable: '' }, [])
  const wrapper = mount(FlowBoard, { global: { plugins: [pinia, router, ElementPlus] } })
  await flushPromises()
  return { flow, wrapper }
}

describe('FlowBoard · 从流程模板套用（Y8-C）', () => {
  it('源已有流程：走 copyTemplateSteps 把步骤复制进本源的流程', async () => {
    vi.spyOn(flowCenterApi, 'templates').mockResolvedValue([TEMPLATE])
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '1400760' } as never)
    const copySteps = vi.spyOn(flowCenterApi, 'copyTemplateSteps').mockResolvedValue({ ok: true, message: '复制成功，共复制 5 个步骤' })
    const copyFlow = vi.spyOn(flowCenterApi, 'copy')
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue({ ...SOURCE, flowId: '1400917' })
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([])

    const { wrapper } = await mountEmptyCanvas()
    await wrapper.get('[data-testid="apply-flow-template"]').trigger('click')
    await flushPromises()

    expect(copySteps).toHaveBeenCalledWith('1400760', '1400917')
    expect(copyFlow).not.toHaveBeenCalled() // 已有流程就不该再造一条
  })

  it('源还没有流程：先 copyFlow 造一条，再把本源绑上去', async () => {
    vi.spyOn(flowCenterApi, 'templates').mockResolvedValue([TEMPLATE])
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '1400760' } as never)
    const copyFlow = vi.spyOn(flowCenterApi, 'copy').mockResolvedValue('1400999')
    const bind = vi.spyOn(flowCenterApi, 'bindSources').mockResolvedValue({ ok: true })
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue({ ...SOURCE, flowId: undefined })
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([])

    const { wrapper } = await mountEmptyCanvas()
    await wrapper.get('[data-testid="apply-flow-template"]').trigger('click')
    await flushPromises()

    expect(copyFlow).toHaveBeenCalledWith('1400760', expect.stringContaining('test1'))
    expect(bind).toHaveBeenCalledWith(['430016398'], '1400999')
  })

  it('一个模板都没有时只提示，不弹输入框', async () => {
    vi.spyOn(flowCenterApi, 'templates').mockResolvedValue([])
    const prompt = vi.spyOn(ElMessageBox, 'prompt')
    const info = vi.spyOn(ElMessage, 'info').mockImplementation(() => undefined as never)

    const { wrapper } = await mountEmptyCanvas()
    await wrapper.get('[data-testid="apply-flow-template"]').trigger('click')
    await flushPromises()

    expect(prompt).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith(expect.stringContaining('还没有流程被标记为模板'))
  })

  it('套用成功后按后端拓扑重新加载画布，不在本地拼节点', async () => {
    vi.spyOn(flowCenterApi, 'templates').mockResolvedValue([TEMPLATE])
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '1400760' } as never)
    vi.spyOn(flowCenterApi, 'copyTemplateSteps').mockResolvedValue({ ok: true })
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue({ ...SOURCE, flowId: '1400917' })
    const steps = vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([])

    const { wrapper } = await mountEmptyCanvas()
    await wrapper.get('[data-testid="apply-flow-template"]').trigger('click')
    await flushPromises()

    expect(steps).toHaveBeenCalledWith('430016398', { withConfigDetails: false })
  })
})
