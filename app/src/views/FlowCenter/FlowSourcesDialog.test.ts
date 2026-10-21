// @vitest-environment jsdom
// 流程「使用源数」下钻弹窗（对齐旧平台「流程源列表」）：列口径、状态/启停两列的取值、搜索、解绑与启停请求。
//
// 「状态」列口径（2026-10-16 用户确认）：只读源自己的 `state`，只有 `E` 是「出错」，其余（C/L/空/停用）
// 一律「正常」——旧平台对 state 只判 E，不单列运行中一态；停用由旁边的「启停」列单独表达，不再顶掉 state。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createMemoryHistory, createRouter } from 'vue-router'
import FlowSourcesDialog from './FlowSourcesDialog.vue'
import { flowCenterApi, sourceApi, type Source } from '@/api'

const FLOW = { id: 'flow-1', name: '自然资源部' } as never

function src(id: string, extra: Partial<Source> = {}): Source {
  return { sourceId: id, name: `源-${id}`, url: '', configId: '', mainTable: '', owner: '', state: 'C', ...extra }
}

async function mountDialog(list: Source[]) {
  const paged = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: list.length, list })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
  await router.push('/canvas')
  const wrapper = mount(FlowSourcesDialog, {
    props: { flow: FLOW },
    global: {
      plugins: [router],
      directives: { loading: {} },
      stubs: {
        'el-dialog': { props: ['modelValue', 'title'], template: '<div v-if="modelValue"><slot /></div>' },
        'el-pagination': { props: ['total', 'pageSize'], template: '<div data-testid="fs-pager" />' },
      },
    },
  })
  await flushPromises()
  return { wrapper, paged, router }
}

afterEach(() => vi.restoreAllMocks())

