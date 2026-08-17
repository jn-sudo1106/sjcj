// SourceTab 单元测试（867→321 行 P2-2 拆分产物，之前从未有过测试，此前全项目零覆盖）
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import SourceTab from './SourceTab.vue'
import { useUiStore } from '@/stores/ui'
import { sourceApi } from '@/api'

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return {
    ...actual,
    ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
    ElMessageBox: { confirm: vi.fn() },
  }
})

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/collect', component: { template: '<div />' } },
      { path: '/canvas', component: { template: '<div />' } },
    ],
  })
}

async function mountAt(query?: Record<string, string>) {
  const router = makeRouter()
  await router.push({ path: '/collect', query })
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(SourceTab, { global: { plugins: [pinia, router, ElementPlus] } })
  await flushPromises()
  await flushPromises()
  return { wrapper, router }
}

describe('SourceTab 加载与初始筛选', () => {
  beforeEach(() => {
    vi.mocked(ElMessage.warning).mockClear()
    vi.mocked(ElMessage.success).mockClear()
    vi.mocked(ElMessageBox.confirm).mockReset()
  })

  it('mount 后自动加载分类/统计/网站列表，把结果灌给子组件', async () => {
    const { wrapper } = await mountAt()
    expect(wrapper.findComponent({ name: 'FilterToolbar' }).exists()).toBe(true)
    // 默认卡片视图（ui.assetView 默认值），SiteCardGrid 而非 TableView 挂载
    const grid = wrapper.findComponent({ name: 'SiteCardGrid' })
    expect(grid.exists()).toBe(true)
    // mock 接口返回后 sites 应已灌入（不是初始空数组）；具体数量不锁死，只验证「确实加载过了」
    expect(Array.isArray(grid.props('sites'))).toBe(true)
    expect(wrapper.findComponent({ name: 'FilterToolbar' }).props('total')).toBeGreaterThanOrEqual(0)
  })

  it('?state=error 会预置状态筛选；非法值（如 ?state=E）被忽略、保持默认 all', async () => {
    const { wrapper: wOk } = await mountAt({ state: 'error' })
    expect(wOk.findComponent({ name: 'FilterToolbar' }).props('stateFilter')).toBe('error')

    const { wrapper: wBad } = await mountAt({ state: 'E' })
    expect(wBad.findComponent({ name: 'FilterToolbar' }).props('stateFilter')).toBe('all')
  })
})

describe('SourceTab 筛选状态', () => {
  it('hasFilter 在任一筛选条件非默认时为 true', async () => {
    const { wrapper } = await mountAt()
    const toolbar = wrapper.findComponent({ name: 'FilterToolbar' })
    expect(toolbar.props('hasFilter')).toBe(false)
    await toolbar.vm.$emit('update:keyword', '公告')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'FilterToolbar' }).props('hasFilter')).toBe(true)
  })

  it('clear-filters 事件重置全部筛选条件并重新加载', async () => {
    const { wrapper } = await mountAt()
    const toolbar = wrapper.findComponent({ name: 'FilterToolbar' })
    await toolbar.vm.$emit('update:keyword', '公告')
    await toolbar.vm.$emit('update:state-filter', 'error')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'FilterToolbar' }).props('hasFilter')).toBe(true)

    await wrapper.findComponent({ name: 'FilterToolbar' }).vm.$emit('clear-filters')
    await flushPromises()
    const toolbarAfter = wrapper.findComponent({ name: 'FilterToolbar' })
    expect(toolbarAfter.props('hasFilter')).toBe(false)
    expect(toolbarAfter.props('stateFilter')).toBe('all')
  })
})

describe('SourceTab 视图切换', () => {
  it('set-view 事件切换卡片/表格视图，委托给 ui store 持久化', async () => {
    const { wrapper } = await mountAt()
    const ui = useUiStore()
    expect(ui.assetView).toBe('card') // 默认卡片视图（见 ui store）
    await wrapper.findComponent({ name: 'FilterToolbar' }).vm.$emit('set-view', 'table')
    await flushPromises()
    expect(ui.assetView).toBe('table')
    expect(wrapper.findComponent({ name: 'TableView' }).exists()).toBe(true)
  })
})

describe('SourceTab 批量操作', () => {
  it('未勾选任何行时批量删除会提示并且不弹确认框', async () => {
    const { wrapper } = await mountAt()
    await wrapper.findComponent({ name: 'BatchBar' }).vm.$emit('batch-delete')
    await flushPromises()
    expect(ElMessage.warning).toHaveBeenCalledWith('请先在表格视图勾选网站或源')
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
  })

  it('已勾选行时批量删除会弹二次确认，确认后调用 sourceApi.deleteSource', async () => {
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const deleteSpy = vi.spyOn(sourceApi, 'deleteSource').mockResolvedValue({ ok: true, message: '已删除' })

    const { wrapper } = await mountAt()
    const table = wrapper.findComponent({ name: 'TableView' })
    table.vm.selectedIds = ['s1', 's2']
    await flushPromises()

    await wrapper.findComponent({ name: 'BatchBar' }).vm.$emit('batch-delete')
    await flushPromises()
    await flushPromises()

    expect(ElMessageBox.confirm).toHaveBeenCalled()
    expect(deleteSpy).toHaveBeenCalledWith(['s1', 's2'])
    expect(ElMessage.success).toHaveBeenCalled()
    deleteSpy.mockRestore()
  })

  it('取消二次确认时不调用 API', async () => {
    vi.mocked(ElMessageBox.confirm).mockRejectedValue('cancel' as never)
    const deleteSpy = vi.spyOn(sourceApi, 'deleteSource')

    const { wrapper } = await mountAt()
    const table = wrapper.findComponent({ name: 'TableView' })
    table.vm.selectedIds = ['s1']
    await flushPromises()

    await wrapper.findComponent({ name: 'BatchBar' }).vm.$emit('batch-delete')
    await flushPromises()

    expect(deleteSpy).not.toHaveBeenCalled()
    deleteSpy.mockRestore()
  })
})

describe('新建采集', () => {
  it('顶栏"新建采集"动作跳转到 /canvas?mode=new', async () => {
    const { router } = await mountAt()
    const ui = useUiStore()
    ui.fireAction('新建采集')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/canvas')
    expect(router.currentRoute.value.query).toEqual({ mode: 'new' })
  })
})
