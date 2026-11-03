// @vitest-environment jsdom
// 源管理「来源组」目录页签（1008-03，10-09 改定方案：复用「我的分组」界面，不新增独立工作区）。
// 左侧组列表（可搜索，可见组限流加载成员数）+ 右侧成员源列表
// （SourceOverviewView + scopeSourceGroupId）；「流程配置」「组资料」右侧抽屉；新建来源组小弹窗。
// 写操作仅 admin；非 admin 全部写按钮禁用。写操作后重拉 list 刷新 revision（旧平台 act() 口径）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import SourceGroupTab from './SourceGroupTab.vue'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { sourceGroupApi, flowCenterApi, sourceApi, type SourceGroup, type SourceFlowBind, type FlowRecord } from '@/api'
import * as sourceDirs from '@/api/sourceDirs'

// stub SourceOverviewView：选中范围由外部注入，selection-actions 槽位渲染可控 ids，
// 成员测试才能驱动「移出来源组 / 换到其他组」。
const selectIds = vi.hoisted(() => ({ value: [] as string[] }))
// 成员表「业务目录」列：stub 给出列头，并用固定的假源渲染 extra-cell 槽位
const EXTRA_SOURCE = { sourceId: 's1' } as never
vi.mock('@/views/FlowCanvas/result/SourceOverviewView.vue', () => ({
  default: {
    name: 'SourceOverviewView',
    props: { currentSiteId: String, scopeSourceGroupId: String, scopeEmptyText: String, extraColumnLabel: String },
    emits: ['open-source', 'open-source-data', 'open-site'],
    template: '<div class="sov-stub" data-testid="sov-stub"><span data-testid="sov-extra-head">{{ extraColumnLabel }}</span><slot name="filter-extra" /><slot name="selection-actions" :ids="ids()" /><div class="sov-extra" data-testid="sov-extra-cell"><slot name="extra-cell" :source="extraSource" /></div></div>',
    setup: () => ({ ids: () => selectIds.value, extraSource: EXTRA_SOURCE }),
  },
}))

// stub 业务目录树：真组件挂载就去拉目录，这里只验证选目录后的组筛选
vi.mock('@/views/CollectAssets/BizDirTreePanel.vue', () => ({
  default: {
    name: 'BizDirTreePanel',
    props: { selected: Array },
    emits: ['close', 'select'],
    template: '<div class="biz-dir-stub" />',
  },
}))
vi.mock('./SourceGroupFlowDiffDrawer.vue', () => ({
  default: { name: 'SourceGroupFlowDiffDrawer', props: ['group', 'defaultFlowLabel'], template: '<div />' },
}))

const GROUP_3: SourceGroup = {
  sourceGroupId: '3',
  sourceGroupCode: 'twitter1',
  sourceGroupName: 'twitter1',
  state: 'ACTIVE',
  flowIds: ['21000005', '21000006'],
  defaultFlowId: '21000006',
  revision: 2,
}
const GROUP_1: SourceGroup = {
  sourceGroupId: '1',
  sourceGroupCode: 'test1',
  sourceGroupName: '测试组1',
  state: 'ACTIVE',
  flowIds: [],
  defaultFlowId: undefined,
  revision: 1,
}
const BINDINGS_3: SourceFlowBind[] = [
  { id: '31', sourceGroupId: '3', flowId: '21000005', isDefault: false, state: 'ACTIVE', revision: 2 },
  { id: '32', sourceGroupId: '3', flowId: '21000006', isDefault: true, state: 'ACTIVE', revision: 2 },
]
const FLOW_21000006 = { id: '21000006', name: 'twitter主流程', state: 'A', definition: { main: [], branches: [], configs: {}, branchGroups: [] }, updatedAt: '' } as unknown as FlowRecord

