// @vitest-environment jsdom
// 问句改写列表页接线回归（旧 ai-chat-view src/demo/QuestionDicList.vue）。
// 这一页没走 components/templateConfig 通用层（四条件查询 + 码值列 + 删除），把它自己实现的部分钉住：
// ① 四个筛选条件都进 body、且只有点「搜索」才生效；② 阶段/类型按码值渲染中文；
// ③ 启停走 changeStatus(id, 目标 status)；④ 删除必须确认后才有请求，且发的是整行。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { h } from 'vue'
import ElementPlus, { ElMessageBox, ElSelect } from 'element-plus'
import QuestionDicPage from './index.vue'
import { questionDicApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  questionDicApi: {
    page: vi.fn(async () => ({
      total: 2,
      list: [
        { id: 11, stepCode: 'before-llm', type: '11', receiveRule: "string.contains(msg,'机构')", content: '各个机构', targetContent: '各机构', status: '1', createTime: '2025-01-08 15:21:40' },
        { id: 10, stepCode: 'after-llm', type: '20', receiveRule: '', content: '指标名称', targetContent: 'jgmc', status: '0', createTime: '2024-12-20 18:03:11' },
      ],
    })),
    save: vi.fn(async () => ({ ok: true, message: '操作成功' })),
    changeStatus: vi.fn(async () => ({ ok: true, message: '请求成功' })),
    remove: vi.fn(async () => ({ ok: true, message: '删除成功' })),
  },
}))

const dialogOpen = vi.fn()

