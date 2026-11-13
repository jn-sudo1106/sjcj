// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import RegisterSourceIssuesDialog from './RegisterSourceIssuesDialog.vue'
import { sourceIssueApi } from '@/api/sourceIssues'
const sources = [{ sourceId: 'a', sourceName: '源甲' }, { sourceId: 'b', sourceName: '源乙' }]
let wrapper: VueWrapper
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
function render(targets = sources) {
  wrapper = mount(RegisterSourceIssuesDialog, { props: { sources: targets }, global: { plugins: [createPinia(), ElementPlus], stubs: { 'el-dialog': { template: '<div role="dialog"><slot /><slot name="footer" /></div>' } } } })
  return wrapper
}

describe('多源问题登记', () => {
  it('展示所选源，只填描述；空描述拦截，失败保留输入', async () => {
    const create = vi.spyOn(sourceIssueApi, 'create').mockRejectedValue(new Error('登记失败'))
    render()
    expect(wrapper.text()).toContain('已选 2 个源')
    expect(wrapper.text()).toContain('源甲')
    expect(wrapper.findAll('textarea')).toHaveLength(1)
    await wrapper.get('[data-testid="source-issue-register-submit"]').trigger('click')
    expect(create).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('请填写问题描述')
    await wrapper.get('textarea').setValue('  更新缺失  ')
    await wrapper.get('[data-testid="source-issue-register-submit"]').trigger('click')
    await flushPromises()
    expect(create).toHaveBeenCalledWith({ sourceIds: ['a', 'b'], description: '更新缺失' })
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toContain('更新缺失')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('超过 100 个源时显示上限并禁止提交', async () => {
    const create = vi.spyOn(sourceIssueApi, 'create').mockResolvedValue([])
    render(Array.from({ length: 101 }, (_, i) => ({ sourceId: String(i + 1), sourceName: '测试源' })))
    expect(wrapper.get('[role="alert"]').text()).toContain('单次最多登记 100 个源')
    expect((wrapper.get('[data-testid="source-issue-register-submit"]').element as HTMLButtonElement).disabled).toBe(true)
    expect(create).not.toHaveBeenCalled()
  })

  it('提交期间不重复登记或关闭，成功通知调用方并关闭', async () => {
    let resolve!: (records: never[]) => void
    const create = vi.spyOn(sourceIssueApi, 'create').mockReturnValue(new Promise(done => { resolve = done }))
    render()
    await wrapper.get('textarea').setValue('更新缺失')
    await wrapper.get('[data-testid="source-issue-register-submit"]').trigger('click')
    await wrapper.get('[data-testid="source-issue-register-submit"]').trigger('click')
    expect(create).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('close')).toBeUndefined()
    resolve([])
    await flushPromises()
    expect(wrapper.emitted('registered')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
