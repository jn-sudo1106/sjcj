import { expect, it } from 'vitest'
import { promptEditReply, validatePromptEdit } from './promptEditReply'

it('读取 Chat 包装中的完整提示词，保留变量和换行', () => {
  const result = { reply: '已取消翻页', userPrompt: '采集 {{url}}\n只取当前页' }
  expect(promptEditReply(JSON.stringify({ reply: JSON.stringify(result) }))).toEqual(result)
  expect(promptEditReply('```json\n' + JSON.stringify(result) + '\n```')).toEqual(result)
  expect(validatePromptEdit('采集 {{url}}', result.userPrompt)).toBe('')
})
it('澄清回复及普通文字不能当作完整提示词应用，缺失变量必须继续修改', () => {
  expect(promptEditReply('请问是否还需要发布日期？').userPrompt).toBeNull()
  expect(promptEditReply(JSON.stringify({ reply: '请补充字段', userPrompt: null })).userPrompt).toBeNull()
  expect(validatePromptEdit('{{url}} {{output_fields}}', '采集 {{url}}')).toContain('{{output_fields}}')
})
