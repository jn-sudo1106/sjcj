// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { defaultNodePrompt, fillNodePrompt, type NodePromptTemplate } from './nodePrompts'
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
