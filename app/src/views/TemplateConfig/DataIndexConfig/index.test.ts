// @vitest-environment jsdom
// 数据字典配置列表页接线回归（旧 ai-chat-view src/demo/DataIndexList.vue）。
// 这一页没走 components/templateConfig 通用层（四条件查询 + 编码远程下拉 + 导出），把它自己实现的部分钉住：
// ① 挂载即按旧口径拉第一页（name/code/type/status 四个筛选都在 body）并拉一次编码选项；
// ② 改了条件不自动查，点「搜索」才生效并回第一页；
// ③ 状态列是滑动开关，点一下只发一次 changeStatus(id,status)（本域 status 走 body，见接口契约测试）；
// ④ 导出用「已执行的筛选条件」取前 10000 条，不污染列表分页，状态导出成中文；
// ⑤ 操作列只有「编辑」，弹窗保存后回第一页。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import ElementPlus, { ElSelect } from 'element-plus'
import DataIndexConfigPage from './index.vue'
import { dataIndexConfigApi } from '@/api/templateConfig'
import { downloadXlsx } from '@/utils/format/xlsxExport'

vi.mock('@/api/templateConfig', () => ({
  dataIndexConfigApi: {
    page: vi.fn(async () => ({
      total: 3,
      list: [
        { id: 41, code: 'BRANCH_NAME', type: 'ORG', content: '城南支行', alias: '城南', contentCode: '1001', status: '0', createTime: '2025-04-22 18:56:48', updateTime: '2025-05-09 10:12:33' },
        // 真实响应里别名可能为空、status 可能是数字口径
        { id: 42, code: 'BRANCH_NAME', type: 'ORG', content: '高新区支行', alias: null, contentCode: '1002', status: 0, createTime: '2025-04-22 18:56:48', updateTime: '2025-04-22 18:56:48' },
        { id: 55, code: 'INDICATOR_DATE', type: 'DATE', content: '数据日期', alias: '统计口径日期', contentCode: null, status: '1', createTime: '2025-03-12 19:32:47', updateTime: '2025-06-13 18:23:56' },
      ],
    })),
    save: vi.fn(async () => ({ ok: true, message: '操作成功' })),
    changeStatus: vi.fn(async () => ({ ok: true, message: '操作成功' })),
    allCode: vi.fn(async () => [
      { code: 'BRANCH_NAME', type: 'ORG' },
      { code: 'INDICATOR_DATE', type: 'DATE' },
    ]),
  },
}))

// jsdom 没有 URL.createObjectURL，且下载会真触发 a.click —— 整个 util mock 掉，只验调用参数
vi.mock('@/utils/format/xlsxExport', () => ({
  downloadXlsx: vi.fn(),
  exportDateTag: vi.fn(() => '20261014'),
}))

const dialogOpen = vi.fn()

