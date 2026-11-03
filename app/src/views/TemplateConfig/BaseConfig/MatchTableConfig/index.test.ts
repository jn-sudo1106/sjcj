// @vitest-environment jsdom
// 选表规则配置（左表右明细版）接线回归：
// ① 挂载即拉表导航 + 全量规则，全量是按 pageNo 翻上来的，且不传 name/status；
// ② 未选中表只有引导空态，选中表后右侧只剩这张表的规则；
// ③ 认亲两种口径都要通：带 tableId 的按 ID 认，弹窗新增出来的那类没有 tableId 的按表名认；
// ④ 认不到数据表的规则有入口可看，不会在界面上静默消失；
// ⑤ 启停走 changeStatus(id, 目标 status)、失败回滚；⑥ 删除必须确认后才发 remove(id)；
// ⑦ 「新增规则」把当前表的 tableName / tableId 预置给弹窗。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, type PropType } from 'vue'
import ElementPlus, { ElMessageBox } from 'element-plus'
import MatchTableConfigPage from './index.vue'
import { dataApi, type EntryType } from '@/api'
import { matchTableConfigApi } from '@/api/templateConfig'
import type { MatchTableConfig } from '@/api/types/template'

vi.mock('@/api/templateConfig', () => ({
  matchTableConfigApi: {
    page: vi.fn(),
    save: vi.fn(async () => ({ ok: true, message: '操作成功' })),
    changeStatus: vi.fn(async () => ({ ok: true, message: '请求成功' })),
    remove: vi.fn(async () => ({ ok: true, message: '删除成功' })),
  },
}))

/**
 * 默认两行规则，两个 tableId 分别落在下面两张表上。
 * 每次调用都发新对象：状态开关是乐观更新、直接改行对象，共用引用会串到下一个用例去。
 */
const DEFAULT_RULES: MatchTableConfig[] = [
  { id: 3, tableId: 1042, tableName: 'KHFA_KHZBJG_JG', selectionType: 'text_selection', rule: '问句含「客户数」时选本表', status: '1', createTime: '2025-03-18 14:22:05', updateTime: '2025-05-09 10:41:37' },
  { id: 2, tableId: 1043, tableName: 'DIM_JG', selectionType: 'vector_selection', rule: 'DIM_JG_VECTOR', status: '0', createTime: '2025-01-06 09:12:48', updateTime: '2025-01-06 09:12:48' },
]

const TABLES: EntryType[] = [
  { tableId: '1042', tableName: 'sense_data.KHFA_KHZBJG_JG', name: '客户风险结果监管', fields: [] },
  { tableId: '1043', tableName: 'DIM_JG', fields: [] },
  { tableId: '1099', tableName: 'sense_data.TB_EMPTY', name: '没配规则的表', fields: [] },
]

const dialogOpen = vi.fn()

/** 侧栏自身的行为由 components/DataTableSidebar.test.ts 覆盖，这里只当发射器用 */
const SidebarStub = defineComponent({
  name: 'DataTableSidebar',
  props: {
    tables: { type: Array as PropType<EntryType[]>, required: true },
    selectedId: { type: String, required: true },
    scope: { type: String, required: true },
    bizOnly: { type: Boolean, default: false },
    loading: { type: Boolean, required: true },
    error: { type: String, required: true },
  },
  emits: {
    select: (_table: EntryType) => true,
    collapse: () => true,
    retry: () => true,
  },
  setup(props, { emit }) {
    return () =>
      h('div', { class: 'stub-sidebar' }, props.tables.map((table) =>
        h('button', { class: 'stub-pick', 'data-table-id': table.tableId, onClick: () => emit('select', table) }, table.name ?? table.tableName),
      ))
  },
})

