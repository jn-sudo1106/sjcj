// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ruleApi } from '@/api'
import { cleanMonitorPython, stripDescriptionPlaceholders, testMonitorScript } from './generation'

afterEach(() => vi.restoreAllMocks())

describe('监控脚本产物和执行回执', () => {
  it('只取完整 Python 代码块，排除模型说明', () => {
    expect(cleanMonitorPython('以下是脚本：\n```python\nprint("正常")\n```\n说明文字')).toBe('print("正常")')
    expect(cleanMonitorPython('print(1)')).toBe('print(1)')
  })
  it('不猜测多个代码块或残缺围栏', () => {
    expect(() => cleanMonitorPython('```python\nprint(1)\n```\n```python\nprint(2)\n```')).toThrow('多个代码块')
    expect(() => cleanMonitorPython('```python\nprint(1)')).toThrow('完整')
  })
  it('多个代码块里只有一个正式脚本时可以取出', () => {
    const raw = '先看字段：\n```python\nprint("inspect")\n```\n正式脚本：\n```python\ndef main():\n    return 0\n```'
    expect(cleanMonitorPython(raw)).toContain('def main():')
  })
  it('业务描述里的占位符会在发送前清掉', () => {
    const text = stripDescriptionPlaceholders('检查【A / t】，正常标准为【业务约定】，只检查【生效起点】之后的数据。')
    expect(text).not.toContain('【')
    expect(text).not.toContain('业务约定')
    expect(text).toContain('常规业务标准')
  })
  it('HTTP 成功中的业务失败不能算测试通过', async () => {
    vi.spyOn(ruleApi, 'executeCode').mockResolvedValue({ success: false, message: '代码语法错误' })
    await expect(testMonitorScript('/code/test.py')).rejects.toThrow('代码语法错误')
  })
  it('未知或冲突回执不能算测试通过', async () => {
    const execute = vi.spyOn(ruleApi, 'executeCode')
    for (const raw of [null, 'done', {}, { success: true, ok: false }]) {
      execute.mockResolvedValueOnce(raw)
      await expect(testMonitorScript('/code/test.py')).rejects.toThrow()
    }
  })
  it('只有明确执行成功的回执才通过', async () => {
    vi.spyOn(ruleApi, 'executeCode').mockResolvedValue({ success: true, result: [{ count: 0 }] })
    expect((await testMonitorScript('/code/test.py')).ok).toBe(true)
  })
})
