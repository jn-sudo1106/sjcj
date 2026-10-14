// @vitest-environment jsdom
// 分词配置列表页接线回归（旧 ai-chat-view src/demo/WordSegmentConfigList.vue）。
// 这一页没走 components/templateConfig 通用层（四条件查询 + 批量新增 + 导出），把自己实现的部分钉住：
// ① 挂载即按旧口径拉第一页（type/name/token/status 四个筛选都在 body）；
// ② 改了条件不自动查，点「搜索」才生效并回第一页；
// ③ 状态列是滑动开关，点一下只发一次 changeStatus(id,status)（本域 status 走 body，见接口契约测试），
//    失败回滚、不额外查列表；
// ④ 导出用「已执行的筛选条件」取前 10000 条，不污染列表分页，状态导出成中文；
// ⑤ 工具条只有「批量新增」（旧版没有单条新增入口），操作列只有「编辑」，两个弹窗保存后都回第一页。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import ElementPlus, { ElSelect } from 'element-plus'
import WordSegmentConfigPage from './index.vue'
import { wordSegmentApi } from '@/api/templateConfig'
import { downloadCsv, toCsv } from '@/utils/csv'

vi.mock('@/api/templateConfig', () => ({
  wordSegmentApi: {
    page: vi.fn(async () => ({
      total: 3,
      list: [
        { id: 2669, type: 'ORGANIZATION', content: '新城科技园', token: 'base', status: '0', createTime: '2025-03-25 15:27:18', updateTime: '2025-03-25 15:27:18' },
        // 真实响应里 token 可能为空、status 可能是数字口径
        { id: 2668, type: 'indicatorname', content: '鑫动能', token: null, status: 0, createTime: '2025-03-25 15:23:36', updateTime: '2025-03-25 15:23:36' },
        { id: 2666, type: 'ORGANIZATION', content: '白下分行', token: 'base', status: '1', createTime: '2025-03-20 18:28:52', updateTime: '2025-03-20 18:28:52' },
      ],
    })),
    update: vi.fn(async () => ({ ok: true, message: '操作成功' })),
    changeStatus: vi.fn(async () => ({ ok: true, message: '操作成功' })),
    batchAdd: vi.fn(async () => ({ ok: true, message: '操作成功' })),
  },
}))

// jsdom 没有 URL.createObjectURL，且下载会真触发 a.click —— 整个 util mock 掉，只验调用参数
vi.mock('@/utils/csv', () => ({
  toCsv: vi.fn(() => 'csv-content'),
  downloadCsv: vi.fn(),
  csvDateTag: vi.fn(() => '20261014'),
}))

const editOpen = vi.fn()
const batchOpen = vi.fn()

function mountPage() {
  return mount(WordSegmentConfigPage, {
    global: {
      plugins: [ElementPlus],
      stubs: {
        // 弹窗自身的提交口径见各自的 .test.ts，这里只验列表怎么调它们
        WordSegmentConfigEditDialog: {
          name: 'WordSegmentConfigEditDialog',
          emits: ['saved'],
          setup(_p: unknown, { expose }: { expose: (o: Record<string, unknown>) => void }) {
            expose({ open: editOpen, close: vi.fn() })
            return () => h('div', { class: 'stub-edit-dialog' })
          },
        },
        WordSegmentBatchAddDialog: {
          name: 'WordSegmentBatchAddDialog',
          emits: ['saved'],
          setup(_p: unknown, { expose }: { expose: (o: Record<string, unknown>) => void }) {
            expose({ open: batchOpen, close: vi.fn() })
            return () => h('div', { class: 'stub-batch-dialog' })
          },
        },
        ElSwitch: {
          name: 'ElSwitch',
          props: ['modelValue'],
          emits: ['change'],
          // 开关文字跟着 modelValue 回显，回滚断言才看得出状态有没有翻回去
          template: '<button class="stub-switch" @click="$emit(\'change\', !modelValue)">{{ modelValue ? "启用" : "禁用" }}</button>',
        },
        ElPagination: {
          name: 'ElPagination',
          props: ['currentPage', 'pageSize', 'total'],
          template: '<div class="stub-pager"><button class="stub-page-2" @click="$emit(\'current-change\', 2)" /></div>',
        },
      },
    },
  })
}

