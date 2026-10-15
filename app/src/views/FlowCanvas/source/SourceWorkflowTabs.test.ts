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

  it('新增按钮可点击，菜单有「新建空白流程」和「从现有流程或模板新建」；没有任何兼容模式提示', async () => {
    vi.spyOn(workflowBindingApi, 'list').mockResolvedValue([MAIN])
    const { wrapper } = await mountTabs()
    expect(wrapper.find('.swt-compat').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('兼容模式')

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
      sourceId: '100', name: '补数据流程', definition: expect.objectContaining({ main: expect.any(Array) }), primary: false,
    })
    expect(router.currentRoute.value.query.flowId).toBe('12')
  })

  it('新建空白草稿后打开返回的工作副本，不再重复创建下一版', async () => {
    const draft: WorkflowBinding = {
      ...AUX, versionManaged: true, publishedVersionNo: undefined, publishedFlowId: undefined,
      draftVersionId: '81', draftVersionNo: 1, draftFlowId: '102', versionStatus: 'DRAFT',
    }
    vi.spyOn(workflowBindingApi, 'list').mockResolvedValueOnce([MAIN]).mockResolvedValueOnce([MAIN, draft])
    vi.mocked(ElMessageBox.prompt).mockResolvedValue({ value: '空白草稿' } as never)
    vi.spyOn(workflowBindingApi, 'createForSource').mockResolvedValue(draft)
    const ensure = vi.spyOn(workflowBindingApi, 'ensureDraft')
    const { wrapper, router } = await mountTabs()

    await wrapper.get('[data-testid="workflow-add"]').trigger('click')
    await wrapper.get('[data-testid="workflow-create-blank"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.workflowId).toBe('12')
    expect(router.currentRoute.value.query.flowId).toBe('102')
    expect(ensure).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('草稿 v1')
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
    expect(workflowBindingApi.bind).toHaveBeenCalledWith({ sourceId: '100', workflowId: '22', primary: false })
    expect(router.currentRoute.value.query.flowId).toBe('22')
  })

  it('已发布版本先创建隔离草稿，再切换到草稿工作副本', async () => {
    const managed = { ...MAIN, versionManaged: true }
    const draft = { ...managed, draftVersionId: 'v2', draftVersionNo: 2, draftFlowId: '21', versionStatus: 'DRAFT' as const }
    vi.spyOn(workflowBindingApi, 'list').mockResolvedValueOnce([{ ...managed, draftFlowId: undefined }]).mockResolvedValueOnce([draft])
    vi.spyOn(workflowBindingApi, 'ensureDraft').mockResolvedValue(draft)
    const { wrapper, router } = await mountTabs()

    await wrapper.get('.swt-version-btn').trigger('click')
    await flushPromises()

    expect(workflowBindingApi.ensureDraft).toHaveBeenCalledWith('11')
    expect(router.currentRoute.value.query.workflowId).toBe('11')
    expect(router.currentRoute.value.query.flowId).toBe('21')
  })

  it('发布草稿后切换到新的发布 flowId', async () => {
    const draft = { ...MAIN, versionManaged: true, draftVersionId: 'v2', draftVersionNo: 2, draftFlowId: '21', versionStatus: 'DRAFT' as const }
    const published = { ...MAIN, versionManaged: true, publishedVersionId: 'v2', publishedVersionNo: 2, publishedFlowId: '21' }
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

// 入组的源（10-15 定）：来源组流程一段（只读）+ 本源流程一段（可新增）；主流程本源默认优先。
describe('SourceWorkflowTabs · 入组的源', () => {
  const GROUP_DEFAULT: WorkflowBinding = { ...MAIN, id: 'g-1', workflowId: '31', workflowName: '组主流程', inherited: true, bindType: 'SOURCE_GROUP', bindId: '3', primary: false, role: 'AUX', groupDefault: true }
  const GROUP_AUX: WorkflowBinding = { ...AUX, id: 'g-2', workflowId: '32', workflowName: '组辅助', inherited: true, bindType: 'SOURCE_GROUP', bindId: '3', role: 'AUX', own: true }

  it('分「来源组 #3」「本源」两段；组默认标「组默认」，本源默认标「主」；两边都绑的带「本源」标记', async () => {
    vi.spyOn(workflowBindingApi, 'list').mockResolvedValue([GROUP_DEFAULT, GROUP_AUX, { ...MAIN, own: true }])
    const { wrapper } = await mountTabs()
    expect(wrapper.get('[data-testid="workflow-seg-group"]').text()).toBe('来源组 #3')
    expect(wrapper.get('[data-testid="workflow-seg-own"]').text()).toBe('本源')
    const tabs = wrapper.findAll('.swt-tab')
    expect(tabs.map((t) => t.find('.swt-id').text())).toEqual(['#31', '#32', '#11'])
    expect(tabs[0].find('.swt-group-default').exists()).toBe(true)
    expect(tabs[0].find('.swt-primary').exists()).toBe(false)
    expect(tabs[1].find('.swt-own-mark').exists()).toBe(true)
    expect(tabs[2].find('.swt-primary').exists()).toBe(true)
    expect(wrapper.find('[data-testid="workflow-add"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('兼容模式')
  })

  it('只有来源组流程：本源段显示「暂无自有流程」，仍可「＋」新增自有流程', async () => {
    vi.spyOn(workflowBindingApi, 'list').mockResolvedValue([{ ...GROUP_DEFAULT, primary: true, role: 'MAIN', own: false }])
    const { wrapper } = await mountTabs()
    expect(wrapper.find('[data-testid="workflow-seg-own"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('暂无自有流程')
    expect(wrapper.find('[data-testid="workflow-add"]').exists()).toBe(true)
    expect(wrapper.find('.swt-version-actions').exists()).toBe(false)
  })

  it('未入组的源不出分段标签', async () => {
    vi.spyOn(workflowBindingApi, 'list').mockResolvedValue([MAIN, AUX])
    const { wrapper } = await mountTabs()
    expect(wrapper.find('.swt-seg').exists()).toBe(false)
  })
})
