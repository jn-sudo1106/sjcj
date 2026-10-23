// @vitest-environment jsdom
// 队列告警（旧 page/config/QueueCheck.vue → queueCheck/index.vue）表格操作接线回归。
// 与 sourceCheck/index.test.ts 同一套思路：只验证「每个操作调到了哪条接口、带了什么参数」——
// 旧页面这一列操作本来就是直连后端，迁到新平台最容易出问题的地方是接线断了或落回 mock。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { h } from 'vue'
import ElementPlus from 'element-plus'
import QueueCheckPage from './index.vue'
import { MQ_CHECK_BASE } from './columns'
import * as queueApi from '../../../api/queueCheck'
import { confirmDanger } from '@/utils/confirmDanger'
import type { MqCheck } from '../../../api'

// Element Plus 的表格内部用 ResizeObserver 量宽，jsdom 没有
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

// confirmDanger 真实实现要弹 ElMessageBox（jsdom 里点不到「确认执行」），默认直接放行动作本身——
// 要验的是动作里发的接口，不是确认框。用 vi.fn 包一层，个别用例可以模拟「用户点取消」。
vi.mock('@/utils/confirmDanger', () => ({
  confirmDanger: vi.fn((_title: string, _body: string, run: () => unknown) => run()),
  confirmOrRun: vi.fn((_need: boolean, _t: string, _b: string, run: () => unknown) => run()),
}))

const openDialog = vi.fn()

function row(over: Partial<MqCheck> = {}): MqCheck {
  return {
    queueId: 'mq-1',
    queueName: 'source-config-dispatch',
    state: 'C',
    lastMsg: '2026-10-13 08:10:01---正常, 数量:88',
    queueDesc: '源配置下发队列',
    maxSize: 1000,
    minConsumer: 2,
    minRate: 10,
    maxRate: 5000,
    check: '',
    checkMsg: '',
    isDelete: 0,
    createDt: '2026-09-01 10:00:00',
    ...over,
  }
}

const ROWS: MqCheck[] = [
  row({ queueId: 'mq-1', queueName: 'source-config-dispatch', isDelete: 0, state: 'E' }),
  row({ queueId: 'mq-2', queueName: 'ocr-task', isDelete: 1, state: 'C' }),
  row({ queueId: 'mq-3', queueName: 'mail-fetch', isDelete: -1, state: 'C' }),
]

const stubs = {
  StatusTag: { name: 'StatusTag', props: ['text', 'tone', 'state'], template: '<span class="stub-status" />' },
  // inheritAttrs:false —— 「更多..」的 ElDropdown 内部也走 ElTooltip，会把 popperOptions /
  // onUpdate:visible 之类的对象 attrs 透传下来；若落到 stub 的 span 上，jsdom 做 DOMString
  // 转换时会抛 "Cannot convert object to primitive value"（浏览器里只是变成 [object Object]）。
  ElTooltip: {
    name: 'ElTooltip',
    inheritAttrs: false,
    // 行内操作改成图标后靠 content（原按钮文案）定位，声明成 prop 才拿得到
    props: ['content'],
    template: '<span class="stub-tooltip"><slot /></span>',
  },
  ElPagination: {
    name: 'ElPagination',
    props: ['currentPage', 'pageSize', 'total'],
    emits: ['current-change', 'size-change'],
    template: '<div class="stub-pager" />',
  },
  QueueEditDialog: {
    name: 'QueueEditDialog',
    setup(_p: unknown, { expose }: { expose: (o: Record<string, unknown>) => void }) {
      expose({ openDialog })
      return () => h('div', { class: 'stub-edit' })
    },
  },
  QueueDetailDrawer: {
    name: 'QueueDetailDrawer',
    props: ['modelValue', 'record'],
    template: '<div class="stub-detail" />',
  },
}

function mountPage() {
  return mount(QueueCheckPage, { global: { plugins: [ElementPlus], stubs } })
}

const pagedSpy = () => vi.spyOn(queueApi, 'pagedQueueCheck').mockResolvedValue({ total: ROWS.length, list: ROWS })

async function selectRows(wrapper: VueWrapper, ids: string[]) {
  const selected = ROWS.filter((r) => ids.includes(r.queueId))
  wrapper.findComponent({ name: 'ElTable' }).vm.$emit('selection-change', selected)
  await flushPromises()
}
const btn = (wrapper: VueWrapper, text: string) =>
  wrapper.findAll('button').find((b) => b.text().trim() === text)!
