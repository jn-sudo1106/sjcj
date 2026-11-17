// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { runnerManagementApi } from '@/api/runnerManagement'
import { streamPromptEditChat } from '@/api/modelInterfaceStream'
import PromptAiEditor from './PromptAiEditor.vue'

vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { modelInterfaces: vi.fn() } }))
vi.mock('@/api/modelInterfaceStream', async original => ({ ...await original<typeof import('@/api/modelInterfaceStream')>(), streamPromptEditChat: vi.fn() }))
let wrapper: VueWrapper | undefined
beforeEach(() => {
  vi.mocked(runnerManagementApi.modelInterfaces).mockResolvedValue({ revision: 'r', items: [
    { id: 'agent', kind: 'agent', enabled: true, name: 'Agent' },
    { id: 'chat', kind: 'chat', enabled: true, name: 'WB Chat', runtimeStatus: 'idle' },
    { id: 'disabled', kind: 'chat', enabled: false, name: '停用' },
  ] } as never)
})
afterEach(() => { wrapper?.unmount(); vi.resetAllMocks(); document.body.innerHTML = '' })
async function setup(props: Partial<InstanceType<typeof PromptAiEditor>['$props']> = {}) {
  wrapper = mount(PromptAiEditor, { props: { prompt: '原要求 {{url}}', ...props }, global: { plugins: [ElementPlus], stubs: { RouterLink: true } }, attachTo: document.body })
  await flushPromises(); return wrapper
}
async function ask(text: string) {
  const input = document.querySelector('textarea')!
  input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); await flushPromises()
  ;(document.querySelector('[data-testid="prompt-edit-send"]') as HTMLButtonElement).click(); await flushPromises()
}
it('后台自动选择空闲 Chat 智能体并显示名称，多轮对话保留上下文，确认后才应用完整提示词', async () => {
  vi.mocked(streamPromptEditChat).mockImplementation(async (_, event) => {
    event({ type: 'connecting', durationMs: 0, interfaceId: 'chat', interfaceName: 'WB Chat' })
    event({ type: 'chunk', durationMs: 1, text: JSON.stringify({ reply: '已按要求修改', userPrompt: '只采集当前页 {{url}}' }) })
    event({ type: 'done', durationMs: 2 })
  })
  const w = await setup()
  expect(w.findComponent({ name: 'ElSelect' }).exists()).toBe(false)
  expect(w.find('[aria-label="刷新 Chat 接口"]').exists()).toBe(false)
  expect(runnerManagementApi.modelInterfaces).not.toHaveBeenCalled()
  await ask('不要翻页')
  expect(streamPromptEditChat).toHaveBeenCalledWith(expect.objectContaining({ automatic: true, basePrompt: '原要求 {{url}}', messages: [{ role: 'user', content: '不要翻页' }] }), expect.any(Function), expect.any(AbortSignal))
  expect(document.querySelector('[data-testid="prompt-edit-current-agent"]')!.textContent).toBe('当前对话：WB Chat')
  expect(vi.mocked(streamPromptEditChat).mock.lastCall![0].variableCatalog).toEqual(expect.arrayContaining([
    { name: 'use_proxy', description: expect.any(String) }, { name: 'proxy_url', description: expect.any(String) },
    { name: 'proxy_password', description: expect.any(String) }, { name: 'code_file_path', description: expect.any(String) },
  ]))
  expect(w.emitted('apply')).toBeUndefined()
  expect(document.querySelector('[data-testid="prompt-edit-preview"]')!.textContent).toContain('只采集当前页 {{url}}')
  await ask('保留发布日期')
  const latest = vi.mocked(streamPromptEditChat).mock.lastCall![0]
  expect(latest).toMatchObject({ automatic: true, interfaceId: 'chat' })
  expect(latest.messages.map(message => message.role)).toEqual(['user', 'assistant', 'user'])
  ;(document.querySelector('[data-testid="prompt-edit-apply"]') as HTMLButtonElement).click(); await flushPromises()
  expect(w.emitted('apply')).toEqual([['只采集当前页 {{url}}']])
})
it('接口失败或缺少变量时不能替换原提示词，关闭会中止未完成请求', async () => {
  vi.mocked(streamPromptEditChat).mockImplementation(async (_, event) => {
    event({ type: 'chunk', durationMs: 1, text: JSON.stringify({ reply: '已修改', userPrompt: '遗漏变量' }) })
  })
  const w = await setup(); await ask('调整要求')
  expect(document.body.textContent).toContain('遗漏了变量')
  expect((document.querySelector('[data-testid="prompt-edit-apply"]') as HTMLButtonElement).disabled).toBe(true)
  expect(w.emitted('apply')).toBeUndefined()
  vi.mocked(streamPromptEditChat).mockRejectedValueOnce(new Error('Chat 连接失败'))
  await ask('继续修改'); expect(document.body.textContent).toContain('Chat 连接失败')
})
it('内嵌系统提示词编辑使用系统类型，应用后下一轮以新内容为基础', async () => {
  vi.mocked(streamPromptEditChat).mockImplementation(async (_, event) => {
    event({ type: 'chunk', durationMs: 1, text: JSON.stringify({ reply: '已修改', userPrompt: '系统约束 {{url}}' }) })
  })
  const w = await setup({ embedded: true, promptType: 'system' })
  expect(w.findComponent({ name: 'ElDrawer' }).exists()).toBe(false)
  await ask('禁止输出待验证的代码')
  expect(streamPromptEditChat).toHaveBeenLastCalledWith(expect.objectContaining({ promptType: 'system', basePrompt: '原要求 {{url}}' }), expect.any(Function), expect.any(AbortSignal))
  await w.get('[data-testid="prompt-edit-apply"]').trigger('click')
  await w.setProps({ prompt: '系统约束 {{url}}' })
  expect(w.emitted('apply')).toEqual([['系统约束 {{url}}']])
  await ask('继续细化约束')
  expect(vi.mocked(streamPromptEditChat).mock.lastCall![0]).toMatchObject({ basePrompt: '系统约束 {{url}}', messages: [{ role: 'user', content: '继续细化约束' }] })
})
it('模板加载时同步最新草稿，对话中外部修改则中止并要求重新开始', async () => {
  const w = await setup({ embedded: true, promptType: 'user' })
  await w.setProps({ prompt: '模板加载后的提示词 {{url}}' })
  let finish!: () => void
  vi.mocked(streamPromptEditChat).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await ask('调整字段要求')
  const call = vi.mocked(streamPromptEditChat).mock.lastCall!
  expect(call[0].basePrompt).toBe('模板加载后的提示词 {{url}}')
  await w.setProps({ prompt: '新模板 {{url}}' })
  expect(call[2]?.aborted).toBe(true)
  finish(); await flushPromises()
  expect(w.text()).toContain('使用最新内容重新对话')
  expect(w.get('[data-testid="prompt-edit-apply"]').attributes('disabled')).toBeDefined()
  await w.findAll('button').find(button => button.text() === '使用最新提示词重新对话')!.trigger('click')
  await ask('修改新模板')
  expect(vi.mocked(streamPromptEditChat).mock.lastCall![0].basePrompt).toBe('新模板 {{url}}')
})
