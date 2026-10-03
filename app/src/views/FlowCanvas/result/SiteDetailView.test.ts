// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import SiteDetailView from './SiteDetailView.vue'
import { useFlowStore } from '@/stores/flow'
import { siteApi, type Source } from '@/api'
import { useWorkspaceStore } from '@/stores/workspace'

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
    expect(router.currentRoute.value.query).toMatchObject({ siteId: 'site-zfb', sourceId: 'source-a', view: 'overview' })
  })

  // 0915-05（2026-09-16）：本用例原来断言的是 0812 计划 M1-2「网站汇总态没有任务页签」，
  // 该结论已被 0915 会议推翻（发完任务不知道跑在哪个源上，任务中心又不区分网站），
  // 改为断言五个切换项齐全、且任务视图排在监控视图左侧。
  it('网站汇总态有源/数据/文件/任务/监控五个切换项，任务在监控左侧', async () => {
    setActivePinia(createPinia())
    await router.push({ path: '/canvas', query: { siteId: 'site-zfb', view: 'data' } })
    const wrapper = shallowMount(SiteDetailView, {
      props: { siteId: 'site-zfb' },
      global: { plugins: [router], stubs: { SourceOverviewView: true, SiteDataView: true } },
    })
    await flushPromises()

    expect(wrapper.get('[data-testid="site-source-view"]').text()).toBe('源')
    expect(wrapper.get('[data-testid="site-data-view"]').text()).toBe('数据')
    expect(wrapper.get('[data-testid="site-file-view"]').text()).toBe('文件')
    expect(wrapper.get('[data-testid="site-task-view"]').text()).toBe('任务')
    expect(wrapper.get('[data-testid="site-monitor-view"]').text()).toBe('监控')
    // 顺序：任务在监控左边（产品 2026-09-16 指定）
    const segs = wrapper.findAll('.sdv-seg').map((btn) => btn.text())
    expect(segs.indexOf('任务')).toBe(segs.indexOf('监控') - 1)
    // 2026-09-24：进数据视图默认是左栏数据表模式，地址栏没带表 = 「全部」→ 中间是各表汇总
    expect(wrapper.find('site-tables-overview-stub').exists()).toBe(true)
    expect(wrapper.find('site-data-view-stub').exists()).toBe(false)
  })

  it('切到任务视图时以 siteWide 模式挂载 TaskView 并把 siteId 传进去', async () => {
    setActivePinia(createPinia())
    await router.push({ path: '/canvas', query: { siteId: 'site-zfb', view: 'task' } })
    const wrapper = shallowMount(SiteDetailView, {
      props: { siteId: 'site-zfb' },
      global: { plugins: [router], stubs: { SourceOverviewView: true, TaskView: true } },
    })
    await flushPromises()

    const taskView = wrapper.find('task-view-stub')
    expect(taskView.exists()).toBe(true)
    expect(taskView.attributes('siteid')).toBe('site-zfb')
    expect(taskView.attributes('sitewide')).toBeDefined()
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

  // 0916：监控视图内部拆了「监控结果 / 监控配置」两 Tab，子 Tab 跟 view 一样落 URL——
  // 刷新和深链要回得到同一档，所以由持有 route 的本组件解析与回写。
  it('监控视图的子 Tab 由 URL 决定，切换时写回 monitorTab', async () => {
    setActivePinia(createPinia())
    await router.push({ path: '/canvas', query: { siteId: 'site-zfb', view: 'monitor' } })
    const wrapper = shallowMount(SiteDetailView, {
      props: { siteId: 'site-zfb' },
      global: {
        plugins: [router],
        stubs: { SourceOverviewView: true, SiteDataView: true, SiteMonitorResultView: true, SiteMonitorConfigView: true },
      },
    })
    await flushPromises()

    const monitor = wrapper.findComponent({ name: 'SiteMonitorView' })
    expect(monitor.props('tab')).toBe('result')

    // 子 Tab 条在容器内部，shallowMount 下取不到它的 DOM，这里验证接线：抛上来就得写进 URL
    await monitor.vm.$emit('update:tab', 'config')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ siteId: 'site-zfb', view: 'monitor', monitorTab: 'config' })
    expect(wrapper.findComponent({ name: 'SiteMonitorView' }).props('tab')).toBe('config')
  })

  it('深链带 monitorTab=config 时直接停在监控配置', async () => {
    setActivePinia(createPinia())
    await router.push({ path: '/canvas', query: { siteId: 'site-zfb', view: 'monitor', monitorTab: 'config' } })
    const wrapper = shallowMount(SiteDetailView, {
      props: { siteId: 'site-zfb' },
      global: {
        plugins: [router],
        stubs: { SourceOverviewView: true, SiteDataView: true, SiteMonitorResultView: true, SiteMonitorConfigView: true },
      },
    })
    await flushPromises()

    expect(wrapper.findComponent({ name: 'SiteMonitorView' }).props('tab')).toBe('config')
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

  // 2026-09-23：站 89 标题停在「网站详情」——siteDetail 抛异常时 load 直接冒泡，没提示、不能重试。
  it('网站详情请求失败：视图照常显示，标题旁给重试；左侧源栏补上页签名后标题跟着有名字', async () => {
    setActivePinia(createPinia())
    await router.push({ path: '/canvas', query: { siteId: 'site-zfb', view: 'source' } })
    const detail = vi.spyOn(siteApi, 'siteDetail').mockRejectedValueOnce(new Error('timeout'))
    const ws = useWorkspaceStore()
    ws.ensureSiteTab('site-zfb')
    const wrapper = shallowMount(SiteDetailView, {
      props: { siteId: 'site-zfb' },
      global: { plugins: [router], stubs: { SourceOverviewView: true, SiteDataView: true } },
    })
    await flushPromises()

    // 失败不整块替换成错误态：源视图照常挂着
    expect(wrapper.find('source-overview-view-stub').exists()).toBe(true)
    expect(wrapper.get('[data-testid="site-detail-failed"]').text()).toContain('网站信息加载失败')
    expect(wrapper.get('.sdv-title').text()).toContain('网站详情')

    // 左侧源栏那边重试成功、补了页签名 → 标题跟着显示
    ws.ensureSiteTab('site-zfb', '支付宝')
    await flushPromises()
    expect(wrapper.get('.sdv-title').text()).toContain('支付宝')

    // 自己点重试：请求恢复后失败提示消失
    detail.mockResolvedValueOnce({ siteId: 'site-zfb', name: '支付宝(详情)', category: '', owner: '', sourceCount: 1, errorCount: 0 })
    await wrapper.get('[data-testid="site-detail-retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="site-detail-failed"]').exists()).toBe(false)
    expect(wrapper.get('.sdv-title').text()).toContain('支付宝(详情)')
    detail.mockRestore()
  })
})

