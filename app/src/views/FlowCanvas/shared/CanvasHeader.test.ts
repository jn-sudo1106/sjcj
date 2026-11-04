// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import CanvasHeader from './CanvasHeader.vue'
import { useFlowStore } from '@/stores/flow'
import { useSourceStore } from '@/stores/source'
import { useUiStore } from '@/stores/ui'
import { flowCenterApi, workflowBindingApi, type WorkflowBinding } from '@/api'
import { cloneConfig, isMonitorNode, NODE_CONFIGS } from '@/views/FlowCanvas/canvas/flowModel'

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return { ...actual, ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }
})

async function mountHeader() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/canvas', component: { template: '<div />' } },
      { path: '/flows', component: { template: '<div />' } },
    ],
  })
  // 显式带 view=flow：本文件测的是**流程视图下**的头部操作。在 2026-09-18 把缺省视图
  // 从 flow 改成 data 之前，这里不带 view 也能落到流程视图，是在借默认值。
  await router.push({ path: '/canvas', query: { sourceId: 'source-a', view: 'flow' } })
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(CanvasHeader, { global: { plugins: [pinia, router] } })
  await flushPromises()
  return wrapper
}

describe('CanvasHeader · 流程二级导航', () => {
  it('流程图和流程列表位于独立第二行，不与一级视图并排', async () => {
    const wrapper = await mountHeader()
    useFlowStore().loadFromSource(
      { sourceId: 'source-a', name: '测试源', url: '', configId: '', mainTable: '', owner: '', state: 'C' },
      [],
    )
    await flushPromises()
    const row = wrapper.get('[data-testid="flow-mode-row"]')

    expect(row.get('[aria-label="流程展示方式"]').text()).toBe('流程图流程列表')
    expect(row.get('[aria-label="源运行操作"]').text()).toBe('发起抓取代码生成')
    expect(wrapper.findAll('.rc-canvas-head > .ch-switcher')).toHaveLength(1)
    expect(wrapper.findAll('.ch-flow-mode-row > .ch-switcher')).toHaveLength(1)
    expect(wrapper.find('.ch-canvas-actions').exists()).toBe(false)
    expect(wrapper.find('[data-testid="replace-flow-open"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="copy-current-flow"]').exists()).toBe(false)
  })
})

describe('CanvasHeader · 当前流程发起抓取', () => {
  it.each(['PUBLISHED', 'DRAFT'] as const)('辅助流程 %s：仅草稿禁止抓取', async (status) => {
    const wrapper = await mountHeader()
    useFlowStore().loadFromSource({
      sourceId: '430024910', name: '测试源', url: '', configId: '', mainTable: '', owner: '', state: 'C',
      flowId: '21000040', primaryFlowId: '14009350', workflowVersionStatus: status,
    }, [])
    const start = vi.fn()
    useUiStore().registerAction('发起抓取', start)
    await flushPromises()
    const button = wrapper.get<HTMLButtonElement>('[aria-label="源运行操作"] .rc-btn.primary')
    expect(button.element.disabled).toBe(status === 'DRAFT')
    await button.trigger('click')
    expect(start).toHaveBeenCalledTimes(status === 'DRAFT' ? 0 : 1)
    wrapper.unmount()
  })
})

