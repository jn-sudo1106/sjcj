// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessage } from 'element-plus'
import { copyToClipboard } from '@/utils/clipboard'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi, type ModelInterfaceSettings } from '@/api/runnerManagement'
import ModelInterfacesTab from './ModelInterfacesTab.vue'
vi.mock('@/utils/clipboard', () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }))

const fixture: ModelInterfaceSettings = { revision: 3, items: [{ id: 'legacy', name: '默认模型', kind: 'chat', model: 'hy3',
  endpoint: 'http://localhost/chat', enabled: true, isDefault: true, stream: true, timeoutSeconds: 300,
  inputFileDir: '', codeDir: '', outputFileDir: '' }] }
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => {
  vi.spyOn(runnerManagementApi, 'codeGenerationServers').mockResolvedValue({ items: [] })
  vi.spyOn(runnerManagementApi, 'modelInterfaces').mockResolvedValue(structuredClone(fixture))
  vi.spyOn(runnerManagementApi, 'saveModelInterfaces').mockImplementation(async input => ({ ...input, revision: input.revision + 1 }))
  vi.spyOn(runnerManagementApi, 'saveModelTestPrompts').mockImplementation(async input => ({
    revision: input.revision + 1, items: fixture.items.map(row => row.id === input.interfaceId
      ? { ...row, testSystemPrompt: input.systemPrompt, testUserPrompt: input.userPrompt } : { ...row }),
  }))
  vi.spyOn(runnerManagementApi, 'streamModelInterfaceTest').mockImplementation(async (_input, emit) => {
    emit({ type: 'headers', ok: true, status: 200, contentType: 'text/plain', durationMs: 10 })
    emit({ type: 'chunk', text: '约300公里', durationMs: 50 }); emit({ type: 'done', durationMs: 100 })
  })
})
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = '' })
async function setup(role = 'admin') {
  const pinia = createPinia(); setActivePinia(pinia); useAuthStore().roles = [role]
  const w = mount(ModelInterfacesTab, { attachTo: document.body, global: { plugins: [pinia, ElementPlus] } })
  wrappers.push(w); await flushPromises(); return w
}
it('新建接口保留已有配置并带乐观锁保存', async () => {
  const w = await setup()
  await w.get('[data-testid="model-add"]').trigger('click'); await flushPromises()
  const input = document.querySelector<HTMLInputElement>('input[data-testid="model-name"], [data-testid="model-name"] input')!
  input.value = '新 Chat 接口'; input.dispatchEvent(new Event('input')); await flushPromises()
  document.querySelector<HTMLButtonElement>('[data-testid="model-save"]')!.click(); await flushPromises()
  expect(runnerManagementApi.saveModelInterfaces).toHaveBeenCalledWith({ revision: 3, items: [fixture.items[0], expect.objectContaining({ name: '新 Chat 接口', kind: 'chat', model: 'hy3', isDefault: false })] })
})
it('复制配置生成新接口草稿，保留目录和提示词且不继承默认项', async () => {
  const source = { ...fixture.items[0]!, prjDir: 'D:\\workspace', title: '任务标题',
    testSystemPrompt: '已保存系统提示词', testUserPrompt: '已保存用户提示词' }
  vi.mocked(runnerManagementApi.modelInterfaces).mockResolvedValue({ revision: 3, items: [source,
    { ...fixture.items[0]!, id: 'copy-existing', name: '默认模型 - 副本', isDefault: false }] })
  const w = await setup()
  await w.get('[data-testid="model-duplicate-legacy"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveModelInterfaces).not.toHaveBeenCalled()
  const input = document.querySelector<HTMLInputElement>('input[data-testid="model-name"], [data-testid="model-name"] input')!
  expect(input.value).toBe('默认模型 - 副本2')
  document.querySelector<HTMLButtonElement>('[data-testid="model-save"]')!.click(); await flushPromises()
  const request = vi.mocked(runnerManagementApi.saveModelInterfaces).mock.calls[0]![0]
  expect(request.items[0]).toEqual(source)
  expect(request.items.at(-1)).toMatchObject({ id: '', name: '默认模型 - 副本2', isDefault: false,
    endpoint: source.endpoint, model: source.model, prjDir: source.prjDir,
    testSystemPrompt: source.testSystemPrompt, testUserPrompt: source.testUserPrompt })
  const read = await setup('read')
  expect(read.find('[data-testid="model-duplicate-legacy"]').exists()).toBe(false)
})
it('只读用户不能新增；加载失败显示真实错误并可刷新', async () => {
  const read = await setup('read')
  expect(read.find('[data-testid="model-add"]').exists()).toBe(false)
  vi.mocked(runnerManagementApi.modelInterfaces).mockRejectedValueOnce(new Error('服务暂不可用'))
  const failed = await setup()
  expect(failed.text()).toContain('服务暂不可用')
  await failed.findAll('button').find(button => button.text() === '刷新')!.trigger('click'); await flushPromises()
  expect(failed.text()).not.toContain('服务暂不可用')
})
it('Agent 复制和测试使用 POST JSON，保留工作空间、文件路径与中文', async () => {
  const agent = { ...fixture.items[0]!, name: 'Agent 模型', kind: 'agent' as const, endpoint: 'http://192.168.1.171:6000/workbuudy/agent',
    prjDir: 'D:\\aicode', inputFileDir: 'G:\\pythonProject\\frida\\client.py', codeDir: 'D:\\aicode\\code', outputFileDir: 'D:\\aicode\\output' }
  vi.mocked(runnerManagementApi.modelInterfaces).mockResolvedValue({ revision: 3, items: [agent] })
  const w = await setup('read')
  await w.findAll('button').find(button => button.text() === '复制请求')!.trigger('click'); await flushPromises()
  expect(copyToClipboard).toHaveBeenCalledWith(expect.stringContaining('POST '), 'HTTP 请求')
  expect(document.querySelector('[data-testid="model-sample-request"]')).toBeNull()
  await w.findAll('button').find(button => button.text() === '测试')!.trigger('click'); await flushPromises()
  const requestText = () => document.querySelector('[data-testid="model-sample-request"]')!.textContent!
  expect(requestText()).toMatch(/^POST http:\/\//)
  expect(requestText()).toContain('Content-Type: application/json; charset=utf-8')
  expect(requestText()).toContain('帮我采集')
  expect(requestText()).not.toContain('%E5')
  let body = JSON.parse(requestText().split('\n\n')[1]!)
  expect(body.prj_dir).toBe(`${agent.prjDir}\\legacy`)
  expect(body.code_dir).toBe('D:\\aicode\\legacy\\code')
  expect(body.output_file_dir).toBe(body.code_dir.replace(/code$/, 'output'))
  expect(body.input_file_dir).toBe(body.code_dir.replace(/code$/, 'input'))
  expect(body.model).toBe('hy3')
  expect(body.cdp_port).toBe(9223)
  const port = document.querySelector<HTMLInputElement>('[data-testid="model-test-cdp-port"] input')!
  port.value = '9333'; port.dispatchEvent(new Event('input')); port.dispatchEvent(new Event('change')); await flushPromises()
  expect(JSON.parse(requestText().split('\n\n')[1]!).cdp_port).toBe(9333)
  const system = document.querySelector<HTMLTextAreaElement>('textarea[data-testid="model-test-system-prompt"], [data-testid="model-test-system-prompt"] textarea')!
  system.value = '只提取标题和时间'; system.dispatchEvent(new Event('input')); await flushPromises()
  const prompt = document.querySelector<HTMLTextAreaElement>('textarea[data-testid="model-sample-prompt"], [data-testid="model-sample-prompt"] textarea')!
  prompt.value = '新闻 & 公告 + 特殊字符'; prompt.dispatchEvent(new Event('input')); await flushPromises()
  body = JSON.parse(requestText().split('\n\n')[1]!)
  expect(body.prompt).toBe(`系统要求：\n只提取标题和时间\n\n用户要求：\n${prompt.value}`)
  document.querySelector<HTMLButtonElement>('[data-testid="model-copy-request"]')!.click(); await flushPromises()
  expect(copyToClipboard).toHaveBeenCalledWith(requestText(), 'HTTP 请求')
  expect(runnerManagementApi.saveModelInterfaces).not.toHaveBeenCalled()
})
it('WB Agent 端口随编辑保存，测试可临时覆盖', async () => {
  const agent = { ...fixture.items[0]!, kind: 'agent' as const, cdpPort: 9333,
    prjDir: 'D:\\aicode', codeDir: 'D:\\aicode\\code', outputFileDir: 'D:\\aicode\\output' }
  vi.mocked(runnerManagementApi.modelInterfaces).mockResolvedValue({ revision: 3, items: [agent] })
  const w = await setup()
  await w.findAll('button').find(button => button.text() === '编辑')!.trigger('click'); await flushPromises()
  const input = document.querySelector<HTMLInputElement>('[data-testid="model-cdp-port"] input')!
  input.value = '9444'; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change')); await flushPromises()
  document.querySelector<HTMLButtonElement>('[data-testid="model-save"]')!.click(); await flushPromises()
  expect(vi.mocked(runnerManagementApi.saveModelInterfaces).mock.calls[0]![0].items[0]!.cdpPort).toBe(9444)
  await w.findAll('button').find(button => button.text() === '测试')!.trigger('click'); await flushPromises()
  const port = document.querySelector<HTMLInputElement>('[data-testid="model-test-cdp-port"] input')!
  port.value = '9555'; port.dispatchEvent(new Event('input')); port.dispatchEvent(new Event('change')); await flushPromises()
  document.querySelector<HTMLButtonElement>('[data-testid="model-send-test"]')!.click(); await flushPromises()
  expect(runnerManagementApi.streamModelInterfaceTest).toHaveBeenCalledWith(expect.objectContaining({ cdpPort: 9555 }), expect.any(Function), expect.any(AbortSignal))
  const first = vi.mocked(runnerManagementApi.streamModelInterfaceTest).mock.calls.at(-1)![0]
  expect(first.codeDir).toBe('D:\\aicode\\legacy\\code')
  document.querySelector<HTMLButtonElement>('[data-testid="model-send-test"]')!.click(); await flushPromises()
  const second = vi.mocked(runnerManagementApi.streamModelInterfaceTest).mock.calls.at(-1)![0]
  expect(second.taskId).not.toBe(first.taskId)
  expect(second.codeDir).toBe(first.codeDir)
})
it('编辑移除样例；测试弹窗使用独立参数发送并展示结果，不修改接口配置', async () => {
  const w = await setup()
  await w.get('[data-testid="model-add"]').trigger('click'); await flushPromises()
  expect(document.querySelector('[data-testid="model-sample-request"]')).toBeNull()
  const closes = [...document.querySelectorAll<HTMLButtonElement>('.el-drawer button')].filter(button => button.textContent === '关闭')
  closes[0]!.click(); await flushPromises()
  await w.findAll('button').find(button => button.text() === '测试')!.trigger('click'); await flushPromises()
  const requestText = () => document.querySelector('[data-testid="model-sample-request"]')!.textContent!
  const url = new URL(requestText())
  expect(url.searchParams.get('prompt')).toBe('南京到上海的距离')
  expect(url.searchParams.get('stream')).toBe('1')
  const model = document.querySelector<HTMLInputElement>('input[data-testid="model-test-model"], [data-testid="model-test-model"] input')!
  model.value = 'test-model'; model.dispatchEvent(new Event('input')); await flushPromises()
  const system = document.querySelector<HTMLTextAreaElement>('textarea[data-testid="model-test-system-prompt"], [data-testid="model-test-system-prompt"] textarea')!
  system.value = '请简短回答'; system.dispatchEvent(new Event('input')); await flushPromises()
  expect(new URL(requestText()).searchParams.get('prompt')).toBe('系统要求：\n请简短回答\n\n用户要求：\n南京到上海的距离')
  document.querySelector<HTMLButtonElement>('[data-testid="model-send-test"]')!.click(); await flushPromises()
  expect(runnerManagementApi.streamModelInterfaceTest).toHaveBeenCalledWith(expect.objectContaining({ interfaceId: 'legacy', model: 'test-model', prompt: '南京到上海的距离', systemPrompt: '请简短回答' }), expect.any(Function), expect.any(AbortSignal))
  expect(document.querySelector('[data-testid="model-test-response"]')!.textContent).toContain('约300公里')
  expect(runnerManagementApi.saveModelInterfaces).not.toHaveBeenCalled()
})
it('现有服务列表直接复制完整 POST 请求，测试失败原样显示', async () => {
  vi.mocked(runnerManagementApi.modelInterfaces).mockResolvedValue({ ...fixture, items: [{ ...fixture.items[0]!, kind: 'site-script', endpoint: 'http://127.0.0.1:8091/api/ai/site-script/generate' }] })
  vi.mocked(runnerManagementApi.streamModelInterfaceTest).mockRejectedValue(new Error('连接失败'))
  const w = await setup()
  await w.findAll('button').find(button => button.text() === '复制请求')!.trigger('click'); await flushPromises()
  const copied = vi.mocked(copyToClipboard).mock.calls.at(-1)![0]
  expect(copied).toMatch(/^POST http:\/\/127\.0\.0\.1:8091/)
  expect(JSON.parse(copied.split('\n\n')[1]!).sampleId).toBe('www.realcan.cn.py')
  await w.findAll('button').find(button => button.text() === '测试')!.trigger('click'); await flushPromises()
  document.querySelector<HTMLButtonElement>('[data-testid="model-send-test"]')!.click(); await flushPromises()
  expect(document.body.textContent).toContain('连接失败')
})
it('测试未结束时实时显示内容，停止等待后保留已收到的输出', async () => {
  vi.mocked(runnerManagementApi.streamModelInterfaceTest).mockImplementation((_input, emit, signal) => new Promise((_resolve, reject) => {
    emit({ type: 'headers', status: 200, ok: true, contentType: 'text/plain', durationMs: 1 })
    emit({ type: 'chunk', text: '第一段输出', durationMs: 2 })
    signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  }))
  const w = await setup()
  await w.findAll('button').find(button => button.text() === '测试')!.trigger('click'); await flushPromises()
  document.querySelector<HTMLButtonElement>('[data-testid="model-send-test"]')!.click(); await flushPromises()
  expect(document.querySelector('[data-testid="model-test-response"]')!.textContent).toContain('第一段输出')
  document.querySelector<HTMLButtonElement>('[data-testid="model-stop-test"]')!.click(); await flushPromises()
  expect(document.body.textContent).toContain('已停止等待')
  expect(document.querySelector('[data-testid="model-test-response"]')!.textContent).toContain('第一段输出')
})
it('保存当前接口两种提示词，重新打开自动恢复且列表复制也使用保存内容', async () => {
  const w = await setup()
  await w.findAll('button').find(button => button.text() === '测试')!.trigger('click'); await flushPromises()
  const input = (name: string) => document.querySelector<HTMLTextAreaElement>(`textarea[data-testid="${name}"], [data-testid="${name}"] textarea`)!
  const system = input('model-test-system-prompt'), user = input('model-sample-prompt')
  system.value = '系统：请简短回答'; system.dispatchEvent(new Event('input'))
  user.value = '用户：上海到杭州的距离'; user.dispatchEvent(new Event('input')); await flushPromises()
  const close = [...document.querySelectorAll<HTMLButtonElement>('.el-dialog button')].find(button => button.textContent === '关闭')!
  close.click(); await flushPromises()
  expect(runnerManagementApi.saveModelTestPrompts).toHaveBeenCalledWith({ interfaceId: 'legacy', revision: 3, systemPrompt: system.value, userPrompt: user.value })
  expect(runnerManagementApi.streamModelInterfaceTest).not.toHaveBeenCalled()
  await w.findAll('button').find(button => button.text() === '测试')!.trigger('click'); await flushPromises()
  expect(input('model-test-system-prompt').value).toBe('系统：请简短回答')
  expect(input('model-sample-prompt').value).toBe('用户：上海到杭州的距离')
  close.click(); await flushPromises()
  await w.findAll('button').find(button => button.text() === '复制地址')!.trigger('click'); await flushPromises()
  const address = vi.mocked(copyToClipboard).mock.calls.at(-1)![0]
  expect(new URL(address).searchParams.get('prompt')).toContain('用户：上海到杭州的距离')
})
it('提示词保存失败保留当前编辑内容', async () => {
  vi.mocked(runnerManagementApi.saveModelTestPrompts).mockRejectedValue(new Error('配置已更新，请刷新'))
  const w = await setup()
  await w.findAll('button').find(button => button.text() === '测试')!.trigger('click'); await flushPromises()
  const input = document.querySelector<HTMLTextAreaElement>('textarea[data-testid="model-sample-prompt"], [data-testid="model-sample-prompt"] textarea')!
  input.value = '尚未保存的新内容'; input.dispatchEvent(new Event('input')); await flushPromises()
  const close = [...document.querySelectorAll<HTMLButtonElement>('.el-dialog button')].find(button => button.textContent === '关闭')!
  close.click(); await flushPromises()
  expect(document.body.textContent).toContain('配置已更新，请刷新')
  expect(input.value).toBe('尚未保存的新内容')
})
it('Gemini Agent 无需模型标识，复制和测试携带 title 及目录', async () => {
  vi.mocked(runnerManagementApi.modelInterfaces).mockResolvedValue({ revision: 1, items: [{ ...fixture.items[0]!,
    id: 'gemini', name: 'Gemini Agent', kind: 'gemini-agent', model: '', title: '代码优化测试',
    endpoint: 'http://127.0.0.1:6000/gemini/agent', prjDir: 'D:\\aicode', codeDir: 'D:\\aicode\\code', outputFileDir: 'D:\\aicode\\output' }] })
  const w = await setup()
  await w.findAll('button').find(button => button.text() === '复制请求')!.trigger('click'); await flushPromises()
  const body = JSON.parse(vi.mocked(copyToClipboard).mock.calls.at(-1)![0].split('\n\n')[1]!)
  expect(body.title).toBe('代码优化测试'); expect(body).not.toHaveProperty('model')
  await w.findAll('button').find(button => button.text() === '测试')!.trigger('click'); await flushPromises()
  expect(document.querySelector('[data-testid="model-test-title"]')).not.toBeNull()
  document.querySelector<HTMLButtonElement>('[data-testid="model-send-test"]')!.click(); await flushPromises()
  expect(runnerManagementApi.streamModelInterfaceTest).toHaveBeenCalledWith(expect.objectContaining({ interfaceId: 'gemini', title: '代码优化测试' }), expect.any(Function), expect.any(AbortSignal))
})
it('列表可直接停用和启用接口，保存失败保持原状态', async () => {
  vi.mocked(runnerManagementApi.modelInterfaces).mockResolvedValue({ revision: 3, items: [fixture.items[0]!,
    { ...fixture.items[0]!, id: 'alternate', name: '备用模型', isDefault: false }] })
  const w = await setup()
  const toggle = () => w.get('[data-testid="model-toggle-alternate"]')
  await toggle().trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveModelInterfaces).toHaveBeenCalledWith(expect.objectContaining({ revision: 3,
    items: [fixture.items[0], expect.objectContaining({ id: 'alternate', enabled: false })] }))
  expect(toggle().classes()).not.toContain('is-checked')
  await toggle().trigger('click'); await flushPromises()
  expect(toggle().classes()).toContain('is-checked')
  vi.mocked(runnerManagementApi.saveModelInterfaces).mockRejectedValueOnce(new Error('保存失败'))
  await toggle().trigger('click'); await flushPromises()
  expect(toggle().classes()).toContain('is-checked')
  expect(w.text()).toContain('保存失败')
})
it('Gemini Chat 复制与测试使用 POST JSON，只带 prompt 与 model', async () => {
  vi.mocked(runnerManagementApi.modelInterfaces).mockResolvedValue({ revision: 1, items: [{ ...fixture.items[0]!,
    id: 'gemini-chat', name: 'Gemini Chat', kind: 'gemini-chat', model: 'gemini-3.5-flash-lite',
    endpoint: 'http://127.0.0.1:6000/gemini/chat', testUserPrompt: '帮我写个瑟比夫循环？' }] })
  const w = await setup()
  await w.findAll('button').find(button => button.text() === '复制请求')!.trigger('click'); await flushPromises()
  const copied = vi.mocked(copyToClipboard).mock.calls.at(-1)![0]
  expect(copied).toMatch(/^POST http:\/\/127\.0\.0\.1:6000\/gemini\/chat/)
  expect(JSON.parse(copied.split('\n\n')[1]!)).toEqual({ prompt: '帮我写个瑟比夫循环？', model: 'gemini-3.5-flash-lite' })
  await w.findAll('button').find(button => button.text() === '测试')!.trigger('click'); await flushPromises()
  document.querySelector<HTMLButtonElement>('[data-testid="model-send-test"]')!.click(); await flushPromises()
  expect(runnerManagementApi.streamModelInterfaceTest).toHaveBeenCalledWith(expect.objectContaining({ interfaceId: 'gemini-chat', model: 'gemini-3.5-flash-lite' }), expect.any(Function), expect.any(AbortSignal))
})
it('模型返回的转义 JSON 在输出与复制结果中显示为中文正文', async () => {
  vi.mocked(runnerManagementApi.streamModelInterfaceTest).mockImplementation(async (_input, emit) => {
    emit({ type: 'headers', ok: true, status: 200, contentType: 'application/json', durationMs: 1 })
    emit({ type: 'chunk', text: '{"model":"gemini","reply":"\\u4f60\\u597d\\n第二行","status":"success"}', durationMs: 2 })
    emit({ type: 'done', durationMs: 3 })
  })
  const w = await setup()
  await w.findAll('button').find(button => button.text() === '测试')!.trigger('click'); await flushPromises()
  document.querySelector<HTMLButtonElement>('[data-testid="model-send-test"]')!.click(); await flushPromises()
  const output = document.querySelector('[data-testid="model-test-response"]')!
  expect(output.textContent).toContain('你好')
  expect(output.textContent).toContain('第二行')
  expect(output.querySelector('br')).not.toBeNull()
  const copy = [...document.querySelectorAll<HTMLButtonElement>('.el-dialog button')].find(button => button.textContent === '复制结果')!
  copy.click(); await flushPromises()
  expect(copyToClipboard).toHaveBeenCalledWith('你好\n第二行', '响应内容')
})
it('默认接口提示先更换默认项，只读用户不可切换', async () => {
  const warning = vi.spyOn(ElMessage, 'warning')
  const w = await setup()
  await w.get('[data-testid="model-toggle-legacy"]').trigger('click'); await flushPromises()
  expect(warning).toHaveBeenCalledWith('请先将其他启用的接口设为默认，再停用此接口')
  expect(runnerManagementApi.saveModelInterfaces).not.toHaveBeenCalled()
  const read = await setup('read')
  expect(read.get('[data-testid="model-toggle-legacy"]').classes()).toContain('is-disabled')
})
it('输入停止700ms自动保存，无需点击保存按钮', async () => {
  const w = await setup()
  await w.findAll('button').find(button => button.text() === '测试')!.trigger('click'); await flushPromises()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const system = document.querySelector<HTMLTextAreaElement>('textarea[data-testid="model-test-system-prompt"], [data-testid="model-test-system-prompt"] textarea')!
  system.value = '必须保留的系统提示词'; system.dispatchEvent(new Event('input')); await flushPromises()
  expect(document.querySelector('[data-testid="model-prompt-save-state"]')!.textContent).toBe('等待自动保存…')
  expect(document.querySelector('[data-testid="model-save-test-prompts"]')).toBeNull()
  expect(runnerManagementApi.saveModelTestPrompts).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(750); await flushPromises()
  expect(runnerManagementApi.saveModelTestPrompts).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: '必须保留的系统提示词' }))
  expect(document.querySelector('[data-testid="model-prompt-save-state"]')!.textContent).toBe('已保存')
})
it('保存过程中继续输入，按顺序补存最新内容再关闭', async () => {
  const w = await setup()
  await w.findAll('button').find(button => button.text() === '测试')!.trigger('click'); await flushPromises()
  let finishFirst!: (value: ModelInterfaceSettings) => void
  vi.mocked(runnerManagementApi.saveModelTestPrompts).mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve }))
  const system = document.querySelector<HTMLTextAreaElement>('textarea[data-testid="model-test-system-prompt"], [data-testid="model-test-system-prompt"] textarea')!
  system.value = '第一版'; system.dispatchEvent(new Event('input')); await flushPromises()
  const close = [...document.querySelectorAll<HTMLButtonElement>('.el-dialog button')].find(button => button.textContent === '关闭')!
  close.click(); await flushPromises()
  system.value = '继续输入的最新版'; system.dispatchEvent(new Event('input')); await flushPromises()
  finishFirst({ revision: 4, items: [{ ...fixture.items[0]!, testSystemPrompt: '第一版', testUserPrompt: '南京到上海的距离' }] }); await flushPromises()
  expect(runnerManagementApi.saveModelTestPrompts).toHaveBeenCalledTimes(2)
  expect(vi.mocked(runnerManagementApi.saveModelTestPrompts).mock.calls[1]![0]).toMatchObject({ revision: 4, systemPrompt: '继续输入的最新版' })
})
