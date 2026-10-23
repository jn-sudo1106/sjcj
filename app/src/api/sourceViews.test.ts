// @vitest-environment jsdom
// 「我的视图」存取：本机兜底实现 + 真实接口（开发环境联调口径）+ 接口不存在时自动退回本机 + 导入本机视图。
// 2026-10-13 目录版；10-14 真实接口下目录 = 带 rootViewId 的分类、源和来源组 = listSources 读 + addSources / delSources 增量写（V3），
// 排除暂存 queryJson（v3）；本机兜底照旧整棵树存本机，1012 的条件 / 手选清单视图读到时自动转换。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn())
vi.mock('./client', () => ({ request: requestMock }))
/** 来源组的当前成员（假后端展开 / 删组、前端减掉组成员都用这一份） */
const groupMembers = vi.hoisted(() => ({ 3: ['501', '502'] } as Record<string, string[]>))
vi.mock('@/views/CollectAssets/groupMembers', () => ({
  loadGroupMembers: async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, groupMembers[id] ?? []])),
}))

import {
  SOURCE_VIEW_LIMIT,
  defaultDisplay,
  displayFromJson,
  extrasFromJson,
  isEndpointMissing,
  localSourceViewApi,
  setSourceViewBackend,
  sourceViewApi,
  sourceViewBackend,
  sourceViewStorageKey,
  treeFromJson,
  type SourceView,
} from './sourceViews'
import { addDir, addSources, bindGroup, deleteDir, emptyTree, missingOf, renameDir, type ViewTree } from '@/views/CollectAssets/viewDirs'

beforeEach(() => {
  localStorage.clear()
  requestMock.mockReset()
  setSourceViewBackend(null)
})
afterEach(() => setSourceViewBackend(null))

/** 一个一级目录「A」，里面放 ids */
function treeWith(...ids: string[]): ViewTree {
  const r = addDir(emptyTree(), null, 'A')
  return addSources(r.tree, r.id, ids)
}

describe('本机实现（接口没上线时的兜底，校验口径同后端）', () => {
  it('按用户隔离：A 建的视图 B 看不到；新建默认是空树', async () => {
    const v = await localSourceViewApi.add('1', { viewName: '广发' })
    expect(v.tree).toEqual(emptyTree())
    expect(v.display).toEqual(defaultDisplay())
    expect((await localSourceViewApi.list('1')).map((x) => x.viewName)).toEqual(['广发'])
    expect(await localSourceViewApi.list('2')).toEqual([])
    expect(localStorage.getItem(sourceViewStorageKey('1'))).toContain('广发')
  })

  it('名称 1–40 字、同一用户不重名（提示语同后端）；重命名可以保持原名', async () => {
    const v = await localSourceViewApi.add('1', { viewName: '  视图A  ' })
    expect(v.viewName).toBe('视图A')
    await expect(localSourceViewApi.add('1', { viewName: '视图A' })).rejects.toThrow('视图名称已存在，请更换名称')
    await expect(localSourceViewApi.add('1', { viewName: ' ' })).rejects.toThrow('视图名称为1到40个字符')
    await expect(localSourceViewApi.add('1', { viewName: 'x'.repeat(41) })).rejects.toThrow('视图名称为1到40个字符')
    await expect(localSourceViewApi.update('1', { viewId: v.viewId, revision: v.revision, viewName: '视图A' })).resolves.toMatchObject({ viewName: '视图A' })
  })

  it('revision 从 0 起，保存目录树 +1；拿旧 revision 再写报「视图已变化」', async () => {
    const v = await localSourceViewApi.add('1', { viewName: 'A' })
    expect(v.revision).toBe(0)
    const saved = await localSourceViewApi.update('1', { viewId: v.viewId, revision: 0, tree: treeWith('10') })
    expect(saved.revision).toBe(1)
    expect(saved.tree.dirs[0].sources).toEqual(['10'])
    await expect(localSourceViewApi.update('1', { viewId: v.viewId, revision: 0, viewName: 'B' })).rejects.toThrow('视图已变化，请刷新后重试')
  })

  it('默认进入只能有一个；删除；每人上限 50 个；没有账号不能写', async () => {
    const a = await localSourceViewApi.add('1', { viewName: 'A', isDefault: true })
    const b = await localSourceViewApi.add('1', { viewName: 'B' })
    await localSourceViewApi.update('1', { viewId: b.viewId, revision: b.revision, isDefault: true })
    expect((await localSourceViewApi.list('1')).filter((v) => v.isDefault).map((v) => v.viewId)).toEqual([b.viewId])
    await localSourceViewApi.remove('1', { viewId: a.viewId, revision: a.revision })
    expect((await localSourceViewApi.list('1')).map((v) => v.viewName)).toEqual(['B'])
    for (let i = 0; i < SOURCE_VIEW_LIMIT; i++) await localSourceViewApi.add('1', { viewName: `V${i}` }).catch(() => undefined)
    await expect(localSourceViewApi.add('1', { viewName: '多一个' })).rejects.toThrow('最多 50 个')
    await expect(localSourceViewApi.add('', { viewName: 'A' })).rejects.toThrow('当前账号')
  })

  it('1012 版存在本机的视图（state：条件 + 手选清单 + 显示设置）读到时转成目录树', async () => {
    localStorage.setItem(sourceViewStorageKey('1'), JSON.stringify({ version: 1, views: [
      { viewId: 'a', viewName: '手选', state: { v: 1, status: 'all', scopeIds: ['7', '8'], hiddenColumns: ['url'], pageSize: 50 }, isDefault: false, revision: 2 },
      { viewId: 'b', viewName: '条件', state: { v: 1, status: 'E', scopeIds: null }, isDefault: false, revision: 0 },
    ] }))
    const [manual, cond] = await localSourceViewApi.list('1')
    expect(manual.tree.dirs[0]).toMatchObject({ name: '未归类', sources: ['7', '8'] })
    expect(manual.display).toMatchObject({ hiddenColumns: ['url'], pageSize: 50 })
    expect(cond.tree.convertedFromCondition).toBe(true)
    expect(cond.tree.dirs).toEqual([])
  })
})

