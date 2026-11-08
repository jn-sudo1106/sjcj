// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, onMounted } from 'vue'
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
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
  it('未关联流程时即使源有旧配置也不显示节点和配置面板', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const source = { sourceId: '430024673', siteId: '125', name: '测试源', url: 'https://example.com', mainTable: '900', configId: '1401126', state: 'C' } as Source
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(source)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([])
    vi.spyOn(sourceApi, 'stepConfigDetails').mockResolvedValue([])
    vi.spyOn(sourceApi, 'sourceJobs').mockResolvedValue([])
    vi.spyOn(workflowBindingApi, 'list').mockResolvedValue([])
    vi.spyOn(workflowBindingApi, 'load').mockResolvedValue({ rows: [], sourceGroupId: null })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
    await router.push({ path: '/canvas', query: { sourceId: source.sourceId, siteId: '125', view: 'flow' } })
    await router.isReady()
    const pinia = createPinia(); setActivePinia(pinia)
    const wrapper = mount(FlowCanvas, { global: {
      plugins: [pinia, router], directives: { loading: {} },
      stubs: { NodeInspector: { template: '<div data-testid="inspector-stub" />' }, CanvasHeader: true, ResultView: true, SiteSourceSwitcher: true, SourceTabsBar: true, SourceSummaryView: true, TaskView: true, FileView: true, SiteDetailView: true, CompareSplit: true, LoginConfigSelectDialog: true, NewSiteWizard: true },
    } })
    try {
      await flushPromises()
      expect(useFlowStore().layout.nodes.length).toBeGreaterThan(0)
      expect(wrapper.get('[data-testid="workflow-canvas-status"]').text()).toContain('暂无关联流程')
      expect(wrapper.find('.rc-flow-node').exists()).toBe(false)
      expect(wrapper.find('[data-testid="inspector-stub"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="workflow-add"]').exists()).toBe(true)
    } finally { wrapper.unmount() }
  })

  it('同源绑定后切换流程地址，保留已就绪状态并继续显示右侧配置区', async () => {
    const source = { sourceId: '100', name: '测试源', flowId: '11', state: 'C' } as Source
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(source)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([])
    vi.spyOn(sourceApi, 'stepConfigDetails').mockResolvedValue([])
    vi.spyOn(sourceApi, 'sourceJobs').mockResolvedValue([])
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue({ enabled: false, curVer: null, nextVer: null, publishId: null, draftId: null, versions: [] })
    const list = vi.spyOn(workflowBindingApi, 'list').mockResolvedValue([{ workflowId: '11', primary: true }] as WorkflowBinding[])
    vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([])
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
    await router.push({ path: '/canvas', query: { sourceId: '100', view: 'flow', flowId: '11' } })
    const pinia = createPinia(); setActivePinia(pinia)
    const readyBoard = defineComponent({
      emits: ['workflow-status'],
      setup(_, { emit }) { onMounted(() => emit('workflow-status', 'ready')); return () => h('div') },
    })
    const wrapper = mount(FlowCanvas, { global: {
      plugins: [pinia, router], directives: { loading: {} },
      stubs: { FlowBoard: readyBoard, NodeInspector: { template: '<div data-testid="inspector-stub" />' }, ResultView: true, SiteSourceSwitcher: true, SourceTabsBar: true, SourceSummaryView: true, TaskView: true, FileView: true, SiteDetailView: true, CompareSplit: true, LoginConfigSelectDialog: true, NewSiteWizard: true },
    } })
    try {
      await flushPromises()
      expect(wrapper.find('[data-testid="inspector-stub"]').exists()).toBe(true)
      const board = wrapper.getComponent(readyBoard).vm
      list.mockResolvedValue([{ workflowId: '12', primary: true }] as WorkflowBinding[])
      await router.replace({ query: { ...router.currentRoute.value.query, workflowId: '12', flowId: '12' } })
      await flushPromises()
      expect(useFlowStore().sourceCtx?.flowId).toBe('12')
      expect(wrapper.getComponent(readyBoard).vm).toBe(board)
      expect(wrapper.find('[data-testid="inspector-stub"]').exists()).toBe(true)
      expect(wrapper.find('.no-workflow').exists()).toBe(false)
    } finally { wrapper.unmount() }
  })

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

describe('源详情页加载提速（1107）', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
  it('流程绑定与源详情并行发；源已绑流程时不再读源视角步骤', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const source = { sourceId: '430024680', siteId: '125', name: '测试源', configId: '1', flowId: '200', state: 'C' } as Source
    let releaseDetail!: (value: Source) => void
    vi.spyOn(sourceApi, 'sourceDetail').mockImplementation(() => new Promise((resolve) => { releaseDetail = resolve }))
    const sourceSteps = vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([])
    vi.spyOn(sourceApi, 'stepConfigDetails').mockResolvedValue([])
    vi.spyOn(sourceApi, 'sourceJobs').mockResolvedValue([])
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue({ enabled: false, curVer: null, nextVer: null, publishId: null, draftId: null, versions: [] })
    const bindings = vi.spyOn(workflowBindingApi, 'list').mockResolvedValue([{ workflowId: '200', publishedFlowId: '200', primary: true } as WorkflowBinding])
    vi.spyOn(workflowBindingApi, 'load').mockResolvedValue({ rows: [], sourceGroupId: null })
    const steps = vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([])
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
    await router.push({ path: '/canvas', query: { sourceId: source.sourceId, siteId: '125', view: 'flow' } })
    await router.isReady()
    const pinia = createPinia(); setActivePinia(pinia)
    const wrapper = mount(FlowCanvas, { global: {
      plugins: [pinia, router], directives: { loading: {} },
      stubs: { FlowBoard: true, ResultView: true, NodeInspector: true, SiteSourceSwitcher: true, SourceTabsBar: true, SourceSummaryView: true, TaskView: true, FileView: true, SiteDetailView: true, CompareSplit: true, LoginConfigSelectDialog: true, NewSiteWizard: true, SourceWorkflowTabs: true, SourceWorkflowList: true, CanvasHeader: true },
    } })
    try {
      await flushPromises()
      // 源详情还没回来，绑定已经在读了
      expect(bindings).toHaveBeenCalledWith(source.sourceId, { withNames: false })
      expect(steps).not.toHaveBeenCalled()
      releaseDetail(source)
      await flushPromises()
      expect(steps).toHaveBeenCalledWith('200', expect.objectContaining({ withConfigDetails: false }))
      expect(sourceSteps).not.toHaveBeenCalled()
      expect(useFlowStore().sourceCtx?.flowId).toBe('200')
    } finally { wrapper.unmount() }
  })
})

