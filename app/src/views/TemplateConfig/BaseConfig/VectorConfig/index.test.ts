// @vitest-environment jsdom
// 向量表管理列表页接线回归（旧 ai-chat-view src/demo/VectorTableList.vue）。
// 这一页没走 components/templateConfig 通用层（两条件查询 + 同步动作 + 按名称删除），把自己实现的部分钉住：
// ① 挂载即拉第一页，pageNo/pageSize=1/20，name 与 sourceTable 都是空串（= 全部）；
// ② 条件改了不自动查，点「查询」才生效并回第一页；「重置」清草稿与已生效条件并重查；
// ③ 同步发的是 **裸 id 数组** [row.id]（旧 sync([record.id])），成功后刷新当前页；
// ④ 删除必须确认后按 **name** 发 remove（旧口径 body {type: 向量表名称}），成功后回第一页（旧 handleRefresh(true)）；
// ⑤ 详情/编辑/新建都交给同一个弹窗的三个入口（openDetail/open/open 无参）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import VectorConfigPage from './index.vue'
import { vectorConfigApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  vectorConfigApi: {
    page: vi.fn(async () => ({
      total: 2,
      list: [
        { id: 2, name: 'KHFA_ZB_VECTOR', comment: '客户指标向量表', sourceTable: 'sense_data.KHFA_KHZBJG_JG', matchDegree: 0.9, dataIndexCode: 'ZB', lastSync: '2026-10-13 18:02:07', updateTime: '2026-10-13 18:02:07' },
        { id: 1, name: 'DIM_JG_VECTOR', comment: null, sourceTable: 'sense_data.DIM_JG', matchDegree: 0.85, dataIndexCode: null, lastSync: null, updateTime: '2026-10-12 09:20:31' },
      ],
    })),
    save: vi.fn(async () => ({ ok: true, message: '保存成功' })),
    mappingInfo: vi.fn(async () => []),
    sync: vi.fn(async () => ({ ok: true, message: '已同步' })),
    remove: vi.fn(async () => ({ ok: true, message: '删除成功' })),
  },
}))

const dialogOpen = vi.fn()
const dialogOpenDetail = vi.fn()

function mountPage() {
  return mount(VectorConfigPage, {
    global: {
      plugins: [ElementPlus],
      stubs: {
        // 弹窗自身的提交口径见 VectorConfigEditDialog.test.ts，这里只验列表怎么调它
        VectorConfigEditDialog: {
          name: 'VectorConfigEditDialog',
          emits: ['saved'],
          setup(_p: unknown, { expose }: { expose: (o: Record<string, unknown>) => void }) {
            expose({ open: dialogOpen, openDetail: dialogOpenDetail, close: vi.fn() })
            return () => h('div', { class: 'stub-dialog' })
          },
        },
        ElPagination: { name: 'ElPagination', props: ['currentPage', 'pageSize', 'total'], template: '<div class="stub-pager" />' },
      },
    },
  })
}

/** 操作列图标顺序：详情 / 编辑 / 同步 / 删除 */
function rowIcon(wrapper: ReturnType<typeof mountPage>, rowIndex: number, iconIndex: number) {
  return wrapper.findAll('.el-table__body-wrapper tbody tr')[rowIndex]!.findAll('.vtc-op-icon')[iconIndex]!
}
const detailIcon = (w: ReturnType<typeof mountPage>, i = 0) => rowIcon(w, i, 0)
const editIcon = (w: ReturnType<typeof mountPage>, i = 0) => rowIcon(w, i, 1)
const syncIcon = (w: ReturnType<typeof mountPage>, i = 0) => rowIcon(w, i, 2)
const deleteIcon = (w: ReturnType<typeof mountPage>, i = 0) => rowIcon(w, i, 3)

function lastPageQuery() {
  const calls = vi.mocked(vectorConfigApi.page).mock.calls
  return (calls.at(-1)?.[0] ?? {}) as Record<string, unknown>
}

function filterButton(wrapper: ReturnType<typeof mountPage>, label: string) {
  return wrapper.findAll('.vtc-filter-form button').find((b) => b.text().includes(label))!
}

