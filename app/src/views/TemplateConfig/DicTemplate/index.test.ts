// @vitest-environment jsdom
// 自动补全列表页接线回归（旧 ai-chat-view src/demo/DicConfig.vue）。
// 这一页没走 components/templateConfig 通用层（带导出、无启停/复制），把它自己实现的部分钉住：
// 分页口径（筛选参数叫 name）、导出用「已执行的筛选条件」且不污染列表分页、操作列只有编辑。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import ElementPlus from 'element-plus'
import DicTemplatePage from './index.vue'
import { dicTemplateApi } from '@/api/templateConfig'
import { downloadXlsx } from '@/utils/format/xlsxExport'

vi.mock('@/api/templateConfig', () => ({
  dicTemplateApi: {
    page: vi.fn(async () => ({
      total: 2,
      list: [
        { id: 3, content: '查询某机构某日期的客户指标结果', keyWords: '机构 日期', createTime: '2025-04-15 09:52:07' },
        { id: 2, content: '同比环比类指标查询', keyWords: '同比 环比', createTime: '2025-01-08 15:21:40' },
      ],
    })),
    save: vi.fn(async () => ({ ok: true, message: '操作成功' })),
  },
}))

// jsdom 没有 URL.createObjectURL，且下载会真触发 a.click —— 整个 util mock 掉，只验调用参数
vi.mock('@/utils/format/xlsxExport', () => ({
  downloadXlsx: vi.fn(),
  exportDateTag: vi.fn(() => '20261013'),
}))

const dialogOpen = vi.fn()

function mountPage() {
  return mount(DicTemplatePage, {
    global: {
      plugins: [ElementPlus],
      stubs: {
        // 弹窗自身的提交口径见 DicTemplateEditDialog.test.ts，这里只验列表怎么调它
        DicTemplateEditDialog: {
          name: 'DicTemplateEditDialog',
          emits: ['saved'],
          setup(_p: unknown, { expose }: { expose: (o: Record<string, unknown>) => void }) {
            expose({ open: dialogOpen, close: vi.fn() })
            return () => h('div', { class: 'stub-dialog' })
          },
        },
        ElPagination: { name: 'ElPagination', props: ['currentPage', 'pageSize', 'total'], template: '<div class="stub-pager" />' },
      },
    },
  })
}

/** 操作列图标：每行只有「编辑」 */
function editIcon(wrapper: ReturnType<typeof mountPage>, rowIndex = 0) {
  return wrapper.findAll('.el-table__body-wrapper tbody tr')[rowIndex]!.findAll('.dt-op-icon')[0]!
}
/** 行内图标的文案（已图标化，文案在 el-tooltip 的 content 上） */
function opIconContents(wrapper: ReturnType<typeof mountPage>) {
  return wrapper
    .findAllComponents({ name: 'ElTooltip' })
    .filter((t) => t.find('.dt-op-icon').exists())
    .map((t) => (t.props() as { content?: string }).content)
}

function lastPageQuery() {
  const calls = vi.mocked(dicTemplateApi.page).mock.calls
  return (calls.at(-1)?.[0] ?? {}) as Record<string, unknown>
}

beforeEach(() => {
  dialogOpen.mockReset()
  vi.mocked(dicTemplateApi.page).mockClear()
  vi.mocked(downloadXlsx).mockClear()
})

describe('DicTemplatePage', () => {
  it('挂载即按旧平台分页口径 pageNo/pageSize/name 拉第一页', async () => {
    mountPage()
    await flushPromises()

    expect(dicTemplateApi.page).toHaveBeenCalledTimes(1)
    expect(lastPageQuery()).toMatchObject({ pageNo: 1, pageSize: 20, name: '' })
  })

  it('点「搜索」把内容关键字去空格后以 name 参数带进查询，并回到第一页', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('.dt-filter-form input').setValue('  指标  ')
    await wrapper.findAll('.dt-filter-form button').find((b) => b.text().includes('搜索'))!.trigger('click')
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1, name: '指标' })
  })

  it('「导出」按已执行的筛选条件拉前 10000 条生成 xlsx，文件名带日期后缀', async () => {
    const wrapper = mountPage()
    await flushPromises()

    // 先执行一次搜索，导出必须带的是「已执行」的筛选值
    await wrapper.find('.dt-filter-form input').setValue('同比')
    await wrapper.findAll('.dt-filter-form button').find((b) => b.text().includes('搜索'))!.trigger('click')
    await flushPromises()
    vi.mocked(dicTemplateApi.page).mockClear()

    await wrapper.findAll('.dt-filter-form button').find((b) => b.text().includes('导出'))!.trigger('click')
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1, pageSize: 10000, name: '同比' })
    const [fileName, xlsxRows, sheetName] = vi.mocked(downloadXlsx).mock.calls[0] ?? []
    expect(fileName).toBe('自动补全配置列表_20261013')
    expect(sheetName).toBe('自动补全配置列表')
    // 表头 = 旧导出列（去掉操作列）；旧页没有 updateTime 时该列留空
    expect(xlsxRows?.[0]).toEqual(['id', '内容', '简称', '创建时间', '修改时间'])
    expect(xlsxRows?.[1]).toEqual([3, '查询某机构某日期的客户指标结果', '机构 日期', '2025-04-15 09:52:07', ''])
  })

  it('导出失败只提示，不影响列表已加载的数据', async () => {
    const wrapper = mountPage()
    await flushPromises()

    vi.mocked(dicTemplateApi.page).mockRejectedValueOnce(new Error('后端拒绝'))
    await wrapper.findAll('.dt-filter-form button').find((b) => b.text().includes('导出'))!.trigger('click')
    await flushPromises()

    expect(downloadXlsx).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('后端拒绝')
    expect(wrapper.findAll('.dt-op-icon').length).toBe(2)
    document.body.innerHTML = ''
  })

  it('操作列只有「编辑」：没有启停开关、没有复制（旧后端无对应端点）', async () => {
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.find('.el-switch').exists()).toBe(false)
    expect(opIconContents(wrapper)).toEqual(['编辑', '编辑'])
  })

  it('「新增」开空弹窗，「编辑」把整行交给弹窗', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.findAll('.dt-operator button').find((b) => b.text().includes('新增'))!.trigger('click')
    expect(dialogOpen).toHaveBeenCalledWith()

    await editIcon(wrapper).trigger('click')
    expect(dialogOpen.mock.calls.at(-1)?.[0]).toMatchObject({ id: 3, content: '查询某机构某日期的客户指标结果' })
  })

  it('弹窗保存成功后回第一页重查', async () => {
    const wrapper = mountPage()
    await flushPromises()

    vi.mocked(dicTemplateApi.page).mockClear()
    wrapper.findComponent({ name: 'DicTemplateEditDialog' }).vm.$emit('saved', { mode: 'add', id: undefined })
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1 })
  })
})
