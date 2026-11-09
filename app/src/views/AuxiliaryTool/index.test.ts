// @vitest-environment jsdom
// 辅助工具容器（6 个页内 tab）：锁住「tab key ↔ 组件映射」这条命门。
//
// 1020 踩过的真实故障：TABS 里的 key 是 'mqList'，comps 里写的是 'MqList'（组件名），
// `comps[activeTab]` 取到 undefined，`<component :is="undefined">` 静默什么都不渲染 ——
// tab 栏正常、内容区一片空白，控制台连个警告都没有。这条用例就是防它再回来。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import AuxiliaryTool from './index.vue'

// 路由：useRoute 返回的 query 必须是**响应式**的，否则 watch(() => route.query.tab) 什么都监听不到，
// 切 tab 的用例会一直停在初始值；useRouter 只记 replace 调用。
const router = vi.hoisted(() => ({ replace: vi.fn() }))
const routeQuery = vi.hoisted(() => ({ current: { tab: undefined as string | undefined } }))
const routeMeta = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock('vue-router', async () => {
  const { reactive } = await import('vue')
  routeQuery.current = reactive(routeQuery.current)
  routeMeta.current = reactive(routeMeta.current)
  return {
    useRoute: () => ({ query: routeQuery.current, meta: routeMeta.current }),
    useRouter: () => ({ replace: router.replace }),
  }
})

// 6 个子页面全部打成桩：这里验的是「切哪个 key 渲染哪个组件」，不是子页面自己的逻辑
vi.mock('./mqList/index.vue', async () => {
  const { h } = await import('vue')
  return { default: { name: 'MqList', setup: () => () => h('div', { class: 'stub-mq' }, 'MQ队列页') } }
})
vi.mock('./functionBuild/index.vue', async () => {
  const { h } = await import('vue')
  return { default: { name: 'FunctionBuild', setup: () => () => h('div', { class: 'stub-fn' }, '函数工具页') } }
})
vi.mock('./urlBuild/index.vue', async () => {
  const { h } = await import('vue')
  return { default: { name: 'UrlBuild', setup: () => () => h('div', { class: 'stub-url' }, 'URL生成页') } }
})
vi.mock('./scheduleConfig/index.vue', async () => {
  const { h } = await import('vue')
  return { default: { name: 'ScheduleConfig', setup: () => () => h('div', { class: 'stub-sch' }) } }
})
vi.mock('./urlBuildStatic/index.vue', async () => {
  const { h } = await import('vue')
  return { default: { name: 'UrlBuildStatic', setup: () => () => h('div', { class: 'stub-static' }) } }
})
vi.mock('./ossUpload/index.vue', async () => {
  const { h } = await import('vue')
  return { default: { name: 'OssUpload', setup: () => () => h('div', { class: 'stub-oss' }) } }
})

beforeEach(() => {
  router.replace.mockReset()
  routeQuery.current.tab = undefined
  routeMeta.current.tabs = undefined
})

describe('辅助工具容器', () => {
  it('默认 tab 是 MQ队列，且内容区真的渲染出子页面（不是空白）', () => {
    const wrapper = mount(AuxiliaryTool)
    expect(wrapper.findAll('.ra-tab-link').map((b) => b.text())).toEqual([
      'MQ队列',
      '函数工具',
      'URL生成工具',
      '调度整体配置',
      'URL生成静态[备]',
      'OSS上传',
    ])
    expect(wrapper.find('.stub-mq').exists()).toBe(true)
    expect(wrapper.text()).toContain('MQ队列页')
  })

  it('按 query.tab 切到对应组件（key 大小写必须对得上）', async () => {
    const wrapper = mount(AuxiliaryTool)
    routeQuery.current.tab = 'functionBuild'
    await nextTick()
    expect(wrapper.find('.stub-fn').exists()).toBe(true)
    expect(wrapper.find('.stub-mq').exists()).toBe(false)

    routeQuery.current.tab = 'urlBuild'
    await nextTick()
    expect(wrapper.find('.stub-url').exists()).toBe(true)
  })

  it('非法 tab 回落到默认 MQ队列，而不是白屏', async () => {
    routeQuery.current.tab = 'not-exist'
    const wrapper = mount(AuxiliaryTool)
    expect(wrapper.find('.stub-mq').exists()).toBe(true)
  })

  it('点 tab 走 replace：默认 tab 不带 query，其余带 tab 参数', async () => {
    const wrapper = mount(AuxiliaryTool)
    await wrapper.findAll('.ra-tab-link')[0]!.trigger('click')
    expect(router.replace).toHaveBeenLastCalledWith({ path: '/auxiliary-tool', query: {} })
    await wrapper.findAll('.ra-tab-link')[2]!.trigger('click')
    expect(router.replace).toHaveBeenLastCalledWith({ path: '/auxiliary-tool', query: { tab: 'urlBuild' } })
  })

  // 页内 tab 的数据源是后端菜单（dynamicRoutes 把 sys_menu 的 menu_type=2 记录写进 route.meta.tabs），
  // 本地 FALLBACK_TABS 只在菜单接口没下发时兜底。
  it('后端下发的页内 tab 覆盖本地兜底：文案与顺序都按后端', () => {
    routeMeta.current.tabs = [
      { id: 2, key: 'urlBuild', label: 'URL生成（后端）', permission: '', order: 1 },
      { id: 1, key: 'mqList', label: 'MQ队列（后端）', permission: '', order: 2 },
    ]
    const wrapper = mount(AuxiliaryTool)

    expect(wrapper.findAll('.ra-tab-link').map((b) => b.text())).toEqual(['URL生成（后端）', 'MQ队列（后端）'])
    // 默认落在后端排序第一条，且真的渲染出对应子页面
    expect(wrapper.find('.ra-tab-link.active').text()).toBe('URL生成（后端）')
    expect(wrapper.find('.stub-url').exists()).toBe(true)
  })
})
