// @vitest-environment jsdom
// 采集资产的 tab 壳。2026-09-19「表 ID 列表」迁到数据中心后，这里只剩「网站列表」
// 一个 tab，**tab 条仍然保留**；旧入口要能把人送到新位置，不能让书签落到空白页。
import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('./SourceTab.vue', () => ({
  default: { name: 'SourceTab', template: '<div data-testid="stub-source">网站列表内容</div>' },
}))
vi.mock('./ConfigTab.vue', () => ({
  default: { name: 'ConfigTab', template: '<div data-testid="stub-config">配置列表内容</div>' },
}))

async function mountAssets(query: Record<string, string> = {}) {
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
  const CollectAssets = (await import('./index.vue')).default
  const wrapper = mount(CollectAssets, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

describe('采集资产 · tab 壳', () => {
  it('只剩「网站列表」一个 tab，但 tab 条保留着', async () => {
    const { wrapper } = await mountAssets()
    const tabs = wrapper.findAll('.ca-tab-link')
    expect(tabs.map((b) => b.text())).toEqual(['网站列表'])
    expect(wrapper.find('.ca-tabs-wrap').exists()).toBe(true)
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
})
