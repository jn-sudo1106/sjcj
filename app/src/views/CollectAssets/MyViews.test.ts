// @vitest-environment jsdom
// 源管理「我的视图」（2026-10-12）：视图列表、切换、未保存提示、保存 / 另存为 / 撤销、显示设置、设为默认、删除。
// 右侧源列表 stub 掉：记录收到的 viewState，并能模拟用户改条件（emit stateChange）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import MyViews from './MyViews.vue'
import { sourceApi, sourceGroupApi } from '@/api'
import type { UserInfo } from '@/api/auth'
import { sourceViewApi } from '@/api/sourceViews'
import { useAuthStore } from '@/stores/auth'
import { useSourceGroupsStore } from '@/stores/sourceGroups'
import { blankSourceListViewState, emptyManualViewState, type SourceListViewState } from '@/views/FlowCanvas/result/sourceListViewState'

const received: SourceListViewState[] = []
/** 源列表最近一次收到的 scopeSourceIds（undefined = 条件视图） */
const scopeSeen: (string[] | undefined)[] = []
let emitState: (s: SourceListViewState) => void = () => {}
vi.mock('@/views/FlowCanvas/result/SourceOverviewView.vue', () => ({
  default: defineComponent({
    name: 'SourceOverviewView',
    props: { viewState: Object, currentSiteId: String, groupOps: Boolean, scopeSourceIds: Array, scopeEmptyText: String },
    emits: ['stateChange', 'openSource', 'openSourceData', 'openSite', 'openSourceGroup'],
    setup(props, { emit, slots }) {
      received.push(props.viewState as SourceListViewState)
      emitState = (s) => emit('stateChange', s)
      scopeSeen.length = 0
      return () => {
        scopeSeen[0] = props.scopeSourceIds as string[] | undefined
        // selection-actions 槽位用固定的两个选中 ID 驱动「移出视图」
        return h('div', { 'data-testid': 'sov-stub' }, [JSON.stringify((props.viewState as SourceListViewState)?.hiddenColumns ?? []), slots['selection-actions']?.({ ids: ['10', '20'] })])
      }
    },
    watch: { viewState(v: SourceListViewState) { received.push(v) } },
  }),
}))

const st = (patch: Partial<SourceListViewState> = {}): SourceListViewState => ({ ...blankSourceListViewState(), ...patch })
let wrapper: VueWrapper

