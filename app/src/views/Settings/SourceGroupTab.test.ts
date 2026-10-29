// @vitest-environment jsdom
// 源管理「来源组」目录页签（1008-03，10-09 改定方案：复用「我的分组」界面，不新增独立工作区）。
// 左侧组列表（可按组名 / 编码 / ID 搜索，不显示成员数）+ 右侧成员源列表
// （SourceOverviewView + scopeSourceGroupId）；「流程配置」「组资料」右侧抽屉；新建来源组小弹窗。
// 写操作仅 admin；非 admin 全部写按钮禁用。写操作后重拉 list 刷新 revision（旧平台 act() 口径）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
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
    template: '<div class="sov-stub" data-testid="sov-stub"><slot name="selection-actions" :ids="ids()" /></div>',
    setup: () => ({ ids: () => selectIds.value }),
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

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().roles = ['admin']
  selectIds.value = []
})
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

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
  await settle()
  return { wrapper, router }
}

const dom = (sel: string) => document.querySelector(sel) as HTMLElement | null

describe('来源组页签 · 列表与选中', () => {
  it('左侧列出组（不逐组查成员数），点选后右侧加载', async () => {
    const { wrapper } = await mountTab()
    const items = wrapper.findAll('.sg-item')
    expect(items.length).toBe(2)
    expect(items.map((i) => i.text())).toEqual(['twitter1', '测试组1'])
    expect(sourceApi.sourcePaged).not.toHaveBeenCalled()
    await items[0]!.trigger('click')
    await settle()
    expect(wrapper.find('.sg-toolbar').text()).toContain('twitter1')
    expect(sourceGroupApi.bindings).toHaveBeenCalledWith({ sourceGroupId: '3' })
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
  it('移出选中成员调 changeMembers（target=null，expected=本组）', async () => {
    const { wrapper } = await mountTab()
    // 先设勾选再选组：SOV stub 首次渲染 selection-actions 槽时 ids 即有值
    selectIds.value = ['391000500']
    await wrapper.findAll('.sg-item')[0]!.trigger('click')
    await settle()
    const changeMembers = vi.spyOn(sourceGroupApi, 'changeMembers').mockResolvedValue({ ok: true, message: '操作成功' })
    const removeBtn = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('移出来源组'))
    expect(removeBtn, '应有「移出来源组」按钮').toBeTruthy()
    expect(removeBtn!.disabled).toBe(false)
    removeBtn!.click()
    await settle()
    // ElMessageBox 确认（测试无 zh-cn locale → 按钮是 OK）
    const okBtn = [...document.querySelectorAll<HTMLButtonElement>('.el-message-box button')].find((b) => b.textContent?.trim() === 'OK')
    expect(okBtn, '应弹出确认框').toBeTruthy()
    okBtn!.click()
    await settle()
    expect(changeMembers).toHaveBeenCalledWith({
      sourceIds: ['391000500'],
      sourceGroupId: null,
      expectedSourceGroupId: '3',
    })
    // 右侧成员列表要重查（SourceOverviewView 监听 sourceListRevision）
    expect(useUiStore().sourceListRevision).toBe(1)
  })

  it('工具条有「添加源」，点开选源弹窗（backend 模式）；停用组不能添加', async () => {
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
    const newBtn = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('新建'))
    expect(newBtn?.disabled).toBe(true)
  })
})