describe('视图 ↔ 后端两段 JSON', () => {
  it('真实接口的 queryJson 只放目录上的排除（v3，按分类 ID）；旧的整棵树（测试数据，不迁移）当空', () => {
    expect(extrasFromJson(JSON.stringify({ v: 3, dirs: { 9: { groups: ['3'], excluded: ['5', '5'] }, 10: { excluded: [] } } }))).toEqual({ 9: { excluded: ['5'] } })
    expect(extrasFromJson(JSON.stringify({ v: 2, root: { sources: ['1'] }, dirs: [] }))).toEqual({})
    expect(extrasFromJson('不是 JSON')).toEqual({})
  })

  it('本机旧数据：1012 版的 queryJson（条件 / 手选清单）转成目录树；坏 JSON 当空树，不抛', () => {
    expect(treeFromJson(JSON.stringify({ v: 1, conditions: [], scopeIds: ['5'] })).dirs[0].sources).toEqual(['5'])
    expect(treeFromJson(JSON.stringify({ v: 1, status: 'E' })).convertedFromCondition).toBe(true)
    expect(treeFromJson('不是 JSON')).toEqual(emptyTree())
    expect(displayFromJson('{}')).toEqual(defaultDisplay())
    const display = { ...defaultDisplay(), hiddenColumns: ['url'], sortField: 'DATA_CNT', sortDirection: 'desc' as const, pageSize: 50 }
    expect(displayFromJson(JSON.stringify(display))).toEqual(display)
  })
})

const row = (over: Record<string, unknown> = {}) => ({
  viewId: '1', userId: 156, viewName: '联调', queryJson: JSON.stringify({ v: 3, dirs: {} }), displayJson: JSON.stringify(defaultDisplay()), sortNo: 0, isDefault: 0, revision: 0, isDelete: 0, createDt: '2026-10-12 16:45:51', updateDt: '2026-10-12 16:45:51', ...over,
})

