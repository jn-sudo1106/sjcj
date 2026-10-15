// @vitest-environment jsdom
// 选表规则配置列表页接线回归（旧 ai-chat-view src/demo/MatchTableConfigList.vue）。
// 这一页没走 components/templateConfig 通用层（两条件查询 + 选表类型码值列 + 删除），把自己实现的部分钉住：
// ① 挂载即拉第一页，pageNo/pageSize=1/20，name 与 status 都是空串（= 全部）；
// ② 条件改了不自动查，点「搜索」才生效并回第一页；「重置」清草稿与已生效条件并重查；
// ③ 选表类型按码值渲染中文，未知码值留空（旧版是「除 text_selection 外都显示向量选表」）；
// ④ 启停走 changeStatus(id, 目标 status)、失败回滚；⑤ 删除必须确认后才发 remove(id)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import ElementPlus, { ElMessageBox, ElSelect } from 'element-plus'
import MatchTableConfigPage from './index.vue'
import { matchTableConfigApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  matchTableConfigApi: {
    page: vi.fn(async () => ({
      total: 2,
      list: [
        { id: 3, tableName: 'KHFA_KHZBJG_JG', selectionType: 'text_selection', rule: '问句含「客户数」时选本表', status: '1', createTime: '2025-03-18 14:22:05', updateTime: '2025-05-09 10:41:37' },
        { id: 2, tableName: 'DIM_JG', selectionType: 'vector_selection', rule: 'DIM_JG_VECTOR', status: '0', createTime: '2025-01-06 09:12:48', updateTime: '2025-01-06 09:12:48' },
      ],
    })),
    save: vi.fn(async () => ({ ok: true, message: '操作成功' })),
    changeStatus: vi.fn(async () => ({ ok: true, message: '请求成功' })),
    remove: vi.fn(async () => ({ ok: true, message: '删除成功' })),
  },
}))

const dialogOpen = vi.fn()

function mountPage() {
  return mount(MatchTableConfigPage, {
    global: {
      plugins: [ElementPlus],
      stubs: {
        // 弹窗自身的提交口径见 MatchTableConfigEditDialog.test.ts，这里只验列表怎么调它
        MatchTableConfigEditDialog: {
          name: 'MatchTableConfigEditDialog',
          emits: ['saved'],
          setup(_p: unknown, { expose }: { expose: (o: Record<string, unknown>) => void }) {
            expose({ open: dialogOpen, close: vi.fn() })
            return () => h('div', { class: 'stub-dialog' })
          },
        },
        ElSwitch: {
          name: 'ElSwitch',
          props: ['modelValue'],
          emits: ['change'],
          template: '<button class="stub-switch" @click="$emit(\'change\', !modelValue)" />',
        },
        ElPagination: { name: 'ElPagination', props: ['currentPage', 'pageSize', 'total'], template: '<div class="stub-pager" />' },
      },
    },
  })
}

function lastPageQuery() {
  const calls = vi.mocked(matchTableConfigApi.page).mock.calls
  return (calls.at(-1)?.[0] ?? {}) as Record<string, unknown>
}

/** 查询区唯一那个下拉（状态） */
function statusSelect(wrapper: ReturnType<typeof mountPage>) {
  return wrapper.findAllComponents(ElSelect)[0]!
}

