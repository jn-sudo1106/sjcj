// @vitest-environment jsdom
import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import ElementPlus from 'element-plus'
import Overview from './index.vue'

vi.mock('../../api', () => ({
  overviewApi: {
    summary: () => Promise.resolve({
      kpi: {
        sources: 14, configs: 7, tables: 7, params: 4, successRate: '98.0%', errorSources: 3,
        runningRuns: 2, alarms: 1, newAssets7: 20,
      },
      ecosystem: { sources: 14, configs: 7, tables: 7, params: 4 },
      panorama: {
        total: 7, sourceCount: 14, error: 3, unclassified: 0,
        branches: [{ id: '/基金类', label: '基金类', total: 7, sourceCount: 14, error: 3, children: [] }],
      },
      byCategory: [], byCycle: [], byState: [], topSources: [], exceptions: [], updatedAt: '2026-07-11 14:00:00',
    }),
    trend: () => Promise.resolve([]),
  },
  // 总览说明条右端的「我的收藏」入口会并发拉三类收藏（1108），不 mock 就会走到真实的 http 客户端
  favoriteApi: {
    listIds: (itemType: string) => Promise.resolve(
      itemType === 'SITE' ? ['1', '2'] : itemType === 'ENTRY_TYPE' ? ['a'] : [],
    ),
    add: () => Promise.resolve({ ok: true }),
    remove: () => Promise.resolve({ ok: true }),
  },
}))

describe('Overview panorama integration', () => {
  it('展示动态网站状态并把分类选择写入采集资产路由', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/overview', component: { template: '<div />' } },
        { path: '/collect', component: { template: '<div />' } },
      ],
    })
    await router.push('/overview')
    await router.isReady()

    const wrapper = mount(Overview, {
      global: {
        plugins: [createPinia(), ElementPlus, router],
        directives: { loading: {} },
        stubs: {
          AssetFlow: {
            props: ['panorama'],
            emits: ['select'],
            template: '<div><button data-test="select-branch" @click="$emit(\'select\', \'9009005\')">全景</button><button data-test="select-mock-branch" @click="$emit(\'select\', \'/基金类\')">mock</button></div>',
          },
          CountUp: { props: ['value'], template: '<span>{{ value }}</span>' },
          DonutChart: true,
          TrendBars: true,
          ElIcon: true,
        },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('7 网站')
    expect(wrapper.text()).toContain('3 异常')

    // 说明条右端多了「我的收藏 3」：网站 2 · 源 0 · 表 1
    const chip = wrapper.get('[data-testid="overview-favorite-entry"]')
    expect(chip.text()).toContain('我的收藏')
    expect(chip.text()).toContain('3')

    await wrapper.get('[data-test="select-branch"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/collect')
    expect(router.currentRoute.value.query.category).toBe('9009005')

    // 1123：mock 全景的分支 ID 是路径（/基金类），不能当目录 ID 带进源管理的真实查询
    await router.push('/overview')
    await flushPromises()
    await wrapper.get('[data-test="select-mock-branch"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/collect')
    expect(router.currentRoute.value.query.category).toBeUndefined()
  })
})
