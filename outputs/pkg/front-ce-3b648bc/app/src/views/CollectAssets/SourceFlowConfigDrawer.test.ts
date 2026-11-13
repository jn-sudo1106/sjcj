// @vitest-environment jsdom
// 源流程配置抽屉（1008-04）：组内源只有「来源组流程（查看组配置 / 退出来源组）」，入组前的自有绑定折叠成「历史自有流程（已不生效）」
//（1021-02：组内源只走组流程）；独立源是「本源流程」整体替换保存 + 绑定状态表。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import SourceFlowConfigDrawer from './SourceFlowConfigDrawer.vue'
import { useAuthStore } from '@/stores/auth'
import { siteApi, sourceGroupApi, workflowBindingApi, flowCenterApi, type Source, type SourceFlowsView, type SourceFlowBind, type FlowRecord } from '@/api'

const INDEP_SOURCE = { sourceId: '430024667', name: '独立源', sourceGroupId: undefined } as Source
const GROUP_SOURCE = { sourceId: '430000930', name: '组内源', sourceGroupId: '3' } as Source
const FLOW = { id: '14010130', name: '主流程', state: 'A' } as unknown as FlowRecord

const INDEP_VIEW: SourceFlowsView = {
  sourceId: '430024667',
  flowIds: ['14010130'],
  defaultFlowId: '14010130',
  bindings: [{ id: '18844', sourceId: '430024667', flowId: '14010130', isDefault: true, state: 'ACTIVE', revision: 1 } as SourceFlowBind],
  ownFlowIds: ['14010130'],
  ownDefaultFlowId: '14010130',
  ownBindings: [{ id: '18844', sourceId: '430024667', flowId: '14010130', isDefault: true, state: 'ACTIVE', revision: 1 } as SourceFlowBind],
}
const GROUP_VIEW: SourceFlowsView = {
  sourceId: '430000930',
  sourceGroupId: '3',
  flowIds: ['21000005', '21000006'],
  defaultFlowId: '21000006',
  bindings: [
    { id: '31', sourceGroupId: '3', flowId: '21000005', isDefault: false, state: 'ACTIVE', revision: 2 } as SourceFlowBind,
    { id: '32', sourceGroupId: '3', flowId: '21000006', isDefault: true, state: 'ACTIVE', revision: 2 } as SourceFlowBind,
  ],
  ownFlowIds: ['21000019', '21000022'],
  ownDefaultFlowId: '21000022',
  ownBindings: [
    { id: '41', sourceId: '430000930', flowId: '21000022', isDefault: true, state: 'ACTIVE', revision: 2 } as SourceFlowBind,
    { id: '42', sourceId: '430000930', flowId: '21000019', isDefault: false, state: 'ACTIVE', revision: 1 } as SourceFlowBind,
  ],
}

async function settle() {
  await flushPromises()
  await new Promise((r) => setTimeout(r, 60))
}

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().roles = ['admin']
})
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

const dom = (sel: string) => document.querySelector(sel) as HTMLElement | null