function mountPage() {
  return mount(DataIndexConfigPage, {
    global: {
      plugins: [ElementPlus],
      stubs: {
        // 弹窗自身的提交口径见 DataIndexConfigEditDialog.test.ts，这里只验列表怎么调它
        DataIndexConfigEditDialog: {
          name: 'DataIndexConfigEditDialog',
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
  const calls = vi.mocked(dataIndexConfigApi.page).mock.calls
  return (calls.at(-1)?.[0] ?? {}) as Record<string, unknown>
}

function rowsOf(wrapper: ReturnType<typeof mountPage>) {
  return wrapper.findAll('.el-table__body-wrapper tbody tr')
}
function cellsOf(wrapper: ReturnType<typeof mountPage>, index: number) {
  return rowsOf(wrapper)[index]!.findAll('td').map((td) => td.text())
}
/** 查询区两个下拉：0 = 编码，1 = 状态 */
function selectOf(wrapper: ReturnType<typeof mountPage>, index: number) {
  return wrapper.findAllComponents(ElSelect)[index]!
}
function buttonInFilter(wrapper: ReturnType<typeof mountPage>, label: string) {
  return wrapper.findAll('.dic-filter-form button, .dic-operator button').find((b) => b.text().includes(label))!
}
/** 状态列的开关（stub 后的按钮，click 即发 change 事件） */
function statusSwitch(wrapper: ReturnType<typeof mountPage>, rowIndex = 0) {
  return wrapper.findAll('.stub-switch')[rowIndex]!
}
function editIcon(wrapper: ReturnType<typeof mountPage>, rowIndex = 0) {
  return rowsOf(wrapper)[rowIndex]!.findAll('.dic-op-icon')[0]!
}

beforeEach(() => {
  dialogOpen.mockReset()
  vi.mocked(dataIndexConfigApi.page).mockClear()
  vi.mocked(dataIndexConfigApi.changeStatus).mockClear()
  vi.mocked(dataIndexConfigApi.allCode).mockClear()
  vi.mocked(downloadXlsx).mockClear()
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('DataIndexConfigPage', () => {
  it('挂载即按旧平台口径拉第一页（四个筛选都带空串），并拉一次编码下拉选项', async () => {
    mountPage()
    await flushPromises()

    expect(dataIndexConfigApi.page).toHaveBeenCalledTimes(1)
    expect(lastPageQuery()).toMatchObject({ pageNo: 1, pageSize: 20, name: '', code: '', type: '', status: '' })
    expect(dataIndexConfigApi.allCode).toHaveBeenCalledTimes(1)
  })

  it('改了查询条件不自动查，点「搜索」才把四个条件带进请求并回到第一页', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.mocked(dataIndexConfigApi.page).mockClear()

    selectOf(wrapper, 0).vm.$emit('update:modelValue', 'BRANCH_NAME')
    selectOf(wrapper, 1).vm.$emit('update:modelValue', '1')
    await wrapper.find('input[placeholder="内容"]').setValue('  支行  ')
    await wrapper.find('input[placeholder="类型"]').setValue(' ORG ')
    await flushPromises()

    // 改完还没点搜索，不应发起新请求
    expect(dataIndexConfigApi.page).toHaveBeenCalledTimes(0)

    await buttonInFilter(wrapper, '搜索').trigger('click')
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1, name: '支行', code: 'BRANCH_NAME', type: 'ORG', status: '1' })
  })

  it('编码下拉的选项文案是「编码 类型」（旧口径），值为编码本身', async () => {
    const wrapper = mountPage()
    await flushPromises()

    selectOf(wrapper, 0).vm.$emit('visible-change', true)
    await flushPromises()

    const labels = [...document.querySelectorAll('.el-select-dropdown__item')].map((el) => el.textContent?.trim())
    expect(labels).toEqual(expect.arrayContaining(['BRANCH_NAME ORG', 'INDICATOR_DATE DATE']))
  })

  it('状态列是滑动开关：置为禁用只发一次 changeStatus(41,"1")，开关就地翻转、不再额外查列表', async () => {
    const wrapper = mountPage()
    await flushPromises()
    // 先翻到第二页，验证启停不会打断当前页（旧 changeStatus 传 handleRefresh(false) 回当前页，
    // 这里是乐观更新，连当前页这一次请求都省掉，同通用列表层与问句改写的口径）
    await wrapper.find('.stub-page-2').trigger('click')
    await flushPromises()
    expect(lastPageQuery()).toMatchObject({ pageNo: 2 })
    vi.mocked(dataIndexConfigApi.page).mockClear()

    await statusSwitch(wrapper, 0).trigger('click')
    await flushPromises()

    expect(dataIndexConfigApi.changeStatus).toHaveBeenCalledTimes(1)
    expect(vi.mocked(dataIndexConfigApi.changeStatus).mock.calls[0]).toEqual([41, '1'])
    expect(statusSwitch(wrapper, 0).text()).toBe('禁用')
    expect(dataIndexConfigApi.page).not.toHaveBeenCalled()
  })

  it('启停失败回滚开关状态，不发额外请求', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.mocked(dataIndexConfigApi.page).mockClear()

    vi.mocked(dataIndexConfigApi.changeStatus).mockRejectedValueOnce(new Error('未找到对应的字典项'))
    await statusSwitch(wrapper, 0).trigger('click')
    await flushPromises()

    // 乐观更新翻成禁用后请求失败，开关文字回到「启用」
    expect(statusSwitch(wrapper, 0).text()).toBe('启用')
    expect(document.body.textContent).toContain('未找到对应的字典项')
    expect(dataIndexConfigApi.page).not.toHaveBeenCalled()
  })

  it('未同步别名的行（alias=null）该列渲染空串，不是 "null"；status 回数字 0 也按启用渲染', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const cells = cellsOf(wrapper, 1)
    expect(cells).not.toContain('null')
    // 列顺序照旧页：id / 编码 / 类型 / 数据内容 / 数据别名 / 数据ID / 状态 / 创建 / 修改 / 操作
    expect(cells[4]).toBe('')
    expect(cells[6]).toBe('启用')
  })

  it('「导出」按已执行的筛选条件拉前 10000 条生成 xlsx，状态列导出成中文，文件名带日期后缀', async () => {
    const wrapper = mountPage()
    await flushPromises()

    // 先执行一次搜索，导出必须带的是「已执行」的筛选值
    await wrapper.find('input[placeholder="内容"]').setValue('支行')
    await buttonInFilter(wrapper, '搜索').trigger('click')
    await flushPromises()
    vi.mocked(dataIndexConfigApi.page).mockClear()

    await buttonInFilter(wrapper, '导出').trigger('click')
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1, pageSize: 10000, name: '支行' })
    const [fileName, xlsxRows, sheetName] = vi.mocked(downloadXlsx).mock.calls[0] ?? []
    expect(fileName).toBe('数据字典列表_20261014')
    expect(sheetName).toBe('数据字典列表')
    // 表头 = 旧导出列（去掉操作列）；id 保持数值单元格，与旧 xlsx-style 一致
    expect(xlsxRows?.[0]).toEqual(['id', '编码', '类型', '数据内容', '数据别名', '数据ID', '状态', '创建时间', '修改时间'])
    expect(xlsxRows?.[1]).toEqual([41, 'BRANCH_NAME', 'ORG', '城南支行', '城南', '1001', '启用', '2025-04-22 18:56:48', '2025-05-09 10:12:33'])
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
    vi.mocked(dataIndexConfigApi.page).mockRejectedValueOnce(new Error('会话已过期'))

    await buttonInFilter(wrapper, '导出').trigger('click')
    await flushPromises()

    expect(downloadXlsx).not.toHaveBeenCalled()
    expect(rowsOf(wrapper)).toHaveLength(3)
  })

  it('「新增」开空弹窗，「编辑」把整行交给弹窗', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await buttonInFilter(wrapper, '新增').trigger('click')
    expect(dialogOpen).toHaveBeenCalledWith()

    await editIcon(wrapper, 0).trigger('click')
    expect(dialogOpen.mock.calls.at(-1)?.[0]).toMatchObject({ id: 41, code: 'BRANCH_NAME', type: 'ORG', content: '城南支行', alias: '城南' })
  })

  it('弹窗保存成功后回第一页重查', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('.stub-page-2').trigger('click')
    await flushPromises()
    vi.mocked(dataIndexConfigApi.page).mockClear()

    wrapper.findComponent({ name: 'DataIndexConfigEditDialog' }).vm.$emit('saved', { mode: 'edit', id: 41 })
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1 })
  })

  it('编码选项拉取失败不影响列表，只提示后端 msg（旧页面同样只弹一个提示）', async () => {
    vi.mocked(dataIndexConfigApi.allCode).mockRejectedValueOnce(new Error('网关不可用'))

    const wrapper = mountPage()
    await flushPromises()

    expect(rowsOf(wrapper)).toHaveLength(3)
    expect(document.body.textContent).toContain('网关不可用')
  })
})
