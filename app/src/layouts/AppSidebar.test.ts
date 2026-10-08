// AppSidebar 单元测试（补 P2-2 AppShell 拆分遗留的测试缺口 · 之前完全零覆盖）
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import AppSidebar from './AppSidebar.vue'
import { TABS } from '@/router/tabs'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: TABS.map((t) => ({ path: t.path, component: { template: '<div />' } })).concat([
      { path: '/canvas', component: { template: '<div />' } },
    ]),
  })
}

async function mountAt(path: string, query?: Record<string, string>) {
  const router = makeRouter()
  await router.push({ path, query })
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(AppSidebar, { global: { plugins: [pinia, router, ElementPlus] } })
  await flushPromises()
  return { wrapper, router }
}

describe('AppSidebar', () => {
  it('按 TABS 的 group 分组渲染导航（首页/资产管理/数据与运行/运维监控）', async () => {
    const { wrapper } = await mountAt('/overview')
    const groupTitles = wrapper.findAll('.rc-nav-title').map((n) => n.text())
    expect(groupTitles).toContain('首页')
    expect(groupTitles).toContain('源工作区')
    expect(groupTitles).toContain('全局数据')
    expect(groupTitles).toContain('流程与规则')
    expect(groupTitles).toContain('运行与监控')
  })

  // navIcons 是按 TAB key 索引的普通对象，漏一个不报错、只渲染成空图标方块。
  // 2026-09-02 把 flow → flows 时就漏了，流程中心图标消失。这条把「每个 tab 都有图标」钉住。
  it('每个 tab 都渲染出图标，没有空的图标位', async () => {
    const { wrapper } = await mountAt('/overview')
    const items = wrapper.findAll('.rc-nav-item')
    expect(items.length).toBe(TABS.length)
    const missing = items
      .filter((item) => !item.find('.rc-nav-icon svg').exists())
      .map((item) => item.text())
    expect(missing).toEqual([])
  })

  it('每个分组只渲染属于该 group 的 tab，不会出现空分组', async () => {
    const { wrapper } = await mountAt('/overview')
    const groups = wrapper.findAll('.rc-nav-group')
    expect(groups.length).toBeGreaterThan(0)
    // 每个分组下至少有一个 nav item，不存在标题渲染了但内容为空的分组
    for (const g of groups) {
      expect(g.findAll('.rc-nav-item').length).toBeGreaterThan(0)
    }
  })

  it('当前路由对应的 tab 项带 active 样式', async () => {
    const { wrapper } = await mountAt('/rules')
    const items = wrapper.findAll('.rc-nav-item')
    const active = items.filter((i) => i.classes('active'))
    expect(active).toHaveLength(1)
    expect(active[0].text()).toContain('规则资产')
  })

  it('/canvas 路径下高亮"采集资产"（画布归属采集资产子页）', async () => {
    const { wrapper } = await mountAt('/canvas')
    const active = wrapper.findAll('.rc-nav-item').filter((i) => i.classes('active'))
    expect(active).toHaveLength(1)
    expect(active[0].text()).toContain('源管理')
  })

  it('点击某个导航项会跳转到对应路径', async () => {
    const { wrapper, router } = await mountAt('/overview')
    const rulesItem = wrapper.findAll('.rc-nav-item').find((i) => i.text().includes('规则资产'))!
    await rulesItem.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/rules')
  })

  it('点「收起侧栏」切换 collapsed 态，按钮文案随之变化', async () => {
    const { wrapper } = await mountAt('/overview')
    const btn = wrapper.find('.rc-collapse')
    expect(wrapper.find('.rc-sidenav').classes()).not.toContain('collapsed')
    expect(btn.text()).toContain('收起侧栏')

    await btn.trigger('click')
    expect(wrapper.find('.rc-sidenav').classes()).toContain('collapsed')
    expect(btn.text()).not.toContain('收起侧栏')

    await btn.trigger('click')
    expect(wrapper.find('.rc-sidenav').classes()).not.toContain('collapsed')
  })

  it('监控中心是正式入口，旧监控路径不再出现在侧栏', async () => {
    const { wrapper } = await mountAt('/monitor')
    const monitor = wrapper.findAll('.rc-nav-item').find((item) => item.text().includes('监控中心'))
    expect(monitor?.classes('active')).toBe(true)
    expect(wrapper.text()).not.toContain('监控工具')
  })
})