const mountedTabs: VueWrapper[] = []
let visibilityCallback: IntersectionObserverCallback
const observed = new Set<Element>()
function showGroups(wrapper: VueWrapper, ids: string[], isIntersecting = true) {
  visibilityCallback(ids.map((id) => ({
    target: wrapper.get(`[data-group-id="${id}"]`).element,
    isIntersecting,
  } as IntersectionObserverEntry)), {} as IntersectionObserver)
}

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().roles = ['admin']
  selectIds.value = []
  observed.clear()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { visibilityCallback = callback }
    observe(el: Element) { observed.add(el) }
    unobserve(el: Element) { observed.delete(el) }
    disconnect() { observed.clear() }
  })
})
afterEach(() => {
  mountedTabs.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

/** el-input / el-select / el-drawer 等 Element Plus 组件渲染到可交互态需要宏任务 */
async function settle() {
  await flushPromises()
  await new Promise((r) => setTimeout(r, 60))
}

async function mountTab(overrides?: {
  groups?: SourceGroup[]
  bindings?: SourceFlowBind[]
  counts?: Record<string, number>
  /** 自定义 list 实现（如 mockResolvedValueOnce 分次返回） */
  list?: () => Promise<SourceGroup[]>
}) {
  if (overrides?.list) vi.spyOn(sourceGroupApi, 'list').mockImplementation(overrides.list)
  else vi.spyOn(sourceGroupApi, 'list').mockResolvedValue(overrides?.groups ?? [GROUP_3, GROUP_1])
  vi.spyOn(sourceGroupApi, 'bindings').mockResolvedValue(overrides?.bindings ?? BINDINGS_3)
  vi.spyOn(sourceGroupApi, 'detail').mockImplementation(async (id) => (overrides?.groups ?? [GROUP_3, GROUP_1]).find((group) => group.sourceGroupId === id) ?? null)
  vi.spyOn(sourceGroupApi, 'members').mockResolvedValue({ rows: [], hasMore: false })
  vi.spyOn(sourceApi, 'sourcePaged').mockImplementation(async (q) => ({
    total: q?.sourceGroupId === '3' ? 255 : 22,
    list: [],
  }))
  vi.spyOn(flowCenterApi, 'list').mockResolvedValue([FLOW_21000006])
  // 成员表「业务目录」列默认拿到空映射（各用例按需覆盖）；不 mock 会真去扫整棵业务目录树
  if (!vi.isMockFunction(sourceDirs.bizMembership)) vi.spyOn(sourceDirs, 'bizMembership').mockResolvedValue(new Map())
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
  const wrapper = mount(SourceGroupTab, { global: { plugins: [ElementPlus, router] }, attachTo: document.body })
  mountedTabs.push(wrapper)
  await settle()
  return { wrapper, router }
}

const dom = (sel: string) => document.querySelector(sel) as HTMLElement | null
async function openGroupAction(wrapper: VueWrapper, action: string, groupId = '3') {
  await wrapper.get(`[data-group-id="${groupId}"]`).trigger('contextmenu', { clientX: 100, clientY: 150 })
  await settle()
  ;(dom(`[data-testid="${action}"]`) as HTMLButtonElement).click()
  await settle()
}

describe('来源组页签 · 列表与选中', () => {
  it('只对进入视口的组查成员数，点选后右侧加载', async () => {
    const { wrapper } = await mountTab()
    const items = wrapper.findAll('.sg-item')
    expect(items.length).toBe(2)
    expect(items.map((i) => i.text())).toEqual(['twitter1', '测试组1'])
    expect(wrapper.findAll('.sg-count.loading').length).toBe(2)
    expect(sourceApi.sourcePaged).not.toHaveBeenCalled()
    expect(observed.size).toBe(2)
    showGroups(wrapper, ['3', '1'])
    await flushPromises()
    expect(items.map((i) => i.text())).toEqual(['twitter1255', '测试组122'])
    await items[0]!.get('.sg-item-select').trigger('click')
    await settle()
    expect(wrapper.find('.sg-toolbar').text()).toContain('twitter1')
    expect(sourceGroupApi.bindings).toHaveBeenCalledWith({ sourceGroupId: '3' })
  })

  it('上千组仍最多并发 3 个计数请求，跳过滚出视口的排队组并复用缓存', async () => {
    const groups = Array.from({ length: 1000 }, (_, i) => ({ ...GROUP_1, sourceGroupId: String(i + 1) }))
    const { wrapper } = await mountTab({ groups })
    const resolveCounts = new Map<string, () => void>()
    vi.mocked(sourceApi.sourcePaged).mockImplementation((query) => new Promise((resolve) => {
      const id = String(query!.sourceGroupId)
      resolveCounts.set(id, () => resolve({ total: Number(id), list: [] }))
    }))
    expect(sourceApi.sourcePaged).not.toHaveBeenCalled()
    showGroups(wrapper, ['1', '2', '3', '4', '5', '6'])
    expect(sourceApi.sourcePaged).toHaveBeenCalledTimes(3)
    expect(sourceApi.sourcePaged).toHaveBeenCalledWith({ page: 1, size: 1, sourceGroupId: '1' })
    showGroups(wrapper, ['4', '5'], false)
    resolveCounts.get('1')!()
    await flushPromises()
    expect(sourceApi.sourcePaged).toHaveBeenCalledTimes(4)
    expect(sourceApi.sourcePaged).toHaveBeenLastCalledWith({ page: 1, size: 1, sourceGroupId: '6' })
    showGroups(wrapper, ['1'], false)
    showGroups(wrapper, ['1'])
    await flushPromises()
    expect(sourceApi.sourcePaged).toHaveBeenCalledTimes(4)
    wrapper.unmount()
    resolveCounts.forEach((resolve) => resolve())
    await flushPromises()
    expect(sourceApi.sourcePaged).toHaveBeenCalledTimes(4)
    expect(observed.size).toBe(0)
  })

  it('加载失败显示未知，真实零成员显示 0', async () => {
    const { wrapper } = await mountTab()
    vi.mocked(sourceApi.sourcePaged).mockResolvedValueOnce({ total: 0, list: [] }).mockRejectedValueOnce(new Error('请求失败'))
    showGroups(wrapper, ['3', '1'])
    await flushPromises()
    expect(wrapper.get('[data-group-id="3"] .sg-count').text()).toBe('0')
    const failed = wrapper.get('[data-group-id="1"] .sg-count')
    expect(failed.text()).toBe('!')
    expect(failed.classes()).toContain('failed')
    expect(failed.attributes('title')).toContain('加载失败')
  })

  it('成员变更使缓存失效，变更前的在途计数不覆盖新数量', async () => {
    const { wrapper } = await mountTab()
    let resolveOld!: (page: { total: number; list: [] }) => void
    vi.mocked(sourceApi.sourcePaged).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    showGroups(wrapper, ['3'])
    useUiStore().notifySourceListChanged()
    await flushPromises()
    vi.mocked(sourceApi.sourcePaged).mockResolvedValue({ total: 254, list: [] })
    resolveOld({ total: 255, list: [] })
    await flushPromises()
    expect(sourceApi.sourcePaged).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-group-id="3"] .sg-count').text()).toBe('254')
    useUiStore().notifySourceListChanged()
    await flushPromises()
    expect(sourceApi.sourcePaged).toHaveBeenCalledTimes(3)
  })

  it('数量排序统计未进视口的组，零成员正常排序，失败置后且可重试', async () => {
    const groups = [GROUP_3, GROUP_1, { ...GROUP_1, sourceGroupId: '4', sourceGroupName: '空组' }, { ...GROUP_1, sourceGroupId: '5', sourceGroupName: '失败组' }]
    const { wrapper } = await mountTab({ groups })
    vi.mocked(sourceApi.sourcePaged).mockImplementation(async (query) => {
      const id = String(query!.sourceGroupId)
      if (id === '5') throw new Error('计数失败')
      return { total: ({ '1': 2, '3': 20, '4': 0 } as Record<string, number>)[id]!, list: [] }
    })
    const ids = () => wrapper.findAll('.sg-item').map((item) => item.attributes('data-group-id'))
    expect(sourceApi.sourcePaged).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="sg-count-sort"]').trigger('click')
    await flushPromises()
    expect(ids()).toEqual(['4', '1', '3', '5'])
    expect(sourceApi.sourcePaged).toHaveBeenCalledTimes(4)
    expect(wrapper.get('[data-testid="sg-count-retry"]').attributes('title')).toContain('1 组计数失败')
    await wrapper.get('[data-testid="sg-count-sort"]').trigger('click')
    expect(ids()).toEqual(['3', '1', '4', '5'])
    expect(sourceApi.sourcePaged).toHaveBeenCalledTimes(4)
    vi.mocked(sourceApi.sourcePaged).mockResolvedValue({ total: 1, list: [] })
    await wrapper.get('[data-testid="sg-count-retry"]').trigger('click')
    await flushPromises()
    expect(sourceApi.sourcePaged).toHaveBeenCalledTimes(5)
    expect(sourceApi.sourcePaged).toHaveBeenLastCalledWith({ page: 1, size: 1, sourceGroupId: '5' })
    expect(ids()).toEqual(['3', '1', '5', '4'])
    expect(wrapper.find('[data-testid="sg-count-retry"]').exists()).toBe(false)
    await wrapper.get('[data-testid="sg-count-sort"]').trigger('click')
    expect(ids()).toEqual(['3', '1', '4', '5'])
  })

  it('排序计数最多并发 3 个，未齐时保留原序，取消后停止排队并复用已取得计数', async () => {
    const groups = Array.from({ length: 7 }, (_, i) => ({ ...GROUP_1, sourceGroupId: String(i + 1), sourceGroupName: `组${i + 1}` }))
    const { wrapper } = await mountTab({ groups })
    const pending = new Map<string, () => void>()
    vi.mocked(sourceApi.sourcePaged).mockImplementation((query) => new Promise((resolve) => {
      const id = String(query!.sourceGroupId)
      pending.set(id, () => resolve({ total: Number(id), list: [] }))
    }))
    const ids = () => wrapper.findAll('.sg-item').map((item) => item.attributes('data-group-id'))
    await wrapper.get('[data-testid="sg-count-sort"]').trigger('click')
    await wrapper.get('[data-testid="sg-count-sort"]').trigger('click')
    expect(sourceApi.sourcePaged).toHaveBeenCalledTimes(3)
    expect(wrapper.get('[data-testid="sg-count-sort"]').attributes('title')).toContain('0/7')
    expect(wrapper.get('[data-testid="sg-count-sort"]').attributes('aria-busy')).toBe('true')
    pending.get('3')!()
    await flushPromises()
    expect(sourceApi.sourcePaged).toHaveBeenCalledTimes(4)
    expect(ids()).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    await wrapper.get('[data-testid="sg-count-sort"]').trigger('click')
    for (const id of ['1', '2', '4']) pending.get(id)!()
    await flushPromises()
    expect(sourceApi.sourcePaged).toHaveBeenCalledTimes(4)
    await wrapper.get('[data-testid="sg-count-sort"]').trigger('click')
    await wrapper.get('[data-testid="sg-count-sort"]').trigger('click')
    expect(sourceApi.sourcePaged).toHaveBeenCalledTimes(7)
    for (const id of ['5', '6', '7']) pending.get(id)!()
    await flushPromises()
    expect(ids()).toEqual(['7', '6', '5', '4', '3', '2', '1'])
    expect(wrapper.get('[data-testid="sg-count-sort"]').attributes('aria-busy')).toBe('false')
  })

  it('数量排序遵守业务目录和搜索范围，扩大筛选只补取缺失的组计数', async () => {
    const dirs = await import('@/api/sourceDirs')
    vi.spyOn(dirs, 'bizDirGroupIds').mockResolvedValue(['3', '1', '4'])
    const { wrapper } = await mountTab({ groups: [GROUP_3, GROUP_1, { ...GROUP_3, sourceGroupId: '4', sourceGroupName: 'twitter4' }, { ...GROUP_1, sourceGroupId: '5' }] })
    wrapper.getComponent({ name: 'BizDirTreePanel' }).vm.$emit('select', [{ id: 'a', path: '行业' }])
    await settle()
    await wrapper.get('input[data-testid="sg-search"]').setValue('twitter')
    vi.mocked(sourceApi.sourcePaged).mockImplementation(async (query) => ({ total: Number(query!.sourceGroupId), list: [] }))
    await wrapper.get('[data-testid="sg-count-sort"]').trigger('click')
    await wrapper.get('[data-testid="sg-count-sort"]').trigger('click')
    await flushPromises()
    expect(sourceApi.sourcePaged).toHaveBeenCalledTimes(2)
    expect(wrapper.findAll('.sg-item').map((item) => item.attributes('data-group-id'))).toEqual(['4', '3'])
    await wrapper.get('input[data-testid="sg-search"]').setValue('')
    await flushPromises()
    expect(sourceApi.sourcePaged).toHaveBeenCalledTimes(3)
    expect(sourceApi.sourcePaged).toHaveBeenLastCalledWith({ page: 1, size: 1, sourceGroupId: '1' })
    expect(wrapper.findAll('.sg-item').map((item) => item.attributes('data-group-id'))).toEqual(['4', '3', '1'])
  })

  it('搜索框按组名 / 编码 / ID 过滤左侧列表，无匹配时提示', async () => {
    const { wrapper } = await mountTab()
    const search = wrapper.find('input[data-testid="sg-search"]')
    await search.setValue('测试')
    expect(wrapper.findAll('.sg-item').map((i) => i.text()).join()).toContain('测试组1')
    expect(wrapper.findAll('.sg-item').length).toBe(1)
    await search.setValue('TWITTER1')
    expect(wrapper.findAll('.sg-item').map((i) => i.text()).join()).toContain('twitter1')
    expect(wrapper.findAll('.sg-item').length).toBe(1)
    await search.setValue('3')
    expect(wrapper.findAll('.sg-item').length).toBe(1)
    await search.setValue('不存在')
    expect(wrapper.findAll('.sg-item').length).toBe(0)
    expect(wrapper.find('.sg-empty').text()).toBe('没有匹配的来源组')
  })

  // 1030 会议议题 5：按业务目录筛组（按成员推导，只读）
  it('选业务目录后左侧只留目录里有成员的组，并提示组数；清空恢复全部', async () => {
    const dirs = await import('@/api/sourceDirs')
    const byDir = vi.spyOn(dirs, 'bizDirGroupIds').mockResolvedValue(['3'])
    const { wrapper } = await mountTab()
    const before = wrapper.findAll('.sg-item').length
    expect(before).toBeGreaterThan(1)
    const tree = wrapper.getComponent({ name: 'BizDirTreePanel' })
    const list = wrapper.get('.sg-list')
    // 默认收起，只露出入口；点开后目录树在原地替换组列表
    expect(tree.isVisible()).toBe(false)
    await wrapper.get('[data-testid="sg-biz-dir-open"]').trigger('click')
    expect(tree.isVisible()).toBe(true)
    expect(list.isVisible()).toBe(false)
    tree.vm.$emit('select', [{ id: '9011494', path: '行业 / 能源' }])
    await settle()
    // 多选：勾一个不收起，点「完成」才回到筛选后的组列表
    expect(tree.isVisible()).toBe(true)
    expect(tree.props('selected')).toEqual(['9011494'])
    tree.vm.$emit('close')
    await settle()
    expect(tree.isVisible()).toBe(false)
    expect(list.isVisible()).toBe(true)
    expect(byDir).toHaveBeenCalledWith('9011494', expect.any(Function))
    expect(wrapper.findAll('.sg-item').map((i) => i.text()).join()).toContain('twitter1')
    expect(wrapper.findAll('.sg-item')).toHaveLength(1)
    const hint = wrapper.get('[data-testid="sg-biz-dir-hint"]').text()
    expect(hint).toContain('行业 / 能源')
    expect(hint).toContain('该目录下 1 个组')
    await wrapper.get('[data-testid="sg-biz-dir-clear"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="sg-biz-dir-hint"]').exists()).toBe(false)
    expect(wrapper.findAll('.sg-item')).toHaveLength(before)
  })

  // 10-31 用户：业务目录多选，取并集
  it('勾多个业务目录时取并集：组内有源在任一目录里就显示', async () => {
    const dirs = await import('@/api/sourceDirs')
    const byDir = vi.spyOn(dirs, 'bizDirGroupIds').mockImplementation(async (id) => (id === 'a' ? ['3'] : ['1']))
    const { wrapper } = await mountTab()
    wrapper.getComponent({ name: 'BizDirTreePanel' }).vm.$emit('select', [{ id: 'a', path: '行业' }, { id: 'b', path: '宏观' }])
    await settle()
    expect(byDir).toHaveBeenCalledTimes(2)
    expect(wrapper.findAll('.sg-item').map((i) => i.get('span').text())).toEqual(['twitter1', '测试组1'])
    const hint = wrapper.get('[data-testid="sg-biz-dir-hint"]').text()
    expect(hint).toContain('行业、宏观')
    expect(hint).toContain('所选 2 个目录下 2 个组')
  })

  it('目录组数不受搜索框影响；成员变更后已选目录重新统计', async () => {
    const dirs = await import('@/api/sourceDirs')
    const byDir = vi.spyOn(dirs, 'bizDirGroupIds').mockResolvedValueOnce(['3', '1']).mockResolvedValueOnce(['3'])
    const { wrapper } = await mountTab()
    wrapper.getComponent({ name: 'BizDirTreePanel' }).vm.$emit('select', [{ id: '9011494', path: '行业' }])
    await settle()
    await wrapper.get('input[data-testid="sg-search"]').setValue('twitter')
    expect(wrapper.findAll('.sg-item')).toHaveLength(1)
    expect(wrapper.get('[data-testid="sg-biz-dir-hint"]').text()).toContain('该目录下 2 个组')

    useUiStore().notifySourceListChanged()
    await settle()
    expect(byDir).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-testid="sg-biz-dir-hint"]').text()).toContain('该目录下 1 个组')
  })

  it('停用组灰显并标「停用」', async () => {
    const { wrapper } = await mountTab({
      groups: [{ ...GROUP_3, state: 'DISABLED' }],
      counts: { '3': 255 },
    })
    const item = wrapper.find('.sg-item')
    expect(item.classes()).toContain('disabled')
    expect(item.text()).toContain('停用')
  })

  it('右侧成员源列表用 scopeSourceGroupId 限定（SourceOverviewView 收到该 prop）', async () => {
    const { wrapper } = await mountTab()
    await wrapper.findAll('.sg-item-select')[0]!.trigger('click')
    await settle()
    const sov = wrapper.findComponent({ name: 'SourceOverviewView' })
    expect(sov.exists()).toBe(true)
    expect(sov.props('scopeSourceGroupId')).toBe('3')
  })
})

