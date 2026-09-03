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

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return { ...actual, ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() }, ElMessageBox: { confirm: vi.fn() } }
})

async function mountHeader(records: Awaited<ReturnType<typeof flowCenterApi.list>> = []) {
  vi.spyOn(flowCenterApi, 'list').mockResolvedValue(records)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/canvas', component: { template: '<div />' } }],
  })
  await router.push({ path: '/canvas', query: { sourceId: 'source-a' } })
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
    expect(wrapper.text()).toContain('已有的分支结构不会被改动')
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
