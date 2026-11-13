// @vitest-environment jsdom
// 表模板列表页接线回归（旧 ai-chat-view src/demo/QuestionTempConfig.vue）。
// 这一页没走 components/templateConfig 通用层，所以把它自己实现的部分钉住：
// 分页口径、状态开关、以及「复制」不能发出请求（旧平台没有该端点）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import ElementPlus from 'element-plus'
import TableTemplatePage from './index.vue'
import { tableTemplateApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  pocTableEntryList: vi.fn(async () => []),
  sqlTemplateApi: { page: vi.fn(async () => ({ total: 0, list: [] })) },
  tableTemplateApi: {
    page: vi.fn(async () => ({
      total: 2,
      list: [
        { id: 12, name: '查询某机构某日期的指标值', status: '0', createTime: '2025-04-15 09:52:07' },
        { id: 11, name: '同比环比类问句', status: '1', createTime: '2025-01-08 15:21:40' },
      ],
    })),
    save: vi.fn(async () => ({ ok: true, message: '提交成功' })),
    changeStatus: vi.fn(async () => ({ ok: true, message: '请求成功' })),
  },
}))

const dialogOpen = vi.fn()

function mountPage() {
  return mount(TableTemplatePage, {
    global: {
      plugins: [ElementPlus],
      stubs: {
        // 弹窗自身的字段序列化见 TableTemplateEditDialog.test.ts，这里只验列表怎么调它
        TableTemplateEditDialog: {
          name: 'TableTemplateEditDialog',
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

/** 操作列图标：第 0 个是编辑，第 1 个是复制 */
function rowIcon(wrapper: ReturnType<typeof mountPage>, rowIndex: number, iconIndex: number) {
  return wrapper.findAll('.el-table__body-wrapper tbody tr')[rowIndex]!.findAll('.tt-op-icon')[iconIndex]!
}
const editIcon = (wrapper: ReturnType<typeof mountPage>, rowIndex = 0) => rowIcon(wrapper, rowIndex, 0)
const copyIcon = (wrapper: ReturnType<typeof mountPage>, rowIndex = 0) => rowIcon(wrapper, rowIndex, 1)

function lastPageQuery() {
  const calls = vi.mocked(tableTemplateApi.page).mock.calls
  return (calls.at(-1)?.[0] ?? {}) as Record<string, unknown>
}

beforeEach(() => {
  dialogOpen.mockReset()
  vi.mocked(tableTemplateApi.page).mockClear()
  vi.mocked(tableTemplateApi.changeStatus!).mockClear()
})

describe('TableTemplatePage', () => {
  it('挂载即按旧平台分页口径 pageNo/pageSize/name 拉第一页', async () => {
    mountPage()
    await flushPromises()

    expect(tableTemplateApi.page).toHaveBeenCalledTimes(1)
    expect(lastPageQuery()).toMatchObject({ pageNo: 1, pageSize: 20, name: '' })
  })

  it('点「搜索」把问句样例名称去空格后带进查询，并回到第一页', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('.tt-filter-form input').setValue('  同比  ')
    await wrapper.findAll('.tt-filter-form button').find((b) => b.text().includes('搜索'))!.trigger('click')
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1, name: '同比' })
  })

  it('状态开关点下去发 changeStatus(id, 目标 status)，失败回滚后重试仍是同一个目标值', async () => {
    const wrapper = mountPage()
    await flushPromises()

    vi.mocked(tableTemplateApi.changeStatus!).mockRejectedValueOnce(new Error('后端拒绝'))
    await wrapper.findAll('.stub-switch')[0]!.trigger('click')
    await flushPromises()
    // 第一行 status '0'（启用）→ 关成禁用
    expect(tableTemplateApi.changeStatus).toHaveBeenCalledWith(12, '1')

    // 失败已回滚成 '0'，再点一次请求的还是 '1'（不会把回滚前的乐观值当成现状）
    await wrapper.findAll('.stub-switch')[0]!.trigger('click')
    await flushPromises()
    expect(tableTemplateApi.changeStatus).toHaveBeenLastCalledWith(12, '1')

    // 成功后乐观值保留，下一次点下去就是反向
    await wrapper.findAll('.stub-switch')[0]!.trigger('click')
    await flushPromises()
    expect(tableTemplateApi.changeStatus).toHaveBeenLastCalledWith(12, '0')
  })

  it('「复制」不发请求，只提示旧平台未提供该接口', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.mocked(tableTemplateApi.page).mockClear()

    await copyIcon(wrapper).trigger('click')
    await flushPromises()

    expect(tableTemplateApi.page).toHaveBeenCalledTimes(0)
    expect(document.body.textContent).toContain('旧平台未提供表模板复制接口')
    document.body.innerHTML = ''
  })

  it('「新增」开空弹窗，「编辑」把整行交给弹窗', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.findAll('.tt-operator button').find((b) => b.text().includes('新增'))!.trigger('click')
    expect(dialogOpen).toHaveBeenCalledWith()

    await editIcon(wrapper).trigger('click')
    expect(dialogOpen.mock.calls.at(-1)?.[0]).toMatchObject({ id: 12, name: '查询某机构某日期的指标值' })
  })

  it('弹窗保存成功后回第一页重查', async () => {
    const wrapper = mountPage()
    await flushPromises()

    vi.mocked(tableTemplateApi.page).mockClear()
    wrapper.findComponent({ name: 'TableTemplateEditDialog' }).vm.$emit('saved', { mode: 'add', id: undefined })
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1 })
  })
})