describe('来源组页签 · 流程配置抽屉', () => {
  it('打开抽屉加载绑定；保存 bindFlows 整体替换带 revision（初始值只取启用 flowIds）', async () => {
    const bindFlows = vi.spyOn(sourceGroupApi, 'bindFlows').mockResolvedValue({ ok: true, message: '操作成功' })
    const { wrapper } = await mountTab({
      groups: [{ ...GROUP_3, flowIds: ['21000005', '21000006'] }],
      bindings: [
        ...BINDINGS_3,
        { id: '33', sourceGroupId: '3', flowId: '21000007', isDefault: false, state: 'DISABLED', revision: 1 },
      ],
    })
    await wrapper.findAll('.sg-item-select')[0]!.trigger('click')
    await settle()
    await openGroupAction(wrapper, 'sg-flow-btn')
    await settle()
    // 抽屉内容 teleport 到 body → 用真实 DOM 查
    expect(document.body.textContent).toContain('流程配置')
    const save = dom('[data-testid="sg-save-flows"]') as HTMLButtonElement
    save.click()
    await settle()
    expect(bindFlows).toHaveBeenCalledWith({
      sourceGroupId: '3',
      revision: 2,
      flowIds: ['21000005', '21000006'],
      defaultFlowId: '21000006',
    })
  })

  it('关联流程用流程选择弹窗挑选，回填标签并按新列表保存', async () => {
    const bindFlows = vi.spyOn(sourceGroupApi, 'bindFlows').mockResolvedValue({ ok: true, message: '操作成功' })
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ list: [], total: 0 } as unknown as Awaited<ReturnType<typeof flowCenterApi.paged>>)
    const { wrapper } = await mountTab()
    await wrapper.findAll('.sg-item-select')[0]!.trigger('click')
    await settle()
    await openGroupAction(wrapper, 'sg-flow-btn')
    await settle()
    ;(dom('[data-testid="sg-pick-flows"]') as HTMLButtonElement).click()
    await settle()
    const picker = wrapper.findComponent({ name: 'FlowPickerDialog' })
    expect(picker.props('selected')).toEqual(['21000005', '21000006'])
    expect(picker.props('hideSiteUsage')).toBe(true)
    picker.vm.$emit('confirm', [{ ...FLOW_21000006 }, { id: '21000009', name: '新挑的流程' }])
    await settle()
    expect(wrapper.findComponent({ name: 'FlowPickerDialog' }).exists()).toBe(false)
    expect(dom('[data-testid="sg-flow-ids"]')?.textContent).toContain('新挑的流程 · 21000009')
    ;(dom('[data-testid="sg-save-flows"]') as HTMLButtonElement).click()
    await settle()
    expect(bindFlows).toHaveBeenCalledWith(expect.objectContaining({ flowIds: ['21000006', '21000009'], defaultFlowId: '21000006' }))
  })

  it('组停用时「保存组流程」禁用并提示', async () => {
    const { wrapper } = await mountTab({
      groups: [{ ...GROUP_3, state: 'DISABLED', flowIds: [], defaultFlowId: undefined }],
      bindings: [],
    })
    await wrapper.findAll('.sg-item-select')[0]!.trigger('click')
    await settle()
    await openGroupAction(wrapper, 'sg-flow-btn')
    await settle()
    const save = dom('[data-testid="sg-save-flows"]') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(document.body.textContent).toContain('组已停用，请先在「编辑」中启用后修改流程列表')
  })
})

