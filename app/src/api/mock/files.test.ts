// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mockFilePaged, mockFileStats } from './files'

describe('原始文件 mock（0711 R11：仅子源态，按 sourceId 聚合）', () => {
  it('filePaged：真实存在的子源可查到文件，未知子源返回空', () => {
    const res = mockFilePaged({ sourceId: '600519', page: 1, size: 10 })
    expect(res.total).toBeGreaterThan(0)
    expect(res.list.length).toBeGreaterThan(0)
    expect(res.list.every((f) => f.sourceId === '600519')).toBe(true)

    const ghost = mockFilePaged({ sourceId: 'ghost-source-id', page: 1, size: 10 })
    expect(ghost.total).toBe(0)
    expect(ghost.list).toEqual([])
  })

  it('filePaged：按节点 / 类型 / 状态过滤', () => {
    const all = mockFilePaged({ sourceId: '600519', page: 1, size: 999 }).list
    const nodeId = all[0].nodeId
    const byNode = mockFilePaged({ sourceId: '600519', nodeId, page: 1, size: 999 })
    expect(byNode.list.every((f) => f.nodeId === nodeId)).toBe(true)
    expect(byNode.total).toBeLessThan(all.length)

    const byType = mockFilePaged({ sourceId: '600519', contentType: 'html', page: 1, size: 999 })
    expect(byType.list.every((f) => f.contentType === 'html')).toBe(true)

    const byState = mockFilePaged({ sourceId: '600519', state: 'E', page: 1, size: 999 })
    expect(byState.list.every((f) => f.state === 'E')).toBe(true)
  })

  it('filePaged：分页参数生效', () => {
    const page1 = mockFilePaged({ sourceId: '600519', page: 1, size: 2 })
    const page2 = mockFilePaged({ sourceId: '600519', page: 2, size: 2 })
    expect(page1.list.length).toBe(2)
    expect(page1.list.map((f) => f.fileId)).not.toEqual(page2.list.map((f) => f.fileId))
    expect(page1.total).toBe(page2.total)
  })

  it('fileStats：total 与 filePaged 的 total 一致；totalSize/failed 统计正确', () => {
    const stats = mockFileStats({ sourceId: '600519' })
    const all = mockFilePaged({ sourceId: '600519', page: 1, size: 999 })
    expect(stats.total).toBe(all.total)
    expect(stats.totalSize).toBe(all.list.reduce((n, f) => n + f.size, 0))
    expect(stats.failed).toBe(all.list.filter((f) => f.state === 'E').length)
    expect(stats.latestCreatedAt).toBeTruthy()
  })

  it('fileStats：未知子源返回全零统计', () => {
    const stats = mockFileStats({ sourceId: 'ghost-source-id' })
    expect(stats).toEqual({ total: 0, totalSize: 0, failed: 0, latestCreatedAt: undefined })
  })
})
