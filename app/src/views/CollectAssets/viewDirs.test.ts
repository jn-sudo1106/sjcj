// 「我的视图」目录版数据模型（2026-10-13 规则：多级目录、同源进多个目录、父目录汇总、可绑来源组 / 根目录可绑、组成员跟组走、随组带入可排除）
import { describe, expect, it } from 'vitest'
import {
  ROOT_ID, VIEW_SOURCE_LIMIT, addDir, addSources, bindGroup, boundGroups, deleteDir, emptyTree, moveSources, normalizeTree,
  onlyViaGroup, pathText, placesOf, removeSources, renameDir, resolveIds, restoreExcluded, treeFromLegacy, unbindGroup, type ViewTree,
} from './viewDirs'

const members = { g3: ['t1', 't2', 't3'], g1: ['x1', 'x2'] }
const gname = (id: string) => ({ g3: 'twitter1', g1: '测试组1' }[id] ?? id)

/** 广发：宏观 > 统计局（s1,s2）、央行（s3）；舆情（s4 + 来源组 g3） */
function sample() {
  let t: ViewTree = emptyTree()
  let r = addDir(t, ROOT_ID, '宏观'); t = r.tree; const macro = r.id
  r = addDir(t, macro, '统计局'); t = addSources(r.tree, r.id, ['s1', 's2']); const stat = r.id
  r = addDir(t, macro, '央行'); t = addSources(r.tree, r.id, ['s3']); const cb = r.id
  r = addDir(t, null, '舆情'); t = bindGroup(addSources(r.tree, r.id, ['s4']), r.id, 'g3'); const yq = r.id
  return { t, macro, stat, cb, yq }
}

describe('目录树', () => {
  it('多级目录、父目录汇总子目录、全部 = 根目录 ∪ 所有目录', () => {
    const { t, macro, stat } = sample()
    expect(resolveIds(t, stat, members)).toEqual(['s1', 's2'])
    expect(resolveIds(t, macro, members).sort()).toEqual(['s1', 's2', 's3'])
    expect(resolveIds(t, ROOT_ID, members).sort()).toEqual(['s1', 's2', 's3', 's4', 't1', 't2', 't3'])
    expect(pathText(t, stat)).toBe('宏观 / 统计局')
  })

  it('同级不重名、名称 1–40 字；改名；删除目录连同子孙', () => {
    const { t, macro, stat } = sample()
    expect(() => addDir(t, macro, '统计局')).toThrow('同级已有同名目录')
    expect(() => addDir(t, null, ' ')).toThrow('1到40')
    expect(addDir(t, null, '统计局').tree.dirs.length).toBe(t.dirs.length + 1) // 不同级可以同名
    expect(pathText(renameDir(t, stat, '国家统计局'), stat)).toBe('宏观 / 国家统计局')
    const after = deleteDir(t, macro)
    expect(after.dirs.map((d) => d.name)).toEqual(['舆情'])
    expect(t.dirs.length).toBe(4) // 不改入参
  })

  it('同一个源可以进多个目录，「所在目录」都列出来', () => {
    const { t, cb, yq } = sample()
    const t2 = addSources(t, yq, ['s3'])
    expect(placesOf(t2, 's3', members, gname)).toEqual(['宏观 / 央行', '舆情'])
    expect(placesOf(t2, 't1', members, gname)).toEqual(['舆情（来源组 twitter1）'])
    expect(resolveIds(t2, cb, members)).toEqual(['s3'])
  })
})

