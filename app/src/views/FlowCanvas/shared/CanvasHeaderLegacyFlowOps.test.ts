// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import CanvasHeader from './CanvasHeader.vue'
import { useFlowStore } from '@/stores/flow'
import { configApi, flowCenterApi, sourceApi, workflowBindingApi } from '@/api'
import { ElMessageBox } from 'element-plus'
import { cloneConfig, NODE_CONFIGS } from '@/views/FlowCanvas/canvas/flowModel'

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return { ...actual, ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() }, ElMessageBox: { confirm: vi.fn() } }
})

// 复制类确认框（confirmCopyFlow）的 message 是渲染函数：取出文字 / 模拟选「复用原配置」
type VNodeLike = { children?: unknown; props?: Record<string, unknown> | null }
function vnodeText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(vnodeText).join('')
  const children = (node as VNodeLike).children
  if (children && typeof children === 'object' && !Array.isArray(children) && 'default' in children) {
    return vnodeText((children as { default: () => unknown }).default())
  }
  return vnodeText(children)
}
function findVNode(node: unknown, hit: (n: VNodeLike) => boolean): VNodeLike | undefined {
  if (!node || typeof node !== 'object') return undefined
  if (Array.isArray(node)) return node.map((n) => findVNode(n, hit)).find(Boolean)
  const n = node as VNodeLike
  if (hit(n)) return n
  const c = n.children
  if (c && typeof c === 'object' && !Array.isArray(c) && 'default' in c) return findVNode((c as { default: () => unknown }).default(), hit)
  return findVNode(c, hit)
}
function confirmMessageText(call = 0): string {
  const msg = vi.mocked(ElMessageBox.confirm).mock.calls[call]![0] as unknown
  return typeof msg === 'function' ? vnodeText((msg as (p: unknown) => unknown)({})) : String(msg)
}
/** 让 confirm 在「确认」前把配置方式切到「复用原配置」 */
function confirmWithReuse() {
  vi.mocked(ElMessageBox.confirm).mockImplementation((async (msg: unknown) => {
    const group = findVNode((msg as (p: unknown) => unknown)({}), (n) => typeof n.props?.['onUpdate:modelValue'] === 'function')
    ;(group!.props!['onUpdate:modelValue'] as (v: string) => void)('reuse')
    return 'confirm'
  }) as never)
}

// 0903 Y8-24（2026-09-05）：候选改成**只列已标记为模板的流程**，走 flowCenterApi.templates()
// （后端专给的 flowTemplateList），不再拉全部流程。
async function mountHeader(records: Awaited<ReturnType<typeof flowCenterApi.templates>> = [], stubs: Record<string, object> = {}) {
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
  const wrapper = mount(CanvasHeader, { global: { plugins: [pinia, router], stubs } })
  await flushPromises()
  return wrapper
}


// 2026-10-08 合并 leo 分支（多流程标签栏）时保留：多流程接口（workflow/*）在当前后端上线前，
// 顶栏的「套用流程模板 / 更换流程 / 复制当前流程」照旧可用；上线后改由流程标签栏负责。
// 本文件的用例原在 CanvasHeader.test.ts，随 leo 的改动被删，这里按开关语义恢复。
describe('CanvasHeader · 多流程接口开关', () => {
  afterEach(() => { vi.restoreAllMocks() })
  const SRC = { sourceId: 'source-a', name: '源 A', url: 'https://x', configId: '', mainTable: 'T1', owner: 'admin', state: 'C', flowId: 'flow-1' }

  it('接口未上线（默认）：顶栏有套用模板、更换流程、复制当前流程', async () => {
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue({ id: 'flow-1', name: '流程一', sourceCnt: 2 } as never)
    const wrapper = await mountHeader()
    useFlowStore().loadFromSource(SRC as never, [], null)
    await flushPromises()
    expect(wrapper.find('[data-testid="flow-switch-search"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="replace-flow-open"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="copy-current-flow"]').exists()).toBe(true)
  })

  it('接口已上线：三个操作都不出现，也不拉模板列表', async () => {
    vi.spyOn(workflowBindingApi, 'available').mockReturnValue(true)
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue({ id: 'flow-1', name: '流程一', sourceCnt: 2 } as never)
    const wrapper = await mountHeader()
    useFlowStore().loadFromSource(SRC as never, [], null)
    await flushPromises()
    expect(flowCenterApi.templates).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="flow-switch-search"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="replace-flow-open"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="copy-current-flow"]').exists()).toBe(false)
  })
})

