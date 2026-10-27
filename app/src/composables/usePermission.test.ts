// 菜单权限口子（0924-02）。canAccess 现在恒放行；这里把它 mock 成"拒绝 settings"，
// 锁住三处调用方（侧栏、路由守卫、系统设置页内 tab）确实都在问它——将来接入人员权限时只改 canAccess。
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import { TABS } from '@/router/tabs'
import { ACCESS_TOKEN_KEY } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'

const denied = new Set<string>()
vi.mock('./usePermission', () => ({
  canAccess: (p?: string) => !p || !denied.has(p),
}))

beforeEach(() => denied.clear())

describe('canAccess 默认实现', () => {
  it('当前恒放行（人员菜单权限尚未设计）', async () => {
    const real = await vi.importActual<typeof import('./usePermission')>('./usePermission')
    expect(real.canAccess()).toBe(true)
    expect(real.canAccess('settings')).toBe(true)
    expect(real.canAccess('settings:nodeType')).toBe(true)
  })
})

describe('菜单权限接线', () => {
  it('系统设置声明了权限码 settings，且路由 meta 同值', async () => {
    expect(TABS.find((t) => t.key === 'settings')?.permission).toBe('settings')
    const { router } = await import('@/router')
    const shell = router.options.routes.find((r) => r.path === '/')
    expect(shell?.children?.find((r) => r.path === '/settings')?.meta?.permission).toBe('settings')
  })

  it('侧栏：无权限的入口不渲染', async () => {
    denied.add('settings')
    const AppSidebar = (await import('@/layouts/AppSidebar.vue')).default
    const router = createRouter({ history: createMemoryHistory(), routes: TABS.map((t) => ({ path: t.path, component: { template: '<div />' } })) })
    await router.push('/overview')
    await router.isReady()
    setActivePinia(createPinia())
    const wrapper = mount(AppSidebar, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()
    const labels = wrapper.findAll('.rc-nav-item').map((n) => n.text())
    expect(labels).not.toContain('系统设置')
    expect(wrapper.findAll('.rc-nav-title').map((n) => n.text())).not.toContain('系统设置')
  })

  it('路由守卫：已登录但无权限，直达地址也回总览', async () => {
    denied.add('settings')
    localStorage.setItem(ACCESS_TOKEN_KEY, JSON.stringify({ value: 'tok', expire: Date.now() + 1000_000 }))
    setActivePinia(createPinia())
    useAuthStore().roles = ['admin']
    const { authGuard } = await import('@/router')
    expect(await authGuard({ meta: { permission: 'settings' }, path: '/settings', fullPath: '/settings' })).toBe('/overview')
    denied.clear()
    expect(await authGuard({ meta: { permission: 'settings' }, path: '/settings', fullPath: '/settings' })).toBe(true)
  })

  it('系统设置页内 tab：无权限的 tab 不显示，地址指向它时回落到可见的第一个', async () => {
    denied.add('settings:nodeType')
    const Settings = (await import('@/views/Settings/index.vue')).default
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings', component: { template: '<div />' } }] })
    await router.push({ path: '/settings', query: { tab: 'node-type' } })
    await router.isReady()
    const wrapper = mount(Settings, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()
    expect(wrapper.findAll('.st-tab-link').map((b) => b.text())).toEqual(['分类目录', '服务器', '处理机', '代码仓库', '部署配置', '机器配置', '运行日志', 'Runner 版本', '数据权限设置', '用户管理'])
    expect(wrapper.find('[data-testid="settings-category"]').exists()).toBe(true)
    expect(router.currentRoute.value.query).toEqual({})
  })
})
