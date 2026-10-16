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

  it('启停列单独表达启停：停用给「禁用」并带 off 样式，启用给「启用」', async () => {
    const { wrapper } = await mountDialog([src('1', { disabled: true }), src('2')])
    const tags = wrapper.findAll('[data-testid="flow-source-enable-tag"]')
    expect(tags[0].text()).toBe('禁用')
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

  // changeSourceEnableBatch 的第二个参数是**目标 disabled 态**（接口里再翻成 enable 的 0/1 反极性），
  // 所以「停用的源点启用」传 false、「启用的源点点禁用」传 true。
  it('启停：传目标 disabled 态（停用源点「启用」传 false，启用源点「禁用」传 true），并按新态提示', async () => {
    const { wrapper } = await mountDialog([src('1', { disabled: true }), src('2')])
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    // message 留空 → 走组件自己的兜底文案，正好钉住「按新态提示」
    const change = vi.spyOn(sourceApi, 'changeSourceEnableBatch').mockResolvedValue({ ok: true, message: '' })
    const success = vi.spyOn(ElMessage, 'success')

    const toggles = wrapper.findAll('[data-testid="flow-source-toggle-enable"]')
    expect(toggles[0].text()).toBe('启用')
    expect(toggles[1].text()).toBe('禁用')

    await toggles[0].trigger('click')
    await flushPromises()
    expect(change).toHaveBeenLastCalledWith(['1'], false)
    expect(success).toHaveBeenLastCalledWith(expect.stringContaining('启用'))

    await toggles[1].trigger('click')
    await flushPromises()
    expect(change).toHaveBeenLastCalledWith(['2'], true)
    expect(success).toHaveBeenLastCalledWith(expect.stringContaining('禁用'))
  })

  // 源视图锁死在单网站内（0812 纠偏），而一个流程的关联源可能跨网站 → 不聚合，降级成提示
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
