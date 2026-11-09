// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { sourceApi, flowCenterApi, workflowBindingApi, type WorkflowBinding } from '@/api'
import CodeConfigButton from './CodeConfigButton.vue'
vi.mock('@/api', () => ({ sourceApi: { sendCodeConfig: vi.fn(), codeConfigOptions: vi.fn(), sourceDetail: vi.fn() }, flowCenterApi: { steps: vi.fn(), detail: vi.fn() }, workflowBindingApi: { list: vi.fn() } }))
afterEach(() => vi.resetAllMocks())
it('点击原操作旁的发代码只打开数据库任务表单，确认后才创建并保留点击时的目标', async () => {
  vi.mocked(flowCenterApi.detail).mockResolvedValue(null)
  vi.mocked(sourceApi.codeConfigOptions).mockResolvedValue([{ configId: '900', name: '代码生成', topic: 'code-default', entryTypeId: 13 }])
  vi.mocked(sourceApi.sendCodeConfig).mockResolvedValue({ sourceId: '7', configId: '900', queue: '', requestCnt: 1, sendCnt: 1, failCnt: 0, taskIds: ['1001'], tasks: [] })
  const ids = ['901']
  const w = mount(CodeConfigButton, { props: { buildTargets: () => [{ sourceId: '7', flowId: '50', stepId: '2', entryTypeId: 11, entryIds: ids }] }, global: { plugins: [ElementPlus], stubs: { ElDrawer: { template: '<div><slot /></div>' } } } })
  await w.get('button').trigger('click'); await flushPromises()
  expect(sourceApi.sendCodeConfig).not.toHaveBeenCalled()
  ids.push('902')
  await w.findAll('button').find(button => button.text().includes('代码生成（'))!.trigger('click'); await flushPromises()
  expect(sourceApi.sendCodeConfig).toHaveBeenCalledWith({ sourceId: '7', flowId: '50', stepId: '2', entryTypeId: 11, entryIds: ['901'] })
  expect(w.text()).toContain('1001')
  w.unmount()
})

it('数据级生成先单选一个后续步骤，确认后只发送该步骤、勾选数据和编排参数', async () => {
  vi.mocked(sourceApi.codeConfigOptions).mockResolvedValue([{ configId: '900', name: '代码生成', topic: 'code-default', entryTypeId: 13 }])
  vi.mocked(flowCenterApi.steps).mockResolvedValue([
    { stepId: '1', sourceId: '-1', name: '列表', enabled: true, isRoot: true, outputTable: '11' },
    { stepId: '2', sourceId: '-1', name: '解析 A', enabled: true, inputTable: '11', dependsOn: ['1'] },
    { stepId: '3', sourceId: '-1', name: '解析 B', enabled: true, inputTable: '11', dependsOn: ['1'] },
  ])
  vi.mocked(sourceApi.sendCodeConfig).mockResolvedValue({ sourceId: '7', configId: '900', queue: 'code-default', requestCnt: 1, sendCnt: 1, failCnt: 0, taskIds: ['1001'], tasks: [] })
  const orchestration = { mode: 'new' as const, describe: '只生成 B', systemPrompt: '系统提示', modelProviderCode: 'provider', modelCode: 'model', inputFields: ['html'], structuredConfig: '{"limit":0}' }
  const w = mount(CodeConfigButton, { props: { selectStep: true, buildTargets: () => [{ sourceId: '7', flowId: '50', fromStepId: '1', entryTypeId: 11, entryIds: ['901'] }], nodeConfigs: { '3': { title: '解析 B', sub: '', status: '', planned: false, base: [], fields: [], inmap: [], params: [], output: [], execCfg: orchestration } } }, global: { plugins: [ElementPlus], stubs: { ElDrawer: { template: '<div><slot /></div>' }, ElDialog: { template: '<div><slot /><slot name="footer" /></div>' } } } })
  await w.get('button').trigger('click'); await flushPromises()
  expect(w.find('[aria-label="代码生成目标步骤"]').exists()).toBe(true)
  expect(w.find('[aria-label="开始代码生成"]').exists()).toBe(false)
  expect(sourceApi.sendCodeConfig).not.toHaveBeenCalled()
  await w.get('[aria-label="代码生成目标步骤"]').setValue('50::3')
  await w.findAll('button').find(button => button.text() === '下一步')!.trigger('click'); await flushPromises()
  orchestration.describe = '之后的编辑'
  await w.get('[aria-label="开始代码生成"]').trigger('click'); await flushPromises()
  expect(sourceApi.sendCodeConfig).toHaveBeenCalledOnce()
  expect(sourceApi.sendCodeConfig).toHaveBeenCalledWith({ sourceId: '7', flowId: '50', stepId: '3', entryTypeId: 11, entryIds: ['901'], orchestration: { ...orchestration, describe: '只生成 B' } })
  expect(flowCenterApi.detail).not.toHaveBeenCalled()
  w.unmount()
})
it('取消步骤选择不派发代码任务', async () => {
  vi.mocked(flowCenterApi.steps).mockResolvedValue([{ stepId: '2', sourceId: '-1', name: '解析', enabled: true, inputTable: '11' }])
  const w = mount(CodeConfigButton, { props: { selectStep: true, buildTargets: () => [{ sourceId: '7', flowId: '50', entryTypeId: 11, entryIds: ['901'] }] }, global: { plugins: [ElementPlus], stubs: { ElDialog: { template: '<div><slot /><slot name="footer" /></div>' } } } })
  await w.get('button').trigger('click'); await flushPromises()
  await w.findAll('button').find(button => button.text() === '取消')!.trigger('click'); await flushPromises()
  expect(sourceApi.sendCodeConfig).not.toHaveBeenCalled()
  expect(w.find('[aria-label="开始代码生成"]').exists()).toBe(false)
  w.unmount()
})