describe('源流程配置抽屉', () => {
  it('独立源：多选 + 默认单选 + 保存走 bindSourceFlows 整体替换', async () => {
    vi.spyOn(workflowBindingApi, 'view').mockResolvedValue(INDEP_VIEW)
    const save = vi.spyOn(workflowBindingApi, 'save').mockResolvedValue(undefined)
    mount(SourceFlowConfigDrawer, { props: { source: INDEP_SOURCE, flows: [FLOW] }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    await settle()
    expect(document.body.textContent).toContain('源流程配置')
    // 默认流程已带出 14010130；保持原样保存
    const saveBtn = dom('[data-testid="sfcd-save"]') as HTMLButtonElement
    saveBtn.click()
    await settle()
    expect(save).toHaveBeenCalledWith('430024667', expect.any(Function))
  })

  it('组内源：只有来源组流程，不出本源流程编辑区；入组前的自有绑定折叠成「历史自有流程（已不生效）」（1021-02）', async () => {
    vi.spyOn(workflowBindingApi, 'view').mockResolvedValue(GROUP_VIEW)
    const save = vi.spyOn(workflowBindingApi, 'save').mockResolvedValue(undefined)
    const wrapper = mount(SourceFlowConfigDrawer, { props: { source: GROUP_SOURCE, flows: [FLOW] }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    await settle()
    expect(dom('[data-testid="sfcd-group-section"]')?.textContent).toContain('组 #3')
    expect(document.body.textContent).toContain('组默认：流程 21000006')
    expect(dom('[data-testid="sfcd-own-section"]')).toBeNull()
    expect(dom('[data-testid="sfcd-save"]')).toBeNull()
    expect(dom('[data-testid="sfcd-flow-ids"]')).toBeNull()
    // 只剩组绑定表的 2 个开关；历史自有流程只读，没有开关
    expect(document.querySelectorAll('[data-testid="sfcd-binding-toggle"]')).toHaveLength(2)
    expect(dom('[data-testid="sfcd-own-history"]')?.textContent).toContain('历史自有流程（已不生效，2 条）')
    expect(save).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('组内源没有历史自有绑定时不出折叠区', async () => {
    vi.spyOn(workflowBindingApi, 'view').mockResolvedValue({ ...GROUP_VIEW, ownFlowIds: [], ownDefaultFlowId: undefined, ownBindings: [] })
    const wrapper = mount(SourceFlowConfigDrawer, { props: { source: GROUP_SOURCE, flows: [FLOW] }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    await settle()
    expect(dom('[data-testid="sfcd-group-section"]')).toBeTruthy()
    expect(dom('[data-testid="sfcd-own-history"]')).toBeNull()
    wrapper.unmount()
  })

  async function leaveWith(afterView: SourceFlowsView) {
    const view = vi.spyOn(workflowBindingApi, 'view').mockResolvedValueOnce(GROUP_VIEW).mockResolvedValue(afterView)
    const changeMembers = vi.spyOn(sourceGroupApi, 'changeMembers').mockResolvedValue({ ok: true, message: '操作成功' })
    const success = vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never)
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => undefined as never)
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    const wrapper = mount(SourceFlowConfigDrawer, { props: { source: GROUP_SOURCE, flows: [FLOW] }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    await settle()
    ;(dom('[data-testid="sfcd-leave-group"]') as HTMLButtonElement).click()
    await settle()
    expect(confirm).not.toHaveBeenCalled()
    expect(changeMembers).toHaveBeenCalledWith({ sourceIds: ['430000930'], sourceGroupId: null, expectedSourceGroupId: '3' })
    expect(view).toHaveBeenCalledTimes(2)
    return { wrapper, success, warning }
  }

  it('退出来源组直接执行，刷新并展示恢复的自有流程', async () => {
    const after: SourceFlowsView = { ...GROUP_VIEW, sourceGroupId: undefined, flowIds: GROUP_VIEW.ownFlowIds, defaultFlowId: GROUP_VIEW.ownDefaultFlowId, bindings: GROUP_VIEW.ownBindings }
    const { wrapper, success } = await leaveWith(after)
    expect(success).toHaveBeenCalledWith('已退出来源组')
    expect(dom('[data-testid="sfcd-own-section"]')).toBeTruthy()
    expect(dom('[data-testid="sfcd-group-section"]')).toBeNull()
    wrapper.unmount()
  })

  it('退出来源组不额外警告重新配置流程，按实际结果显示本源流程区', async () => {
    const after: SourceFlowsView = { sourceId: '430000930', flowIds: [], bindings: [], ownFlowIds: [], ownBindings: [] }
    const { wrapper, warning, success } = await leaveWith(after)
    expect(warning).not.toHaveBeenCalled()
    expect(success).toHaveBeenCalledWith('已退出来源组')
    expect(dom('[data-testid="sfcd-own-section"]')).toBeTruthy()
    wrapper.unmount()
  })

  it('绑定状态表启停调 updateBindingState；非 admin 全部禁用', async () => {
    vi.spyOn(workflowBindingApi, 'view').mockResolvedValue(INDEP_VIEW)
    useAuthStore().roles = ['read']
    const updateBindingState = vi.spyOn(sourceGroupApi, 'updateBindingState')
    const wrapper = mount(SourceFlowConfigDrawer, { props: { source: INDEP_SOURCE, flows: [FLOW] }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    await settle()
    const saveBtn = dom('[data-testid="sfcd-save"]') as HTMLButtonElement
    expect(saveBtn.disabled).toBe(true)
    const toggle = dom('[data-testid="sfcd-binding-toggle"] .el-switch__input') as HTMLInputElement
    expect(toggle.disabled).toBe(true)
    expect(updateBindingState).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('点「查看组配置」发 openGroup 事件', async () => {
    vi.spyOn(workflowBindingApi, 'view').mockResolvedValue(GROUP_VIEW)
    const wrapper = mount(SourceFlowConfigDrawer, { props: { source: GROUP_SOURCE, flows: [FLOW] }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    await settle()
    const viewGroupBtn = dom('[data-testid="sfcd-view-group"]') as HTMLButtonElement
    viewGroupBtn.click()
    await settle()
    expect(wrapper.emitted('openGroup')).toEqual([['3']])
    wrapper.unmount()
  })

  it('查看流程节点拉详情打开 FlowDetailDrawer', async () => {
    vi.spyOn(workflowBindingApi, 'view').mockResolvedValue(INDEP_VIEW)
    const detail = vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(FLOW)
    const wrapper = mount(SourceFlowConfigDrawer, { props: { source: INDEP_SOURCE, flows: [FLOW] }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    await settle()
    const nodeBtn = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('查看流程节点'))
    nodeBtn?.click()
    await settle()
    expect(detail).toHaveBeenCalledWith('14010130')
    wrapper.unmount()
  })

  // 1030 会议议题 3、4：显示源 ID；推荐同网站其他源在用的流程（按默认流程计数，排除自己和已关联的）
  it('独立源：显示源 ID，推荐同网站其他源在用的流程，点「加入」进关联列表', async () => {
    vi.spyOn(workflowBindingApi, 'view').mockResolvedValue(INDEP_VIEW)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([
      { sourceId: '430024667', flowId: '99' },
      { sourceId: '1', flowId: '14010130' },
      { sourceId: '2', flowId: '21000005' },
      { sourceId: '3', flowId: '21000005' },
      { sourceId: '4' },
    ] as Source[])
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 1, list: [{ id: '21000005', name: '详情页流程' } as FlowRecord] })
    const wrapper = mount(SourceFlowConfigDrawer, { props: { source: { ...INDEP_SOURCE, siteId: '12' }, flows: [FLOW] }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    await settle()
    expect(dom('[data-testid="sfcd-source-id"]')?.textContent).toContain('430024667')
    // 14010130 已经关联、99 是自己的默认流程，都不推荐
    const recs = [...document.querySelectorAll('[data-testid="sfcd-recommend-row"]')]
    expect(recs).toHaveLength(1)
    expect(recs[0].textContent).toContain('详情页流程 · 21000005')
    expect(recs[0].textContent).toContain('本网站 2 个源在用')
    ;(recs[0].querySelector('[data-testid="sfcd-recommend-add"]') as HTMLButtonElement).click()
    await settle()
    expect(dom('[data-testid="sfcd-flow-ids"]')?.textContent).toContain('详情页流程 · 21000005')
    expect(dom('[data-testid="sfcd-recommend"]')).toBeNull()
    wrapper.unmount()
  })

  it('推荐剔除停用 / 已删除的流程，顶上来的流程也补名称', async () => {
    vi.spyOn(workflowBindingApi, 'view').mockResolvedValue(INDEP_VIEW)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([
      ...['1', '2', '3'].map((sourceId) => ({ sourceId, flowId: '501' })),
      ...['4', '5'].map((sourceId) => ({ sourceId, flowId: '502' })),
      { sourceId: '6', flowId: '503' },
      { sourceId: '7', flowId: '504' },
    ] as Source[])
    const flowsById: Record<string, FlowRecord> = {
      501: { id: '501', name: '停用流程', disabled: true } as FlowRecord,
      503: { id: '503', name: '列表页流程' } as FlowRecord,
      504: { id: '504', name: '详情页流程' } as FlowRecord,
    }
    vi.spyOn(flowCenterApi, 'paged').mockImplementation(async (cond) => {
      const list = (cond?.flowIds ?? []).map((id) => flowsById[id]).filter(Boolean)
      return { total: list.length, list }
    })
    const wrapper = mount(SourceFlowConfigDrawer, { props: { source: { ...INDEP_SOURCE, siteId: '12' }, flows: [FLOW] }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    await settle()
    await settle()
    // 501 停用、502 查不到（已删除），都不推荐；504 是剔除后顶上来的，也有名称
    const texts = [...document.querySelectorAll('[data-testid="sfcd-recommend-row"]')].map((r) => r.textContent)
    expect(texts).toHaveLength(2)
    expect(texts[0]).toContain('列表页流程 · 503')
    expect(texts[1]).toContain('详情页流程 · 504')
    wrapper.unmount()
  })

  it('组内源不拉整站源；退组变成独立源后才拉，保存后重查不重复拉', async () => {
    const after: SourceFlowsView = { ...GROUP_VIEW, sourceGroupId: undefined, flowIds: GROUP_VIEW.ownFlowIds, defaultFlowId: GROUP_VIEW.ownDefaultFlowId, bindings: GROUP_VIEW.ownBindings }
    vi.spyOn(workflowBindingApi, 'view').mockResolvedValueOnce(GROUP_VIEW).mockResolvedValue(after)
    vi.spyOn(sourceGroupApi, 'changeMembers').mockResolvedValue({ ok: true, message: '' } as never)
    vi.spyOn(workflowBindingApi, 'save').mockResolvedValue(undefined)
    const sites = vi.spyOn(siteApi, 'siteSources').mockResolvedValue([])
    const wrapper = mount(SourceFlowConfigDrawer, { props: { source: { ...INDEP_SOURCE, siteId: '12' }, flows: [FLOW] }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    await settle()
    expect(sites).not.toHaveBeenCalled()
    dom('[data-testid="sfcd-leave-group"]')?.click()
    await settle()
    expect(sites).toHaveBeenCalledTimes(1)
    dom('[data-testid="sfcd-save"]')?.click()
    await settle()
    expect(sites).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('没有网站或网站源读取失败时不显示推荐', async () => {
    vi.spyOn(workflowBindingApi, 'view').mockResolvedValue(INDEP_VIEW)
    vi.spyOn(siteApi, 'siteSources').mockRejectedValue(new Error('超时'))
    const wrapper = mount(SourceFlowConfigDrawer, { props: { source: { ...INDEP_SOURCE, siteId: '12' }, flows: [FLOW] }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    await settle()
    expect(dom('[data-testid="sfcd-recommend"]')).toBeNull()
    expect(dom('[data-testid="sfcd-pick-flows"]')).not.toBeNull()
    wrapper.unmount()
  })
})