describe('CanvasHeader · 参数源摘要（0721 会议 T5）', () => {
  it('普通源：摘要展示 url', async () => {
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: 'source-a', name: '普通源', url: 'https://example.com/notice', configId: '', mainTable: 'T1', owner: 'admin', state: 'C' },
      [],
    )
    await flushPromises()

    expect(wrapper.get('.ch-sub').text()).toBe('https://example.com/notice')
  })

  it('参数源：摘要展示"参数源 · 模板 · N 个参数占位符"，不展示原始 url', async () => {
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    flow.loadFromSource(
      {
        sourceId: 'source-a', name: '参数源测试', url: '', configId: '', mainTable: 'T1', owner: 'admin', state: 'C',
        kind: 'param', baseUrl: 'http://base', urlTemplate: 'http://base-$PARAM$_913-$PARAM$_912',
        paramRefs: [{ paramId: '913', group: null }, { paramId: '912', group: null }],
      },
      [],
    )
    await flushPromises()

    expect(wrapper.get('.ch-sub').text()).toBe('参数源 · http://base-$PARAM$_913-$PARAM$_912 · 2 个参数占位符')
  })

  it('源带 flowId：摘要行显示「所属流程」，查到名字用名字，点击带 q 跳流程中心', async () => {
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue({ id: '1400935', name: '上市公司-配置' } as never)
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: 'source-a', name: '*ST东智', url: 'https://e.com', configId: '1400935', flowId: '1400935', mainTable: '', owner: 'admin', state: 'C' } as never,
      [],
    )
    await flushPromises()

    const link = wrapper.get('[data-testid="owning-flow"]')
    // 0926 起名字后带流程 ID；0930 改成 `#id` 小标签（退化 `#id` 形态本身已含 id 不重复）
    expect(link.text()).toBe('当前流程：上市公司-配置#1400935')
    expect(link.get('[data-testid="owning-flow-id"]').text()).toBe('#1400935')
    await link.trigger('click')
    await flushPromises()
    const r = (wrapper.vm as unknown as { $router: { currentRoute: { value: { path: string; query: Record<string, string> } } } }).$router
    expect(r.currentRoute.value.path).toBe('/flows')
    expect(r.currentRoute.value.query.q).toBe('上市公司-配置')
  })

  // 0917-09：/flows 不挂源页签条，走过去就回不来了。把来路放进 query，流程中心据此渲染返回条。
  it('跳流程中心时带上回程上下文：源 / 网站 / 离开时的视图 / 源名', async () => {
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue({ id: '1400935', name: '上市公司-配置' } as never)
    const wrapper = await mountHeader()
    const r = (wrapper.vm as unknown as { $router: { push: (to: unknown) => Promise<void>; currentRoute: { value: { path: string; query: Record<string, string> } } } }).$router
    // 从**数据视图**点出去（这个头是常驻的，不是只在流程视图下）
    await r.push({ path: '/canvas', query: { sourceId: 'source-a', view: 'data' } })
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: '430016397', siteId: '12', name: '*ST东智', url: 'https://e.com', configId: '1400935', flowId: '1400935', mainTable: '', owner: 'admin', state: 'C' } as never,
      [],
    )
    await flushPromises()

    await wrapper.get('[data-testid="owning-flow"]').trigger('click')
    await flushPromises()
    expect(r.currentRoute.value.query).toMatchObject({
      from: 'canvas', sourceId: '430016397', siteId: '12', view: 'data', fromName: '*ST东智',
    })
  })

  // R1（方案 §21）：流程删了源还在跑，flowId 成悬空引用。退化成 `#id` 时用户以为是没加载出来。
  it('流程查不到（detail 返回 null）：标成「流程已删除」，且链接点不动', async () => {
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(null)
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: 'source-a', name: '*ST东智', url: 'https://e.com', configId: '1400935', flowId: '1400935', mainTable: '', owner: 'admin', state: 'C' } as never,
      [],
    )
    await flushPromises()

    const link = wrapper.get('[data-testid="owning-flow"]')
    expect(link.text()).toBe('当前流程：#1400935（流程已删除）')
    expect(link.attributes('disabled')).toBeDefined()

    await link.trigger('click')
    await flushPromises()
    const r = (wrapper.vm as unknown as { $router: { currentRoute: { value: { path: string } } } }).$router
    expect(r.currentRoute.value.path).toBe('/canvas')
  })

  // 断网时每个源都写「流程已删除」比不写更糟，所以只认 detail() 返回 null 那一种
  it('查流程详情报错（网络 / HTTP 错误）：仍显示 #id，不说已删除，链接照旧可点', async () => {
    vi.spyOn(flowCenterApi, 'detail').mockRejectedValue(new Error('Failed to fetch'))
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: 'source-a', name: '*ST东智', url: 'https://e.com', configId: '1400935', flowId: '1400935', mainTable: '', owner: 'admin', state: 'C' } as never,
      [],
    )
    await flushPromises()

    const link = wrapper.get('[data-testid="owning-flow"]')
    expect(link.text()).toBe('当前流程：#1400935')
    expect(link.attributes('disabled')).toBeUndefined()
  })

  it('普通源：URL 是可点开的外链，新窗口打开且带 noopener', async () => {
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: 'source-a', name: '普通源', url: 'https://www.tlstech.com.cn/news?type=1', configId: '', mainTable: 'T1', owner: 'admin', state: 'C' },
      [],
    )
    await flushPromises()

    const link = wrapper.get('[data-testid="source-url-link"]')
    expect(link.attributes('href')).toBe('https://www.tlstech.com.cn/news?type=1')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toContain('noopener')
  })

  // 地址来自采集源配置，不是我们生成的——当外部输入看待，只放行 http/https
  it('非 http(s) 的地址不给链接，仍按纯文本展示', async () => {
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: 'source-a', name: '怪地址', url: 'javascript:alert(1)', configId: '', mainTable: 'T1', owner: 'admin', state: 'C' },
      [],
    )
    await flushPromises()

    expect(wrapper.find('[data-testid="source-url-link"]').exists()).toBe(false)
    expect(wrapper.get('.ch-sub').text()).toBe('javascript:alert(1)')
  })

  it('参数源：摘要不是地址，不给链接', async () => {
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    flow.loadFromSource(
      {
        sourceId: 'source-a', name: '参数源测试', url: 'https://example.com/x', configId: '', mainTable: 'T1', owner: 'admin', state: 'C',
        kind: 'param', baseUrl: 'http://base', urlTemplate: 'http://base-$PARAM$_913',
        paramRefs: [{ paramId: '913', group: null }],
      },
      [],
    )
    await flushPromises()

    expect(wrapper.find('[data-testid="source-url-link"]').exists()).toBe(false)
  })

  it('源没有 flowId：不显示「所属流程」', async () => {
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: 'source-a', name: '游离源', url: 'https://e.com', configId: '', mainTable: '', owner: 'admin', state: 'C' } as never,
      [],
    )
    await flushPromises()
    expect(wrapper.find('[data-testid="owning-flow"]').exists()).toBe(false)
  })
})

