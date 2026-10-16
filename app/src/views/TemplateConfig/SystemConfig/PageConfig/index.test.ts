// @vitest-environment jsdom
// 页面配置列表页接线回归（旧 ai-chat-view src/system/config/SysPageConfigList.vue）。
// 这一页没走 components/templateConfig 通用层（状态下拉 + 批量新增 + 导出），把自己实现的部分钉住：
// ① 挂载即按旧入参形状拉第一页（queryParam 固定带 name:''/type:''/status:''，两个搜索框旧版被注释掉但参数照发）；
// ② 改了条件不自动查，点「搜索」才生效并回第一页；
// ③ 状态列是滑动开关，点一下只发一次 changeStatus(id,status)（本域 status 走 body，见接口契约测试），
//    失败回滚、不额外查列表；
// ④ 导出用「已执行的筛选条件」取前 10000 条，不污染列表分页，状态导出成中文，
//    文件名按本页正名「页面配置列表_」（旧版复制自分词页、写的是「分词配置列表_」）；
// ⑤ 工具条只有「批量新增」（旧版没有单条新增入口），操作列只有「编辑」，两个弹窗保存后都回第一页。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import ElementPlus, { ElSelect } from 'element-plus'
import PageConfigPage from './index.vue'
import { pageConfigApi } from '@/api/templateConfig'
import { downloadXlsx } from '@/utils/format/xlsxExport'

vi.mock('@/api/templateConfig', () => ({
  pageConfigApi: {
    page: vi.fn(async () => ({
      total: 3,
      list: [
        { id: 3, content: '问数首页', status: '0', createTime: '2025-03-21 10:00:00', updateTime: '2025-03-21 10:00:00' },
        // 真实响应 status 可能是数字口径
        { id: 2, content: '图表详情页', status: 0, createTime: '2025-03-21 10:00:00', updateTime: '2025-05-06 11:20:00' },
        { id: 1, content: '指标解释弹层', status: '1', createTime: '2025-04-01 09:30:00', updateTime: '2025-04-01 09:30:00' },
      ],
    })),
    update: vi.fn(async () => ({ ok: true, message: '操作成功' })),
    changeStatus: vi.fn(async () => ({ ok: true, message: '操作成功' })),
    batchAdd: vi.fn(async () => ({ ok: true, message: '操作成功' })),
  },
}))

// jsdom 没有 URL.createObjectURL，且下载会真触发 a.click —— 整个 util mock 掉，只验调用参数
vi.mock('@/utils/format/xlsxExport', () => ({
  downloadXlsx: vi.fn(),
  exportDateTag: vi.fn(() => '20261015'),
}))

const editOpen = vi.fn()
const batchOpen = vi.fn()