// 2026-09-24：数据视图左栏默认数据表模式；「全部」显示各表汇总，选了表才挂数据视图
describe('SiteDetailView · 数据视图与左栏数据表模式', () => {
  async function mountData(query: Record<string, string>, mode: 'source' | 'table' = 'table') {
    setActivePinia(createPinia())
    const { useUiStore } = await import('@/stores/ui')
    useUiStore().setSiteDataSideMode(mode)
    await router.push({ path: '/canvas', query: { siteId: 'site-zfb', view: 'data', ...query } })
    const wrapper = shallowMount(SiteDetailView, {
      props: { siteId: 'site-zfb' },
      global: { plugins: [router], stubs: { SourceOverviewView: true, SiteDataView: true, SiteTablesOverview: true } },
    })
    await flushPromises()
    return wrapper
  }

  it('数据表模式 + 带了表：挂数据视图并锁定这张表', async () => {
    const wrapper = await mountData({ tableId: '900' })
    expect(wrapper.find('site-tables-overview-stub').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'SiteDataView' }).props('lockedTableId')).toBe('900')
  })

  it('源模式：照旧挂数据视图，不锁表', async () => {
    const wrapper = await mountData({ tableId: '900' }, 'source')
    expect(wrapper.find('site-tables-overview-stub').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'SiteDataView' }).props('lockedTableId')).toBe('')
  })

  it('汇总里点一张表：地址栏写上 tableId', async () => {
    const wrapper = await mountData({})
    await wrapper.findComponent({ name: 'SiteTablesOverview' }).vm.$emit('pick', '6200023')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ siteId: 'site-zfb', view: 'data', tableId: '6200023' })
  })

  it('「按条件查源」带 condTable 过来：表写进 tableId（否则会落到汇总页、条件丢失），条件传给数据视图', async () => {
    const wrapper = await mountData({ condTable: '900', condSql: "K1 = 'x'" })
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ tableId: '900' })
    expect(router.currentRoute.value.query.condTable).toBeUndefined()
    const view = wrapper.findComponent({ name: 'SiteDataView' })
    expect(view.props('lockedTableId')).toBe('900')
    expect(view.props('initialCondition')).toMatchObject({ tableId: '900', sql: "K1 = 'x'" })
  })
})

