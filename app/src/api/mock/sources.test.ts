// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mockSourcePaged, mockSourceDetail, mockSourceCreate, mockSourceUpdate, mockSourceNodeRuns, mockSourceSteps } from './sources'

describe('source mock 筛选', () => {
  it('支持外部变更待确认筛选', () => {
    const result = mockSourcePaged({ state: 'external', size: 999 })

    expect(result.total).toBeGreaterThan(0)
    expect(result.list.every((source) => source.externalChanged)).toBe(true)
  })
})

describe('新建 / 编辑源（0706 Phase3/4）', () => {
  it('createSource：源 ID 查重，重复创建被拦截', () => {
    const dup = mockSourceCreate({ source: { sourceId: '391007768', name: 'x', url: 'u', configId: '', mainTable: '', owner: '', state: 'C' } })
    expect(dup.ok).toBe(false)
    expect(dup.message).toContain('已存在')
  })

  it('updateSource：真写回 SOURCES，sourceDetail 可见变更；未知源报错', () => {
    const before = mockSourceDetail({ sourceId: '391007768' })
    const res = mockSourceUpdate({ source: { ...before, tags: ['A', 'B'] } })
    expect(res.ok).toBe(true)
    expect(mockSourceDetail({ sourceId: '391007768' }).tags).toEqual(['A', 'B'])
    expect(mockSourceUpdate({ source: { sourceId: 'ghost-404', name: '', url: '', configId: '', mainTable: '', owner: '', state: 'C' } }).ok).toBe(false)
  })
})

describe('节点粒度运行统计（0706 Phase4·任务视图=运行视图）', () => {
  it('nodeRunStats：与 sourceSteps 的步骤 id 同口径，含队列/总数/已处理/状态', () => {
    const stats = mockSourceNodeRuns({ sourceId: '391007768' })
    const stepIds = mockSourceSteps({ sourceId: '391007768' }).map((s) => s.stepId)
    expect(stats.length).toBe(2)
    stats.forEach((s) => {
      expect(stepIds).toContain(s.nodeId)
      expect(s.totalTasks).toBeGreaterThanOrEqual(s.processedTasks)
    })
  })

  it('nodeRunStats：未知源返回空数组', () => {
    expect(mockSourceNodeRuns({ sourceId: 'ghost-404' })).toEqual([])
  })
})
