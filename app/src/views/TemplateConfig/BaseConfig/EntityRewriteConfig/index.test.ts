// @vitest-environment jsdom
// 实体改写管理列表页接线回归（旧 ai-chat-view src/demo/EntityRewriteConfigList.vue）。
// 这一页没走 components/templateConfig 通用层（两条件查询 + 替换类型码值列 + 删除），把自己实现的部分钉住：
// ① 挂载即拉第一页，pageNo/pageSize=1/20，entityName 与 status 都是空串（= 全部）
//    —— 查询参数字段名是 entityName，不像选表规则 / 表改写那样改名成 name（旧 List.vue:11 就是这个名）；
// ② 条件改了不自动查，点「搜索」才生效并回第一页；「重置」清草稿与已生效条件并重查；
// ③ 替换类型按码值渲染中文，未知码值留空（旧列表是直接吐 cleanType 原始码）；
// ④ 启停走 changeStatus(id, 目标 status)、失败回滚；⑤ 删除必须确认后才发 remove(id)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import ElementPlus, { ElMessageBox, ElSelect } from 'element-plus'
import EntityRewriteConfigPage from './index.vue'
import { entityRewriteConfigApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  entityRewriteConfigApi: {
    page: vi.fn(async () => ({
      total: 2,
      list: [
        { id: 3, entityName: '管户口径', cleanType: 'simple_replacement', content: '管户口径', targetContent: '个人管户口径', status: '1', createTime: '2025-04-22 10:12:08', updateTime: '2025-06-13 17:58:31' },
        { id: 2, entityName: '行员', cleanType: 'regular_replacement', content: '(行员|员工)', targetContent: '行员', status: '0', createTime: '2025-04-22 10:10:44', updateTime: '2025-04-22 10:10:44' },
      ],
    })),
    save: vi.fn(async () => ({ ok: true, message: '操作成功' })),
    changeStatus: vi.fn(async () => ({ ok: true, message: '请求成功' })),
    remove: vi.fn(async () => ({ ok: true, message: '删除成功' })),
  },
}))

const dialogOpen = vi.fn()