// 返回按钮（0828 W5-6/7 合并）：不回网站列表，回**当前源所属网站**的源视图。
describe('CanvasHeader · 返回源视图', () => {
  it('从源问题进入时返回问题列表，恢复日期、状态与页码', async () => {
    const wrapper = await mountHeader()
    const router = wrapper.vm.$router
    router.addRoute({ path: '/monitor', component: { template: '<div />' } })
    useFlowStore().loadFromSource({ sourceId: 'source-a', name: '源 A', url: '', configId: '', mainTable: '', owner: '', state: 'C', siteId: '7' }, [], null)
    const back = '/monitor?tab=sourceIssues&issueStatus=handled&issueStart=2026-11-01&issuePage=2'
    await router.replace({ path: '/canvas', query: { sourceId: 'source-a', view: 'overview', sourceIssueReturn: back } })
    await flushPromises()
    const button = wrapper.findAll('button').find(button => button.text().includes('返回问题列表'))!
    await button.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe(back)
    wrapper.unmount()
  })

  it('问题返回地址不允许跳到外部或其他管理页面', async () => {
    const wrapper = await mountHeader()
    const router = wrapper.vm.$router
    useFlowStore().loadFromSource({ sourceId: 'source-a', name: '源 A', url: '', configId: '', mainTable: '', owner: '', state: 'C', siteId: '7' }, [], null)
    await router.replace({ path: '/canvas', query: { sourceId: 'source-a', sourceIssueReturn: 'https://example.com/monitor?tab=sourceIssues' } })
    await flushPromises()
    const button = wrapper.findAll('button').find(button => button.text().includes('返回源视图'))!
    await button.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ siteId: '7', view: 'source' })
    wrapper.unmount()
  })

  it('有所属网站时回该网站的源视图', async () => {
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: 'source-a', name: '源 A', url: 'https://x', configId: '', mainTable: 'T1', owner: 'admin', state: 'C', siteId: '7' } as never,
      [], null,
    )
    await flushPromises()
    const back = wrapper.findAll('button').find((b) => b.text().includes('返回'))!
    expect(back.text()).toContain('返回源视图')
    await back.trigger('click')
    await flushPromises()
    expect(wrapper.vm.$router.currentRoute.value.query).toEqual({ siteId: '7', view: 'source' })
  })

  it('游离源（无网站归属）退回网站列表，而不是跳到一个不存在的网站', async () => {
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: 'source-b', name: '源 B', url: 'https://y', configId: '', mainTable: 'T1', owner: 'admin', state: 'C' } as never,
      [], null,
    )
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('返回'))!.trigger('click')
    await flushPromises()
    expect(wrapper.vm.$router.currentRoute.value.path).toBe('/collect')
  })
})

