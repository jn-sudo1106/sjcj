// 加入来源组前处理源自己的流程（1021-03）：只查未入组的源；先解绑再入组；解绑失败的源不入组；按当前归属分批入组。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sourceGroupApi, workflowBindingApi, type SourceFlowsView } from '@/api'
import { findOwnFlows, joinGroup, joinResultText } from './groupJoin'

const viewOf = (sourceId: string, ownFlowIds: string[] = []): SourceFlowsView => ({
  sourceId, flowIds: ownFlowIds, bindings: [], ownFlowIds, ownDefaultFlowId: ownFlowIds[0], ownBindings: [],
})

afterEach(() => vi.restoreAllMocks())

describe('groupJoin', () => {
  it('findOwnFlows：只查未入组的源，按勾选顺序返回有自有流程的', async () => {
    const view = vi.spyOn(workflowBindingApi, 'view').mockImplementation(async (id) => viewOf(id, id === '1' || id === '3' ? [`f${id}`] : []))
    const rows = await findOwnFlows([
      { sourceId: '3', name: '丙' }, { sourceId: '2', name: '乙' }, { sourceId: '9', name: '组内', sourceGroupId: '7' }, { sourceId: '1', name: '甲' },
    ])
    expect(view).toHaveBeenCalledTimes(3)
    expect(view).not.toHaveBeenCalledWith('9')
    expect(rows.map((r) => [r.sourceId, r.ownFlowIds, r.ownDefaultFlowId])).toEqual([['3', ['f3'], 'f3'], ['1', ['f1'], 'f1']])
  })

  it('joinGroup：先清空自有流程再入组；解绑失败的源不入组；按当前归属分批', async () => {
    const order: string[] = []
    vi.spyOn(workflowBindingApi, 'save').mockImplementation(async (id) => {
      order.push(`unbind:${id}`)
      if (id === '2') throw new Error('并发冲突')
    })
    vi.spyOn(sourceGroupApi, 'changeMembers').mockImplementation(async (input) => {
      order.push(`join:${input.expectedSourceGroupId}:${input.sourceIds.join(',')}`)
      return { ok: true, message: '操作成功' }
    })
    const result = await joinGroup({
      groupId: '9',
      sources: [{ sourceId: '1', name: '甲' }, { sourceId: '2', name: '乙' }, { sourceId: '4', name: '丁' }, { sourceId: '5', name: '换组', sourceGroupId: '7' }],
      unbindIds: ['1', '2'],
    })
    expect(order.slice(0, 2).sort()).toEqual(['unbind:1', 'unbind:2'])
    expect(order.slice(2)).toEqual(['join:null:1,4', 'join:7:5'])
    expect(result).toEqual({ joined: 3, failures: [{ sourceId: '2', step: 'unbind', message: '并发冲突' }] })
    expect(joinResultText(result)).toBe('已加入 3 个源；2（解除自有流程失败：并发冲突）未加入')
  })

  it('joinGroup：入组失败的一批全部记失败', async () => {
    vi.spyOn(sourceGroupApi, 'changeMembers').mockRejectedValue(new Error('组已停用'))
    const result = await joinGroup({ groupId: '9', sources: [{ sourceId: '1', name: '甲' }, { sourceId: '2', name: '乙' }], unbindIds: [] })
    expect(result.joined).toBe(0)
    expect(result.failures.map((f) => [f.sourceId, f.step])).toEqual([['1', 'join'], ['2', 'join']])
    expect(joinResultText({ joined: 2, failures: [] })).toBe('已加入来源组 2 个源')
  })
})
