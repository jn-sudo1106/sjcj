// @vitest-environment jsdom
// 模板配置通用列表页接线回归（1013 迁入 SQL 模板配置时抽出）。
// 这一层后面要被 7 个模板模块复用，所以钉的是「每个操作调到了哪条接口、带了什么参数」——
// 复用的是壳，接口与列由调用方注入，壳一旦接错就会 8 个模块一起错。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { h } from 'vue'
import ElementPlus, { ElMessageBox } from 'element-plus'
import TemplateListPage from './TemplateListPage.vue'
import type { TemplateColumn, TemplateField } from './types'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

const columns: TemplateColumn[] = [
  { prop: 'id', label: 'id', width: 60 },
  { prop: 'name', label: '模板名称', width: 140 },
  { prop: 'status', label: '状态', width: 96, type: 'status' },
]
const fields: TemplateField[] = [{ prop: 'name', label: 'sql模板名称', required: true }]

const rows = [
  { id: 36, name: '不校验', status: '1', createTime: '2025-04-11 11:34:39' },
  { id: 9, name: '根据日期查询指标信息', status: '0', createTime: '2025-01-02 11:02:43' },
]
/** 种子快照：个别用例会把 rows 改短（测「删掉当前页最后一条」），每条用例前还原 */
const seedRows = rows.map((row) => ({ ...row }))

const dialogOpen = vi.fn()

/** 测试里 stub 接口都是无参实现，vi.fn 据此把入参元组推成 []，读真实参数要显式转一次
 *  （与 router/auth.test.ts 同款写法）。 */
type CallArgs = Record<string, unknown>
function pageQuery(api: ReturnType<typeof makeApi>, index: 0 | -1 = 0): CallArgs {
  const call = index === 0 ? api.page.mock.calls[0] : api.page.mock.calls.at(-1)
  return (call as [CallArgs] | undefined)?.[0] ?? {}
}

function makeApi() {
  return {
    page: vi.fn(async () => ({ total: rows.length, list: rows.map((r) => ({ ...r })) })),
    save: vi.fn(async () => ({ ok: true, message: '提交成功' })),
    changeStatus: vi.fn(async () => ({ ok: true, message: '请求成功' })),
    copy: vi.fn(async () => ({ ok: true, message: '请求成功' })),
  }
}

/** 声明了删除能力的模块（后端有 /delete）才有 remove；通用层据此决定画不画删除按钮 */
function makeApiWithRemove() {
  return { ...makeApi(), remove: vi.fn(async (_id: number) => ({ ok: true, message: '删除成功' })) }
}

/** 行内操作图标：el-tooltip 的 content 就是原按钮文案（与指标/监控模块同一套定位方式） */
function iconByTooltip(wrapper: VueWrapper, content: string) {
  const tip = wrapper
    .findAllComponents({ name: 'ElTooltip' })
    .find((t: VueWrapper) => (t.props() as { content?: string }).content === content)
  if (!tip) throw new Error(`找不到操作：${content}`)
  return tip.find('.tc-op-icon')
}

/** 某个行内操作画没画（删除只在 api.remove 存在时出现） */
function hasAction(wrapper: VueWrapper, content: string): boolean {
  return wrapper
    .findAllComponents({ name: 'ElTooltip' })
    .some((t: VueWrapper) => (t.props() as { content?: string }).content === content)
}

