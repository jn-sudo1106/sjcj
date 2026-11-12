// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { defaultNodePrompt, fillNodePrompt, nodePromptApi, type NodePromptTemplate } from './nodePrompts'
import { runnerManagementApi } from './runnerManagement'
vi.mock('./runnerManagement', () => ({ runnerManagementApi: { nodePromptTemplates: vi.fn(), saveNodePromptTemplate: vi.fn() } }))
const row: NodePromptTemplate = { promptId: 1, promptName: '新闻提示词', nodeType: '90', nodeTypeName: '网页抓取', category: 'collect', templateUse: 'config', revision: 'r', systemPrompt: '系统', isActive: 1, isDefault: 0 }
it('优先启用的默认模板，不选停用模板；代码生成可要求显式默认', () => {
  const disabled = { ...row, promptId: 2, isActive: 0, isDefault: 1 }
  const defaults = { ...row, promptId: 3, isDefault: 1 }
  expect(defaultNodePrompt([disabled, row, defaults])).toBe(defaults)
  expect(defaultNodePrompt([disabled, row], true)).toBeUndefined()
  expect(defaultNodePrompt([disabled, row])).toBe(row)
})
it('变量值不被当成替换语法，也不会递归替换用户内容', () => {
  expect(fillNodePrompt('{{url}} {{describe}} {{unknown}}', { url: '$&', describe: '{{url}}' })).toBe('$& {{url}} {{unknown}}')
})
it('模板读取与保存统一使用Python管理服务，保留配置ID与修订号', async () => {
  vi.mocked(runnerManagementApi.nodePromptTemplates).mockResolvedValue([row])
  vi.mocked(runnerManagementApi.saveNodePromptTemplate).mockResolvedValue(row)
  expect(await nodePromptApi.list({ sourceType:'90',templateUse:'script' })).toEqual([row])
  await nodePromptApi.save({ ...row,sourceType:'90',systemPrompt:'修改内容' })
  expect(runnerManagementApi.saveNodePromptTemplate).toHaveBeenCalledWith(expect.objectContaining({ sourceType:'90',promptId:1,revision:'r',systemPrompt:'修改内容' }))
})
