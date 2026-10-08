// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import SourceWorkflowTabs from './SourceWorkflowTabs.vue'
import { flowCenterApi, workflowBindingApi, type WorkflowBinding } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { copyWholeFlow } from '@/utils/flow/copiedConfigs'

vi.mock('@/utils/flow/copiedConfigs', () => ({ copyWholeFlow: vi.fn() }))
vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return {
    ...actual,
    ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    ElMessageBox: { prompt: vi.fn(), confirm: vi.fn() },
  }
})

const MAIN: WorkflowBinding = {
  id: 'b-1', bindType: 'SOURCE', bindId: '100', workflowId: '11', workflowCode: 'F11', workflowName: '主采集流程',
  publishedVersionNo: 1, publishedFlowId: '11', versionStatus: 'PUBLISHED', workflowStatus: 'ACTIVE',
  followsCurrentVersion: true, role: 'MAIN', primary: true, priority: 0, status: 'ACTIVE', inherited: false,
}
const AUX: WorkflowBinding = {
  id: 'b-2', bindType: 'SOURCE', bindId: '100', workflowId: '12', workflowCode: 'F12', workflowName: '补数据流程',
  publishedVersionNo: 1, publishedFlowId: '12', versionStatus: 'PUBLISHED', workflowStatus: 'ACTIVE',
  followsCurrentVersion: true, role: 'BACKFILL', primary: false, priority: 0, status: 'ACTIVE', inherited: false,
}

async function mountTabs(stubs: Record<string, object> = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const flow = useFlowStore()
  flow.loadFromSource({
    sourceId: '100', name: '测试源', url: '', configId: '', mainTable: '', owner: '', state: 'C',
    flowId: '11', primaryFlowId: '11',
  }, [])
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/canvas', component: { template: '<div />' } }],
  })
  await router.push({ path: '/canvas', query: { sourceId: '100', view: 'flow', flowMode: 'canvas', flowId: '11' } })
  await router.isReady()
  const wrapper = mount(SourceWorkflowTabs, {
    props: { sourceId: '100' },
    global: { plugins: [pinia, router], stubs },
  })
  await flushPromises()
  return { wrapper, router }
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.mocked(copyWholeFlow).mockReset()
  // 本文件测的是多流程接口上线后的标签栏；未上线（只读）见文件末尾
  vi.spyOn(workflowBindingApi, 'available').mockReturnValue(true)
})