beforeEach(() => {
  dialogOpen.mockReset()
  vi.mocked(matchTableConfigApi.page).mockClear()
  vi.mocked(matchTableConfigApi.changeStatus!).mockClear()
  vi.mocked(matchTableConfigApi.remove).mockClear()
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('MatchTableConfigPage', () => {
  it('挂载即按旧平台口径拉第一页：pageNo/pageSize=1/20，name 与 status 都是空串（= 全部）', async () => {
    mountPage()
    await flushPromises()

    expect(matchTableConfigApi.page).toHaveBeenCalledTimes(1)
    expect(lastPageQuery()).toMatchObject({ pageNo: 1, pageSize: 20, name: '', status: '' })
  })

  it('查询条件改了不自动查，点「搜索」才带进请求并回到第一页', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.mocked(matchTableConfigApi.page).mockClear()

    statusSelect(wrapper).vm.$emit('update:modelValue', '1')
    wrapper.find('.mtc-filter-form input').setValue('DIM_JG')
    await flushPromises()

    expect(matchTableConfigApi.page).toHaveBeenCalledTimes(0)

    // 先翻到第二页，搜索要回第一页
    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await flushPromises()
    await wrapper.findAll('.mtc-filter-form button').find((b) => b.text().includes('搜索'))!.trigger('click')
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1, pageSize: 20, name: 'DIM_JG', status: '1' })
  })

  it('重置：清掉已生效条件并回第一页重查', async () => {
    const wrapper = mountPage()
    await flushPromises()

    statusSelect(wrapper).vm.$emit('update:modelValue', '1')
    await wrapper.findAll('.mtc-filter-form button').find((b) => b.text().includes('搜索'))!.trigger('click')
    await flushPromises()
    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await flushPromises()
    vi.mocked(matchTableConfigApi.page).mockClear()

    await wrapper.findAll('.mtc-filter-form button').find((b) => b.text().includes('重置'))!.trigger('click')
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1, name: '', status: '' })
  })

  it('选表类型按码值渲染中文；未知码值留空（旧版会静默显示成向量选表）', async () => {
    vi.mocked(matchTableConfigApi.page).mockResolvedValueOnce({
      total: 1,
      list: [{ id: 9, tableName: 'DIC_YHH', selectionType: 'unknown_type', rule: '', status: '0' }],
    })
    const wrapper = mountPage()
    await flushPromises()

    const firstRow = wrapper.findAll('.el-table__body-wrapper tbody tr')[0]!
    expect(firstRow.text()).not.toContain('向量选表')
    expect(firstRow.text()).not.toContain('unknown_type')

    vi.mocked(matchTableConfigApi.page).mockResolvedValueOnce({
      total: 1,
      list: [{ id: 8, tableName: 'DIC_YHH', selectionType: 'vector_selection', rule: '', status: '0' }],
    })
    const known = mountPage()
    await flushPromises()
    expect(known.findAll('.el-table__body-wrapper tbody tr')[0]!.text()).toContain('向量选表')
  })

  it('状态列是滑动开关，点下去发 changeStatus(id, 目标 status)，失败回滚后重试仍是同一个目标值', async () => {
    const wrapper = mountPage()
    await flushPromises()

    vi.mocked(matchTableConfigApi.changeStatus!).mockRejectedValueOnce(new Error('后端拒绝'))
    await wrapper.findAll('.stub-switch')[0]!.trigger('click')
    await flushPromises()
    // 第一行 status '1'（禁用）→ 开成启用
    expect(matchTableConfigApi.changeStatus).toHaveBeenCalledWith(3, '0')

    // 失败已回滚成 '1'，再点一次请求的还是 '0'（不会把乐观值当成现状）
    await wrapper.findAll('.stub-switch')[0]!.trigger('click')
    await flushPromises()
    expect(matchTableConfigApi.changeStatus).toHaveBeenLastCalledWith(3, '0')
  })

  it('「删除」确认后发 remove(id)，成功后留在当前页重查', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await flushPromises()
    vi.mocked(matchTableConfigApi.page).mockClear()

    await wrapper.findAll('.mtc-op-link--danger')[0]!.trigger('click')
    await flushPromises()

    expect(ElMessageBox.confirm).toHaveBeenCalled()
    expect(matchTableConfigApi.remove).toHaveBeenCalledWith(3)
    // 删除后留在当前页重查（旧 handleDelete 传 refresh(false)，不回第一页）
    expect(lastPageQuery()).toMatchObject({ pageNo: 2 })
  })

  it('「删除」取消时不发任何请求', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancelled'))

    await wrapper.findAll('.mtc-op-link--danger')[0]!.trigger('click')
    await flushPromises()

    expect(matchTableConfigApi.remove).not.toHaveBeenCalled()
    expect(matchTableConfigApi.page).toHaveBeenCalledTimes(1)
  })

  it('「新增」开空弹窗，「编辑」把整行交给弹窗', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.findAll('.mtc-operator button').find((b) => b.text().includes('新增'))!.trigger('click')
    expect(dialogOpen).toHaveBeenCalledWith()

    await wrapper.findAll('.mtc-op-link').find((l) => l.text() === '编辑')!.trigger('click')
    expect(dialogOpen.mock.calls.at(-1)?.[0]).toMatchObject({ id: 3, tableName: 'KHFA_KHZBJG_JG', selectionType: 'text_selection' })
  })

  it('弹窗保存成功后回第一页重查', async () => {
    const wrapper = mountPage()
    await flushPromises()

    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 3)
    await flushPromises()
    vi.mocked(matchTableConfigApi.page).mockClear()
    wrapper.findComponent({ name: 'MatchTableConfigEditDialog' }).vm.$emit('saved', { mode: 'add', id: undefined })
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1 })
  })

  it('匹配规则等长字段直接进列，null 渲染成空而不是 "null"', async () => {
    vi.mocked(matchTableConfigApi.page).mockResolvedValueOnce({
      total: 1,
      list: [{ id: 7, tableName: 'KHFA_ZB', selectionType: 'text_selection', status: '0' }],
    })
    const wrapper = mountPage()
    await flushPromises()

    const firstRow = wrapper.findAll('.el-table__body-wrapper tbody tr')[0]!
    expect(firstRow.text()).not.toContain('null')
    expect(firstRow.text()).not.toContain('undefined')
  })
})
