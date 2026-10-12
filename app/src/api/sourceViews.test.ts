// @vitest-environment jsdom
// 「我的视图」存取（2026-10-12）：后端接口出来前存本机；校验口径按给后端的接口约定。
import { beforeEach, describe, expect, it } from 'vitest'
import { SOURCE_VIEW_LIMIT, sourceViewApi, sourceViewStorageKey } from './sourceViews'
import { blankSourceListViewState } from '@/views/FlowCanvas/result/sourceListViewState'

const state = (status: 'all' | 'E' = 'all') => ({ ...blankSourceListViewState(), status })

beforeEach(() => localStorage.clear())

describe('sourceViewApi（本机）', () => {
  it('按用户隔离：A 建的视图 B 看不到', async () => {
    await sourceViewApi.add('1', { viewName: '广发 · 失败', state: state('E') })
    expect((await sourceViewApi.list('1')).map((v) => v.viewName)).toEqual(['广发 · 失败'])
    expect(await sourceViewApi.list('2')).toEqual([])
    expect(localStorage.getItem(sourceViewStorageKey('1'))).toContain('广发 · 失败')
  })

  it('名称 1–40 字、同一用户不重名；重命名可以保持原名', async () => {
    const v = await sourceViewApi.add('1', { viewName: '  视图A  ', state: state() })
    expect(v.viewName).toBe('视图A')
    await expect(sourceViewApi.add('1', { viewName: '视图A', state: state() })).rejects.toThrow('已有同名视图')
    await expect(sourceViewApi.add('1', { viewName: ' ', state: state() })).rejects.toThrow('1–40')
    await expect(sourceViewApi.add('1', { viewName: 'x'.repeat(41), state: state() })).rejects.toThrow('1–40')
    await expect(sourceViewApi.update('1', { viewId: v.viewId, revision: v.revision, viewName: '视图A' })).resolves.toMatchObject({ viewName: '视图A' })
  })

  it('保存带 revision：拿旧 revision 再写报「视图已变化」', async () => {
    const v = await sourceViewApi.add('1', { viewName: 'A', state: state() })
    const saved = await sourceViewApi.update('1', { viewId: v.viewId, revision: v.revision, state: state('E') })
    expect(saved.revision).toBe(v.revision + 1)
    expect(saved.state.status).toBe('E')
    await expect(sourceViewApi.update('1', { viewId: v.viewId, revision: v.revision, viewName: 'B' })).rejects.toThrow('视图已变化')
  })

  it('默认进入只能有一个', async () => {
    const a = await sourceViewApi.add('1', { viewName: 'A', state: state(), isDefault: true })
    const b = await sourceViewApi.add('1', { viewName: 'B', state: state() })
    await sourceViewApi.update('1', { viewId: b.viewId, revision: b.revision, isDefault: true })
    const list = await sourceViewApi.list('1')
    expect(list.filter((v) => v.isDefault).map((v) => v.viewId)).toEqual([b.viewId])
    expect(list.find((v) => v.viewId === a.viewId)!.revision).toBe(a.revision + 1)
  })

  it('删除；每人上限 50 个；没有账号不能写', async () => {
    const v = await sourceViewApi.add('1', { viewName: 'A', state: state() })
    await sourceViewApi.remove('1', { viewId: v.viewId, revision: v.revision })
    expect(await sourceViewApi.list('1')).toEqual([])
    for (let i = 0; i < SOURCE_VIEW_LIMIT; i++) await sourceViewApi.add('1', { viewName: `V${i}`, state: state() })
    await expect(sourceViewApi.add('1', { viewName: '多一个', state: state() })).rejects.toThrow('最多 50 个')
    await expect(sourceViewApi.add('', { viewName: 'A', state: state() })).rejects.toThrow('当前账号')
  })
})
