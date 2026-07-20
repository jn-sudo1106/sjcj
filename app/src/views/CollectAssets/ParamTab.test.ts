// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import ParamTab from './ParamTab.vue'
import { useAuthStore } from '../../stores/auth'

// D3（0717 参数方案）：read 角色隐藏参数页写操作，直接置 auth store state 模拟角色，不经登录接口
describe('ParamTab 角色权限', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  function mountTab() {
    wrapper = mount(ParamTab, { global: { plugins: [ElementPlus] } })
    return wrapper
  }

  // mock 适配层用真实 setTimeout 模拟延迟（client.ts delay(120)），flushPromises 不够，需真等待
  async function waitForLoad() {
    await flushPromises()
    await new Promise((r) => setTimeout(r, 200))
    await flushPromises()
  }

  it('admin 角色可见新建/编辑/复制/批量操作', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    mountTab()
    await waitForLoad()

    expect(wrapper.text()).toContain('新建参数')
    expect(wrapper.text()).toContain('清除缓存')
    expect(wrapper.text()).toContain('批量删除')
    expect(wrapper.find('th input[type="checkbox"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('编辑')
    expect(wrapper.text()).toContain('复制')
  })

  it('read 角色隐藏写操作，仅保留详情', async () => {
    const auth = useAuthStore()
    auth.roles = ['read']
    mountTab()
    await waitForLoad()

    expect(wrapper.text()).not.toContain('新建参数')
    expect(wrapper.text()).not.toContain('清除缓存')
    expect(wrapper.text()).not.toContain('批量删除')
    expect(wrapper.find('th input[type="checkbox"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('编辑')
    expect(wrapper.text()).not.toContain('复制')
    expect(wrapper.text()).toContain('详情')
  })
})
