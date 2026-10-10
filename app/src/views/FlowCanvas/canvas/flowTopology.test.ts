// 1008-BR-02：父子关系 → 主链 + 分支组。画布还原和画布编辑共用，锁住几种形状。
import { describe, expect, it } from 'vitest'
import { topologyFromParents } from './flowTopology'

const build = (pairs: Array<[string, string | undefined]>, anchored: string[] = pairs.map(([id]) => id)) =>
  topologyFromParents({
    order: pairs.map(([id]) => id),
    parentOf: new Map(pairs),
    anchored: new Set(anchored),
    labelOf: (id) => `名-${id}`,
  })

describe('topologyFromParents', () => {
  it('直链全部进主链', () => {
    expect(build([['a', undefined], ['b', 'a'], ['c', 'b']])).toEqual({ main: ['start', 'a', 'b', 'c', 'end'], branchGroups: [] })
  })

  it('主链遇分叉即止，分叉点本身当 owner，同级按 order 排', () => {
    const t = build([['a', undefined], ['b', 'a'], ['c', 'a'], ['d', 'b']])
    expect(t.main).toEqual(['start', 'a', 'end'])
    expect(t.branchGroups).toEqual([{
      ownerId: 'a',
      branches: [
        { id: 'a-b1', label: '名-b', chain: ['b', 'd'] },
        { id: 'a-b2', label: '名-c', chain: ['c'] },
      ],
    }])
  })

  it('分支链里再分叉进嵌套 subGroups', () => {
    const t = build([['a', undefined], ['b', 'a'], ['c', 'a'], ['d', 'b'], ['e', 'b']])
    expect(t.branchGroups[0].branches[0]).toEqual({
      id: 'a-b1', label: '名-b', chain: ['b'],
      subGroups: [{ ownerId: 'b', branches: [
        { id: 'b-b1', label: '名-d', chain: ['d'] },
        { id: 'b-b2', label: '名-e', chain: ['e'] },
      ] }],
    })
  })

  it('多根：带标记的并到入口根下作分支，没标记的平铺进主链尾', () => {
    const t = build([['a', undefined], ['x', undefined], ['y', undefined]], ['a', 'x'])
    expect(t.main).toEqual(['start', 'a', 'y', 'end'])
    expect(t.branchGroups).toEqual([{ ownerId: 'a', branches: [{ id: 'a-b1', label: '名-x', chain: ['x'] }] }])
  })

  it('上级不在集合里按根位处理；成环的节点也不丢', () => {
    const t = build([['a', undefined], ['b', 'ghost'], ['p', 'q'], ['q', 'p']], ['a'])
    expect(t.main).toEqual(['start', 'a', 'b', 'p', 'q', 'end'])
  })
})
