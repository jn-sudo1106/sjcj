// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import FlowCanvas from './index.vue'
import { flowCenterApi, sourceApi, workflowBindingApi, type Source, type WorkflowBinding } from '@/api'
import { useFlowStore } from '@/stores/flow'

describe('源工作区本地流程与原运行环境的切换', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })
  it('概览和数据保持运行流程，切换到流程才加载本地草稿，返回数据恢复原流程', async () => {
    vi.stubEnv('VITE_FLOW_PROXY_TARGET', 'http://127.0.0.1:8090')
    const source = { sourceId: 'source-fixture', siteId: '124', name: '源', configId: '100', flowId: '200', state: 'C' } as Source
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(source)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([])
    vi.spyOn(sourceApi, 'stepConfigDetails').mockResolvedValue([])
    vi.spyOn(sourceApi, 'sourceJobs').mockResolvedValue([])
    const bindings = vi.spyOn(workflowBindingApi, 'list').mockResolvedValue([
      { workflowId: '300', publishedFlowId: '200', draftFlowId: '400', primary: true, versionManaged: true, draftVersionNo: 2 } as WorkflowBinding,
    ])
    const steps = vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([])
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
    await router.push({ path: '/canvas', query: { sourceId: source.sourceId, siteId: '124', view: 'overview' } })
    await router.isReady()
    const pinia = createPinia(); setActivePinia(pinia)
    const wrapper = mount(FlowCanvas, { global: {
      plugins: [pinia, router], directives: { loading: {} },
      stubs: { FlowBoard: true, ResultView: true, NodeInspector: true, SiteSourceSwitcher: true, SourceTabsBar: true, SourceSummaryView: true, TaskView: true, FileView: true, SiteDetailView: true, CompareSplit: true, LoginConfigSelectDialog: true, NewSiteWizard: true },
    } })
    try {
      await flushPromises()
      expect(bindings).not.toHaveBeenCalled()
      expect(steps).toHaveBeenLastCalledWith('200', { withConfigDetails: false, backendScope: 'default' })
      expect(useFlowStore().sourceCtx?.flowId).toBe('200')
      await router.replace({ query: { ...router.currentRoute.value.query, view: 'flow' } })
      await flushPromises()
      expect(bindings).toHaveBeenCalled()
      expect(steps).toHaveBeenLastCalledWith('400', { withConfigDetails: false, backendScope: 'flow' })
      expect(useFlowStore().sourceCtx?.flowId).toBe('400')
      await router.replace({ query: { ...router.currentRoute.value.query, view: 'data' } })
      await flushPromises()
      expect(steps).toHaveBeenLastCalledWith('200', { withConfigDetails: false, backendScope: 'default' })
      expect(useFlowStore().sourceCtx?.flowId).toBe('200')
      expect(useFlowStore().sourceCtx?.draftFlowId).toBeUndefined()
    } finally { wrapper.unmount() }
  })
})