function mountPage(api = makeApi()) {
  const wrapper = mount(TemplateListPage, {
    props: {
      columns,
      fields,
      api,
      addTitle: '新增sql模板',
      editTitle: '编辑sql模板',
      defaults: { status: '0' },
    },
    global: {
      plugins: [ElementPlus],
      stubs: {
        TemplateFormDialog: {
          name: 'TemplateFormDialog',
          props: ['fields', 'api', 'addTitle', 'editTitle', 'defaults'],
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
        ElPagination: {
          name: 'ElPagination',
          props: ['currentPage', 'pageSize', 'total'],
          emits: ['current-change'],
          // 给「翻到第 2 页」留一个可点击的按钮，用来测删掉尾页最后一条时的页码回退
          template: '<div class="stub-pager"><button class="stub-page-2" @click="$emit(\'current-change\', 2)" /></div>',
        },
      },
    },
  })
  return { wrapper, api }
}

describe('TemplateListPage', () => {
  beforeEach(() => {
    dialogOpen.mockReset()
    vi.resetModules()
    rows.length = 0
    rows.push(...seedRows.map((row) => ({ ...row })))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('挂载即按旧平台分页口径 pageNo/pageSize 拉第一页', async () => {
    const { api } = mountPage()
    await flushPromises()

    expect(api.page).toHaveBeenCalledTimes(1)
    expect(pageQuery(api)).toMatchObject({ pageNo: 1, pageSize: 20 })
  })

  it('点「搜索」把名称去空格后带进 body，并回到第一页', async () => {
    const { wrapper, api } = mountPage()
    await flushPromises()
    api.page.mockClear()

    await wrapper.find('.tc-filter-form input').setValue('  多表  ')
    await wrapper.findAll('.tc-filter-form button').find((b) => b.text().includes('搜索'))!.trigger('click')
    await flushPromises()

    expect(api.page).toHaveBeenCalledTimes(1)
    expect(pageQuery(api)).toMatchObject({ pageNo: 1, name: '多表' })
  })

  it('状态列开关点下去发 changeStatus(id, 目标 status)，乐观更新失败回滚', async () => {
    const { wrapper, api } = mountPage()
    await flushPromises()
    api.changeStatus.mockRejectedValueOnce(new Error('后端拒绝'))

    const firstSwitch = wrapper.findAll('.stub-switch')[0]!
    await firstSwitch.trigger('click')
    await flushPromises()

    expect(api.changeStatus).toHaveBeenCalledWith(36, '0')
    // 失败后行数据回到原值：再点一次仍然请求同一个目标值 '0'
    api.changeStatus.mockClear()
    await wrapper.findAll('.stub-switch')[0]!.trigger('click')
    await flushPromises()
    expect(api.changeStatus).toHaveBeenCalledWith(36, '0')
  })

  it('「复制」按 id 调 copy，成功后回第一页重查', async () => {
    const { wrapper, api } = mountPage()
    await flushPromises()
    api.page.mockClear()

    const copyIcon = iconByTooltip(wrapper, '复制')
    await copyIcon.trigger('click')
    await flushPromises()

    expect(api.copy).toHaveBeenCalledWith(36)
    expect(pageQuery(api, -1)).toMatchObject({ pageNo: 1 })
  })

  it('「新增」用 defaults 打开弹窗（空记录），「编辑」带上整行', async () => {
    const { wrapper } = mountPage()
    await flushPromises()

    await wrapper.findAll('.tc-operator button').find((b) => b.text().includes('新增'))!.trigger('click')
    expect(dialogOpen).toHaveBeenCalledWith(null)

    const editIcon = iconByTooltip(wrapper, '编辑')
    await editIcon.trigger('click')
    expect(dialogOpen.mock.calls.at(-1)?.[0]).toMatchObject({ id: 36, name: '不校验' })
  })

  it('弹窗 saved 之后回到第一页重查', async () => {
    const { wrapper, api } = mountPage()
    await flushPromises()
    api.page.mockClear()

    wrapper.findComponent({ name: 'TemplateFormDialog' }).vm.$emit('saved', { mode: 'add' })
    await flushPromises()

    expect(pageQuery(api)).toMatchObject({ pageNo: 1 })
  })

  it('只有声明了 remove 的模块才画「删除」（后端没有 /delete 就不给入口）', async () => {
    const plain = mountPage()
    await flushPromises()
    expect(hasAction(plain.wrapper, '删除')).toBe(false)

    const withRemove = mountPage(makeApiWithRemove())
    await flushPromises()
    expect(hasAction(withRemove.wrapper, '删除')).toBe(true)
  })

  it('「删除」先弹确认，确认后按 id 调 remove、删完留在当前页重查', async () => {
    const api = makeApiWithRemove()
    const { wrapper } = mountPage(api)
    await flushPromises()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    api.page.mockClear()
    api.remove.mockClear()

    await iconByTooltip(wrapper, '删除').trigger('click')
    await flushPromises()

    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
    // 只发 id：与选表规则 / 实体改写 / sql 模板后端的 POST {module}/delete?id= 同形态
    expect(api.remove).toHaveBeenCalledWith(36)
    expect(api.page).toHaveBeenCalledTimes(1)
    expect(pageQuery(api, -1)).toMatchObject({ pageNo: 1 })
  })

  it('确认框取消时不删也不重查', async () => {
    const api = makeApiWithRemove()
    const { wrapper } = mountPage(api)
    await flushPromises()
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'))
    api.page.mockClear()

    await iconByTooltip(wrapper, '删除').trigger('click')
    await flushPromises()

    expect(api.remove).not.toHaveBeenCalled()
    expect(api.page).not.toHaveBeenCalled()
  })

  it('删除请求失败时不重查（列表没变，不能让行凭空消失）', async () => {
    const api = makeApiWithRemove()
    api.remove.mockRejectedValueOnce(new Error('模板不存在'))
    const { wrapper } = mountPage(api)
    await flushPromises()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    api.page.mockClear()

    await iconByTooltip(wrapper, '删除').trigger('click')
    await flushPromises()

    expect(api.remove).toHaveBeenCalledTimes(1)
    expect(api.page).not.toHaveBeenCalled()
  })

  it('删掉当前页最后一条时页码退回上一页（旧 s-table 行为）', async () => {
    const api = makeApiWithRemove()
    const { wrapper } = mountPage(api)
    await flushPromises()

    // 第 2 页只剩一条：先改数据再翻页，组件里的当前页才是这一条
    rows.length = 1
    await wrapper.find('.stub-page-2').trigger('click')
    await flushPromises()
    expect(pageQuery(api, -1)).toMatchObject({ pageNo: 2 })

    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    await iconByTooltip(wrapper, '删除').trigger('click')
    await flushPromises()

    expect(pageQuery(api, -1)).toMatchObject({ pageNo: 1 })
  })
})