describe('来源组页签 · 编辑抽屉', () => {
  it('从菜单编辑来源组，保存带 revision', async () => {
    const { wrapper } = await mountTab()
    await wrapper.findAll('.sg-item-select')[0]!.trigger('click')
    await settle()
    await openGroupAction(wrapper, 'sg-detail-btn')
    await settle()
    const name = dom('[data-testid="sg-name"]') as HTMLInputElement
    name.value = 'twitter1改名'
    name.dispatchEvent(new Event('input'))
    await settle()
    const update = vi.spyOn(sourceGroupApi, 'update').mockResolvedValue({ ok: true, message: '操作成功' })
    const saveDetail = dom('[data-testid="sg-save-detail"]') as HTMLButtonElement
    saveDetail.click()
    await settle()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ sourceGroupId: '3', revision: 2, sourceGroupName: 'twitter1改名' }))

    expect(dom('[data-testid="sg-remove"]')).toBeNull()
  })
})

describe('来源组页签 · 组项菜单与解散', () => {
  it('右键命中并高亮该组，菜单收拢四个入口，编辑与差异均使用命中的组', async () => {
    const { wrapper } = await mountTab()
    await wrapper.get('[data-group-id="3"] .sg-item-select').trigger('click')
    await wrapper.get('[data-group-id="1"]').trigger('contextmenu', { clientX: 1800, clientY: 1200 })
    await settle()
    expect(wrapper.get('[data-group-id="1"]').classes()).toContain('active')
    expect(wrapper.get('.sg-toolbar').text()).toContain('测试组1')
    expect(wrapper.find('.sg-toolbar [data-testid="sg-detail-btn"]').exists()).toBe(false)
    expect([...document.querySelectorAll('[data-testid="sg-context-menu"] button')].map((button) => button.textContent)).toEqual(['编辑', '流程配置', '查看流程差异', '解散来源组'])
    ;(dom('[data-testid="sg-detail-btn"]') as HTMLButtonElement).click()
    await settle()
    expect((dom('[data-testid="sg-name"]') as HTMLInputElement).value).toBe('测试组1')
    expect(document.body.textContent).toContain('编辑 · 测试组1')
    // 关闭抽屉，再从悬停的更多入口打开同一份菜单。
    wrapper.findAllComponents({ name: 'ElDrawer' }).find((drawer) => String(drawer.props('title')).startsWith('编辑'))!.vm.$emit('update:modelValue', false)
    await wrapper.get('[data-testid="sg-more-1"]').trigger('click')
    await settle()
    ;(dom('[data-testid="sg-flow-diff-btn"]') as HTMLButtonElement).click()
    await settle()
    expect(wrapper.getComponent({ name: 'SourceGroupFlowDiffDrawer' }).props('group').sourceGroupId).toBe('1')
    expect(dom('[data-testid="sg-context-menu"]')).toBeNull()
  })

  it('菜单支持键盘打开、Escape 和点击外部关闭，非管理员不能编辑或解散', async () => {
    const { wrapper } = await mountTab()
    await wrapper.get('[data-group-id="3"] .sg-item-select').trigger('keydown', { key: 'F10', shiftKey: true })
    await settle()
    expect(dom('[data-testid="sg-context-menu"]')).not.toBeNull()
    dom('[data-testid="sg-context-menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(dom('[data-testid="sg-context-menu"]')).toBeNull()
    useAuthStore().roles = ['read']
    await wrapper.get('[data-testid="sg-more-1"]').trigger('click')
    await settle()
    expect((dom('[data-testid="sg-detail-btn"]') as HTMLButtonElement).disabled).toBe(true)
    expect((dom('[data-testid="sg-dissolve"]') as HTMLButtonElement).disabled).toBe(true)
    expect((dom('[data-testid="sg-flow-diff-btn"]') as HTMLButtonElement).disabled).toBe(false)
    await wrapper.get('.sg-content').trigger('scroll')
    expect(dom('[data-testid="sg-context-menu"]')).not.toBeNull()
    await wrapper.get('.sg-list').trigger('scroll')
    expect(dom('[data-testid="sg-context-menu"]')).toBeNull()
    await wrapper.get('[data-testid="sg-more-1"]').trigger('click')
    await settle()
    document.body.click()
    await settle()
    expect(dom('[data-testid="sg-context-menu"]')).toBeNull()
  })

  it('一次确认覆盖完整分页成员，先移出再按最新 revision 删除右键命中的组', async () => {
    const { wrapper } = await mountTab()
    let ids = Array.from({ length: 201 }, (_, i) => String(1000 + i))
    const originalIds = [...ids]
    let revision = 1
    vi.mocked(sourceGroupApi.detail).mockImplementation(async (id) => ({ ...(id === '1' ? GROUP_1 : GROUP_3), revision }))
    vi.mocked(sourceGroupApi.members).mockImplementation(async (_, offset, limit) => ({ rows: ids.slice(offset, offset + limit).map((sourceId) => ({ sourceId, sourceName: sourceId })), hasMore: offset + limit < ids.length }))
    const change = vi.spyOn(sourceGroupApi, 'changeMembers').mockImplementation(async () => { ids = []; revision = 4; return { ok: true, message: '' } })
    const remove = vi.spyOn(sourceGroupApi, 'remove').mockImplementation(async () => { vi.mocked(sourceGroupApi.list).mockResolvedValue([GROUP_3]); return { ok: true, message: '' } })
    selectIds.value = ['999']
    await openGroupAction(wrapper, 'sg-dissolve', '1')
    expect(sourceGroupApi.members).toHaveBeenCalledWith('1', 200, 200)
    expect(document.body.textContent).toContain('201')
    expect(document.body.textContent).toContain('源记录和采集数据保留')
    expect(change).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    ;(dom('[data-testid="sg-dissolve-confirm"]') as HTMLButtonElement).click()
    await settle()
    expect(change).toHaveBeenCalledWith({ sourceIds: originalIds, sourceGroupId: null, expectedSourceGroupId: '1' })
    expect(remove).toHaveBeenCalledWith({ sourceGroupId: '1', revision: 4 })
    expect(change.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]!)
    expect(dom('[data-testid="sg-dissolve-dialog"]')).toBeNull()
    expect(useUiStore().sourceListRevision).toBe(1)
  })

  it('成员读取失败不能确认，不把读取失败当空组', async () => {
    const { wrapper } = await mountTab()
    vi.mocked(sourceGroupApi.members).mockRejectedValue(new Error('成员加载失败'))
    const remove = vi.spyOn(sourceGroupApi, 'remove')
    await openGroupAction(wrapper, 'sg-dissolve')
    expect((dom('[data-testid="sg-dissolve-confirm"]') as HTMLButtonElement).disabled).toBe(true)
    expect(document.body.textContent).toContain('成员加载失败')
    expect(remove).not.toHaveBeenCalled()
  })

  it('确认前成员变化时停止，不移出新成员、不发删除请求', async () => {
    const { wrapper } = await mountTab()
    vi.mocked(sourceGroupApi.members).mockResolvedValue({ rows: [{ sourceId: '100', sourceName: 'A' }], hasMore: false })
    const change = vi.spyOn(sourceGroupApi, 'changeMembers')
    const remove = vi.spyOn(sourceGroupApi, 'remove')
    await openGroupAction(wrapper, 'sg-dissolve')
    vi.mocked(sourceGroupApi.members).mockResolvedValue({ rows: [{ sourceId: '101', sourceName: 'B' }], hasMore: false })
    ;(dom('[data-testid="sg-dissolve-confirm"]') as HTMLButtonElement).click()
    await settle()
    expect(document.body.textContent).toContain('成员已变化')
    expect(change).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('移出失败不继续删除；移出后仍有成员也不删除', async () => {
    const { wrapper } = await mountTab()
    vi.mocked(sourceGroupApi.members).mockResolvedValue({ rows: [{ sourceId: '100', sourceName: 'A' }], hasMore: false })
    const change = vi.spyOn(sourceGroupApi, 'changeMembers').mockRejectedValueOnce(new Error('退组失败'))
    const remove = vi.spyOn(sourceGroupApi, 'remove')
    await openGroupAction(wrapper, 'sg-dissolve')
    ;(dom('[data-testid="sg-dissolve-confirm"]') as HTMLButtonElement).click()
    await settle()
    expect(document.body.textContent).toContain('退组失败')
    expect(remove).not.toHaveBeenCalled()
    ;(dom('[data-testid="sg-dissolve-reload"]') as HTMLButtonElement).click()
    await settle()
    change.mockResolvedValue({ ok: true, message: '' })
    ;(dom('[data-testid="sg-dissolve-confirm"]') as HTMLButtonElement).click()
    await settle()
    expect(document.body.textContent).toContain('组内仍有成员')
    expect(remove).not.toHaveBeenCalled()
  })

  it('移出成功而删除失败时可重试删除，不重复移出；空组直接删除', async () => {
    const { wrapper } = await mountTab()
    let ids = ['100']
    vi.mocked(sourceGroupApi.members).mockImplementation(async () => ({ rows: ids.map((sourceId) => ({ sourceId, sourceName: sourceId })), hasMore: false }))
    const change = vi.spyOn(sourceGroupApi, 'changeMembers').mockImplementation(async () => { ids = []; return { ok: true, message: '' } })
    const remove = vi.spyOn(sourceGroupApi, 'remove').mockRejectedValueOnce(new Error('删除失败')).mockResolvedValue({ ok: true, message: '' })
    await openGroupAction(wrapper, 'sg-dissolve')
    ;(dom('[data-testid="sg-dissolve-confirm"]') as HTMLButtonElement).click()
    await settle()
    expect(document.body.textContent).toContain('成员已移出，来源组尚未删除')
    expect(dom('[data-testid="sg-dissolve-confirm"]')!.textContent).toContain('重试删除空组')
    ;(dom('[data-testid="sg-dissolve-confirm"]') as HTMLButtonElement).click()
    await settle()
    expect(change).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledTimes(2)
    await openGroupAction(wrapper, 'sg-dissolve', '1')
    ;(dom('[data-testid="sg-dissolve-confirm"]') as HTMLButtonElement).click()
    await settle()
    expect(change).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenLastCalledWith({ sourceGroupId: '1', revision: 1 })
  })
})

describe('来源组页签 · 新建来源组', () => {
  it('新建成功后按组编码选中新组（不依赖列表顺序）并打开「流程配置」抽屉', async () => {
    const newGroup: SourceGroup = { sourceGroupId: '9', sourceGroupCode: 'test9', sourceGroupName: '新测试组', state: 'ACTIVE', flowIds: [], revision: 1 }
    vi.spyOn(sourceGroupApi, 'add').mockResolvedValue({ ok: true, message: '操作成功' })
    const list = vi.spyOn(sourceGroupApi, 'list')
      .mockResolvedValueOnce([GROUP_3, GROUP_1])
      .mockResolvedValueOnce([newGroup, GROUP_3, GROUP_1])
    const { wrapper } = await mountTab({ list: list as unknown as () => Promise<SourceGroup[]> })
    await wrapper.find('[data-testid="sg-new"]').trigger('click')
    await settle()
    const code = dom('[data-testid="sg-new-code"]') as HTMLInputElement
    const name = dom('[data-testid="sg-new-name"]') as HTMLInputElement
    code.value = 'test9'
    code.dispatchEvent(new Event('input'))
    name.value = '新测试组'
    name.dispatchEvent(new Event('input'))
    await settle()
    const submit = dom('[data-testid="sg-new-submit"]') as HTMLButtonElement
    submit.click()
    await settle()
    expect(list).toHaveBeenCalledTimes(2)
    // 新组被选中
    expect(wrapper.find('.sg-toolbar').text()).toContain('新测试组')
    // 流程配置抽屉打开
    expect(document.body.textContent).toContain('流程配置')
  })
})

describe('来源组页签 · 成员操作', () => {
  it('移出选中成员直接调 changeMembers 并刷新，不再弹退组确认', async () => {
    const { wrapper } = await mountTab()
    // 先设勾选再选组：SOV stub 首次渲染 selection-actions 槽时 ids 即有值
    selectIds.value = ['391000500']
    await wrapper.findAll('.sg-item-select')[0]!.trigger('click')
    await settle()
    const changeMembers = vi.spyOn(sourceGroupApi, 'changeMembers').mockResolvedValue({ ok: true, message: '操作成功' })
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    const removeBtn = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('移出来源组'))
    expect(removeBtn, '应有「移出来源组」按钮').toBeTruthy()
    expect(removeBtn!.disabled).toBe(false)
    removeBtn!.click()
    await settle()
    expect(confirm).not.toHaveBeenCalled()
    expect(changeMembers).toHaveBeenCalledWith({
      sourceIds: ['391000500'],
      sourceGroupId: null,
      expectedSourceGroupId: '3',
    })
    // 右侧成员列表要重查（SourceOverviewView 监听 sourceListRevision）
    expect(useUiStore().sourceListRevision).toBe(1)
  })

  it('成员表操作区有「添加源」，点开选源弹窗（backend 模式）；停用组不能添加', async () => {
    const { wrapper } = await mountTab({ groups: [GROUP_3, { ...GROUP_1, state: 'DISABLED' }] })
    await wrapper.findAll('.sg-item-select')[0]!.trigger('click')
    await settle()
    const add = wrapper.find('[data-testid="sg-add-source"]')
    expect(add.attributes('disabled')).toBeUndefined()
    await add.trigger('click')
    await settle()
    const picker = wrapper.findComponent({ name: 'GroupSourcePicker' })
    expect(picker.props('modelValue')).toBe(true)
    expect(picker.props('backendMode')).toBe(true)
    expect(picker.props('groupId')).toBe('3')

    await wrapper.findAll('.sg-item-select')[1]!.trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="sg-add-source"]').attributes('disabled')).toBeDefined()
  })
})

