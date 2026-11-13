import { describe, it, expect } from 'vitest'
import { paramValueCount, paramValuePreviewLabel } from './paramPreview'

describe('paramValueCount（0721 会议·真实取值数，不同于 genValues 预览截断）', () => {
  it('list：取 values 长度', () => {
    expect(paramValueCount({ kind: 'list', values: ['a', 'b', 'c'] })).toBe(3)
  })
  it('sequence：按 start/end/step 计算，不受 genValues 20 条截断影响', () => {
    expect(paramValueCount({ kind: 'sequence', seq: { start: 1, end: 100, step: 1 } })).toBe(100)
    expect(paramValueCount({ kind: 'sequence', seq: { start: 0, end: 20, step: 5 } })).toBe(5)
  })
  it('sequence：非法定义（step<=0 或 end<start）返回 0', () => {
    expect(paramValueCount({ kind: 'sequence', seq: { start: 1, end: 10, step: 0 } })).toBe(0)
    expect(paramValueCount({ kind: 'sequence', seq: { start: 10, end: 1, step: 1 } })).toBe(0)
  })
  it('date_sequence：取 seq.end（"最近 N 天"的 N），无 seq 时退化默认 5', () => {
    expect(paramValueCount({ kind: 'date_sequence', seq: { start: 1, end: 10, step: 1 } })).toBe(10)
    expect(paramValueCount({ kind: 'date_sequence' })).toBe(5)
  })
  it('date：单点动态值，恒为 1', () => {
    expect(paramValueCount({ kind: 'date' })).toBe(1)
  })
  it('database：取 values 长度（mock 口径同 list）', () => {
    expect(paramValueCount({ kind: 'database', values: ['row1', 'row2'] })).toBe(2)
  })
})

describe('paramValuePreviewLabel', () => {
  it('list 多值：首~尾（N 个）', () => {
    const label = paramValuePreviewLabel({ kind: 'list', values: ['a', 'b', 'c'] }, ['a', 'b', 'c'])
    expect(label).toBe('a~c（3 个）')
  })
  it('list 单值：直接展示该值', () => {
    expect(paramValuePreviewLabel({ kind: 'list', values: ['北京'] }, ['北京'])).toBe('北京')
  })
  it('sequence：start~end（步长 N），来自定义而非样本值', () => {
    const label = paramValuePreviewLabel({ kind: 'sequence', seq: { start: 1, end: 100, step: 1 } }, ['1', '2', '3'])
    expect(label).toBe('1~100')
    const stepped = paramValuePreviewLabel({ kind: 'sequence', seq: { start: 0, end: 20, step: 5 } }, ['0', '5', '10'])
    expect(stepped).toBe('0~20（步长 5）')
  })
  it('date_sequence：最近 N 天', () => {
    const label = paramValuePreviewLabel({ kind: 'date_sequence', seq: { start: 1, end: 10, step: 1 } }, ['2026-07-01'])
    expect(label).toBe('最近 10 天')
  })
  it('无样本值：退化为「共 N 个」或「—」', () => {
    expect(paramValuePreviewLabel({ kind: 'sequence', seq: { start: 1, end: 5, step: 1 } }, [])).toBe('共 5 个')
    expect(paramValuePreviewLabel({ kind: 'list' }, [])).toBe('—')
  })
})
