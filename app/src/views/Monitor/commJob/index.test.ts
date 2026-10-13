// @vitest-environment jsdom
// 自定义告警（旧 page/config/CommJobList.vue → Monitor/commJob/index.vue）表格操作接线回归。
// 与 queueCheck/index.test.ts 同一套思路：只验证「每个操作调到了哪条接口、带了什么参数」——
// 旧页面这一列操作本来就是直连后端，迁到新平台最容易出问题的地方是接线断了或落回 mock。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { h } from 'vue'
import ElementPlus from 'element-plus'
import CommJobPage from './index.vue'
import * as commApi from '../../../api/commJob'
import { confirmDanger } from '@/utils/confirmDanger'
import type { CommJob } from '../../../api'

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

const openDialog = vi.fn()

/** 相对当前时刻偏移若干分钟，格式同后端 'YYYY-MM-DD HH:mm:ss' */
function stampShift(minutes: number): string {
  const d = new Date(Date.now() + minutes * 60_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function row(over: Partial<CommJob> = {}): CommJob {
  return {
    jobId: '1001',
    jobType: 'sqlCheck',
    jobName: '订单积压告警',
    lastMsg: `${stampShift(-12)}---[X]:积压 1280 > 1000`,
    sqlDef: 'select count(1) from t_order',
    ruleDef: 'cnt > 1000',
    jobParam: '{"mail":"ops@demo.com"}',
    schedule: '0 */5 * * * ?',
    nextRun: stampShift(3),
    runCnt: 288,
    successCnt: 288,
    lastRun: stampShift(-12),
    isDelete: 0,
    createDt: '2026-06-01 09:00:00',
    ...over,
  }
}

const ROWS: CommJob[] = [
  row({ jobId: '1001', jobName: '订单积压告警', isDelete: 0, jobType: 'sqlCheck' }),
  row({ jobId: '1002', jobName: '慢查询统计', isDelete: 1, jobType: 'sql', nextRun: '—', lastRun: stampShift(-95) }),
  row({ jobId: '1003', jobName: '历史清理', isDelete: -1, jobType: 'sql', nextRun: '—', lastRun: stampShift(-43200) }),
]

const stubs = {
  // inheritAttrs:false —— 「更多..」的 ElDropdown 内部也走 ElTooltip，会把 popperOptions /
  // onUpdate:visible 之类的对象 attrs 透传下来；若落到 stub 的 span 上，jsdom 做 DOMString
  // 转换时会抛 "Cannot convert object to primitive value"（浏览器里只是变成 [object Object]）。
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
  CommJobEditDialog: {
    name: 'CommJobEditDialog',
    setup(_p: unknown, { expose }: { expose: (o: Record<string, unknown>) => void }) {
      expose({ openDialog })
      return () => h('div', { class: 'stub-edit' })
    },
  },
  CommJobDetailDrawer: {
    name: 'CommJobDetailDrawer',
    props: ['modelValue', 'record'],
    template: '<div class="stub-detail" />',
  },
}

function mountPage() {
  return mount(CommJobPage, { global: { plugins: [ElementPlus], stubs } })
}

const pagedSpy = () => vi.spyOn(commApi, 'pagedCommJobCheck').mockResolvedValue({ total: ROWS.length, list: ROWS })

async function selectRows(wrapper: VueWrapper, ids: string[]) {
  const selected = ROWS.filter((r) => ids.includes(r.jobId))
  wrapper.findComponent({ name: 'ElTable' }).vm.$emit('selection-change', selected)
  await flushPromises()
}
const btn = (wrapper: VueWrapper, text: string) =>
  wrapper.findAll('button').find((b) => b.text().trim() === text)!
const moreBtn = (wrapper: VueWrapper) => wrapper.findAll('button').find((b) => b.text().includes('更多'))!
const moreDisabled = (wrapper: VueWrapper) => (moreBtn(wrapper).element as HTMLButtonElement).disabled
async function moreCmd(wrapper: VueWrapper, cmd: string) {
  wrapper.findComponent({ name: 'ElDropdown' }).vm.$emit('command', cmd)
  await flushPromises()
}
/** 行内元素只在真实数据行里找（ElTable 会额外渲染一份 hidden-columns 量宽树） */
const cell = (wrapper: VueWrapper, selector: string) => wrapper.findAll(`tr.el-table__row ${selector}`)
/** 点某一行行内操作（编辑 / 复制 / 运行） */
async function clickOp(wrapper: VueWrapper, rowIndex: number, text: string) {
  const ops = cell(wrapper, '.cj-actions')[rowIndex].findAll('.cj-op-link')
  await ops.find((el) => el.text().trim() === text)!.trigger('click')
  await flushPromises()
}

beforeEach(() => openDialog.mockClear())
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('自定义告警 · 表格操作与接口调用（对齐旧 CommJobList）', () => {
  it('首屏按旧契约查询：enable 初值 "0"（只在用）+ page/limit（默认 100 条）', async () => {
    const paged = pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    expect(paged).toHaveBeenCalledTimes(1)
    expect(paged).toHaveBeenCalledWith({
      queue: '', queueId: '', name: '', enable: '0', page: 1, limit: 100,
    })
    expect(wrapper.text()).toContain('订单积压告警')
  })

  it('查询按钮带上三个文本条件与状态重新拉取，并回到第 1 页', async () => {
    const paged = pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.get('input[placeholder="队列名"]').setValue('积压')
    await wrapper.get('input[placeholder="ID"]').setValue('1001')
    await wrapper.get('input[placeholder="描述"]').setValue('订单')
    await btn(wrapper, '查询').trigger('click')
    await flushPromises()

    expect(paged).toHaveBeenLastCalledWith(
      expect.objectContaining({ queue: '积压', queueId: '1001', name: '订单', page: 1, limit: 100 }),
    )
  })

  it('状态框改完立刻查（旧 select 上的 @change="handleRefresh"），并带上新 enable', async () => {
    const paged = pagedSpy()
    const wrapper = mountPage()
    await flushPromises()
    expect(paged).toHaveBeenCalledTimes(1)

    const select = wrapper.findComponent({ name: 'ElSelect' })
    select.vm.$emit('update:modelValue', '1')
    select.vm.$emit('change', '1')
    await flushPromises()

    expect(paged).toHaveBeenCalledTimes(2)
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ enable: '1', page: 1 }))
  })

  it('「重置」只清空条件、不发请求（旧版 `queryParam = {}`，下一次查询才生效）', async () => {
    const paged = pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.get('input[placeholder="队列名"]').setValue('积压')
    await btn(wrapper, '重置').trigger('click')
    await flushPromises()

    expect(paged).toHaveBeenCalledTimes(1)
    expect((wrapper.get('input[placeholder="队列名"]').element as HTMLInputElement).value).toBe('')
  })

  it('「更多..」常显：未勾选置灰，勾选后可点；启用/禁用/删除各自打到对应接口（ids 用勾选的 jobId）', async () => {
    pagedSpy()
    const changeEnable = vi.spyOn(commApi, 'changeCommJobCheckEnable').mockResolvedValue({} as never)
    const remove = vi.spyOn(commApi, 'deleteCommJobCheck').mockResolvedValue({} as never)
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.find('.cj-more').exists()).toBe(true)
    expect(moreBtn(wrapper).text()).toContain('更多..')
    expect(moreDisabled(wrapper)).toBe(true)

    await selectRows(wrapper, ['1001', '1002'])
    expect(moreDisabled(wrapper)).toBe(false)

    await moreCmd(wrapper, 'enable')
    expect(changeEnable).toHaveBeenLastCalledWith(['1001', '1002'], true)

    // 旧版每批操作后都会清空勾选并刷新（selectedRowKeys = []），按钮回到禁用态
    expect(moreDisabled(wrapper)).toBe(true)
    await selectRows(wrapper, ['1001', '1002'])
    await moreCmd(wrapper, 'disable')
    expect(changeEnable).toHaveBeenLastCalledWith(['1001', '1002'], false)

    await selectRows(wrapper, ['1001', '1002'])
    await moreCmd(wrapper, 'delete')
    expect(remove).toHaveBeenLastCalledWith(['1001', '1002'])
    expect(moreDisabled(wrapper)).toBe(true)
  })

  it('确认框点「取消」：不发接口、不清勾选、不重复拉列表（旧版副作用写在 .then 里）', async () => {
    const paged = pagedSpy()
    const changeEnable = vi.spyOn(commApi, 'changeCommJobCheckEnable').mockResolvedValue({} as never)
    // 模拟用户在确认框上点「取消」：confirmDanger 正常 resolve，但不执行 run
    vi.mocked(confirmDanger).mockImplementationOnce(async () => undefined)

    const wrapper = mountPage()
    await flushPromises()
    await selectRows(wrapper, ['1001'])
    expect(moreDisabled(wrapper)).toBe(false)

    await moreCmd(wrapper, 'enable')

    expect(changeEnable).not.toHaveBeenCalled()
    expect(paged).toHaveBeenCalledTimes(1) // 只有首屏那一次，取消不该触发刷新
    expect(moreDisabled(wrapper)).toBe(false) // 勾选保持原样
  })

  it('行内「编辑」把整行交给弹窗；「复制」先确认再调 copy；「运行」不带确认直接调 run', async () => {
    pagedSpy()
    const copy = vi.spyOn(commApi, 'commJobCopy').mockResolvedValue({ message: '复制成功（演示）' } as never)
    const run = vi.spyOn(commApi, 'runCommJob').mockResolvedValue({ message: '已提交运行（演示）' } as never)
    const wrapper = mountPage()
    await flushPromises()

    await clickOp(wrapper, 0, '编辑')
    expect(openDialog).toHaveBeenLastCalledWith(expect.objectContaining({ jobId: '1001' }))

    await clickOp(wrapper, 0, '复制')
    expect(copy).toHaveBeenLastCalledWith('1001')

    await clickOp(wrapper, 0, '运行')
    expect(run).toHaveBeenLastCalledWith('1001')
  })

  it('「增加告警」把查询框里的关键词与 isDelete=0 预填进新增弹窗（字段用 jobName，不是旧代码的 queueName）', async () => {
    pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.get('input[placeholder="队列名"]').setValue('积压')
    await btn(wrapper, '增加告警').trigger('click')
    await flushPromises()

    expect(openDialog).toHaveBeenLastCalledWith(null, { jobName: '积压', isDelete: 0 })
  })

  it('定时ID / 定时名都能点开详情；定时名按 isDelete 分三态渲染；类型走 typeFilter', async () => {
    pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    // 三态：在用=可点链接 / 停用=红标签 / 历史删除带叹号
    expect(cell(wrapper, '.cj-link')).toHaveLength(1)
    expect(cell(wrapper, '.cj-history')).toHaveLength(2) // 定时ID 与 定时名 各一处
    expect(cell(wrapper, '.cj-warn')).toHaveLength(2)
    // 类型：sqlCheck → SQL-告警；sql → 定时Job
    expect(wrapper.text()).toContain('SQL-告警')
    expect(wrapper.text()).toContain('定时Job')
    // 时间列走相对时间（nextRun 是未来 → 「后」；lastRun 是过去 → 「前」）
    expect(cell(wrapper, '.cj-time').some((el) => el.text().includes('后'))).toBe(true)
    expect(cell(wrapper, '.cj-time').some((el) => el.text().includes('前'))).toBe(true)

    await cell(wrapper, '.cj-id')[0].trigger('click')
    await flushPromises()
    const drawer = wrapper.findComponent({ name: 'CommJobDetailDrawer' })
    expect(drawer.props('modelValue')).toBe(true)
    expect((drawer.props('record') as CommJob).jobId).toBe('1001')
  })

  it('表格列宽：文本列走 min-width 自适应，短列走固定 width；操作列固定在右侧', async () => {
    pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    const cols = wrapper.findAllComponents({ name: 'ElTableColumn' })
    const byProp = (prop: string) => cols.find((c) => c.props('prop') === prop)!
    // 文本列：不传 width，只给 min-width
    for (const prop of ['jobName', 'lastMsg', 'sqlDef', 'ruleDef', 'jobParam']) {
      expect(byProp(prop).props('width')).toBe('')
      expect(typeof byProp(prop).props('minWidth')).toBe('number')
    }
    // 短列：定宽，不参与自适应
    for (const prop of ['jobId', 'jobType', 'schedule', 'nextRun', 'runCnt', 'successCnt', 'lastRun', 'action']) {
      expect(typeof byProp(prop).props('width')).toBe('number')
      expect(byProp(prop).props('minWidth')).toBe('')
    }
    // 旧 action 列的 fixed:'right'
    expect(byProp('action').props('fixed')).toBe('right')
    // 旧 COMM_JOB 没有 sorter → 不该有任何列可排序
    for (const col of cols) expect(col.props('sortable')).toBe(false)
  })

  it('新增/编辑保存成功后重新拉列表', async () => {
    const paged = pagedSpy()
    const wrapper = mountPage()
    await flushPromises()
    expect(paged).toHaveBeenCalledTimes(1)

    wrapper.findComponent({ name: 'CommJobEditDialog' }).vm.$emit('saved')
    await flushPromises()
    expect(paged).toHaveBeenCalledTimes(2)
  })
})
