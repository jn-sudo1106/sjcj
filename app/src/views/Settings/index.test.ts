// 系统设置 tab 壳（0924-02）
// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import Settings from './index.vue'
import { useAuthStore } from '@/stores/auth'


async function mountAt(query: Record<string, string> = {}, roles: string[] = []) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings', component: { template: '<div />' } }, { path: '/collect', component: { template: '<div />' } }, { path: '/user-permission', component: { template: '<div />' } }] })
  await router.push({ path: '/settings', query })
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  // 用户管理 tab 只对 admin 可见（1027 决策），其余 tab 的可见性不看角色
  useAuthStore().roles = roles
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
  it('系统设置只剩机器与目录类 tab（来源组已迁回源管理，人与权限类已迁到用户权限设置）', async () => {
    const { wrapper } = await mountAt()

    expect(wrapper.findAll('.st-tab-link').map((b) => b.text())).toEqual(['节点类型', '分类目录', '大模型接口', '代码生成服务器', '服务器', '处理机', '代码仓库', '部署配置', '机器配置', '运行日志', 'Runner 版本'])
    expect(wrapper.find('.st-tab-link.active').text()).toBe('节点类型')
    expect(wrapper.find('[data-testid="settings-node-type"]').exists()).toBe(true)
  })

  // 2026-10-13：来源组迁回源管理「我的分组」，旧书签跳过去并带上选中的组
  it('?tab=source-group 跳到源管理「我的分组」', async () => {
    const { router } = await mountAt({ tab: 'source-group', group: '3' })
    expect(router.currentRoute.value.path).toBe('/collect')
    expect(router.currentRoute.value.query).toEqual({ tab: 'personal', group: '3' })
  })

  it('部署构建同样展示全部设置入口，直达服务器页签不回落', async () => {
    vi.stubEnv('DEV', false)
    const { wrapper, router } = await mountAt({ tab: 'runners' })
    expect(wrapper.findAll('.st-tab-link').map((b) => b.text())).toEqual(['节点类型', '分类目录', '大模型接口', '代码生成服务器', '服务器', '处理机', '代码仓库', '部署配置', '机器配置', '运行日志', 'Runner 版本'])
    expect(wrapper.find('.st-tab-link.active').text()).toBe('服务器')
    expect(router.currentRoute.value.query).toEqual({ tab: 'runners' })
  })

  // 1030：数据权限设置 / 用户管理整体迁到侧栏「用户权限设置」页，本页不再渲染这两个 tab，
  // 旧书签跳到新菜单并显式带上对应 tab（新页的默认是用户管理，不猜它、也不省略参数）。
  it('?tab=data-permission 跳到用户权限设置的数据权限 tab', async () => {
    const { router } = await mountAt({ tab: 'data-permission' })
    expect(router.currentRoute.value.path).toBe('/user-permission')
    expect(router.currentRoute.value.query).toEqual({ tab: 'data-permission' })
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

  // 1027：admin 是唯一的系统超管，账号维护只对他开放（后端 /api/v1/sys-user/** 同样只认 roles[admin]）。
  // 1030：这一页整体搬到侧栏「用户权限设置」，可见性口径随页迁到 UserPermission/index.test.ts；
  // 本页只负责把旧书签跳过去，read 账号也一样跳（新页会把看不到的 tab 归一到默认 tab）。
  it('?tab=users 跳到用户权限设置的用户管理 tab，不看角色', async () => {
    const { router } = await mountAt({ tab: 'users' }, ['read'])
    expect(router.currentRoute.value.path).toBe('/user-permission')
    expect(router.currentRoute.value.query).toEqual({ tab: 'users' })
  })
})