describe('FlowSourcesDialog', () => {
  it('打开即按 flowId 服务端拉源，并把老平台的列渲染出来', async () => {
    const { wrapper, paged } = await mountDialog([
      src('430016824', {
        state: 'E', alarm: true, dataCount: 12580, stepCount: 3,
        lastTaskAt: '2026-10-10 11:19', lastSuccessAt: '2026-10-09 08:00',
      }),
    ])
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ flowId: 'flow-1', page: 1, size: 20 }))
    const row = wrapper.get('[data-testid="flow-source-row"]')
    expect(row.text()).toContain('源-430016824')
    expect(row.text()).toContain('430016824')
    expect(row.get('[data-testid="flow-source-alarm"]').text()).toBe('告警')
    expect(row.text()).toContain('12,580')
    expect(row.text()).toContain('2026-10-10 11:19')
    expect(row.text()).toContain('2026-10-09 08:00')
  })

  // 口径钉死在这里：L（处理中）也归「正常」，停用不并进状态列
  it('状态列只读 state：E → 出错，C/L/空/停用一律正常', async () => {
    const { wrapper } = await mountDialog([
      src('1', { state: 'E' }),
      src('2', { state: 'C' }),
      src('3', { state: 'L' }),
      src('4', { state: '' }),
      src('5', { state: 'C', disabled: true }),
    ])
    const states = wrapper.findAll('[data-testid="flow-source-state"]').map((td) => td.text())
    expect(states).toEqual(['出错', '正常', '正常', '正常', '正常'])
  })

  // 1016 评审（f807f18）：启停只读展示，用词与源管理列表一致（已停用）
  it('启停列单独表达启停：停用给「已停用」并带 off 样式，启用给「启用」', async () => {
    const { wrapper } = await mountDialog([src('1', { disabled: true }), src('2')])
    const tags = wrapper.findAll('[data-testid="flow-source-enable-tag"]')
    expect(tags[0].text()).toBe('已停用')
    expect(tags[0].classes()).toContain('off')
    expect(tags[1].text()).toBe('启用')
    expect(tags[1].classes()).not.toContain('off')
  })

  it('搜索：纯数字按源 ID 查、其余按名称查，都回到第 1 页重查', async () => {
    const { wrapper, paged } = await mountDialog([src('430016824'), src('430016825')])
    paged.mockClear()

    await wrapper.get('[data-testid="flow-sources-keyword"]').setValue('430016824')
    await wrapper.get('[data-testid="flow-sources-search"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, sourceId: '430016824' }))
    expect(paged.mock.calls.at(-1)![0]).not.toHaveProperty('name')

    await wrapper.get('[data-testid="flow-sources-keyword"]').setValue('公众号')
    await wrapper.get('[data-testid="flow-sources-search"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, name: '公众号' }))
    expect(paged.mock.calls.at(-1)![0]).not.toHaveProperty('sourceId')
  })

  it('空态文案区分「搜过没有」和「流程本来就没关联源」', async () => {
    const noMatch = await mountDialog([])
    expect(noMatch.wrapper.get('.fs-empty').text()).toBe('该流程下没有关联的源')

    const searched = await mountDialog([])
    await searched.wrapper.get('[data-testid="flow-sources-keyword"]').setValue('不存在的源')
    await searched.wrapper.get('[data-testid="flow-sources-search"]').trigger('click')
    await flushPromises()
    expect(searched.wrapper.get('.fs-empty').text()).toBe('没有匹配的源')
  })

  it('解绑：确认后只断本流程这条关联，成功后重查并通知上层', async () => {
    const { wrapper, paged } = await mountDialog([src('430016824', { name: '测试金租' })])
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const bind = vi.spyOn(flowCenterApi, 'bindSources').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(ElMessage, 'success')
    const before = paged.mock.calls.length

    await wrapper.get('[data-testid="flow-source-unbind"]').trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalled()
    expect(confirm.mock.calls[0][0]).toContain('测试金租')
    // flowId 不传（=0）+ currentFlowId 传本流程：只断这条关联，源关联的其它流程不受影响
    expect(bind).toHaveBeenCalledWith(['430016824'], undefined, 'flow-1')
    expect(wrapper.emitted('changed')).toHaveLength(1)
    expect(paged.mock.calls.length).toBe(before + 1)
  })

  it('解绑取消：不发请求、不重查', async () => {
    const { wrapper, paged } = await mountDialog([src('430016824')])
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'))
    const bind = vi.spyOn(flowCenterApi, 'bindSources').mockResolvedValue({ ok: true, message: 'ok' })
    const before = paged.mock.calls.length

    await wrapper.get('[data-testid="flow-source-unbind"]').trigger('click')
    await flushPromises()

    expect(bind).not.toHaveBeenCalled()
    expect(paged.mock.calls.length).toBe(before)
  })

  // 1016 评审（f807f18）：这里切的是整个源，在流程弹窗里容易误解成只停本流程，启停统一走源管理列表；
  // 「详情」与点源名重复，也去掉。操作列只剩解绑。
  it('启停只读、不在这里切换；操作列只有解绑', async () => {
    const { wrapper } = await mountDialog([src('1', { disabled: true }), src('2')])
    expect(wrapper.find('[data-testid="flow-source-toggle-enable"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="flow-source-detail"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="flow-source-unbind"]')).toHaveLength(2)
  })

  it('「在源视图中查看全部」：同网站带 flowId 跳转，跨网站只提示不跳', async () => {
    const single = await mountDialog([
      src('1', { siteId: 'site-a', flowId: 'flow-1' }),
      src('2', { siteId: 'site-a' }),
    ])
    const push = vi.spyOn(single.router, 'push')
    await single.wrapper.get('[data-testid="flow-sources-view-all"]').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/canvas', query: { siteId: 'site-a', view: 'source', flowId: 'flow-1' } })

    const cross = await mountDialog([src('1', { siteId: 'site-a' }), src('2', { siteId: 'site-b' })])
    const warn = vi.spyOn(ElMessage, 'warning')
    const crossPush = vi.spyOn(cross.router, 'push')
    await cross.wrapper.get('[data-testid="flow-sources-view-all"]').trigger('click')
    expect(crossPush).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('跨 2 个网站'))
  })
})

