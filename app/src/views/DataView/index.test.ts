// @vitest-environment jsdom
// 数据中心的 tab 壳（2026-09-19）：「表 ID 列表」从采集资产迁过来，这里只测壳本身
// ——选中哪个 tab、渲染哪个组件、URL 怎么同步。两个 tab 的内部功能各自有测试
// （DataQueryTab.test.ts / EntryTab.test.ts）。
import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'

// 两个 tab 的真实组件都很重（要打接口、挂 Element Plus），壳的测试不关心它们内部，
// 换成占位组件，避免把内层的加载时序拖进来。
vi.mock('./DataQueryTab.vue', () => ({
  default: { name: 'DataQueryTab', template: '<div data-testid="stub-query">数据查询内容</div>' },
}))
vi.mock('./EntryTab.vue', () => ({
  default: { name: 'EntryTab', template: '<div data-testid="stub-entry">表 ID 列表内容</div>' },
}))

async function mountCenter(query: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/data', component: { template: '<div />' } },
      { path: '/collect', component: { template: '<div />' } },
    ],
  })
  await router.push({ path: '/data', query })
  await router.isReady()
  setActivePinia(createPinia())
  const DataCenter = (await import('./index.vue')).default
  const wrapper = mount(DataCenter, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

describe('数据中心 · tab 壳', () => {
  it('两个 tab：数据查询、表 ID 列表', async () => {
    const { wrapper } = await mountCenter()
    expect(wrapper.findAll('[data-testid="data-center-tab"]').map((b) => b.text()))
      .toEqual(['数据查询', '表 ID 列表'])
  })

  it('默认落数据查询', async () => {
    const { wrapper } = await mountCenter()
    expect(wrapper.find('[data-testid="stub-query"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="stub-entry"]').exists()).toBe(false)
  })

  it('URL 带 tab=entry 时直接落表 ID 列表（深链与刷新）', async () => {
    const { wrapper } = await mountCenter({ tab: 'entry' })
    expect(wrapper.find('[data-testid="stub-entry"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="stub-query"]').exists()).toBe(false)
  })

  it('点表 ID 列表：切内容并把 tab 写进 URL', async () => {
    const { wrapper, router } = await mountCenter()

    await wrapper.findAll('[data-testid="data-center-tab"]')[1].trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ tab: 'entry' })
    expect(wrapper.find('[data-testid="stub-entry"]').exists()).toBe(true)
  })

  it('切回数据查询时不留 tab 参数，/data 地址保持干净', async () => {
    const { wrapper, router } = await mountCenter({ tab: 'entry' })

    await wrapper.findAll('[data-testid="data-center-tab"]')[0].trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({})
    expect(wrapper.find('[data-testid="stub-query"]').exists()).toBe(true)
  })

  it('非法 tab 回落数据查询，不渲染空白页', async () => {
    const { wrapper } = await mountCenter({ tab: '不存在的tab' })
    expect(wrapper.find('[data-testid="stub-query"]').exists()).toBe(true)
  })
})
