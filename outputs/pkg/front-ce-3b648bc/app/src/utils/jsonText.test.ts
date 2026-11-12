import { describe, expect, it } from 'vitest'
import { prettyJsonText } from './jsonText'

describe('prettyJsonText', () => {
  it('紧凑 JSON 按两格缩进展开，中文与嵌套的 HTML 字符串原样保留', () => {
    const raw = '{"ID": "386", "Name": "AI智能体概念", "Introduction": "<p style=\\"color: red\\">题材</p>", "List": [1, 2]}'
    expect(prettyJsonText(raw)).toBe([
      '{',
      '  "ID": "386",',
      '  "Name": "AI智能体概念",',
      '  "Introduction": "<p style=\\"color: red\\">题材</p>",',
      '  "List": [',
      '    1,',
      '    2',
      '  ]',
      '}',
    ].join('\n'))
  })

  it('数组开头同样格式化', () => {
    expect(prettyJsonText(' [{"a":1}] ')).toBe('[\n  {\n    "a": 1\n  }\n]')
  })

  it('解析不了（被截断 / 不是 JSON / 空）返回 null，由调用方显示原文', () => {
    expect(prettyJsonText('{"a": 1, "b":')).toBeNull()
    expect(prettyJsonText('普通正文')).toBeNull()
    expect(prettyJsonText('123')).toBeNull()
    expect(prettyJsonText('')).toBeNull()
  })
})