describe('SourceWorkflowTabs', () => {
  it('正式版本模式打开流程画布时自动进入隔离草稿，节点下拉和加节点无需额外解锁', async () => {
    const managed = { ...MAIN, versionManaged: true }
    const draft = {
      ...managed, draftVersionId: 'v2', draftVersionNo: 2,
      draftFlowId: '21', versionStatus: 'DRAFT' as const,
    }
    vi.spyOn(workflowBindingApi, 'list').mockResolvedValueOnce([managed]).mockResolvedValueOnce([draft])
    const ensure = vi.spyOn(workflowBindingApi, 'ensureDraft').mockResolvedValue(draft)

    const { router } = await mountTabs()

    expect(ensure).toHaveBeenCalledWith('11')
    expect(router.currentRoute.value.query.workflowId).toBe('11')
    expect(router.currentRoute.value.query.flowId).toBe('21')
  })

  it('每条流程显示为独立标签，切换标签会切换当前 flowId', async () => {
    vi.spyOn(workflowBindingApi, 'list').mockResolvedValue([MAIN, AUX])
    const { wrapper, router } = await mountTabs()

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]!.attributes('aria-selected')).toBe('true')
    await tabs[1]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.flowId).toBe('12')
  })

  it('兼容模式下新增按钮仍然可以点击', async () => {
    vi.spyOn(workflowBindingApi, 'list').mockImplementation(async (_sourceId, options) => {
      options?.onCompatibility?.()
      return [MAIN]
    })
    const { wrapper } = await mountTabs()

    const add = wrapper.get('[data-testid="workflow-add"]')
    expect(add.attributes('disabled')).toBeUndefined()
    await add.trigger('click')
    expect(wrapper.find('[data-testid="workflow-add-menu"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="workflow-copy-existing"]').text()).toBe('从现有流程或模板新建')
  })

  it('新建空白流程后直接打开新标签', async () => {
    vi.spyOn(workflowBindingApi, 'list').mockResolvedValueOnce([MAIN]).mockResolvedValueOnce([MAIN, AUX])
    vi.mocked(ElMessageBox.prompt).mockResolvedValue({ value: '补数据流程' } as never)
    vi.spyOn(workflowBindingApi, 'createForSource').mockResolvedValue(AUX)
    const { wrapper, router } = await mountTabs()

    await wrapper.get('[data-testid="workflow-add"]').trigger('click')
    await wrapper.get('[data-testid="workflow-create-blank"]').trigger('click')
    await flushPromises()

    expect(workflowBindingApi.createForSource).toHaveBeenCalledWith({
      sourceId: '100', name: '补数据流程', role: 'AUX', primary: false,
    })
    expect(router.currentRoute.value.query.flowId).toBe('12')
  })

  it('可选择现有流程复制成配置独立的新标签', async () => {
    vi.spyOn(workflowBindingApi, 'list').mockResolvedValue([MAIN])
    vi.mocked(ElMessageBox.prompt).mockResolvedValue({ value: '现有流程副本' } as never)
    vi.mocked(copyWholeFlow).mockResolvedValue({ flowId: '22' })
    vi.spyOn(workflowBindingApi, 'bind').mockResolvedValue({} as never)
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(null as never)
    const ReplaceFlowDialog = {
      emits: ['update:modelValue', 'pick'],
      template: '<button data-testid="pick-existing" @click="$emit(\'pick\', { id: \'20\', name: \'现有流程\' })">选择</button>',
    }
    const { wrapper, router } = await mountTabs({ ReplaceFlowDialog })

    await wrapper.get('[data-testid="workflow-add"]').trigger('click')
    await wrapper.get('[data-testid="workflow-copy-existing"]').trigger('click')
    await wrapper.get('[data-testid="pick-existing"]').trigger('click')
    await flushPromises()

    expect(copyWholeFlow).toHaveBeenCalledWith('20', '现有流程副本', expect.objectContaining({ sourceFlowRef: expect.any(String) }))
    expect(workflowBindingApi.bind).toHaveBeenCalledWith(expect.objectContaining({ sourceId: '100', workflowId: '22', role: 'AUX' }))
    expect(router.currentRoute.value.query.flowId).toBe('22')
  })

  it('已发布版本先创建隔离草稿，再切换到草稿工作副本', async () => {
    const draft = { ...MAIN, draftVersionId: 'v2', draftVersionNo: 2, draftFlowId: '21', versionStatus: 'DRAFT' as const }
    vi.spyOn(workflowBindingApi, 'list').mockResolvedValueOnce([MAIN]).mockResolvedValueOnce([draft])
    vi.spyOn(workflowBindingApi, 'ensureDraft').mockResolvedValue(draft)
    const { wrapper, router } = await mountTabs()

    await wrapper.get('.swt-version-btn').trigger('click')
    await flushPromises()

    expect(workflowBindingApi.ensureDraft).toHaveBeenCalledWith('11')
    expect(router.currentRoute.value.query.workflowId).toBe('11')
    expect(router.currentRoute.value.query.flowId).toBe('21')
  })

  it('发布草稿后切换到新的发布 flowId', async () => {
    const draft = { ...MAIN, draftVersionId: 'v2', draftVersionNo: 2, draftFlowId: '21', versionStatus: 'DRAFT' as const }
    const published = { ...MAIN, publishedVersionId: 'v2', publishedVersionNo: 2, publishedFlowId: '21' }
    vi.spyOn(workflowBindingApi, 'list').mockResolvedValueOnce([draft]).mockResolvedValueOnce([published])
    vi.spyOn(workflowBindingApi, 'publish').mockResolvedValue(published)
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const { wrapper, router } = await mountTabs()

    await wrapper.get('.swt-version-btn.publish').trigger('click')
    await flushPromises()

    expect(workflowBindingApi.publish).toHaveBeenCalledWith('11')
    expect(router.currentRoute.value.query.workflowId).toBe('11')
    expect(router.currentRoute.value.query.flowId).toBe('21')
    expect(router.currentRoute.value.query.flowMode).toBe('list')
  })
})

// 2026-10-08：217 上还没有 workflow/* 接口。未上线时标签栏只读——新增、复制、草稿、发布都不提供，
// 尤其「从现有流程新建」会先用旧接口复制出流程、再绑定失败，留下没有源使用的孤儿流程。
describe('SourceWorkflowTabs · 多流程接口未上线', () => {
  it('只显示当前主流程，不提供新增、复制、编辑新版本、发布', async () => {
    vi.spyOn(workflowBindingApi, 'available').mockReturnValue(false)
    vi.spyOn(workflowBindingApi, 'list').mockImplementation(async (_sourceId, options) => {
      options?.onCompatibility?.()
      return [MAIN]
    })
    const { wrapper } = await mountTabs()
    expect(wrapper.findAll('.swt-tab')).toHaveLength(1)
    expect(wrapper.find('[data-testid="workflow-add"]').exists()).toBe(false)
    expect(wrapper.find('.swt-version-actions').exists()).toBe(false)
    expect(wrapper.get('.swt-compat').attributes('title')).toContain('多流程接口尚未上线')
    expect(copyWholeFlow).not.toHaveBeenCalled()
  })
})