describe('CanvasHeader · 套用流程模板下拉', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.mocked(ElMessageBox.confirm).mockReset()
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
  it('下拉文案是「套用流程模板」，不是「切换流程」', async () => {
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: 'source-a', name: '源 A', url: 'https://x', configId: '', mainTable: 'T1', owner: 'admin', state: 'C' } as never,
      [], null,
    )
    await flushPromises()

    const input = wrapper.get('[data-testid="flow-switch-search"]')
    expect(input.attributes('placeholder')).toBe('套用流程模板')
    expect(input.attributes('aria-label')).toBe('搜索并套用流程模板')
    // 挨着左边那个「所属流程」，必须说清两者不是一回事（2026-09-22 用户问「所属流程不是也该跟着改吗」）
    expect(input.attributes('title')).toContain('不改「所属流程」')
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
    expect(String(message)).toContain('复制模板「标准资讯流程」的步骤')
    // 0929 F2：口径从「后端复制出一套新配置」改为「复制完成后前端自动为新增节点复制独立配置」
    expect(String(message)).toContain('复制一份独立配置')
    expect(String(message)).toContain('不会影响模板及其它源')
    expect(title).toBe('套用流程模板')
  })

})

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

// 2026-09-22 用户问「切换完流程，所属流程不是也该跟着改吗」。查出来的不是 flowId 忘了改，
// 而是**顶部下拉整条路不落库**：它走本地 flow.applyTemplate，只在前端换画布。
// 现在改走后端复制端点（与 FlowBoard 空画布那张引导卡共用 utils/flow/applyTemplateToSource）。
describe('CanvasHeader · 套用流程模板走后端（2026-09-22）', () => {
  // ElMessageBox.confirm 是文件顶上 vi.mock 里的模块级 vi.fn()，调用会跨用例累积；
  // 这一组按次序读 mock.calls[0]，也反复 spy 同一批 api 方法，所以每条跑完都清一次。
  afterEach(() => {
    vi.restoreAllMocks()
    vi.mocked(ElMessageBox.confirm).mockReset()
  })

  const TEMPLATE = [{
    id: 'flow-9', name: '标准资讯流程', definition: { main: [], branches: [], configs: {}, branchGroups: [] }, updatedAt: '',
  }]
  const SRC = {
    sourceId: 'source-a', name: '源 A', url: 'https://x', configId: '', mainTable: 'T1', owner: 'admin', state: 'C',
  }

  async function pickTemplate(source: Record<string, unknown>) {
    const wrapper = await mountHeader(TEMPLATE as never)
    const flow = useFlowStore()
    flow.loadFromSource(source as never, [], null)
    await flushPromises()

    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const copySteps = vi.spyOn(flowCenterApi, 'copyTemplateSteps').mockResolvedValue({ ok: true, message: '复制成功，共复制 3 个步骤' })
    const copyFlow = vi.spyOn(flowCenterApi, 'copy').mockResolvedValue('flow-new')
    const bind = vi.spyOn(flowCenterApi, 'bindSources').mockResolvedValue({ ok: true, message: 'ok' })
    // 0929 F2：套用后要做配置去共享（detachCopiedConfigs 先按流程查步骤、再逐条换绑），
    // 复制前后各读一次流程步骤——空列表即可满足（无步骤可换绑，也不拦复制主体）。
    const flowSteps = vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([])
    // 兜底回查：本源自己带了 flowId 就照原样回，没带就回一条也没有 flowId 的——
    // 否则「源还没有流程」那一路会被这个 mock 喂出一个 flowId 来
    const detail = vi.spyOn(sourceApi, 'sourceDetail')
      .mockResolvedValue({ ...SRC, flowId: source.flowId } as never)
    const steps = vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([])

    await wrapper.get('[data-testid="flow-switch-search"]').trigger('focus')
    await wrapper.get('[data-testid="flow-switch-option"]').trigger('mousedown')
    await flushPromises()
    await flushPromises()

    return { copySteps, copyFlow, bind, flowSteps, detail, steps }
  }

  it('源已有流程：步骤复制进本源那条流程，不新建、不改绑定', async () => {
    const { copySteps, copyFlow, bind } = await pickTemplate({ ...SRC, flowId: 'flow-1' })

    expect(copySteps).toHaveBeenCalledWith('flow-9', 'flow-1')
    // 这才是 H03 的口径：复制出一套新的，不是把源挂到模板下面去
    expect(copyFlow).not.toHaveBeenCalled()
    expect(bind).not.toHaveBeenCalled()
  })

  it('源还没有流程：按模板新建一条并关联，所属流程这才会变', async () => {
    const { copySteps, copyFlow, bind } = await pickTemplate({ ...SRC })

    expect(copySteps).not.toHaveBeenCalled()
    expect(copyFlow).toHaveBeenCalledWith('flow-9', '源 A-流程')
    expect(bind).toHaveBeenCalledWith(['source-a'], 'flow-new')
  })

  it('套完从后端重载画布，不在本地拼节点（本地 id 是草稿，自动保存会重复建一遍）', async () => {
    const { detail, steps } = await pickTemplate({ ...SRC, flowId: 'flow-1' })

    expect(detail).toHaveBeenCalledWith('source-a')
    expect(steps).toHaveBeenCalledWith('source-a', { withConfigDetails: false })
  })

  it('确认文案说清是追加、现有节点保留、所属流程不变——后端这条只加不删', async () => {
    const wrapper = await mountHeader(TEMPLATE as never)
    const flow = useFlowStore()
    flow.loadFromSource({ ...SRC, flowId: 'flow-1' } as never, [], null)
    flow.configs['web-1'] = cloneConfig(NODE_CONFIGS['web-list'])
    flow.main = ['web-1']
    await flushPromises()

    const confirm = vi.mocked(ElMessageBox.confirm).mockRejectedValue('cancel')
    await wrapper.get('[data-testid="flow-switch-search"]').trigger('focus')
    await wrapper.get('[data-testid="flow-switch-option"]').trigger('mousedown')
    await flushPromises()

    const [message, , opts] = confirm.mock.calls[0]
    expect(String(message)).toContain('当前 1 个节点会保留')
    expect(String(message)).toContain('不删任何现有节点')
    expect(String(message)).toContain('所属流程不变')
    // 原来写的是「复制并替换」，那是前端本地替换时代的话
    expect(opts).toMatchObject({ confirmButtonText: '复制并追加' })
    expect(String(message)).not.toContain('会被替换')
  })
})