/**
 * 假后端：分类表（带 rootViewId）+ 分类—源关系表 + 视图表，按 10-15 V3 实测口径应答：
 * category/add 不回 ID；addSources 带来源组时把当前成员展开成源行；delSources 带来源组时连当前成员的源行一起删。
 */
function fakeBackend() {
  const cats: { id: string; name: string; parentId: string; rootViewId: string; seq: number }[] = []
  const binds = new Map<string, Set<string>>()
  const groupBinds = new Map<string, Set<string>>()
  const of = (m: Map<string, Set<string>>, id: unknown) => { const k = String(id); if (!m.has(k)) m.set(k, new Set()); return m.get(k)! }
  let nextId = 9000
  const views = new Map<string, Record<string, unknown>>([['1', row()]])
  requestMock.mockImplementation(async (endpoint: string, _p: unknown, opts: { httpParams?: Record<string, unknown> }) => {
    const q = opts.httpParams ?? {}
    const sourceIds = ((q.sourceIds ?? []) as number[]).map(String)
    const groupIds = ((q.sourceGroupIds ?? []) as number[]).map(String)
    switch (endpoint) {
      case 'source-view/list': return [...views.values()]
      case 'source-view/add': { const v = row({ ...q, viewId: String(views.size + 1) }); views.set(String(v.viewId), v); return v }
      case 'source-view/update': { const v = { ...views.get(String(q.viewId)), ...q, revision: Number(q.revision) + 1 }; views.set(String(q.viewId), v); return v }
      case 'source-view/delete': views.delete(String(q.viewId)); return null
      case 'category/categoryPaged': return { list: cats.filter((c) => c.parentId === String(q.parentId) && c.rootViewId === String(q.rootViewId)).map((c) => ({ categoryId: Number(c.id), categoryName: c.name, parentId: Number(c.parentId), seq: c.seq })) }
      case 'category/add': cats.push({ id: String(nextId++), name: String(q.categoryName), parentId: String(q.parentId), rootViewId: String(q.rootViewId), seq: Number(q.seq ?? 0) }); return null
      case 'category/update': { const c = cats.find((x) => x.id === String(q.categoryId))!; if (q.categoryName) c.name = String(q.categoryName); if (q.parentId) c.parentId = String(q.parentId); return null }
      case 'category/delete': cats.splice(cats.findIndex((x) => x.id === String(q.id)), 1); return null
      case 'category/listSources': return { sourceIds: [...of(binds, q.categoryId)].map(Number), sourceGroupIds: [...of(groupBinds, q.categoryId)].map(Number) }
      case 'category/addSources': {
        const rows = of(binds, q.categoryId)
        const before = rows.size
        for (const g of groupIds) { of(groupBinds, q.categoryId).add(g); for (const m of groupMembers[g] ?? []) rows.add(m) }
        for (const id of sourceIds) rows.add(id)
        return rows.size - before
      }
      case 'category/delSources': {
        const rows = of(binds, q.categoryId)
        for (const g of groupIds) { of(groupBinds, q.categoryId).delete(g); for (const m of groupMembers[g] ?? []) rows.delete(m) }
        for (const id of sourceIds) rows.delete(id)
        return null
      }
      default: throw new Error(`没预料到的请求 ${endpoint}`)
    }
  })
  return { cats, binds, groupBinds, views }
}
const calls = (endpoint: string) => requestMock.mock.calls.filter(([e]) => e === endpoint).map(([, , o]) => o.httpParams as Record<string, unknown>)