function mountPage() {
  return mount(PageConfigPage, {
    global: {
      plugins: [ElementPlus],
      stubs: {
        // 弹窗自身的提交口径见各自的 .test.ts，这里只验列表怎么调它们
        PageConfigEditDialog: {
          name: 'PageConfigEditDialog',
          emits: ['saved'],
          setup(_p: unknown, { expose }: { expose: (o: Record<string, unknown>) => void }) {
            expose({ open: editOpen, close: vi.fn() })
            return () => h('div', { class: 'stub-edit-dialog' })
          },
        },
        PageConfigBatchAddDialog: {
          name: 'PageConfigBatchAddDialog',
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
  const calls = vi.mocked(pageConfigApi.page).mock.calls
  return (calls.at(-1)?.[0] ?? {}) as Record<string, unknown>
}
function rowsOf(wrapper: ReturnType<typeof mountPage>) {
  return wrapper.findAll('.el-table__body-wrapper tbody tr')
}
/** 查询区只有一个下拉：状态 */
function statusSelect(wrapper: ReturnType<typeof mountPage>) {
  return wrapper.findAllComponents(ElSelect)[0]!
}
function buttonInFilter(wrapper: ReturnType<typeof mountPage>, label: string) {
  return wrapper.findAll('.scp-filter-form button, .scp-operator button').find((b) => b.text().includes(label))!
}
function statusSwitch(wrapper: ReturnType<typeof mountPage>, rowIndex = 0) {
  return wrapper.findAll('.stub-switch')[rowIndex]!
}
function editIcon(wrapper: ReturnType<typeof mountPage>, rowIndex = 0) {
  return rowsOf(wrapper)[rowIndex]!.findAll('.scp-op-icon')[0]!
}

beforeEach(() => {
  editOpen.mockReset()
  batchOpen.mockReset()
  vi.mocked(pageConfigApi.page).mockClear()
  vi.mocked(pageConfigApi.changeStatus).mockClear()
  vi.mocked(downloadXlsx).mockClear()
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('页面配置列表页', () => {
  it('挂载即按旧入参形状拉第一页：name/type/status 三个键都在 body', async () => {
    mountPage()
    await flushPromises()
    expect(lastPageQuery()).toEqual({ pageNo: 1, pageSize: 20, name: '', type: '', status: '' })
  })

  it('改了条件不自动查，点搜索才生效并回第一页', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.mocked(pageConfigApi.page).mockClear()

    statusSelect(wrapper).vm.$emit('update:modelValue', '1')
    expect(pageConfigApi.page).not.toHaveBeenCalled()

    await buttonInFilter(wrapper, '搜索').trigger('click')
    await flushPromises()
    expect(lastPageQuery()).toEqual({ pageNo: 1, pageSize: 20, name: '', type: '', status: '1' })
  })

  it('状态开关：点一下只发一次 changeStatus(id,status)，失败回滚、不重查列表', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.mocked(pageConfigApi.page).mockClear()
    vi.mocked(pageConfigApi.changeStatus).mockRejectedValueOnce(new Error('未找到对应的页面配置'))

    // 第二行 status 是数字 0 → 开关显示启用；点一下发 '1'，失败回滚
    await statusSwitch(wrapper, 1).trigger('click')
    await flushPromises()
    expect(vi.mocked(pageConfigApi.changeStatus).mock.calls[0]).toEqual([2, '1'])
    expect(statusSwitch(wrapper, 1).text()).toBe('启用')

    await statusSwitch(wrapper, 1).trigger('click')
    await flushPromises()
    expect(statusSwitch(wrapper, 1).text()).toBe('禁用')
    // 乐观更新方案不额外查列表（旧版启停后重查当前页）
    expect(pageConfigApi.page).not.toHaveBeenCalled()
  })

  it('导出：按已执行筛选取前 10000 条，状态导出中文，文件名「页面配置列表_」，不污染列表分页', async () => {
    const wrapper = mountPage()
    await flushPromises()
    statusSelect(wrapper).vm.$emit('update:modelValue', '0')
    await buttonInFilter(wrapper, '搜索').trigger('click')
    await flushPromises()
    vi.mocked(pageConfigApi.page).mockClear()

    await buttonInFilter(wrapper, '导出').trigger('click')
    await flushPromises()
    expect(lastPageQuery()).toEqual({ pageNo: 1, pageSize: 10000, name: '', type: '', status: '0' })

    const [filename, cells] = vi.mocked(downloadXlsx).mock.calls[0]!
    expect(filename).toBe('页面配置列表_20261015')
    expect(cells[0]).toEqual(['id', '内容', '状态', '创建时间', '修改时间'])
    // id 按原值（数字）进表，状态渲染成中文（旧版导出的是原码值 0/1）
    expect(cells[1]).toEqual([3, '问数首页', '启用', '2025-03-21 10:00:00', '2025-03-21 10:00:00'])
    // 数字 status 0 也渲染成中文
    expect(cells[2]?.[2]).toBe('启用')
  })

  it('工具条只有「批量新增」（旧版没有单条新增入口），操作列只有「编辑」', async () => {
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.findAll('.scp-operator button').map((b) => b.text())).toEqual(['批量新增'])
    await editIcon(wrapper, 0).trigger('click')
    expect(editOpen).toHaveBeenCalledTimes(1)
    expect(editOpen.mock.calls[0]?.[0]).toMatchObject({ id: 3, content: '问数首页' })
    await buttonInFilter(wrapper, '批量新增').trigger('click')
    expect(batchOpen).toHaveBeenCalledTimes(1)
  })

  it('两个弹窗保存后都回第一页重查', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await editIcon(wrapper, 0).trigger('click')
    await flushPromises()

    vi.mocked(pageConfigApi.page).mockClear()
    wrapper.findComponent({ name: 'PageConfigEditDialog' }).vm.$emit('saved', { id: 3 })
    await flushPromises()
    expect(vi.mocked(pageConfigApi.page)).toHaveBeenCalledTimes(1)
    expect(lastPageQuery().pageNo).toBe(1)

    vi.mocked(pageConfigApi.page).mockClear()
    wrapper.findComponent({ name: 'PageConfigBatchAddDialog' }).vm.$emit('saved', { count: 2 })
    await flushPromises()
    expect(vi.mocked(pageConfigApi.page)).toHaveBeenCalledTimes(1)
    expect(lastPageQuery().pageNo).toBe(1)
  })
})