beforeEach(() => {
  localStorage.clear()
  received.length = 0
  setActivePinia(createPinia())
  useAuthStore().info = { id: 7 } as UserInfo
  vi.spyOn(sourceApi, 'sourcePaged').mockImplementation(async (q) => ({ total: q?.state === 'E' ? 3 : 100, list: [] }))
  vi.spyOn(sourceGroupApi, 'list').mockResolvedValue([])
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

async function mountPage(query: Record<string, string> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/collect', component: { template: '<div />' } }, { path: '/canvas', component: { template: '<div />' } }] })
  await router.push({ path: '/collect', query: { tab: 'views', ...query } })
  await router.isReady()
  wrapper = mount(MyViews, { global: { plugins: [ElementPlus, router] }, attachTo: document.body })
  await flushPromises()
  return { router }
}
const settle = async () => { await flushPromises(); await new Promise((r) => setTimeout(r, 30)) }
const dom = (sel: string) => document.querySelector(sel) as HTMLElement

describe('我的视图', () => {
  it('没有视图时提示新建；新建后是空的手选清单并选中', async () => {
    await mountPage()
    expect(wrapper.text()).toContain('还没有视图')
    await wrapper.get('[data-testid="mv-new"]').trigger('click')
    await settle()
    const input = dom('input[data-testid="save-view-name"], [data-testid="save-view-name"] input') as HTMLInputElement
    input.value = '广发 · 失败待处理'
    input.dispatchEvent(new Event('input'))
    dom('[data-testid="save-view-submit"]').click()
    await settle()
    expect(wrapper.get('[data-testid="mv-name"]').text()).toBe('广发 · 失败待处理')
    expect((await sourceViewApi.list('7'))[0].state).toEqual(emptyManualViewState())
    expect(scopeSeen[0]).toEqual([])
    expect(wrapper.find('[data-testid="mv-add-sources"]').exists()).toBe(true)
  })

  // 2026-10-12 用户定 C：视图可手选源，条件栏在清单内再筛
  it('手选视图：添加源后标为未保存，保存才写进视图；已在视图里的自动去重', async () => {
    const v = await sourceViewApi.add('7', { viewName: '广发重点', state: { ...emptyManualViewState(), scopeIds: ['10'] } })
    await mountPage()
    expect(scopeSeen[0]).toEqual(['10'])
    ;(wrapper.vm as unknown as { addSources: (ids: string[]) => void }).addSources(['10', '30'])
    await flushPromises()
    expect(scopeSeen[0]).toEqual(['10', '30'])
    expect(wrapper.find('[data-testid="mv-dirty"]').exists()).toBe(true)
    expect((await sourceViewApi.list('7'))[0].state.scopeIds).toEqual(['10'])
    await wrapper.get('[data-testid="mv-save"]').trigger('click')
    await settle()
    const saved = (await sourceViewApi.list('7')).find((x) => x.viewId === v.viewId)!
    expect(saved.state.scopeIds).toEqual(['10', '30'])
    expect(wrapper.find('[data-testid="mv-dirty"]').exists()).toBe(false)
  })

  it('手选视图：选中源后「移出视图」确认后才移出；撤销回到已保存的清单', async () => {
    await sourceViewApi.add('7', { viewName: '广发重点', state: { ...emptyManualViewState(), scopeIds: ['10', '20', '30'] } })
    await mountPage()
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValueOnce('confirm' as never)
    await wrapper.get('[data-testid="mv-remove-sources"]').trigger('click')
    await settle()
    expect(confirm).toHaveBeenCalled()
    expect(scopeSeen[0]).toEqual(['30'])
    expect(wrapper.find('[data-testid="mv-dirty"]').exists()).toBe(true)
    await wrapper.get('[data-testid="mv-revert"]').trigger('click')
    await flushPromises()
    expect(scopeSeen[0]).toEqual(['10', '20', '30'])
  })

  it('条件视图（系统目录另存为）：没有「添加源」「移出视图」；源数按条件查', async () => {
    await sourceViewApi.add('7', { viewName: '异常源', state: st({ status: 'E' }) })
    await mountPage()
    expect(scopeSeen[0]).toBeUndefined()
    expect(wrapper.find('[data-testid="mv-add-sources"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mv-remove-sources"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="mv-item"]').map((i) => i.text())).toEqual(['异常源3'])
  })

  it('手选视图的源数限定在清单内：空清单不发请求显示 0，有清单带 sourceIds', async () => {
    await sourceViewApi.add('7', { viewName: '空的', state: emptyManualViewState() })
    await sourceViewApi.add('7', { viewName: '三个', state: { ...emptyManualViewState(), scopeIds: ['1', '2', '3'] } })
    const paged = vi.mocked(sourceApi.sourcePaged)
    await mountPage()
    expect(wrapper.findAll('[data-testid="mv-item"]').map((i) => i.text())).toEqual(['空的0', '三个100'])
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ sourceIds: '1,2,3', size: 1 }))
    expect(paged.mock.calls.filter(([q]) => q?.size === 1)).toHaveLength(1)
  })

  it('左侧列出视图和源数（按视图条件查 sourcePaged 的 total），默认进入的视图优先选中', async () => {
    await sourceViewApi.add('7', { viewName: 'A', state: st() })
    await sourceViewApi.add('7', { viewName: '失败', state: st({ status: 'E' }), isDefault: true })
    await mountPage()
    const items = wrapper.findAll('[data-testid="mv-item"]').map((i) => i.text())
    expect(items).toEqual(['A100', '失败★3'])
    expect(wrapper.get('[data-testid="mv-name"]').text()).toBe('失败')
    expect(received.at(-1)).toMatchObject({ status: 'E' })
  })

  it('改了条件出现「有未保存的修改」；保存后写进视图，撤销回到已保存的', async () => {
    const v = await sourceViewApi.add('7', { viewName: 'A', state: st() })
    await mountPage()
    expect(wrapper.find('[data-testid="mv-dirty"]').exists()).toBe(false)
    emitState(st({ status: 'E' }))
    await flushPromises()
    expect(wrapper.find('[data-testid="mv-dirty"]').exists()).toBe(true)
    await wrapper.get('[data-testid="mv-revert"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="mv-dirty"]').exists()).toBe(false)
    expect(received.at(-1)).toMatchObject({ status: 'all' })
    emitState(st({ tag: '宏观' }))
    await flushPromises()
    await wrapper.get('[data-testid="mv-save"]').trigger('click')
    await settle()
    const saved = (await sourceViewApi.list('7')).find((x) => x.viewId === v.viewId)!
    expect(saved.state.tag).toBe('宏观')
    expect(wrapper.find('[data-testid="mv-dirty"]').exists()).toBe(false)
  })

  it('另存为：未保存的修改存进新视图，原视图不变', async () => {
    await sourceViewApi.add('7', { viewName: 'A', state: st() })
    await mountPage()
    emitState(st({ status: 'E' }))
    await flushPromises()
    await wrapper.get('[data-testid="mv-save-as"]').trigger('click')
    await settle()
    const input = dom('input[data-testid="save-view-name"], [data-testid="save-view-name"] input') as HTMLInputElement
    expect(input.value).toBe('A 副本')
    dom('[data-testid="save-view-submit"]').click()
    await settle()
    const list = await sourceViewApi.list('7')
    expect(list.map((x) => [x.viewName, x.state.status])).toEqual([['A', 'all'], ['A 副本', 'E']])
    expect(wrapper.get('[data-testid="mv-name"]').text()).toBe('A 副本')
  })

  it('切换视图时有未保存的修改要确认；取消就留在原视图', async () => {
    await sourceViewApi.add('7', { viewName: 'A', state: st() })
    await sourceViewApi.add('7', { viewName: 'B', state: st() })
    await mountPage()
    emitState(st({ status: 'E' }))
    await flushPromises()
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel')
    await wrapper.findAll('[data-testid="mv-item"]')[1]!.trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalled()
    expect(wrapper.get('[data-testid="mv-name"]').text()).toBe('A')
  })

  it('显示设置：取消勾选的列应用到列表，标为未保存', async () => {
    await sourceViewApi.add('7', { viewName: 'A', state: st() })
    await mountPage()
    await wrapper.get('[data-testid="mv-display"]').trigger('click')
    await settle()
    ;(dom('[data-testid="mv-col-url"] input') as HTMLInputElement).click()
    await flushPromises()
    dom('[data-testid="mv-display-apply"]').click()
    await settle()
    expect(received.at(-1)!.hiddenColumns).toEqual(['url'])
    expect(wrapper.find('[data-testid="mv-dirty"]').exists()).toBe(true)
  })

  it('设为默认进入：视图标默认，源管理默认进入改为「我的视图」；删除默认视图后回到系统目录', async () => {
    await sourceViewApi.add('7', { viewName: 'A', state: st() })
    await mountPage()
    await (wrapper.vm as unknown as { onMore: (c: string) => Promise<void> }).onMore('default')
    await settle()
    expect((await sourceViewApi.list('7'))[0].isDefault).toBe(true)
    expect(useSourceGroupsStore().preference).toBe('view')
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValueOnce('confirm' as never)
    await wrapper.get('[data-testid="mv-delete"]').trigger('click')
    await settle()
    expect(await sourceViewApi.list('7')).toEqual([])
    expect(useSourceGroupsStore().preference).toBe('system')
  })
})