describe('CanvasHeader · 流程视图操作', () => {
  it('监控视图页签常驻，位于任务视图之后，选中数据监控节点时可切换', async () => {
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: 'source-a', name: '源 A', url: 'https://x', configId: '', mainTable: 'T1', owner: 'admin', state: 'C' } as never,
      [], null,
    )
    const monitorId = 'monitor-test'
    const monitor = cloneConfig(NODE_CONFIGS.rule)
    monitor.template = 'monitor'
    monitor.title = '数据监控'
    flow.configs[monitorId] = monitor
    flow.main.splice(1, 0, monitorId)
    flow.select(monitorId)
    await flushPromises()

    expect(isMonitorNode(flow.selectedNode)).toBe(true)
    const tab = wrapper.get('[data-testid="monitor-config-view"]')
    expect(tab.text()).toBe('监控')
    expect(wrapper.find('.ch-switcher').findAll('.ch-seg').at(-1)?.text()).toBe('监控')

    await tab.trigger('click')
    await flushPromises()
    expect(wrapper.vm.$router.currentRoute.value.query.view).toBe('monitor-config')
  })

  it('选中普通规则节点时页签仍在，切到监控视图不会被弹回流程视图（0917 常驻）', async () => {
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: 'source-a', name: '源 A', url: 'https://x', configId: '', mainTable: 'T1', owner: 'admin', state: 'C' } as never,
      [], null,
    )
    const ruleId = 'rule-test'
    flow.configs[ruleId] = cloneConfig(NODE_CONFIGS.rule)
    flow.main.splice(1, 0, ruleId)
    flow.select(ruleId)
    await flushPromises()

    const tab = wrapper.get('[data-testid="monitor-config-view"]')
    expect(tab.text()).toBe('监控')

    await tab.trigger('click')
    await flushPromises()
    expect(wrapper.vm.$router.currentRoute.value.query.view).toBe('monitor-config')

    // 选中节点换成非监控节点也不该把视图弹回流程视图
    const otherRuleId = 'rule-test-2'
    flow.configs[otherRuleId] = cloneConfig(NODE_CONFIGS.rule)
    flow.main.splice(2, 0, otherRuleId)
    flow.select(otherRuleId)
    await flushPromises()
    expect(wrapper.vm.$router.currentRoute.value.query.view).toBe('monitor-config')
  })

  it('从数据视图点「流程视图」要真的切回去（缺省视图改成 data 后的回归）', async () => {
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: 'source-a', name: '源 A', url: 'https://x', configId: '', mainTable: 'T1', owner: 'admin', state: 'C' } as never,
      [], null,
    )
    await wrapper.vm.$router.replace({ path: '/canvas', query: { sourceId: 'source-a', view: 'data' } })
    await flushPromises()

    await wrapper.findAll('.ch-seg').find((b) => b.text() === '流程')!.trigger('click')
    await flushPromises()
    expect(wrapper.vm.$router.currentRoute.value.query.view).toBe('flow')
  })

  // 0903 YB-A/YB-3：画布把有分支的流程拍成直线展示，既然展示的是假的就必须说出来。
  it('流程含分支时显示只读提示；直链流程不显示', async () => {
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    const mk = (stepId: string, dependsOn: string[]) =>
      ({ stepId, sourceId: '430016824', name: stepId, dependsOn, enabled: true, inputTable: 'T', outputTable: 'T' })
    const src = { sourceId: '430016824', name: '明阳科技', url: 'http://x', configId: '1400935', mainTable: 'T', owner: 'a', state: 'C' }

    flow.loadFromSource(src as never, [mk('40597', ['0']), mk('40598', ['40597'])] as never, null)
    useSourceStore().rememberSteps([mk('40597', ['0']), mk('40598', ['40597'])] as never, 'replace')
    await flushPromises()
    expect(wrapper.find('[data-testid="flow-branch-flattened"]').exists()).toBe(false)

    const branched = [mk('40597', ['0']), mk('40598', ['40597']), mk('40620', ['40597'])]
    flow.loadFromSource(src as never, branched as never, null)
    useSourceStore().rememberSteps(branched as never, 'replace')
    await flushPromises()
    expect(wrapper.find('[data-testid="flow-branch-flattened"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('拖动节点不会保存')
  })

  it('不再提供同步到源入口', async () => {
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: 'source-a', name: '源 A', url: 'https://x', configId: '', mainTable: 'T1', owner: 'admin', state: 'C', siteId: '7' } as never,
      [], null,
    )
    await flushPromises()
    expect(wrapper.findAll('button').map((b) => b.text()).join(' ')).not.toContain('同步到源')
    expect(wrapper.text()).not.toContain('保存流程')
    expect(wrapper.find('[data-testid="flow-save-status"]').exists()).toBe(true)
  })
})

