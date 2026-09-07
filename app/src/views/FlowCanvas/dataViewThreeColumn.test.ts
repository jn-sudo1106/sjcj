// @vitest-environment jsdom
// 0904 I10（Z3-1/Z3-2）：**数据视图挂进三栏**——左源侧栏 + 中间可切换（流程 ↔ 数据）+ 右节点配置。
//
// 会上原话：「你右边这个没有了，配置看不到了，所以到数据时候就看不到了」
// 「就相当于只是中间这边去切换，然后这边是固定的」「流程节点里面不是可以三栏吗？
//  数据节点也是可以做成三栏的」。
// 动机是"边写规则边看数据"：从配置区点「测试脚本」跳到数据视图，配置面板必须还在，
// 否则这件事根本不成立。
//
// 这条测试锁的是**布局骨架**，不是数据内容——所以中间那两个重组件整体 stub 掉。
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import FlowCanvas from './index.vue'
import { useUiStore } from '@/stores/ui'
import { sourceApi, type Source } from '@/api'

const SOURCE = {
  sourceId: '430016398', name: 'test1', url: 'http://x.test/', configId: '1400917',
  mainTable: '6200026', owner: 'a', state: 'C',
} as Source

async function mountCanvas(view: 'flow' | 'data') {
  vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(SOURCE)
  vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([])
  vi.spyOn(sourceApi, 'stepConfigDetails').mockResolvedValue([])
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/canvas', component: { template: '<div />' } }],
  })
  await router.push({ path: '/canvas', query: { sourceId: SOURCE.sourceId, view } })
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(FlowCanvas, {
    global: {
      plugins: [pinia, router],
      directives: { loading: {} },
      stubs: {
        FlowBoard: { template: '<div data-testid="stub-flow-board" />' },
        ResultView: { template: '<div data-testid="stub-result-view" />' },
        NodeInspector: { template: '<div data-testid="stub-inspector" />' },
        SiteSourceSwitcher: { template: '<div data-testid="stub-sidebar" />' },
        SourceTabsBar: true, TaskView: true, FileView: true, SiteDetailView: true, CompareSplit: true,
        LoginConfigSelectDialog: true, NewSiteWizard: true,
      },
    },
  })
  await flushPromises()
  return wrapper
}

describe('数据视图的三栏骨架（Z3-1/Z3-2）', () => {
  it('view=data 时数据视图在三栏里，**节点配置一键可达**（不再整个消失）', async () => {
    const w = await mountCanvas('data')
    const shell = w.find('.rc-flow-shell')
    expect(shell.exists()).toBe(true)
    expect(shell.find('[data-testid="stub-result-view"]').exists()).toBe(true)
    // 这条是本次改动的全部意义：跳到数据视图后配置还在这一栏里——
    // 默认收起成窄边（用户指定），点开就有，而不是像以前那样整屏铺开、右边什么都没有。
    expect(shell.find('[data-testid="inspector-collapsed"]').exists()).toBe(true)
    await shell.get('[data-testid="inspector-collapsed"]').trigger('click')
    await flushPromises()
    expect(shell.find('[data-testid="stub-inspector"]').exists()).toBe(true)
    // 左源侧栏只在能解析出 siteId 时渲染（深链只带 sourceId 时靠 resolveOwnerSite 异步补），
    // 这条测试只锁三栏骨架，侧栏的出现时机另有用例覆盖，这里不断言。
  })

  it('中间那一栏是**切换**关系：数据视图下不同时渲染画布', async () => {
    const w = await mountCanvas('data')
    expect(w.find('[data-testid="stub-flow-board"]').exists()).toBe(false)
  })

  it('view=flow 时中间换回画布，配置面板同样在', async () => {
    const w = await mountCanvas('flow')
    const shell = w.find('.rc-flow-shell')
    expect(shell.find('[data-testid="stub-flow-board"]').exists()).toBe(true)
    expect(shell.find('[data-testid="stub-result-view"]').exists()).toBe(false)
    expect(shell.find('[data-testid="stub-inspector"]').exists()).toBe(true)
  })

  it('数据视图**默认把右侧配置收起**，把宽度让给数据（用户 2026-09-05 指定）', async () => {
    const w = await mountCanvas('data')
    expect(useUiStore().inspectorCollapsed).toBe(true)
    // 收起态渲染成一条可点的窄边，点它展开
    expect(w.find('[data-testid="inspector-collapsed"]').exists()).toBe(true)
    expect(w.find('[data-testid="stub-inspector"]').exists()).toBe(false)
  })

  it('流程视图不收起——那边配置本来就是主角', async () => {
    await mountCanvas('flow')
    expect(useUiStore().inspectorCollapsed).toBe(false)
  })

  it('点窄边即展开，配置面板回来', async () => {
    const w = await mountCanvas('data')
    await w.get('[data-testid="inspector-collapsed"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="stub-inspector"]').exists()).toBe(true)
  })

  it('收起态的文案跟着当前视图走，不会在数据视图里说「画布已收起」', async () => {
    const w = await mountCanvas('data')
    // 默认是"右侧收起"；这条测的是相反的那一端（中间收起），先切过去
    useUiStore().toggleInspectorExpanded()
    await flushPromises()
    const collapsed = w.find('.rc-canvas-collapsed')
    expect(collapsed.text()).toContain('数据已收起')
    expect(collapsed.text()).not.toContain('画布')
  })
})
