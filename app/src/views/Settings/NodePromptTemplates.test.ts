// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus, { ElMessageBox } from 'element-plus'
import { runnerManagementApi } from '@/api/runnerManagement'
import NodePromptTemplates from './NodePromptTemplates.vue'
import { nodePromptApi, type NodePromptTemplate } from '@/api/nodePrompts'
vi.mock('@/api/nodePrompts', async original => ({ ...await original<typeof import('@/api/nodePrompts')>(), nodePromptApi: { list: vi.fn(), save: vi.fn() } }))
vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { previewPromptDeletion: vi.fn(), deletePromptTemplate: vi.fn() } }))
const row: NodePromptTemplate = { promptId: 1, promptName: '新闻列表抓取', nodeType: 'legacy_web', nodeTypeName: '网页抓取', category: 'collect', templateUse: 'script', systemPrompt: '系统', userPromptTemplate: '任务 {{describe}}', isActive: 1, isDefault: 1, revision: 'rev1' }
const node = { sourceType: '90', typeName: '网页抓取', downType: '', topic: '', seq: 0, procType: '', params: '', notes: '' }
beforeEach(() => { vi.mocked(nodePromptApi.list).mockResolvedValue([row]); vi.mocked(nodePromptApi.save).mockResolvedValue(row) })
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); document.body.innerHTML = '' })
const setup = (canWrite = true) => mount(NodePromptTemplates, { props: { node, canWrite }, global: { plugins: [ElementPlus] } })
it('读取历史模板并带来源类型与乐观锁保存，长字段保持完整', async () => {
  const w = setup(); await flushPromises()
  expect(nodePromptApi.list).toHaveBeenCalledWith({ sourceType: '90', templateUse: 'script' })
  await w.get('[data-testid="node-prompt-system"]').setValue('新系统')
  await w.get('[data-testid="node-prompt-save"]').trigger('click'); await flushPromises()
  expect(nodePromptApi.save).toHaveBeenCalledWith(expect.objectContaining({ sourceType: '90', promptId: 1, revision: 'rev1', nodeType: 'legacy_web', systemPrompt: '新系统', userPromptTemplate: '任务 {{describe}}' }))
  w.unmount()
})
it('新增有名称的独立提示词，不再显示或提交版本', async () => {
  const w = setup(); await flushPromises()
  await w.get('[data-testid="node-prompt-new"]').trigger('click'); await flushPromises()
  await w.get('[data-testid="node-prompt-name"]').setValue('公告列表抓取')
  await w.get('[data-testid="node-prompt-save"]').trigger('click'); await flushPromises()
  expect(nodePromptApi.save).toHaveBeenCalledWith(expect.objectContaining({ promptId: 0, promptName: '公告列表抓取', nodeType: '90', systemPrompt: '系统', isDefault: 0 }))
  expect(nodePromptApi.save).toHaveBeenCalledWith(expect.not.objectContaining({ version: expect.anything() }))
  expect(w.text()).not.toContain('新建版本')
  w.unmount()
})
it('只读无保存入口；未保存修改可阻止切换；加载失败可刷新', async () => {
  const read = setup(false); await flushPromises()
  expect(read.find('[data-testid="node-prompt-save"]').exists()).toBe(false); read.unmount()
  const w = setup(); await flushPromises()
  await w.get('[data-testid="node-prompt-user"]').setValue('尚未保存')
  vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
  expect(await w.vm.confirmLeave()).toBe(false)
  w.unmount()
  vi.mocked(nodePromptApi.list).mockRejectedValueOnce(new Error('服务不可用'))
  const failed = setup(); await flushPromises(); expect(failed.text()).toContain('服务不可用')
  await failed.findAll('button').find(b => b.text() === '重试')!.trigger('click'); await flushPromises()
  expect(failed.find('[data-testid="node-prompt-save"]').exists()).toBe(true); failed.unmount()
})

it('列表与编辑区展示ID，确认后通过Python删除并刷新', async () => {
  const w = setup(); await flushPromises()
  expect(w.get('[data-testid="node-prompt-id"]').text()).toContain('ID：1')
  expect(w.get('[data-testid="selected-prompt-id"]').text()).toContain('1')
  vi.mocked(runnerManagementApi.previewPromptDeletion).mockResolvedValue({ promptId: 1, promptName: row.promptName, revision: 'delete-rev', canDelete: true, referenceCount: 0, reason: '' })
  vi.mocked(runnerManagementApi.deletePromptTemplate).mockResolvedValue({ deleted: true, promptId: 1 })
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
  vi.mocked(nodePromptApi.list).mockResolvedValueOnce([])
  await w.get('[data-testid="node-prompt-delete"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.deletePromptTemplate).toHaveBeenCalledWith({ promptId: 1, sourceType: '90', nodeTypeName: '网页抓取', templateUse: 'script', revision: 'delete-rev' })
  expect(w.find('[data-testid="node-prompt-delete"]').exists()).toBe(false)
  w.unmount()
})
it('默认或引用中的模板保留并展示具体原因', async () => {
  const w = setup(); await flushPromises()
  vi.mocked(runnerManagementApi.previewPromptDeletion).mockResolvedValue({ promptId: 1, promptName: row.promptName, revision: 'delete-rev', canDelete: false, referenceCount: 1, reason: '有 1 个节点正在选择此模板' })
  await w.get('[data-testid="node-prompt-delete"]').trigger('click'); await flushPromises()
  expect(w.text()).toContain('有 1 个节点正在选择此模板')
  expect(runnerManagementApi.deletePromptTemplate).not.toHaveBeenCalled()
  w.unmount()
})
it('取消删除不发删除请求，只读无删除按钮', async () => {
  const read = setup(false); await flushPromises()
  expect(read.find('[data-testid="node-prompt-delete"]').exists()).toBe(false); read.unmount()
  const w = setup(); await flushPromises()
  vi.mocked(runnerManagementApi.previewPromptDeletion).mockResolvedValue({ promptId: 1, promptName: row.promptName, revision: 'delete-rev', canDelete: true, referenceCount: 0, reason: '' })
  vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
  await w.get('[data-testid="node-prompt-delete"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.deletePromptTemplate).not.toHaveBeenCalled()
  w.unmount()
})
