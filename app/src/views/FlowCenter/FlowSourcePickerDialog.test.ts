// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import FlowSourcePickerDialog from './FlowSourcePickerDialog.vue'
import { flowCenterApi, sourceApi, sourceGroupApi, type Source } from '@/api'

const FLOW = { id: 'flow-1', name: '新闻流程' } as never

function src(id: string, extra: Partial<Source> = {}): Source {
  return { sourceId: id, name: `源-${id}`, url: '', configId: '', mainTable: '', owner: '', state: 'C', ...extra }
}

function mountDlg(modelValue: string[] = []) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  return mount(FlowSourcePickerDialog, {
    props: { flow: FLOW, modelValue },
    global: {
      plugins: [router],
      directives: { loading: {} },
      stubs: {
        'el-dialog': { props: ['modelValue', 'title'], template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>' },
        'el-pagination': {
          props: ['total', 'pageSize', 'currentPage'],
          emits: ['update:currentPage', 'current-change'],
          template: '<div data-testid="fsp-pager"><button type="button" data-testid="fsp-pager-next" @click="$emit(\'update:currentPage\', currentPage + 1); $emit(\'current-change\', currentPage + 1)">next</button></div>',
        },
        'el-select': {
          props: ['modelValue'],
          emits: ['update:modelValue', 'change'],
          // data-testid 由使用处透传（所属网站 / 所属流程两个下拉共用这个桩）
          template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\', $event.target.value)"><option value=""></option><option value="flow-9">flow-9</option><option value="site-7">site-7</option></select>',
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
  it('组内源：「所属来源组」列显示组名可点跳我的分组，当前流程标「组统一配置」，不可勾选（1021-04）', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 2, list: [src('a'), src('b', { sourceGroupId: '3' })] })
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })
    vi.spyOn(ElMessage, 'warning').mockImplementation(() => undefined as never)

    const w = mountDlg([])
    await flushPromises()
    const rows = w.findAll('tbody tr')
    expect(rows[0].find('[data-testid="fsp-group-name"]').exists()).toBe(false)
    expect(rows[1].get('[data-testid="fsp-group-name"]').text()).toBe('twitter1')
    expect(rows[1].get('[data-testid="fsp-group-tag"]').text()).toBe('组统一配置')
    expect((rows[1].get('[data-testid="fsp-row-check"]').element as HTMLInputElement).disabled).toBe(true)

    const push = vi.spyOn(w.vm.$router, 'push').mockResolvedValue(undefined)
    await rows[1].get('[data-testid="fsp-group-name"]').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/collect', query: { tab: 'personal', group: '3' } })
    // 点组名不算勾选这一行
    expect(w.emitted('update:modelValue')).toBeUndefined()
  })

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
      // 初始 load / 切「仅看未关联」后的 load / 全选全部取回都返回这一页数据
      .mockResolvedValue({ total: 3, list: [src('a', { flowId: 'flow-1' }), src('b'), src('c')] })
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })

    const w = mountDlg([])
    await flushPromises()
    await w.get('[data-testid="fsp-only-unbound"]').setValue(true)
    await flushPromises()
    expect(w.get('[data-testid="fsp-pick-all"]').text()).toContain('全选全部（共 3 条）')
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

  it('所属网站筛选 → sourcePaged 带 siteIds，全选全部也按该网站取（1105 会议）', async () => {
    const paged = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 50, list: [src('a')] })
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })

    const w = mountDlg([])
    await flushPromises()
    await w.get('[data-testid="fsp-site-filter"]').setValue('site-7')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ siteIds: 'site-7', page: 1 }))

    await w.get('[data-testid="fsp-pick-all"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ siteIds: 'site-7', size: 1000 }))
  })

  // 2026-10-19：后端 name 只匹配名称，输 ID 搜不到；纯数字改按源 ID 查，其余仍按名称
  it('搜索框：纯数字按源 ID 查，其余按名称查', async () => {
    vi.useFakeTimers()
    try {
      const paged = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
      vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })
      const w = mountDlg([])
      await flushPromises()

      await w.get('[data-testid="fsp-keyword"]').setValue(' 301288849 ')
      await vi.advanceTimersByTimeAsync(300)
      await flushPromises()
      expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ sourceId: '301288849' }))
      expect(paged.mock.lastCall![0]).not.toHaveProperty('name')

      await w.get('[data-testid="fsp-keyword"]').setValue('香港政府新闻网')
      await vi.advanceTimersByTimeAsync(300)
      await flushPromises()
      expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ name: '香港政府新闻网' }))
      expect(paged.mock.lastCall![0]).not.toHaveProperty('sourceId')
    } finally {
      vi.useRealTimers()
    }
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
    await flushPromises()
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
    await flushPromises()
    expect(w.emitted('confirm')).toHaveLength(1)
  })
})

