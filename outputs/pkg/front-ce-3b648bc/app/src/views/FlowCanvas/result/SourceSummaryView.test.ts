// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { sourceApi, sourceCheckApi, type Source } from '@/api'
import { useFlowStore } from '@/stores/flow'
import SourceSummaryView from './SourceSummaryView.vue'

const wrappers: ReturnType<typeof shallowMount>[] = []
beforeEach(() => {
  vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({ list: [], total: 0 })
  vi.spyOn(sourceCheckApi, 'paged').mockResolvedValue({ list: [], total: 0 })
})
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.restoreAllMocks() })
async function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const flow = useFlowStore()
  flow.sourceCtx = { sourceId: 'a', siteId: 'platform', siteName: '平台甲', name: '源甲', state: 'C', dataCount: 0 } as Source
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
  await router.push('/canvas?sourceId=a&siteId=platform&view=overview&nodeId=n&tableId=t&tab=config&returnTo=/collect')
  const wrapper = shallowMount(SourceSummaryView, { global: { plugins: [pinia, router] } })
  wrappers.push(wrapper)
  return { wrapper, router, flow }
}
describe('源概览', () => {
  it('按当前源查询，区分零产出与缺失值，快捷入口保留返回上下文并清除节点筛选', async () => {
    const { wrapper, router } = await setup()
    await flushPromises()
    expect(sourceApi.sourceTaskPaged).toHaveBeenCalledWith({ sourceId: 'a', siteId: 'platform', page: 1, size: 5 })
    expect(sourceCheckApi.paged).toHaveBeenCalledWith({ sourceId: 'a', state: 'E', page: 1, size: 5 })
    expect(wrapper.text()).toContain('平台甲')
    expect(wrapper.text()).toContain('我的分组未加入分组')
    expect(wrapper.findAll('.summary-metrics strong').map(el => el.text())).toEqual(['已启用', '0', '0', '0'])
    expect(wrapper.findAll('.summary-links button')).toHaveLength(5)
    await wrapper.findAll('.summary-links button')[1]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ sourceId: 'a', siteId: 'platform', view: 'data', returnTo: '/collect' })
  })
  it('单个接口失败不伪装零记录，也不遮蔽另一接口的正常结果', async () => {
    vi.mocked(sourceApi.sourceTaskPaged).mockRejectedValue(new Error('任务服务不可用'))
    const { wrapper } = await setup()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('任务服务不可用')
    expect(wrapper.findAll('.summary-metrics strong').map(el => el.text())).toEqual(['已启用', '0', '—', '0'])
    expect(wrapper.text()).toContain('暂无异常检查记录')
  })
  it('切换源后忽略旧源迟到的响应', async () => {
    let resolveOld!: (value: Awaited<ReturnType<typeof sourceApi.sourceTaskPaged>>) => void
    vi.mocked(sourceApi.sourceTaskPaged).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    const { wrapper, flow } = await setup()
    flow.sourceCtx = { ...flow.sourceCtx!, sourceId: 'b', name: '源乙', dataCount: undefined }
    await flushPromises()
    resolveOld({ list: [], total: 99 })
    await flushPromises()
    expect(wrapper.text()).toContain('源乙')
    expect(wrapper.findAll('.summary-metrics strong').map(el => el.text())).toEqual(['已启用', '—', '0', '0'])
    expect(sourceApi.sourceTaskPaged).toHaveBeenLastCalledWith({ sourceId: 'b', siteId: 'platform', page: 1, size: 5 })
  })
})