function mountPage() {
  return mount(QuestionDicPage, {
    global: {
      plugins: [ElementPlus],
      stubs: {
        // 弹窗自身的提交口径见 QuestionDicEditDialog.test.ts，这里只验列表怎么调它
        QuestionDicEditDialog: {
          name: 'QuestionDicEditDialog',
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
  const calls = vi.mocked(questionDicApi.page).mock.calls
  return (calls.at(-1)?.[0] ?? {}) as Record<string, unknown>
}

/** 查询区第 n 个下拉（顺序照页面：阶段 / 类型 / 状态） */
function selectAt(wrapper: ReturnType<typeof mountPage>, index: number) {
  return wrapper.findAllComponents(ElSelect)[index]!
}
function searchButton(wrapper: ReturnType<typeof mountPage>) {
  return wrapper.findAll('.qd-filter-form button').find((b) => b.text().includes('搜索'))!
}

/** 行内操作图标：操作列已图标化，按 el-tooltip 的 content（原按钮文案）定位第 rowIndex 行的图标 */
function opIcon(wrapper: ReturnType<typeof mountPage>, content: string, rowIndex = 0) {
  // `findAll` 拿到的是 **DOMWrapper**（不是 VueWrapper），而 @vue/test-utils 给
  // `DOMWrapper.findAllComponents` 的签名就是 `(selector: any) => any`（见 domWrapper.d.ts），
  // 所以 `.filter/.find` 的回调参数会落成隐式 any（TS7006）。这里显式标注成 VueWrapper，
  // 顺带让 `tips/tip` 有真实类型（否则整条链一路 any）。
  const tips = wrapper
    .findAll('.el-table__body-wrapper tbody tr')[rowIndex]!
    .findAllComponents({ name: 'ElTooltip' }) as VueWrapper[]
  const tip = tips
    .filter((t) => t.find('.qd-op-icon').exists())
    .find((t) => (t.props() as { content?: string }).content === content)
  if (!tip) throw new Error(`第 ${rowIndex} 行找不到操作：${content}`)
  return tip.find('.qd-op-icon')
}

beforeEach(() => {
  dialogOpen.mockReset()
  vi.mocked(questionDicApi.page).mockClear()
  vi.mocked(questionDicApi.changeStatus!).mockClear()
  vi.mocked(questionDicApi.remove).mockClear()
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('QuestionDicPage', () => {
  it('挂载即按旧平台口径拉第一页，四个筛选条件都带空串（= 全部）', async () => {
    mountPage()
    await flushPromises()

    expect(questionDicApi.page).toHaveBeenCalledTimes(1)
    expect(lastPageQuery()).toMatchObject({ pageNo: 1, pageSize: 20, name: '', stepCode: '', type: '', status: '' })
  })

  it('改了查询条件不自动查，点「搜索」才把四个条件带进请求并回到第一页', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.mocked(questionDicApi.page).mockClear()

    // 下拉直接发 update:modelValue（选项在 teleported popper 里，点击方案在 jsdom 下不稳）
    selectAt(wrapper, 0).vm.$emit('update:modelValue', 'before-llm')
    selectAt(wrapper, 1).vm.$emit('update:modelValue', '11')
    selectAt(wrapper, 2).vm.$emit('update:modelValue', '1')
    await wrapper.find('input[placeholder="内容"]').setValue('  机构  ')
    await flushPromises()

    // 改完还没点搜索，不应发起新请求
    expect(questionDicApi.page).toHaveBeenCalledTimes(0)

    await searchButton(wrapper).trigger('click')
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1, stepCode: 'before-llm', type: '11', status: '1', name: '机构' })
  })

  it('阶段与类型列把码值渲染成中文，不是裸码值', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const firstRow = wrapper.findAll('.el-table__body-wrapper tbody tr')[0]!
    const cells = firstRow.findAll('td').map((td) => td.text())
    expect(cells).toContain('大模型调用前替换')
    expect(cells).toContain('正则替换')
    expect(cells.join(' ')).not.toContain('before-llm')
  })

  it('状态开关点下去发 changeStatus(id, 目标 status)，失败回滚后重试仍是同一个目标值', async () => {
    const wrapper = mountPage()
    await flushPromises()

    vi.mocked(questionDicApi.changeStatus!).mockRejectedValueOnce(new Error('后端拒绝'))
    await wrapper.findAll('.stub-switch')[0]!.trigger('click')
    await flushPromises()
    // 第一行 status '1'（禁用）→ 开成启用
    expect(questionDicApi.changeStatus).toHaveBeenCalledWith(11, '0')

    // 失败已回滚成 '1'，再点一次请求的还是 '0'（不会把乐观值当成现状）
    await wrapper.findAll('.stub-switch')[0]!.trigger('click')
    await flushPromises()
    expect(questionDicApi.changeStatus).toHaveBeenLastCalledWith(11, '0')
  })

  it('「删除」确认后发 remove，body 是整行（不只发 id），成功后留在当前页重查', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.mocked(questionDicApi.page).mockClear()

    await opIcon(wrapper, '删除').trigger('click')
    await flushPromises()

    expect(ElMessageBox.confirm).toHaveBeenCalled()
    expect(vi.mocked(questionDicApi.remove).mock.calls[0]?.[0]).toMatchObject({
      id: 11,
      stepCode: 'before-llm',
      type: '11',
      content: '各个机构',
      targetContent: '各机构',
    })
    // 删除后留在当前页重查（旧 changeStatus/handleDelete 都传 refresh(false)，不回第一页）
    expect(questionDicApi.page).toHaveBeenCalledTimes(1)
  })

  it('「删除」点取消不发请求', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancelled'))

    await opIcon(wrapper, '删除').trigger('click')
    await flushPromises()

    expect(questionDicApi.remove).not.toHaveBeenCalled()
    expect(questionDicApi.page).toHaveBeenCalledTimes(1)
  })

  it('「新增」开空弹窗，「编辑」把整行交给弹窗', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.findAll('.qd-operator button').find((b) => b.text().includes('新增'))!.trigger('click')
    expect(dialogOpen).toHaveBeenCalledWith()

    await opIcon(wrapper, '编辑').trigger('click')
    expect(dialogOpen.mock.calls.at(-1)?.[0]).toMatchObject({ id: 11, content: '各个机构', targetContent: '各机构' })
  })

  it('弹窗保存成功后回第一页重查', async () => {
    const wrapper = mountPage()
    await flushPromises()

    vi.mocked(questionDicApi.page).mockClear()
    wrapper.findComponent({ name: 'QuestionDicEditDialog' }).vm.$emit('saved', { mode: 'add', id: undefined })
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1 })
  })
})
