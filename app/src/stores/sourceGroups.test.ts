// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useAuthStore } from './auth'
import { sourceGroupStorageKey, useSourceGroupsStore } from './sourceGroups'
import type { UserInfo } from '@/api/auth'
function account(id: number) { useAuthStore().info = { id } as UserInfo }
beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()); account(1) })
describe('个人源目录本机保存', () => {
  it('按账号隔离，重新初始化恢复，登出清空内存', async () => {
    const store = useSourceGroupsStore()
    store.saveGroup('宏观组')
    account(2); await nextTick()
    expect(store.groups).toEqual([])
    store.saveGroup('地产组')
    account(1); await nextTick()
    expect(store.groups.map(g => g.name)).toEqual(['宏观组'])
    useAuthStore().info = null; await nextTick()
    expect(store.groups).toEqual([])
    expect(() => store.saveGroup('匿名组')).toThrow('账号')
    setActivePinia(createPinia()); account(2)
    expect(useSourceGroupsStore().groups.map(g => g.name)).toEqual(['地产组'])
  })
  it('允许多组引用、去重、移动和移出，不影响其他组', () => {
    const store = useSourceGroupsStore()
    const a = store.saveGroup('宏观组'), b = store.saveGroup('地产组'), c = store.saveGroup('其他组')
    store.assign(['10', '10', '20'], [a, b])
    store.assign(['10'], [c], a)
    expect(store.groups.find(g => g.id === a)?.sourceIds).toEqual(['20'])
    expect(store.groups.find(g => g.id === b)?.sourceIds).toEqual(['10', '20'])
    store.removeMembers(b, ['10'])
    expect(store.groups.find(g => g.id === c)?.sourceIds).toEqual(['10'])
  })
  it('两级目录校验、重命名、移动与删除子树', () => {
    const store = useSourceGroupsStore()
    const a = store.saveGroup('宏观组'), b = store.saveGroup('地产组'), child = store.saveGroup('统计局', a)
    expect(() => store.saveGroup('三级', child)).toThrow('两级')
    expect(() => store.saveGroup('宏观组')).toThrow('重复')
    expect(() => store.saveGroup('宏观组', b, a)).toThrow('两级')
    store.saveGroup('地产统计', b, child)
    store.deleteGroup(a)
    expect(store.groups.map(g => g.name)).toEqual(['地产组', '地产统计'])
    store.deleteGroup(b)
    expect(store.groups).toEqual([])
  })
  it('固定默认不受临时切换影响；上次目录单独记录', () => {
    const store = useSourceGroupsStore()
    expect(store.defaultMode).toBe('system')
    store.remember('personal')
    expect(store.defaultMode).toBe('system')
    store.setPreference('last')
    expect(store.defaultMode).toBe('personal')
    store.setPreference('personal'); store.remember('system')
    expect(store.defaultMode).toBe('personal')
  })
  it('损坏数据不覆盖；写入失败不伪装保存成功', () => {
    const store = useSourceGroupsStore()
    store.saveGroup('已保存')
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('空间不足') })
    expect(() => store.saveGroup('不能保存')).toThrow('空间不足')
    expect(store.groups.map(g => g.name)).toEqual(['已保存'])
    spy.mockRestore()
    localStorage.setItem(sourceGroupStorageKey('1'), 'broken')
    expect(() => store.saveGroup('不能覆盖')).toThrow()
    expect(localStorage.getItem(sourceGroupStorageKey('1'))).toBe('broken')
  })
})
