// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus, { ElCheckbox, ElInput } from 'element-plus'
import { runnerManagementApi as api, type MqCodeJob } from '@/api/runnerManagement'
import { nodePromptApi, type NodePromptTemplate } from '@/api/nodePrompts'
import CodeTaskRegeneration from './CodeTaskRegeneration.vue'

const job = { taskId: 'parent-task', configId: '101', status: 'failed', output: '{"reply":"原始过程输出，不要解码或摘要"}', stages: ['previous stage'], message: 'failed', result: { code: 'OLD_CODE', archive: { repoId: 'repo', files: [{ path: 'links/101/main.py' }] } } } as unknown as MqCodeJob
const snapshot = { taskId: job.taskId, generation: { interfaceId: 'model', configType: '90', systemPrompt: '原系统提示词', userPrompt: '原用户提示词' }, context: { sourceName: '测试源', flowId: '20', nodeName: '采集', configId: '101' }, nodePromptRevision: 'rev1', canUpdateNode: true }
const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.spyOn(api, 'prepareCodeRegeneration').mockImplementation(async id => ({ ...snapshot, taskId: id }))
  vi.spyOn(nodePromptApi, 'list').mockResolvedValue([])
  vi.spyOn(api, 'modelInterfaces').mockResolvedValue({ items: [{ id: 'model', name: 'Agent', kind: 'agent', model: 'hy3', enabled: true }], revision: 1 } as never)
  vi.spyOn(api, 'regenerateCodeTask').mockResolvedValue({ job: { ...job, taskId: 'child', status: 'queued', stages: [], output: '', message: '等待处理', result: null } })
  vi.spyOn(api, 'mqCodeJob').mockImplementation(async id => ({ job: { ...job, taskId: id, status: 'queued', stages: [], output: '', message: '等待处理', result: null } }))
})
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.restoreAllMocks(); vi.useRealTimers() })
async function setup(currentJob = job) {
  const dialog = { name: 'ElDialog', props: ['modelValue', 'title', 'width'], template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>' }
  const w = mount(CodeTaskRegeneration, { props: { job: currentJob }, global: { plugins: [ElementPlus], stubs: {
    ElDialog: dialog, ElDrawer: { ...dialog, name: 'ElDrawer' }, RouterLink: { props: ['to'], template: '<a><slot /></a>' },
  } } })
  wrappers.push(w); await flushPromises(); return w
}
function input(w: VueWrapper, label: string) { return w.findAllComponents(ElInput).find(c => c.props('ariaLabel') === label)! }
async function send(w: VueWrapper, text: string) {
  input(w, '本次修正要求').vm.$emit('update:modelValue', text); await flushPromises()
  await w.get('form').trigger('submit'); await flushPromises()
}
it('打开后直接把上次完整过程输出作为智能体回复展示，默认不是提示词编辑器', async () => {
  const w = await setup()
  expect(w.get('[data-testid="generation-agent-reply"] pre').text()).toBe('previous stage\n\n' + job.output)
  expect(w.find('[data-testid="regeneration-conversation"]').exists()).toBe(false)
  expect(w.findComponent({ name: 'PromptAiEditor' }).exists()).toBe(false)
  expect(w.findComponent({ name: 'ElDialog' }).props('width')).toBe('min(1360px, 96vw)')
  expect(w.get('[data-testid="submit-regeneration"]').text()).toBe('发送并修改代码')
  expect(w.text()).toContain('测试源')
})
it('发送修改要求到生成智能体并保留对话窗口，不转成 Chat 提示词修改', async () => {
  const w = await setup()
  await send(w, '日期选择器取错了，请修改代码')
  expect(api.regenerateCodeTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: job.taskId, requestId: expect.stringMatching(/^[a-f0-9]{32}$/), correction: '日期选择器取错了，请修改代码', interfaceId: 'model', updateNodePrompts: false }))
  expect(w.findAll('[data-testid="generation-user-message"]').map(message => message.text())).toEqual(['你日期选择器取错了，请修改代码'])
  expect(w.findAll('[data-testid="generation-agent-reply"]')).toHaveLength(2)
  expect(api.mqCodeJob).toHaveBeenCalledWith('child')
  expect(w.emitted('created')?.[0]?.[0]).toMatchObject({ taskId: 'child' })
  expect(w.emitted('cancel')).toBeUndefined()
  expect(w.get('[data-testid="submit-regeneration"]').attributes('disabled')).toBeDefined()
})
it('同窗口持续更新过程输出，完成后可以基于刚刚的回复继续下一轮修改', async () => {
  vi.useFakeTimers()
  vi.mocked(api.mqCodeJob).mockResolvedValueOnce({ job: { ...job, taskId: 'child', status: 'running', stages: ['开始修改'], output: '正在检查日期', result: null } })
    .mockResolvedValueOnce({ job: { ...job, taskId: 'child', status: 'succeeded', stages: ['开始修改'], output: '日期已经修好', result: { code: 'NEW_CODE', fileName: 'main.py', warnings: [] } } })
  const w = await setup(); await send(w, '修正日期')
  expect(w.get('[data-testid="generation-chat-feed"]').text()).toContain('正在检查日期')
  await vi.advanceTimersByTimeAsync(1500); await flushPromises()
  expect(w.get('[data-testid="generation-chat-feed"]').text()).toContain('日期已经修好')
  expect(api.prepareCodeRegeneration).toHaveBeenLastCalledWith('child')
  vi.mocked(api.regenerateCodeTask).mockResolvedValueOnce({ job: { ...job, taskId: 'second-child', status: 'queued' } })
  await send(w, '再修正去重逻辑')
  expect(api.regenerateCodeTask).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: 'child', correction: '再修正去重逻辑' }))
  expect(w.findAll('[data-testid="generation-agent-reply"]')).toHaveLength(3)
  expect(w.emitted('cancel')).toBeUndefined()
})
it('提交失败保留修改要求，重试沿用请求 ID，不生成重复消息', async () => {
  vi.mocked(api.regenerateCodeTask).mockRejectedValue(new Error('网络超时'))
  const w = await setup(); await send(w, '修正日期')
  expect(w.get('[data-testid="regeneration-error"]').text()).toContain('网络超时')
  expect(input(w, '本次修正要求').props('modelValue')).toBe('修正日期')
  await w.get('form').trigger('submit'); await flushPromises()
  expect(vi.mocked(api.regenerateCodeTask).mock.calls[0]![0].requestId).toBe(vi.mocked(api.regenerateCodeTask).mock.calls[1]![0].requestId)
  expect(w.findAll('[data-testid="generation-user-message"]')).toHaveLength(0)
})
it('已停用的历史智能体不能发送，避免悄悄更换执行接口', async () => {
  vi.mocked(api.modelInterfaces).mockResolvedValue({ items: [], revision: 1 })
  const w = await setup(); await send(w, '继续修改')
  expect(api.regenerateCodeTask).not.toHaveBeenCalled()
  expect(w.text()).toContain('原智能体已停用或不存在')
})
it('设置中仍可选择提示词模板，保留原任务字段 ID 与队列，节点更新需主动勾选', async () => {
  const fields = '【当前节点输出字段】\n输出表：news\n- 字段名：标题；字段 ID：9001\n【输出字段结束】'
  vi.mocked(api.prepareCodeRegeneration).mockResolvedValue({ ...snapshot, generation: { ...snapshot.generation, url: 'https://example.com/news', queueName: 'news_list', userPrompt: `原用户提示词\n\n${fields}` } })
  const template = { promptId: 70, promptName: '网站采集', systemPrompt: '模板系统 {{config_id}}', userPromptTemplate: '{{url}}\n{{output_fields}}\n{{code_file_path}}', isActive: 1 } as NodePromptTemplate
  vi.mocked(nodePromptApi.list).mockResolvedValue([template])
  const w = await setup(); await w.get('[data-testid="regeneration-settings"]').trigger('click'); await flushPromises()
  expect(w.findComponent(ElCheckbox).props('modelValue')).toBe(false)
  w.getComponent({ name: 'PromptTemplatePicker' }).vm.$emit('select', 70); await flushPromises()
  expect(input(w, '重新生成用户提示词').props('modelValue')).toContain(fields)
  w.findComponent(ElCheckbox).vm.$emit('update:modelValue', true)
  await send(w, '按调整后的要求继续修改')
  expect(api.regenerateCodeTask).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: '模板系统 101', updateNodePrompts: true, userPrompt: expect.stringContaining('9001') }))
})
it('默认使用上次实际执行的智能体，关闭窗口停止轮询且不取消后台任务', async () => {
  vi.useFakeTimers()
  vi.mocked(api.prepareCodeRegeneration).mockResolvedValue({ ...snapshot, generation: { ...snapshot.generation, interfaceId: 'all' } })
  const w = await setup({ ...job, result: { ...job.result!, interfaceId: 'model' } }); await send(w, '继续修改')
  expect(api.regenerateCodeTask).toHaveBeenCalledWith(expect.objectContaining({ interfaceId: 'model' }))
  const calls = vi.mocked(api.mqCodeJob).mock.calls.length
  w.unmount(); await vi.advanceTimersByTimeAsync(5000); await flushPromises()
  expect(api.mqCodeJob).toHaveBeenCalledTimes(calls)
})
it('收到其他任务的输出时拒绝展示，保留当前回复并等待重试', async () => {
  vi.mocked(api.mqCodeJob).mockResolvedValue({ job: { ...job, taskId: 'unrelated', output: '别的源的数据' } })
  const w = await setup(); await send(w, '修正代码')
  expect(w.text()).toContain('智能体任务回复不匹配')
  expect(w.get('[data-testid="generation-chat-feed"]').text()).not.toContain('别的源的数据')
})
it('全选智能体提交后显示本轮实际执行的智能体和机器', async () => {
  vi.mocked(api.prepareCodeRegeneration).mockResolvedValue({ ...snapshot, generation: { ...snapshot.generation, interfaceId: 'all' } })
  vi.mocked(api.mqCodeJob).mockResolvedValue({ job: { ...job, taskId: 'child', status: 'running', modelCall: { interfaceId: 'model', name: '本轮 Agent', serverName: '执行机器', serverAddress: '192.168.1.173' } as MqCodeJob['modelCall'] } })
  const w = await setup({ ...job, result: null }); await send(w, '继续修改')
  expect(w.get('.regeneration-heading').text()).toContain('本轮 Agent · 执行机器 · 192.168.1.173')
})
