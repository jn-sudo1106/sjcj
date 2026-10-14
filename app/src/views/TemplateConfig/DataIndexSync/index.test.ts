// @vitest-environment jsdom
// 数据索引同步列表页接线回归（旧 ai-chat-view src/demo/DataIndexSyncList.vue）。
// 这一页没走 components/templateConfig 通用层（同步动作 + 码值列 + 无启停），把它自己实现的部分钉住：
// ① 两个筛选条件都进 body、且只有点「搜索」才生效；② 同步类型按数字码值渲染中文，状态是只读文字（没有开关）；
// ③ 点「同步」发的是 **id 数组** sync([row.id])，成功后留在当前页重查；
// ④ 同一行同步请求期间连点不再发第二个请求（旧版会重复下发）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import ElementPlus, { ElSelect } from 'element-plus'
import DataIndexSyncPage from './index.vue'
import { dataIndexSyncApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  dataIndexSyncApi: {
    page: vi.fn(async () => ({
      total: 3,
      list: [
        {
          id: 56,
          type: 0,
          tableName: 'ADS_HFBI_ZQFXS_JGZBMX',
          columnName: 'BRANCH_NAME',
          comment: '机构指标数据表-机构名称',
          syncSql: 'select distinct BRANCH_NAME,BRANCH_NO as CODE from ADS_HFBI_ZQFXS_JGZBMX',
          status: 0,
          lastSync: '2025-06-13 18:23:56',
          createTime: '2025-04-22 18:56:48',
          updateTime: '2025-04-22 18:56:48',
        },
        // 真实响应里未同步过的行 lastSync 是 null（消息同步那种配置就没有这个时间）
        { id: 24, type: 1, tableName: 'dev_chat_table_config', columnName: 'data_index', comment: '数据索引同步', syncSql: '{"type":"indexMsg","params":""}', status: 0, lastSync: null, createTime: '2025-01-20 19:45:54', updateTime: '2025-02-10 17:43:41' },
        { id: 47, type: 2, tableName: 'YJZB_HY_JX', columnName: null, comment: '分词同步配置', syncSql: 'select distinct HYMC as CONTENT from YJZB_HY_JX', status: '1', lastSync: '2025-03-12 21:32:17', createTime: '2025-03-12 19:32:47', updateTime: '2025-03-12 19:32:47' },
      ],
    })),
    save: vi.fn(async () => ({ ok: true, message: '操作成功' })),
    sync: vi.fn(async () => ({ ok: true, message: '同步成功' })),
  },
}))

const dialogOpen = vi.fn()

