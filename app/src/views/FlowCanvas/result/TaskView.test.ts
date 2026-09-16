// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import TaskView from './TaskView.vue'
import { mockSourceDetail, mockSourceSteps } from '@/api/mock/sources'
import { dataApi, siteApi, sourceApi, type TaskInst } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })

describe('TaskView', () => {
  afterEach(() => vi.restoreAllMocks())

  it('仅展示当前源的节点任务，而非网站队列聚合（不再提供所属源筛选）', async () => {
    setActivePinia(createPinia())
    await router.push('/canvas')
    const source = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))

    const wrapper = shallowMount(TaskView, {
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()

    expect(wrapper.find('[data-testid="task-source-filter"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="task-process-rail"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="task-node-filter"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="source-task-table"]').text()).toContain('列表抓取')
    expect(wrapper.get('[data-testid="source-task-table"]').text()).toContain('队列')
    expect(wrapper.get('[data-testid="source-task-table"]').text()).toContain('总任务数')
    expect(wrapper.get('[data-testid="source-task-table"]').text()).toContain('已处理数')
    expect(wrapper.get('[data-testid="source-task-table"]').text()).toContain('queue_81909')
    expect(wrapper.text()).not.toContain('队列聚合')
    wrapper.unmount()
  })

  it('有「运行中」任务时每 10s 自动刷新，全部完成后停；「刷新」按钮手动重拉', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-08T10:00:00'))
    setActivePinia(createPinia())
    await router.push('/canvas')
    const source = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))

    // 刚更新过（1 分钟前）→ 视为活跃，参与轮询
    const running: TaskInst[] = [
      { taskId: 't1', state: 'L', typeName: '浏览器抓取', taskName: '进行中', sourceId: source.sourceId, updatedAt: '2026-09-08 09:59' },
    ]
    const done: TaskInst[] = [{ ...running[0], state: 'C' }]
    const paged = vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({ total: 1, list: running })

    const wrapper = shallowMount(TaskView, {
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await vi.advanceTimersByTimeAsync(200)
    await flushPromises()
    const initialCalls = paged.mock.calls.length
    expect(wrapper.find('[data-testid="task-auto-refresh"]').exists()).toBe(true)

    paged.mockResolvedValue({ total: 1, list: done })
    await vi.advanceTimersByTimeAsync(10_000)
    await flushPromises()
    expect(paged.mock.calls.length).toBe(initialCalls + 1)
    expect(wrapper.find('[data-testid="task-auto-refresh"]').exists()).toBe(false)

    await vi.advanceTimersByTimeAsync(30_000)
    await flushPromises()
    expect(paged.mock.calls.length).toBe(initialCalls + 1)

    await wrapper.get('[data-testid="task-refresh"]').trigger('click')
    await flushPromises()
    expect(paged.mock.calls.length).toBe(initialCalls + 2)

    wrapper.unmount()
    vi.useRealTimers()
  })

  it('admin 每行有「重发」，二次确认后调 dataApi.resendTask 并刷新；read 角色无操作列', async () => {
    setActivePinia(createPinia())
    await router.push('/canvas')
    const auth = useAuthStore()
    auth.roles = ['admin']
    const source = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))

    vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({
      total: 1,
      list: [{ taskId: 't1', state: 'L', typeName: '浏览器抓取', taskName: '掉队任务', sourceId: source.sourceId, updatedAt: '2026-09-08 09:54' }],
    })
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const resend = vi.spyOn(dataApi, 'resendTask').mockResolvedValue({ message: 'ok' })

    const wrapper = shallowMount(TaskView, {
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()

    await wrapper.get('[data-testid="task-resend"]').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalled()
    expect(resend).toHaveBeenCalledWith(['t1'])

    auth.roles = ['read']
    await flushPromises()
    expect(wrapper.find('[data-testid="task-resend"]').exists()).toBe(false)

    wrapper.unmount()
  })

  // 0915-05 / B15：`topTaskPaged` 只认 sourceId，网站态聚合查询后端未支持，页面暂时展示说明
  // 而不是一张注定为空的表。**后端加上 siteId 后**把 TaskView 的 SITE_WIDE_BACKEND_READY 改 true，
  // 本用例应改回断言表格含「所属源」列（原断言保留在下方注释里）。
  it('网站详情页（site-wide）：后端未支持聚合查询时给明确说明，不展示流程节点条', async () => {
    setActivePinia(createPinia())
    await router.push('/canvas')
    const source = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))

    const wrapper = shallowMount(TaskView, {
      props: { siteWide: true },
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()

    expect(wrapper.find('[data-testid="task-process-rail"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="task-site-wide-pending"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('后端接口尚未支持')
    // B15 就绪后恢复这两条：
    //   expect(wrapper.find('[data-testid="task-node-filter"]').exists()).toBe(true)
    //   expect(wrapper.get('[data-testid="source-task-table"]').text()).toContain('所属源')
    wrapper.unmount()
  })

  // 0915-05：网站详情页挂载时**没有 flow.sourceCtx**，siteId 只能由 props 给（旧实现从 sourceCtx
  // 取会拿到空串）。而在后端支持 siteId 之前（B15），这里一个请求都不该发——发了必然 0 条，
  // 页面会显示成"这个网站没有任务"，是误导。
  it('网站态后端未就绪时不发任何查询请求，并给出说明', async () => {
    setActivePinia(createPinia())
    await router.push('/canvas')
    // 有意不调 loadFromSource：网站汇总态就是没有当前源

    const paged = vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({
      total: 1,
      list: [{ taskId: 't9', topic: 'queue_a', state: 'C', typeName: '下载', taskName: '任务9', sourceId: 's1', updatedAt: '2026-09-16 10:00' }] as TaskInst[],
    })
    const sources = vi.spyOn(siteApi, 'siteSources').mockResolvedValue([
      { sourceId: 's1', name: '源一' }, { sourceId: 's2', name: '源二' },
    ] as never)
    const steps = vi.spyOn(sourceApi, 'sourceSteps')

    const wrapper = shallowMount(TaskView, {
      props: { siteWide: true, siteId: 'site-zfb' },
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()

    // 不发注定为空的任务查询，也不拉大站那份 6496 行的源列表
    expect(paged).not.toHaveBeenCalled()
    expect(sources).not.toHaveBeenCalled()
    // 防回归：不许逐源拉 steps/nodeRuns（6496 源的网站会打出上万请求）
    expect(steps).not.toHaveBeenCalled()
    // 不能落在"仅在源详情下可用"的空态上——siteId 是有的，缺的是后端能力
    expect(wrapper.find('.tv-empty-row').exists()).toBe(false)
    expect(wrapper.get('[data-testid="task-site-wide-pending"]').text()).toContain('后端接口尚未支持')
    wrapper.unmount()
  })

  it('支持按队列名筛选任务，点击队列单元格可快速填入/切换筛选', async () => {
    setActivePinia(createPinia())
    await router.push('/canvas')
    const source = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))

    const paged = vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({
      total: 2,
      list: [
        { taskId: 't1', topic: 'queue_download', state: 'C', typeName: '下载', taskName: '任务1', sourceId: source.sourceId, updatedAt: '2026-09-08 10:00' },
        { taskId: 't2', topic: 'queue_parse', state: 'C', typeName: '解析', taskName: '任务2', sourceId: source.sourceId, updatedAt: '2026-09-08 10:01' },
      ],
    })

    const wrapper = shallowMount(TaskView, {
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()

    const queueInput = wrapper.find<HTMLInputElement>('[data-testid="task-queue-filter"]')
    expect(queueInput.exists()).toBe(true)

    // 输入队列名过滤
    await queueInput.setValue('queue_download')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ queue: 'queue_download', topic: 'queue_download' }))

    // 点击表格中的 queue_parse 单元格快速切换
    const parseCell = wrapper.findAll('.tv-queue-clickable').find((el) => el.text() === 'queue_parse')
    expect(parseCell).toBeDefined()
    await parseCell!.trigger('click')
    await flushPromises()
    expect(queueInput.element.value).toBe('queue_parse')
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ queue: 'queue_parse', topic: 'queue_parse' }))

    // 再次点击同一单元格取消筛选
    await parseCell!.trigger('click')
    await flushPromises()
    expect(queueInput.element.value).toBe('')
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ queue: undefined, topic: undefined }))

    wrapper.unmount()
  })
})
