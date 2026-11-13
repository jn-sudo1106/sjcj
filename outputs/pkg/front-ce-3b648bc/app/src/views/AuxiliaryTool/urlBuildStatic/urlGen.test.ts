// 「URL生成静态[备]」纯计算回归：$pN$ 占位符替换、等长校验、笛卡尔集、去重/差集。
import { describe, expect, it } from 'vitest'
import { distinctValues, genCartesian, genSimple, parseToList } from './urlGen'

describe('parseToList', () => {
  it('按行拆、去空行', () => {
    expect(parseToList('a\n\n b \n')).toEqual(['a', ' b '])
    expect(parseToList(undefined)).toEqual([])
  })
})

describe('genSimple', () => {
  it('按下标替换 $p1$ / $p2$', () => {
    const { error, lines } = genSimple([['a', 'b'], ['1', '2']], 'http://$p1$-$p2$', '$p1$-$p2$')
    expect(error).toBeNull()
    expect(lines).toEqual(['a-1 ; http://a-1', 'b-2 ; http://b-2'])
  })

  it('行数不一致给出旧版同款错误文案，且不出结果', () => {
    const { error, lines } = genSimple([['a', 'b'], ['1']], 'http://$p1$', '$p1$')
    expect(error).toBe('多个参数数量不匹配: 1, vs , 2')
    expect(lines).toEqual([])
  })

  it('参数为空 → 空结果，不抛错', () => {
    expect(genSimple([[], []], 'http://$p1$', '$p1$')).toEqual({ error: null, lines: [] })
  })
})

describe('genCartesian', () => {
  it('全组合逐行替换', () => {
    const { lines } = genCartesian([['a', 'b'], ['1', '2']], 'http://$p1$-$p2$', '$p1$-$p2$')
    expect(lines).toEqual([
      'a-1 ; http://a-1',
      'a-2 ; http://a-2',
      'b-1 ; http://b-1',
      'b-2 ; http://b-2',
    ])
  })

  it('任一参数为空 → 空结果', () => {
    expect(genCartesian([['a'], []], 'http://$p1$', '$p1$')).toEqual({ error: null, lines: [] })
  })
})

describe('distinctValues', () => {
  it('自身去重保留首次顺序', () => {
    expect(distinctValues(['b', 'a', 'b'])).toEqual(['b', 'a'])
  })

  it('差集：values 里有、other 里没有的（旧 genDistinct(a,b) 的 b 差 a）', () => {
    expect(distinctValues(['1', '2', '3'], ['2'])).toEqual(['1', '3'])
  })
})
