import { afterEach, describe, expect, it, vi } from 'vitest'
import { sourceGroupApi, workflowBindingApi } from '@/api'
import { joinGroup, joinResultText } from './groupJoin'

afterEach(() => vi.restoreAllMocks())

describe('groupJoin', () => {
  it('保留自有流程，直接按当前归属分批入组，跳过已在目标组的源', async () => {
    const save = vi.spyOn(workflowBindingApi, 'save')
    const view = vi.spyOn(workflowBindingApi, 'view')
    const change = vi.spyOn(sourceGroupApi, 'changeMembers').mockResolvedValue({ ok: true, message: '操作成功' })
    const result = await joinGroup({ groupId: '9', sources: [
      { sourceId: '1', name: '甲' }, { sourceId: '2', name: '乙' },
      { sourceId: '5', name: '换组', sourceGroupId: '7' }, { sourceId: '6', name: '已入组', sourceGroupId: '9' },
    ] })
    expect(save).not.toHaveBeenCalled()
    expect(view).not.toHaveBeenCalled()
    expect(change).toHaveBeenCalledTimes(2)
    expect(change).toHaveBeenCalledWith({ sourceIds: ['1', '2'], sourceGroupId: '9', expectedSourceGroupId: null })
    expect(change).toHaveBeenCalledWith({ sourceIds: ['5'], sourceGroupId: '9', expectedSourceGroupId: '7' })
    expect(result).toEqual({ joined: 3, failures: [] })
    expect(joinResultText(result)).toBe('已加入来源组 3 个源')
  })

  it('一批失败后仍处理后续批次，失败来源保留原有绑定', async () => {
    const save = vi.spyOn(workflowBindingApi, 'save')
    vi.spyOn(sourceGroupApi, 'changeMembers').mockRejectedValueOnce(new Error('并发冲突')).mockResolvedValueOnce({ ok: true, message: '操作成功' })
    const result = await joinGroup({ groupId: '9', sources: [{ sourceId: '1', name: '甲' }, { sourceId: '2', name: '换组', sourceGroupId: '7' }] })
    expect(save).not.toHaveBeenCalled()
    expect(result).toEqual({ joined: 1, failures: [{ sourceId: '1', step: 'join', message: '并发冲突' }] })
    expect(joinResultText(result)).toBe('已加入 1 个源；1（加入失败：并发冲突）未加入')
  })

  it('后端拒绝回执不能当作成功', async () => {
    vi.spyOn(sourceGroupApi, 'changeMembers').mockResolvedValue({ ok: false, message: '组已停用' })
    const result = await joinGroup({ groupId: '9', sources: [{ sourceId: '1', name: '甲' }, { sourceId: '2', name: '乙' }] })
    expect(result.joined).toBe(0)
    expect(result.failures).toEqual([{ sourceId: '1', step: 'join', message: '组已停用' }, { sourceId: '2', step: 'join', message: '组已停用' }])
  })
})
