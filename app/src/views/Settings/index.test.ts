// 系统设置 tab 壳（0924-02）
// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import Settings from './index.vue'

// 来源组 tab 组件会拉 source-group API，这里只测 tab 壳，stub 掉
vi.mock('./SourceGroupTab.vue', () => ({ default: { name: 'SourceGroupTab', template: '<div data-testid="settings-source-group">来源组内容</div>' } }))

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

  it('旧节点代码书签跳转到统一机器配置，保留筛选上下文', async () => {
    const { wrapper, router } = await mountAt({ tab: 'site-code', configId: '123' })
    expect(wrapper.findAll('.st-tab-link').map(button => button.text())).not.toContain('节点代码')
    expect(wrapper.find('.st-tab-link.active').text()).toBe('机器配置')
    expect(router.currentRoute.value.query).toEqual({ tab: 'assignments', configId: '123' })
    expect(wrapper.find('[data-testid="settings-runtime-bindings"]').exists()).toBe(true)
    wrapper.unmount()
  })
  it('系统设置保留节点类型、分类目录、来源组，并增加 Runner 管理入口', async () => {
    const { wrapper } = await mountAt()
    expect(wrapper.findAll('.st-tab-link').map((b) => b.text())).toEqual(['节点类型', '分类目录', '运行机器', '处理机', '代码仓库', '部署配置', '机器配置', '运行日志', 'Runner 版本', '来源组'])
    expect(wrapper.find('.st-tab-link.active').text()).toBe('节点类型')
    expect(wrapper.find('[data-testid="settings-node-type"]').exists()).toBe(true)
  })

  // 2026-10-12：内网合并 a27a2c4 时这两条连同来源组 tab 一起丢了，补回
  it('?tab=source-group 直达来源组（1008-03 移入系统设置）', async () => {
    const { wrapper } = await mountAt({ tab: 'source-group' })
    expect(wrapper.find('.st-tab-link.active').text()).toBe('来源组')
    expect(wrapper.find('[data-testid="settings-source-group"]').exists()).toBe(true)
  })

  it('部署构建没有 Runner 管理服务：只留节点类型、分类目录、来源组，直达 Runner tab 回落到节点类型', async () => {
    vi.stubEnv('DEV', false)
    const { wrapper, router } = await mountAt({ tab: 'runners' })
    expect(wrapper.findAll('.st-tab-link').map((b) => b.text())).toEqual(['节点类型', '分类目录', '来源组'])
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
