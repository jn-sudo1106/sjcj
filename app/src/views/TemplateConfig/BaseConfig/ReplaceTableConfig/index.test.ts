// @vitest-environment jsdom
// 表改写管理列表页接线回归（旧 ai-chat-view src/demo/ReplaceTableConfigList.vue）。
// 这一页没走 components/templateConfig 通用层（查询区两个条件），把自己实现的部分钉住：
// ① 挂载即拉第一页，pageNo/pageSize=1/20，name 与 status 都是空串（= 全部）；
// ② 条件改了不自动查，点「搜索」才生效并回第一页；「重置」清草稿与已生效条件并重查；
// ③ 列表列按旧口径原样渲染（类型列直接显示码值 unionall，不做中英文映射），null 渲染成空；
// ④ 启停走 changeStatus(id, 目标 status)、失败回滚，成功后只发那一次请求（乐观更新，不重查分页）；
// ⑤ 本域**没有删除端点**，操作列只有「编辑」，不给它长出删除入口。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import ElementPlus, { ElSelect } from 'element-plus'
import ReplaceTableConfigPage from './index.vue'
import { replaceTableConfigApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  replaceTableConfigApi: {
    page: vi.fn(async () => ({
      total: 2,
      list: [
        { id: 13, tableName: 'YJZB_HY_JX', replaceType: 'unionall', replaceTableName: 'YJZB_HY_GHKJ', status: '1', createTime: '2025-04-18 17:56:05', updateTime: '2025-04-27 12:33:06', delFlag: '0' },
        { id: 12, tableName: 'YJZB_HY_GHKJ', replaceType: 'unionall', replaceTableName: 'YJZB_HY_JX', status: '0', createTime: '2025-04-18 17:45:08', updateTime: '2025-04-27 12:33:06', delFlag: '0' },
      ],
    })),
    save: vi.fn(async () => ({ ok: true, message: '操作成功' })),
    changeStatus: vi.fn(async () => ({ ok: true, message: '请求成功' })),
  },
}))

const dialogOpen = vi.fn()