function lastPageQuery() {
  const calls = vi.mocked(wordSegmentApi.page).mock.calls
  return (calls.at(-1)?.[0] ?? {}) as Record<string, unknown>
}

function rowsOf(wrapper: ReturnType<typeof mountPage>) {
  return wrapper.findAll('.el-table__body-wrapper tbody tr')
}
function cellsOf(wrapper: ReturnType<typeof mountPage>, index: number) {
  return rowsOf(wrapper)[index]!.findAll('td').map((td) => td.text())
}
/** 查询区只有一个下拉：状态 */
function statusSelect(wrapper: ReturnType<typeof mountPage>) {
  return wrapper.findAllComponents(ElSelect)[0]!
}
function buttonInFilter(wrapper: ReturnType<typeof mountPage>, label: string) {
  return wrapper.findAll('.ws-filter-form button, .ws-operator button').find((b) => b.text().includes(label))!
}
function statusSwitch(wrapper: ReturnType<typeof mountPage>, rowIndex = 0) {
  return wrapper.findAll('.stub-switch')[rowIndex]!
}
function editLink(wrapper: ReturnType<typeof mountPage>, rowIndex = 0) {
  return rowsOf(wrapper)[rowIndex]!.findAll('.ws-op-link')[0]!
}

beforeEach(() => {
  editOpen.mockReset()
  batchOpen.mockReset()
  vi.mocked(wordSegmentApi.page).mockClear()
  vi.mocked(wordSegmentApi.changeStatus).mockClear()
  vi.mocked(downloadCsv).mockClear()
  vi.mocked(toCsv).mockClear()
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('WordSegmentConfigPage', () => {
  it('挂载即按旧平台口径拉第一页（四个筛选都带空串）', async () => {
    mountPage()
    await flushPromises()

    expect(wordSegmentApi.page).toHaveBeenCalledTimes(1)
    expect(lastPageQuery()).toMatchObject({ pageNo: 1, pageSize: 20, type: '', name: '', token: '', status: '' })
  })

  it('改了查询条件不自动查，点「搜索」才把四个条件带进请求并回到第一页', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.mocked(wordSegmentApi.page).mockClear()

    await wrapper.find('input[placeholder="类型"]').setValue(' PERSON ')
    await wrapper.find('input[placeholder="内容"]').setValue('  分行  ')
    await wrapper.find('input[placeholder="分词类型"]').setValue(' base ')
    statusSelect(wrapper).vm.$emit('update:modelValue', '1')
    await flushPromises()

    // 改完还没点搜索，不应发起新请求
    expect(wordSegmentApi.page).toHaveBeenCalledTimes(0)

    await buttonInFilter(wrapper, '搜索').trigger('click')
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1, type: 'PERSON', name: '分行', token: 'base', status: '1' })
  })

  it('状态列是滑动开关：置为禁用只发一次 changeStatus(2669,"1")，开关就地翻转、不再额外查列表', async () => {
    const wrapper = mountPage()
    await flushPromises()
    // 先翻到第二页，验证启停不会打断当前页（旧 changeStatus 传 handleRefresh(false) 回当前页，
    // 这里是乐观更新，连当前页这一次请求都省掉，同通用列表层与数据字典的口径）
    await wrapper.find('.stub-page-2').trigger('click')
    await flushPromises()
    expect(lastPageQuery()).toMatchObject({ pageNo: 2 })
    vi.mocked(wordSegmentApi.page).mockClear()

    await statusSwitch(wrapper, 0).trigger('click')
    await flushPromises()

    expect(wordSegmentApi.changeStatus).toHaveBeenCalledTimes(1)
    expect(vi.mocked(wordSegmentApi.changeStatus).mock.calls[0]).toEqual([2669, '1'])
    expect(statusSwitch(wrapper, 0).text()).toBe('禁用')
    expect(wordSegmentApi.page).not.toHaveBeenCalled()
  })

  it('启停失败回滚开关状态，不发额外请求', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.mocked(wordSegmentApi.page).mockClear()

    vi.mocked(wordSegmentApi.changeStatus).mockRejectedValueOnce(new Error('未找到对应的分词配置'))
    await statusSwitch(wrapper, 0).trigger('click')
    await flushPromises()

    // 乐观更新翻成禁用后请求失败，开关文字回到「启用」
    expect(statusSwitch(wrapper, 0).text()).toBe('启用')
    expect(document.body.textContent).toContain('未找到对应的分词配置')
    expect(wordSegmentApi.page).not.toHaveBeenCalled()
  })

  it('空值列（token=null）渲染空串不是 "null"；status 回数字 0 也按启用渲染', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const cells = cellsOf(wrapper, 1)
    expect(cells).not.toContain('null')
    // 列顺序照旧页：id / 类型 / 内容 / 分词类型 / 状态 / 创建 / 修改 / 操作
    expect(cells[3]).toBe('')
    expect(cells[4]).toBe('启用')
  })

  it('「导出」按已执行的筛选条件拉前 10000 条生成 CSV，状态列导出成中文，文件名带日期后缀', async () => {
    const wrapper = mountPage()
    await flushPromises()

    // 先执行一次搜索，导出必须带的是「已执行」的筛选值
    await wrapper.find('input[placeholder="内容"]').setValue('分行')
    await buttonInFilter(wrapper, '搜索').trigger('click')
    await flushPromises()
    vi.mocked(wordSegmentApi.page).mockClear()

    await buttonInFilter(wrapper, '导出').trigger('click')
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1, pageSize: 10000, name: '分行' })
    expect(vi.mocked(toCsv).mock.calls[0]?.[0]).toEqual(['id', '类型', '内容', '分词类型', '状态', '创建时间', '修改时间'])
    expect(vi.mocked(toCsv).mock.calls[0]?.[1]?.[0]).toEqual([2669, 'ORGANIZATION', '新城科技园', 'base', '启用', '2025-03-25 15:27:18', '2025-03-25 15:27:18'])
    expect(vi.mocked(downloadCsv).mock.calls[0]?.[0]).toBe('分词配置列表_20261014')
  })

  it('导出用的是独立参数，不会把 pageSize=10000 污染到之后的列表查询', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await buttonInFilter(wrapper, '导出').trigger('click')
    await flushPromises()
    await wrapper.find('.stub-page-2').trigger('click')
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 2, pageSize: 20 })
  })

  it('导出失败只提示，不影响列表已加载的数据', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.mocked(wordSegmentApi.page).mockRejectedValueOnce(new Error('会话已过期'))

    await buttonInFilter(wrapper, '导出').trigger('click')
    await flushPromises()

    expect(downloadCsv).not.toHaveBeenCalled()
    expect(rowsOf(wrapper)).toHaveLength(3)
  })

  it('工具条只有「批量新增」（旧版没有单条新增入口），「编辑」把整行交给编辑弹窗', async () => {
    const wrapper = mountPage()
    await flushPromises()

    // 工具条只有批量新增这一个按钮（旧列表的 showAdd 没绑任何入口，不迁单条新增）
    expect(wrapper.findAll('.ws-operator button').map((b) => b.text())).toEqual(['批量新增'])

    await editLink(wrapper, 0).trigger('click')
    expect(editOpen.mock.calls.at(-1)?.[0]).toMatchObject({ id: 2669, type: 'ORGANIZATION', content: '新城科技园', token: 'base' })
  })

  it('批量新增弹窗保存成功后回第一页重查', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await buttonInFilter(wrapper, '批量新增').trigger('click')
    expect(batchOpen).toHaveBeenCalledWith()

    await wrapper.find('.stub-page-2').trigger('click')
    await flushPromises()
    vi.mocked(wordSegmentApi.page).mockClear()

    wrapper.findComponent({ name: 'WordSegmentBatchAddDialog' }).vm.$emit('saved', { count: 2 })
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1 })
  })

  it('编辑弹窗保存成功后回第一页重查', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('.stub-page-2').trigger('click')
    await flushPromises()
    vi.mocked(wordSegmentApi.page).mockClear()

    wrapper.findComponent({ name: 'WordSegmentConfigEditDialog' }).vm.$emit('saved', { id: 2669 })
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1 })
  })
})
