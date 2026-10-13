// @vitest-environment jsdom
// 源管理「我的视图」目录版（2026-10-13）：视图下拉、目录树（多级 / 父目录汇总）、添加源 / 绑定来源组、
// 随组带入的源排除与恢复、解绑、删除目录、旧条件视图提示、设为默认、跳到源详情不改写地址。
// 右侧源列表 stub 掉：记下收到的源范围，并用固定的选中 ID 驱动批量操作槽位。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import MyViews from './MyViews.vue'
import GroupSourcePicker from './GroupSourcePicker.vue'
import ViewDirTree from './ViewDirTree.vue'
import { sourceApi, sourceGroupApi } from '@/api'
import type { UserInfo } from '@/api/auth'
import { localSourceViewApi, setSourceViewBackend, sourceViewApi } from '@/api/sourceViews'
import { useAuthStore } from '@/stores/auth'
import { useSourceGroupsStore } from '@/stores/sourceGroups'
import { ROOT_ID, addDir, addSources, bindGroup, emptyTree } from './viewDirs'

vi.mock('./groupMembers', () => ({
  loadGroupMembers: async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, id === 'g3' ? ['t1', 't2', 't3'] : []])),
  clearGroupMembersCache: () => {},
}))

/** 源列表最近一次收到的范围 */
let scopeSeen: string[] | undefined
let selectedIds: string[] = []
vi.mock('@/views/FlowCanvas/result/SourceOverviewView.vue', () => ({
  default: defineComponent({
    name: 'SourceOverviewView',
    props: { viewState: Object, currentSiteId: String, groupOps: Boolean, scopeSourceIds: Array, scopeEmptyText: String, extraColumnLabel: String },
    setup(props, { slots }) {
      return () => {
        scopeSeen = props.scopeSourceIds as string[] | undefined
        return h('div', { 'data-testid': 'sov-stub' }, [
          ...(scopeSeen ?? []).map((id) => h('div', { 'data-testid': 'sov-row', 'data-id': id }, slots['extra-cell']?.({ source: { sourceId: id } }))),
          slots['selection-actions']?.({ ids: selectedIds }),
        ])
      }
    },
  }),
}))