function mountPage() {
  return mount(DataIndexSyncPage, {
    global: {
      plugins: [ElementPlus],
      stubs: {
        // 弹窗自身的提交口径见 DataIndexSyncEditDialog.test.ts，这里只验列表怎么调它
        DataIndexSyncEditDialog: {
          name: 'DataIndexSyncEditDialog',
          emits: ['saved'],
          setup(_p: unknown, { expose }: { expose: (o: Record<string, unknown>) => void }) {
            expose({ open: dialogOpen, close: vi.fn() })
            return () => h('div', { class: 'stub-dialog' })
          },
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
  const calls = vi.mocked(dataIndexSyncApi.page).mock.calls
  return (calls.at(-1)?.[0] ?? {}) as Record<string, unknown>
}

function rowsOf(wrapper: ReturnType<typeof mountPage>) {
  return wrapper.findAll('.el-table__body-wrapper tbody tr')
}
function cellsOf(wrapper: ReturnType<typeof mountPage>, index: number) {
  return rowsOf(wrapper)[index]!.findAll('td').map((td) => td.text())
}
/** 查询区唯一那个下拉（状态） */
function statusSelect(wrapper: ReturnType<typeof mountPage>) {
  return wrapper.findAllComponents(ElSelect)[0]!
}
function buttonInFilter(wrapper: ReturnType<typeof mountPage>, label: string) {
  return wrapper.findAll('.dis-filter-form button').find((b) => b.text().includes(label))!
}
function syncLink(wrapper: ReturnType<typeof mountPage>, rowIndex = 0) {
  return rowsOf(wrapper)[rowIndex]!.findAll('.dis-op-link')[1]!
}

beforeEach(() => {
  dialogOpen.mockReset()
  vi.mocked(dataIndexSyncApi.page).mockClear()
  vi.mocked(dataIndexSyncApi.sync).mockClear()
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('DataIndexSyncPage', () => {
  it('挂载即按旧平台口径拉第一页，两个筛选条件都带空串（= 全部）', async () => {
    mountPage()
    await flushPromises()

    expect(dataIndexSyncApi.page).toHaveBeenCalledTimes(1)
    expect(lastPageQuery()).toMatchObject({ pageNo: 1, pageSize: 20, name: '', status: '' })
  })

  it('改了查询条件不自动查，点「搜索」才把两个条件带进请求并回到第一页', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.mocked(dataIndexSyncApi.page).mockClear()

    statusSelect(wrapper).vm.$emit('update:modelValue', '1')
    await wrapper.find('input[placeholder="名称"]').setValue('  机构  ')
    await flushPromises()

    // 改完还没点搜索，不应发起新请求
    expect(dataIndexSyncApi.page).toHaveBeenCalledTimes(0)

    await buttonInFilter(wrapper, '搜索').trigger('click')
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1, name: '机构', status: '1' })
  })

  it('同步类型列把数字码值渲染成中文，状态列是只读文字（本域没有启停端点，不给开关）', async () => {
    const wrapper = mountPage()
    await flushPromises()

    expect(cellsOf(wrapper, 0)).toContain('sql同步')
    expect(cellsOf(wrapper, 1)).toContain('消息同步')
    expect(cellsOf(wrapper, 2)).toContain('分词同步')
    // 第 0 行 type=0 / status=0（真实响应的数字口径），第 2 行 status='1'
    expect(cellsOf(wrapper, 0)).toContain('启用')
    expect(cellsOf(wrapper, 2)).toContain('禁用')
    expect(wrapper.find('.el-switch').exists()).toBe(false)
  })

  it('未同步过的行（lastSync=null）该列渲染空串，不是 "null"', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const cells = cellsOf(wrapper, 1)
    expect(cells).not.toContain('null')
    expect(cells[6]).toBe('')
  })

  it('点「同步」发 sync([row.id])（id 数组），成功后留在当前页重查', async () => {
    const wrapper = mountPage()
    await flushPromises()
    // 先翻到第二页，验证同步后不回第一页（旧 syncData 传 handleRefresh(false)）
    await wrapper.find('.stub-page-2').trigger('click')
    await flushPromises()
    expect(lastPageQuery()).toMatchObject({ pageNo: 2 })
    vi.mocked(dataIndexSyncApi.page).mockClear()

    await syncLink(wrapper, 0).trigger('click')
    await flushPromises()

    expect(dataIndexSyncApi.sync).toHaveBeenCalledTimes(1)
    expect(vi.mocked(dataIndexSyncApi.sync).mock.calls[0]?.[0]).toEqual([56])
    expect(dataIndexSyncApi.page).toHaveBeenCalledTimes(1)
    expect(lastPageQuery()).toMatchObject({ pageNo: 2 })
  })

  it('同一行同步请求期间连点只发一次；失败后解除置灰，可以再点', async () => {
    const wrapper = mountPage()
    await flushPromises()

    let release: (value: { ok: boolean }) => void = () => {}
    vi.mocked(dataIndexSyncApi.sync).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      }) as never,
    )

    await syncLink(wrapper, 0).trigger('click')
    await flushPromises()
    expect(rowsOf(wrapper)[0]!.text()).toContain('同步中')
    await syncLink(wrapper, 0).trigger('click')
    expect(dataIndexSyncApi.sync).toHaveBeenCalledTimes(1)

    release({ ok: true })
    await flushPromises()
    expect(dataIndexSyncApi.sync).toHaveBeenCalledTimes(1)

    // 上一次成功已解除置灰；再点一次走失败分支，失败同样要解除
    vi.mocked(dataIndexSyncApi.sync).mockRejectedValueOnce(new Error('同步配置不存在'))
    await syncLink(wrapper, 0).trigger('click')
    await flushPromises()
    expect(dataIndexSyncApi.sync).toHaveBeenCalledTimes(2)
    expect(rowsOf(wrapper)[0]!.findAll('.dis-op-link')[1]!.classes()).not.toContain('dis-op-link--pending')
  })

  it('「新增」开空弹窗，「编辑」把整行交给弹窗', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await buttonInFilter(wrapper, '新增').trigger('click')
    expect(dialogOpen).toHaveBeenCalledWith()

    await rowsOf(wrapper)[0]!.findAll('.dis-op-link')[0]!.trigger('click')
    expect(dialogOpen.mock.calls.at(-1)?.[0]).toMatchObject({ id: 56, comment: '机构指标数据表-机构名称', type: 0 })
  })

  it('弹窗保存成功后回第一页重查', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('.stub-page-2').trigger('click')
    await flushPromises()
    vi.mocked(dataIndexSyncApi.page).mockClear()

    wrapper.findComponent({ name: 'DataIndexSyncEditDialog' }).vm.$emit('saved', { mode: 'add', id: undefined })
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1 })
  })
})
