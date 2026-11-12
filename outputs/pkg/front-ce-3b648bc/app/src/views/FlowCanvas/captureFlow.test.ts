// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flowCenterApi, flowVersionApi, sourceApi, workflowBindingApi, type Source, type WorkflowBinding } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { useUiStore } from '@/stores/ui'
import FlowCanvas from './index.vue'

afterEach(() => vi.restoreAllMocks())

it('画布发起抓取使用当前辅助流程，不回退源的主流程', async () => {
  const source = { sourceId: '430024910', siteId: '11', name: '测试源', flowId: '14009350', state: 'C' } as Source
  vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(source)
  vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([])
  vi.spyOn(sourceApi, 'stepConfigDetails').mockResolvedValue([])
  vi.spyOn(sourceApi, 'sourceJobs').mockResolvedValue([])
  vi.spyOn(sourceApi, 'loadParams').mockResolvedValue({})
  const send = vi.spyOn(sourceApi, 'sendSnatchWithParam').mockResolvedValue({ ok: true })
  vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([])
  vi.spyOn(flowVersionApi, 'overview').mockResolvedValue({ enabled: false, curVer: null, nextVer: null, publishId: null, draftId: null, versions: [] })
  vi.spyOn(workflowBindingApi, 'list').mockResolvedValue([
    { workflowId: '14009350', publishedFlowId: '14009350', primary: true } as WorkflowBinding,
    { workflowId: '21000040', publishedFlowId: '21000040', primary: false, versionStatus: 'PUBLISHED' } as WorkflowBinding,
  ])
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
  await router.push({ path: '/canvas', query: { sourceId: source.sourceId, view: 'flow', workflowId: '21000040', flowId: '21000040' } })
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(FlowCanvas, { global: {
    plugins: [pinia, router], directives: { loading: {} },
    stubs: { FlowBoard: true, ResultView: true, NodeInspector: true, SiteSourceSwitcher: true, SourceTabsBar: true, SourceSummaryView: true, TaskView: true, FileView: true, SiteDetailView: true, CompareSplit: true, LoginConfigSelectDialog: true, NewSiteWizard: true, SourceParamModal: true },
  } })
  try {
    await flushPromises()
    expect(useFlowStore().sourceCtx).toMatchObject({ flowId: '21000040', primaryFlowId: '14009350' })
    useUiStore().fireAction('发起抓取')
    await flushPromises()
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ ids: ['430024910'], flowId: '21000040' }))
  } finally { wrapper.unmount() }
})
