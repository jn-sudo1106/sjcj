// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { sourceApi, workflowBindingApi, type Source, type Step } from '@/api'
import { useSourceSearchStore } from '@/stores/sourceSearch'
import { useWorkspaceStore } from '@/stores/workspace'
import { useFlowStore } from '@/stores/flow'
import { useNodeStore } from '@/stores/node'
import { blankSourceListViewState } from './result/sourceListViewState'
import { resetFlowAutosaveForTests } from './canvas/useFlowAutosave'
import { resetNodeConfigAutosave } from './inspector/nodeConfigAutosave'
import FlowCanvas from './index.vue'

const rows = [1, 2, 3].map(n => ({ sourceId: String(n), siteId: String(n*10), siteName: `网站${n}`, name: `源${n}`, configId: String(n), mainTable: '', url: '', owner: '', state: 'C' } as Source))
const steps = [{ stepId: '501', configId: '100', sourceId: '1', name: '列表采集', nodeType: 'entry', configType: '90', inputTable: '', outputTable: '', dependsOn: ['0'], enabled: true }] as Step[]
beforeEach(() => {
  sessionStorage.clear(); setActivePinia(createPinia()); resetFlowAutosaveForTests(); resetNodeConfigAutosave()
  vi.spyOn(sourceApi, 'sourceDetail').mockImplementation(async id => ({ ...rows.find(s => s.sourceId === id)!, siteId: undefined }))
  vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: rows.length, list: rows })
  vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(steps)
  vi.spyOn(sourceApi, 'stepConfigDetails').mockResolvedValue([])
  vi.spyOn(sourceApi, 'sourceJobs').mockResolvedValue([])
  vi.spyOn(workflowBindingApi, 'list').mockResolvedValue([])
})
afterEach(() => { resetFlowAutosaveForTests(); resetNodeConfigAutosave(); vi.restoreAllMocks() })
async function setup() {
  const store = useSourceSearchStore()
  const id = store.create({ query: { name: '公告' }, empty: false, viewState: blankSourceListViewState(), page: 2, scrollTop: 200, scrollLeft: 0, total: 3, label: '我的分组', returnTo: '/collect?tab=personal&group=88' })
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/canvas', component: FlowCanvas }, { path: '/collect', component: { template: '<div>原搜索列表</div>' } },
  ] })
  await router.push({ path: '/canvas', query: { sourceId: '1', siteId: '10', view: 'overview', sourceSearch: id } })
  const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [router], directives: { loading: {} }, stubs: {
    FlowBoard: true, ResultView: true, NodeInspector: true, SiteSourceSwitcher: true,
    SourceSummaryView: true, SourceWorkflowList: true, TaskView: true, FileView: true,
    MonitorConfigView: true, SiteDetailView: true, CompareSplit: true,
    LoginConfigSelectDialog: true, NewSiteWizard: true,
  } } })
  await flushPromises()
  return { wrapper, router, id, workspace: useWorkspaceStore(), flow: useFlowStore() }
}
describe('真实源搜索工作区接线', () => {
  it('不同查询打开的页签各自保留范围，切回时重新查询自己的条件', async () => {
    const { wrapper, router, id } = await setup()
    const store = useSourceSearchStore()
    const other = store.create({ ...store.get(id)!, query: { name: '另一批源', sourceGroupId: '99' }, returnTo: '/collect?tab=personal&group=99' })
    await router.replace({ path: '/canvas', query: { sourceId: '2', siteId: '20', view: 'overview', sourceSearch: other } }); await flushPromises()
    expect(sourceApi.sourcePaged).toHaveBeenLastCalledWith(expect.objectContaining({ name: '另一批源', sourceGroupId: '99' }))
    await wrapper.get('[title="源1 · 1"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.sourceSearch).toBe(id)
    expect(sourceApi.sourcePaged).toHaveBeenLastCalledWith(expect.objectContaining({ name: '公告' }))
    wrapper.unmount()
  })
  it('跨站新增多个源页签，切回分别恢复工作视图与搜索上下文，不额外创建网站全部页签', async () => {
    const { wrapper, router, workspace, id } = await setup()
    await wrapper.findAll('.search-item')[1]!.trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ sourceId: '2', siteId: '20', sourceSearch: id })
    expect(workspace.tabs).toHaveLength(2)
    expect(workspace.siteTabs).toHaveLength(0)
    await router.replace({ query: { ...router.currentRoute.value.query, view: 'data' } }); await flushPromises()
    await wrapper.findAll('.search-item')[0]!.trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.view).toBe('overview')
    await wrapper.get('[title="源2 · 2"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ sourceId: '2', view: 'data', siteId: '20', sourceSearch: id })
    expect(workspace.snapshotOf('2')?.searchContextId).toBe(id)
    await wrapper.get('[aria-label="返回搜索列表"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ tab: 'personal', group: '88', sourceSearchReturn: id })
    wrapper.unmount()
  })
  it('取消未保存确认时源、页签和搜索范围都保持，侧栏和顶部页签使用同一保护', async () => {
    const { wrapper, router, workspace, flow, id } = await setup()
    workspace.open('2', '源2'); workspace.saveSnapshot('2', { siteId: '20', searchContextId: id })
    workspace.activate('1')
    await flushPromises()
    useNodeStore().touchConfig('501')
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    await wrapper.get('[title="源2 · 2"]').trigger('click'); await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    expect(router.currentRoute.value.query.sourceId).toBe('1')
    expect(workspace.activeSourceId).toBe('1')
    expect(flow.sourceCtx?.sourceId).toBe('1')
    await wrapper.findAll('.search-item')[1]!.trigger('click'); await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(router.currentRoute.value.query.sourceId).toBe('1')
    flow.dirty = false; wrapper.unmount()
  })
  it('页签满额时从搜索侧栏切源，自动关掉最右侧那个页签，不弹「请先关闭一个」', async () => {
    const { wrapper, router, workspace, id } = await setup()
    for (let i = 0; i < 7; i++) workspace.open(`other-${i}`, `其他源${i}`)
    expect(workspace.tabs).toHaveLength(8)
    const rightmost = workspace.orderedTabs[workspace.orderedTabs.length - 1]!
    await wrapper.findAll('.search-item')[1]!.trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ sourceId: '2', sourceSearch: id })
    expect(workspace.tabs.map(tab => tab.sourceId)).toContain('2')
    expect(workspace.tabs).toHaveLength(8)
    expect(workspace.tabs.map(tab => tab.sourceId)).not.toContain(rightmost.id)
    wrapper.unmount()
  })
  it('快速切换时迟到的源详情不覆盖最后选择，也不创建错误页签', async () => {
    const { wrapper, router, workspace, flow } = await setup()
    let complete!: (source: Source) => void
    vi.mocked(sourceApi.sourceDetail).mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    await wrapper.findAll('.search-item')[1]!.trigger('click'); await flushPromises()
    await wrapper.findAll('.search-item')[2]!.trigger('click'); await flushPromises()
    complete(rows[1]!); await flushPromises()
    expect(router.currentRoute.value.query.sourceId).toBe('3')
    expect(flow.sourceCtx?.sourceId).toBe('3')
    expect(workspace.tabs.map(tab => tab.sourceId)).toEqual(['3', '1'])
    wrapper.unmount()
  })
})
