// @vitest-environment jsdom
// 提示词配置列表页接线回归（旧 ai-chat-view src/demo/ChatFlowStepList.vue）。
// 这一页没走 components/templateConfig 通用层（通用层查询区是名称输入框，旧页面是状态下拉；
// 弹窗 16 个字段里有数字输入），把自己实现的部分钉住：
// ① 挂载即按旧口径拉第一页，分页入参带 name: ''（实体没有 name 字段，旧 queryParam 固定发空串）；
// ② 状态改了不自动查，点「搜索」才生效并回第一页；
// ③ 状态列开关点下去发 changeStatus(id, 目标 status)，失败回滚；
// ④ 操作列只有「编辑」（旧平台没有删除端点），新增开空弹窗、编辑把整行交给弹窗。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import ElementPlus, { ElSelect } from 'element-plus'
import ChatFlowStepPage from './index.vue'
import { chatFlowStepApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  chatFlowStepApi: {
    page: vi.fn(async () => ({
      total: 2,
      list: [
        { id: 11, stepCode: 'sql_generate', flowCode: 'chat_main', stepName: 'SQL 生成', templateDef: '问句：{{question}}', retryCount: 3, status: '1', createTime: '2025-01-08 15:21:40' },
        { id: 10, stepCode: 'answer_summary', flowCode: 'chat_main', stepName: '结果总结', templateDef: '查询结果：{{sqlResult}}', retryCount: 0, status: '0', createTime: '2024-12-20 18:03:11' },
      ],
    })),
    save: vi.fn(async () => ({ ok: true, message: '操作成功' })),
    changeStatus: vi.fn(async () => ({ ok: true, message: '请求成功' })),
  },
}))

const dialogOpen = vi.fn()

function mountPage() {
  return mount(ChatFlowStepPage, {
    global: {
      plugins: [ElementPlus],
      stubs: {
        // 弹窗自身的提交口径见 ChatFlowStepEditDialog.test.ts，这里只验列表怎么调它
        ChatFlowStepEditDialog: {
          name: 'ChatFlowStepEditDialog',
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

/** 操作列图标：每行只有「编辑」 */
function editIcon(wrapper: ReturnType<typeof mountPage>, rowIndex = 0) {
  return wrapper.findAll('.el-table__body-wrapper tbody tr')[rowIndex]!.findAll('.cfs-op-icon')[0]!
}
/** 行内图标的文案（已图标化，文案在 el-tooltip 的 content 上） */
function opIconContents(wrapper: ReturnType<typeof mountPage>) {
  return wrapper
    .findAllComponents({ name: 'ElTooltip' })
    .filter((t) => t.find('.cfs-op-icon').exists())
    .map((t) => (t.props() as { content?: string }).content)
}

function lastPageQuery() {
  const calls = vi.mocked(chatFlowStepApi.page).mock.calls
  return (calls.at(-1)?.[0] ?? {}) as Record<string, unknown>
}

/** 查询区唯一那个下拉（状态） */
function statusSelect(wrapper: ReturnType<typeof mountPage>) {
  return wrapper.findAllComponents(ElSelect)[0]!
}
function searchButton(wrapper: ReturnType<typeof mountPage>) {
  return wrapper.findAll('.cfs-filter-form button').find((b) => b.text().includes('搜索'))!
}

beforeEach(() => {
  dialogOpen.mockReset()
  vi.mocked(chatFlowStepApi.page).mockClear()
  vi.mocked(chatFlowStepApi.changeStatus!).mockClear()
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('ChatFlowStepPage', () => {
  it('挂载即按旧平台口径拉第一页：pageNo/pageSize=1/20，name 与 status 都是空串（= 全部）', async () => {
    mountPage()
    await flushPromises()

    expect(chatFlowStepApi.page).toHaveBeenCalledTimes(1)
    expect(lastPageQuery()).toMatchObject({ pageNo: 1, pageSize: 20, name: '', status: '' })
  })

  it('状态下拉改了不自动查，点「搜索」才带进请求并回到第一页', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.mocked(chatFlowStepApi.page).mockClear()

    // 选项在 teleported popper 里，点击方案在 jsdom 下不稳，直接发 update:modelValue
    statusSelect(wrapper).vm.$emit('update:modelValue', '1')
    await flushPromises()

    expect(chatFlowStepApi.page).toHaveBeenCalledTimes(0)

    // 先翻到第二页，搜索要回第一页
    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await flushPromises()
    await searchButton(wrapper).trigger('click')
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1, pageSize: 20, name: '', status: '1' })
  })

  it('状态列是滑动开关，点下去发 changeStatus(id, 目标 status)，失败回滚后重试仍是同一个目标值', async () => {
    const wrapper = mountPage()
    await flushPromises()

    vi.mocked(chatFlowStepApi.changeStatus!).mockRejectedValueOnce(new Error('后端拒绝'))
    await wrapper.findAll('.stub-switch')[0]!.trigger('click')
    await flushPromises()
    // 第一行 status '1'（禁用）→ 开成启用
    expect(chatFlowStepApi.changeStatus).toHaveBeenCalledWith(11, '0')

    // 失败已回滚成 '1'，再点一次请求的还是 '0'（不会把乐观值当成现状）
    await wrapper.findAll('.stub-switch')[0]!.trigger('click')
    await flushPromises()
    expect(chatFlowStepApi.changeStatus).toHaveBeenLastCalledWith(11, '0')
  })

  it('操作列只有「编辑」（旧平台没有删除端点，也不给复制入口）', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const firstRow = wrapper.findAll('.el-table__body-wrapper tbody tr')[0]!
    const links = firstRow.findAll('.cfs-op-icon')
    expect(links.length).toBe(1)
    expect(opIconContents(wrapper)).toEqual(['编辑', '编辑'])
  })

  it('模板定义等长字段直接进列，null 渲染成空而不是 "null"', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const firstRow = wrapper.findAll('.el-table__body-wrapper tbody tr')[0]!
    expect(firstRow.text()).toContain('问句：{{question}}')
    // 第二行没有 dictCodes / execCond，单元格是空白
    const secondRow = wrapper.findAll('.el-table__body-wrapper tbody tr')[1]!
    expect(secondRow.text()).not.toContain('null')
    expect(secondRow.text()).not.toContain('undefined')
  })

  it('「新增」开空弹窗，「编辑」把整行交给弹窗', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.findAll('.cfs-operator button').find((b) => b.text().includes('新增'))!.trigger('click')
    expect(dialogOpen).toHaveBeenCalledWith()

    await editIcon(wrapper).trigger('click')
    expect(dialogOpen.mock.calls.at(-1)?.[0]).toMatchObject({ id: 11, stepCode: 'sql_generate', retryCount: 3 })
  })

  it('弹窗保存成功后回第一页重查', async () => {
    const wrapper = mountPage()
    await flushPromises()

    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 3)
    await flushPromises()
    vi.mocked(chatFlowStepApi.page).mockClear()
    wrapper.findComponent({ name: 'ChatFlowStepEditDialog' }).vm.$emit('saved', { mode: 'add', id: undefined })
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1 })
  })
})
