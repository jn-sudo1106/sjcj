// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import RuleWorkbenchDialog from './RuleWorkbenchDialog.vue'
import ElementPlus, { ElMessageBox } from 'element-plus'
import PromptTemplatePicker from './PromptTemplatePicker.vue'
import { fetchPromptList } from '@/api/prompt'
import { nodePromptApi } from '@/api/nodePrompts'
vi.mock('@/api/nodePrompts', () => ({ nodePromptApi: { selection: vi.fn(), select: vi.fn(), list: vi.fn() } }))
vi.mock('@/api/prompt', () => ({ fetchPromptList: vi.fn() }))
vi.mock('@/api', () => ({ fetchModelProviders: vi.fn().mockResolvedValue([]), fetchDefaultModels: vi.fn().mockResolvedValue([]) }))
const choices = [
  { promptId: 1, promptName: '新闻抓取', nodeType: '90', nodeTypeName: '网页抓取', category: 'collect', systemPrompt: '新闻 {{describe}}', isActive: 1, isDefault: 1 },
  { promptId: 2, promptName: '公告抓取', nodeType: '90', nodeTypeName: '网页抓取', category: 'collect', systemPrompt: '公告 {{describe}}', userPromptTemplate: '字段 {{output_fields}}', isActive: 1, isDefault: 0 },
]
beforeEach(() => {
  vi.stubEnv('VITE_FLOW_PROXY_TARGET', 'http://127.0.0.1:8090')
  vi.mocked(fetchPromptList).mockResolvedValue(choices)
  vi.mocked(nodePromptApi.list).mockResolvedValue([])
  vi.mocked(nodePromptApi.selection).mockResolvedValue({ promptTemplateId: 2 })
  vi.mocked(nodePromptApi.select).mockImplementation(async (_id, promptTemplateId) => ({ promptTemplateId }))
})
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllEnvs() })
function setup(preservePrompt = true, promptTemplateId = 2) {
  return mount(RuleWorkbenchDialog, { props: { open: false, title: '生成配置', scriptLabel: '配置', systemPrompt: '节点专属提示词', preservePrompt, promptTemplateId,
    promptCategory: '网页抓取', promptListCategory: 'collect', promptCategoryGroups: [], inputFields: [], outputFields: ['title'], inputFieldOptions: [], outputFieldOptions: [{ itemCode: 'title', itemName: '标题' }],
    script: '', generateLabel: '生成', saveLabel: '保存', generating: false, saving: false, isRule: false, canTest: false, describe: '当前需求', describeLabel: '需求', hidePromptByDefault: false },
    global: { plugins: [ElementPlus], stubs: { ElDialog: { template: '<div><slot /><slot name="footer" /></div>' } } } })
}
it('重新打开保留当前节点提示词和选择，仍可列出其他命名提示词', async () => {
  const w = setup()
  await w.setProps({ open: true }); await flushPromises()
  const picker = w.getComponent(PromptTemplatePicker)
  expect(picker.props('modelValue')).toBe(2)
  expect(picker.props('items')).toHaveLength(2)
  expect(w.emitted('update:systemPrompt')).toBeUndefined()
  picker.vm.$emit('select', 1); await flushPromises()
  expect(w.emitted('update:promptTemplateId')?.at(-1)).toEqual([1])
  expect(w.emitted('update:systemPrompt')?.at(-1)).toEqual(['新闻 当前需求'])
  w.unmount()
})
it('选择指定提示词应用系统及用户内容，生成事件带上选择 ID', async () => {
  const w = setup(false, 0); await w.setProps({ open: true }); await flushPromises()
  expect(w.emitted('update:promptTemplateId')?.at(-1)).toEqual([1])
  w.getComponent(PromptTemplatePicker).vm.$emit('select', 2); await flushPromises()
  expect(w.emitted('update:systemPrompt')?.at(-1)).toEqual(['公告 当前需求\n\n字段 title'])
  await w.findAll('button').find(b => b.text() === '生成')!.trigger('click')
  expect(w.emitted('generate')?.at(-1)?.[0]).toEqual(expect.objectContaining({ promptTemplateId: 2, systemPrompt: '公告 当前需求\n\n字段 title' }))
  w.unmount()
})
it('不可用的选择不换成默认项；手工修改后切换可取消', async () => {
  const unavailable = setup(false, 99); await unavailable.setProps({ open: true }); await flushPromises()
  expect(unavailable.getComponent(PromptTemplatePicker).props('modelValue')).toBe(99)
  expect(unavailable.emitted('update:systemPrompt')).toBeUndefined()
  unavailable.unmount()
  const w = setup(); await w.setProps({ open: true }); await flushPromises()
  await w.findAll('textarea').find(t => (t.element as HTMLTextAreaElement).value === '节点专属提示词')!.setValue('未保存的修改')
  vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel')
  w.getComponent(PromptTemplatePicker).vm.$emit('select', 1); await flushPromises()
  expect(w.getComponent(PromptTemplatePicker).props('modelValue')).toBe(2)
  expect(w.emitted('update:promptTemplateId')).toBeUndefined()
  w.unmount()
})
it('从节点配置恢复选择，并在切换时持久化；保存失败不改变当前选择', async () => {
  const w = setup(true, 0); await w.setProps({ configId: '1401081', open: true }); await flushPromises()
  expect(nodePromptApi.selection).toHaveBeenCalledWith('1401081')
  expect(w.getComponent(PromptTemplatePicker).props('modelValue')).toBe(2)
  w.getComponent(PromptTemplatePicker).vm.$emit('select', 1); await flushPromises()
  expect(nodePromptApi.select).toHaveBeenCalledWith('1401081', 1)
  vi.mocked(nodePromptApi.select).mockRejectedValueOnce(new Error('保存失败'))
  w.getComponent(PromptTemplatePicker).vm.$emit('select', 2); await flushPromises()
  expect(w.getComponent(PromptTemplatePicker).props('modelValue')).toBe(1)
  expect(w.text()).toContain('保存提示词选择失败')
  w.unmount()
})
it('读取选择失败时仍加载提示词模板', async () => {
  vi.mocked(nodePromptApi.selection).mockRejectedValue(new Error('请求失败 500'))
  const w = setup(false, 0); await w.setProps({ configId: '1401081', open: true }); await flushPromises()
  expect(w.emitted('update:systemPrompt')?.at(-1)).toEqual(['新闻 当前需求'])
  expect(w.text()).not.toContain('提示词模板加载失败')
  w.unmount()
})
it('业务后端环境（无节点提示词接口）不读写选择，保存和生成不被拦住', async () => {
  vi.stubEnv('VITE_FLOW_PROXY_TARGET', '')
  const w = setup(false, 0); await w.setProps({ configId: '1401081', open: true }); await flushPromises()
  expect(w.emitted('update:systemPrompt')?.at(-1)).toEqual(['新闻 当前需求'])
  await w.findAll('button').find(b => b.text() === '保存')!.trigger('click'); await flushPromises()
  await w.findAll('button').find(b => b.text() === '生成')!.trigger('click'); await flushPromises()
  expect(nodePromptApi.selection).not.toHaveBeenCalled()
  expect(nodePromptApi.select).not.toHaveBeenCalled()
  expect(w.emitted('prompt-saved')).toBeTruthy()
  expect(w.emitted('generate')).toBeTruthy()
  w.unmount()
})
it('配置已明确选择自定义时，不会重新套用默认提示词', async () => {
  vi.mocked(nodePromptApi.selection).mockResolvedValue({ promptTemplateId: 0, hasSelection: true })
  const w = setup(false, 0); await w.setProps({ configId: '1401081', open: true }); await flushPromises()
  expect(w.getComponent(PromptTemplatePicker).props('modelValue')).toBe(0)
  expect(w.emitted('update:systemPrompt')).toBeUndefined()
  w.unmount()
})

