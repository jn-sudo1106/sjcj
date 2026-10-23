// 「我的视图」目录版数据模型（2026-10-13 规则：多级目录、同源进多个目录、可绑来源组、组成员跟组走、随组带入可排除；10-14：没有根目录、父目录不汇总）
import { describe, expect, it } from 'vitest'
import {
  VIEW_SOURCE_LIMIT, addDir, allIds, addSources, bindGroup, boundGroups, deleteDir, emptyTree, missingOf, moveSources, normalizeTree,
  onlyViaGroup, pathText, placesOf, removeSources, renameDir, resolveIds, restoreExcluded, treeFromLegacy, unbindGroup, type ViewTree,
} from './viewDirs'

const members = { g3: ['t1', 't2', 't3'], g1: ['x1', 'x2'] }
const gname = (id: string) => ({ g3: 'twitter1', g1: '测试组1' }[id] ?? id)

/** 广发：宏观 > 统计局（s1,s2）、央行（s3）；舆情（s4 + 来源组 g3） */
function sample() {
  let t: ViewTree = emptyTree()
  let r = addDir(t, null, '宏观'); t = r.tree; const macro = r.id
  r = addDir(t, macro, '统计局'); t = addSources(r.tree, r.id, ['s1', 's2']); const stat = r.id
  r = addDir(t, macro, '央行'); t = addSources(r.tree, r.id, ['s3']); const cb = r.id
  r = addDir(t, null, '舆情'); t = bindGroup(addSources(r.tree, r.id, ['s4']), r.id, 'g3'); const yq = r.id
  return { t, macro, stat, cb, yq }
}

describe('目录树', () => {
  it('多级目录、父目录不汇总子目录；整个视图 = 所有目录去重', () => {
    const { t, macro, stat } = sample()
    expect(resolveIds(t, stat, members)).toEqual(['s1', 's2'])
    expect(resolveIds(t, macro, members)).toEqual([])
    expect(allIds(t, members).sort()).toEqual(['s1', 's2', 's3', 's4', 't1', 't2', 't3'])
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
  it('成员跟着来源组走：成员表变了，目录看到的跟着变', () => {
    const { t, yq, cb } = sample()
    expect(resolveIds(t, yq, members)).toEqual(['s4', 't1', 't2', 't3'])
    expect(resolveIds(t, yq, { ...members, g3: ['t1', 't9'] })).toEqual(['s4', 't1', 't9'])
    const bound = bindGroup(t, cb, 'g1')
    expect(resolveIds(bound, cb, members)).toEqual(['s3', 'x1', 'x2'])
    expect(boundGroups(bound).sort()).toEqual(['g1', 'g3'])
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

// 1016：真实接口下后端绑定来源组时只展开当时的成员（rows 快照），组里之后新加的不会自动进目录
describe('来源组快照与「未在视图」', () => {
  /** 舆情目录在后端的源行：s4 + 绑定 g3 时的 t1、t2（t3 是后来才进组的） */
  const withRows = () => {
    const { t, yq } = sample()
    return { t: { ...t, dirs: t.dirs.map((d) => (d.id === yq ? { ...d, rows: ['s4', 't1', 't2'] } : d)) }, yq }
  }

  it('组里新加、还没进目录的源：不算在目录里，按来源组列出', () => {
    const { t, yq } = withRows()
    expect(resolveIds(t, yq, members)).toEqual(['s4', 't1', 't2'])
    expect(missingOf(t.dirs.find((d) => d.id === yq)!, members)).toEqual([{ groupId: 'g3', ids: ['t3'] }])
    expect(onlyViaGroup(t, yq, 't3', members)).toBeNull()
    expect(placesOf(t, 't3', members, gname)).toEqual([])
  })

  it('勾选加入后不再算缺；排除过的不算缺；本机兜底（没有 rows）照旧组成员全算', () => {
    const { t, yq } = withRows()
    const added = addSources(t, yq, ['t3'])
    expect(resolveIds(added, yq, members)).toEqual(['s4', 't3', 't1', 't2'])
    expect(missingOf(added.dirs.find((d) => d.id === yq)!, members)).toEqual([])
    const ex = removeSources(t, yq, ['t3'], members)
    expect(missingOf(ex.dirs.find((d) => d.id === yq)!, members)).toEqual([])
    const { t: local, yq: id } = sample()
    expect(missingOf(local.dirs.find((d) => d.id === id)!, members)).toEqual([])
  })

  it('rows 存取时保留，没有时不补', () => {
    const { t } = withRows()
    expect(normalizeTree(JSON.parse(JSON.stringify(t))).dirs.find((d) => d.rows)?.rows).toEqual(['s4', 't1', 't2'])
    expect(normalizeTree({ dirs: [{ id: 'a', name: 'A' }] }).dirs[0]).not.toHaveProperty('rows')
  })
})

describe('移出 / 移到目录', () => {
  it('移出只作用于当前目录，父目录移出不影响子目录', () => {
    const { t, macro, stat, cb } = sample()
    const same = removeSources(addSources(t, macro, ['s1']), macro, ['s1'], members)
    expect(resolveIds(same, macro, members)).toEqual([])
    expect(resolveIds(same, stat, members)).toEqual(['s1', 's2'])
    expect(resolveIds(removeSources(t, stat, ['s1'], members), cb, members)).toEqual(['s3'])
  })

  it('移到目录：从这里移走、加进目标', () => {
    const { t, stat, cb } = sample()
    const moved = moveSources(t, stat, cb, ['s1'], members)
    expect(resolveIds(moved, stat, members)).toEqual(['s2'])
    expect(resolveIds(moved, cb, members)).toEqual(['s3', 's1'])
  })

  it('每个目录单独添加的源有上限', () => {
    const { t, cb } = sample()
    const ids = Array.from({ length: VIEW_SOURCE_LIMIT + 1 }, (_, i) => String(i))
    expect(() => addSources(t, cb, ids)).toThrow(`最多单独添加 ${VIEW_SOURCE_LIMIT} 个源`)
  })
})

describe('存储与旧版转换', () => {
  it('读回的 JSON 清洗：缺字段补空、去重、悬空上级挂成一级；旧数据根目录上的源转成一级目录「未归类」', () => {
    const t = normalizeTree({ root: { sources: ['1', '1'] }, dirs: [{ id: 'a', name: 'A', parentId: 'ghost' }, { id: 'b', name: 'B', parentId: 'a', sources: [2] }, { name: '没 id' }] })
    expect(t.dirs.map((d) => [d.id, d.parentId])).toEqual([['a', null], ['b', 'a'], ['legacy-root', null]])
    expect(t.dirs[1].sources).toEqual(['2'])
    expect(t.dirs[2]).toMatchObject({ name: '未归类', sources: ['1'] })
    expect(normalizeTree({ root: { sources: [] }, dirs: [] }).dirs).toEqual([])
  })

  it('1012 版：手选清单转成一级目录「未归类」；条件视图转成空树并打标记，改一次后标记清掉', () => {
    expect(treeFromLegacy({ v: 1, scopeIds: ['7', '8'] }).dirs[0]).toMatchObject({ name: '未归类', sources: ['7', '8'] })
    const cond = treeFromLegacy({ v: 1, status: 'E', scopeIds: null })
    expect(cond.convertedFromCondition).toBe(true)
    expect(addDir(cond, null, '新目录').tree.convertedFromCondition).toBeUndefined()
  })
})
