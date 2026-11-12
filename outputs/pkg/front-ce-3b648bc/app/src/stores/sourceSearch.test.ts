// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from './auth'
import { sourceSearchListPath, sourceSearchRoute, useSourceSearchStore, type SourceSearchOrigin } from './sourceSearch'
import { blankSourceListViewState } from '@/views/FlowCanvas/result/sourceListViewState'

export function searchOrigin(patch: Partial<SourceSearchOrigin> = {}): SourceSearchOrigin {
  return {
    query: { name: '公告', count: 0, sourceGroupId: '88', directory: { kind: 'biz', mode: 'selected', selections: [{ id: '9', includeDescendants: true }] } },
    empty: false, viewState: blankSourceListViewState(), page: 2, total: 30,
    scrollTop: 244, scrollLeft: 32, label: '我的分组', returnTo: '/collect?tab=personal&group=88', ...patch,
  }
}
beforeEach(() => { sessionStorage.clear(); setActivePinia(createPinia()) })
describe('搜索上下文', () => {
  it('复制成功查询，不随草稿或其他源页签的查询改变；只保存查询元数据', () => {
    const store = useSourceSearchStore()
    const origin = searchOrigin()
    const first = store.create(origin)
    origin.query.name = '修改中的草稿'
    const second = store.create(searchOrigin({ query: { sourceIds: '' }, empty: true }))
    expect(store.get(first)?.query).toMatchObject({ name: '公告', count: 0, sourceGroupId: '88' })
    expect(store.get(second)).toMatchObject({ empty: true, query: { sourceIds: '' } })
    expect(store.get(first)).not.toHaveProperty('rows')
    expect(sourceSearchRoute(first)).toEqual({ sourceSearch: first, returnTo: `/collect?tab=personal&group=88&sourceSearchReturn=${first}` })
  })
  it('会话刷新后恢复条件与位置，账号切换不串查询', () => {
    const first = useSourceSearchStore().create(searchOrigin())
    setActivePinia(createPinia())
    const store = useSourceSearchStore()
    expect(store.get(first)).toMatchObject({ page: 2, scrollTop: 244, scrollLeft: 32 })
    useAuthStore().info = { id: 2 } as never
    expect(store.get(first)).toBeUndefined()
  })
  it('返回地址移除上一次的返回标记，不把上下文递归塞进地址；拒绝外部地址', () => {
    expect(sourceSearchListPath('/collect?tab=views&sourceSearchReturn=old', 'new')).toBe('/collect?tab=views&sourceSearchReturn=new')
    expect(sourceSearchListPath('//example.com', 'new')).toBe('/collect?sourceSearchReturn=new')
  })
})