beforeEach(() => {
  dialogOpen.mockReset()
  dialogOpenDetail.mockReset()
  vi.mocked(vectorConfigApi.page).mockClear()
  vi.mocked(vectorConfigApi.sync).mockClear()
  vi.mocked(vectorConfigApi.remove).mockClear()
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('VectorConfigPage', () => {
  it('挂载即按旧平台口径拉第一页：pageNo/pageSize=1/20，name 与 sourceTable 都是空串（= 全部）', async () => {
    mountPage()
    await flushPromises()

    expect(vectorConfigApi.page).toHaveBeenCalledTimes(1)
    expect(lastPageQuery()).toMatchObject({ pageNo: 1, pageSize: 20, name: '', sourceTable: '' })
  })

  it('查询条件改了不自动查，点「查询」才带进请求并回到第一页', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.mocked(vectorConfigApi.page).mockClear()

    const inputs = wrapper.findAll('.vtc-filter-form input')
    inputs[0]!.setValue(' DIM_JG ')
    inputs[1]!.setValue('sense_data.KHFA')
    await flushPromises()
    expect(vectorConfigApi.page).toHaveBeenCalledTimes(0)

    // 先翻到第二页，查询要回第一页
    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await flushPromises()
    await filterButton(wrapper, '查询').trigger('click')
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1, pageSize: 20, name: 'DIM_JG', sourceTable: 'sense_data.KHFA' })
  })

  it('重置：清掉已生效条件并回第一页重查', async () => {
    const wrapper = mountPage()
    await flushPromises()

    wrapper.findAll('.vtc-filter-form input')[0]!.setValue('DIM')
    await filterButton(wrapper, '查询').trigger('click')
    await flushPromises()
    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await flushPromises()
    vi.mocked(vectorConfigApi.page).mockClear()

    await filterButton(wrapper, '重置').trigger('click')
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1, name: '', sourceTable: '' })
  })

  it('同步发裸 id 数组 [row.id]，成功后留在当前页刷新（旧版同步后不刷新，lastSync 看不到）', async () => {
    const wrapper = mountPage()
    await flushPromises()
    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await flushPromises()
    vi.mocked(vectorConfigApi.page).mockClear()

    await syncIcon(wrapper).trigger('click')
    await flushPromises()

    expect(vectorConfigApi.sync).toHaveBeenCalledWith([2])
    expect(lastPageQuery()).toMatchObject({ pageNo: 2 })
  })

  it('同步失败：提示错误但不刷新列表', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.mocked(vectorConfigApi.sync).mockRejectedValueOnce(new Error('同步链路未启动'))
    vi.mocked(vectorConfigApi.page).mockClear()

    await syncIcon(wrapper).trigger('click')
    await flushPromises()

    expect(vectorConfigApi.page).not.toHaveBeenCalled()
  })

  it('「删除」确认后按 **name** 发 remove，成功后回第一页重查（旧 handleRefresh(true)）', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await flushPromises()
    vi.mocked(vectorConfigApi.page).mockClear()

    await deleteIcon(wrapper).trigger('click')
    await flushPromises()

    expect(ElMessageBox.confirm).toHaveBeenCalled()
    expect(vectorConfigApi.remove).toHaveBeenCalledWith('KHFA_ZB_VECTOR')
    expect(lastPageQuery()).toMatchObject({ pageNo: 1 })
  })

  it('「删除」取消时不发任何请求', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancelled'))

    await deleteIcon(wrapper).trigger('click')
    await flushPromises()

    expect(vectorConfigApi.remove).not.toHaveBeenCalled()
    expect(vectorConfigApi.page).toHaveBeenCalledTimes(1)
  })

  // 后端 delete 只有把向量库 collection 和 vector_config 元数据都删掉，重查才看不到这一行；
  // 业务失败（code 非 0）必须落到错误提示，不能报「删除成功」却把行留在列表里。
  it('「删除」失败：提示错误、不报「删除成功」、不刷新列表', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const success = vi.spyOn(ElMessage, 'success')
    const error = vi.spyOn(ElMessage, 'error')
    vi.mocked(vectorConfigApi.remove).mockRejectedValueOnce(new Error('向量库删除失败：boom'))
    vi.mocked(vectorConfigApi.page).mockClear()

    await deleteIcon(wrapper).trigger('click')
    await flushPromises()

    expect(error).toHaveBeenCalledWith('向量库删除失败：boom')
    expect(success).not.toHaveBeenCalled()
    expect(vectorConfigApi.page).not.toHaveBeenCalled()
  })

  it('「新建」开空弹窗，「编辑」把整行交给弹窗，「详情」走 openDetail', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.findAll('.vtc-operator button').find((b) => b.text().includes('新建'))!.trigger('click')
    expect(dialogOpen).toHaveBeenCalledWith()

    await editIcon(wrapper).trigger('click')
    expect(dialogOpen.mock.calls.at(-1)?.[0]).toMatchObject({ id: 2, name: 'KHFA_ZB_VECTOR' })

    await detailIcon(wrapper).trigger('click')
    expect(dialogOpenDetail.mock.calls.at(-1)?.[0]).toMatchObject({ id: 2, name: 'KHFA_ZB_VECTOR' })
  })

  it('弹窗保存成功后回第一页重查', async () => {
    const wrapper = mountPage()
    await flushPromises()

    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 3)
    await flushPromises()
    vi.mocked(vectorConfigApi.page).mockClear()
    wrapper.findComponent({ name: 'VectorConfigEditDialog' }).vm.$emit('saved', { mode: 'add' })
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1 })
  })

  it('null 字段渲染成空而不是 "null"（旧版 comment/dataIndexCode 可空）', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const secondRow = wrapper.findAll('.el-table__body-wrapper tbody tr')[1]!
    expect(secondRow.text()).not.toContain('null')
    expect(secondRow.text()).toContain('DIM_JG_VECTOR')
  })
})
