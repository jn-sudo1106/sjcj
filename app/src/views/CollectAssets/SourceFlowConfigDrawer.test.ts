// @vitest-environment jsdom
// 源流程配置抽屉（1008-04）：组内源分「来源组流程（只读 + 查看组配置 / 退出来源组）」和「本源流程」两段；
// 本源流程整体替换保存 + 绑定状态表（10-15 起入组源也能维护自有流程）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import SourceFlowConfigDrawer from './SourceFlowConfigDrawer.vue'
import { useAuthStore } from '@/stores/auth'
import { sourceGroupApi, workflowBindingApi, flowCenterApi, type Source, type SourceFlowsView, type SourceFlowBind, type FlowRecord } from '@/api'

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

  it('组内源：来源组流程只读一段，本源流程一段可保存（只交本源的流程）', async () => {
    vi.spyOn(workflowBindingApi, 'view').mockResolvedValue(GROUP_VIEW)
    const save = vi.spyOn(workflowBindingApi, 'save').mockResolvedValue(undefined)
    const wrapper = mount(SourceFlowConfigDrawer, { props: { source: GROUP_SOURCE, flows: [FLOW] }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    await settle()
    expect(dom('[data-testid="sfcd-group-section"]')?.textContent).toContain('组 #3')
    expect(document.body.textContent).toContain('组默认：流程 21000006')
    expect(dom('[data-testid="sfcd-own-section"]')).toBeTruthy()
    // 两张绑定表：组 2 行 + 本源 2 行
    expect(document.querySelectorAll('[data-testid="sfcd-binding-toggle"]')).toHaveLength(4)
    ;(dom('[data-testid="sfcd-save"]') as HTMLButtonElement).click()
    await settle()
    const change = save.mock.calls[0][1]
    expect(change(GROUP_VIEW)).toEqual({ flowIds: ['21000019', '21000022'], defaultFlowId: '21000022' })
    wrapper.unmount()
  })

  it('组内源：可查看组配置 / 退出来源组', async () => {
    vi.spyOn(workflowBindingApi, 'view').mockResolvedValue(GROUP_VIEW)
    const changeMembers = vi.spyOn(sourceGroupApi, 'changeMembers').mockResolvedValue({ ok: true, message: '操作成功' })
    const wrapper = mount(SourceFlowConfigDrawer, { props: { source: GROUP_SOURCE, flows: [FLOW] }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    await settle()
    expect(document.body.textContent).toContain('来源组流程')
    const leaveBtn = dom('[data-testid="sfcd-leave-group"]') as HTMLButtonElement
    leaveBtn.click()
    await settle()
    // 退组旧绑定不恢复 → 先二次确认（测试无 zh-cn locale → 按钮是 OK）
    expect(changeMembers).not.toHaveBeenCalled()
    const okBtn = [...document.querySelectorAll<HTMLButtonElement>('.el-message-box button')].find((b) => b.textContent?.trim() === 'OK')
    expect(okBtn, '应弹出确认框').toBeTruthy()
    okBtn!.click()
    await settle()
    expect(changeMembers).toHaveBeenCalledWith({ sourceIds: ['430000930'], sourceGroupId: null, expectedSourceGroupId: '3' })
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
})