describe('真实接口（开发环境联调口径）', () => {
  it('list：第一次调用探测成功后用真实接口；viewId 是字符串，revision 从 0；排除从 queryJson 读', async () => {
    requestMock.mockResolvedValueOnce([row(), row({ viewId: '3', viewName: 'B', isDefault: 1, revision: 2, queryJson: JSON.stringify({ v: 3, dirs: { 9001: { excluded: ['7'] } } }) })])
    const views = await sourceViewApi.list('7')
    expect(sourceViewBackend()).toBe('remote')
    expect(requestMock).toHaveBeenCalledWith('source-view/list', {}, expect.objectContaining({ method: 'GET', httpEndpoint: 'source-view/list', mode: 'http' }))
    expect(views.map((v) => [v.viewId, v.viewName, v.isDefault, v.revision])).toEqual([['1', '联调', false, 0], ['3', 'B', true, 2]])
    expect(views[1].dirExtras).toEqual({ 9001: { excluded: ['7'] } })
  })

  it('add / update：queryJson、displayJson 传字符串，userId 不传，isDefault 传 0 / 1，update 只带改了的字段', async () => {
    requestMock.mockResolvedValueOnce([])
    await sourceViewApi.list('7')
    requestMock.mockResolvedValueOnce(row({ viewName: '新' }))
    const created = await sourceViewApi.add('7', { viewName: ' 新 ', isDefault: true })
    const addBody = requestMock.mock.calls[1][2].httpParams
    expect(addBody).toMatchObject({ viewName: '新', isDefault: 1 })
    expect(JSON.parse(addBody.queryJson)).toEqual({ v: 3, dirs: {} })
    expect(typeof addBody.displayJson).toBe('string')
    expect(addBody).not.toHaveProperty('userId')
    expect(created.viewName).toBe('新')

    requestMock.mockResolvedValueOnce(row({ isDefault: 1, revision: 2 }))
    await sourceViewApi.update('7', { viewId: '1', revision: 1, isDefault: true })
    expect(requestMock.mock.calls[2][2].httpParams).toEqual({ viewId: '1', revision: 1, isDefault: 1 })
  })

  it('目录：一级 parentId=-1 带 rootViewId 新建（接口不回 ID 时按同级同名查回）；子目录挂到真实分类 ID 下；源按差量 addSources / delSources', async () => {
    const db = fakeBackend()
    const [view] = await sourceViewApi.list('7')
    const r = addDir(emptyTree(), null, '宏观')
    const r2 = addDir(r.tree, r.id, '统计局')
    const next = addSources(r2.tree, r2.id, ['430024679', '430024682'])
    const { tree } = await sourceViewApi.saveTree('7', view, emptyTree(), next)

    expect(calls('category/add')).toEqual([
      expect.objectContaining({ categoryName: '宏观', parentId: '-1', rootViewId: '1' }),
      expect.objectContaining({ categoryName: '统计局', parentId: '9000', rootViewId: '1' }),
    ])
    expect(tree.dirs.map((d) => [d.id, d.name, d.parentId])).toEqual([['9000', '宏观', null], ['9001', '统计局', '9000']])
    expect(calls('category/addSources')).toEqual([{ categoryId: 9001, sourceIds: [430024679, 430024682], sourceGroupIds: [] }])
    expect(calls('category/delSources')).toEqual([])
    expect(calls('source-view/update')).toEqual([]) // 没有排除，不动 queryJson

    // 读回来：逐层 categoryPaged（带 rootViewId）+ 每个目录 listSources
    expect(await sourceViewApi.loadTree('7', view)).toEqual({ v: 2, dirs: [
      { id: '9000', name: '宏观', parentId: null, sortNo: 0, sources: [], groups: [], excluded: [], rows: [] },
      { id: '9001', name: '统计局', parentId: '9000', sortNo: 0, sources: ['430024679', '430024682'], groups: [], excluded: [], rows: ['430024679', '430024682'] },
    ] })
    expect(calls('category/categoryPaged').every((q) => q.rootViewId === '1')).toBe(true)

    // 改名走 update；移出一个、加一个：只发差量
    requestMock.mockClear()
    const renamed = renameDir(tree, '9001', '国家统计局')
    const changed = { ...renamed, dirs: renamed.dirs.map((d) => (d.id === '9001' ? { ...d, sources: ['430024682', '430024683'] } : d)) }
    await sourceViewApi.saveTree('7', view, tree, changed)
    expect(calls('category/update')).toEqual([{ categoryId: '9001', rootViewId: '1', categoryName: '国家统计局' }])
    expect(calls('category/delSources')).toEqual([{ categoryId: 9001, sourceIds: [430024679], sourceGroupIds: [] }])
    expect(calls('category/addSources')).toEqual([{ categoryId: 9001, sourceIds: [430024683], sourceGroupIds: [] }])
    expect([...db.binds.get('9001')!]).toEqual(['430024682', '430024683'])
  })

  it('来源组：加组单独一次请求；读回时减掉后端展开的组成员；排除写 queryJson（带 revision）；删目录：子目录一起删，先清关联、深的先删', async () => {
    const db = fakeBackend()
    const [view] = await sourceViewApi.list('7')
    const a = addDir(emptyTree(), null, '宏观')
    const b = addDir(a.tree, a.id, '统计局')
    const withGroup = bindGroup(addSources(addSources(b.tree, b.id, ['1']), a.id, ['77']), a.id, '3')
    const first = await sourceViewApi.saveTree('7', view, emptyTree(), withGroup)
    expect(calls('category/addSources')).toEqual([
      { categoryId: 9000, sourceIds: [], sourceGroupIds: [3] },
      { categoryId: 9000, sourceIds: [77], sourceGroupIds: [] },
      { categoryId: 9001, sourceIds: [1], sourceGroupIds: [] },
    ])
    expect(calls('source-view/update')).toEqual([])
    expect([...db.binds.get('9000')!].sort()).toEqual(['501', '502', '77'].sort()) // 后端把组成员展开成了源行
    const reread = await sourceViewApi.loadTree('7', first.view)
    expect(reread.dirs[0]).toMatchObject({ groups: ['3'], sources: ['77'] }) // 展开的成员不算单独添加

    const excluded = { ...first.tree, dirs: first.tree.dirs.map((d) => (d.id === '9000' ? { ...d, excluded: ['502'] } : d)) }
    const saved = await sourceViewApi.saveTree('7', first.view, first.tree, excluded)
    expect(calls('source-view/update')).toEqual([expect.objectContaining({ viewId: '1', revision: 0 })])
    expect(JSON.parse(String(calls('source-view/update')[0].queryJson))).toEqual({ v: 3, dirs: { 9000: { excluded: ['502'] } } })

    requestMock.mockClear()
    await sourceViewApi.saveTree('7', saved.view, saved.tree, deleteDir(saved.tree, '9000'))
    const order = requestMock.mock.calls.map(([e, , o]) => `${e}:${o.httpParams.categoryId ?? o.httpParams.id ?? ''}`)
    // 先删组再删源，各自一次请求（同时传两类时后端只删一部分）
    expect(order).toEqual(['category/delSources:9001', 'category/delete:9001', 'category/delSources:9000', 'category/delSources:9000', 'category/delete:9000', 'source-view/update:'])
    expect(calls('category/delSources').slice(1)).toEqual([
      { categoryId: 9000, sourceIds: [], sourceGroupIds: [3] },
      { categoryId: 9000, sourceIds: [77], sourceGroupIds: [] },
    ])
    expect(db.cats).toEqual([])
    expect(JSON.parse(String(calls('source-view/update')[0].queryJson))).toEqual({ v: 3, dirs: {} })
  })

  it('解绑来源组时后端会连当前成员的源行一起删：要保留的（单独添加、又是组成员）删组后补加回去', async () => {
    const db = fakeBackend()
    const [view] = await sourceViewApi.list('7')
    const a = addDir(emptyTree(), null, '舆情')
    const first = await sourceViewApi.saveTree('7', view, emptyTree(), bindGroup(addSources(a.tree, a.id, ['77']), a.id, '3'))
    requestMock.mockClear()
    const kept = { ...first.tree, dirs: first.tree.dirs.map((d) => ({ ...d, groups: [], sources: ['77', '501'] })) } // 解绑并保留 501
    await sourceViewApi.saveTree('7', first.view, first.tree, kept)
    expect(requestMock.mock.calls.map(([e, , o]) => `${e}:${JSON.stringify([o.httpParams.sourceIds, o.httpParams.sourceGroupIds])}`)).toEqual([
      'category/delSources:[[],[3]]',
      'category/addSources:[[501],[]]',
      'category/listSources:[null,null]', // 源行变了的目录重读一次，「未在视图」据此重算
    ])
    expect([...db.binds.get('9000')!].sort()).toEqual(['501', '77'])
  })

  // 1016：后端绑定来源组时只展开当时的成员；组里之后新加的源读回来是「未在视图」，勾选加入后消失
  it('绑定来源组是快照：组里新加的源读回来不在 rows 里，算「未在视图」；加入后重读 rows', async () => {
    fakeBackend()
    const [view] = await sourceViewApi.list('7')
    const a = addDir(emptyTree(), null, '舆情')
    const first = await sourceViewApi.saveTree('7', view, emptyTree(), bindGroup(a.tree, a.id, '3'))
    expect(first.tree.dirs[0].rows?.sort()).toEqual(['501', '502'])
    groupMembers[3] = ['501', '502', '503']
    try {
      const tree = await sourceViewApi.loadTree('7', first.view)
      expect(missingOf(tree.dirs[0], { 3: groupMembers[3] })).toEqual([{ groupId: '3', ids: ['503'] }])
      const saved = await sourceViewApi.saveTree('7', first.view, tree, addSources(tree, tree.dirs[0].id, ['503']))
      expect(calls('category/addSources').at(-1)).toEqual({ categoryId: 9000, sourceIds: [503], sourceGroupIds: [] })
      expect(missingOf(saved.tree.dirs[0], { 3: groupMembers[3] })).toEqual([])
    } finally {
      groupMembers[3] = ['501', '502']
    }
  })

  // 10-15 后端支持排除：从目录 delSources 掉组成员 = 排除（sourcePaged 不再带出），addSources 加回 = 恢复
  it('排除 / 恢复同步到后端；解绑来源组时清掉的排除不加回去', async () => {
    const db = fakeBackend()
    const [view] = await sourceViewApi.list('7')
    const a = addDir(emptyTree(), null, '舆情')
    const first = await sourceViewApi.saveTree('7', view, emptyTree(), bindGroup(a.tree, a.id, '3'))
    const withEx = (t: ViewTree, ex: string[]) => ({ ...t, dirs: t.dirs.map((d) => ({ ...d, excluded: ex })) })

    requestMock.mockClear()
    const ex = await sourceViewApi.saveTree('7', first.view, first.tree, withEx(first.tree, ['502']))
    expect(calls('category/delSources')).toEqual([{ categoryId: 9000, sourceIds: [502], sourceGroupIds: [] }])
    expect([...db.binds.get('9000')!]).toEqual(['501'])

    requestMock.mockClear()
    const back = await sourceViewApi.saveTree('7', ex.view, ex.tree, withEx(ex.tree, []))
    expect(calls('category/addSources')).toEqual([{ categoryId: 9000, sourceIds: [502], sourceGroupIds: [] }])

    requestMock.mockClear()
    const ex2 = await sourceViewApi.saveTree('7', back.view, back.tree, withEx(back.tree, ['502']))
    requestMock.mockClear()
    await sourceViewApi.saveTree('7', ex2.view, ex2.tree, { ...ex2.tree, dirs: ex2.tree.dirs.map((d) => ({ ...d, groups: [], excluded: [] })) })
    expect(calls('category/delSources')).toEqual([{ categoryId: 9000, sourceIds: [], sourceGroupIds: [3] }])
    expect(calls('category/addSources')).toEqual([])
  })

  it('删视图：先删它的目录和源关系，再删视图', async () => {
    const db = fakeBackend()
    const [view] = await sourceViewApi.list('7')
    await sourceViewApi.saveTree('7', view, emptyTree(), treeWith('5'))
    requestMock.mockClear()
    await sourceViewApi.remove('7', view as SourceView)
    expect(requestMock.mock.calls.map(([e]) => e).filter((e) => e !== 'category/categoryPaged' && e !== 'category/listSources'))
      .toEqual(['category/delSources', 'category/delete', 'source-view/delete'])
    expect(db.cats).toEqual([])
    expect(db.views.size).toBe(0)
  })

  it('后端的业务报错只留原因（去掉「请求异常 […]」前缀）', async () => {
    requestMock.mockResolvedValueOnce([])
    await sourceViewApi.list('7')
    requestMock.mockRejectedValueOnce(new Error('请求异常 [source-view/add]: 请求失败 500: 错误信息:运行时异常：视图名称已存在，请更换名称'))
    await expect(sourceViewApi.add('7', { viewName: 'A' })).rejects.toThrow(/^视图名称已存在，请更换名称$/)
  })
})

