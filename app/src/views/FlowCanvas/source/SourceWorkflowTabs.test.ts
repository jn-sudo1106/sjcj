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

/** workflowBindingApi.load 的返回：组内源带 sourceGroupId（1021-02） */
const loaded = (rows: WorkflowBinding[], sourceGroupId: string | null = null) => ({ rows, sourceGroupId })

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
    vi.spyOn(workflowBindingApi, 'load').mockResolvedValueOnce(loaded([managed])).mockResolvedValueOnce(loaded([draft]))
    const ensure = vi.spyOn(workflowBindingApi, 'ensureDraft').mockResolvedValue(draft)

    const { router } = await mountTabs()

    expect(ensure).toHaveBeenCalledWith('11')
    expect(router.currentRoute.value.query.workflowId).toBe('11')
    expect(router.currentRoute.value.query.flowId).toBe('21')
  })

  it('每条流程显示为独立标签，切换标签会切换当前 flowId', async () => {
    vi.spyOn(workflowBindingApi, 'load').mockResolvedValue(loaded([MAIN, AUX]))
    const { wrapper, router } = await mountTabs()

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]!.attributes('aria-selected')).toBe('true')
    await tabs[1]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.flowId).toBe('12')
  })

  it('新增按钮可点击，菜单有「新建空白流程」「复用现有流程」「复制现有流程或模板新建」；没有任何兼容模式提示', async () => {
    vi.spyOn(workflowBindingApi, 'load').mockResolvedValue(loaded([MAIN]))
    const { wrapper } = await mountTabs()
    expect(wrapper.find('.swt-compat').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('兼容模式')

    const add = wrapper.get('[data-testid="workflow-add"]')
    expect(add.attributes('disabled')).toBeUndefined()
    await add.trigger('click')
    expect(wrapper.find('[data-testid="workflow-add-menu"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="workflow-reuse-existing"]').text()).toContain('复用现有流程')
    expect(wrapper.get('[data-testid="workflow-copy-existing"]').text()).toBe('复制现有流程或模板新建…')
  })

  it('新建空白流程后直接打开新标签', async () => {
    vi.spyOn(workflowBindingApi, 'load').mockResolvedValueOnce(loaded([MAIN])).mockResolvedValueOnce(loaded([MAIN, AUX]))
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
    vi.spyOn(workflowBindingApi, 'load').mockResolvedValueOnce(loaded([MAIN])).mockResolvedValueOnce(loaded([MAIN, draft]))
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
    vi.spyOn(workflowBindingApi, 'load').mockResolvedValue(loaded([MAIN]))
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
    vi.spyOn(workflowBindingApi, 'load').mockResolvedValueOnce(loaded([{ ...managed, draftFlowId: undefined }])).mockResolvedValueOnce(loaded([draft]))
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
    vi.spyOn(workflowBindingApi, 'load').mockResolvedValueOnce(loaded([draft])).mockResolvedValueOnce(loaded([published]))
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

// 入组的源（1021-02）：只列来源组流程（只读），组默认就是主流程；不给「＋」，要单独配置先退出来源组。
describe('SourceWorkflowTabs · 入组的源', () => {
  const GROUP_DEFAULT: WorkflowBinding = { ...MAIN, id: 'g-1', workflowId: '31', workflowName: '组主流程', inherited: true, bindType: 'SOURCE_GROUP', bindId: '3', primary: true, role: 'MAIN', groupDefault: true }
  const GROUP_AUX: WorkflowBinding = { ...AUX, id: 'g-2', workflowId: '32', workflowName: '组辅助', inherited: true, bindType: 'SOURCE_GROUP', bindId: '3', role: 'AUX' }

  it('只出「来源组 #3」一段，组默认标「主」；没有「本源」段，也没有「＋」', async () => {
    vi.spyOn(workflowBindingApi, 'load').mockResolvedValue(loaded([GROUP_DEFAULT, GROUP_AUX], '3'))
    const { wrapper } = await mountTabs()
    expect(wrapper.get('[data-testid="workflow-seg-group"]').text()).toBe('来源组 #3')
    expect(wrapper.find('[data-testid="workflow-seg-own"]').exists()).toBe(false)
    const tabs = wrapper.findAll('.swt-tab')
    expect(tabs.map((t) => t.find('.swt-id').text())).toEqual(['#31', '#32'])
    expect(tabs[0].find('.swt-primary').exists()).toBe(true)
    expect(wrapper.find('[data-testid="workflow-add"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('兼容模式')
  })

  it('来源组还没绑流程：显示「来源组还没有配置流程」，仍不给「＋」', async () => {
    vi.spyOn(workflowBindingApi, 'load').mockResolvedValue(loaded([], '3'))
    const { wrapper } = await mountTabs()
    expect(wrapper.get('[data-testid="workflow-seg-group"]').text()).toBe('来源组 #3')
    expect(wrapper.find('[data-testid="workflow-group-empty"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('暂无流程')
    expect(wrapper.find('[data-testid="workflow-add"]').exists()).toBe(false)
  })

  it('未入组的源不出分段标签，有「＋」', async () => {
    vi.spyOn(workflowBindingApi, 'load').mockResolvedValue(loaded([MAIN, AUX]))
    const { wrapper } = await mountTabs()
    expect(wrapper.find('.swt-seg').exists()).toBe(false)
    expect(wrapper.find('[data-testid="workflow-add"]').exists()).toBe(true)
  })
})

// 2026-10-21 右键流程标签：设为主流程 / 解绑流程；「＋」补「复用现有流程」
describe('SourceWorkflowTabs · 右键菜单与复用', () => {
  const dialogStub = { 'el-dialog': { props: ['modelValue'], template: '<div v-if="modelValue" data-testid="dlg"><slot /><slot name="footer" /></div>' }, 'el-button': { template: '<button v-bind="$attrs"><slot /></button>' } }
  const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
  async function rightClick(wrapper: Awaited<ReturnType<typeof mountTabs>>['wrapper'], workflowId: string) {
    await wrapper.get(`[data-testid="workflow-tab-${workflowId}"]`).trigger('contextmenu', { clientX: 50, clientY: 60 })
    await flushPromises()
  }
  beforeEach(() => { document.body.innerHTML = '' })

  it('右键标签只出流程菜单，不冒泡到画布；主流程不显示「设为主流程」', async () => {
    vi.spyOn(workflowBindingApi, 'load').mockResolvedValue(loaded([MAIN, AUX]))
    const { wrapper } = await mountTabs(dialogStub)
    const bubbled = vi.fn()
    wrapper.element.parentElement?.addEventListener('contextmenu', bubbled)
    await rightClick(wrapper, '11')
    expect(bubbled).not.toHaveBeenCalled()
    expect(q('workflow-ctx-menu')).not.toBeNull()
    expect(q('workflow-ctx-primary')).toBeNull()
    expect(q('workflow-ctx-unbind')).not.toBeNull()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(q('workflow-ctx-menu')).toBeNull()
    wrapper.unmount()
  })

  it('设为主流程：一步调用 setPrimary 并刷新', async () => {
    const load = vi.spyOn(workflowBindingApi, 'load').mockResolvedValue(loaded([MAIN, AUX]))
    const setPrimary = vi.spyOn(workflowBindingApi, 'setPrimary').mockResolvedValue()
    const { wrapper } = await mountTabs(dialogStub)
    await rightClick(wrapper, '12')
    q('workflow-ctx-primary')!.click()
    await flushPromises()
    expect(setPrimary).toHaveBeenCalledWith('100', '12')
    expect(load).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('解绑主流程：同一确认框选新主流程，一次提交；解绑的是当前标签就切到新主流程', async () => {
    const NEW_MAIN = { ...AUX, primary: true }
    vi.spyOn(workflowBindingApi, 'load').mockResolvedValueOnce(loaded([MAIN, AUX])).mockResolvedValueOnce(loaded([NEW_MAIN]))
    const unbind = vi.spyOn(workflowBindingApi, 'unbind').mockResolvedValue()
    const { wrapper, router } = await mountTabs(dialogStub)
    await rightClick(wrapper, '11')
    q('workflow-ctx-unbind')!.click()
    await flushPromises()
    const radios = wrapper.findAll('[data-testid="workflow-unbind-next"]')
    expect(radios).toHaveLength(1)
    expect((radios[0].element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.find('[data-testid="workflow-unbind-last"]').exists()).toBe(false)
    await wrapper.get('[data-testid="workflow-unbind-ok"]').trigger('click')
    await flushPromises()
    expect(unbind).toHaveBeenCalledWith('100', '11', '12')
    expect(router.currentRoute.value.query.workflowId).toBe('12')
    wrapper.unmount()
  })

  it('解绑最后一条流程：允许，但写明源将没有任何流程；解绑后离开当前流程', async () => {
    vi.spyOn(workflowBindingApi, 'load').mockResolvedValueOnce(loaded([MAIN])).mockResolvedValueOnce(loaded([]))
    const unbind = vi.spyOn(workflowBindingApi, 'unbind').mockResolvedValue()
    const { wrapper, router } = await mountTabs(dialogStub)
    await rightClick(wrapper, '11')
    q('workflow-ctx-unbind')!.click()
    await flushPromises()
    expect(wrapper.get('[data-testid="workflow-unbind-last"]').text()).toContain('将没有任何流程')
    await wrapper.get('[data-testid="workflow-unbind-ok"]').trigger('click')
    await flushPromises()
    expect(unbind).toHaveBeenCalledWith('100', '11', undefined)
    expect(router.currentRoute.value.query.flowId).toBeUndefined()
    wrapper.unmount()
  })

  it('来源组流程标签：右键只给说明和「查看来源组」，没有设主 / 解绑', async () => {
    const GROUP = { ...MAIN, workflowId: '31', workflowName: '组流程', bindType: 'SOURCE_GROUP' as const, bindId: '7', inherited: true, primary: true, groupDefault: true }
    vi.spyOn(workflowBindingApi, 'load').mockResolvedValue(loaded([GROUP], '7'))
    const { wrapper, router } = await mountTabs(dialogStub)
    await rightClick(wrapper, '31')
    expect(q('workflow-ctx-menu')!.textContent).toContain('来源组流程，请到来源组修改')
    expect(q('workflow-ctx-unbind')).toBeNull()
    q('workflow-ctx-group')!.click()
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toContain('group=7')
    wrapper.unmount()
  })

  it('复用现有流程：选择弹窗排除已关联的；确认后直接 bind、不复制', async () => {
    vi.spyOn(workflowBindingApi, 'load').mockResolvedValueOnce(loaded([MAIN])).mockResolvedValue(loaded([MAIN, AUX]))
    const bind = vi.spyOn(workflowBindingApi, 'bind').mockResolvedValue()
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const { wrapper, router } = await mountTabs({ ...dialogStub, ReplaceFlowDialog: { name: 'ReplaceFlowDialog', props: ['purpose', 'excludeFlowIds', 'modelValue'], template: '<div />' } })
    await wrapper.get('[data-testid="workflow-add"]').trigger('click')
    await wrapper.get('[data-testid="workflow-reuse-existing"]').trigger('click')
    const picker = wrapper.findAllComponents({ name: 'ReplaceFlowDialog' }).find((c) => c.props('purpose') === 'bind')!
    expect(picker.props('excludeFlowIds')).toEqual(['11'])
    picker.vm.$emit('pick', { id: '12', name: '补数据流程', sourceCnt: 5 })
    await flushPromises()
    expect(vi.mocked(ElMessageBox.confirm).mock.calls.at(-1)?.[0]).toContain('正被 5 个源使用')
    expect(bind).toHaveBeenCalledWith({ sourceId: '100', workflowId: '12', primary: false })
    expect(copyWholeFlow).not.toHaveBeenCalled()
    expect(router.currentRoute.value.query.workflowId).toBe('12')
    wrapper.unmount()
  })
})
