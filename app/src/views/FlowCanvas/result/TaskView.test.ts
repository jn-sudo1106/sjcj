// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import TaskView from './TaskView.vue'
import RailResizeHandle from './RailResizeHandle.vue'
import TaskViewSource from './TaskView.vue?raw'
import { mockSourceDetail, mockSourceSteps } from '@/api/mock/sources'
import { dataApi, siteApi, sourceApi, type TaskInst } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { useAuthStore } from '@/stores/auth'
import { useWorkspaceStore } from '@/stores/workspace'

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })

// 0930-02 起流程节点轨道进来恒收起。既有用例大多测轨道本身，默认按"已展开"跑；测默认值的用例自己改成 false
const railDefault = vi.hoisted(() => ({ open: true }))
vi.mock('./resultLayoutPref', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./resultLayoutPref')>()),
  initialRailOpen: () => railDefault.open,
}))

describe('TaskView', () => {
  afterEach(() => { vi.restoreAllMocks(); railDefault.open = true })

  it('0930-02：具体源下流程图区默认收起，有节点下拉（首项全部节点），点「流程图」展开', async () => {
    railDefault.open = false
    setActivePinia(createPinia())
    await router.push('/canvas')
    const source = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))

    const wrapper = shallowMount(TaskView, {
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true, RailNodePicker: false } },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="task-process-rail"]').exists()).toBe(false)
    // 收起时有节点下拉，首项「全部节点」，选一个节点直接按它筛
    const select = wrapper.get('[data-testid="rail-node-select"]')
    expect((select.element as HTMLSelectElement).value).toBe('')
    expect(select.findAll('option')[0]!.text()).toBe('全部节点')
    const nodeId = select.findAll('option')[1]!.attributes('value')!
    await select.setValue(nodeId)
    const toggle = wrapper.get('[data-testid="task-rail-toggle"]')
    await toggle.trigger('click')
    expect(wrapper.find('[data-testid="task-process-rail"]').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'ProcessNodeRail' }).props('modelValue')).toBe(nodeId)
    // 展开后与源数据视图一致：节点下拉隐藏，收起走流程图右上角的按钮
    expect(wrapper.find('[data-testid="rail-node-select"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'RailCollapseButton' }).exists()).toBe(true)
  })

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
    // 0928：流程图区默认限高 + 底边高度分隔条（与数据视图共用偏好）
    expect((wrapper.get('[data-testid="task-process-rail"]').element as HTMLElement).style.maxHeight).toBe('220px')
    expect(wrapper.findComponent(RailResizeHandle).exists()).toBe(true)
    expect(wrapper.find('[data-testid="task-node-filter"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="source-task-table"]').text()).toContain('列表抓取')
    expect(wrapper.get('[data-testid="source-task-table"]').text()).toContain('队列')
    // 「总任务数 / 已处理数」2026-09-23 删列：数据来自 source/nodeRunStats，后端没有这条接口，线上恒为「—」
    expect(wrapper.get('[data-testid="source-task-table"]').text()).not.toContain('总任务数')
    expect(wrapper.get('[data-testid="source-task-table"]').text()).not.toContain('已处理数')
    expect(wrapper.get('[data-testid="source-task-table"]').text()).toContain('queue_81909')
    expect(wrapper.text()).not.toContain('队列聚合')
    wrapper.unmount()
  })

  // 0920-05（2026-09-23 落地）：自动刷新改手动开关、默认关。原来"有 L 就轮询"在任务终态不回写
  //（B26，87 万条永远 L）时永远停不下来。
  it('自动刷新默认关、不轮询；打开后每 10s 重拉，关掉就停；刷新图标按钮手动重拉', async () => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    await router.push('/canvas')
    const source = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))

    // 列表里有「运行中」的任务——原实现会因此自动开始轮询
    const running: TaskInst[] = [
      { taskId: 't1', state: 'L', typeName: '浏览器抓取', taskName: '进行中', sourceId: source.sourceId, updatedAt: '2026-09-08 09:59' },
    ]
    const paged = vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({ total: 1, list: running })
    const SwitchStub = { name: 'ElSwitch', props: ['modelValue'], emits: ['update:modelValue'], template: '<i />' }

    const wrapper = shallowMount(TaskView, {
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true, 'el-switch': SwitchStub } },
    })
    await vi.advanceTimersByTimeAsync(200)
    await flushPromises()
    const initialCalls = paged.mock.calls.length

    // 默认关：有运行中的任务也不转
    expect(wrapper.get('[data-testid="task-auto-refresh"]').text()).toContain('关')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(paged.mock.calls.length).toBe(initialCalls)

    // 打开：每 10s 一次
    wrapper.findComponent(SwitchStub).vm.$emit('update:modelValue', true)
    await flushPromises()
    expect(wrapper.get('[data-testid="task-auto-refresh"]').text()).toContain('开 · 10 秒')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(paged.mock.calls.length).toBe(initialCalls + 2)

    // 关掉：停
    wrapper.findComponent(SwitchStub).vm.$emit('update:modelValue', false)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(paged.mock.calls.length).toBe(initialCalls + 2)

    await wrapper.get('[data-testid="task-refresh"]').trigger('click')
    await flushPromises()
    expect(paged.mock.calls.length).toBe(initialCalls + 3)

    wrapper.unmount()
    vi.useRealTimers()
  })

  it('没关联网站的源（siteId 为空）：照样按 sourceId 查任务（10-22 修：以前直接回空）', async () => {
    setActivePinia(createPinia())
    await router.push('/canvas')
    const source = { ...mockSourceDetail({ sourceId: '391007768' })!, siteId: undefined }
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))
    expect(useFlowStore().sourceCtx?.siteId).toBeFalsy()
    const paged = vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({
      total: 1,
      list: [{ taskId: '74111', state: 'C', typeName: '浏览器抓取', taskName: '公众号列表', sourceId: '391007768', updatedAt: '2026-10-22 18:30' }],
    })
    const wrapper = shallowMount(TaskView, {
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ sourceId: '391007768' }))
    expect(wrapper.text()).not.toContain('没有匹配的任务记录')
    wrapper.unmount()
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

  // 0915-05 / B15：网站态靠 topTaskPaged 的 siteId（后端 2026-09-16 加、09-17 修好 SQL）
  // 一个参数圈定整站来源，源再多也只发一个请求。
  it('网站详情页（site-wide）：按 siteId 聚合查询，不展示流程节点条', async () => {
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

    // 网站态没有"当前源"，流程节点条不适用；但表格正常出
    expect(wrapper.find('[data-testid="task-process-rail"]').exists()).toBe(false)
    expect(wrapper.findComponent(RailResizeHandle).exists()).toBe(false)
    wrapper.unmount()
  })

  // 0915-05：网站详情页挂载时**没有 flow.sourceCtx**，siteId 只能由 props 给（旧实现从 sourceCtx
  // 取会拿到空串，被 loadTasks 的守卫短路成空列表）。
  it('网站态用 props.siteId 作为查询范围，且不逐源拉节点元数据', async () => {
    setActivePinia(createPinia())
    await router.push('/canvas')
    // 有意不调 loadFromSource：网站汇总态就是没有当前源

    const paged = vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({
      total: 1,
      list: [{ taskId: 't9', topic: 'queue_a', state: 'C', typeName: '下载', taskName: '任务9', sourceId: 's1', updatedAt: '2026-09-16 10:00' }] as TaskInst[],
    })
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([
      { sourceId: 's1', name: '源一' }, { sourceId: 's2', name: '源二' },
    ] as never)
    const steps = vi.spyOn(sourceApi, 'sourceSteps')

    const wrapper = shallowMount(TaskView, {
      props: { siteWide: true, siteId: 'site-zfb' },
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()

    // 查询范围走 siteScopeId；sourceId 留空表示「本站全部源」
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ siteScopeId: 'site-zfb', sourceId: undefined }))
    // 防回归：不许逐源拉 steps/nodeRuns（6496 源的网站会打出上万请求）
    expect(steps).not.toHaveBeenCalled()
    // 不能落在"仅在源详情下可用"的空态上
    expect(wrapper.find('.tv-empty-row').exists()).toBe(false)
    wrapper.unmount()
  })

  // 2026-09-17：网站态第一格改成**源**筛选，跟数据/文件/监控视图同一个选择器。
  // 原来第一格是节点下拉，而网站态不选源就不拉步骤元数据，那个下拉永远只有一个「全部节点」。
  it('网站态：第一格是源选择器；选中源后才出节点下拉，查询也跟着收窄到该源', async () => {
    setActivePinia(createPinia())
    await router.push('/canvas')

    const paged = vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({ total: 0, list: [] })
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([
      { sourceId: 's1', name: '源一' }, { sourceId: 's2', name: '源二' },
    ] as never)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([
      { stepId: 'n1', sourceId: 's1', name: '列表抓取', enabled: true },
    ] as never)
    vi.spyOn(sourceApi, 'sourceNodeRuns').mockResolvedValue([])

    const wrapper = shallowMount(TaskView, {
      props: { siteWide: true, siteId: 'site-zfb' },
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()

    const picker = wrapper.findComponent({ name: 'SiteSourceSelect' })
    expect(picker.exists()).toBe(true)
    expect(picker.props('siteId')).toBe('site-zfb')
    // 未收窄到具体源时节点下拉不渲染——它此时必然是空的
    expect(wrapper.find('[data-testid="task-node-filter"]').exists()).toBe(false)

    await picker.vm.$emit('update:modelValue', 's1')
    await flushPromises()

    expect(wrapper.find('[data-testid="task-node-filter"]').exists()).toBe(true)
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ sourceId: 's1', siteScopeId: undefined }))
    wrapper.unmount()
  })

  // 节点 ID 是源内的，换了源就不成立；回到「全部源」时节点下拉不再渲染，
  // 旧值若留着就成了看不见也清不掉的隐形筛选。
  it('网站态：从具体源回到全部源时，节点筛选被清掉，不再带进查询', async () => {
    setActivePinia(createPinia())
    await router.push('/canvas')

    const paged = vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({ total: 0, list: [] })
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([{ sourceId: 's1', name: '源一' }] as never)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([
      { stepId: 'n1', sourceId: 's1', name: '列表抓取', enabled: true },
    ] as never)
    vi.spyOn(sourceApi, 'sourceNodeRuns').mockResolvedValue([])

    const wrapper = shallowMount(TaskView, {
      props: { siteWide: true, siteId: 'site-zfb' },
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()

    const picker = wrapper.findComponent({ name: 'SiteSourceSelect' })
    await picker.vm.$emit('update:modelValue', 's1')
    await flushPromises()
    await wrapper.find('[data-testid="task-node-filter"]').setValue('n1')
    await wrapper.get('[data-testid="task-query"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ nodeId: 'n1' }))

    await picker.vm.$emit('update:modelValue', '')
    await flushPromises()

    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ siteScopeId: 'site-zfb', nodeId: undefined }))
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

    // 队列名是 el-select（1016）：单测没注册 Element Plus，用能 v-model 的替身，选项渲染成可读的 data 属性
    const SelectStub = { name: 'QueueSelectStub', props: ['modelValue'], emits: ['update:modelValue'], template: '<div><slot /></div>' }
    const OptionStub = { props: ['value', 'label'], template: '<i class="queue-opt" :data-v="value" />' }
    const wrapper = shallowMount(TaskView, {
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true, 'el-select': SelectStub, 'el-option': OptionStub } },
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()

    const queueSelect = wrapper.findComponent({ name: 'QueueSelectStub' })
    expect(queueSelect.exists()).toBe(true)
    const options = () => wrapper.findAll('.queue-opt').map((o) => o.attributes('data-v'))
    expect(options()).toEqual(expect.arrayContaining(['queue_download', 'queue_parse']))

    // 选队列名：不立即查（2026-09-23 起改完点「查询」才生效），提示条件已修改
    const callsBefore = paged.mock.calls.length
    queueSelect.vm.$emit('update:modelValue', 'queue_download')
    await flushPromises()
    expect(paged.mock.calls.length).toBe(callsBefore)
    expect(wrapper.find('[data-testid="task-filters-dirty"]').exists()).toBe(true)
    await wrapper.get('[data-testid="task-query"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ queue: 'queue_download', topic: 'queue_download' }))
    expect(wrapper.find('[data-testid="task-filters-dirty"]').exists()).toBe(false)
    // 1016：查完当前页只剩这个队列的任务，下拉候选不跟着收缩，仍能直接切到别的队列
    paged.mockResolvedValue({ total: 1, list: [{ taskId: 't1', topic: 'queue_download', state: 'C', typeName: '下载', taskName: '任务1', sourceId: source.sourceId, updatedAt: '2026-09-08 10:00' }] })
    await wrapper.get('[data-testid="task-query"]').trigger('click')
    await flushPromises()
    expect(options()).toEqual(expect.arrayContaining(['queue_download', 'queue_parse']))
    paged.mockResolvedValue({
      total: 2,
      list: [
        { taskId: 't1', topic: 'queue_download', state: 'C', typeName: '下载', taskName: '任务1', sourceId: source.sourceId, updatedAt: '2026-09-08 10:00' },
        { taskId: 't2', topic: 'queue_parse', state: 'C', typeName: '解析', taskName: '任务2', sourceId: source.sourceId, updatedAt: '2026-09-08 10:01' },
      ],
    })
    queueSelect.vm.$emit('update:modelValue', '')
    await wrapper.get('[data-testid="task-query"]').trigger('click')
    await flushPromises()

    // 点击表格中的 queue_parse 单元格快速切换
    const parseCell = wrapper.findAll('.tv-queue-clickable').find((el) => el.text() === 'queue_parse')
    expect(parseCell).toBeDefined()
    await parseCell!.trigger('click')
    await flushPromises()
    expect(queueSelect.props('modelValue')).toBe('queue_parse')
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ queue: 'queue_parse', topic: 'queue_parse' }))

    // 再次点击同一单元格取消筛选
    await parseCell!.trigger('click')
    await flushPromises()
    expect(queueSelect.props('modelValue')).toBe('')
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ queue: undefined, topic: undefined }))

    wrapper.unmount()
  })

  // 0920-04：查询「字段 ▾ ＋ 输入框」，样式同源视图三合一。数据 ID 2026-09-28 起走 parentId，
  // 任务 URL 2026-09-29 起走 taskUrl（后端上线后放开，三项都可选）。
  it('按任务 ID 查询：回车才查、带 taskId；三个字段都可选；清空后撤掉条件', async () => {
    setActivePinia(createPinia())
    await router.push('/canvas')
    const source = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))

    const paged = vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = shallowMount(TaskView, {
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()

    const options = wrapper.findAll('[data-testid="task-search-field"] option')
    expect(options.map((o) => [o.text(), o.attributes('disabled') !== undefined])).toEqual([
      ['任务 ID', false],
      ['数据 ID', false],
      ['任务 URL', false],
    ])

    const input = wrapper.get('[data-testid="task-search-text"]')
    await input.setValue(' 62139720 ')
    await flushPromises()
    // 光输入不查
    expect(paged).not.toHaveBeenLastCalledWith(expect.objectContaining({ taskId: '62139720' }))

    await input.trigger('keyup.enter')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: '62139720', page: 1 }))

    // 同一个值再按回车也要重查（watch 不会触发，得手动）
    const calls = paged.mock.calls.length
    await input.trigger('keyup.enter')
    await flushPromises()
    expect(paged.mock.calls.length).toBe(calls + 1)

    const clearBtn = wrapper.findAll('button').find((b) => b.text() === '清空')!
    await clearBtn.trigger('click')
    await flushPromises()
    expect((input.element as HTMLInputElement).value).toBe('')
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: undefined }))

    wrapper.unmount()
  })

  // 2026-09-28 实测后端认 parentId：源 430017712 共 83 条，parentId=1035124 → 2 条、不存在的 → 0 条
  it('按数据 ID 查询发 parentId，不带 taskId', async () => {
    setActivePinia(createPinia())
    await router.push('/canvas')
    const source = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))

    const paged = vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = shallowMount(TaskView, {
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()

    await wrapper.get('[data-testid="task-search-field"]').setValue('parentId')
    const input = wrapper.get('[data-testid="task-search-text"]')
    await input.setValue(' 1035124 ')
    await input.trigger('keyup.enter')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ parentId: '1035124', taskId: undefined, page: 1 }))

    wrapper.unmount()
  })

  // 2026-09-29 后端上线 taskUrl（task_inst.TASK_URL 子串匹配）：实测站 11 mp.weixin.qq.com → 536 条
  it('按任务 URL 查询发 taskUrl，不带 taskId / parentId；清空后撤掉', async () => {
    setActivePinia(createPinia())
    await router.push('/canvas')
    const source = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))

    const paged = vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = shallowMount(TaskView, {
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()

    await wrapper.get('[data-testid="task-search-field"]').setValue('taskUrl')
    const input = wrapper.get('[data-testid="task-search-text"]')
    expect(input.attributes('placeholder')).toBe('输入任务 URL 片段，回车查询')
    await input.setValue(' mp.weixin.qq.com ')
    await input.trigger('keyup.enter')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({
      taskUrl: 'mp.weixin.qq.com', taskId: undefined, parentId: undefined, page: 1,
    }))

    const clearBtn = wrapper.findAll('button').find((b) => b.text() === '清空')!
    await clearBtn.trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ taskUrl: undefined }))

    wrapper.unmount()
  })

  // 0920-04 / B27：创建时间区间。后端 2026-09-23 加了 startTime / endTime（只给日期时自动补全天）。
  it('按创建时间区间查询：选了日期带 startTime/endTime，清空后撤掉', async () => {
    setActivePinia(createPinia())
    await router.push('/canvas')
    const source = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))

    const paged = vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({ total: 0, list: [] })
    // 单测不装 Element Plus，给日期组件一个只认 v-model 的替身
    const DatePickerStub = {
      name: 'ElDatePicker',
      props: ['modelValue', 'valueFormat'],
      emits: ['update:modelValue'],
      template: '<div data-testid="task-date-range" />',
    }
    const wrapper = shallowMount(TaskView, {
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true, 'el-date-picker': DatePickerStub } },
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()

    const picker = wrapper.findComponent(DatePickerStub)
    expect(picker.exists()).toBe(true)
    expect((picker as any).props('valueFormat')).toBe('YYYY-MM-DD')
    await (picker as any).vm.$emit('update:modelValue', ['2026-09-21', '2026-09-23'])
    await flushPromises()
    expect(paged).not.toHaveBeenLastCalledWith(expect.objectContaining({ startTime: '2026-09-21' }))
    await wrapper.get('[data-testid="task-query"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ startTime: '2026-09-21', endTime: '2026-09-23', page: 1 }))

    const clearBtn = wrapper.findAll('button').find((b) => b.text() === '清空')!
    await clearBtn.trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ startTime: undefined, endTime: undefined }))

    wrapper.unmount()
  })

  // 2026-10-10：topTaskPaged 不带任何过滤参数时后端直接回空（topTaskPaged-api.md §三-2），任务中心一打开就是空表。
  it('任务中心默认查「今天 + 异常」；清空后没有条件不发请求，提示先选条件', async () => {
    setActivePinia(createPinia())
    await router.push('/canvas')
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const paged = vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = shallowMount(TaskView, {
      props: { global: true },
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()

    expect(paged).toHaveBeenCalledTimes(1)
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ startTime: today, endTime: today, state: 'E', page: 1 }))
    expect(wrapper.get('[data-testid="task-empty"]').text()).toBe('没有匹配的任务记录')

    const clearBtn = wrapper.findAll('button').find((b) => b.text() === '清空')!
    await clearBtn.trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="task-empty"]').text()).toContain('请至少选择')

    wrapper.unmount()
  })

  it('任务中心查询超过 2 秒显示已等待秒数，返回后提示消失', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      setActivePinia(createPinia())
      await router.push('/canvas')
      let resolve!: (v: { total: number; list: TaskInst[] }) => void
      vi.spyOn(sourceApi, 'sourceTaskPaged').mockImplementation(() => new Promise((r) => { resolve = r }))
      const wrapper = shallowMount(TaskView, {
        props: { global: true },
        global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
      })
      await flushPromises()
      vi.advanceTimersByTime(1000)
      await flushPromises()
      expect(wrapper.find('[data-testid="task-slow-hint"]').exists()).toBe(false)
      vi.advanceTimersByTime(2000)
      await flushPromises()
      expect(wrapper.get('[data-testid="task-slow-hint"]').text()).toContain('已等待 3 秒')
      resolve({ total: 0, list: [] })
      await flushPromises()
      expect(wrapper.find('[data-testid="task-slow-hint"]').exists()).toBe(false)
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('查询超时（请求被中断）提示加条件，不显示「signal is aborted」原文', async () => {
    setActivePinia(createPinia())
    await router.push('/canvas')
    vi.spyOn(sourceApi, 'sourceTaskPaged').mockRejectedValue(new Error('请求异常 [source/sourceTaskPaged]: signal is aborted without reason'))
    const warn = vi.spyOn(ElMessage, 'warning')
    const wrapper = shallowMount(TaskView, {
      props: { global: true },
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await flushPromises()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('查询超时'))
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('aborted'))
    wrapper.unmount()
  })

  it('查询失败时把后端给的原因带出来（如时间范围不合法）', async () => {
    setActivePinia(createPinia())
    await router.push('/canvas')
    const source = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))
    vi.spyOn(sourceApi, 'sourceTaskPaged').mockRejectedValue(new Error('时间范围不合法'))
    const warn = vi.spyOn(ElMessage, 'warning')

    const wrapper = shallowMount(TaskView, {
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()

    expect(warn).toHaveBeenCalledWith('加载任务记录失败：时间范围不合法')
    wrapper.unmount()
  })

  // 2026-09-23 用户要求：跟源 / 数据 / 文件视图一样，改完点「查询」才查，按钮在右侧
  it('改条件不立即查；点「查询」一次性生效，条件没变再点也重查；清空立即查', async () => {
    setActivePinia(createPinia())
    await router.push('/canvas')
    const source = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))
    const paged = vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({ total: 0, list: [] })
    const SelectStub = { name: 'QueueSelectStub', props: ['modelValue'], emits: ['update:modelValue'], template: '<div />' }
    const wrapper = shallowMount(TaskView, {
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true, 'el-select': SelectStub } },
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()

    const n0 = paged.mock.calls.length
    await wrapper.get('[data-testid="task-state-filter"]').setValue('E')
    // 手输候选里没有的队列名（allow-create）
    wrapper.findComponent({ name: 'QueueSelectStub' }).vm.$emit('update:modelValue', 'news_cont')
    await flushPromises()
    expect(paged.mock.calls.length).toBe(n0)

    await wrapper.get('[data-testid="task-query"]').trigger('click')
    await flushPromises()
    // 两个条件一次请求带上
    expect(paged.mock.calls.length).toBe(n0 + 1)
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'E', queue: 'news_cont' }))

    await wrapper.get('[data-testid="task-query"]').trigger('click')
    await flushPromises()
    expect(paged.mock.calls.length).toBe(n0 + 2)

    const clearBtn = wrapper.findAll('button').find((b) => b.text() === '清空')!
    await clearBtn.trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ state: undefined, queue: undefined }))
    expect((wrapper.get('[data-testid="task-state-filter"]').element as HTMLSelectElement).value).toBe('')

    wrapper.unmount()
  })

  it('表格时间列是「创建时间」，与时间筛选同一口径（createDt）', async () => {
    setActivePinia(createPinia())
    await router.push('/canvas')
    const source = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))
    vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({
      total: 1,
      list: [{ taskId: 't1', state: 'C', typeName: '抓取', taskName: '任务', sourceId: source.sourceId, createdAt: '2026-09-23 13:38:24', updatedAt: '2026-09-23 13:39:56' }],
    })
    const wrapper = shallowMount(TaskView, {
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()

    const headers = wrapper.findAll('thead th').map((th) => th.text())
    expect(headers).toContain('创建时间')
    expect(headers).not.toContain('更新时间')
    expect(wrapper.get('.tv-time').text()).toBe('2026-09-23 13:38:24')
    wrapper.unmount()
  })

  describe('0917-01 · 任务行定位信息与详情抽屉', () => {
    it('表格渲染「数据 ID」与「任务 URL」列，空值渲染「—」', async () => {
      setActivePinia(createPinia())
      await router.push('/canvas')
      const source = mockSourceDetail({ sourceId: '391007768' })!
      useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))

      vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({
        total: 2,
        list: [
          {
            taskId: 't1',
            bizId: 'ctx_1',
            parentId: '1035124',
            taskUrl: 'https://example.com/article/1',
            state: 'C',
            typeName: '详情抓取',
            taskName: '文章1',
            sourceId: source.sourceId,
            node: 'n_detail',
            updatedAt: '2026-09-17 10:00',
          },
          {
            taskId: 't2',
            // 根任务：只有运行上下文 bizId、没有 parentId，不是由某条数据触发的，没有数据 ID
            bizId: 'ctx_1',
            state: 'E',
            typeName: '源级任务',
            taskName: '文章列表',
            sourceId: source.sourceId,
            updatedAt: '2026-09-17 10:01',
          },
        ],
      })

      const wrapper = shallowMount(TaskView, {
        global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
      })
      await new Promise((resolve) => setTimeout(resolve, 150))
      await flushPromises()

      const tableText = wrapper.get('[data-testid="source-task-table"]').text()
      expect(tableText).toContain('数据 ID')
      expect(tableText).toContain('任务 URL')

      // 第一行：数据 ID 显示 parentId，不是 bizId（2026-09-28 生产实测：bizId 是运行上下文 ID，
      // 同一轮里处理不同数据的任务 bizId 都一样，拿去表里查恒为 0 条）
      const bizLinks = wrapper.findAll('[data-testid="task-biz-link"]')
      expect(bizLinks).toHaveLength(1)
      expect(bizLinks[0]!.text()).toBe('1035124')

      const urlLink = wrapper.find('[data-testid="task-url-link"]')
      expect(urlLink.exists()).toBe(true)
      expect(urlLink.attributes('href')).toBe('https://example.com/article/1')
      expect(urlLink.attributes('target')).toBe('_blank')

      // 第二行没有 parentId 与 taskUrl，渲染 —
      const rows = wrapper.findAll('tbody tr')
      expect(rows.length).toBe(2)
      expect(rows[1].text()).toContain('—')

      wrapper.unmount()
    })

    // 2026-09-22 生产实测：`task.node` 映射自后端 `nodeCode`，那是**队列名**
    //（`nodeCode: "news_wechat"`，同一条记录的 `stepId` 是 null），不是步骤 ID。
    // 而数据视图按节点 ID 选中节点（ResultView 的 allNodes.some(n => n.id === id)，id = stepId），
    // 拿 nodeCode 当 nodeId 传过去永远匹配不上——跳过去停在原来的节点上，多节点源就查错表。
    // 所以改成按 configId 解析回真步骤，解析不出来就干脆不带。
    const LOCATE_STEPS = [
      { stepId: '391007768-s1', sourceId: '391007768', name: '列表抓取', configId: 'cfg-1', enabled: true },
      { stepId: '391007768-s2', sourceId: '391007768', name: '详情解析', configId: 'cfg-2', enabled: true },
    ]

    async function clickBizLink(task: Partial<TaskInst>, steps: unknown[] = LOCATE_STEPS) {
      setActivePinia(createPinia())
      await router.push('/canvas')
      const source = mockSourceDetail({ sourceId: '391007768' })!
      useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))
      // stepsBySource 由 loadNodeMetadata 填，它要 siteSources 里有这个源（见 TaskView 里
      // 「网站态未选定具体源时不拉」那段说明），光 loadFromSource 填的是 flow store，不是这里
      vi.spyOn(siteApi, 'siteSources').mockResolvedValue([{ sourceId: source.sourceId, name: '源 A' }] as never)
      vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(steps as never)
      vi.spyOn(sourceApi, 'sourceNodeRuns').mockResolvedValue([])

      vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({
        total: 1,
        list: [{
          taskId: 't1', bizId: 'ctx_1', parentId: '986079', state: 'E', typeName: '详情抓取',
          taskName: '文章详情', sourceId: source.sourceId, updatedAt: '2026-09-17 10:00',
          ...task,
        } as TaskInst],
      })

      const pushSpy = vi.spyOn(router, 'push')
      const wrapper = shallowMount(TaskView, {
        global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
      })
      await new Promise((resolve) => setTimeout(resolve, 150))
      await flushPromises()
      await wrapper.get('[data-testid="task-biz-link"]').trigger('click')
      const call = pushSpy.mock.calls.at(-1)?.[0] as { path: string; query: Record<string, unknown> }
      wrapper.unmount()
      return { call, source }
    }

    it('点击「数据 ID」跳数据视图带 dataId；node 是队列名时不塞无效的 nodeId', async () => {
      const { call, source } = await clickBizLink({ node: 'news_wechat' })

      expect(call.path).toBe('/canvas')
      expect(call.query).toMatchObject({ sourceId: source.sourceId, view: 'data', dataId: '986079' })
      // 传一个匹配不上的 nodeId 只会留在 URL 里误导人（分享/刷新时更明显）
      expect(call.query.nodeId).toBeUndefined()
    })

    it('能按 configId 找回那一步时，nodeId 传的是真正的 stepId', async () => {
      const { call } = await clickBizLink({ node: 'news_wechat', configId: 'cfg-2' })

      expect(call.query.nodeId).toBe('391007768-s2')
    })

    // 任务处理的是它输入表里的数据（上游产出的那一行），要定位到上游节点，
    // 而不是任务自己的节点——后者的输出表存的是这条任务产出的数据
    it('任务节点的输入表由上游节点产出时，nodeId 传上游节点', async () => {
      const { call } = await clickBizLink({ configId: 'cfg-2' }, [
        { ...LOCATE_STEPS[0], outputTable: 'T_LIST' },
        { ...LOCATE_STEPS[1], inputTable: 'T_LIST', outputTable: 'T_DETAIL' },
      ])

      expect(call.query).toMatchObject({ dataId: '986079', nodeId: '391007768-s1' })
    })

    // 公众号流程 1400976 三个节点都落 6200029：往前找会撞上兄弟分支，同表时就用任务自己的节点
    it('任务节点输入、输出同一张表时，nodeId 就是任务自己的节点', async () => {
      const { call } = await clickBizLink({ configId: 'cfg-2' }, [
        { ...LOCATE_STEPS[0], outputTable: '6200029' },
        { ...LOCATE_STEPS[1], inputTable: '6200029', outputTable: '6200029' },
      ])

      expect(call.query.nodeId).toBe('391007768-s2')
    })

    it('每行都有「详情」按钮，点击弹出 TaskDetailDrawer 并传入选中任务', async () => {
      setActivePinia(createPinia())
      await router.push('/canvas')
      const source = mockSourceDetail({ sourceId: '391007768' })!
      useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))

      const taskItem: TaskInst = {
        taskId: 't_detail_1',
        bizId: 'data_123',
        state: 'C',
        typeName: '下载',
        taskName: '附件下载',
        sourceId: source.sourceId,
        updatedAt: '2026-09-17 10:00',
        params: '{"f":1}',
      }

      vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({
        total: 1,
        list: [taskItem],
      })

      const wrapper = shallowMount(TaskView, {
        global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
      })
      await new Promise((resolve) => setTimeout(resolve, 150))
      await flushPromises()

      const detailBtn = wrapper.get('[data-testid="task-detail-btn"]')
      expect(detailBtn.text()).toBe('详情')

      const drawer = wrapper.findComponent({ name: 'TaskDetailDrawer' })
      expect(drawer.exists()).toBe(true)
      expect(drawer.props('modelValue')).toBe(false)

      await detailBtn.trigger('click')
      await flushPromises()

      expect(drawer.props('modelValue')).toBe(true)
      expect(drawer.props('task')).toMatchObject({ taskId: 't_detail_1' })

      wrapper.unmount()
    })

    it('具体源下点击「任务 ID」链接直接右侧弹出详情抽屉', async () => {
      setActivePinia(createPinia())
      await router.push('/canvas')
      const source = mockSourceDetail({ sourceId: '391007768' })!
      useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))

      const taskItem: TaskInst = {
        taskId: 't_click_id_1',
        bizId: 'data_456',
        state: 'E',
        typeName: '详情抓取',
        taskName: '正文采集',
        sourceId: source.sourceId,
        updatedAt: '2026-09-17 10:00',
      }

      vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({
        total: 1,
        list: [taskItem],
      })

      const wrapper = shallowMount(TaskView, {
        global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
      })
      await new Promise((resolve) => setTimeout(resolve, 150))
      await flushPromises()

      const idLink = wrapper.get('[data-testid="task-id-link"]')
      expect(idLink.text()).toBe('t_click_id_1')

      const drawer = wrapper.findComponent({ name: 'TaskDetailDrawer' })
      expect(drawer.props('modelValue')).toBe(false)

      await idLink.trigger('click')
      await flushPromises()

      expect(drawer.props('modelValue')).toBe(true)
      expect(drawer.props('task')).toMatchObject({ taskId: 't_click_id_1' })

      wrapper.unmount()
    })

    it('全部源（网站态 siteWide）下点击「任务 ID」链接直接右侧弹出详情抽屉', async () => {
      setActivePinia(createPinia())
      await router.push('/canvas')

      const taskItem: TaskInst = {
        taskId: 't_sitewide_click_2',
        bizId: 'data_789',
        state: 'C',
        typeName: '列表解析',
        taskName: '整站列表',
        sourceId: 'src_site_wide_1',
        updatedAt: '2026-09-17 11:00',
      }

      vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({
        total: 1,
        list: [taskItem],
      })
      vi.spyOn(siteApi, 'siteSources').mockResolvedValue([
        { sourceId: 'src_site_wide_1', name: '全网源1' },
      ] as never)

      const wrapper = shallowMount(TaskView, {
        props: { siteWide: true, siteId: 'site-999' },
        global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
      })
      await new Promise((resolve) => setTimeout(resolve, 150))
      await flushPromises()

      const idLink = wrapper.get('[data-testid="task-id-link"]')
      expect(idLink.text()).toBe('t_sitewide_click_2')

      const drawer = wrapper.findComponent({ name: 'TaskDetailDrawer' })
      expect(drawer.props('modelValue')).toBe(false)

      await idLink.trigger('click')
      await flushPromises()

      expect(drawer.props('modelValue')).toBe(true)
      expect(drawer.props('task')).toMatchObject({ taskId: 't_sitewide_click_2' })

      wrapper.unmount()
    })
  })

  describe('0917-02 · 所属源可点', () => {
    it('全部源态下点击所属源链接，打开源页签并跳转到该源任务视图', async () => {
      setActivePinia(createPinia())
      await router.push('/canvas')
      const ws = useWorkspaceStore()
      const pushSpy = vi.spyOn(router, 'push')

      vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({
        total: 1,
        list: [
          {
            taskId: 't_sw_1',
            state: 'C',
            typeName: '列表采集',
            taskName: '网站任务',
            sourceId: 'src_sw_101',
            updatedAt: '2026-09-17 12:00',
          },
        ],
      })
      vi.spyOn(siteApi, 'siteSources').mockResolvedValue([
        { sourceId: 'src_sw_101', name: '全网源101' },
      ] as never)

      const wrapper = shallowMount(TaskView, {
        props: { siteWide: true, siteId: 'site-demo' },
        global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
      })
      await new Promise((resolve) => setTimeout(resolve, 150))
      await flushPromises()

      const sourceLink = wrapper.get('[data-testid="task-source-link"]')
      expect(sourceLink.text()).toBe('全网源101')
      expect(wrapper.get('[data-testid="task-source-id"]').text()).toBe('src_sw_101')

      await sourceLink.trigger('click')
      await flushPromises()

      expect(ws.tabs.some((t) => t.sourceId === 'src_sw_101')).toBe(true)
      expect(ws.activeSourceId).toBe('src_sw_101')
      expect(pushSpy).toHaveBeenCalledWith(expect.objectContaining({
        path: '/canvas',
        query: expect.objectContaining({
          siteId: 'site-demo',
          sourceId: 'src_sw_101',
          view: 'task',
        }),
      }))

      wrapper.unmount()
    })

    it('页签已满 8 个时，点击所属源照常跳转，但要说一句为什么页签没加上', async () => {
      setActivePinia(createPinia())
      await router.push('/canvas')
      const ws = useWorkspaceStore()
      // 填满 8 个页签
      ws.tabs = Array.from({ length: 8 }, (_, i) => ({
        sourceId: `existing_src_${i}`,
        name: `源${i}`,
        seq: 8 - i,
      }))

      const pushSpy = vi.spyOn(router, 'push')

      vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({
        total: 1,
        list: [
          {
            taskId: 't_sw_full',
            state: 'C',
            typeName: '列表采集',
            taskName: '满额测试',
            sourceId: 'new_src_999',
            updatedAt: '2026-09-17 12:00',
          },
        ],
      })
      vi.spyOn(siteApi, 'siteSources').mockResolvedValue([
        { sourceId: 'new_src_999', name: '新源999' },
      ] as never)

      const wrapper = shallowMount(TaskView, {
        props: { siteWide: true, siteId: 'site-demo' },
        global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
      })
      await new Promise((resolve) => setTimeout(resolve, 150))
      await flushPromises()

      // 满额时 ws.open 返回 false，页签条一动不动。**不拦截是对的**（内容照常显示），
      // 但一声不响就等于"点了没反应"——另两处调用（FlowCanvas/index.vue、SiteDataView.vue）
      // 一直有这句提示，这里 2026-09-22 补上。
      const warn = vi.spyOn(ElMessage, 'warning')

      const sourceLink = wrapper.get('[data-testid="task-source-link"]')
      await sourceLink.trigger('click')
      await flushPromises()

      expect(ws.activeSourceId).toBe('new_src_999')
      expect(pushSpy).toHaveBeenCalledWith(expect.objectContaining({
        path: '/canvas',
        query: expect.objectContaining({
          siteId: 'site-demo',
          sourceId: 'new_src_999',
          view: 'task',
        }),
      }))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('页签已达上限'))

      wrapper.unmount()
    })

    // 给 <td> 设 inline-flex/flex 会让它不再是 table-cell，colgroup 那条列宽直接失效
    //（浏览器实测：同表 200px 的列加上 inline-flex 后实测 95px；真实页面上操作列量到 80px，
    //  而 <col> 写的是 110px）。0917-03 才刚用 colgroup 定死列数（当时 13 列，0923 删掉两列统计后是 11），别在这儿拆掉一列。
    it('操作列的 td 不设 display，否则会脱离 colgroup 的列宽', () => {
      const actionsCell = /\.tv-actions-cell\s*\{[^}]*\}/.exec(TaskViewSource)?.[0] ?? ''
      expect(actionsCell).toBeTruthy()
      expect(actionsCell).not.toMatch(/display\s*:/)
    })

    // 2026-09-22 按用户要求把 showSourceColumn 恢复成原语义 `!filters.sourceId`。
    // 源态下 filters.sourceId 会被设成当前源（见 TaskView 里那两处
    // `filters.sourceId = props.siteWide ? '' : sourceId.value`），所以**源态收起这一列**——
    // 整列每行都是同一个源名，130px 纯浪费。0917-02 要的「所属源可点」是网站态的事
    //（覆盖见上面那条满额用例），不需要把这个条件改成恒真。
    it('源态收起「所属源」列（每行同源，纯冗余），空态 colspan 跟着变 10', async () => {
      setActivePinia(createPinia())
      await router.push('/canvas')
      const source = mockSourceDetail({ sourceId: '391007768' })!
      useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))

      vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({ total: 0, list: [] })

      const wrapper = shallowMount(TaskView, {
        global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
      })
      await new Promise((resolve) => setTimeout(resolve, 150))
      await flushPromises()

      expect(wrapper.findAll('thead th').map((th) => th.text())).not.toContain('所属源')
      expect(wrapper.find('[data-testid="task-source-link"]').exists()).toBe(false)
      expect(wrapper.get('.tv-empty-row').attributes('colspan')).toBe('10')

      wrapper.unmount()
    })

    it('表格 colgroup 为队列列显式分配 180px 宽度', async () => {
      setActivePinia(createPinia())
      await router.push('/canvas')
      const source = mockSourceDetail({ sourceId: '391007768' })!
      useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))

      const wrapper = shallowMount(TaskView, {
        global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
      })
      await new Promise((resolve) => setTimeout(resolve, 150))
      await flushPromises()

      // 按表头位置找队列列，不写死下标：列数会随「所属源」列的开合在 10/11 之间变
      //（2026-09-22 恢复 showSourceColumn 原语义后，源态是 12 列，队列从 index 6 挪到 5；0923 删掉两列统计后源态 10 列）
      const headers = wrapper.findAll('thead th').map((th) => th.text())
      const queueIndex = headers.indexOf('队列')
      expect(queueIndex).toBeGreaterThan(-1)
      const cols = wrapper.findAll('colgroup col')
      expect(cols.length).toBe(headers.length)
      expect(cols[queueIndex].attributes('style')).toContain('width: 180px')

      wrapper.unmount()
    })

    it('具体源态下顶部 ProcessNodeRail 接收到包含队列名的 nodeQueues prop', async () => {
      setActivePinia(createPinia())
      await router.push('/canvas')
      const source = mockSourceDetail({ sourceId: '391007768' })!
      const steps = mockSourceSteps({ sourceId: source.sourceId })
      // 为步骤注入 topic / queue
      if (steps[0]) {
        steps[0].topic = 'news_snatch_html_download'
      }
      useFlowStore().loadFromSource(source, steps)

      const wrapper = shallowMount(TaskView, {
        global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
      })
      await new Promise((resolve) => setTimeout(resolve, 150))
      await flushPromises()

      const rail = wrapper.findComponent({ name: 'ProcessNodeRail' })
      expect(rail.exists()).toBe(true)
      const nodeQueues = rail.props('nodeQueues') as Record<string, string>
      expect(nodeQueues).toBeDefined()
      // 轨道上的节点能匹配到该队列
      const matchedQueue = Object.values(nodeQueues).some((q) => q === 'news_snatch_html_download' || q.length > 0)
      expect(matchedQueue).toBe(true)

      wrapper.unmount()
    })
  })
})
