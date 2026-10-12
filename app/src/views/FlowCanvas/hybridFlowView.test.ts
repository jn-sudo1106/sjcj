// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import FlowCanvas from './index.vue'
import { flowCenterApi, flowVersionApi, sourceApi, workflowBindingApi, type Source, type WorkflowBinding } from '@/api'
import { useFlowStore } from '@/stores/flow'

describe('源工作区本地流程与原运行环境的切换', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })
  it('概览和数据保持运行流程，切换到流程才加载本地草稿，返回数据恢复原流程', async () => {
    vi.stubEnv('VITE_FLOW_PROXY_TARGET', 'http://127.0.0.1:8090')
    const source = { sourceId: 'source-fixture', siteId: '124', name: '源', configId: '100', flowId: '200', state: 'C' } as Source
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue({ enabled: false, curVer: null, nextVer: null, publishId: null, draftId: null, versions: [] })
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

describe('未绑流程的源（2026-10-12）', () => {
  afterEach(() => { vi.restoreAllMocks() })
  it('按源查步骤报「源未绑定有效流程」时照常打开画布（空步骤），不报源加载失败', async () => {
    const source = { sourceId: '430024673', siteId: '125', name: '国家统计局', configId: '1401126', state: 'C' } as Source
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue({ enabled: false, curVer: null, nextVer: null, publishId: null, draftId: null, versions: [] })
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(source)
    vi.spyOn(sourceApi, 'sourceSteps').mockRejectedValue(new Error('请求异常 [item/next/nextConfigPaged]: 错误信息:运行时异常：源未绑定有效流程，sourceId=430024673'))
    vi.spyOn(sourceApi, 'stepConfigDetails').mockResolvedValue([])
    vi.spyOn(sourceApi, 'sourceJobs').mockResolvedValue([])
    vi.spyOn(workflowBindingApi, 'list').mockResolvedValue([])
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
    await router.push({ path: '/canvas', query: { sourceId: source.sourceId, siteId: '125', view: 'flow' } })
    await router.isReady()
    const pinia = createPinia(); setActivePinia(pinia)
    const wrapper = mount(FlowCanvas, { global: {
      plugins: [pinia, router], directives: { loading: {} },
      stubs: { FlowBoard: true, ResultView: true, NodeInspector: true, SiteSourceSwitcher: true, SourceTabsBar: true, SourceSummaryView: true, TaskView: true, FileView: true, SiteDetailView: true, CompareSplit: true, LoginConfigSelectDialog: true, NewSiteWizard: true },
    } })
    try {
      await flushPromises()
      expect(useFlowStore().sourceCtx?.sourceId).toBe('430024673')
      expect(wrapper.text()).not.toContain('源加载失败')
    } finally { wrapper.unmount() }
  })

  it('绑了只有草稿 v1 的新流程：按源查的报错不挡画布，概览视图也读草稿步骤', async () => {
    const source = { sourceId: '430024673', siteId: '125', name: '国家统计局', configId: '1401126', flowId: '21000014', state: 'C' } as Source
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue({
      enabled: true, curVer: null, nextVer: 1, publishId: null, draftId: '1056',
      versions: [{ versionId: '1056', flowVer: 1, ver: 1, state: 'W', isLock: 0, isDelete: 0, baseId: null }],
    })
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(source)
    vi.spyOn(sourceApi, 'sourceSteps').mockRejectedValue(new Error('错误信息:运行时异常：请先进入流程草稿编辑并重新加载版本信息'))
    vi.spyOn(sourceApi, 'stepConfigDetails').mockResolvedValue([])
    vi.spyOn(sourceApi, 'sourceJobs').mockResolvedValue([])
    vi.spyOn(workflowBindingApi, 'list').mockResolvedValue([])
    const steps = vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([])
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
    await router.push({ path: '/canvas', query: { sourceId: source.sourceId, siteId: '125', view: 'overview' } })
    await router.isReady()
    const pinia = createPinia(); setActivePinia(pinia)
    const wrapper = mount(FlowCanvas, { global: {
      plugins: [pinia, router], directives: { loading: {} },
      stubs: { FlowBoard: true, ResultView: true, NodeInspector: true, SiteSourceSwitcher: true, SourceTabsBar: true, SourceSummaryView: true, TaskView: true, FileView: true, SiteDetailView: true, CompareSplit: true, LoginConfigSelectDialog: true, NewSiteWizard: true },
    } })
    try {
      await flushPromises()
      expect(steps).toHaveBeenLastCalledWith('21000014', { withConfigDetails: false, backendScope: 'flow', versionId: '1056' })
      expect(useFlowStore().sourceCtx?.sourceId).toBe('430024673')
      expect(wrapper.text()).not.toContain('加载失败')
    } finally { wrapper.unmount() }
  })
})