describe('接口没上线时自动退回本机', () => {
  const missing = () => Object.assign(new Error('请求异常 [source-view/list]: 请求失败 500'), { cause: { status: 500 } })

  it('217 实测：list 回 HTTP 500 且没有任何业务说明 → 退回本机，页面照常能存能读，且不再反复探测', async () => {
    requestMock.mockRejectedValue(missing())
    expect(await sourceViewApi.list('7')).toEqual([])
    expect(sourceViewBackend()).toBe('local')
    const v = await sourceViewApi.add('7', { viewName: 'A' })
    expect((await sourceViewApi.list('7')).map((x) => x.viewId)).toEqual([v.viewId])
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it('只在「接口不存在」时退回：404 / 405 / 500 空 body 算；业务报错、网关 502、网络错误照常抛出，不悄悄写本机', async () => {
    expect(isEndpointMissing(Object.assign(new Error('请求失败 404'), { cause: { status: 404 } }))).toBe(true)
    expect(isEndpointMissing(missing())).toBe(true)
    expect(isEndpointMissing(Object.assign(new Error('请求异常 [x]: 请求失败 500: 视图已变化'), { cause: { status: 500 } }))).toBe(false)
    expect(isEndpointMissing(Object.assign(new Error('后端服务暂时不可用'), { cause: { status: 502 } }))).toBe(false)
    expect(isEndpointMissing(new Error('Failed to fetch'))).toBe(false)

    requestMock.mockRejectedValueOnce(Object.assign(new Error('后端服务暂时不可用，请稍后重试（502 source-view/list）'), { cause: { status: 502 } }))
    await expect(sourceViewApi.list('7')).rejects.toThrow('后端服务暂时不可用')
    expect(sourceViewBackend()).toBeNull()
  })
})

describe('接口上线后导入本机视图', () => {
  it('逐个 add（目录和源一并建到分类接口），重名的加（本机）后缀；全部成功才清掉本机数据', async () => {
    await localSourceViewApi.add('7', { viewName: '联调', tree: treeWith('1') })
    await localSourceViewApi.add('7', { viewName: '失败源' })
    const db = fakeBackend()
    await sourceViewApi.list('7')
    const result = await sourceViewApi.importLocal('7')
    expect(result).toEqual({ imported: 2, failed: [] })
    expect(calls('source-view/add').map((b) => b.viewName)).toEqual(['联调（本机）', '失败源'])
    expect(db.cats).toEqual([expect.objectContaining({ name: 'A', parentId: '-1', rootViewId: '2' })])
    expect([...db.binds.get(db.cats[0].id)!]).toEqual(['1'])
    expect(localStorage.getItem(sourceViewStorageKey('7'))).toBeNull()
  })

  it('中途失败：保留没导入成功的，下次还能再导', async () => {
    await localSourceViewApi.add('7', { viewName: 'A' })
    await localSourceViewApi.add('7', { viewName: 'B' })
    requestMock.mockResolvedValueOnce([])
    await sourceViewApi.list('7')
    requestMock.mockResolvedValueOnce([])
    requestMock.mockResolvedValueOnce(row({ viewName: 'A' }))
    requestMock.mockRejectedValueOnce(new Error('请求异常 [source-view/add]: 请求失败 500: 每人最多 50 个视图'))
    const result = await sourceViewApi.importLocal('7')
    expect(result.imported).toBe(1)
    expect(result.failed).toEqual(['B：每人最多 50 个视图'])
    expect(sourceViewApi.localViews('7').map((v) => v.viewName)).toEqual(['B'])
  })

  it('接口还没上线时不能导入', async () => {
    setSourceViewBackend('local')
    await expect(sourceViewApi.importLocal('7')).rejects.toThrow('接口还没上线')
  })
})