function mountPage() {
  return mount(MatchTableConfigPage, {
    global: {
      plugins: [ElementPlus],
      stubs: {
        // 弹窗自身的提交口径见 MatchTableConfigEditDialog.test.ts，这里只验页面怎么调它
        MatchTableConfigEditDialog: {
          name: 'MatchTableConfigEditDialog',
          emits: ['saved'],
          setup(_p: unknown, { expose }: { expose: (o: Record<string, unknown>) => void }) {
            expose({ open: dialogOpen, close: vi.fn() })
            return () => h('div', { class: 'stub-dialog' })
          },
        },
        DataTableSidebar: SidebarStub,
        ElSwitch: {
          name: 'ElSwitch',
          props: ['modelValue'],
          emits: ['change'],
          template: '<button class="stub-switch" @click="$emit(\'change\', !modelValue)" />',
        },
      },
    },
  })
}

async function pickTable(wrapper: ReturnType<typeof mountPage>, tableId: string) {
  await wrapper.find(`.stub-pick[data-table-id="${tableId}"]`).trigger('click')
  await flushPromises()
}

/** 右侧明细表格的可见行 */
const bodyRows = (wrapper: ReturnType<typeof mountPage>) => wrapper.findAll('.el-table__body-wrapper tbody tr')

/** 操作列图标顺序：编辑 / 删除 */
const editIcon = (wrapper: ReturnType<typeof mountPage>, i = 0) => bodyRows(wrapper)[i]!.findAll('.mtc-op-icon')[0]!
const deleteIcon = (wrapper: ReturnType<typeof mountPage>, i = 0) => bodyRows(wrapper)[i]!.findAll('.mtc-op-icon')[1]!

function lastPageQuery() {
  const calls = vi.mocked(matchTableConfigApi.page).mock.calls
  return (calls.at(-1)?.[0] ?? {}) as Record<string, unknown>
}

const sidebarOf = (wrapper: ReturnType<typeof mountPage>) => wrapper.findComponent({ name: 'DataTableSidebar' })

