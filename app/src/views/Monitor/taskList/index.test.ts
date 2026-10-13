// @vitest-environment jsdom
// 任务实例（旧 page/inst/TaskInst.vue → Monitor/taskList/index.vue）接线回归。
// 与 queueCheck / commJob 的 index.test.ts 同一套思路：只验证「每个操作调到了哪条接口、带了什么参数」——
// 旧页这一列操作本来就是直连后端，迁到新平台最容易出问题的地方是接线断了或落回 mock。
// 另外单独守住旧页那个「查询按钮回第 1 页 / 状态下拉保持当前页」的双路径（旧 handleRefresh vs searchTasks）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { h } from 'vue'
import ElementPlus from 'element-plus'
import TaskListPage from './index.vue'
import * as taskApi from '../../../api/taskList'
import { confirmDanger } from '@/utils/confirmDanger'
import type { TaskRow } from '../../../api/taskList'

// Element Plus 的表格内部用 ResizeObserver 量宽，jsdom 没有
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

// confirmDanger 真实实现要弹 ElMessageBox（jsdom 里点不到「确认执行」），默认直接放行动作本身；
// 个别用例可以覆盖成「用户点取消」。
vi.mock('@/utils/confirmDanger', () => ({
  confirmDanger: vi.fn((_title: string, _body: string, run: () => unknown) => run()),
  confirmOrRun: vi.fn((_need: boolean, _t: string, _b: string, run: () => unknown) => run()),
}))

// 组件从 $route.query 接钻取参数（旧页走 props）；测试里没有真实 router，给个空 query 即可
// （真实应用里 app.use(router) 会在应用级 provide routeLocationKey，任意组件都能 useRoute()）
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
}))

const openConfig = vi.fn()

function row(over: Partial<TaskRow> = {}): TaskRow {
  return {
    taskId: '8348509120',
    state: 'C',
    taskSpecId: '2001',
    actionName: '浏览器抓取',
    taskName: '首页列表抓取',
    sourceId: '161725',
    configId: '70598',
    updateDt: '2026-10-13 08:00:00',
    nodeCode: 'dev_web_snatch_zfb',
    taskTopic: 'queue_70598',
    parentId: '',
    ...over,
  }
}

const ROWS: TaskRow[] = [
  row({ taskId: '8348509120', state: 'C' }),
  row({ taskId: '8348509131', state: 'L', configId: '70611' }),
  row({ taskId: '8348509140', state: 'E', taskSpecId: '2003' }),
  row({ taskId: '8348509152', state: 'AC', parentId: '8348509140' }),
]

const stubs = {
  // inheritAttrs:false —— ElTooltip 会把 popperOptions 之类的对象 attrs 透传下来；若落到 stub 的
  // span 上，jsdom 做 DOMString 转换时会抛 "Cannot convert object to primitive value"。
  ElTooltip: {
    name: 'ElTooltip',
    inheritAttrs: false,
    template: '<span class="stub-tooltip"><slot /></span>',
  },
  ElPagination: {
    name: 'ElPagination',
    props: ['currentPage', 'pageSize', 'total'],
    emits: ['current-change', 'size-change'],
    template: '<div class="stub-pager" />',
  },
  ElDatePicker: {
    name: 'ElDatePicker',
    props: ['modelValue'],
    emits: ['update:modelValue', 'change'],
    template: '<div class="stub-date" />',
  },
  // 真 ElCheckbox 没在 emits 里声明 update:modelValue，测试里直接 $emit 会打一条 Vue warn；stub 掉更干净
  ElCheckbox: {
    name: 'ElCheckbox',
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<label class="stub-checkbox"><slot /></label>',
  },
  TaskDetailDrawer: {
    name: 'TaskDetailDrawer',
    props: ['modelValue', 'record'],
    template: '<div class="stub-detail" />',
  },
  ConfigTemplateDrawer: {
    name: 'ConfigTemplateDrawer',
    setup(_p: unknown, { expose }: { expose: (o: Record<string, unknown>) => void }) {
      expose({ open: openConfig })
      return () => h('div', { class: 'stub-config' })
    },
  },
}

function mountPage() {
  return mount(TaskListPage, { global: { plugins: [ElementPlus], stubs } })
}

const pagedSpy = () => vi.spyOn(taskApi, 'taskInstPaged').mockResolvedValue({ total: ROWS.length, list: ROWS })

async function selectRows(wrapper: VueWrapper, ids: string[]) {
  const selected = ROWS.filter((r) => ids.includes(r.taskId))
  wrapper.findComponent({ name: 'ElTable' }).vm.$emit('selection-change', selected)
  await flushPromises()
}
const btn = (wrapper: VueWrapper, text: string) =>
  wrapper.findAll('button').find((b) => b.text().trim() === text)!
const resendBtn = (wrapper: VueWrapper) =>
  wrapper.findAll('button').find((b) => b.text().trim() === '重发')!