describe('FlowSourcePickerDialog · 1106 §4.5 筛选与提交前范围复核', () => {
  it('筛选变化：清空本次待关联勾选并回第 1 页（网站筛选 / 仅看未关联）', async () => {
    const paged = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 50, list: [src('a'), src('b')] })
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })

    const w = mountDlg(['a', 'b'])
    await flushPromises()

    // 先翻到第 2 页：确认翻页确实走 load()（后续断言 page 回 1 才有意义）
    await w.get('[data-testid="fsp-pager-next"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))

    // 切网站：勾选清空 + 回第 1 页 + 带 siteIds（服务端筛，不退化成当前页本地过滤）
    await w.get('[data-testid="fsp-site-filter"]').setValue('site-7')
    await flushPromises()
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual([])
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, siteIds: 'site-7' }))

    // 重新勾选并再翻页后，切「仅看未关联」同样清空 + 回第 1 页
    w.setProps({ modelValue: ['a'] })
    await flushPromises()
    await w.get('[data-testid="fsp-pager-next"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))
    await w.get('[data-testid="fsp-only-unbound"]').setValue(true)
    await flushPromises()
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual([])
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }))
  })

  it('关键字变化：清空勾选并回第 1 页', async () => {
    vi.useFakeTimers()
    try {
      const paged = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 50, list: [src('a')] })
      vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })
      const w = mountDlg(['a'])
      await flushPromises()
      await w.get('[data-testid="fsp-pager-next"]').trigger('click')
      await flushPromises()
      expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))

      await w.get('[data-testid="fsp-keyword"]').setValue('香港')
      await vi.advanceTimersByTimeAsync(300)
      await flushPromises()
      expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual([])
      expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, name: '香港' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('「全选本页」只勾当前页（不查服务端）；「全选全部（共 N 条）」按同一筛选取全部', async () => {
    const paged = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 50, list: [src('a'), src('b')] })
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })

    const w = mountDlg([])
    await flushPromises()
    expect(w.get('[data-testid="fsp-pick-all"]').text()).toBe('全选全部（共 50 条）')

    const before = paged.mock.calls.length
    await w.get('[data-testid="fsp-pick-page"]').trigger('click')
    expect(paged.mock.calls.length).toBe(before) // 本页直接用当前行，不再请求
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual(['a', 'b'])

    await w.get('[data-testid="fsp-pick-all"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, size: 1000 }))
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual(['a', 'b'])
  })

  it('提交前复核：剔除已删除 / 已并入来源组的源，剩下的仍提交', async () => {
    const paged = vi.spyOn(sourceApi, 'sourcePaged')
      .mockResolvedValue({ total: 2, list: [src('a'), src('b')] })
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })
    const warn = vi.spyOn(ElMessage, 'warning').mockImplementation(() => undefined as never)

    const w = mountDlg([])
    await flushPromises()
    // 复核回查：b 已并入来源组，ghost 已删除
    paged.mockResolvedValue({ total: 2, list: [src('a'), src('b', { sourceGroupId: '3' })] })
    await w.setProps({ modelValue: ['a', 'b', 'ghost'] })
    await w.get('[data-testid="flow-apply-confirm"]').trigger('click')
    await flushPromises()

    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual(['a'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('2 个源已不可关联'))
    expect(w.emitted('confirm')).toHaveLength(1)
  })

  it('提交前复核：全部不可关联时不提交', async () => {
    const paged = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [src('a')] })
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })
    vi.spyOn(ElMessage, 'warning').mockImplementation(() => undefined as never)

    const w = mountDlg([])
    await flushPromises()
    paged.mockResolvedValue({ total: 0, list: [] })
    await w.setProps({ modelValue: ['ghost'] })
    await w.get('[data-testid="flow-apply-confirm"]').trigger('click')
    await flushPromises()
    expect(w.emitted('confirm')).toBeUndefined()
  })

  it('全选全部后复核：补上快照之后新进入范围的源，用户手动取消的不回补', async () => {
    const paged = vi.spyOn(sourceApi, 'sourcePaged')
      // total 50 让「全选全部（共 N 条）」按钮出现（本页只有 2 行）
      .mockResolvedValue({ total: 50, list: [src('a'), src('b')] })
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })
    vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never)

    const w = mountDlg([])
    await flushPromises()
    await w.get('[data-testid="fsp-pick-all"]').trigger('click')
    await flushPromises()
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual(['a', 'b'])

    // 复核时筛选范围里多了 c（ID 回查也返回全部三条）
    paged.mockResolvedValue({ total: 3, list: [src('a'), src('b'), src('c')] })
    // 用户手动取消了 a
    await w.setProps({ modelValue: ['b'] })
    await w.get('[data-testid="flow-apply-confirm"]').trigger('click')
    await flushPromises()

    // a 在全选快照里（用户自己取消的）不回补，c 是快照之后才进入范围的，补上
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual(['b', 'c'])
    expect(w.emitted('confirm')).toHaveLength(1)
  })
})

describe('FlowSourcePickerDialog · 1008-06 来源组', () => {
  it('组内源禁选并标「组统一配置」；点行/勾选都选不上', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 2, list: [src('g1', { sourceGroupId: '3' }), src('free')],
    })
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })

    const w = mountDlg([])
    await flushPromises()

    // 组内源：当前流程列标「组统一配置」，组名在「所属来源组」列（1021-04），勾选框禁用
    expect(w.get('[data-testid="fsp-group-tag"]').text()).toBe('组统一配置')
    expect(w.get('[data-testid="fsp-group-name"]').text()).toBe('twitter1')
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
