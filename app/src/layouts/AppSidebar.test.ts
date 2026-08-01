// AppSidebar 单元测试（补 P2-2 AppShell 拆分遗留的测试缺口 · 之前完全零覆盖）
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
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

async function mountAt(path: string) {
  const router = makeRouter()
  await router.push(path)
  await router.isReady()
  const wrapper = mount(AppSidebar, { global: { plugins: [router, ElementPlus] } })
  await flushPromises()
  return { wrapper, router }
}

describe('AppSidebar', () => {
  it('按 TABS 的 group 分组渲染导航（home/assets/ops/tools 等分组标题）', async () => {
    const { wrapper } = await mountAt('/overview')
    const groupTitles = wrapper.findAll('.rc-nav-title').map((n) => n.text())
    expect(groupTitles).toContain('首页')
    expect(groupTitles).toContain('资产管理')
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
    expect(active[0].text()).toContain('采集资产')
  })

  it('点击某个导航项会跳转到对应路径', async () => {
    const { wrapper, router } = await mountAt('/overview')
    const rulesItem = wrapper.findAll('.rc-nav-item').find((i) => i.text().includes('规则资产'))!
    await rulesItem.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/rules')
  })
})