it('源工作区显示六个视图，概览入口写入 URL', async () => {
  const wrapper = await mountHeader()
  useFlowStore().loadFromSource({ sourceId: 'source-a', name: '源', url: '', configId: '', mainTable: '', owner: '', state: 'C' }, [])
  await flushPromises()
  const tabs = wrapper.find('.ch-switcher').findAll('.ch-seg')
  expect(tabs).toHaveLength(6)
  expect(tabs.map(tab => tab.text())).toEqual(['概览', '流程', '数据', '文件', '任务', '监控'])
  await tabs[0]!.trigger('click')
  await flushPromises()
  expect(wrapper.vm.$router.currentRoute.value.query.view).toBe('overview')
  expect(tabs[0]!.classes()).toContain('on')
  wrapper.unmount()
})

// 2026-10-19：源多流程时，数据 / 文件 / 任务三页在页头切换流程（流程页有标签栏、概览暂不改）
describe('CanvasHeader · 数据/文件/任务页的流程切换器', () => {
  function binding(workflowId: string, extra: Partial<WorkflowBinding> = {}): WorkflowBinding {
    return {
      id: `b-${workflowId}`, bindType: 'SOURCE', bindId: 'source-a', workflowId, workflowCode: '', workflowName: `流程${workflowId}`,
      versionStatus: 'PUBLISHED', workflowStatus: 'ACTIVE', followsCurrentVersion: true, role: 'MAIN', primary: false,
      priority: 0, status: 'ACTIVE', inherited: false, ...extra,
    } as WorkflowBinding
  }
  async function mountAt(view: string, rows: WorkflowBinding[]) {
    vi.spyOn(workflowBindingApi, 'list').mockResolvedValue(rows)
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(null)
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
    await router.push({ path: '/canvas', query: { sourceId: 'source-a', view, workflowId: '701' } })
    await router.isReady()
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(CanvasHeader, { global: { plugins: [pinia, router] } })
    useFlowStore().loadFromSource(
      { sourceId: 'source-a', name: '测试源', url: '', configId: '', mainTable: '', owner: '', state: 'C', flowId: '701', activeWorkflowId: '701' },
      [],
    )
    await flushPromises()
    return { wrapper, router }
  }

  it('多条流程：数据 / 文件 / 任务页显示切换器，选中当前流程，标出主 / 辅助 / 来源组', async () => {
    const rows = [binding('701', { primary: true }), binding('702'), binding('703', { inherited: true })]
    for (const view of ['data', 'file', 'task']) {
      const { wrapper } = await mountAt(view, rows)
      const select = wrapper.get<HTMLSelectElement>('[data-testid="view-flow-picker"] select')
      expect(select.element.value).toBe('701')
      expect(select.findAll('option').map((o) => o.text())).toEqual(['流程701 #701（主）', '流程702 #702（辅助）', '流程703 #703（来源组）'])
      expect(wrapper.find('[data-testid="view-flow-picker-task-note"]').exists()).toBe(view === 'task')
      wrapper.unmount()
    }
  })

  it('流程页、概览、监控不显示；只有一条流程时也不显示', async () => {
    const rows = [binding('701', { primary: true }), binding('702')]
    for (const view of ['flow', 'overview', 'monitor-config']) {
      const { wrapper } = await mountAt(view, rows)
      expect(wrapper.find('[data-testid="view-flow-picker"]').exists()).toBe(false)
      wrapper.unmount()
    }
    const { wrapper } = await mountAt('data', [binding('701', { primary: true })])
    expect(wrapper.find('[data-testid="view-flow-picker"]').exists()).toBe(false)
  })

  it('切换器在标题下「当前流程」那一行里，替换原来的流程名链接', async () => {
    const { wrapper } = await mountAt('data', [binding('701', { primary: true }), binding('702')])
    expect(wrapper.find('.ch-sub [data-testid="view-flow-picker"]').exists()).toBe(true)
    expect(wrapper.find('.ch-switcher + [data-testid="view-flow-picker"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="owning-flow"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="view-flow-picker"]').text()).toContain('当前流程：')
  })

  // 10-19 用户截图：URL 已改成 707423、实际加载的还是 707424，下拉按 URL 显示就和数据对不上
  it('显示值以实际已加载的流程为准，不认 URL 上的 workflowId', async () => {
    vi.spyOn(workflowBindingApi, 'list').mockResolvedValue([binding('701', { primary: true }), binding('702')])
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(null)
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
    await router.push({ path: '/canvas', query: { sourceId: 'source-a', view: 'data', workflowId: '702', flowId: '702' } })
    await router.isReady()
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(CanvasHeader, { global: { plugins: [pinia, router] } })
    useFlowStore().loadFromSource(
      { sourceId: 'source-a', name: '测试源', url: '', configId: '', mainTable: '', owner: '', state: 'C', flowId: '701' },
      [],
    )
    await flushPromises()
    expect(wrapper.get<HTMLSelectElement>('[data-testid="view-flow-picker"] select').element.value).toBe('701')
  })

  it('切换流程只改 query 的 workflowId / flowId（草稿优先），视图保持不变', async () => {
    const rows = [binding('701', { primary: true }), binding('702', { draftFlowId: '7020', publishedFlowId: '7021' })]
    const { wrapper, router } = await mountAt('data', rows)
    await wrapper.get('[data-testid="view-flow-picker"] select').setValue('702')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ sourceId: 'source-a', view: 'data', workflowId: '702', flowId: '7020' })
  })
})

it('发采集旁的发代码使用当前流程和步骤，不能把抓取 configId 当派发 configId', async () => {
  const wrapper = await mountHeader()
  const flow = useFlowStore()
  flow.loadFromSource({ sourceId: '7', flowId: '50', name: '测试源', url: '', configId: '10', mainTable: '11', owner: '', state: 'C' }, [
    { stepId: '2', sourceId: '-1', name: '采集', configId: '20', enabled: true, isRoot: true, outputTable: '11' },
  ])
  flow.selectedId = '2'
  await flushPromises()
  const button = wrapper.findComponent({ name: 'CodeConfigButton' })
  expect(button.props('buildTargets')()).toEqual([{ sourceId: '7', flowId: '50', stepId: '2' }])
  wrapper.unmount()
})
