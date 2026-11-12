// @vitest-environment jsdom
// 组 ID → 组名 本地映射：读写往返、展示文案（名称（ID）/ 裸 ID 回退）、脏数据容错、存储不可用降级。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearGroupNames, groupLabel, groupName, readGroupNames, setGroupName } from './groupNames'

describe('groupNames', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('录入后可读回；展示文案是「名称（ID）」，未录入回退裸 ID', () => {
    setGroupName(100001, '研发一组')
    expect(groupName(100001)).toBe('研发一组')
    expect(groupLabel(100001)).toBe('研发一组（100001）')
    expect(groupLabel(100002)).toBe('100002')
  })

  it('空名等于删除映射；名字超长截断到 50 字符', () => {
    setGroupName(100001, '研发一组')
    setGroupName(100001, '   ')
    expect(groupName(100001)).toBe('')

    setGroupName(100002, 'x'.repeat(80))
    expect(groupName(100002)).toBe('x'.repeat(50))
  })

  it('非数字组 ID 拒绝写入', () => {
    setGroupName('abc' as unknown as number, '坏数据')
    expect(readGroupNames()).toEqual({})
  })

  it('存储里的脏数据（非对象 / 数字键名 / 空值）读取时被过滤', () => {
    localStorage.setItem('groupRes.groupNames.v1', '{"100001":"研发一组","bad":"","2":"x"}')
    expect(readGroupNames()).toEqual({ '100001': '研发一组', '2': 'x' })

    localStorage.setItem('groupRes.groupNames.v1', '[1,2]')
    expect(readGroupNames()).toEqual({})
    localStorage.setItem('groupRes.groupNames.v1', '{oops')
    expect(readGroupNames()).toEqual({})
  })

  it('localStorage 不可用时静默降级（读回空、写不抛）', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('disabled')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('disabled')
    })
    expect(readGroupNames()).toEqual({})
    expect(() => setGroupName(100001, '研发一组')).not.toThrow()
    expect(groupLabel(100001)).toBe('100001')
  })

  it('clearGroupNames 清空全部映射', () => {
    setGroupName(100001, '研发一组')
    clearGroupNames()
    expect(readGroupNames()).toEqual({})
  })
})
