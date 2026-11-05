// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus, { ElCheckbox, ElInput } from 'element-plus'
import { runnerManagementApi as api, type MqCodeJob } from '@/api/runnerManagement'
import CodeTaskRegeneration from './CodeTaskRegeneration.vue'

const job = { taskId: 'parent-task', configId: '101', status: 'failed', output: 'old traceback', stages: ['previous stage'], message: 'failed', result: { code: 'OLD_CODE', archive: { repoId: 'repo', files: [{ path: 'links/101/main.py' }] } } } as unknown as MqCodeJob
const snapshot = { taskId: job.taskId, generation: { interfaceId: 'model', systemPrompt: '原系统提示词', userPrompt: '原用户提示词' }, context: { sourceName: '测试源', flowId: '20', nodeName: '采集', configId: '101' }, nodePromptRevision: 'rev1', canUpdateNode: true }
const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.spyOn(api, 'prepareCodeRegeneration').mockResolvedValue(snapshot)
  vi.spyOn(api, 'modelInterfaces').mockResolvedValue({ items: [{ id: 'model', name: 'Agent', model: 'hy3', enabled: true }], revision: 1 } as never)
  vi.spyOn(api, 'regenerateCodeTask').mockResolvedValue({ job: { ...job, taskId: 'child', status: 'queued' } })
})
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.restoreAllMocks() })
async function setup() {
  const w = mount(CodeTaskRegeneration, { props: { job }, global: { plugins: [ElementPlus], stubs: {
    ElDialog: { name: 'ElDialog', props: ['modelValue', 'title', 'width', 'top'], template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>' },
    RouterLink: { props: ['to'], template: '<a><slot /></a>' },
  } } })
  wrappers.push(w); await flushPromises(); return w
}
function input(w: VueWrapper, label: string) { return w.findAllComponents(ElInput).find(c => c.props('ariaLabel') === label)! }
it('复用AI大工作区并带入任务快照，默认放大提示词，按需查看上次结果', async () => {
  const w = await setup()
  expect(api.prepareCodeRegeneration).toHaveBeenCalledWith(job.taskId)
  expect(input(w, '重新生成系统提示词').props('modelValue')).toBe('原系统提示词')
  expect(input(w, '重新生成用户提示词').props('modelValue')).toBe('原用户提示词')
  expect(w.findComponent({ name: 'AiCodeWorkspaceDialog' }).props('title')).toContain('AI 代码工作区')
  expect(w.findComponent({ name: 'ElDialog' }).props('width')).toBe('min(1360px, 96vw)')
  expect(w.find('[data-testid="previous-code-snapshot"]').exists()).toBe(false)
  await w.get('[data-testid="toggle-previous-generation"]').trigger('click')
  expect(w.get('[data-testid="previous-code-snapshot"]').text()).toBe('OLD_CODE')
  expect(w.text()).toContain('测试源')
  expect(w.findComponent(ElCheckbox).props('modelValue')).toBe(false)
})
it('提交修正创建新任务，节点更新必须主动勾选', async () => {
  const w = await setup()
  input(w, '本次修正要求').vm.$emit('update:modelValue', '日期选择器改错了')
  w.findComponent(ElCheckbox).vm.$emit('update:modelValue', true); await flushPromises()
  await w.get('form').trigger('submit'); await flushPromises()
  expect(api.regenerateCodeTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: job.taskId, requestId: expect.stringMatching(/^[a-f0-9]{32}$/), systemPrompt: '原系统提示词', userPrompt: '原用户提示词', correction: '日期选择器改错了', interfaceId: 'model', updateNodePrompts: true, nodePromptRevision: 'rev1' }))
  expect(w.emitted('created')?.[0]?.[0]).toMatchObject({ taskId: 'child', status: 'queued' })
})
it('网络失败保留编辑内容，原内容重试沿用请求ID避免重复任务', async () => {
  vi.mocked(api.regenerateCodeTask).mockRejectedValue(new Error('网络超时'))
  const w = await setup()
  input(w, '重新生成用户提示词').vm.$emit('update:modelValue', '修正后的提示词'); await flushPromises()
  await w.get('form').trigger('submit'); await flushPromises()
  expect(w.get('[data-testid="regeneration-error"]').text()).toContain('网络超时')
  expect(input(w, '重新生成用户提示词').props('modelValue')).toBe('修正后的提示词')
  await w.get('form').trigger('submit'); await flushPromises()
  expect(vi.mocked(api.regenerateCodeTask).mock.calls[0]![0].requestId).toBe(vi.mocked(api.regenerateCodeTask).mock.calls[1]![0].requestId)
  expect(w.emitted('created')).toBeUndefined()
})
it('历史模型停用时不能提交，避免默默换成其他模型', async () => {
  vi.mocked(api.modelInterfaces).mockResolvedValue({ items: [], revision: 1 })
  const w = await setup()
  expect(w.get('[data-testid="submit-regeneration"]').attributes('disabled')).toBeDefined()
  await w.get('form').trigger('submit'); await flushPromises()
  expect(api.regenerateCodeTask).not.toHaveBeenCalled()
})