function mountPage() {
  return mount(EntityRewriteConfigPage, {
    global: {
      plugins: [ElementPlus],
      stubs: {
        // 弹窗自身的提交口径见 EntityRewriteConfigEditDialog.test.ts，这里只验列表怎么调它
        EntityRewriteConfigEditDialog: {
          name: 'EntityRewriteConfigEditDialog',
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
  const calls = vi.mocked(entityRewriteConfigApi.page).mock.calls
  return (calls.at(-1)?.[0] ?? {}) as Record<string, unknown>
}

/** 查询区唯一那个下拉（状态） */
function statusSelect(wrapper: ReturnType<typeof mountPage>) {
  return wrapper.findAllComponents(ElSelect)[0]!
}

beforeEach(() => {
  dialogOpen.mockReset()
  vi.mocked(entityRewriteConfigApi.page).mockClear()
  vi.mocked(entityRewriteConfigApi.changeStatus!).mockClear()
  vi.mocked(entityRewriteConfigApi.remove).mockClear()
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('EntityRewriteConfigPage', () => {
  it('挂载即按旧平台口径拉第一页：pageNo/pageSize=1/20，entityName 与 status 都是空串（= 全部）', async () => {
    mountPage()
    await flushPromises()

    expect(entityRewriteConfigApi.page).toHaveBeenCalledTimes(1)
    expect(lastPageQuery()).toMatchObject({ pageNo: 1, pageSize: 20, entityName: '', status: '' })
  })

  it('查询条件改了不自动查，点「搜索」才带进请求并回到第一页', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.mocked(entityRewriteConfigApi.page).mockClear()

    statusSelect(wrapper).vm.$emit('update:modelValue', '1')
    wrapper.find('.erc-filter-form input').setValue('行员')
    await flushPromises()

    expect(entityRewriteConfigApi.page).toHaveBeenCalledTimes(0)

    // 先翻到第二页，搜索要回第一页
    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await flushPromises()
    await wrapper.findAll('.erc-filter-form button').find((b) => b.text().includes('搜索'))!.trigger('click')
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1, pageSize: 20, entityName: '行员', status: '1' })
  })

  it('重置：清掉已生效条件并回第一页重查', async () => {
    const wrapper = mountPage()
    await flushPromises()

    statusSelect(wrapper).vm.$emit('update:modelValue', '1')
    await wrapper.findAll('.erc-filter-form button').find((b) => b.text().includes('搜索'))!.trigger('click')
    await flushPromises()
    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await flushPromises()
    vi.mocked(entityRewriteConfigApi.page).mockClear()

    await wrapper.findAll('.erc-filter-form button').find((b) => b.text().includes('重置'))!.trigger('click')
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1, entityName: '', status: '' })
  })

  it('替换类型按码值渲染中文；未知码值留空（旧列表直接吐 cleanType 原始码）', async () => {
    vi.mocked(entityRewriteConfigApi.page).mockResolvedValueOnce({
      total: 1,
      list: [{ id: 9, entityName: '存款', cleanType: 'unknown_type', content: '', targetContent: '', status: '0' }],
    })
    const wrapper = mountPage()
    await flushPromises()

    const firstRow = wrapper.findAll('.el-table__body-wrapper tbody tr')[0]!
    expect(firstRow.text()).not.toContain('正则替换')
    expect(firstRow.text()).not.toContain('unknown_type')

    vi.mocked(entityRewriteConfigApi.page).mockResolvedValueOnce({
      total: 1,
      list: [{ id: 8, entityName: '存款', cleanType: 'regular_replacement', content: '(存款|储蓄)', targetContent: '存款', status: '0' }],
    })
    const known = mountPage()
    await flushPromises()
    expect(known.findAll('.el-table__body-wrapper tbody tr')[0]!.text()).toContain('正则替换')
  })

  it('状态列是滑动开关，点下去发 changeStatus(id, 目标 status)，失败回滚后重试仍是同一个目标值', async () => {
    const wrapper = mountPage()
    await flushPromises()

    vi.mocked(entityRewriteConfigApi.changeStatus!).mockRejectedValueOnce(new Error('后端拒绝'))
    await wrapper.findAll('.stub-switch')[0]!.trigger('click')
    await flushPromises()
    // 第一行 status '1'（禁用）→ 开成启用
    expect(entityRewriteConfigApi.changeStatus).toHaveBeenCalledWith(3, '0')

    // 失败已回滚成 '1'，再点一次请求的还是 '0'（不会把乐观值当成现状）
    await wrapper.findAll('.stub-switch')[0]!.trigger('click')
    await flushPromises()
    expect(entityRewriteConfigApi.changeStatus).toHaveBeenLastCalledWith(3, '0')
  })

  it('真实行 status 回数字时开关按 String(row.status) 判，不误判成启用', async () => {
    vi.mocked(entityRewriteConfigApi.page).mockResolvedValueOnce({
      total: 1,
      list: [{ id: 5, entityName: '行员', cleanType: 'simple_replacement', content: '员工', targetContent: '行员', status: 1 as unknown as string }],
    })
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.findAll('.stub-switch')[0]!.trigger('click')
    await flushPromises()
    expect(entityRewriteConfigApi.changeStatus).toHaveBeenCalledWith(5, '0')
  })

  it('「删除」确认后发 remove(id)，成功后留在当前页重查', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await flushPromises()
    vi.mocked(entityRewriteConfigApi.page).mockClear()

    await wrapper.findAll('.erc-op-link--danger')[0]!.trigger('click')
    await flushPromises()

    expect(ElMessageBox.confirm).toHaveBeenCalled()
    expect(entityRewriteConfigApi.remove).toHaveBeenCalledWith(3)
    // 删除后留在当前页重查（旧 handleDelete 传 refresh(false)，不回第一页）
    expect(lastPageQuery()).toMatchObject({ pageNo: 2 })
  })

  it('「删除」取消时不发任何请求', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancelled'))

    await wrapper.findAll('.erc-op-link--danger')[0]!.trigger('click')
    await flushPromises()

    expect(entityRewriteConfigApi.remove).not.toHaveBeenCalled()
    expect(entityRewriteConfigApi.page).toHaveBeenCalledTimes(1)
  })

  it('「新增」开空弹窗，「编辑」把整行交给弹窗', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.findAll('.erc-operator button').find((b) => b.text().includes('新增'))!.trigger('click')
    expect(dialogOpen).toHaveBeenCalledWith()

    await wrapper.findAll('.erc-op-link').find((l) => l.text() === '编辑')!.trigger('click')
    expect(dialogOpen.mock.calls.at(-1)?.[0]).toMatchObject({ id: 3, entityName: '管户口径', cleanType: 'simple_replacement' })
  })

  it('弹窗保存成功后回第一页重查', async () => {
    const wrapper = mountPage()
    await flushPromises()

    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 3)
    await flushPromises()
    vi.mocked(entityRewriteConfigApi.page).mockClear()
    wrapper.findComponent({ name: 'EntityRewriteConfigEditDialog' }).vm.$emit('saved', { mode: 'add', id: undefined })
    await flushPromises()

    expect(lastPageQuery()).toMatchObject({ pageNo: 1 })
  })

  it('替换内容等长字段直接进列，null 渲染成空而不是 "null"', async () => {
    vi.mocked(entityRewriteConfigApi.page).mockResolvedValueOnce({
      total: 1,
      list: [{ id: 7, entityName: '绩效口径', cleanType: 'simple_replacement', content: null as unknown as string, targetContent: null as unknown as string, status: '0' }],
    })
    const wrapper = mountPage()
    await flushPromises()

    const firstRow = wrapper.findAll('.el-table__body-wrapper tbody tr')[0]!
    expect(firstRow.text()).not.toContain('null')
    expect(firstRow.text()).not.toContain('undefined')
  })
})
