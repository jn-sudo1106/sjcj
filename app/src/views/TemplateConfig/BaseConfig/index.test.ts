// @vitest-environment jsdom
// 基础配置的 tab 壳（1015 迁入旧「基础配置」组）：与模板配置 / 问数系统配置同口径，
// 这里只测壳本身 —— 有哪几个 tab、默认落哪个、选中哪个渲染哪个组件、URL 怎么同步。
// 表字段管理、向量表数据浏览的内部功能见各自目录下的测试。
import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'

// 真实 tab 组件要打 /api/poc 接口，壳的测试不关心它内部，换成占位组件。
vi.mock('./EntityConfig/index.vue', () => ({ default: { name: 'EntityConfigPage', template: '<div data-testid="stub-entity-config">表字段管理内容</div>' } }))
vi.mock('./VectorDataShow/index.vue', () => ({ default: { name: 'VectorDataShowPage', template: '<div data-testid="stub-vector-data">向量表数据浏览内容</div>' } }))

async function mountCenter(query: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/base-config', component: { template: '<div />' } }],
  })
  await router.push({ path: '/base-config', query })
  await router.isReady()
  setActivePinia(createPinia())
  const BaseConfig = (await import('./index.vue')).default
  const wrapper = mount(BaseConfig, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

describe('基础配置 · tab 壳', () => {
  it('2 个 tab：表字段管理、向量表数据浏览', async () => {
    const { wrapper } = await mountCenter()
    expect(wrapper.findAll('[data-testid="base-config-tab"]').map((b) => b.text())).toEqual(['表字段管理', '向量表数据浏览'])
  })

  it('无 ?tab= 时默认落表字段管理', async () => {
    const { wrapper } = await mountCenter()
    expect(wrapper.find('[data-testid="stub-entity-config"]').exists()).toBe(true)
  })

  it('URL 带 tab=entity-config 时直接落表字段管理（深链与刷新）', async () => {
    const { wrapper } = await mountCenter({ tab: 'entity-config' })
    expect(wrapper.find('[data-testid="stub-entity-config"]').exists()).toBe(true)
  })

  it('URL 带 tab=vector-data 时直接落向量表数据浏览（深链与刷新）', async () => {
    const { wrapper } = await mountCenter({ tab: 'vector-data' })
    expect(wrapper.find('[data-testid="stub-vector-data"]').exists()).toBe(true)
  })

  it('点默认 tab（表字段管理）不留 tab 参数，/base-config 地址保持干净', async () => {
    const { wrapper, router } = await mountCenter()
    await wrapper.findAll('[data-testid="base-config-tab"]')[0]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('点向量表数据浏览：?tab=vector-data 进地址，内容跟着切换', async () => {
    const { wrapper, router } = await mountCenter()
    await wrapper.findAll('[data-testid="base-config-tab"]')[1]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ tab: 'vector-data' })
    expect(wrapper.find('[data-testid="stub-vector-data"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="stub-entity-config"]').exists()).toBe(false)
  })

  it('非法 tab 回落表字段管理并把地址归一，不渲染空白页', async () => {
    const { wrapper, router } = await mountCenter({ tab: '不存在的tab' })
    await flushPromises()
    expect(wrapper.find('[data-testid="stub-entity-config"]').exists()).toBe(true)
    expect(router.currentRoute.value.query).toEqual({})
  })
})
