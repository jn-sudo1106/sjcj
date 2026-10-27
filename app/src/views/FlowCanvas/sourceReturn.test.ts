// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import FlowCanvas from './index.vue'
import AppModuleHead from '@/layouts/AppModuleHead.vue'
import { flowCenterApi, flowVersionApi, sourceApi, workflowBindingApi, type Source, type Step, type WorkflowBinding } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useFlowStore } from '@/stores/flow'
import { useNodeStore } from '@/stores/node'
import { useSourceReturnStore } from '@/stores/sourceReturn'
import { useWorkspaceStore } from '@/stores/workspace'
import { resetFlowAutosaveForTests } from './canvas/useFlowAutosave'
import { registerNodeConfigFlusher, resetNodeConfigAutosave } from './inspector/nodeConfigAutosave'

const source = { sourceId: '391002508', siteId: '8', name: '贝壳详情采集', configId: '100', flowId: '201', state: 'C' } as Source
const steps = ['501', '502'].map((stepId, index) => ({ stepId, sourceId: source.sourceId, name: `采集 ${index+1}`, configId: String(100+index), inputTable: '900', outputTable: '900', nodeType: 'entry', configType: '90', dependsOn: [index ? '501' : '0'], enabled: true } as Step))
const Root = defineComponent({ components: { AppModuleHead }, template: '<AppModuleHead /><router-view />' })

async function openSource(view = 'flow') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.token = 'test-session'
  auth.info = { id: 1, name: 'admin', roles: ['admin'], groups: [], avatar: '', introduction: '', group: 1 }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/canvas', component: FlowCanvas },
    { path: '/settings', component: { template: '<div>系统设置</div>' } },
  ] })
  await router.push({ path: '/canvas', query: { sourceId: source.sourceId, siteId: '8', view, workflowId: '300', flowId: '301' } })
  await router.isReady()
  const wrapper = mount(Root, { global: {
    plugins: [pinia, router, ElementPlus], directives: { loading: {} },
    stubs: { FlowBoard: true, ResultView: true, NodeInspector: true, SiteSourceSwitcher: true, SourceTabsBar: true, SourceSummaryView: true, SourceWorkflowList: true, TaskView: true, FileView: true, SiteDetailView: true, CompareSplit: true, LoginConfigSelectDialog: true, NewSiteWizard: true },
  } })
  await flushPromises()
  return { router, wrapper, flow: useFlowStore(), point: useSourceReturnStore() }
}

