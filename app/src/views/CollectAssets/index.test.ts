// @vitest-environment jsdom
// 采集资产的 tab 壳。2026-09-19「表 ID 列表」迁到数据中心后，这里只剩「网站列表」
// 一个 tab，**tab 条仍然保留**；旧入口要能把人送到新位置，不能让书签落到空白页。
import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useSourceGroupsStore } from '@/stores/sourceGroups'
import type { UserInfo } from '@/api/auth'

vi.mock('./SourceTab.vue', () => ({
  // scope 要声明成 prop，否则它只会落进 attrs，props('scope') 永远是 undefined
  default: { name: 'SourceTab', props: { scope: String }, template: '<div data-testid="stub-source">网站列表内容</div>' },
}))
vi.mock('./ConfigTab.vue', () => ({
  default: { name: 'ConfigTab', template: '<div data-testid="stub-config">配置列表内容</div>' },
}))
// 「我的分组」就是来源组页（SourceGroupTab，10-13 起可编辑，不再传 readonly）
vi.mock('./MyViews.vue', () => ({ default: { name: 'MyViews', template: '<div>我的视图内容</div>' } }))
vi.mock('@/views/Settings/SourceGroupTab.vue', () => ({ default: { name: 'SourceGroupTab', template: '<div>来源组内容</div>' } }))

async function mountAssets(query: Record<string, string> = {}, preference: 'system' | 'personal' | 'view' | 'last' = 'system') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/collect', component: { template: '<div />' } },
      { path: '/data', component: { template: '<div />' } },
      { path: '/flows', component: { template: '<div />' } },
      { path: '/rules', component: { template: '<div />' } },
    ],
  })
  await router.push({ path: '/collect', query })
  await router.isReady()
  setActivePinia(createPinia())
  localStorage.clear()
  useAuthStore().info = { id: 1 } as UserInfo
  useSourceGroupsStore().setPreference(preference)
  const CollectAssets = (await import('./index.vue')).default
  const wrapper = mount(CollectAssets, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

describe('采集资产 · tab 壳', () => {
  // 0917-17（2026-09-21）加了收藏 tab；0924-01 把排序下拉里的「最近打开」也提成 tab，
  // 收藏 tab 改名「我的收藏」（源列表视图下列的是收藏的源）；1008-03 加过「来源组」（我的分组后），
  // 2026-10-13 移到系统设置，这里回到四个。
  it('五个 tab：系统目录 + 我的分组 + 我的视图 + 我的收藏 + 最近打开', async () => {
    const { wrapper } = await mountAssets()
    const tabs = wrapper.findAll('.ca-tab-link')
    expect(tabs.map((b) => b.text())).toEqual(['系统目录', '我的分组', '我的视图', '我的收藏', '最近打开'])
    expect(wrapper.find('.ca-tabs-wrap').exists()).toBe(true)
  })

  it('/collect?tab=favorite 进「我的收藏」，scope=favorite', async () => {
    const { wrapper } = await mountAssets({ tab: 'favorite' })
    const active = wrapper.findAll('.ca-tab-link').filter((b) => b.classes().includes('active'))
    expect(active.map((b) => b.text())).toEqual(['我的收藏'])
    expect(wrapper.findComponent({ name: 'SourceTab' }).props('scope')).toBe('favorite')
  })

  it('/collect?tab=recent 进「最近打开」，scope=recent', async () => {
    const { wrapper } = await mountAssets({ tab: 'recent' })
    const active = wrapper.findAll('.ca-tab-link').filter((b) => b.classes().includes('active'))
    expect(active.map((b) => b.text())).toEqual(['最近打开'])
    expect(wrapper.findComponent({ name: 'SourceTab' }).props('scope')).toBe('recent')
  })

  it('「网站列表」tab 不锁定任何过滤（scope=all）', async () => {
    const { wrapper } = await mountAssets()
    expect(wrapper.findComponent({ name: 'SourceTab' }).props('scope')).toBe('all')
  })

  it('点「最近打开」tab 地址变成 ?tab=recent（可存书签）', async () => {
    const { wrapper, router } = await mountAssets()
    await wrapper.findAll('.ca-tab-link').find((b) => b.text() === '最近打开')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ tab: 'recent' })
  })

  it('不再有「表 ID 列表」', async () => {
    const { wrapper } = await mountAssets()
    expect(wrapper.text()).not.toContain('表 ID 列表')
  })

  // 迁走前的地址是 /collect?tab=entry，书签和旧链接不能就这么废了。
  // 与既有的 tab=template → /flows、tab=param → /rules?tab=param 同一套做法。
  it('旧地址 /collect?tab=entry 重定向到数据中心', async () => {
    const { router } = await mountAssets({ tab: 'entry' })
    expect(router.currentRoute.value.path).toBe('/data')
    expect(router.currentRoute.value.query).toEqual({ tab: 'entry' })
  })

  it('另外两条既有的重定向没被带坏', async () => {
    const a = await mountAssets({ tab: 'template' })
    expect(a.router.currentRoute.value.path).toBe('/flows')

    const b = await mountAssets({ tab: 'param' })
    expect(b.router.currentRoute.value.path).toBe('/rules')
    expect(b.router.currentRoute.value.query).toEqual({ tab: 'param' })
  })

  it('非法 tab 回落网站列表', async () => {
    const { wrapper } = await mountAssets({ tab: '不存在的tab' })
    expect(wrapper.find('[data-testid="stub-source"]').exists()).toBe(true)
  })
  it('个人默认生效，显式系统目录链接优先，临时切换不改默认', async () => {
    const { wrapper, router } = await mountAssets({}, 'personal')
    expect(wrapper.text()).toContain('来源组内容')
    await wrapper.findAll('.ca-tab-link')[0]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBe('source')
    expect(wrapper.find('[data-testid="stub-source"]').exists()).toBe(true)
    expect(useSourceGroupsStore().preference).toBe('personal')
  })
  it('总览带分类下钻时优先系统目录，不被个人默认截走', async () => {
    const { wrapper } = await mountAssets({ category: 'macro' }, 'personal')
    expect(wrapper.find('[data-testid="stub-source"]').exists()).toBe(true)
    expect(useSourceGroupsStore().preference).toBe('personal')
  })

  // 2026-10-12「我的视图」：默认进入可以选「我的视图」
  it('默认进入选「我的视图」时，不带 tab 打开源管理直接进我的视图', async () => {
    const { wrapper } = await mountAssets({}, 'view')
    expect(wrapper.text()).toContain('我的视图内容')
    expect(wrapper.find('.ca-tab-link.active').text()).toBe('我的视图')
  })
})