let wrapper: VueWrapper
beforeEach(() => {
  setSourceViewBackend('local') // 单测不连后端：用本机实现
  localStorage.clear()
  scopeSeen = undefined
  selectedIds = []
  setActivePinia(createPinia())
  useAuthStore().info = { id: 7 } as UserInfo
  vi.spyOn(sourceGroupApi, 'list').mockResolvedValue([{ sourceGroupId: 'g3', sourceGroupName: 'twitter1' }] as never)
  vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

async function mountPage() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/collect', component: { template: '<div />' } }, { path: '/canvas', component: { template: '<div />' } }] })
  await router.push({ path: '/collect', query: { tab: 'views' } })
  await router.isReady()
  wrapper = mount(MyViews, { global: { plugins: [ElementPlus, router] }, attachTo: document.body })
  await settle()
  return { router }
}
async function settle() { await flushPromises(); await new Promise((r) => setTimeout(r, 20)); await flushPromises() }
const saved = async () => (await sourceViewApi.list('7'))[0].tree
const dirNode = (name: string) => wrapper.findAll('[data-testid="view-dir-node"]').find((n) => n.text().includes(name))!
const sorted = (ids?: string[]) => [...(ids ?? [])].sort()

/** 广发：宏观 > 统计局（s1,s2）、央行（s3）；舆情（s4 + 来源组 g3 = t1,t2,t3） */
async function seed() {
  let t = emptyTree()
  let r = addDir(t, ROOT_ID, '宏观'); t = r.tree; const macro = r.id
  r = addDir(t, macro, '统计局'); t = addSources(r.tree, r.id, ['s1', 's2'])
  r = addDir(t, macro, '央行'); t = addSources(r.tree, r.id, ['s3'])
  r = addDir(t, ROOT_ID, '舆情'); t = bindGroup(addSources(r.tree, r.id, ['s4']), r.id, 'g3')
  return localSourceViewApi.add('7', { viewName: '广发', tree: t })
}

describe('我的视图 · 目录版', () => {
  it('没有视图：提示新建；新建后选中根目录', async () => {
    await mountPage()
    expect(wrapper.text()).toContain('还没有视图')
    await wrapper.get('[data-testid="mv-new"]').trigger('click')
    await settle()
    const input = document.querySelector('input[data-testid="save-view-name"]') as HTMLInputElement
    input.value = '广发'
    input.dispatchEvent(new Event('input'))
    ;(document.querySelector('[data-testid="save-view-submit"]') as HTMLElement).click()
    await settle()
    expect(wrapper.get('[data-testid="mv-path"]').text()).toContain('广发 / 全部（根目录）')
    expect(wrapper.find('[data-testid="view-dir-root"]').exists()).toBe(true)
    expect(scopeSeen).toEqual([])
  })

  it('父目录汇总子目录，根目录汇总整个视图（含来源组成员）；目录显示源数和「组」标记', async () => {
    await seed()
    await mountPage()
    expect(sorted(scopeSeen)).toEqual(['s1', 's2', 's3', 's4', 't1', 't2', 't3'])
    await dirNode('宏观').trigger('click')
    await settle()
    expect(sorted(scopeSeen)).toEqual(['s1', 's2', 's3'])
    expect(wrapper.get('[data-testid="mv-path"]').text()).toContain('广发 / 宏观')
    expect(dirNode('宏观').text()).toContain('3')
    expect(dirNode('舆情').text()).toContain('组')
    expect(dirNode('舆情').text()).toContain('4')
  })

  it('新建子目录：建在选中目录下，建完选中它', async () => {
    await seed()
    await mountPage()
    await dirNode('宏观').trigger('click')
    await settle()
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValueOnce({ value: '财政部' } as never)
    await wrapper.get('[data-testid="mv-new-dir"]').trigger('click')
    await settle()
    const t = await saved()
    const fin = t.dirs.find((d) => d.name === '财政部')!
    expect(t.dirs.find((d) => d.id === fin.parentId)!.name).toBe('宏观')
    expect(wrapper.get('[data-testid="mv-path"]').text()).toContain('宏观 / 财政部')
  })

  it('添加源到选中目录（去重）；选来源组后绑定整个来源组', async () => {
    await seed()
    await mountPage()
    await dirNode('统计局').trigger('click')
    await settle()
    const picker = wrapper.findComponent(GroupSourcePicker)
    picker.vm.$emit('pick', ['s1', 's9'])
    await settle()
    expect((await saved()).dirs.find((d) => d.name === '统计局')!.sources).toEqual(['s1', 's2', 's9'])
    picker.vm.$emit('bindGroup', 'g3')
    await settle()
    expect((await saved()).dirs.find((d) => d.name === '统计局')!.groups).toEqual(['g3'])
    expect(wrapper.get('[data-testid="mv-group-bar"]').text()).toContain('twitter1')
    expect(scopeSeen).toEqual(expect.arrayContaining(['t1', 't2', 't3']))
  })

  it('根目录也能直接绑定来源组', async () => {
    await seed()
    await mountPage()
    wrapper.findComponent(GroupSourcePicker).vm.$emit('bindGroup', 'g3')
    await settle()
    expect((await saved()).root.groups).toEqual(['g3'])
    expect(wrapper.get('[data-testid="mv-group-bar"]').text()).toContain('根目录绑定的来源组')
  })

  it('随来源组带入的源可单独移出（排除，组标签显示 2/3），可恢复；所在目录列标「随来源组」', async () => {
    await seed()
    await mountPage()
    await dirNode('舆情').trigger('click')
    await settle()
    expect(wrapper.get('[data-testid="sov-row"][data-id="t2"]').text()).toContain('随来源组 twitter1')
    expect(wrapper.get('[data-testid="sov-row"][data-id="s4"]').text()).not.toContain('随来源组')
    selectedIds = ['t2']
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValueOnce('confirm' as never)
    await wrapper.findComponent({ name: 'SourceOverviewView' }).vm.$forceUpdate()
    await settle()
    await wrapper.get('[data-testid="mv-remove-sources"]').trigger('click')
    await settle()
    expect(scopeSeen).not.toContain('t2')
    expect((await saved()).dirs.find((d) => d.name === '舆情')!.excluded).toEqual(['t2'])
    expect(wrapper.get('[data-testid="mv-group-bar"]').text()).toContain('2/3')
    await wrapper.get('[data-testid="mv-restore"]').trigger('click')
    await settle()
    expect(scopeSeen).toContain('t2')
  })

  it('解绑来源组：组的源都不在了，单独添加的保留', async () => {
    await seed()
    await mountPage()
    await dirNode('舆情').trigger('click')
    await settle()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValueOnce('confirm' as never)
    await wrapper.get('[data-testid="mv-unbind"]').trigger('click')
    await settle()
    expect(scopeSeen).toEqual(['s4'])
  })

  it('删除目录连同子目录，回到根目录', async () => {
    await seed()
    await mountPage()
    await dirNode('宏观').trigger('click')
    await settle()
    const macroId = (await saved()).dirs.find((d) => d.name === '宏观')!.id
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValueOnce('confirm' as never)
    wrapper.findComponent(ViewDirTree).vm.$emit('command', 'delete', macroId)
    await settle()
    expect((await saved()).dirs.map((d) => d.name)).toEqual(['舆情'])
    expect(wrapper.get('[data-testid="mv-path"]').text()).toContain('全部（根目录）')
  })

  it('10-12 的条件视图读进来：提示改成目录视图；暂存本机时左栏提醒', async () => {
    localStorage.setItem('ce:source-views:v1:7', JSON.stringify({ version: 1, views: [{ viewId: 'a', viewName: '旧条件', state: { v: 1, status: 'E', scopeIds: null }, isDefault: false, revision: 0, createdAt: '', updatedAt: '' }] }))
    await mountPage()
    expect(wrapper.find('[data-testid="mv-converted"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mv-local-note"]').exists()).toBe(true)
  })

  it('设为默认进入：视图标默认，源管理默认进入改为「我的视图」', async () => {
    await seed()
    await mountPage()
    await (wrapper.vm as unknown as { onViewCommand: (c: string) => Promise<void> }).onViewCommand('default')
    await settle()
    expect((await sourceViewApi.list('7'))[0].isDefault).toBe(true)
    expect(useSourceGroupsStore().preference).toBe('view')
  })

  // aa368d5：本页被 KeepAlive 缓存，跳到源详情后不能改写源详情的地址
  it('跳到源详情后不改写源详情地址', async () => {
    const v = await seed()
    const { router } = await mountPage()
    expect(router.currentRoute.value.query.viewId).toBe(v.viewId)
    await router.push({ path: '/canvas', query: { sourceId: '10', view: 'overview', returnTo: '/collect?tab=views' } })
    await settle()
    expect(router.currentRoute.value.query.view).toBe('overview')
    expect(router.currentRoute.value.query.viewId).toBeUndefined()
  })
})