// 2026-11-25：左栏「规则处理描述」原为只读，但工作台里的「生成脚本」要求它非空，
// 用户在弹窗里看到「请先填写规则处理描述」却无处可填。改成可编辑并回写父组件。
it('规则处理描述可在工作台里直接编辑并回写', async () => {
  const w = setup(false, 0)
  await w.setProps({ isRule: true, hidePromptByDefault: true, describe: '', describeLabel: '规则处理描述', open: true })
  await flushPromises()
  const box = w.get('[data-testid="wb-describe"]')
  expect((box.element as HTMLTextAreaElement).readOnly).toBe(false)
  await box.setValue('把入参里的发布时间转成 yyyy-MM-dd，并丢掉三天前的记录')
  expect(w.emitted('update:describe')?.at(-1)).toEqual(['把入参里的发布时间转成 yyyy-MM-dd，并丢掉三天前的记录'])
  w.unmount()
})

// 2026-11-25 生产实测：规则处理在提示词表里有两行——prompt 1（node_type='rule_processing'，9 月）
// 与 prompt 74（node_type='600'，11-23 用户在系统设置里维护的那条）。只取列表第一条会命中老模板。
it('同名多模板时优先取与本节点类型编号一致的那条', async () => {
  vi.mocked(nodePromptApi.selection).mockResolvedValue(null as never)
  vi.mocked(fetchPromptList).mockResolvedValue([
    { promptId: 1, promptName: '规则处理配置提示词 1', nodeType: 'rule_processing', nodeTypeName: '规则处理', category: 'rule', systemPrompt: '老模板 {{describe}}', isActive: 1, isDefault: 1 },
    { promptId: 74, promptName: '规则处理-字段转换脚本', nodeType: '600', nodeTypeName: '规则处理', category: 'rule', systemPrompt: '新模板 {{describe}}', isActive: 1, isDefault: 1 },
  ])
  const w = setup(false, 0)
  await w.setProps({ isRule: true, hidePromptByDefault: true, promptListCategory: 'rule', promptCategory: '规则处理', describeLabel: '规则处理描述', nodeTypeCode: '600', open: true })
  await flushPromises()
  expect(w.emitted('update:promptTemplateId')?.at(-1)).toEqual([74])
  expect(w.emitted('update:systemPrompt')?.at(-1)).toEqual(['新模板 当前需求'])
  w.unmount()
})