// 2026-10-21：「关联到源」的「已关联」页签——解绑 / 更换都在这里（删除流程不再处理源）
describe('FlowSourcesDialog · 批量解绑 / 更换', () => {
  async function mountEmbedded(list: Source[], total = list.length) {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total, list })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
    await router.push('/canvas')
    const wrapper = mount(FlowSourcesDialog, {
      props: { flow: FLOW, embedded: true },
      global: {
        plugins: [router],
        directives: { loading: {} },
        stubs: {
          'el-dialog': { props: ['modelValue', 'title'], template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>' },
          'el-pagination': { template: '<div />' },
          'el-select': { props: ['modelValue'], emits: ['update:modelValue'], template: '<select data-testid="flow-sources-replace-target" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>' },
          'el-option': { props: ['value', 'label'], template: '<option :value="value">{{ label }}</option>' },
          'el-button': { template: '<button v-bind="$attrs"><slot /></button>' },
        },
      },
    })
    await flushPromises()
    return wrapper
  }
  const picks = (w: Awaited<ReturnType<typeof mountEmbedded>>) => w.findAll('[data-testid="flow-source-pick"]')

  it('嵌入模式不渲染自己的弹窗外壳，也不放「关联源」按钮', async () => {
    const w = await mountEmbedded([src('1')])
    expect(w.find('.fs-embedded').exists()).toBe(true)
    expect(w.find('[data-testid="flow-sources-apply"]').exists()).toBe(false)
  })

  it('来源组带来的关联标「来源组」、不可勾选，也没有行内解绑', async () => {
    const w = await mountEmbedded([src('1'), src('2', { sourceGroupId: '3' })])
    const rows = w.findAll('[data-testid="flow-source-row"]')
    expect(rows[1].find('[data-testid="flow-source-group-tag"]').text()).toBe('来源组')
    expect((picks(w)[1].element as HTMLInputElement).disabled).toBe(true)
    expect(rows[1].find('[data-testid="flow-source-unbind"]').exists()).toBe(false)
    await w.get('[data-testid="flow-sources-pick-page"]').setValue(true)
    expect(w.get('[data-testid="flow-sources-batch"]').text()).toContain('已选 1')
  })

  it('勾选后解绑：changeFlowBatch 不带目标流程、带本流程', async () => {
    const w = await mountEmbedded([src('1'), src('2')])
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never)
    const bind = vi.spyOn(flowCenterApi, 'bindSources').mockResolvedValue({ ok: true })
    await picks(w)[0].setValue(true)
    await picks(w)[1].setValue(true)
    await w.get('[data-testid="flow-sources-unbind-selected"]').trigger('click')
    await flushPromises()
    expect(bind).toHaveBeenCalledWith(['1', '2'], undefined, 'flow-1')
    expect(w.emitted('changed')).toBeTruthy()
  })

  it('勾选后更换到其他流程：选目标流程（排除本流程），changeFlowBatch 带目标和本流程', async () => {
    const w = await mountEmbedded([src('1')])
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 2, list: [{ id: 'flow-1', name: '自然资源部' }, { id: 'flow-9', name: '目标流程' }] } as never)
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never)
    const bind = vi.spyOn(flowCenterApi, 'bindSources').mockResolvedValue({ ok: true })
    await picks(w)[0].setValue(true)
    await w.get('[data-testid="flow-sources-replace-selected"]').trigger('click')
    await flushPromises()
    const options = w.get('[data-testid="flow-sources-replace-target"]').findAll('option').map((o) => o.attributes('value'))
    expect(options).toEqual(['flow-9'])
    await w.get('[data-testid="flow-sources-replace-target"]').setValue('flow-9')
    await w.get('[data-testid="flow-sources-replace-ok"]').trigger('click')
    await flushPromises()
    expect(bind).toHaveBeenCalledWith(['1'], 'flow-9', 'flow-1')
  })

  it('全部解绑：分页取完、跳过来源组，按 500 一批；中途失败即停并报已完成数，不回滚', async () => {
    const all = Array.from({ length: 1001 }, (_, i) => src(String(i + 1), i === 0 ? { sourceGroupId: '3' } : {}))
    vi.spyOn(sourceApi, 'sourcePaged').mockImplementation(async (q?: { page?: number; size?: number }) => {
      const size = q?.size ?? 20
      const page = q?.page ?? 1
      return { total: all.length, list: all.slice((page - 1) * size, page * size) }
    })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
    await router.push('/canvas')
    const w = mount(FlowSourcesDialog, { props: { flow: FLOW, embedded: true }, global: { plugins: [router], directives: { loading: {} }, stubs: { 'el-pagination': { template: '<div />' }, 'el-dialog': { template: '<div />' } } } })
    await flushPromises()
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never)
    const bind = vi.spyOn(flowCenterApi, 'bindSources').mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, message: '后端拒绝' })
    await w.get('[data-testid="flow-sources-unbind-all"]').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('解绑 1000 个源'), '解绑关联', expect.anything())
    expect(String(confirm.mock.calls[0][0])).toContain('另有 1 个随来源组关联的源会跳过')
    expect(bind).toHaveBeenCalledTimes(2)
    expect(bind.mock.calls[0][0]).toHaveLength(500)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('前 500 个已完成，不会撤销'))
  })

  it('源都解绑完、列表空了：提示可以删除流程，点按钮发 delete', async () => {
    const w = await mountEmbedded([src('1')])
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never)
    vi.spyOn(flowCenterApi, 'bindSources').mockResolvedValue({ ok: true })
    await picks(w)[0].setValue(true)
    vi.mocked(sourceApi.sourcePaged).mockResolvedValue({ total: 0, list: [] })
    await w.get('[data-testid="flow-sources-unbind-selected"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-testid="flow-sources-emptied"]').text()).toContain('可以删除流程了')
    await w.get('[data-testid="flow-sources-delete-flow"]').trigger('click')
    expect(w.emitted('delete')).toBeTruthy()
  })
})
