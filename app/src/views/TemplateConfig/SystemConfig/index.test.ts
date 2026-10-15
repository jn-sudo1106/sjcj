// @vitest-environment jsdom
// 问数系统配置的 tab 壳（1015）：旧「系统配置」组两个侧栏子页收进页内 tab，
// 这里只测壳本身 —— 有哪几个 tab、默认落哪个、选中哪个渲染哪个组件、URL 怎么同步。
// 各 tab 的内部功能见 ParamConfig / PageConfig 各自的测试。
import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'

// 两个 tab 的真实组件都要打 /api/poc 接口，壳的测试不关心它们内部，换成占位组件。
// vi.mock 会被提到 import 之前执行，工厂里不能引用外部变量，所以逐个写死。
vi.mock('./ParamConfig/index.vue', () => ({ default: { name: 'ParamConfigPage', template: '<div data-testid="stub-param-config">参数设置内容</div>' } }))
vi.mock('./PageConfig/index.vue', () => ({ default: { name: 'PageConfigPage', template: '<div data-testid="stub-page-config">页面配置内容</div>' } }))

async function mountCenter(query: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/system-config', component: { template: '<div />' } }],
  })
  await router.push({ path: '/system-config', query })
  await router.isReady()
  setActivePinia(createPinia())
  const SystemConfig = (await import('./index.vue')).default
  const wrapper = mount(SystemConfig, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

describe('问数系统配置 · tab 壳', () => {
  it('2 个 tab，参数设置在前', async () => {
    const { wrapper } = await mountCenter()
    expect(wrapper.findAll('[data-testid="system-config-tab"]').map((b) => b.text())).toEqual(['参数设置', '页面配置'])
  })

  // 需求红线：默认进来展示参数设置
  it('无 ?tab= 时默认落参数设置', async () => {
    const { wrapper } = await mountCenter()
    expect(wrapper.find('[data-testid="stub-param-config"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="stub-page-config"]').exists()).toBe(false)
  })

  it('URL 带 tab=page-config 时直接落页面配置（深链与刷新）', async () => {
    const { wrapper } = await mountCenter({ tab: 'page-config' })
    expect(wrapper.find('[data-testid="stub-page-config"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="stub-param-config"]').exists()).toBe(false)
  })

  it('点页面配置：切内容并把 tab 写进 URL', async () => {
    const { wrapper, router } = await mountCenter()
    await wrapper.findAll('[data-testid="system-config-tab"]')[1].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ tab: 'page-config' })
    expect(wrapper.find('[data-testid="stub-page-config"]').exists()).toBe(true)
  })

  it('切回默认 tab（参数设置）时不留 tab 参数，/system-config 地址保持干净', async () => {
    const { wrapper, router } = await mountCenter({ tab: 'page-config' })
    await wrapper.findAll('[data-testid="system-config-tab"]')[0].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('非法 tab 回落参数设置并把地址归一，不渲染空白页', async () => {
    const { wrapper, router } = await mountCenter({ tab: '不存在的tab' })
    await flushPromises()
    expect(wrapper.find('[data-testid="stub-param-config"]').exists()).toBe(true)
    expect(router.currentRoute.value.query).toEqual({})
  })
})