describe('来源组', () => {
  it('成员跟着来源组走：成员表变了，目录看到的跟着变；可以绑在根目录', () => {
    const { t, yq } = sample()
    expect(resolveIds(t, yq, members)).toEqual(['s4', 't1', 't2', 't3'])
    expect(resolveIds(t, yq, { ...members, g3: ['t1', 't9'] })).toEqual(['s4', 't1', 't9'])
    const rooted = bindGroup(t, ROOT_ID, 'g1')
    expect(resolveIds(rooted, ROOT_ID, members)).toEqual(expect.arrayContaining(['x1', 'x2']))
    expect(boundGroups(rooted).sort()).toEqual(['g1', 'g3'])
  })

  it('随来源组带入的源可以单独移出（排除），来源组本身不变，可恢复；之后组里新增的照样进来', () => {
    const { t, yq } = sample()
    expect(onlyViaGroup(t, yq, 't2', members)).toBe('g3')
    expect(onlyViaGroup(t, yq, 's4', members)).toBeNull()
    const ex = removeSources(t, yq, ['t2', 's4'], members)
    expect(resolveIds(ex, yq, members)).toEqual(['t1', 't3'])
    expect(resolveIds(ex, yq, { ...members, g3: ['t1', 't2', 't3', 't4'] })).toEqual(['t1', 't3', 't4'])
    expect(resolveIds(restoreExcluded(ex, yq), yq, members)).toEqual(['t1', 't2', 't3'])
  })

  it('解绑来源组：组的源都不见了，单独添加的保留，相关排除记录清掉', () => {
    const { t, yq } = sample()
    const ex = removeSources(t, yq, ['t2'], members)
    const un = unbindGroup(ex, yq, 'g3', members)
    expect(resolveIds(un, yq, members)).toEqual(['s4'])
    expect(un.dirs.find((d) => d.id === yq)!.excluded).toEqual([])
  })
})

describe('移出 / 移到目录', () => {
  it('在目录里移出：作用于它和子孙目录；在「全部」里移出：整个视图都没了', () => {
    const { t, macro, stat } = sample()
    expect(resolveIds(removeSources(t, macro, ['s1'], members), stat, members)).toEqual(['s2'])
    const all = removeSources(t, ROOT_ID, ['s1', 't1'], members)
    expect(resolveIds(all, ROOT_ID, members)).not.toContain('s1')
    expect(resolveIds(all, ROOT_ID, members)).not.toContain('t1')
  })

  it('移到目录：在目录里是移走；在「全部」里是加进去、原位置保留', () => {
    const { t, stat, cb } = sample()
    const moved = moveSources(t, stat, cb, ['s1'], members)
    expect(resolveIds(moved, stat, members)).toEqual(['s2'])
    expect(resolveIds(moved, cb, members)).toEqual(['s3', 's1'])
    const copied = moveSources(t, ROOT_ID, cb, ['s1'], members)
    expect(resolveIds(copied, stat, members)).toEqual(['s1', 's2'])
    expect(resolveIds(copied, cb, members)).toEqual(['s3', 's1'])
  })

  it('单独添加的源总数有上限', () => {
    const ids = Array.from({ length: VIEW_SOURCE_LIMIT + 1 }, (_, i) => String(i))
    expect(() => addSources(emptyTree(), ROOT_ID, ids)).toThrow(`最多单独添加 ${VIEW_SOURCE_LIMIT} 个源`)
  })
})

describe('存储与旧版转换', () => {
  it('后端读回的 JSON 清洗：缺字段补空、去重、悬空上级挂回根下', () => {
    const t = normalizeTree({ root: { sources: ['1', '1'] }, dirs: [{ id: 'a', name: 'A', parentId: 'ghost' }, { id: 'b', name: 'B', parentId: 'a', sources: [2] }, { name: '没 id' }] })
    expect(t.root).toEqual({ sources: ['1'], groups: [], excluded: [] })
    expect(t.dirs.map((d) => [d.id, d.parentId])).toEqual([['a', null], ['b', 'a']])
    expect(t.dirs[1].sources).toEqual(['2'])
  })

  it('1012 版：手选清单转成根目录的源；条件视图转成空树并打标记，改一次后标记清掉', () => {
    expect(treeFromLegacy({ v: 1, scopeIds: ['7', '8'] }).root.sources).toEqual(['7', '8'])
    const cond = treeFromLegacy({ v: 1, status: 'E', scopeIds: null })
    expect(cond.convertedFromCondition).toBe(true)
    expect(addDir(cond, null, '新目录').tree.convertedFromCondition).toBeUndefined()
  })
})
