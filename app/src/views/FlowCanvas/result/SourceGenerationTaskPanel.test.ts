// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { sourceApi, flowCenterApi, workflowBindingApi } from '@/api'
import { runnerManagementApi as api } from '@/api/runnerManagement'
import SourceGenerationTaskPanel from './SourceGenerationTaskPanel.vue'

beforeEach(() => {
  vi.spyOn(api, 'modelInterfaces').mockResolvedValue({ items: [
    { id: 'agent', name: 'Agent', enabled: true, kind: 'agent', runtimeStatus: 'busy' },
    { id: 'chat', name: 'Chat', enabled: true, kind: 'chat' },
  ], revision: 1 } as never)
  vi.spyOn(sourceApi, 'sourceDetail').mockImplementation(async id => ({ sourceId: id, name: `源${id}`, url: 'https://news.example', defaultFlowId: '50' }) as never)
  vi.spyOn(workflowBindingApi, 'list').mockResolvedValue([
    { workflowId: '50', workflowName: '默认流程', primary: true }, { workflowId: '60', workflowName: '另一流程' },
  ] as never)
  vi.spyOn(flowCenterApi, 'steps').mockImplementation(async id => [{ stepId: id === '50' ? '1' : '2', configId: id === '50' ? '101' : '102', name: '采集', enabled: true, isRoot: true }] as never)
  vi.spyOn(api, 'nodeGenerationSettings').mockResolvedValue({ configId: '101', enabled: true, generation: { interfaceId: 'agent', systemPrompt: '系统', userPrompt: '用户' } } as never)
  vi.spyOn(api, 'createCodeGenerationTask').mockResolvedValue({ job: { taskId: 'task-one' } } as never)
})
afterEach(() => vi.restoreAllMocks())
const setup = () => mount(SourceGenerationTaskPanel, { props: { sources: [{ sourceId: '7', name: '源7' }] as never }, global: { stubs: { ElButton: { template: '<button><slot /></button>' } } } })

it('展示源的流程并勾选配置节点，选择全选提交到数据库，保留忙碌 Agent 排队而不展示 Chat', async () => {
  const w = setup(); await flushPromises()
  expect(w.get('[aria-label="批量生成智能体接口"]').text()).toContain('全选')
  expect(w.get('[aria-label="批量生成智能体接口"]').text()).toContain('忙碌')
  expect(w.get('[aria-label="批量生成智能体接口"]').text()).not.toContain('Chat')
  expect(api.createCodeGenerationTask).not.toHaveBeenCalled()
  await w.get('[aria-label="源 7 的流程"]').setValue('60'); await flushPromises()
  expect(w.text()).toContain('配置 102')
  await w.get('[role="checkbox"]').trigger('click')
  await w.get('[data-testid="submit-selected-code-nodes"]').trigger('click'); await flushPromises()
  expect(api.createCodeGenerationTask).toHaveBeenCalledWith(expect.objectContaining({ sourceId: '7', flowId: '60', stepId: '2', configId: '102', generation: expect.objectContaining({ interfaceId: 'all', url: 'https://news.example' }) }))
  expect(w.get('[role="status"]').text()).toContain('已创建 1 条任务，请关闭当前窗口')
  expect(w.text()).not.toContain('task-one')
  expect(w.findAll('button').some(button => button.text() === '刷新')).toBe(false)
  await w.get('[data-testid="submit-selected-code-nodes"]').trigger('click'); await flushPromises()
  expect(api.createCodeGenerationTask).toHaveBeenCalledOnce()
  w.unmount()
})

it('节点未配置生成参数时展示具体原因，不创建占位任务', async () => {
  vi.mocked(api.nodeGenerationSettings).mockResolvedValue({ configId: '101', enabled: false, generation: null })
  const w = setup(); await flushPromises()
  await w.get('[role="checkbox"]').trigger('click')
  await w.get('[data-testid="submit-selected-code-nodes"]').trigger('click'); await flushPromises()
  expect(w.text()).toContain('此节点尚未配置生成参数')
  expect(api.createCodeGenerationTask).not.toHaveBeenCalled()
  w.unmount()
})

