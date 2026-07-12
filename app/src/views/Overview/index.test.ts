// @vitest-environment jsdom
import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
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
        plugins: [createPinia(), router],
        directives: { loading: {} },
        stubs: {
          AssetFlow: {
            props: ['panorama'],
            emits: ['select'],
            template: '<button data-test="select-branch" @click="$emit(\'select\', \'/基金类\')">全景</button>',
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

    await wrapper.get('[data-test="select-branch"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/collect')
    expect(router.currentRoute.value.query.category).toBe('/基金类')
  })
})
