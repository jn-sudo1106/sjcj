// cron 六段解析/生成回归 —— 旧 Cron 编辑器那套 `*` / `?` / `a-b` / `a/b` / `1,3,5` 的口径，
// 加上日/周互斥的收敛方向（日优先）。
import { describe, expect, it } from 'vitest'
import {
  SEGMENT_SPECS,
  composeCron,
  composeSegment,
  createSegment,
  describeSegment,
  parseCron,
  parseSegment,
} from './cronSegments'

const spec = (key: string) => SEGMENT_SPECS.find((item) => item.key === key)!

describe('parseSegment', () => {
  it('* / 空 → every', () => {
    expect(parseSegment('*', spec('second')).type).toBe('every')
    expect(parseSegment('', spec('second')).type).toBe('every')
  })

  it('? → notset（只有日/周支持，其它段回 every）', () => {
    expect(parseSegment('?', spec('day')).type).toBe('notset')
    expect(parseSegment('?', spec('week')).type).toBe('notset')
    expect(parseSegment('?', spec('hour')).type).toBe('every')
  })

  it('a-b → range', () => {
    const state = parseSegment('8-18', spec('hour'))
    expect(state.type).toBe('range')
    expect([state.start, state.end]).toEqual([8, 18])
  })

  it('a/b → loop，`*/n` 当 0/n；间隔非法回落 1', () => {
    const plain = parseSegment('5/10', spec('minute'))
    expect(plain.type).toBe('loop')
    expect([plain.loopStart, plain.interval]).toEqual([5, 10])

    const star = parseSegment('*/30', spec('minute'))
    expect([star.loopStart, star.interval]).toEqual([0, 30])

    const broken = parseSegment('5/x', spec('minute'))
    expect(broken.interval).toBe(1)
  })

  it('纯数字 / 逗号列表 → specify，且非法项被丢掉', () => {
    expect(parseSegment('3', spec('month')).list).toEqual([3])
    const list = parseSegment('1,3,5', spec('week'))
    expect(list.type).toBe('specify')
    expect(list.list).toEqual([1, 3, 5])
    expect(parseSegment('1,x,5', spec('day')).list).toEqual([1, 5])
  })

  it('认不出来的当 every，不抛错', () => {
    expect(parseSegment('L', spec('day')).type).toBe('every')
    expect(parseSegment('W', spec('day')).type).toBe('every')
  })
})

describe('composeSegment', () => {
  it('四种形态的输出', () => {
    expect(composeSegment(createSegment(spec('second')))).toBe('*')
    expect(composeSegment({ ...createSegment(spec('day')), type: 'notset' })).toBe('?')
    expect(composeSegment({ ...createSegment(spec('hour')), type: 'range', start: 8, end: 18 })).toBe('8-18')
    expect(composeSegment({ ...createSegment(spec('minute')), type: 'loop', loopStart: 0, interval: 30 })).toBe('0/30')
  })

  it('specify 升序拼接（旧版也是先 sort 再 join）', () => {
    expect(composeSegment({ ...createSegment(spec('month')), type: 'specify', list: [5, 1, 3] })).toBe('1,3,5')
  })
})

describe('composeCron / parseCron', () => {
  it('六段按 [秒 分 时 日 月 周] 拼', () => {
    expect(composeCron(parseCron('0 0/30 * * * ?'))).toBe('0 0/30 * * * ?')
    expect(composeCron(parseCron('0 0 3 * * ?'))).toBe('0 0 3 * * ?')
  })

  it('日与周不能同时有值：日优先，周回落为 ?', () => {
    // 手工构造「日=每月1日、周=每周一」这对非法组合
    const segments = parseCron('0 0 3 * * ?')
    segments[3] = { ...createSegment(spec('day')), type: 'specify', list: [1] }
    segments[5] = { ...createSegment(spec('week')), type: 'specify', list: [1] }
    expect(composeCron(segments)).toBe('0 0 3 1 * ?')
  })

  it('段数不足按默认补（其余 *，周给 ?）', () => {
    const segments = parseCron('0 0 3')
    expect(segments).toHaveLength(6)
    expect(composeCron(segments)).toBe('0 0 3 * * ?')
    expect(parseCron('')).toHaveLength(6)
  })

  it('不认识的值不会让整条表达式崩掉', () => {
    expect(composeCron(parseCron('0 0 L * * ?'))).toBe('0 0 * * * ?')
  })
})

describe('describeSegment', () => {
  it('给各形态一句中文（表格/摘要用）', () => {
    expect(describeSegment(createSegment(spec('second')), spec('second'))).toBe('每秒')
    expect(describeSegment({ ...createSegment(spec('week')), type: 'notset' }, spec('week'))).toBe('不设置')
    expect(describeSegment({ ...createSegment(spec('day')), type: 'specify', list: [2, 1] }, spec('day'))).toBe('1、2')
  })
})