function mountPage() {
  return mount(ReplaceTableConfigPage, {
    global: {
      plugins: [ElementPlus],
      stubs: {
        // 弹窗自身的提交口径见 ReplaceTableConfigEditDialog.test.ts，这里只验列表怎么调它
        ReplaceTableConfigEditDialog: {
          name: 'ReplaceTableConfigEditDialog',
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
  return wrapper.findAll('.el-table__body-wrapper tbody tr')[rowIndex]!.findAll('.rtc-op-icon')[0]!
}
/** 行内图标的文案（已图标化，文案在 el-tooltip 的 content 上） */
function opIconContents(wrapper: ReturnType<typeof mountPage>) {
  return wrapper
    .findAllComponents({ name: 'ElTooltip' })
    .filter((t) => t.find('.rtc-op-icon').exists())
    .map((t) => (t.props() as { content?: string }).content)
}

function lastPageQuery() {
  const calls = vi.mocked(replaceTableConfigApi.page).mock.calls
  return (calls.at(-1)?.[0] ?? {}) as Record<string, unknown>
}

/** 查询区唯一那个下拉（状态） */
function statusSelect(wrapper: ReturnType<typeof mountPage>) {
  return wrapper.findAllComponents(ElSelect)[0]!
}

beforeEach(() => {
  dialogOpen.mockReset()
  vi.mocked(replaceTableConfigApi.page).mockClear()
  vi.mocked(replaceTableConfigApi.changeStatus!).mockClear()
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('ReplaceTableConfigPage', () => {
  it('挂载即按旧平台口径拉第一页：pageNo/pageSize=1/20，name 与 status 都是空串（= 全部）', async () => {
    mountPage()
    await flushPromises()

    expect(replaceTableConfigApi.page).toHaveBeenCalledTimes(1)
    expect(lastPageQuery()).toMatchObject({ pageNo: 1, pageSize: 20, name: '', status: '' })
  })

  it('查询条件改了不自动查，点「搜索」才带进请求并回到第一页', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.mocked(replaceTableConfigApi.page).mockClear()

    statusSelect(wrapper).vm.$emit('update:modelValue', '1')
    wrapper.find('.rtc-filter-form input').setValue('YJZB_HY_JX')
    await flushPromises()

    expect(replaceTableConfigApi.page).toHaveBeenCalledTimes(0)

    // 先翻到第二页，搜索要回第一页
    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await flushPromises()
    await wrapper.findAll('.rtc-filter-form button').find((b) => b.text().includes('搜索'))!.trigger('click')
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1, pageSize: 20, name: 'YJZB_HY_JX', status: '1' })
  })

  it('重置：清掉已生效条件并回第一页重查', async () => {
    const wrapper = mountPage()
    await flushPromises()

    statusSelect(wrapper).vm.$emit('update:modelValue', '1')
    await wrapper.findAll('.rtc-filter-form button').find((b) => b.text().includes('搜索'))!.trigger('click')
    await flushPromises()
    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await flushPromises()
    vi.mocked(replaceTableConfigApi.page).mockClear()

    await wrapper.findAll('.rtc-filter-form button').find((b) => b.text().includes('重置'))!.trigger('click')
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1, name: '', status: '' })
  })

  it('类型列原样渲染码值（旧列表就没有码值映射），表名称/替换表两列分开显示', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const firstRow = wrapper.findAll('.el-table__body-wrapper tbody tr')[0]!
    expect(firstRow.text()).toContain('YJZB_HY_JX')
    expect(firstRow.text()).toContain('YJZB_HY_GHKJ')
    expect(firstRow.text()).toContain('unionall')
  })

  it('状态列是滑动开关，点下去发 changeStatus(id, 目标 status)，失败回滚后重试仍是同一个目标值', async () => {
    const wrapper = mountPage()
    await flushPromises()

    vi.mocked(replaceTableConfigApi.changeStatus!).mockRejectedValueOnce(new Error('后端拒绝'))
    await wrapper.findAll('.stub-switch')[0]!.trigger('click')
    await flushPromises()
    // 第一行 status '1'（禁用）→ 开成启用
    expect(replaceTableConfigApi.changeStatus).toHaveBeenCalledWith(13, '0')

    // 失败已回滚成 '1'，再点一次请求的还是 '0'（不会把乐观值当成现状）
    await wrapper.findAll('.stub-switch')[0]!.trigger('click')
    await flushPromises()
    expect(replaceTableConfigApi.changeStatus).toHaveBeenLastCalledWith(13, '0')
  })

  it('启停成功后只发一次 /status，不额外重查分页（乐观更新，口径同选表规则配置）', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.mocked(replaceTableConfigApi.page).mockClear()

    await wrapper.findAll('.stub-switch')[0]!.trigger('click')
    await flushPromises()

    expect(replaceTableConfigApi.changeStatus).toHaveBeenCalledTimes(1)
    expect(replaceTableConfigApi.page).not.toHaveBeenCalled()
  })

  it('操作列只有「编辑」，本域没有删除端点所以不出现删除入口', async () => {
    const wrapper = mountPage()
    await flushPromises()

    expect(opIconContents(wrapper)).toEqual(['编辑', '编辑'])
    expect(wrapper.findAll('.el-table__body-wrapper tbody tr')[0]!.findAll('.rtc-op-icon').length).toBe(1)
  })

  it('「新增」开空弹窗，「编辑」把整行交给弹窗', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.findAll('.rtc-operator button').find((b) => b.text().includes('新增'))!.trigger('click')
    expect(dialogOpen).toHaveBeenCalledWith()

    await editIcon(wrapper).trigger('click')
    expect(dialogOpen.mock.calls.at(-1)?.[0]).toMatchObject({ id: 13, tableName: 'YJZB_HY_JX', replaceType: 'unionall', replaceTableName: 'YJZB_HY_GHKJ' })
  })

  it('弹窗保存成功后回第一页重查', async () => {
    const wrapper = mountPage()
    await flushPromises()

    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 3)
    await flushPromises()
    vi.mocked(replaceTableConfigApi.page).mockClear()
    wrapper.findComponent({ name: 'ReplaceTableConfigEditDialog' }).vm.$emit('saved', { mode: 'add', id: undefined })
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1 })
  })

  it('缺失字段渲染成空而不是 "null"/"undefined"', async () => {
    vi.mocked(replaceTableConfigApi.page).mockResolvedValueOnce({
      total: 1,
      list: [{ id: 9, tableName: 'KHFA_ZB', status: '0' }],
    })
    const wrapper = mountPage()
    await flushPromises()

    const firstRow = wrapper.findAll('.el-table__body-wrapper tbody tr')[0]!
    expect(firstRow.text()).not.toContain('null')
    expect(firstRow.text()).not.toContain('undefined')
  })
})
