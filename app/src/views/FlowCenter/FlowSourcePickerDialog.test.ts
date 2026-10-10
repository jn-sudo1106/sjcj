// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import FlowSourcePickerDialog from './FlowSourcePickerDialog.vue'
import { flowCenterApi, sourceApi, sourceGroupApi, type Source } from '@/api'

const FLOW = { id: 'flow-1', name: '新闻流程' } as never

function src(id: string, extra: Partial<Source> = {}): Source {
  return { sourceId: id, name: `源-${id}`, url: '', configId: '', mainTable: '', owner: '', state: 'C', ...extra }
}

function mountDlg(modelValue: string[] = []) {
  return mount(FlowSourcePickerDialog, {
    props: { flow: FLOW, modelValue },
    global: {
      directives: { loading: {} },
      stubs: {
        'el-dialog': { props: ['modelValue', 'title'], template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>' },
        'el-pagination': { props: ['total', 'pageSize'], template: '<div data-testid="fsp-pager" :total="total" />' },
        'el-select': {
          props: ['modelValue'],
          emits: ['update:modelValue', 'change'],
          template: '<select data-testid="fsp-flow-filter" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\', $event.target.value)"><option value=""></option><option value="flow-9">flow-9</option></select>',
        },
      },
    },
  })
}

beforeEach(() => {
  // 1008-06：组件挂载会拉来源组名映射
  vi.spyOn(sourceGroupApi, 'list').mockResolvedValue([
    { sourceGroupId: '3', sourceGroupCode: 'twitter1', sourceGroupName: 'twitter1', state: 'ACTIVE', flowIds: [], revision: 1 },
  ] as never)
})
afterEach(() => vi.restoreAllMocks())

describe('FlowSourcePickerDialog', () => {
  it('打开即按 sourcePaged 拉源，勾行 → update:modelValue，全选本页把整页加进来', async () => {
    const paged = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 2, list: [src('a'), src('b')],
    })
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })

    const w = mountDlg([])
    await flushPromises()
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ page: 1, size: 20 }))

    await w.findAll('tbody tr')[0].trigger('click')
    expect(w.emitted('update:modelValue')![0][0]).toEqual(['a'])

    await w.get('[data-testid="fsp-pick-page"]').trigger('click')
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual(['a', 'b'])
  })

  it('全选全部：拉当前筛选下的所有源选中，尊重「仅看未关联到本流程」', async () => {
    const paged = vi.spyOn(sourceApi, 'sourcePaged')
      .mockResolvedValueOnce({ total: 50, list: [src('a'), src('b')] }) // 初始 load（还有更多页 → 全选全部按钮出现）
      .mockResolvedValueOnce({ total: 3, list: [src('a', { flowId: 'flow-1' }), src('b'), src('c')] }) // 全选全部一次取回
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })

    const w = mountDlg([])
    await flushPromises()
    await w.get('[data-testid="fsp-only-unbound"]').setValue(true)
    await w.get('[data-testid="fsp-pick-all"]').trigger('click')
    await flushPromises()

    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, size: 1000 }))
    // a 已绑本流程（flow-1）被「仅看未关联」排除
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual(['b', 'c'])
  })

  it('选中超过 15 个：标签墙收起成汇总行，可展开', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })
    const many = Array.from({ length: 20 }, (_, i) => `s${i}`)

    const w = mountDlg(many)
    await flushPromises()
    expect(w.get('[data-testid="fsp-selected-count"]').text()).toContain('20')
    expect(w.find('[data-testid="fsp-chips"]').exists()).toBe(false) // 默认收起
    await w.findAll('.fsp-linkbtn').find((b) => b.text() === '展开')!.trigger('click')
    expect(w.find('[data-testid="fsp-chips"]').exists()).toBe(true)
    expect(w.get('[data-testid="fsp-chips"]').text()).toContain('…等 5 个') // 20 - 15
  })

  it('所属流程筛选 → sourcePaged 带 flowId', async () => {
    const paged = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })

    const w = mountDlg([])
    await flushPromises()
    await w.get('[data-testid="fsp-flow-filter"]').setValue('flow-9')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ flowId: 'flow-9' }))
  })

  it('「当前流程」列：本流程标 self、别的流程标 other、无流程标 none', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 3, list: [src('a', { flowId: 'flow-1' }), src('b', { flowId: 'flow-2' }), src('c')],
    })
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })

    const w = mountDlg([])
    await flushPromises()
    const tags = w.findAll('.fsp-flowtag')
    expect(tags[0].classes()).toContain('self')
    expect(tags[1].classes()).toContain('other')
    expect(tags[2].classes()).toContain('none')
  })

  it('「仅看未关联到本流程」把已绑本流程的行滤掉', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 2, list: [src('a', { flowId: 'flow-1' }), src('b', { flowId: 'flow-2' })],
    })
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })

    const w = mountDlg([])
    await flushPromises()
    expect(w.findAll('tbody tr')).toHaveLength(2)
    await w.get('[data-testid="fsp-only-unbound"]').setValue(true)
    expect(w.findAll('tbody tr').map((r) => r.text())).toHaveLength(1)
    expect(w.text()).toContain('源-b')
    expect(w.text()).not.toContain('源-a')
  })

  it('ID 批量检索：查到的源加入选择，未找到的提示', async () => {
    const paged = vi.spyOn(sourceApi, 'sourcePaged')
      .mockResolvedValueOnce({ total: 0, list: [] }) // 初始 load
      .mockResolvedValueOnce({ total: 1, list: [src('x')] }) // 批量检索
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })

    const w = mountDlg([])
    await flushPromises()
    await w.get('.fsp-filters button').trigger('click') // 展开
    await w.get('.fsp-idbox').setValue('x, ghost')
    await w.get('.fsp-idimport button').trigger('click')
    await flushPromises()

    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ sourceIds: ['x', 'ghost'] }))
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual(['x'])
  })

  it('没选源时确认按钮禁用；有选中 emit confirm', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [src('a')] })
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })

    const w = mountDlg([])
    await flushPromises()
    expect(w.get<HTMLButtonElement>('[data-testid="flow-apply-confirm"]').element.disabled).toBe(true)

    await w.setProps({ modelValue: ['a'] })
    const btn = w.get('[data-testid="flow-apply-confirm"]')
    expect(btn.attributes('disabled')).toBeUndefined()
    await btn.trigger('click')
    expect(w.emitted('confirm')).toHaveLength(1)
  })
})

