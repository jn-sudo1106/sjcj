// 用户权限设置 tab 壳（1030）：侧栏「系统设置」组下的二级入口，页内两个 tab。
// 默认落「用户管理」（1030 定档：进这一页先看账号），tab 顺序即默认——第一项是无 ?tab= 时落地的那个。
// 可见性口径与原系统设置页一致：数据权限设置走 canAccess，用户管理额外只对 admin 渲染；
// read 账号看不到用户管理，于是他的默认 tab 是数据权限设置。
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import UserPermission from './index.vue'
import { useAuthStore } from '@/stores/auth'

async function mountAt(query: Record<string, string> = {}, roles: string[] = []) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/user-permission', component: { template: '<div />' } }] })
  await router.push({ path: '/user-permission', query })
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  // 用户管理 tab 只对 admin 可见（1027 决策），数据权限设置不看角色
  useAuthStore().roles = roles
  const wrapper = mount(UserPermission, { global: { plugins: [pinia, router, ElementPlus] } })
  await flushPromises()
  return { wrapper, router }
}

describe('用户权限设置 · tab 壳', () => {
  it('admin 会话渲染两个 tab，默认落用户管理且地址不带 tab 参数', async () => {
    const { wrapper, router } = await mountAt({}, ['admin'])
    expect(wrapper.findAll('.up-tab-link').map((b) => b.text())).toEqual(['用户管理', '数据权限设置'])
    expect(wrapper.find('.up-tab-link.active').text()).toBe('用户管理')
    expect(router.currentRoute.value.query).toEqual({})
    expect(wrapper.find('[data-testid="settings-user-management"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('?tab=data-permission 直达数据权限设置', async () => {
    const { wrapper } = await mountAt({ tab: 'data-permission' }, ['admin'])
    expect(wrapper.find('.up-tab-link.active').text()).toBe('数据权限设置')
    expect(wrapper.find('[data-testid="settings-data-permission"]').exists()).toBe(true)
    wrapper.unmount()
  })

  // 后端 /api/v1/sys-user/** 同样只认 roles[admin]，换菜单不放宽
  it('普通 read 账号看不到「用户管理」，落到数据权限设置且地址归一', async () => {
    const { wrapper, router } = await mountAt({ tab: 'users' }, ['read'])
    expect(wrapper.findAll('.up-tab-link').map((b) => b.text())).toEqual(['数据权限设置'])
    expect(wrapper.find('.up-tab-link.active').text()).toBe('数据权限设置')
    expect(router.currentRoute.value.query).toEqual({})
    wrapper.unmount()
  })

  it('非法 tab 回落到用户管理，地址也归一', async () => {
    const { wrapper, router } = await mountAt({ tab: '不存在' }, ['admin'])
    expect(wrapper.find('.up-tab-link.active').text()).toBe('用户管理')
    expect(router.currentRoute.value.query).toEqual({})
    wrapper.unmount()
  })

  it('点「数据权限设置」写入 ?tab=data-permission，点回「用户管理」清掉参数', async () => {
    const { wrapper, router } = await mountAt({}, ['admin'])
    await wrapper.findAll('.up-tab-link')[1]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ tab: 'data-permission' })

    await wrapper.findAll('.up-tab-link')[0]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({})
    expect(wrapper.find('[data-testid="settings-user-management"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