describe('CanvasHeader · 更换流程（0930）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.mocked(ElMessageBox.confirm).mockReset()
  })

  const SRC = {
    sourceId: 'source-a', name: '源 A', url: 'https://x', configId: '', mainTable: 'T1', owner: 'admin', state: 'C', flowId: 'flow-1',
  }
  const PICKED = { id: 'flow-7', name: '别人的流程', updatedAt: '', definition: { main: [], branches: [], configs: {}, branchGroups: [] } }

  async function replace(confirmed: boolean) {
    // 弹窗本身另有 ReplaceFlowDialog.test.ts；这里只测头部的确认 + 复制换绑 + 重载
    const wrapper = await mountHeader([], { ReplaceFlowDialog: { name: 'ReplaceFlowDialog', template: '<div data-testid="replace-flow-dialog-stub" />' } })
    const flow = useFlowStore()
    flow.loadFromSource(SRC as never, [], null)
    await flushPromises()
    vi.mocked(ElMessageBox.confirm)[confirmed ? 'mockResolvedValue' : 'mockRejectedValue']('confirm' as never)
    const copyFlow = vi.spyOn(flowCenterApi, 'copy').mockResolvedValue('flow-new')
    const copySteps = vi.spyOn(flowCenterApi, 'copyTemplateSteps')
    const bind = vi.spyOn(flowCenterApi, 'bindSources').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([])
    const detail = vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue({ ...SRC, flowId: 'flow-new' } as never)
    vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })

    await wrapper.get('[data-testid="replace-flow-open"]').trigger('click')
    await flushPromises()
    wrapper.findComponent({ name: 'ReplaceFlowDialog' }).vm.$emit('pick', PICKED)
    await flushPromises()
    await flushPromises()
    return { copyFlow, copySteps, bind, detail }
  }

  it('确认后整条复制选中流程（名为「源名-流程」）并换绑本源，不走追加，重载画布', async () => {
    const { copyFlow, copySteps, bind, detail } = await replace(true)
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(expect.any(Function), '更换流程', expect.anything())
    expect(confirmMessageText()).toContain('原流程 #flow-1 不动')
    expect(confirmMessageText()).toContain('新增一套配置')
    expect(copyFlow).toHaveBeenCalledWith('flow-7', '源 A-流程')
    expect(copySteps).not.toHaveBeenCalled()
    expect(bind).toHaveBeenCalledWith(['source-a'], 'flow-new')
    expect(detail).toHaveBeenCalledWith('source-a')
  })

  it('取消确认不发任何写请求', async () => {
    const { copyFlow, bind } = await replace(false)
    expect(copyFlow).not.toHaveBeenCalled()
    expect(bind).not.toHaveBeenCalled()
  })
})

