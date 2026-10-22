// @vitest-environment jsdom
// 调整来源组弹窗（1008-04，§3.5）：勾选的源按当前归属 changeMembers；按筛选范围 changeMembersByRange
// （无筛选条件时红色警告 + 二次确认 confirmAll）。1021-03：勾选入组前先查源自己的流程，有就进「入组确认」，先解绑再入组。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import AdjustSourceGroupDialog from './AdjustSourceGroupDialog.vue'
import { flowCenterApi, sourceGroupApi, workflowBindingApi, type Source, type SourceFlowsView } from '@/api'

const GROUPS = [
  { sourceGroupId: '3', name: 'twitter1', state: 'ACTIVE' },
  { sourceGroupId: '1', name: '测试组1', state: 'ACTIVE' },
  { sourceGroupId: '9', name: '停用组', state: 'DISABLED' },
]
const SRC_IN_GROUP = { sourceId: '391000500', sourceGroupId: '3' } as Source
const SRC_INDEP = { sourceId: '430024667', sourceGroupId: undefined } as Source
const SRC_OWN = { sourceId: '20010739', name: 'test', sourceGroupId: undefined } as Source
const viewOf = (sourceId: string, ownFlowIds: string[] = []): SourceFlowsView => ({
  sourceId, flowIds: ownFlowIds, bindings: [], ownFlowIds, ownDefaultFlowId: ownFlowIds[0], ownBindings: [],
})

async function settle() {
  await flushPromises()
  await new Promise((r) => setTimeout(r, 60))
}
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })
const dom = (sel: string) => document.querySelector(sel) as HTMLElement | null

function mountDialog(overrides: { selectedSources?: Source[]; hasQueryFilter?: boolean; queryText?: string; query?: Record<string, unknown>; rangeBlocked?: boolean } = {}) {
  return mount(AdjustSourceGroupDialog, {
    props: {
      rangeBlocked: overrides.rangeBlocked,
      selectedSources: overrides.selectedSources ?? [],
      query: overrides.query ?? {},
      hasQueryFilter: overrides.hasQueryFilter ?? false,
      queryText: overrides.queryText ?? '',
      groups: GROUPS,
    },
    global: { plugins: [ElementPlus] },
    attachTo: document.body,
  })
}

