import { describe, expect, it } from 'vitest'
import { cleanGeneratedPython, needsPythonCleanup } from './generatedScript'

describe('cleanGeneratedPython', () => {
  it('剥掉 ```python 围栏只留代码', () => {
    expect(cleanGeneratedPython('```python\nimport re\n\ndef main():\n    return {}\n```')).toBe('import re\n\ndef main():\n    return {}')
  })

  it('无围栏原样返回，截断与多块报错', () => {
    expect(cleanGeneratedPython('def main():\n    return {}')).toBe('def main():\n    return {}')
    expect(() => cleanGeneratedPython('```python\nprint(1)')).toThrow('不完整')
    expect(() => cleanGeneratedPython('```python\nprint(1)\n```\n```python\nprint(2)\n```')).toThrow('多个代码块')
  })
})

describe('needsPythonCleanup', () => {
  it('只对带围栏的 .py 目标生效', () => {
    expect(needsPythonCleanup('```python\nx\n```', '/code01/a.py')).toBe(true)
    expect(needsPythonCleanup('```python\nx\n```', '/code01/a.PY ')).toBe(true)
    expect(needsPythonCleanup('def main(): pass', '/code01/a.py')).toBe(false)
    expect(needsPythonCleanup('```xml\n<a/>\n```', '/code01/a.xml')).toBe(false)
    expect(needsPythonCleanup('```python\nx\n```', '')).toBe(false)
  })
})
