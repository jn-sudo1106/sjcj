// AppShell 组合冒烟测试（补 P2-2 拆分遗留的测试缺口 · 之前完全零覆盖）
// AppShell.vue 本身在拆分后只剩纯组合（无逻辑），业务逻辑测试见 AppTopBar/AppSidebar/AppModuleHead.test.ts；
// 本文件只验证 3 个子组件 + router-view 能正确拼装挂载，不重复测子组件内部行为。
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import AppShell from './AppShell.vue'

async function mountShell() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/overview', component: { template: '<div class="page-stub">页面内容</div>' } }],
  })
  await router.push('/overview')
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(AppShell, { global: { plugins: [pinia, router, ElementPlus] } })
  await flushPromises()
  return wrapper
}

describe('AppShell', () => {
  it('拼装 TopBar / Sidebar / ModuleHead 三个子组件 + router-view', async () => {
    const wrapper = await mountShell()
    expect(wrapper.findComponent({ name: 'AppTopBar' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'AppSidebar' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'AppModuleHead' }).exists()).toBe(true)
  })

  it('router-view 渲染当前路由对应的页面内容', async () => {
    const wrapper = await mountShell()
    expect(wrapper.find('.page-stub').text()).toBe('页面内容')
  })
})