// 1105 会议：源管理行菜单「代码生成」，源绑了多个流程时要先选流程
const binding = (workflowId: string, over: Partial<WorkflowBinding> = {}) => ({ workflowId, workflowName: `流程${workflowId}`, primary: false, workflowStatus: 'ACTIVE', ...over }) as WorkflowBinding
const flowDialogStubs = { ElDrawer: { template: '<div><slot /></div>' }, ElDialog: { template: '<div><slot /><slot name="footer" /></div>' } }
function mountRowLauncher() {
  return mount(CodeConfigButton, { props: { sources: [{ sourceId: '7', name: '政策库' } as never] }, global: { plugins: [ElementPlus], stubs: flowDialogStubs } })
}

it('源绑了多个流程：先选流程（默认流程预选、禁用的不可选），按选中的流程生成', async () => {
  vi.mocked(workflowBindingApi.list).mockResolvedValue([binding('50', { primary: true }), binding('60'), binding('70', { workflowStatus: 'DISABLED' })])
  vi.mocked(flowCenterApi.steps).mockResolvedValue([{ stepId: '1', sourceId: '-1', name: '列表', enabled: true, isRoot: true }])
  vi.mocked(flowCenterApi.detail).mockResolvedValue(null)
  vi.mocked(sourceApi.sendCodeConfig).mockResolvedValue({ sourceId: '7', configId: '900', queue: '', requestCnt: 1, sendCnt: 1, failCnt: 0, taskIds: ['1001'], tasks: [] })
  const w = mountRowLauncher()
  await w.get('button').trigger('click'); await flushPromises()

  const select = w.get<HTMLSelectElement>('[aria-label="代码生成流程"]')
  expect(select.element.value).toBe('50')
  expect(select.findAll('option').map(option => option.attributes('disabled') !== undefined)).toEqual([false, false, true])
  expect(w.find('[aria-label="开始代码生成"]').exists()).toBe(false)

  await select.setValue('60')
  await w.findAll('button').find(button => button.text() === '下一步')!.trigger('click'); await flushPromises()
  await w.get('[aria-label="开始代码生成"]').trigger('click'); await flushPromises()
  expect(flowCenterApi.steps).toHaveBeenCalledWith('60', expect.anything())
  expect(sourceApi.sendCodeConfig).toHaveBeenCalledWith(expect.objectContaining({ sourceId: '7', flowId: '60', stepId: '1' }))
  w.unmount()
})

it('源只有一个可用流程时不弹选择，直接按该流程生成', async () => {
  vi.mocked(workflowBindingApi.list).mockResolvedValue([binding('50', { primary: true }), binding('70', { workflowStatus: 'DISABLED' })])
  const w = mountRowLauncher()
  await w.get('button').trigger('click'); await flushPromises()
  expect(w.find('[aria-label="代码生成流程"]').exists()).toBe(false)
  expect(w.get('[aria-label="代码生成目标"]').text()).toContain('流程 50')
  w.unmount()
})

it('查流程绑定失败时照旧按默认流程，不拦住生成', async () => {
  vi.mocked(workflowBindingApi.list).mockRejectedValue(new Error('后端 500'))
  const w = mountRowLauncher()
  await w.get('button').trigger('click'); await flushPromises()
  expect(w.find('[aria-label="代码生成流程"]').exists()).toBe(false)
  expect(w.find('[aria-label="开始代码生成"]').exists()).toBe(true)
  expect(w.text()).toContain('生效默认流程的 ROOT 步骤')
  w.unmount()
})

