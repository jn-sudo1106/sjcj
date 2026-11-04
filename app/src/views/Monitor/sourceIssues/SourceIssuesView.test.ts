// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElSelect } from 'element-plus'
import SourceIssuesView from './SourceIssuesView.vue'
import { sourceIssueApi, type SourceIssue } from '@/api/sourceIssues'

const issue: SourceIssue = { id: 'i1', sourceId: 's1', sourceName: '测试源', siteId: 'site1', description: '更新缺失', state: 0, createdBy: 'admin', createTime: '2026-11-03 09:00:00' }
let wrapper: VueWrapper
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function render(query: Record<string, string> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/monitor', component: { template: '<div />' } }, { path: '/canvas', component: { template: '<div />' } }] })
  await router.push({ path: '/monitor', query: { tab: 'sourceIssues', ...query } })
  wrapper = mount(SourceIssuesView, { global: { plugins: [router, ElementPlus] } })
  await flushPromises()
  return router
}

describe('源问题查询与跳转', () => {
  it('下拉状态与关键词查询，刷新沿用已查询条件和分页，不读取未提交表单', async () => {
    const paged = vi.spyOn(sourceIssueApi, 'paged').mockResolvedValue({ list: [issue], total: 60 })
    const router = await render({ issueState: 'all', issueKeyword: '原条件', issuePage: '2', issueSize: '20' })
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, keyword: '原条件', state: undefined }))
    await wrapper.get('[data-testid="source-issues-keyword"]').setValue('新条件')
    await wrapper.get('[data-testid="source-issues-refresh"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, keyword: '原条件' }))
    wrapper.findComponent(ElSelect).vm.$emit('update:modelValue', 1)
    await wrapper.get('[data-testid="source-issues-search"]').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.query.issuePage).toBe('1')
    expect(router.currentRoute.value.query.issueState).toBe('1')
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, keyword: '新条件', state: 1 }))
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
  })

  it('登记日期按后端 createTime 口径查询：结束日传次日、按 < 排他', async () => {
    const paged = vi.spyOn(sourceIssueApi, 'paged').mockResolvedValue({ list: [issue], total: 1 })
    await render({ issueState: '0', issueTimeStart: '2026-11-01', issueTimeEnd: '2026-11-03' })
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ state: 0, createTimeStart: '2026-11-01', createTimeEnd: '2026-11-04' }))
  })

  it('直达源时携带完整返回地址，保留问题状态、时间和页码', async () => {
    vi.spyOn(sourceIssueApi, 'paged').mockResolvedValue({ list: [issue], total: 60 })
    const router = await render({ issueState: '0', issueTimeStart: '2026-11-01', issueTimeEnd: '2026-11-03', issuePage: '2' })
    const back = router.currentRoute.value.fullPath
    await wrapper.get('[data-testid="source-issue-source-i1"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/canvas')
    expect(router.currentRoute.value.query).toMatchObject({ sourceId: 's1', siteId: 'site1', view: 'overview', sourceIssueReturn: back })
  })

  it('查询失败明确显示错误，可重试，不把失败作为无问题', async () => {
    const paged = vi.spyOn(sourceIssueApi, 'paged').mockRejectedValueOnce(new Error('网络异常')).mockResolvedValue({ list: [issue], total: 1 })
    await render()
    expect(wrapper.get('[data-testid="source-issues-error"]').text()).toContain('网络异常')
    await wrapper.get('[data-testid="source-issues-refresh"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="source-issues-error"]').exists()).toBe(false)
    expect(paged).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('更新缺失')
  })

  it('旧查询晚返回不覆盖新状态的查询结果', async () => {
    let resolveOld!: (value: { list: SourceIssue[]; total: number }) => void
    vi.spyOn(sourceIssueApi, 'paged').mockReturnValueOnce(new Promise(done => { resolveOld = done })).mockResolvedValue({ list: [{ ...issue, description: '新的已处理问题', state: 1 }], total: 1 })
    const router = await render()
    await router.replace({ path: '/monitor', query: { tab: 'sourceIssues', issueState: '1' } })
    await flushPromises()
    resolveOld({ list: [issue], total: 1 })
    await flushPromises()
    expect(wrapper.text()).toContain('新的已处理问题')
    expect(wrapper.text()).not.toContain('更新缺失')
  })
})
