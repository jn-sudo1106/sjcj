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
    // 问数配置（1015 前身为 1013 的「模板配置」组）：与运行与监控、系统设置同级，
    // 排在运行与监控之后、系统设置之前；组下只剩「模板配置」一个入口，8 个子模块在页内以 tab 呈现
    expect(groupTitles).toContain('问数配置')
    expect(groupTitles.indexOf('运行与监控')).toBeLessThan(groupTitles.indexOf('问数配置'))
    expect(groupTitles.indexOf('问数配置')).toBeLessThan(groupTitles.indexOf('系统设置'))
    // 辅助工具（1020）独立成组，位置钉在「问数配置」之后、「系统设置」之前；系统设置仍是最后一组
    expect(groupTitles).toContain('辅助工具')
    expect(groupTitles.indexOf('问数配置')).toBeLessThan(groupTitles.indexOf('辅助工具'))
    expect(groupTitles.indexOf('辅助工具')).toBeLessThan(groupTitles.indexOf('系统设置'))
    expect(groupTitles.indexOf('系统设置')).toBe(groupTitles.length - 1)
  })

  it('问数配置组有「基础配置 + 模板配置 + 问数系统配置」三个入口，原 8 个模板子项不再出现在侧栏', async () => {
    const { wrapper } = await mountAt('/template-config')
    const group = wrapper.findAll('.rc-nav-group').find((g) => g.find('.rc-nav-title').text() === '问数配置')!
    // 1015 迁入旧「系统配置」域后组下有「问数系统配置」；同日迁入旧「基础配置」组，「基础配置」排在模板配置之前
    // 1020 的「辅助工具」是独立分组，不在这里
    expect(group.findAll('.rc-nav-item').map((i) => i.text())).toEqual(['基础配置', '模板配置', '问数系统配置'])
    const active = wrapper.findAll('.rc-nav-item').filter((i) => i.classes('active'))
    expect(active).toHaveLength(1)
    expect(active[0].text()).toContain('模板配置')
    for (const label of ['SQL模板配置', '表模板配置', '自动补全配置', '问句改写配置', '数据索引同步', '数据字典配置', '提示词配置', '分词配置']) {
      expect(wrapper.text()).not.toContain(label)
    }
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

  // 辅助工具（1020）：独立成一个分组（组标题「辅助工具」），不是塞在运行与监控/问数配置里。
  // 高亮靠 useActiveNavKey 用路径段查 TABS，key 与路径段对不上就会静默高亮成采集资产总览。
  it('辅助工具独立成组，/auxiliary-tool 下高亮自身', async () => {
    const { wrapper } = await mountAt('/auxiliary-tool')
    const group = wrapper.findAll('.rc-nav-group').find((g) => g.find('.rc-nav-title').text() === '辅助工具')!
    expect(group.findAll('.rc-nav-item').map((i) => i.text())).toEqual(['辅助工具'])

    // 不许再出现在这两个组里（挪回去就会让「辅助工具」组变空而从侧栏消失）
    for (const label of ['运行与监控', '问数配置']) {
      const other = wrapper.findAll('.rc-nav-group').find((g) => g.find('.rc-nav-title').text() === label)!
      expect(other.findAll('.rc-nav-item').map((i) => i.text())).not.toContain('辅助工具')
    }

    const active = wrapper.findAll('.rc-nav-item').filter((i) => i.classes('active'))
    expect(active).toHaveLength(1)
    expect(active[0].text()).toContain('辅助工具')
  })

  // 用户权限设置（1030）：系统设置组下的第二个二级入口（原系统设置页内两个 tab 迁出）。
  // /user-permission 的导航是平铺路径、侧栏才分组，所以按路径段查 TABS 必须命中自己，
  // 否则会静默回退高亮成「采集资产总览」。
  it('系统设置组有「系统设置 + 用户权限设置」两个入口，/user-permission 下高亮后者', async () => {
    const { wrapper } = await mountAt('/user-permission')
    const group = wrapper.findAll('.rc-nav-group').find((g) => g.find('.rc-nav-title').text() === '系统设置')!
    expect(group.findAll('.rc-nav-item').map((i) => i.text())).toEqual(['系统设置', '用户权限设置'])

    const active = wrapper.findAll('.rc-nav-item').filter((i) => i.classes('active'))
    expect(active).toHaveLength(1)
    expect(active[0].text()).toContain('用户权限设置')
  })
})
