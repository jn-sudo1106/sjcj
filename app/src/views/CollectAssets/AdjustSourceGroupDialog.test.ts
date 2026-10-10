// @vitest-environment jsdom
// 调整来源组弹窗（1008-04，§3.5）：勾选的源按当前归属 changeMembers；按筛选范围 changeMembersByRange
// （无筛选条件时红色警告 + 二次确认 confirmAll）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import AdjustSourceGroupDialog from './AdjustSourceGroupDialog.vue'
import { sourceGroupApi, type Source } from '@/api'

const GROUPS = [
  { sourceGroupId: '3', name: 'twitter1', state: 'ACTIVE' },
  { sourceGroupId: '1', name: '测试组1', state: 'ACTIVE' },
  { sourceGroupId: '9', name: '停用组', state: 'DISABLED' },
]
const SRC_IN_GROUP = { sourceId: '391000500', sourceGroupId: '3' } as Source
const SRC_INDEP = { sourceId: '430024667', sourceGroupId: undefined } as Source

async function settle() {
  await flushPromises()
  await new Promise((r) => setTimeout(r, 60))
}
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })
const dom = (sel: string) => document.querySelector(sel) as HTMLElement | null

function mountDialog(overrides: { selectedSources?: Source[]; hasQueryFilter?: boolean; queryText?: string; query?: Record<string, unknown> } = {}) {
  return mount(AdjustSourceGroupDialog, {
    props: {
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

  it('勾选的源未归组：expected=null 加入目标组', async () => {
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
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
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
})