// 2026-11-25 生产实测：内置接口的「系统提示词」读的是 data-process 的旧列表接口，
// 里面只有 prompt 69（node_type='910'），用户在「系统设置 → 节点类型 → 提示词模板（用途=脚本）」
// 维护的 prompt 74 根本不在里面——所以改了模板页面上看不到变化。
// 现在优先按节点类型编号读 template_use='script' 的模板，取不到才退回旧接口。
it('内置接口的系统提示词取节点提示词接口里 script 用途的模板', async () => {
  vi.mocked(nodePromptApi.selection).mockResolvedValue(null as never)
  vi.mocked(nodePromptApi.list).mockResolvedValue([
    { promptId: 1, promptName: '规则处理配置提示词 1', nodeType: 'rule_processing', nodeTypeName: '规则处理', category: 'rule', templateUse: 'config', systemPrompt: '九月的配置提示词', isActive: 1, isDefault: 1, revision: 'r1' },
    { promptId: 74, promptName: '规则处理-字段转换脚本', nodeType: '600', nodeTypeName: '规则处理', category: 'rule', templateUse: 'script', systemPrompt: '字段转换脚本模板 {{describe}}', isActive: 1, isDefault: 1, revision: 'r74' },
  ] as never)
  const w = setup(false, 0)
  await w.setProps({ isRule: true, hidePromptByDefault: true, promptListCategory: 'rule', promptCategory: '规则处理', nodeTypeCode: '600', open: true })
  await flushPromises()
  expect(nodePromptApi.list).toHaveBeenCalledWith({ sourceType: '600', templateUse: 'script' })
  expect(fetchPromptList).not.toHaveBeenCalled()
  expect(w.getComponent(PromptTemplatePicker).props('modelValue')).toBe(74)
  expect(w.emitted('update:systemPrompt')?.at(-1)).toEqual(['字段转换脚本模板 当前需求'])
  w.unmount()
})