describe('来源组页签 · 成员表业务目录列', () => {
  it('选中组后成员表给出「业务目录」列头，按源显示完整路径标签', async () => {
    const { wrapper } = await mountTab()
    // 成员表出现前不拉业务目录关系
    expect(sourceDirs.bizMembership).not.toHaveBeenCalled()
    vi.mocked(sourceDirs.bizMembership).mockResolvedValue(new Map([['s1', ['d1', 'd2']]]))
    vi.spyOn(sourceDirs, 'dirPath').mockImplementation((id) => id === 'd1' ? ['股票数据', '基本资料'] : ['债券数据', '基本资料'])
    await wrapper.findAll('.sg-item-select')[0]!.trigger('click')
    await settle()
    expect(sourceDirs.bizMembership).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="sov-extra-head"]').text()).toBe('业务目录')
    expect(wrapper.findAll('.sg-biz-tag').map((tag) => tag.attributes('title'))).toEqual(['股票数据 / 基本资料', '债券数据 / 基本资料'])
    expect(wrapper.find('[data-testid="sg-biz-empty"]').exists()).toBe(false)
  })

  it('业务目录关系加载中显示「加载中…」，不提前标成未归类', async () => {
    const { wrapper } = await mountTab()
    let resolve!: (map: Map<string, string[]>) => void
    vi.mocked(sourceDirs.bizMembership).mockReturnValue(new Promise((done) => { resolve = done }))
    await wrapper.findAll('.sg-item-select')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="sg-biz-loading"]').text()).toBe('加载中…')
    expect(wrapper.find('[data-testid="sg-biz-empty"]').exists()).toBe(false)
    resolve(new Map())
    await flushPromises()
    expect(wrapper.find('[data-testid="sg-biz-loading"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="sg-biz-empty"]').text()).toBe('未归类')
  })

  it('业务目录关系加载失败显示「加载失败」，不当成未归类', async () => {
    const { wrapper } = await mountTab()
    vi.mocked(sourceDirs.bizMembership).mockRejectedValue(new Error('网络异常'))
    await wrapper.findAll('.sg-item-select')[0]!.trigger('click')
    await settle()
    expect(wrapper.get('[data-testid="sg-biz-error"]').text()).toBe('加载失败')
    expect(wrapper.find('[data-testid="sg-biz-empty"]').exists()).toBe(false)
  })
})

describe('来源组页签 · 权限', () => {
  it('非 admin：所有写按钮禁用，显示只读提示', async () => {
    useAuthStore().roles = ['read']
    const { wrapper } = await mountTab()
    await wrapper.findAll('.sg-item-select')[0]!.trigger('click')
    await settle()
    expect(wrapper.text()).toContain('当前账号仅可查看，修改需要管理员权限')
    expect((wrapper.get('[data-testid="sg-new"]').element as HTMLButtonElement).disabled).toBe(true)
    expect((wrapper.get('[data-testid="sg-add-source"]').element as HTMLButtonElement).disabled).toBe(true)
  })
})