const resendDisabled = (wrapper: VueWrapper) => (resendBtn(wrapper).element as HTMLButtonElement).disabled
/** 行内元素只在真实数据行里找（ElTable 会额外渲染一份 hidden-columns 量宽树） */
const cell = (wrapper: VueWrapper, selector: string) => wrapper.findAll(`tr.el-table__row ${selector}`)
/** 触发分页组件翻页（ElPagination 已 stub） */
async function goPage(wrapper: VueWrapper, page: number) {
  wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', page)
  await flushPromises()
}
/** 查当前组件里「最后一次 load」用的 page */
function lastPage(spy: ReturnType<typeof pagedSpy>): unknown {
  const calls = spy.mock.calls
  return (calls[calls.length - 1][0] as { page?: unknown }).page
}

beforeEach(() => openConfig.mockClear())
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('任务实例 · 查询与分页（对齐旧 TaskInst）', () => {
  it('首屏按旧契约查询：page 1 / limit 20 / state 空，且带上全部筛选键', async () => {
    const paged = pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    expect(paged).toHaveBeenCalledTimes(1)
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({
      page: 1, limit: 20, state: '',
      taskId: '', sourceId: '', sourceIds: '', taskUrl: '', siteId: '', groupId: '',
      configId: '', parentId: '', taskSpecId: '', fileId: '', taskTopic: '',
      startTime: '', endTime: '', all: '',
    }))
    expect(wrapper.text()).toContain('8348509120')
    expect(wrapper.text()).toContain('首页列表抓取')
  })

  it('「查询」按钮带上条件并回到第 1 页（旧 searchTasks → refresh(true)）', async () => {
    const paged = pagedSpy()
    const wrapper = mountPage()
    await flushPromises()
    await goPage(wrapper, 3)
    expect(lastPage(paged)).toBe(3)

    await wrapper.get('input[placeholder="任务ID"]').setValue('8348509131')
    await btn(wrapper, '查询').trigger('click')
    await flushPromises()

    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: '8348509131', page: 1 }))
  })

  it('状态下拉改完立刻查，且**保持当前页**（旧 @change="handleRefresh" → refresh(false)）', async () => {
    const paged = pagedSpy()
    const wrapper = mountPage()
    await flushPromises()
    await goPage(wrapper, 2)

    const select = wrapper.findComponent({ name: 'ElSelect' })
    select.vm.$emit('update:modelValue', 'E')
    select.vm.$emit('change', 'E')
    await flushPromises()

    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'E', page: 2 }))
  })

  it('回车分两组：任务ID / 任务规格 → 保持当前页；任务URL / 源IDs / 队列 → 回第 1 页', async () => {
    const paged = pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    await goPage(wrapper, 4)
    await wrapper.get('input[placeholder="任务ID"]').trigger('keyup.enter')
    await flushPromises()
    expect(lastPage(paged)).toBe(4)

    await wrapper.get('input[placeholder="URL片断"]').trigger('keyup.enter')
    await flushPromises()
    expect(lastPage(paged)).toBe(1)

    await goPage(wrapper, 5)
    await wrapper.get('input[placeholder="逗号分隔"]').trigger('keyup.enter')
    await flushPromises()
    expect(lastPage(paged)).toBe(1)

    await goPage(wrapper, 6)
    await wrapper.get('input[placeholder="队列名片段"]').trigger('keyup.enter')
    await flushPromises()
    expect(lastPage(paged)).toBe(1)
  })

  it('「展示类」勾选 → all="1" 并回第 1 页（旧 onAllChange → searchTasks）', async () => {
    const paged = pagedSpy()
    const wrapper = mountPage()
    await flushPromises()
    await goPage(wrapper, 2)

    // 注意用驼峰事件名：Element Plus 内部 emit 的是 'update:modelValue'，
    // 用连字符 'update:model-value' 会与 emits 声明对不上（Vue 会打一条 warn）
    wrapper.findComponent({ name: 'ElCheckbox' }).vm.$emit('update:modelValue', true)
    await flushPromises()

    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ all: '1', page: 1 }))
  })

  it('「当天」按钮把创建时间设成今天并回第 1 页（旧 selectToday）', async () => {
    const paged = pagedSpy()
    const wrapper = mountPage()
    await flushPromises()
    await goPage(wrapper, 2)

    const today = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const iso = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`

    await btn(wrapper, '当天').trigger('click')
    await flushPromises()

    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ startTime: iso, endTime: iso, page: 1 }))
  })

  it('每页条数变化 → 回第 1 页并带新 limit', async () => {
    const paged = pagedSpy()
    const wrapper = mountPage()
    await flushPromises()
    await goPage(wrapper, 3)

    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('size-change', 100)
    await flushPromises()

    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 100, page: 1 }))
  })
})

describe('任务实例 · 重发', () => {
  it('「重发」常显：未勾选置灰；勾选后批量重发用勾选的 taskId，并清勾选 + 刷新', async () => {
    const paged = pagedSpy()
    const resend = vi.spyOn(taskApi, 'resendTask').mockResolvedValue({ message: '已重置为待发送:2' })
    const wrapper = mountPage()
    await flushPromises()

    expect(resendBtn(wrapper).text()).toBe('重发')
    expect(resendDisabled(wrapper)).toBe(true)
    expect(wrapper.find('.tl-op-bar').exists()).toBe(true)

    await selectRows(wrapper, ['8348509120', '8348509131'])
    expect(resendDisabled(wrapper)).toBe(false)
    expect(wrapper.text()).toContain('已选 2 条')

    await resendBtn(wrapper).trigger('click')
    await flushPromises()

    expect(resend).toHaveBeenLastCalledWith(['8348509120', '8348509131'])
    // 旧版每次重发后都清空勾选并刷新
    expect(resendDisabled(wrapper)).toBe(true)
    expect(paged).toHaveBeenCalledTimes(2)
  })

  it('行内「重发」用该行 taskId（旧 handleResend）', async () => {
    pagedSpy()
    const resend = vi.spyOn(taskApi, 'resendTask').mockResolvedValue({ message: '已重置为待发送:8348509120' })
    const wrapper = mountPage()
    await flushPromises()

    await cell(wrapper, '.tl-actions')[0].findAll('.tl-op-link')
      .find((el) => el.text().trim() === '重发')!.trigger('click')
    await flushPromises()

    expect(resend).toHaveBeenLastCalledWith(['8348509120'])
  })

  it('确认框点「取消」：不发接口、不清勾选、不重复拉列表', async () => {
    const paged = pagedSpy()
    const resend = vi.spyOn(taskApi, 'resendTask').mockResolvedValue({})
    vi.mocked(confirmDanger).mockImplementationOnce(async () => undefined)

    const wrapper = mountPage()
    await flushPromises()
    await selectRows(wrapper, ['8348509120'])
    expect(resendDisabled(wrapper)).toBe(false)

    await resendBtn(wrapper).trigger('click')

    expect(resend).not.toHaveBeenCalled()
    expect(paged).toHaveBeenCalledTimes(1) // 只有首屏那一次
    expect(resendDisabled(wrapper)).toBe(false) // 勾选保持原样
  })
})

describe('任务实例 · 展示接线', () => {
  it('任务ID 状态圆点四态：C 绿 / E 红 / AC 灰 / 其它蓝（旧 a-badge status）', async () => {
    pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    expect(cell(wrapper, '.tl-dot-success')).toHaveLength(1) // C
    expect(cell(wrapper, '.tl-dot-error')).toHaveLength(1) // E
    expect(cell(wrapper, '.tl-dot-default')).toHaveLength(1) // AC
    expect(cell(wrapper, '.tl-dot-processing')).toHaveLength(1) // L
  })

  it('行内「详情」把整行交给详情抽屉；点「配置ID」的蓝色 tag 打开配置模板详情', async () => {
    pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    await cell(wrapper, '.tl-actions')[0].findAll('.tl-op-link')
      .find((el) => el.text().trim() === '详情')!.trigger('click')
    await flushPromises()
    const drawer = wrapper.findComponent({ name: 'TaskDetailDrawer' })
    expect(drawer.props('modelValue')).toBe(true)
    expect((drawer.props('record') as TaskRow).taskId).toBe('8348509120')

    await cell(wrapper, '.tl-config')[0].trigger('click')
    expect(openConfig).toHaveBeenLastCalledWith('70598')
  })

  it('更新时间走相对时间（悬停绝对时间），类型名 / 主题按原字段显示', async () => {
    pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    expect(cell(wrapper, '.tl-time').length).toBe(ROWS.length)
    expect(wrapper.text()).toContain('浏览器抓取')
    expect(wrapper.text()).toContain('queue_70598')
    // 旧 TASK_LIST 没有任何 sorter → 不该有列可排序
    for (const col of wrapper.findAllComponents({ name: 'ElTableColumn' })) {
      expect(col.props('sortable')).toBe(false)
    }
  })

  it('表格列宽：文本列走 min-width 自适应，短列走固定 width；操作列固定在右侧', async () => {
    pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    const cols = wrapper.findAllComponents({ name: 'ElTableColumn' })
    const byProp = (prop: string) => cols.find((c) => c.props('prop') === prop)!
    // 文本列：不传 width，只给 min-width
    for (const prop of ['taskName', 'nodeCode', 'taskTopic']) {
      expect(byProp(prop).props('width')).toBe('')
      expect(typeof byProp(prop).props('minWidth')).toBe('number')
    }
    // 短列：定宽，不参与自适应
    for (const prop of ['taskId', 'state', 'taskSpecId', 'actionName', 'sourceId', 'configId', 'updateDt', 'parentId', 'action']) {
      expect(typeof byProp(prop).props('width')).toBe('number')
      expect(byProp(prop).props('minWidth')).toBe('')
    }
    // 旧 action 列的 fixed:'right'
    expect(byProp('action').props('fixed')).toBe('right')
  })

  it('查询失败：把错误提示出来并清空列表（旧 loadData 的 catch）', async () => {
    vi.spyOn(taskApi, 'taskInstPaged').mockRejectedValue(new Error('时间范围不合法：xx'))
    const wrapper = mountPage()
    await flushPromises()
    // 不抛未捕获异常，表格为空
    expect(wrapper.findAll('tr.el-table__row')).toHaveLength(0)
  })
})