describe('FlowSourcePickerDialog · 1008-06 来源组', () => {
  it('组内源禁选并标「组统一配置：组名」；点行/勾选都选不上', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 2, list: [src('g1', { sourceGroupId: '3' }), src('free')],
    })
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })

    const w = mountDlg([])
    await flushPromises()

    // 组内源行标「组统一配置：twitter1」，勾选框禁用
    expect(w.text()).toContain('组统一配置：twitter1')
    const checks = w.findAll('[data-testid="fsp-row-check"]')
    expect((checks[0].element as HTMLInputElement).disabled).toBe(true)
    expect((checks[1].element as HTMLInputElement).disabled).toBe(false)

    // 点组内源行选不上（emit 不变）；点自由源选上
    await w.findAll('tbody tr')[0].trigger('click')
    expect(w.emitted('update:modelValue')).toBeUndefined()
    await w.findAll('tbody tr')[1].trigger('click')
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual(['free'])
  })

  it('全选本页跳过组内源；全选全部也跳过并在提示里说明', async () => {
    const paged = vi.spyOn(sourceApi, 'sourcePaged')
      .mockResolvedValueOnce({ total: 1, list: [src('g1', { sourceGroupId: '3' }), src('free')] })
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })

    const w = mountDlg([])
    await flushPromises()
    await w.get('[data-testid="fsp-pick-page"]').trigger('click')
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual(['free'])
    void paged
  })
})
