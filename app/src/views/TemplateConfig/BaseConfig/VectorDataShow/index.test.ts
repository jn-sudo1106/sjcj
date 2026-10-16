// @vitest-environment jsdom
// 向量表数据浏览 · 窗口层回归（旧 ai-chat-view src/demo/VectorDataShowTop.vue）。钉住旧口径：
// ① 首屏一个窗口「窗口 1」，只有一份查询区；
// ② 左侧「+」新增窗口，标题按旧文案「窗口N」（不带空格），并把当前窗口切过去；
// ③ 关掉当前窗口回落到前一个，没有前一个落第一个（旧 remove 的 lastIndex 逻辑）；
// ④ 只剩一个窗口时不给关闭按钮（旧 :closable="panes.length > 1"）。
// 每个窗口内的查询行为见 VectorDataPanel 自己的测试，这里把面板换成占位组件。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import VectorDataShowPage from './index.vue'

vi.mock('./VectorDataPanel.vue', () => ({
  default: { name: 'VectorDataPanel', template: '<div data-testid="stub-panel" />' },
}))

function mountPage() {
  return mount(VectorDataShowPage, { global: { plugins: [ElementPlus] } })
}

function tabTitles(wrapper: ReturnType<typeof mountPage>) {
  return wrapper.findAll('.el-tabs__item').map((item) => item.text().replace('×', '').trim())
}

function closeIcons(wrapper: ReturnType<typeof mountPage>) {
  return wrapper.findAll('.is-icon-close')
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('向量表数据浏览 · 窗口层', () => {
  it('首屏一个窗口「窗口 1」，里面是一份查询区', async () => {
    const wrapper = mountPage()
    await flushPromises()
    expect(tabTitles(wrapper)).toEqual(['窗口 1'])
    expect(wrapper.findAll('[data-testid="stub-panel"]')).toHaveLength(1)
  })

  it('点「+」新增窗口：标题为「窗口N」，当前窗口跟着切过去，三份查询区互不干扰', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('.el-tabs__new-tab').trigger('click')
    await flushPromises()
    await wrapper.find('.el-tabs__new-tab').trigger('click')
    await flushPromises()

    expect(tabTitles(wrapper)).toEqual(['窗口 1', '窗口2', '窗口3'])
    expect(wrapper.findAll('[data-testid="stub-panel"]')).toHaveLength(3)
    // 旧 add() 把 activeKey 落到新窗口，前两个窗口跟着失活
    expect(wrapper.findAll('.el-tabs__item').map((item) => item.classes().includes('is-active'))).toEqual([false, false, true])
  })

  it('关掉当前窗口：回落到前一个（旧 remove 的 lastIndex 逻辑）', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.find('.el-tabs__new-tab').trigger('click')
    await flushPromises()
    expect(tabTitles(wrapper)).toEqual(['窗口 1', '窗口2'])

    await closeIcons(wrapper)[1]!.trigger('click')
    await flushPromises()
    expect(tabTitles(wrapper)).toEqual(['窗口 1'])
    expect(wrapper.findAll('.el-tabs__item')[0]!.classes()).toContain('is-active')
  })

  it('关掉第一个窗口（非当前）：当前窗口不动', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.find('.el-tabs__new-tab').trigger('click')
    await flushPromises()

    await closeIcons(wrapper)[0]!.trigger('click')
    await flushPromises()
    expect(tabTitles(wrapper)).toEqual(['窗口2'])
    expect(wrapper.findAll('.el-tabs__item')[0]!.classes()).toContain('is-active')
  })

  it('只剩一个窗口时没有关闭按钮（旧 :closable="panes.length > 1"）', async () => {
    const wrapper = mountPage()
    await flushPromises()
    expect(closeIcons(wrapper)).toHaveLength(0)
  })
})
