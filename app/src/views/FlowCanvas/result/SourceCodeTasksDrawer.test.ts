// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import SourceCodeTasksDrawer from './SourceCodeTasksDrawer.vue'
import { sourceApi, flowCenterApi, type Source } from '@/api'
import { runnerManagementApi } from '@/api/runnerManagement'
vi.mock('@/api', () => ({ sourceApi: { sourceDetail: vi.fn(), codeConfigOptions: vi.fn() }, flowCenterApi: { steps: vi.fn(), detail: vi.fn() } }))
vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { sourceCodeTasks: vi.fn(), createSourceCodeTasks: vi.fn() } }))
const source = { sourceId: '123', name: '网站新闻', flowId: '55', url: 'https://example.net' } as Source
beforeEach(() => {
  vi.mocked(flowCenterApi.detail).mockResolvedValue(null)
  vi.mocked(sourceApi.codeConfigOptions).mockResolvedValue([
    { configId: '900', name: '默认代码生成', topic: 'code-default', entryTypeId: 13 },
    { configId: '9223372036854775806', name: '专用代码生成', topic: 'code-extra', entryTypeId: 14 },
  ])
  vi.mocked(sourceApi.sourceDetail).mockResolvedValue(source)
  vi.mocked(flowCenterApi.steps).mockResolvedValue([{ stepId: '1', name: '首步', sourceId: '', configId: '101', enabled: true, isRoot: true }])
  vi.mocked(runnerManagementApi.sourceCodeTasks).mockResolvedValue([])
  vi.mocked(runnerManagementApi.createSourceCodeTasks).mockResolvedValue({ created: [], skipped: [{ sourceId: '123', name: '网站新闻', reason: '首个配置节点未启用代码生成' }] })
})
afterEach(() => vi.resetAllMocks())
const mountDrawer = (sources = [source]) => mount(SourceCodeTasksDrawer, { props: { modelValue: true, sources }, global: { plugins: [ElementPlus], stubs: { ElDrawer: { template: '<div><slot /></div>' } } } })
it('重新查询源详情，按生效默认流程加载发布拓扑，展示跳过原因', async () => {
  vi.mocked(sourceApi.sourceDetail).mockResolvedValue({ ...source, defaultFlowId: '66' })
  const w = mountDrawer(); await flushPromises()
  await w.get('[aria-label="任务方式"]').setValue('ai'); await flushPromises()
  await w.findAll('button').find(button => button.text() === '代码生成')!.trigger('click'); await flushPromises()
  expect(flowCenterApi.steps).toHaveBeenCalledWith('66', { withConfigDetails: false })
  expect(runnerManagementApi.createSourceCodeTasks).toHaveBeenCalledWith([expect.objectContaining({ sourceId: '123', flowId: '66', nodes: [expect.objectContaining({ isRoot: true, configId: '101' })] })])
  expect(w.text()).toContain('首个配置节点未启用代码生成')
  w.unmount()
})
it('单个源读取失败不会阻止其他源；没有默认流程不提交错误任务', async () => {
  vi.mocked(sourceApi.sourceDetail).mockImplementation(async id => id === '123' ? { ...source, flowId: undefined } : { ...source, sourceId: id })
  const w = mountDrawer([source, { ...source, sourceId: '124' }]); await flushPromises()
  await w.get('[aria-label="任务方式"]').setValue('ai'); await flushPromises()
  await w.findAll('button').find(button => button.text() === '代码生成')!.trigger('click'); await flushPromises()
  expect(runnerManagementApi.createSourceCodeTasks).toHaveBeenCalledWith([expect.objectContaining({ sourceId: '124' })])
  expect(w.text()).toContain('源没有生效的默认流程')
  w.unmount()
})
it('未选择源仍可查看后台任务，但不能创建', async () => {
  const w = mountDrawer([]); await flushPromises()
  await w.get('[aria-label="任务方式"]').setValue('ai'); await flushPromises()
  expect(w.findAll('button').find(button => button.text() === '代码生成')!.attributes('disabled')).toBeDefined()
  expect(runnerManagementApi.sourceCodeTasks).toHaveBeenCalledOnce()
  w.unmount()
})

it('默认按节点配置批量创建，也可切换指定步骤创建', async () => {
  const w = mountDrawer(); await flushPromises()
  expect((w.get('[aria-label="任务方式"]').element as HTMLSelectElement).value).toBe('ai')
  expect(w.findAll('button').some(button => button.text() === '代码生成')).toBe(true)
  await w.find('[aria-label="任务方式"]').setValue('mq'); await flushPromises()
  expect(w.findAll('button').some(button => button.text() === '代码生成')).toBe(false)
  expect(w.text()).toContain('数据库代码生成任务')
  expect(w.text()).not.toContain('派发配置（201）')
  w.unmount()
})
