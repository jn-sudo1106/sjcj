// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import SiteDetailView from './SiteDetailView.vue'
import { useFlowStore } from '@/stores/flow'
import type { Source } from '@/api'

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })

describe('SiteDetailView', () => {
  it('网站详情提供源视图页签，并通过站点路由展示', async () => {
    setActivePinia(createPinia())
    await router.push({ path: '/canvas', query: { siteId: 'site-zfb', view: 'data' } })
    const wrapper = shallowMount(SiteDetailView, {
      props: { siteId: 'site-zfb' },
      global: { plugins: [router], stubs: { SourceOverviewView: true, SiteDataView: true } },
    })
    await flushPromises()

    await wrapper.get('[data-testid="site-source-view"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ siteId: 'site-zfb', view: 'source' })
    expect(wrapper.find('source-overview-view-stub').exists()).toBe(true)
  })

  it('从网站源视图进入源时保留 siteId，确保源页能显示左侧树', async () => {
    setActivePinia(createPinia())
    await router.push({ path: '/canvas', query: { siteId: 'site-zfb', view: 'source' } })
    const wrapper = shallowMount(SiteDetailView, {
      props: { siteId: 'site-zfb' },
      global: { plugins: [router], stubs: { SourceOverviewView: true, SiteDataView: true } },
    })
    await flushPromises()

    const source = { sourceId: 'source-a', name: '源 A' } as Source
    await wrapper.findComponent({ name: 'SourceOverviewView' }).vm.$emit('open-source', source)
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ siteId: 'site-zfb', sourceId: 'source-a', view: 'flow' })
  })

  // 0812 计划 M1-2：网站汇总态不再有任务页签，任务只在具体源和一级任务中心查看。
  it('网站汇总态没有任务页签，只有源/数据/文件三个切换项', async () => {
    setActivePinia(createPinia())
    await router.push({ path: '/canvas', query: { siteId: 'site-zfb', view: 'data' } })
    const wrapper = shallowMount(SiteDetailView, {
      props: { siteId: 'site-zfb' },
      global: { plugins: [router], stubs: { SourceOverviewView: true, SiteDataView: true } },
    })
    await flushPromises()

    expect(wrapper.text()).not.toContain('任务视图')
    expect(wrapper.get('[data-testid="site-source-view"]').text()).toBe('源视图')
    expect(wrapper.get('[data-testid="site-data-view"]').text()).toBe('数据视图')
    expect(wrapper.get('[data-testid="site-file-view"]').text()).toBe('文件视图')
    expect(wrapper.find('site-data-view-stub').exists()).toBe(true)
  })

  it('网站文件页不再展示开发中占位，改为网站范围文件列表', async () => {
    setActivePinia(createPinia())
    await router.push({ path: '/canvas', query: { siteId: 'site-zfb', view: 'file' } })
    const wrapper = shallowMount(SiteDetailView, {
      props: { siteId: 'site-zfb' },
      global: { plugins: [router], stubs: { SourceOverviewView: true, SiteDataView: true, SiteFileView: true } },
    })
    await flushPromises()

    expect(wrapper.find('site-file-view-stub').exists()).toBe(true)
    expect(wrapper.find('[data-testid="site-file-placeholder"]').exists()).toBe(false)
  })

  // 0812 计划 M1-4：网站态不再加载"代表源"，不写 flow.sourceCtx——网站下可能有多张表、
  // 多个流程，拿第一个源的节点/表结构冒充整个网站会得到错误结果。
  it('不加载代表源，flow.sourceCtx 在网站态保持清空', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const flow = useFlowStore()
    await router.push({ path: '/canvas', query: { siteId: 'site-zfb', view: 'source' } })
    shallowMount(SiteDetailView, {
      props: { siteId: 'site-zfb' },
      global: { plugins: [router, pinia], stubs: { SourceOverviewView: true, SiteDataView: true } },
    })
    await flushPromises()

    expect(flow.sourceCtx).toBeNull()
  })

  // 0812 计划 M1-5：快速切网站时，先发出的旧网站请求不能覆盖后发出的新网站已经展示的数据。
  // mock 请求内置 120ms setTimeout 延迟，flushPromises 只推进微任务、推不动它，
  // 用假时钟显式推进宏任务队列才能确定性地等到两次请求都真正 resolve。
  it('快速切换网站时，旧请求不能覆盖新网站', async () => {
    vi.useFakeTimers()
    try {
      setActivePinia(createPinia())
      await router.push({ path: '/canvas', query: { siteId: 'site-zfb', view: 'source' } })
      const wrapper = shallowMount(SiteDetailView, {
        props: { siteId: 'site-zfb' },
        global: { plugins: [router], stubs: { SourceOverviewView: true, SiteDataView: true } },
      })
      // 挂载触发的第一次 load('site-zfb') 尚未 resolve 时立刻切到另一个网站，制造
      // 后发请求先到、先发请求后到的竞态；loadSeq 守卫要保证最终展示的是后来的网站。
      await wrapper.setProps({ siteId: 'site-ttfund' })
      await vi.advanceTimersByTimeAsync(500)

      expect(wrapper.text()).toContain('天天基金采集')
      expect(wrapper.text()).not.toContain('支付宝评论采集')
    } finally {
      vi.useRealTimers()
    }
  })
})
