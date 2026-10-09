// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import CanvasHeader from './CanvasHeader.vue'
import { useFlowStore } from '@/stores/flow'
import { configApi, flowCenterApi, sourceApi, workflowBindingApi } from '@/api'
import { ElMessageBox } from 'element-plus'

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

async function mountHeader(stubs: Record<string, object> = {}) {
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
// 顶栏的「更换流程 / 复制当前流程」照旧可用；上线后改由流程标签栏负责。
// 本文件的用例原在 CanvasHeader.test.ts，随 leo 的改动被删，这里按开关语义恢复。
// 1008-08：「套用流程模板」整个去掉（会上定的），不论接口是否上线都不再出现。
describe('CanvasHeader · 多流程接口开关', () => {
  afterEach(() => { vi.restoreAllMocks() })
  const SRC = { sourceId: 'source-a', name: '源 A', url: 'https://x', configId: '', mainTable: 'T1', owner: 'admin', state: 'C', flowId: 'flow-1' }

  it('接口未上线（默认）：顶栏有更换流程、复制当前流程，没有「套用流程模板」', async () => {
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue({ id: 'flow-1', name: '流程一', sourceCnt: 2 } as never)
    const wrapper = await mountHeader()
    useFlowStore().loadFromSource(SRC as never, [], null)
    await flushPromises()
    expect(wrapper.find('[data-testid="flow-switch-search"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="搜索并套用流程模板"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('套用流程模板')
    expect(wrapper.find('[data-testid="replace-flow-open"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="copy-current-flow"]').exists()).toBe(true)
  })

  it('接口已上线：更换、复制两个操作都不出现，也不拉模板列表', async () => {
    vi.spyOn(workflowBindingApi, 'available').mockReturnValue(true)
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue({ id: 'flow-1', name: '流程一', sourceCnt: 2 } as never)
    const wrapper = await mountHeader()
    useFlowStore().loadFromSource(SRC as never, [], null)
    await flushPromises()
    expect(wrapper.find('[data-testid="replace-flow-open"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="copy-current-flow"]').exists()).toBe(false)
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
    const wrapper = await mountHeader({ ReplaceFlowDialog: { name: 'ReplaceFlowDialog', template: '<div data-testid="replace-flow-dialog-stub" />' } })
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