/** 「更多..」按钮：文案 + 下行箭头图标，按包含匹配 */
const moreBtn = (wrapper: VueWrapper) =>
  wrapper.findAll('button').find((b) => b.text().includes('更多'))!
/** 按钮当前是否禁用（未勾选时置灰） */
const moreDisabled = (wrapper: VueWrapper) => (moreBtn(wrapper).element as HTMLButtonElement).disabled
/** 触发 ElDropdown command（jsdom 里 hover 展开不稳） */
async function moreCmd(wrapper: VueWrapper, cmd: string) {
  wrapper.findComponent({ name: 'ElDropdown' }).vm.$emit('command', cmd)
  await flushPromises()
}
/** 行内元素只在真实数据行里找：ElTable 会额外渲染一份 hidden-columns 量宽树
 *  （里面的作用域行是空对象），按全文档查会把它算进去。 */
const cell = (wrapper: VueWrapper, selector: string) => wrapper.findAll(`tr.el-table__row ${selector}`)

beforeEach(() => openDialog.mockClear())
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('队列告警 · 表格操作与接口调用（对齐旧 QueueCheck）', () => {
  it('首屏按旧契约查询：queue/queueId/name/enable + page/limit（默认 20 条）', async () => {
    const paged = pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    expect(paged).toHaveBeenCalledTimes(1)
    expect(paged).toHaveBeenCalledWith({
      queue: '', queueId: '', name: '', enable: '', page: 1, limit: 20,
    })
    expect(wrapper.text()).toContain('source-config-dispatch')
  })

  it('查询按钮带上三个文本条件与状态重新拉取，并回到第 1 页', async () => {
    const paged = pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.get('input[placeholder="队列名"]').setValue('snatch')
    await wrapper.get('input[placeholder="ID"]').setValue('mq-2')
    await wrapper.get('input[placeholder="描述"]').setValue('队列')
    await btn(wrapper, '查询').trigger('click')
    await flushPromises()

    expect(paged).toHaveBeenLastCalledWith(
      expect.objectContaining({ queue: 'snatch', queueId: 'mq-2', name: '队列', page: 1, limit: 20 }),
    )
  })

  it('「重置」只清空条件、不发请求（旧版 `queryParam = {}`，下一次查询才生效）', async () => {
    const paged = pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.get('input[placeholder="队列名"]').setValue('snatch')
    await btn(wrapper, '重置').trigger('click')
    await flushPromises()

    expect(paged).toHaveBeenCalledTimes(1)
    expect((wrapper.get('input[placeholder="队列名"]').element as HTMLInputElement).value).toBe('')
  })

  // 状态下拉的「全部 / 历史删除的」用 -1 / -2 两个 UI 哨兵（空串会被 el-select 判成「没选」，
  // 「全部」就显示不出来），到接口层再还原：-1 → ''、-2 → 后端本来那个 -1。
  // 注：本文件 stub 了 ElTooltip，下拉内容不渲染，所以这里只验 UI 值与请求参数；
  // 「非空值能显示中文」由 indicatorDataset / indicatorsList 里同机制的用例覆盖。
  it('状态「全部」「历史删除的」：UI 用非空哨兵，请求按哨兵还原成旧口径', async () => {
    const paged = pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    // 分页器的每页条数选择器也是 ElSelect，但它的 modelValue 是数字
    const select = wrapper.findAllComponents({ name: 'ElSelect' })
      .find((s) => typeof s.props('modelValue') === 'string')!
    expect(select.vm.$props.modelValue).toBe('-1')

    select.vm.$emit('update:modelValue', '-2')
    await flushPromises()
    expect(select.vm.$props.modelValue).toBe('-2')
    await btn(wrapper, '查询').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ enable: '-1' }))

    select.vm.$emit('update:modelValue', '-1')
    await flushPromises()
    await btn(wrapper, '查询').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ enable: '' }))
  })

  it('「更多..」常显：未勾选置灰，勾选后可点；启用/禁用/删除各自打到对应接口（ids 用勾选的 queueId）', async () => {
    pagedSpy()
    const changeEnable = vi.spyOn(queueApi, 'changeQueueCheckEnable').mockResolvedValue({} as never)
    const remove = vi.spyOn(queueApi, 'deleteQueueCheck').mockResolvedValue({} as never)
    const wrapper = mountPage()
    await flushPromises()

    // 常显但禁用（旧版是 `v-if` 勾选后才出现；这里按需求收敛为置灰）
    expect(wrapper.find('.qc-more').exists()).toBe(true)
    expect(moreBtn(wrapper).text()).toContain('更多..')
    expect(moreDisabled(wrapper)).toBe(true)

    await selectRows(wrapper, ['mq-1', 'mq-2'])
    expect(moreDisabled(wrapper)).toBe(false)

    await moreCmd(wrapper, 'enable')
    expect(changeEnable).toHaveBeenLastCalledWith(['mq-1', 'mq-2'], true)

    // 旧版每批操作后都会清空勾选并刷新（selectedRowKeys = []），按钮回到禁用态
    expect(moreDisabled(wrapper)).toBe(true)
    await selectRows(wrapper, ['mq-1', 'mq-2'])
    await moreCmd(wrapper, 'disable')
    expect(changeEnable).toHaveBeenLastCalledWith(['mq-1', 'mq-2'], false)

    await selectRows(wrapper, ['mq-1', 'mq-2'])
    await moreCmd(wrapper, 'delete')
    expect(remove).toHaveBeenLastCalledWith(['mq-1', 'mq-2'])
    expect(moreDisabled(wrapper)).toBe(true)
  })

  it('确认框点「取消」：不发接口、不清勾选、不重复拉列表（旧版副作用写在 .then 里）', async () => {
    const paged = pagedSpy()
    const changeEnable = vi.spyOn(queueApi, 'changeQueueCheckEnable').mockResolvedValue({} as never)
    // 模拟用户在确认框上点「取消」：confirmDanger 正常 resolve，但不执行 run
    vi.mocked(confirmDanger).mockImplementationOnce(async () => undefined)

    const wrapper = mountPage()
    await flushPromises()
    await selectRows(wrapper, ['mq-1'])
    expect(moreDisabled(wrapper)).toBe(false)

    await moreCmd(wrapper, 'enable')

    expect(changeEnable).not.toHaveBeenCalled()
    expect(paged).toHaveBeenCalledTimes(1) // 只有首屏那一次，取消不该触发刷新
    expect(moreDisabled(wrapper)).toBe(false) // 勾选保持原样
  })

  it('表格列宽：文本列走 min-width 自适应，数值/状态/操作列走固定 width', async () => {
    pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    // 只断言「哪一类列走哪种口径」，**不锁死具体像素**：列宽在迁移期会被微调
    // （1013 就把带排序箭头的那三列从 100 调成 130 给箭头让位），锁像素只会让这条用例变成绊脚石。
    const declared = new Map(MQ_CHECK_BASE.map((c) => [c.dataIndex, c]))

    // 文本列：声明里有 minWidth（渲染时用它吃掉剩余空间；旧 width 原值留在数据里当对照）
    for (const prop of ['queueName', 'lastMsg', 'queueDesc']) {
      expect(declared.get(prop)!.minWidth, `${prop} 应有 minWidth`).toBeGreaterThan(0)
    }

    // 数值 / 状态 / 操作列：声明里有固定 width，且没有 minWidth（不参与自适应分配）
    for (const prop of ['state', 'maxSize', 'minConsumer', 'minRate', 'maxRate', 'action']) {
      expect(declared.get(prop)!.width, `${prop} 应有固定 width`).toBeGreaterThan(0)
      expect(declared.get(prop)!.minWidth, `${prop} 不该有 minWidth`).toBeUndefined()
    }

    const cols = wrapper.findAllComponents({ name: 'ElTableColumn' })
    const byProp = (prop: string) => cols.find((c) => c.props('prop') === prop)!
    // 渲染层：有 minWidth 的列不传 width（el-table-column 未传时默认空串）
    for (const prop of ['queueName', 'lastMsg', 'queueDesc']) {
      expect(byProp(prop).props('width')).toBe('')
      expect(typeof byProp(prop).props('minWidth')).toBe('number')
    }
    // 渲染层：定宽列带着 width，且没有 min-width
    for (const prop of ['state', 'maxSize', 'minConsumer', 'minRate', 'maxRate', 'action']) {
      expect(Number(byProp(prop).props('width'))).toBe(declared.get(prop)!.width)
      expect(byProp(prop).props('minWidth')).toBe('')
    }

    // 长文本列单行省略后必须能看全文 → 两列都要 show-overflow-tooltip（队列名自己用 el-tooltip 包了）
    expect(byProp('lastMsg').props('showOverflowTooltip')).toBe(true)
    expect(byProp('queueDesc').props('showOverflowTooltip')).toBe(true)
    expect(byProp('queueName').props('showOverflowTooltip')).toBe(false)
  })

  it('表头排序走服务端：旧 sorter:true 的四列可排序，sort-change 映射成 sortField/sortOrder', async () => {
    const paged = pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    const cols = wrapper.findAllComponents({ name: 'ElTableColumn' })
    const sortableOf = (prop: string) => cols.find((c) => c.props('prop') === prop)!.props('sortable')

    // 旧 allColumns.MQ_CHECK.base 里带 sorter:true 的四列 → sortable="custom"（箭头画出来，排序交后端）
    for (const prop of ['queueName', 'maxSize', 'minConsumer', 'maxRate']) {
      expect(sortableOf(prop)).toBe('custom')
    }
    // 其余列不开排序
    for (const prop of ['state', 'lastMsg', 'queueDesc', 'minRate', 'action']) {
      expect(sortableOf(prop)).toBe(false)
    }

    const table = wrapper.findComponent({ name: 'ElTable' })
    // 升序 → antd 口径 'ascend'（旧 s-table 原样透传 sorter.order）
    table.vm.$emit('sort-change', { prop: 'maxSize', order: 'ascending' })
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ sortField: 'maxSize', sortOrder: 'ascend' }))

    table.vm.$emit('sort-change', { prop: 'maxRate', order: 'descending' })
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ sortField: 'maxRate', sortOrder: 'descend' }))

    // 第三下取消排序：两个键都不出现（旧版无 sorter 时参数里就没有这两个键），筛选/分页保持
    table.vm.$emit('sort-change', { prop: 'maxRate', order: null })
    await flushPromises()
    const lastQuery = paged.mock.calls.at(-1)![0] as Record<string, unknown>
    expect('sortField' in lastQuery).toBe(false)
    expect('sortOrder' in lastQuery).toBe(false)
    expect(lastQuery.page).toBe(1)
    expect(lastQuery.limit).toBe(20)
  })

  it('行内「详情」只看当前行（不发请求）；「编辑」把整行交给弹窗', async () => {
    pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.findComponent({ name: 'QueueDetailDrawer' }).props('modelValue')).toBe(false)
    await cell(wrapper, '.qc-link')[0].trigger('click')
    await flushPromises()
    const drawer = wrapper.findComponent({ name: 'QueueDetailDrawer' })
    expect(drawer.props('modelValue')).toBe(true)
    expect((drawer.props('record') as MqCheck).queueId).toBe('mq-1')

    await cell(wrapper, '.qc-actions')[0].findAllComponents({ name: 'ElTooltip' })
      .find((t: VueWrapper) => (t.props() as { content?: string }).content === '编辑')!.find('.qc-op-icon').trigger('click')
    await flushPromises()
    expect(openDialog).toHaveBeenLastCalledWith(expect.objectContaining({ queueId: 'mq-1' }))
  })

  it('「增加告警」把查询框里的队列名与 isDelete=0 预填进新增弹窗', async () => {
    pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.get('input[placeholder="队列名"]').setValue('snatch')
    await btn(wrapper, '增加告警').trigger('click')
    await flushPromises()

    expect(openDialog).toHaveBeenLastCalledWith(null, { queueName: 'snatch', isDelete: 0 })
  })

  it('队列名按 isDelete 分三态渲染：在用可点链接 / 停用红标签 / 历史删除带叹号', async () => {
    pagedSpy()
    const wrapper = mountPage()
    await flushPromises()

    expect(cell(wrapper, '.qc-link')).toHaveLength(1)
    expect(cell(wrapper, '.qc-tag')).toHaveLength(2)
    expect(cell(wrapper, '.qc-warn')).toHaveLength(1)
    expect(wrapper.text()).toContain('[禁用]-ocr-task')
  })

  it('新增/编辑保存成功后重新拉列表', async () => {
    const paged = pagedSpy()
    const wrapper = mountPage()
    await flushPromises()
    expect(paged).toHaveBeenCalledTimes(1)

    wrapper.findComponent({ name: 'QueueEditDialog' }).vm.$emit('saved')
    await flushPromises()
    expect(paged).toHaveBeenCalledTimes(2)
  })
})