describe('调整来源组弹窗', () => {
  it('勾选的源同属一组：changeMembers（expected=本组，目标可退组）', async () => {
    const changeMembers = vi.spyOn(sourceGroupApi, 'changeMembers').mockResolvedValue({ ok: true, message: '操作成功' })
    const wrapper = mountDialog({ selectedSources: [SRC_IN_GROUP], hasQueryFilter: true })
    await settle()
    // 选「退出来源组」
    const target = wrapper.findComponent({ name: 'ElSelect' })
    target.vm.$emit('update:modelValue', '__none__')
    await settle()
    const submit = dom('[data-testid="asg-submit"]') as HTMLButtonElement
    submit.click()
    await settle()
    expect(changeMembers).toHaveBeenCalledWith({ sourceIds: ['391000500'], sourceGroupId: null, expectedSourceGroupId: '3' })
    wrapper.unmount()
  })

  it('勾选的源分属不同组：禁止提交并提示', async () => {
    const changeMembers = vi.spyOn(sourceGroupApi, 'changeMembers')
    const wrapper = mountDialog({ selectedSources: [SRC_IN_GROUP, SRC_INDEP] })
    await settle()
    expect(document.body.textContent).toContain('分属不同来源组')
    const submit = dom('[data-testid="asg-submit"]') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(changeMembers).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('勾选的源未归组、没有自有流程：expected=null 直接加入目标组，不出入组确认', async () => {
    vi.spyOn(workflowBindingApi, 'view').mockResolvedValue(viewOf('430024667'))
    const changeMembers = vi.spyOn(sourceGroupApi, 'changeMembers').mockResolvedValue({ ok: true, message: '操作成功' })
    const wrapper = mountDialog({ selectedSources: [SRC_INDEP] })
    await settle()
    const target = wrapper.findComponent({ name: 'ElSelect' })
    target.vm.$emit('update:modelValue', '3')
    await settle()
    const submit = dom('[data-testid="asg-submit"]') as HTMLButtonElement
    submit.click()
    await settle()
    expect(changeMembers).toHaveBeenCalledWith({ sourceIds: ['430024667'], sourceGroupId: '3', expectedSourceGroupId: null })
    wrapper.unmount()
  })

  async function submitJoin(sources: Source[]) {
    const wrapper = mountDialog({ selectedSources: sources })
    await settle()
    wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', '3')
    await settle()
    ;(dom('[data-testid="asg-submit"]') as HTMLButtonElement).click()
    await settle()
    return wrapper
  }

  it('有自有流程：先出入组确认（默认全勾），确认后先清空自有流程、再入组（1021-03）', async () => {
    vi.spyOn(workflowBindingApi, 'view').mockImplementation(async (id) => viewOf(id, id === '20010739' ? ['402330'] : []))
    vi.spyOn(sourceGroupApi, 'detail').mockResolvedValue({ sourceGroupId: '3', sourceGroupCode: 't', sourceGroupName: 'twitter1', state: 'ACTIVE', flowIds: ['701350'], defaultFlowId: '701350', revision: 1 })
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(null)
    const order: string[] = []
    const save = vi.spyOn(workflowBindingApi, 'save').mockImplementation(async (id, change) => { order.push(`unbind:${id}`); expect(change(viewOf(id, ['402330']))).toEqual({ flowIds: [], defaultFlowId: null }) })
    const changeMembers = vi.spyOn(sourceGroupApi, 'changeMembers').mockImplementation(async (input) => { order.push(`join:${input.sourceIds.join(',')}`); return { ok: true, message: '操作成功' } })
    const wrapper = await submitJoin([SRC_OWN, SRC_INDEP])
    expect(changeMembers).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('以下 1 个源已经关联了自己的流程')
    expect(document.body.textContent).toContain('自有流程：流程 · 402330（默认）')
    expect(dom('[data-testid="gjc-direct"]')?.textContent).toContain('其余 1 个源')
    expect((dom('[data-testid="gjc-pick"]') as HTMLInputElement).checked).toBe(true)
    expect(dom('[data-testid="gjc-confirm"]')?.textContent).toContain('解除并加入（2 个源）')
    ;(dom('[data-testid="gjc-confirm"]') as HTMLButtonElement).click()
    await settle()
    expect(save).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['unbind:20010739', 'join:20010739,430024667'])
    expect(wrapper.emitted('saved')).toBeTruthy()
    expect(wrapper.emitted('close')).toBeTruthy()
    wrapper.unmount()
  })

  it('入组确认里取消勾选：这个源不解绑、不加入；组没有流程时黄色提示', async () => {
    vi.spyOn(workflowBindingApi, 'view').mockImplementation(async (id) => viewOf(id, id === '20010739' ? ['402330'] : []))
    vi.spyOn(sourceGroupApi, 'detail').mockResolvedValue({ sourceGroupId: '3', sourceGroupCode: 't', sourceGroupName: 'twitter1', state: 'ACTIVE', flowIds: [], revision: 1 })
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(null)
    const save = vi.spyOn(workflowBindingApi, 'save').mockResolvedValue(undefined)
    const changeMembers = vi.spyOn(sourceGroupApi, 'changeMembers').mockResolvedValue({ ok: true, message: '操作成功' })
    const wrapper = await submitJoin([SRC_OWN, SRC_INDEP])
    expect(dom('[data-testid="gjc-group-no-flow"]')).toBeTruthy()
    ;(dom('[data-testid="gjc-pick"]') as HTMLInputElement).click()
    await settle()
    expect(dom('[data-testid="gjc-confirm"]')?.textContent).toContain('加入（1 个源）')
    ;(dom('[data-testid="gjc-confirm"]') as HTMLButtonElement).click()
    await settle()
    expect(save).not.toHaveBeenCalled()
    expect(changeMembers).toHaveBeenCalledWith({ sourceIds: ['430024667'], sourceGroupId: '3', expectedSourceGroupId: null })
    wrapper.unmount()
  })

  it('查自有流程失败：报错，不入组', async () => {
    vi.spyOn(workflowBindingApi, 'view').mockRejectedValue(new Error('网络异常'))
    const changeMembers = vi.spyOn(sourceGroupApi, 'changeMembers')
    const wrapper = await submitJoin([SRC_OWN])
    expect(changeMembers).not.toHaveBeenCalled()
    expect(dom('[data-testid="gjc-list"]')).toBeNull()
    wrapper.unmount()
  })

  it('按范围加入目标组：提示不会解除源自己的流程', async () => {
    const wrapper = mountDialog({ hasQueryFilter: true })
    await settle()
    wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', '3')
    await settle()
    expect(dom('[data-testid="asg-range-own-flow-note"]')).toBeTruthy()
    wrapper.unmount()
  })

  it('按筛选范围：无筛选条件时红色警告，二次确认后才带 confirmAll', async () => {
    const changeMembersByRange = vi.spyOn(sourceGroupApi, 'changeMembersByRange').mockResolvedValue({
      total: 120, joined: 100, moved: 15, left: 0, unchanged: 5,
    })
    const wrapper = mountDialog({ hasQueryFilter: false })
    await settle()
    expect(document.body.textContent).toContain('将对全部可见来源调整归属')
    // 选目标组
    const target = wrapper.findComponent({ name: 'ElSelect' })
    target.vm.$emit('update:modelValue', '1')
    await settle()
    const submit = dom('[data-testid="asg-submit"]') as HTMLButtonElement
    submit.click()
    await settle()
    // ElMessageBox 确认（confirmButtonText 指定了「确定调整」）
    const okBtn = [...document.querySelectorAll<HTMLButtonElement>('.el-message-box button')].find((b) => b.textContent?.includes('确定调整'))
    expect(okBtn, '应弹出二次确认').toBeTruthy()
    okBtn!.click()
    await settle()
    expect(changeMembersByRange).toHaveBeenCalledWith(expect.objectContaining({ targetSourceGroupId: '1', confirmAll: true }))
    wrapper.unmount()
  })

  it('按筛选范围：有筛选条件时直接提交（confirmAll 不带）', async () => {
    const changeMembersByRange = vi.spyOn(sourceGroupApi, 'changeMembersByRange').mockResolvedValue({ total: 22, joined: 22, moved: 0, left: 0, unchanged: 0 })
    const wrapper = mountDialog({ hasQueryFilter: true, queryText: '来源组 = 1', query: { sourceGroupId: '1' } })
    await settle()
    expect(document.body.textContent).toContain('来源组 = 1')
    const target = wrapper.findComponent({ name: 'ElSelect' })
    target.vm.$emit('update:modelValue', '3')
    await settle()
    const submit = dom('[data-testid="asg-submit"]') as HTMLButtonElement
    submit.click()
    await settle()
    expect(changeMembersByRange).toHaveBeenCalledWith({ filter: { sourceGroupId: '1' }, targetSourceGroupId: '3' })
    wrapper.unmount()
  })

  it('按筛选范围退出来源组：targetSourceGroupId 传 -1（不是空串，空串会被 query 丢掉）', async () => {
    const changeMembersByRange = vi.spyOn(sourceGroupApi, 'changeMembersByRange').mockResolvedValue({ total: 22, joined: 0, moved: 0, left: 22, unchanged: 0 })
    const wrapper = mountDialog({ hasQueryFilter: true, query: { sourceGroupId: '1' } })
    await settle()
    wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', '__none__')
    await settle()
    ;(dom('[data-testid="asg-submit"]') as HTMLButtonElement).click()
    await settle()
    expect(changeMembersByRange).toHaveBeenCalledWith({ filter: { sourceGroupId: '1' }, targetSourceGroupId: '-1' })
    wrapper.unmount()
  })

  it('连生产时「按筛选范围」置灰，不勾选也不会走 changeMembersByRange', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://115.227.21.133:9999')
    const changeMembersByRange = vi.spyOn(sourceGroupApi, 'changeMembersByRange')
    const wrapper = mountDialog({ hasQueryFilter: true, query: { sourceGroupId: '1' } })
    await settle()
    expect(dom('[data-testid="asg-need-selection"]')).toBeTruthy()
    const rangeRadio = [...document.querySelectorAll<HTMLInputElement>('.asg-mode input[type="radio"]')].find((i) => i.value === 'range')
    expect(rangeRadio?.disabled).toBe(true)
    wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', '3')
    await settle()
    expect((dom('[data-testid="asg-submit"]') as HTMLButtonElement).disabled).toBe(true)
    expect(changeMembersByRange).not.toHaveBeenCalled()
    wrapper.unmount()
    vi.unstubAllEnvs()
  })

  // 10-15「我的视图」目录按 viewCategoryId 查源：changeMembersByRange 不认这个条件，按范围调整会变成不限（无筛选时还带 confirmAll）
  it('我的视图目录范围：「按筛选范围」置灰，不会走 changeMembersByRange', async () => {
    const changeMembersByRange = vi.spyOn(sourceGroupApi, 'changeMembersByRange')
    const wrapper = mountDialog({ rangeBlocked: true, query: { viewCategoryId: '9009400' } })
    await settle()
    const rangeRadio = [...document.querySelectorAll<HTMLInputElement>('.asg-mode input[type="radio"]')].find((i) => i.value === 'range')
    expect(rangeRadio?.disabled).toBe(true)
    wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', '3')
    await settle()
    expect((dom('[data-testid="asg-submit"]') as HTMLButtonElement).disabled).toBe(true)
    expect(changeMembersByRange).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