describe('CanvasHeader · 复制当前流程（0930）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.mocked(ElMessageBox.confirm).mockReset()
  })

  const SRC = {
    sourceId: 'source-a', name: '源 A', url: 'https://x', configId: '', mainTable: 'T1', owner: 'admin', state: 'C', flowId: '14009350',
  }

  async function setup(detail: unknown) {
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(detail as never)
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    flow.loadFromSource(SRC as never, [], null)
    await flushPromises()
    return wrapper
  }

  it('把当前流程复制为本源独有的流程并换绑，确认框说明其他源不受影响', async () => {
    const wrapper = await setup({ id: '14009350', name: '上市公司-配置', sourceCnt: 9227 })
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const copyFlow = vi.spyOn(flowCenterApi, 'copy').mockResolvedValue('flow-new')
    const bind = vi.spyOn(flowCenterApi, 'bindSources').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([])
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue({ ...SRC, flowId: 'flow-new' } as never)

    await wrapper.get('[data-testid="copy-current-flow"]').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(ElMessageBox.confirm).toHaveBeenCalledWith(expect.any(Function), '复制当前流程', expect.anything())
    expect(confirmMessageText()).toContain('另外 9226 个使用原流程的源仍挂在原流程上')
    expect(copyFlow).toHaveBeenCalledWith('14009350', '源 A-流程')
    expect(bind).toHaveBeenCalledWith(['source-a'], 'flow-new')
  })

  it('选「复用原配置」：只复制并换绑，不做配置去共享（不逐节点复制配置）', async () => {
    const wrapper = await setup({ id: '14009350', name: '上市公司-配置', sourceCnt: 9227 })
    confirmWithReuse()
    const copyFlow = vi.spyOn(flowCenterApi, 'copy').mockResolvedValue('flow-new')
    const bind = vi.spyOn(flowCenterApi, 'bindSources').mockResolvedValue({ ok: true, message: 'ok' })
    const steps = vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([])
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue({ ...SRC, flowId: 'flow-new' } as never)
    const copyConfig = vi.spyOn(configApi, 'copyConfigAndLocate')

    await wrapper.get('[data-testid="copy-current-flow"]').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(copyFlow).toHaveBeenCalledWith('14009350', '源 A-流程')
    expect(bind).toHaveBeenCalledWith(['source-a'], 'flow-new')
    // 去共享的第一步就是按新流程读步骤；复用配置时这一步都不该发生
    expect(steps).not.toHaveBeenCalledWith('flow-new', expect.anything())
    expect(copyConfig).not.toHaveBeenCalled()
  })

  it('所属流程已删除时不显示复制按钮', async () => {
    const wrapper = await setup(null)
    expect(wrapper.find('[data-testid="copy-current-flow"]').exists()).toBe(false)
  })
})
