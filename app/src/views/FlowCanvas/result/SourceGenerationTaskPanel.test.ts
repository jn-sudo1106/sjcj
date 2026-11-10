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
  expect(w.text()).toContain('task-one')
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
