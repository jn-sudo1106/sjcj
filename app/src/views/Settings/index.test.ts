// 系统设置 tab 壳（0924-02）
// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import Settings from './index.vue'

async function mountAt(query: Record<string, string> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings', component: { template: '<div />' } }] })
  await router.push({ path: '/settings', query })
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(Settings, { global: { plugins: [pinia, router, ElementPlus] } })
  await flushPromises()
  return { wrapper, router }
}

describe('系统设置 · tab 壳', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('系统设置保留节点类型和分类目录，并增加 Runner 管理入口', async () => {
    const { wrapper } = await mountAt()
    expect(wrapper.findAll('.st-tab-link').map((b) => b.text())).toEqual(['节点类型', '分类目录', 'Runner 实例', '队列分配', '节点代码', '代码仓库', '下发目录', '发布版本'])
    expect(wrapper.find('.st-tab-link.active').text()).toBe('节点类型')
    expect(wrapper.find('[data-testid="settings-node-type"]').exists()).toBe(true)
  })

  it('部署构建没有 Runner 管理服务：只留节点类型和分类目录，直达 Runner tab 回落到节点类型', async () => {
    vi.stubEnv('DEV', false)
    const { wrapper, router } = await mountAt({ tab: 'runners' })
    expect(wrapper.findAll('.st-tab-link').map((b) => b.text())).toEqual(['节点类型', '分类目录'])
    expect(wrapper.find('.st-tab-link.active').text()).toBe('节点类型')
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('?tab=category 直达分类目录；点回节点类型地址去掉 tab 参数', async () => {
    const { wrapper, router } = await mountAt({ tab: 'category' })
    expect(wrapper.find('.st-tab-link.active').text()).toBe('分类目录')
    expect(wrapper.find('[data-testid="settings-category"]').exists()).toBe(true)

    await wrapper.findAll('.st-tab-link')[0]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({})
    expect(wrapper.find('[data-testid="settings-node-type"]').exists()).toBe(true)
  })

  it('非法 tab 回落到节点类型，地址也归一', async () => {
    const { wrapper, router } = await mountAt({ tab: '不存在' })
    expect(wrapper.find('.st-tab-link.active').text()).toBe('节点类型')
    expect(router.currentRoute.value.query).toEqual({})
  })
})
