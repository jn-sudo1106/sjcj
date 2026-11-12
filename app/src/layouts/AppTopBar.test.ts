// AppTopBar 单元测试（补 P2-2 AppShell 拆分遗留的测试缺口 · 之前完全零覆盖）
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import type { Component } from 'vue'
import AppTopBar from './AppTopBar.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return { ...actual, ElMessageBox: { confirm: vi.fn() } }
})

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/overview', component: { template: '<div />' } },
      { path: '/user/login', component: { template: '<div />' } },
      // 全宽个人页：AppTopBar 以 meta.layout='fullwidth' 或 path='/workbench' 识别（path 兜底动态路由覆盖 meta）
      { path: '/workbench', component: { template: '<div />' } },
      { path: '/workbench-meta', component: { template: '<div />' }, meta: { layout: 'fullwidth' } },
    ],
  })
}

async function mountTopBar(component: Component = AppTopBar, path = '/overview') {
  const router = makeRouter()
  await router.push(path)
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(component, { global: { plugins: [pinia, router, ElementPlus] } })
  return { wrapper, router }
}

describe('AppTopBar', () => {
  beforeEach(() => {
    vi.mocked(ElMessageBox.confirm).mockReset()
  })

  it('未登录时账号名兜底显示"未登录"', async () => {
    const { wrapper } = await mountTopBar()
    expect(wrapper.find('.rc-user').attributes('aria-label')).toContain('未登录')
  })

  it('已登录时头像标签取账号名前 4 个字符', async () => {
    const { wrapper } = await mountTopBar()
    const auth = useAuthStore()
    auth.name = '一二三四五六'
    await flushPromises()
    expect(wrapper.find('.rc-avatar').text()).toBe('一二三四')
  })

  it('账号下拉选 change-password 时打开修改密码弹窗', async () => {
    const { wrapper } = await mountTopBar()
    const dropdown = wrapper.findComponent({ name: 'ElDropdown' })
    await dropdown.vm.$emit('command', 'change-password')
    await flushPromises()
    const dialog = wrapper.findComponent({ name: 'ChangePasswordDialog' })
    expect(dialog.props('modelValue')).toBe(true)
  })

  it('账号下拉选 logout 时弹二次确认；确认后清会话并跳转登录页', async () => {
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const { wrapper, router } = await mountTopBar()
    const auth = useAuthStore()
    auth.name = '张三'
    auth.token = 'tok-1'

    const dropdown = wrapper.findComponent({ name: 'ElDropdown' })
    await dropdown.vm.$emit('command', 'logout')
    await flushPromises()
    await flushPromises()

    expect(ElMessageBox.confirm).toHaveBeenCalled()
    expect(auth.token).toBe('')
    expect(router.currentRoute.value.path).toBe('/user/login')
  })

  it('取消二次确认时不清会话、不跳转', async () => {
    vi.mocked(ElMessageBox.confirm).mockRejectedValue('cancel' as never)
    const { wrapper, router } = await mountTopBar()
    const auth = useAuthStore()
    auth.name = '张三'
    auth.token = 'tok-1'

    const dropdown = wrapper.findComponent({ name: 'ElDropdown' })
    await dropdown.vm.$emit('command', 'logout')
    await flushPromises()
    await flushPromises()

    expect(auth.token).toBe('tok-1')
    expect(router.currentRoute.value.path).toBe('/overview')
  })
})

// 「我的工作台」入口 + 全宽顶栏（设计稿 68px/34px；真实环境徽标与真实用户名）
describe('AppTopBar 工作台入口与全宽顶栏', () => {
  it('账号菜单第一项是「我的工作台」，选中后跳到 /workbench', async () => {
    const { wrapper, router } = await mountTopBar()
    const items = wrapper.findAllComponents({ name: 'ElDropdownItem' })
    expect(items.length).toBe(3)
    expect(items[0].text()).toContain('我的工作台')

    await wrapper.findComponent({ name: 'ElDropdown' }).vm.$emit('command', 'workbench')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/workbench')
  })

  it.each(['/workbench', '/workbench-meta'])('工作台 %s 复用统一品牌、头像和顶部工作栏', async (path) => {
    const { wrapper } = await mountTopBar(AppTopBar, path)
    const auth = useAuthStore()
    auth.name = '王晓峰'
    await flushPromises()
    expect(wrapper.find('.rc-topbar').classes()).not.toContain('rc-topbar--full')
    expect(wrapper.find('.rc-brand img').exists()).toBe(true)
    expect(wrapper.find('.rc-brand strong').text()).toBe('青龙智能采集中心')
    expect(wrapper.find('.rc-brand-tile').exists()).toBe(false)
    expect(wrapper.find('.rc-brand-crumb').exists()).toBe(false)
    expect(wrapper.find('.rc-avatar').text()).toBe('王晓峰')
    expect(wrapper.findAllComponents({ name: 'ElDropdownItem' })[0].text()).toContain('我的工作台')
  })

  it('标准页顶栏保持原样：无工作台品牌区、无用户名，菜单项仍含「我的工作台」', async () => {
    const { wrapper } = await mountTopBar()
    expect(wrapper.find('.rc-topbar').classes()).not.toContain('rc-topbar--full')
    expect(wrapper.find('.rc-brand-home').exists()).toBe(false)
    expect(wrapper.find('.rc-brand-crumb').exists()).toBe(false)
    expect(wrapper.find('.rc-user-name').exists()).toBe(false)
    expect(wrapper.findAllComponents({ name: 'ElDropdownItem' })[0].text()).toContain('我的工作台')
  })
})

// 生产写守卫（0812 计划 M0-4）配套：连生产时顶栏必须有醒目提示，避免联调误操作。
// isProductionBackend() 在组件 setup 顶层只读一次 import.meta.env，需 resetModules + 动态 import
// 让新的 env 值生效，静态导入的 AppTopBar（上面用例用的那份）不会随 stubEnv 改变。
describe('AppTopBar 生产环境徽标', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('未连生产时不显示写保护徽标，只显示后台环境地址', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    vi.resetModules()
    const { default: FreshAppTopBar } = await import('./AppTopBar.vue')
    const { wrapper } = await mountTopBar(FreshAppTopBar)

    expect(wrapper.find('[data-testid="prod-env-badge"]').exists()).toBe(false)
    const badge = wrapper.find('[data-testid="test-env-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('后台环境 118.25.96.217')
  })

  it('连生产时显示醒目徽标', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://115.227.21.133:9999')
    vi.resetModules()
    const { default: FreshAppTopBar } = await import('./AppTopBar.vue')
    const { wrapper } = await mountTopBar(FreshAppTopBar)

    const badge = wrapper.find('[data-testid="prod-env-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('后台环境 115.227.21.133 · 允许新建，禁止改删')
    expect(wrapper.find('[data-testid="test-env-badge"]').exists()).toBe(false)
  })
})
