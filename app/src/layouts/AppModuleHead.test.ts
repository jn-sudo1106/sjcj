// AppModuleHead 单元测试（补 P2-2 AppShell 拆分遗留的测试缺口 · 之前完全零覆盖）
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import AppModuleHead from './AppModuleHead.vue'
import { useFlowStore } from '@/stores/flow'
import { useUiStore } from '@/stores/ui'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/overview', component: { template: '<div />' } },
      { path: '/rules', component: { template: '<div />' } },
      { path: '/canvas', component: { template: '<div />' } },
    ],
  })
}

async function mountAt(path: string, query?: Record<string, string>) {
  const router = makeRouter()
  await router.push({ path, query })
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(AppModuleHead, { global: { plugins: [pinia, router, ElementPlus] } })
  await flushPromises()
  return { wrapper, router }
}

describe('AppModuleHead 面包屑 / 标题', () => {
  it('普通页面：面包屑显示"青龙智能采集中心 / <当前模块>"，无源相关的第三段', async () => {
    const { wrapper } = await mountAt('/overview')
    expect(wrapper.find('.rc-bc').text()).toBe('青龙智能采集中心/采集资产总览')
    expect(wrapper.find('h1').text()).toBe('采集资产总览')
  })

  it('/canvas 路径下多出第三段面包屑（源/网站/新建）', async () => {
    const { wrapper } = await mountAt('/canvas', { mode: 'new' })
    expect(wrapper.find('.rc-bc').text()).toBe('青龙智能采集中心/采集资产/新建采集')
    expect(wrapper.find('h1').text()).toBe('新建采集')
  })

  it('sourceCrumb 优先级：mode=new > siteCtx.name > sourceCtx.name > 默认"源详情"', async () => {
    const { wrapper } = await mountAt('/canvas')
    // 什么都没有时兜底
    expect(wrapper.find('h1').text()).toBe('源详情')

    const flow = useFlowStore()
    flow.loadFromSource({ sourceId: 's1', name: '源A', url: 'x', configId: '', mainTable: '', owner: '', state: 'C' } as never, [])
    await flushPromises()
    expect(wrapper.find('h1').text()).toBe('源A') // 只有 sourceCtx 时用它

    flow.setSiteDisplayCtx({ siteId: 'site1', name: '网站A', category: '', owner: '', sourceCount: 0, errorCount: 0 } as never)
    await flushPromises()
    expect(wrapper.find('h1').text()).toBe('网站A') // siteCtx 同时存在时优先于 sourceCtx（见 0714 会议 Task 3）
  })
})

describe('AppModuleHead 顶部动作按钮', () => {
  it('overview 页渲染 3 个动作，"新建采集" 带 primary 样式', async () => {
    const { wrapper } = await mountAt('/overview')
    const buttons = wrapper.findAll('.rc-action-btn')
    expect(buttons.map((b) => b.text().trim())).toEqual(['刷新', '导出', '新建采集'])
    const primary = buttons.find((b) => b.classes('primary'))
    expect(primary?.text().trim()).toBe('新建采集')
  })

  it('规则资产页 tab=param 时不展示任何动作（参数 tab 不需要规则专属按钮）', async () => {
    const { wrapper } = await mountAt('/rules', { tab: 'param' })
    expect(wrapper.findAll('.rc-action-btn')).toHaveLength(0)
  })

  it('规则资产页非 param tab 时展示规则专属的 3 个动作', async () => {
    const { wrapper } = await mountAt('/rules')
    const buttons = wrapper.findAll('.rc-action-btn').map((b) => b.text().trim())
    expect(buttons).toEqual(['新建规则组', '导入规则', '发布校验'])
  })

  it('点击"新建采集"跳转到 /canvas?mode=new，不走 ui.fireAction', async () => {
    const { wrapper, router } = await mountAt('/overview')
    const ui = useUiStore()
    const fired: string[] = []
    ui.registerAction('新建采集', () => fired.push('新建采集'))

    const btn = wrapper.findAll('.rc-action-btn').find((b) => b.text().trim() === '新建采集')!
    await btn.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/canvas')
    expect(router.currentRoute.value.query).toEqual({ mode: 'new' })
    expect(fired).toHaveLength(0) // 走的是路由跳转，不是 ui.fireAction 回调
  })

  it('点击其他动作按钮委托给 ui.fireAction', async () => {
    const { wrapper } = await mountAt('/overview')
    const ui = useUiStore()
    const fired: string[] = []
    ui.registerAction('刷新', () => fired.push('刷新'))

    const btn = wrapper.findAll('.rc-action-btn').find((b) => b.text().trim() === '刷新')!
    await btn.trigger('click')
    expect(fired).toEqual(['刷新'])
  })
})
