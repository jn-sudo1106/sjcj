// @vitest-environment jsdom
// 配置模板详情（旧 page/base/detail/ConfigDetail.vue）—— 点任务实例页「配置ID」蓝色 tag 时打开。
// 只守两件事：① 用 configId 调 configDetailRaw；② 详情字段与「参数列表」按旧 CONFIG 列渲染。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ConfigTemplateDrawer from './ConfigTemplateDrawer.vue'
import { configApi } from '@/api'

// 组件只用到 configApi 一个导出，直接整体替换 @/api 的 configApi（避免加载真实模块的副作用）
vi.mock('@/api', () => ({ configApi: { configDetailRaw: vi.fn() } }))

const stubs = {
  ElDrawer: {
    name: 'ElDrawer',
    props: ['modelValue', 'title'],
    template: '<div class="stub-drawer"><slot /></div>',
  },
  ElDescriptions: { name: 'ElDescriptions', template: '<div><slot /></div>' },
  ElDescriptionsItem: { name: 'ElDescriptionsItem', props: ['label', 'span'], template: '<div class="stub-cell"><slot /></div>' },
}

const CONFIG = {
  configId: '70598',
  configName: '首页列表配置',
  configUrl: 'https://www.demo.com/list',
  topic: 'queue_70598',
  entryTypeId: '1042',
  updateDt: '2026-10-13 08:00:00',
  domain: 'www.demo.com',
  remark: '备注',
  coreParam: '{"pageSize":20}',
  snatchConf: '<xml><a>1</a></xml>',
  contentRule: '<div>正文</div>',
  action: '不该出现在详情里',
  params: [
    { paramId: '1', paramName: '起始页', paramType: 'INT', valueShow: '1' },
    { paramId: '2', paramName: '列表地址', paramType: 'TEXT', valueShow: 'https://www.demo.com/p/1' },
  ],
}

function mountDrawer() {
  return mount(ConfigTemplateDrawer, { global: { plugins: [ElementPlus], stubs } })
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('配置模板详情', () => {
  it('用 configId 调 configDetailRaw，并渲染 CONFIG 字段（排除 noDetail 的 action）', async () => {
    vi.mocked(configApi.configDetailRaw).mockResolvedValue(CONFIG as never)
    const wrapper = mountDrawer()

    wrapper.vm.open('70598')
    await flushPromises()

    expect(configApi.configDetailRaw).toHaveBeenLastCalledWith('70598')
    const text = wrapper.text()
    expect(text).toContain('首页列表配置')
    expect(text).toContain('queue_70598')
    expect(text).toContain('1042')
    // 旧 CONFIG.columns 的 action 列带 noDetail → 不进详情
    expect(text).not.toContain('不该出现在详情里')
  })

  it('「参数列表」按 CONFIG.params 渲染，http(s) 参考值渲染成可点链接', async () => {
    vi.mocked(configApi.configDetailRaw).mockResolvedValue(CONFIG as never)
    const wrapper = mountDrawer()

    wrapper.vm.open('70598')
    await flushPromises()

    const paramsTable = wrapper.find('.ctd-params')
    expect(paramsTable.exists()).toBe(true)
    expect(paramsTable.text()).toContain('起始页')
    expect(paramsTable.text()).toContain('列表地址')
    expect(paramsTable.findAll('a.ctd-link')).toHaveLength(1) // 只有 http 那条成链接
  })

  it('接口失败：不抛未捕获异常，详情为空', async () => {
    vi.mocked(configApi.configDetailRaw).mockRejectedValue(new Error('404'))
    const wrapper = mountDrawer()

    wrapper.vm.open('70598')
    await flushPromises()

    expect(wrapper.find('.ctd-desc').exists()).toBe(false)
    expect(wrapper.find('.ctd-params').exists()).toBe(false)
  })

  it('configId 为空时不发请求', async () => {
    const spy = vi.mocked(configApi.configDetailRaw)
    spy.mockClear()
    const wrapper: VueWrapper = mountDrawer()
    ;(wrapper.vm as unknown as { open: (id: string) => void }).open('')
    await flushPromises()
    expect(spy).not.toHaveBeenCalled()
  })
})