beforeEach(() => {
  dialogOpen.mockReset()
  vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue({ list1: TABLES, list2: [], list3: [] })
  vi.mocked(matchTableConfigApi.page).mockReset().mockImplementation(async () => ({ total: DEFAULT_RULES.length, list: DEFAULT_RULES.map((rule) => ({ ...rule })) }))
  vi.mocked(matchTableConfigApi.changeStatus!).mockClear()
  vi.mocked(matchTableConfigApi.remove).mockClear()
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('MatchTableConfigPage', () => {
  it('挂载即拉表导航与全量规则，请求不带 name / status', async () => {
    mountPage()
    await flushPromises()

    expect(dataApi.entryTypesGroup).toHaveBeenCalledTimes(1)
    expect(matchTableConfigApi.page).toHaveBeenCalledTimes(1)
    expect(lastPageQuery()).toMatchObject({ pageNo: 1, pageSize: 200 })
    expect(lastPageQuery()).not.toHaveProperty('name')
    expect(lastPageQuery()).not.toHaveProperty('status')
  })

  it('total 大于已取到的行数时继续翻页拉全', async () => {
    vi.mocked(matchTableConfigApi.page)
      .mockResolvedValueOnce({ total: 3, list: [{ id: 1, tableName: 'A', selectionType: 'text_selection', status: '0' }, { id: 2, tableName: 'B', selectionType: 'text_selection', status: '0' }] })
      .mockResolvedValueOnce({ total: 3, list: [{ id: 3, tableId: 1042, tableName: 'KHFA_KHZBJG_JG', selectionType: 'text_selection', rule: 'r3', status: '0' }] })
    const wrapper = mountPage()
    await flushPromises()

    expect(vi.mocked(matchTableConfigApi.page).mock.calls.map((call) => call[0]?.pageNo)).toEqual([1, 2])
    await pickTable(wrapper, '1042')
    expect(bodyRows(wrapper)).toHaveLength(1)
    expect(bodyRows(wrapper)[0]!.text()).toContain('r3')
  })

  it('未选中表只有引导空态，不铺全库规则', async () => {
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.find('.mtc-empty').exists()).toBe(true)
    expect(bodyRows(wrapper)).toHaveLength(0)
  })

  it('选中表后右侧只剩这张表：带 tableId 的按 ID 认，没有 tableId 的按表名认', async () => {
    vi.mocked(matchTableConfigApi.page).mockResolvedValue({
      total: 3,
      list: [
        { id: 8, tableId: 1042, tableName: 'IGNORED_NAME', selectionType: 'text_selection', rule: 'r8', status: '0' },
        { id: 2, tableName: 'DIM_JG', selectionType: 'vector_selection', rule: 'DIM_JG_VECTOR', status: '1' },
        { id: 9, tableName: 'GONE_TABLE', selectionType: 'text_selection', rule: 'r9', status: '0' },
      ],
    })
    const wrapper = mountPage()
    await flushPromises()

    await pickTable(wrapper, '1042')
    expect(bodyRows(wrapper)).toHaveLength(1)
    expect(bodyRows(wrapper)[0]!.text()).toContain('r8')

    await pickTable(wrapper, '1043')
    expect(bodyRows(wrapper)).toHaveLength(1)
    expect(bodyRows(wrapper)[0]!.text()).toContain('DIM_JG_VECTOR')

    await pickTable(wrapper, '1099')
    expect(bodyRows(wrapper)).toHaveLength(0)
    expect(wrapper.find('.el-table__empty-text').text()).toContain('这张表还没有选表规则')
  })

  it('认不到数据表的规则有入口可看，不会静默消失', async () => {
    vi.mocked(matchTableConfigApi.page).mockResolvedValue({
      total: 3,
      list: [
        { id: 8, tableId: 1042, tableName: 'KHFA_KHZBJG_JG', selectionType: 'text_selection', rule: 'r8', status: '0' },
        { id: 9, tableName: 'GONE_TABLE', selectionType: 'text_selection', rule: 'r9', status: '0' },
        { id: 10, tableName: 'ALSO_GONE', selectionType: 'vector_selection', rule: 'r10', status: '0' },
      ],
    })
    const wrapper = mountPage()
    await flushPromises()

    const toggle = wrapper.get('[data-testid="mtc-unmatched"]')
    expect(toggle.text()).toContain('未匹配规则 2')

    await toggle.trigger('click')
    expect(wrapper.find('.mtc-context strong').text()).toBe('未匹配到数据表的规则')
    expect(bodyRows(wrapper)).toHaveLength(2)

    // 选表自动退出未匹配视图
    await pickTable(wrapper, '1042')
    expect(bodyRows(wrapper)).toHaveLength(1)
  })

  it('选表类型按码值渲染中文；未知码值留空（旧版会静默显示成向量选表）', async () => {
    vi.mocked(matchTableConfigApi.page).mockResolvedValue({
      total: 1,
      list: [{ id: 9, tableId: 1042, tableName: 'KHFA_KHZBJG_JG', selectionType: 'unknown_type', rule: 'r', status: '0' }],
    })
    const wrapper = mountPage()
    await flushPromises()
    await pickTable(wrapper, '1042')

    expect(bodyRows(wrapper)[0]!.text()).not.toContain('向量选表')
    expect(bodyRows(wrapper)[0]!.text()).not.toContain('unknown_type')
  })

  it('状态列是滑动开关，点下去发 changeStatus(id, 目标 status)，失败回滚后重试仍是同一个目标值', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await pickTable(wrapper, '1042')

    vi.mocked(matchTableConfigApi.changeStatus!).mockRejectedValueOnce(new Error('后端拒绝'))
    await wrapper.findAll('.stub-switch')[0]!.trigger('click')
    await flushPromises()
    // 该行 status '1'（禁用）→ 开成启用
    expect(matchTableConfigApi.changeStatus).toHaveBeenCalledWith(3, '0')

    // 失败已回滚成 '1'，再点一次请求的还是 '0'（不会把乐观值当成现状）
    await wrapper.findAll('.stub-switch')[0]!.trigger('click')
    await flushPromises()
    expect(matchTableConfigApi.changeStatus).toHaveBeenLastCalledWith(3, '0')
  })

  it('「删除」确认后发 remove(id) 并重查', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await pickTable(wrapper, '1042')
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.mocked(matchTableConfigApi.page).mockClear()

    await deleteIcon(wrapper).trigger('click')
    await flushPromises()

    expect(ElMessageBox.confirm).toHaveBeenCalled()
    expect(matchTableConfigApi.remove).toHaveBeenCalledWith(3)
    expect(matchTableConfigApi.page).toHaveBeenCalledTimes(1)
  })

  it('「删除」取消时不发任何请求', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await pickTable(wrapper, '1042')
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancelled'))

    await deleteIcon(wrapper).trigger('click')
    await flushPromises()

    expect(matchTableConfigApi.remove).not.toHaveBeenCalled()
    expect(matchTableConfigApi.page).toHaveBeenCalledTimes(1)
  })

  it('「新增规则」带上当前表的表名与表 ID，未选表时开空弹窗', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.get('[data-testid="mtc-add-rule"]').trigger('click')
    expect(dialogOpen).toHaveBeenCalledWith(null, undefined)

    await pickTable(wrapper, '1042')
    await wrapper.get('[data-testid="mtc-add-rule"]').trigger('click')
    expect(dialogOpen).toHaveBeenCalledWith(null, { tableName: '客户风险结果监管', tableId: 1042 })

    await editIcon(wrapper).trigger('click')
    expect(dialogOpen.mock.calls.at(-1)?.[0]).toMatchObject({ id: 3, tableName: 'KHFA_KHZBJG_JG', selectionType: 'text_selection' })
  })

  it('弹窗保存成功后重查规则，并保留当前选中的表', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await pickTable(wrapper, '1042')
    vi.mocked(matchTableConfigApi.page).mockClear()

    wrapper.findComponent({ name: 'MatchTableConfigEditDialog' }).vm.$emit('saved', { mode: 'add', id: undefined })
    await flushPromises()

    expect(matchTableConfigApi.page).toHaveBeenCalledTimes(1)
    expect(bodyRows(wrapper)).toHaveLength(1)
    expect(sidebarOf(wrapper).props('selectedId')).toBe('1042')
  })

  it('匹配规则等长字段直接进列，null 渲染成空而不是 "null"', async () => {
    vi.mocked(matchTableConfigApi.page).mockResolvedValue({
      total: 1,
      list: [{ id: 7, tableId: 1042, tableName: 'KHFA_KHZBJG_JG', selectionType: 'text_selection', status: '0' }],
    })
    const wrapper = mountPage()
    await flushPromises()
    await pickTable(wrapper, '1042')

    expect(bodyRows(wrapper)[0]!.text()).not.toContain('null')
    expect(bodyRows(wrapper)[0]!.text()).not.toContain('undefined')
  })

  it('表导航失败与重试：错误交给侧栏展示，重试重新拉表', async () => {
    vi.mocked(dataApi.entryTypesGroup).mockRejectedValueOnce(new Error('网关超时'))
    const wrapper = mountPage()
    await flushPromises()

    expect(sidebarOf(wrapper).props('error')).toContain('加载数据表失败：网关超时')

    vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue({ list1: TABLES, list2: [], list3: [] })
    sidebarOf(wrapper).vm.$emit('retry')
    await flushPromises()

    expect(sidebarOf(wrapper).props('error')).toBe('')
    expect(sidebarOf(wrapper).props('tables')).toHaveLength(TABLES.length)
    // 本页侧栏只按业务目录分组，「数据库」页签不出（数据中心那一页两种分组都保留）
    expect(sidebarOf(wrapper).props('bizOnly')).toBe(true)
  })

  it('规则拉取失败在右侧报错并可重试', async () => {
    vi.mocked(matchTableConfigApi.page).mockRejectedValueOnce(new Error('后端 500'))
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.find('.mtc-alert').text()).toContain('后端 500')

    vi.mocked(matchTableConfigApi.page).mockClear()
    await wrapper.find('.mtc-alert button').trigger('click')
    await flushPromises()

    expect(wrapper.find('.mtc-alert').exists()).toBe(false)
    expect(matchTableConfigApi.page).toHaveBeenCalledTimes(1)
  })
})
