// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import CanvasHeader from './CanvasHeader.vue'
import { useFlowStore } from '@/stores/flow'
import { useSourceStore } from '@/stores/source'
import { flowCenterApi } from '@/api'
import { ElMessageBox } from 'element-plus'
import { cloneConfig, isMonitorNode, NODE_CONFIGS } from '@/views/FlowCanvas/canvas/flowModel'

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return { ...actual, ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() }, ElMessageBox: { confirm: vi.fn() } }
})

// 0903 Y8-24（2026-09-05）：候选改成**只列已标记为模板的流程**，走 flowCenterApi.templates()
// （后端专给的 flowTemplateList），不再拉全部流程。
async function mountHeader(records: Awaited<ReturnType<typeof flowCenterApi.templates>> = []) {
  vi.spyOn(flowCenterApi, 'templates').mockResolvedValue(records)
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
    expect(link.text()).toBe('所属流程：上市公司-配置')
    await link.trigger('click')
    await flushPromises()
    const r = (wrapper.vm as unknown as { $router: { currentRoute: { value: { path: string; query: Record<string, string> } } } }).$router
    expect(r.currentRoute.value.path).toBe('/flows')
    expect(r.currentRoute.value.query.q).toBe('上市公司-配置')
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
    expect(tab.text()).toBe('监控视图')
    expect(wrapper.findAll('.ch-seg').at(-1)?.text()).toBe('监控视图')

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
    expect(tab.text()).toBe('监控视图')

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

    await wrapper.findAll('.ch-seg').find((b) => b.text() === '流程视图')!.trigger('click')
    await flushPromises()
    expect(wrapper.vm.$router.currentRoute.value.query.view).toBe('flow')
  })

  it('流程模板切换默认展示 10 个，并支持按名称或 ID 搜索', async () => {
    const records = Array.from({ length: 12 }, (_, index) => ({
      id: `flow-${index + 1}`,
      name: `流程 ${index + 1}`,
      version: index + 1,
      definition: { main: [], branches: [], configs: {}, branchGroups: [] },
      updatedAt: '',
    }))
    const wrapper = await mountHeader(records as never)
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: 'source-a', name: '源 A', url: 'https://x', configId: '', mainTable: 'T1', owner: 'admin', state: 'C' } as never,
      [], null,
    )
    await flushPromises()

    const input = wrapper.get('[data-testid="flow-switch-search"]')
    await input.trigger('focus')
    expect(wrapper.findAll('[data-testid="flow-switch-option"]')).toHaveLength(10)
    expect(wrapper.text()).toContain('默认展示前 10 个')

    await input.setValue('flow-12')
    const options = wrapper.findAll('[data-testid="flow-switch-option"]')
    expect(options).toHaveLength(1)
    expect(options[0].text()).toContain('流程 12')
  })

  // 0903 H02：这个下拉**保留**，但语义从"切换流程"改成"切换流程模板"——选模板 = 把模板里的
  // 那套配置复制出一套新的给当前源，不是让本源引用这个流程。设计方案初稿曾要求整个删掉，
  // 已推翻；这条用例锁住文案，避免再被按"删掉"或按旧文案改回去。
  it('下拉文案是「切换流程模板」，不是「切换流程」', async () => {
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: 'source-a', name: '源 A', url: 'https://x', configId: '', mainTable: 'T1', owner: 'admin', state: 'C' } as never,
      [], null,
    )
    await flushPromises()

    const input = wrapper.get('[data-testid="flow-switch-search"]')
    expect(input.attributes('placeholder')).toBe('切换流程模板')
    expect(input.attributes('aria-label')).toBe('搜索并切换流程模板')
  })

  // 0903 Y0-3：原来只在 flow.dirty 时才弹确认，等于"画布干净时静默替换全部节点"。
  // 这个动作会为本源新建一整套配置，任何情况下都该先让人看一眼。
  it('选模板恒弹确认框：画布没有未保存改动时也要弹，且文案说明是「复制出一套新配置」', async () => {
    const records = [{
      id: 'flow-1', name: '标准资讯流程', definition: { main: [], branches: [], configs: {}, branchGroups: [] }, updatedAt: '',
    }]
    const wrapper = await mountHeader(records as never)
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: 'source-a', name: '源 A', url: 'https://x', configId: '', mainTable: 'T1', owner: 'admin', state: 'C' } as never,
      [], null,
    )
    await flushPromises()
    expect(flow.dirty).toBe(false)

    const confirm = vi.mocked(ElMessageBox.confirm).mockRejectedValue('cancel')
    await wrapper.get('[data-testid="flow-switch-search"]').trigger('focus')
    await wrapper.get('[data-testid="flow-switch-option"]').trigger('mousedown')
    await flushPromises()

    expect(confirm).toHaveBeenCalledTimes(1)
    const [message, title] = confirm.mock.calls[0]
    expect(String(message)).toContain('复制模板「标准资讯流程」的配置')
    expect(String(message)).toContain('生成属于本源的一套新配置')
    expect(String(message)).toContain('不影响该模板和其它源')
    expect(title).toBe('切换流程模板')
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
    expect(wrapper.text()).toContain('分支的挂接关系暂不支持在画布上调整')
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

// 0903 Y8-24（2026-09-05 落地）：这个下拉叫「切换流程模板」，之前却把 740 条流程全列出来。
// 用户原话「这里的切换流程模板要展示为模板类型的流程，非模板类型不展示」。
describe('CanvasHeader · 切换流程模板只列模板', () => {
  it('走 templates()（服务端只回模板），不再拉全部流程', async () => {
    const list = vi.spyOn(flowCenterApi, 'list')
    await mountHeader([])
    expect(flowCenterApi.templates).toHaveBeenCalled()
    // 关键：不能顺手也把全部流程拉回来再前端筛——存量 740 条分页后本地只能筛当前页
    expect(list).not.toHaveBeenCalled()
  })

  it('一个模板都没有时给出说明，不是一个空下拉', async () => {
    const w = await mountHeader([])
    // 整个下拉在 `v-if="src"` 里——不先挂上源，picker 根本不渲染
    useFlowStore().loadFromSource(
      { sourceId: 'source-a', name: '源', url: 'https://x.test/', configId: '', mainTable: 'T1', owner: 'admin', state: 'C' },
      [],
    )
    await flushPromises()
    await w.get('[data-testid="flow-switch-search"]').trigger('focus')
    await flushPromises()
    expect(w.find('[data-testid="flow-picker-empty"]').text()).toContain('还没有流程被标记为模板')
  })
})
