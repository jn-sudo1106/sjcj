// @vitest-environment jsdom
// 指定流程运行一次弹窗（1008-04，⑥）：逐源 sourceFlowIds 取生效流程 → 与流程候选求交集 →
// 只对关联了所选流程的源 sendSnatchWithParam 带 flowId 分批提交 → 跳过 / 失败逐条展示。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import RunOnceDialog from './RunOnceDialog.vue'
import { sourceApi, sourceGroupApi, type FlowRecord } from '@/api'

const FLOWS = [
  { id: '21000005', name: 'twitter增量', state: 'A' },
  { id: '21000006', name: 'twitter补数据', state: 'A' },
] as unknown as FlowRecord[]

async function settle() {
  await flushPromises()
  await new Promise((r) => setTimeout(r, 60))
}
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })
const dom = (sel: string) => document.querySelector(sel) as HTMLElement | null

describe('指定流程运行一次弹窗', () => {
  it('sourceFlowIds 取生效流程并集，与候选求交集后可选；提交带 flowId', async () => {
    // 勾选两个源：一个生效流程并集（含一个不在候选里的停用流程）
    vi.spyOn(sourceGroupApi, 'sourceFlowIds').mockResolvedValue(['21000006', '99999999'])
    const send = vi.spyOn(sourceApi, 'sendSnatchWithParam').mockResolvedValue({ ok: true, message: '操作成功' })
    const wrapper = mount(RunOnceDialog, { props: { sourceIds: ['391000500', '430024667'], flows: FLOWS }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    await settle()
    // 只剩 21000006 可选（99999999 不在候选被滤掉）
    const options = [...document.querySelectorAll('.el-select-dropdown__item')]
    expect(options.some((o) => o.textContent?.includes('21000006'))).toBe(true)
    const select = wrapper.findComponent({ name: 'ElSelect' })
    select.vm.$emit('update:modelValue', '21000006')
    await settle()
    const submit = dom('[data-testid="ro-submit"]') as HTMLButtonElement
    submit.click()
    await settle()
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ ids: ['391000500', '430024667'], flowId: '21000006' }))
    expect(wrapper.emitted('close')).toBeFalsy() // 提交后不自动关，展示结果
    wrapper.unmount()
  })

  it('只对关联了所选流程的源下发，没关联的跳过并列出', async () => {
    // 391000500 关联 21000005、21000006；430024667 只关联 21000006
    vi.spyOn(sourceGroupApi, 'sourceFlowIds').mockImplementation(async (ids) =>
      ids[0] === '391000500' ? ['21000005', '21000006'] : ['21000006'])
    const send = vi.spyOn(sourceApi, 'sendSnatchWithParam').mockResolvedValue({ ok: true, message: '操作成功' })
    const wrapper = mount(RunOnceDialog, { props: { sourceIds: ['391000500', '430024667'], flows: FLOWS }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    await settle()
    const options = [...document.querySelectorAll('.el-select-dropdown__item')].map((o) => o.textContent ?? '')
    expect(options.some((t) => t.includes('21000005') && t.includes('1/2 个源'))).toBe(true)
    wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', '21000005')
    await settle()
    ;(dom('[data-testid="ro-submit"]') as HTMLButtonElement).click()
    await settle()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ ids: ['391000500'], flowId: '21000005' }))
    expect(dom('[data-testid="ro-skipped"]')?.textContent).toContain('430024667')
    wrapper.unmount()
  })

  it('勾选源没有生效流程：提示不弹选择', async () => {
    vi.spyOn(sourceGroupApi, 'sourceFlowIds').mockResolvedValue([])
    const wrapper = mount(RunOnceDialog, { props: { sourceIds: ['430024667'], flows: FLOWS }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    await settle()
    expect(document.body.textContent).toContain('没有生效的流程')
    expect(dom('[data-testid="ro-submit"]')).toBeNull()
    wrapper.unmount()
  })

  it('失败源逐条展示（failedDetails）', async () => {
    vi.spyOn(sourceGroupApi, 'sourceFlowIds').mockResolvedValue(['21000006'])
    const send = vi.spyOn(sourceApi, 'sendSnatchWithParam')
      .mockRejectedValueOnce(new Error('该源已停用'))
    const wrapper = mount(RunOnceDialog, { props: { sourceIds: ['391000500', '430024667'], flows: FLOWS }, global: { plugins: [ElementPlus] }, attachTo: document.body })
    await settle()
    const select = wrapper.findComponent({ name: 'ElSelect' })
    select.vm.$emit('update:modelValue', '21000006')
    await settle()
    const submit = dom('[data-testid="ro-submit"]') as HTMLButtonElement
    submit.click()
    await settle()
    expect(send).toHaveBeenCalled()
    expect(document.body.textContent).toContain('未发出')
    wrapper.unmount()
  })
})