describe('源 → 设置 → 返回源', () => {
  beforeEach(() => {
    sessionStorage.clear()
    resetFlowAutosaveForTests()
    resetNodeConfigAutosave()
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(source)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([])
    vi.spyOn(sourceApi, 'stepConfigDetails').mockResolvedValue([])
    vi.spyOn(sourceApi, 'sourceJobs').mockResolvedValue([])
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue({ enabled: false, curVer: null, nextVer: null, publishId: null, draftId: null, versions: [] })
    vi.spyOn(workflowBindingApi, 'list').mockResolvedValue([
      { workflowId: '200', publishedFlowId: '201', primary: true, versionManaged: false } as WorkflowBinding,
      { workflowId: '300', draftFlowId: '301', publishedFlowId: '302', primary: false, versionManaged: false } as WorkflowBinding,
    ])
    vi.spyOn(flowCenterApi, 'steps').mockResolvedValue(steps)
  })
  afterEach(() => { resetFlowAutosaveForTests(); resetNodeConfigAutosave(); vi.restoreAllMocks() })

  it('从源切来源组先处理未保存确认；取消保留当前源，确认后切到本站组范围', async () => {
    const { router, wrapper, flow } = await openSource()
    try {
      const sidebar = wrapper.findComponent({ name: 'SiteSourceSwitcher' })
      useNodeStore().touchConfig('502')
      vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
      sidebar.vm.$emit('pick-group', '3')
      await flushPromises()
      expect(router.currentRoute.value.query.sourceId).toBe(source.sourceId)
      expect(router.currentRoute.value.query.sourceGroupId).toBeUndefined()
      flow.dirty = false
      sidebar.vm.$emit('pick-group', '3')
      await flushPromises()
      expect(router.currentRoute.value.query).toEqual({ siteId: '8', view: 'source', sourceGroupId: '3' })
      sidebar.vm.$emit('pick-group', '')
      await flushPromises()
      expect(router.currentRoute.value.query).toEqual({ siteId: '8', view: 'source' })
    } finally { wrapper.unmount() }
  })

  it('跨模块后仍返回非默认流程及原节点 / 配置页签，慢请求不丢定位', async () => {
    const { router, wrapper, flow, point } = await openSource()
    try {
      expect(flow.sourceCtx?.flowId).toBe('301')
      flow.select('502')
      flow.setActiveTab('table')
      await flushPromises()
      await router.push('/settings')
      await flushPromises()
      expect(flow.sourceCtx).toBeNull()
      expect(point.point?.query).toMatchObject({ flowId: '301', workflowId: '300', nodeId: '502', tab: 'table' })
      let resolve!: (value: Source) => void
      vi.mocked(sourceApi.sourceDetail).mockResolvedValueOnce(source).mockImplementationOnce(() => new Promise(done => { resolve = done }))
      await wrapper.get('[data-testid="return-to-source"]').trigger('click')
      await flushPromises()
      const now = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(now + 5000)
      resolve(source)
      await flushPromises()
      expect(router.currentRoute.value.path).toBe('/canvas')
      expect(flow.sourceCtx?.flowId).toBe('301')
      expect(flow.selectedId).toBe('502')
      expect(flow.activeTab).toBe('table')
      flow.select('501')
      await flushPromises()
      expect(flow.selectedId).toBe('501') // 恢复完成后不能把用户拉回旧节点
    } finally { wrapper.unmount() }
  })

  it('数据视图沿用已有筛选 / 页码快照，不用节点深链覆盖它', async () => {
    const { router, wrapper, point } = await openSource('data')
    try {
      const ws = useWorkspaceStore()
      await router.replace({ path: '/canvas', query: { ...router.currentRoute.value.query, tableId: '800' } })
      const snapshot = { selectedNodeId: '502', dataTableId: '900', page: 3, filters: { dataId: '123', parentId: '', state: 'C', sql: 'K1=2' } }
      ws.saveSnapshot(source.sourceId, snapshot)
      await router.push('/settings')
      await flushPromises()
      expect(point.point?.query.view).toBe('data')
      expect(point.point?.query.nodeId).toBeUndefined()
      await wrapper.get('[data-testid="return-to-source"]').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.query.view).toBe('data')
      expect(router.currentRoute.value.query.tableId).toBe('900')
      expect(ws.snapshotOf(source.sourceId)).toMatchObject(snapshot)
    } finally { wrapper.unmount() }
  })

  it('离开时等待配置保存，保存失败保留当前页面与修改', async () => {
    const { router, wrapper, flow } = await openSource()
    let unregister = () => {}
    try {
      useNodeStore().touchConfig('502')
      unregister = registerNodeConfigFlusher(async () => { throw new Error('保存失败') })
      await router.push('/settings')
      expect(router.currentRoute.value.path).toBe('/canvas')
      expect(flow.configDirty).toBe(true)
      expect(flow.sourceCtx?.sourceId).toBe(source.sourceId)
      unregister()
      const save = vi.fn(async () => {
        expect(flow.sourceCtx?.sourceId).toBe(source.sourceId)
        flow.dirty = false
      })
      unregister = registerNodeConfigFlusher(save)
      await router.push('/settings')
      await flushPromises()
      expect(save).toHaveBeenCalledOnce()
      expect(router.currentRoute.value.path).toBe('/settings')
    } finally { unregister(); wrapper.unmount() }
  })
})