it('同一流程只展示一次，勾选一次为所有源提交独立 URL 的任务，切换共同流程也只操作一次', async () => {
  vi.mocked(sourceApi.sourceDetail).mockImplementation(async id => ({ sourceId: id, name: `源${id}`, url: `https://source${id}.example/news`, defaultFlowId: '50' }) as never)
  const w = mount(SourceGenerationTaskPanel, { props: { sources: [{ sourceId: '7' }, { sourceId: '8' }] as never }, global: { stubs: { ElButton: { template: '<button><slot /></button>' } } } })
  await flushPromises()
  expect(w.findAll('[aria-label="代码生成流程图"]')).toHaveLength(1)
  expect(flowCenterApi.steps).toHaveBeenCalledTimes(1)
  await w.get('[aria-label="批量选择流程"]').setValue('60'); await flushPromises()
  expect(w.findAll('[aria-label="代码生成流程图"]')).toHaveLength(1)
  expect(w.text()).toContain('2 个源')
  expect(w.findAll('.source-generation-group > p').some(p => p.text().includes('源7（7）'))).toBe(false)
  await w.get('[role="checkbox"]').trigger('click')
  expect(w.get('[data-testid="submit-selected-code-nodes"]').text()).toContain('2')
  await w.get('[data-testid="submit-selected-code-nodes"]').trigger('click'); await flushPromises()
  expect(api.createCodeGenerationTask).toHaveBeenCalledTimes(2)
  expect(w.get('[role="status"]').text()).toContain('已创建 2 条任务，请关闭当前窗口')
  for (const id of ['7', '8']) expect(api.createCodeGenerationTask).toHaveBeenCalledWith(expect.objectContaining({ sourceId: id, flowId: '60', stepId: '2', generation: expect.objectContaining({ url: `https://source${id}.example/news` }) }))
  w.unmount()
})

it('部分创建失败只展示汇总及原因，重试不会重复创建成功任务', async () => {
  vi.mocked(api.createCodeGenerationTask).mockResolvedValueOnce({ job: { taskId: 'created-first' } } as never).mockRejectedValueOnce(new Error('管理服务暂时不可用'))
  const w = mount(SourceGenerationTaskPanel, { props: { sources: [{ sourceId: '7' }, { sourceId: '8' }] as never }, global: { stubs: { ElButton: { template: '<button><slot /></button>' } } } })
  await flushPromises()
  await w.get('[role="checkbox"]').trigger('click')
  await w.get('[data-testid="submit-selected-code-nodes"]').trigger('click'); await flushPromises()
  expect(w.get('[role="alert"]').text()).toContain('已创建 1 条任务，1 条创建失败：管理服务暂时不可用')
  expect(w.text()).not.toContain('created-first')
  expect(w.text()).not.toContain('任务已提交')
  await w.get('[data-testid="submit-selected-code-nodes"]').trigger('click'); await flushPromises()
  expect(api.createCodeGenerationTask).toHaveBeenCalledTimes(3)
  expect(vi.mocked(api.createCodeGenerationTask).mock.calls[2]![0].sourceId).toBe('8')
  w.unmount()
})

it('不同流程分别选择，源专属节点不派发给其他源', async () => {
  vi.mocked(flowCenterApi.steps).mockImplementation(async id => [{ stepId: id === '50' ? '1' : '2', configId: id === '50' ? '101' : '102', name: '采集', enabled: true, isRoot: true, sourceId: id === '50' ? '8' : '-1' }] as never)
  const w = mount(SourceGenerationTaskPanel, { props: { sources: [{ sourceId: '7' }, { sourceId: '8' }] as never }, global: { stubs: { ElButton: { template: '<button><slot /></button>' } } } })
  await flushPromises()
  await w.get('[role="checkbox"]').trigger('click')
  expect(w.get('[data-testid="submit-selected-code-nodes"]').text()).toContain('1')
  await w.get('[data-testid="submit-selected-code-nodes"]').trigger('click'); await flushPromises()
  expect(api.createCodeGenerationTask).toHaveBeenCalledOnce()
  expect(api.createCodeGenerationTask).toHaveBeenCalledWith(expect.objectContaining({ sourceId: '8', flowId: '50' }))
  await w.get('[aria-label="源 7 的流程"]').setValue('60'); await flushPromises()
  expect(w.findAll('[aria-label="代码生成流程图"]')).toHaveLength(2)
  w.unmount()
})
