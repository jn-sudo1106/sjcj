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

// stub SourceOverviewView：选中范围由外部注入，selection-actions 槽位渲染可控 ids，
// 成员测试才能驱动「移出来源组 / 换到其他组」。
const selectIds = vi.hoisted(() => ({ value: [] as string[] }))
vi.mock('@/views/FlowCanvas/result/SourceOverviewView.vue', () => ({
  default: {
    name: 'SourceOverviewView',
    props: { currentSiteId: String, scopeSourceGroupId: String, scopeEmptyText: String },
    emits: ['open-source', 'open-source-data', 'open-site'],
    template: '<div class="sov-stub" data-testid="sov-stub"><slot name="filter-extra" /><slot name="selection-actions" :ids="ids()" /></div>',
    setup: () => ({ ids: () => selectIds.value }),
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
  vi.spyOn(sourceApi, 'sourcePaged').mockImplementation(async (q) => ({
    total: q?.sourceGroupId === '3' ? 255 : 22,
    list: [],
  }))
  vi.spyOn(flowCenterApi, 'list').mockResolvedValue([FLOW_21000006])
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
  const wrapper = mount(SourceGroupTab, { global: { plugins: [ElementPlus, router] }, attachTo: document.body })
  mountedTabs.push(wrapper)
  await settle()
  return { wrapper, router }
}

const dom = (sel: string) => document.querySelector(sel) as HTMLElement | null

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
    await items[0]!.trigger('click')
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
    await wrapper.findAll('.sg-item')[0]!.trigger('click')
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
    await wrapper.findAll('.sg-item')[0]!.trigger('click')
    await settle()
    await wrapper.find('[data-testid="sg-flow-btn"]').trigger('click')
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
    await wrapper.findAll('.sg-item')[0]!.trigger('click')
    await settle()
    await wrapper.find('[data-testid="sg-flow-btn"]').trigger('click')
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
    await wrapper.findAll('.sg-item')[0]!.trigger('click')
    await settle()
    await wrapper.find('[data-testid="sg-flow-btn"]').trigger('click')
    await settle()
    const save = dom('[data-testid="sg-save-flows"]') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(document.body.textContent).toContain('组已停用，请先在「组资料」中启用后修改流程列表')
  })
})

describe('来源组页签 · 组资料抽屉', () => {
  it('保存组资料带 revision；删除空组先查成员', async () => {
    const { wrapper } = await mountTab()
    await wrapper.findAll('.sg-item')[0]!.trigger('click')
    await settle()
    await wrapper.find('[data-testid="sg-detail-btn"]').trigger('click')
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

    // 删除有成员的组：先提示「先移出全部成员」，不发删除请求
    vi.spyOn(sourceGroupApi, 'members').mockResolvedValue({ rows: [{ sourceId: '1', sourceName: 'x' }], hasMore: false })
    const remove = vi.spyOn(sourceGroupApi, 'remove')
    const removeBtn = dom('[data-testid="sg-remove"]') as HTMLButtonElement
    removeBtn.click()
    await settle()
    expect(remove).not.toHaveBeenCalled()
    // 数量另用 sourcePaged 按组筛的 count（members 只取 1 条判断有没有）
    expect(document.body.textContent).toContain('还有 255 个成员，请先移出全部成员')
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
    await wrapper.findAll('.sg-item')[0]!.trigger('click')
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
    await wrapper.findAll('.sg-item')[0]!.trigger('click')
    await settle()
    const add = wrapper.find('[data-testid="sg-add-source"]')
    expect(add.attributes('disabled')).toBeUndefined()
    await add.trigger('click')
    await settle()
    const picker = wrapper.findComponent({ name: 'GroupSourcePicker' })
    expect(picker.props('modelValue')).toBe(true)
    expect(picker.props('backendMode')).toBe(true)
    expect(picker.props('groupId')).toBe('3')

    await wrapper.findAll('.sg-item')[1]!.trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="sg-add-source"]').attributes('disabled')).toBeDefined()
  })
})

describe('来源组页签 · 权限', () => {
  it('非 admin：所有写按钮禁用，显示只读提示', async () => {
    useAuthStore().roles = ['read']
    const { wrapper } = await mountTab()
    await wrapper.findAll('.sg-item')[0]!.trigger('click')
    await settle()
    expect(wrapper.text()).toContain('当前账号仅可查看，修改需要管理员权限')
    expect((wrapper.get('[data-testid="sg-new"]').element as HTMLButtonElement).disabled).toBe(true)
    expect((wrapper.get('[data-testid="sg-add-source"]').element as HTMLButtonElement).disabled).toBe(true)
  })
})
