// @vitest-environment jsdom
// 参数设置列表页接线回归（旧 ai-chat-view src/system/config/ConfigIndex.vue）。
// 这一页没走 components/templateConfig 通用层（两条件查询 + 修改前先拉详情），把自己实现的部分钉住：
// ① 挂载即按旧口径拉第一页（configKey/configName 两个筛选进 body，旧恒 undefined 的 configType 不上送）；
// ② 改了条件不自动查，点「搜索」才生效并回第一页；「重置」清草稿与已生效条件并重查；
// ③ 点「修改」先 GET /poc/system/config/{id} 拉详情，成功才开弹窗并把详情回填；详情失败不开弹窗；
// ④ 弹窗保存后回第一页重查（旧 handleRefresh(true)）；
// ⑤ 工具栏没有新增/删除/导出/刷新缓存（旧版这些按钮全部注释掉）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import ElementPlus from 'element-plus'
import ParamConfigPage from './index.vue'
import { systemConfigApi } from '@/api/templateConfig'

vi.mock('@/api/templateConfig', () => ({
  systemConfigApi: {
    page: vi.fn(async () => ({
      total: 2,
      list: [
        { id: 1, configKey: 'poc.answer.maxRows', configName: '问数单次返回最大行数', configValue: '200', configType: 'Y', remark: '' },
        { id: 2, configKey: 'poc.answer.welcomeText', configName: '问数欢迎语', configValue: '你好', configType: 'N', remark: '运营可改' },
      ],
    })),
    detail: vi.fn(async () => ({
      id: 1, configKey: 'poc.answer.maxRows', configName: '问数单次返回最大行数', configValue: '200', configType: 'Y', remark: '',
      createTime: '2025-03-20 10:12:00', updateTime: '2025-06-11 09:30:00',
    })),
    save: vi.fn(async () => ({ ok: true, message: '修改成功' })),
  },
}))

const detailOpen = vi.fn()

function mountPage() {
  return mount(ParamConfigPage, {
    global: {
      plugins: [ElementPlus],
      stubs: {
        // 弹窗自身的提交口径见 ParamConfigEditDialog.test.ts，这里只验列表怎么调它
        ParamConfigEditDialog: {
          name: 'ParamConfigEditDialog',
          emits: ['saved'],
          setup(_p: unknown, { expose }: { expose: (o: Record<string, unknown>) => void }) {
            expose({ open: detailOpen, close: vi.fn() })
            return () => h('div', { class: 'stub-edit-dialog' })
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
  const calls = vi.mocked(systemConfigApi.page).mock.calls
  return (calls.at(-1)?.[0] ?? {}) as Record<string, unknown>
}
function rowsOf(wrapper: ReturnType<typeof mountPage>) {
  return wrapper.findAll('.el-table__body-wrapper tbody tr')
}
function buttonInFilter(wrapper: ReturnType<typeof mountPage>, label: string) {
  return wrapper.findAll('.scp-filter-form button').find((b) => b.text().includes(label))!
}
function editLink(wrapper: ReturnType<typeof mountPage>, rowIndex = 0) {
  return rowsOf(wrapper)[rowIndex]!.findAll('.scp-op-link')[0]!
}
function inputByPlaceholder(wrapper: ReturnType<typeof mountPage>, placeholder: string) {
  return wrapper.find(`input[placeholder="${placeholder}"]`)
}

beforeEach(() => {
  detailOpen.mockReset()
  vi.mocked(systemConfigApi.page).mockClear()
  vi.mocked(systemConfigApi.detail).mockClear()
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('参数设置列表页', () => {
  it('挂载即拉第一页：body 带 configKey/configName 空串，不带 configType', async () => {
    mountPage()
    await flushPromises()
    expect(lastPageQuery()).toEqual({ pageNo: 1, pageSize: 20, configKey: '', configName: '' })
  })

  it('改了条件不自动查，点搜索才生效并回第一页（trim）', async () => {
    const wrapper = mountPage()
    await flushPromises()
    vi.mocked(systemConfigApi.page).mockClear()

    await inputByPlaceholder(wrapper, '请输入参数编码').setValue('  poc.answer ')
    expect(systemConfigApi.page).not.toHaveBeenCalled()

    await buttonInFilter(wrapper, '搜索').trigger('click')
    await flushPromises()
    expect(lastPageQuery()).toEqual({ pageNo: 1, pageSize: 20, configKey: 'poc.answer', configName: '' })
  })

  it('重置：清掉已生效条件并回第一页重查', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await inputByPlaceholder(wrapper, '请输入参数名称').setValue('欢迎语')
    await buttonInFilter(wrapper, '搜索').trigger('click')
    await flushPromises()

    await buttonInFilter(wrapper, '重置').trigger('click')
    await flushPromises()
    expect(lastPageQuery()).toEqual({ pageNo: 1, pageSize: 20, configKey: '', configName: '' })
    expect((inputByPlaceholder(wrapper, '请输入参数名称').element as HTMLInputElement).value).toBe('')
  })

  it('点修改：先按 id 拉详情，成功后才把详情交给弹窗', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await editLink(wrapper, 0).trigger('click')
    await flushPromises()
    expect(vi.mocked(systemConfigApi.detail).mock.calls[0]?.[0]).toBe(1)
    expect(detailOpen).toHaveBeenCalledTimes(1)
    expect(detailOpen.mock.calls[0]?.[0]).toMatchObject({ id: 1, configKey: 'poc.answer.maxRows' })
  })

  it('详情请求失败：不开弹窗、透出后端 msg', async () => {
    vi.mocked(systemConfigApi.detail).mockRejectedValueOnce(new Error('未找到对应的参数配置'))
    const wrapper = mountPage()
    await flushPromises()

    await editLink(wrapper, 0).trigger('click')
    await flushPromises()
    expect(detailOpen).not.toHaveBeenCalled()
  })

  it('弹窗保存后回第一页重查（旧 handleRefresh(true)）', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await editLink(wrapper, 0).trigger('click')
    await flushPromises()

    vi.mocked(systemConfigApi.page).mockClear()
    wrapper.findComponent({ name: 'ParamConfigEditDialog' }).vm.$emit('saved', { id: 1 })
    await flushPromises()
    expect(vi.mocked(systemConfigApi.page)).toHaveBeenCalledTimes(1)
    expect(lastPageQuery().pageNo).toBe(1)
  })

  it('工具栏没有新增/删除/导出/刷新缓存按钮（旧版全部注释掉）', async () => {
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.text()).not.toContain('新增')
    expect(wrapper.text()).not.toContain('删除')
    expect(wrapper.text()).not.toContain('导出')
    expect(wrapper.text()).not.toContain('刷新缓存')
  })
})
