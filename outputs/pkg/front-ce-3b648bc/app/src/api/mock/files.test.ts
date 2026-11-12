// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mockDataRowQueryPaged } from './dataview'
import { mockFilePaged, mockFileResourceRows, mockFileStats } from './files'
import { mockSourceDetail, mockSourceNodeRuns, mockSourceTaskPaged } from './sources'

describe('原始文件 mock（0812 计划 M3-1：字段对齐旧平台 page/inst/FileList.vue，attachId 是主键、fileId 是批次ID）', () => {
  it('filePaged：真实存在的源可查到文件，未知源返回空', () => {
    const res = mockFilePaged({ siteId: 'site-notice', sourceId: '600519', page: 1, size: 10 })
    expect(res.total).toBeGreaterThan(0)
    expect(res.list.length).toBeGreaterThan(0)
    expect(res.list.every((f) => f.sourceId === '600519')).toBe(true)
    expect(res.list.every((f) => f.state === 'C')).toBe(true)

    const ghost = mockFilePaged({ siteId: 'site-notice', sourceId: 'ghost-source-id', page: 1, size: 10 })
    expect(ghost.total).toBe(0)
    expect(ghost.list).toEqual([])
  })

  it('filePaged：sourceId 省略时返回网站全部源的文件', () => {
    const page = mockFilePaged({ siteId: 'site-notice', page: 1, size: 999 })
    expect(page.list.length).toBeGreaterThan(0)
    expect(new Set(page.list.map((file) => file.sourceId)).size).toBeGreaterThan(1)
  })

  it('file_resource：sourceId 省略时返回全平台文件，供文件中心默认范围使用', () => {
    const page = mockFileResourceRows({ page: 1, size: 999 })
    expect(page.list.length).toBeGreaterThan(0)
    expect(new Set(page.list.map((row) => row.sourceId)).size).toBeGreaterThan(1)
  })

  it('两个演示网站均提供可预览、可下载的首条抓取文件', () => {
    const demos = [
      { siteId: 'site-news', sourceId: 'NEWS5521', attachId: 'NEWS5521-demo-cover' },
      { siteId: 'site-notice', sourceId: '600519', attachId: '600519-demo-cover' },
    ]

    demos.forEach(({ siteId, sourceId, attachId }) => {
      const first = mockFilePaged({ siteId, sourceId, page: 1, size: 1 }).list[0]
      expect(first.attachId).toBe(attachId)
      expect(first.contentType).toBe('image/svg+xml')
      expect(first.viewUrl).toMatch(/^data:image\/svg\+xml/)
      expect(first.downloadUrl).toBe(first.viewUrl)
    })
  })

  it('两个演示网站的流程、数据、任务和文件使用同一源口径', () => {
    const demos = [
      { siteId: 'site-news', sourceId: 'NEWS5521', mainTable: '2103330', lastSuccessAt: '2026-06-19 08:06:20' },
      { siteId: 'site-notice', sourceId: '600519', mainTable: '2101001', lastSuccessAt: '2026-06-19 07:01:05' },
    ]

    demos.forEach(({ siteId, sourceId, mainTable, lastSuccessAt }) => {
      const source = mockSourceDetail({ sourceId })
      expect(source).not.toBeNull()
      expect(source?.siteId).toBe(siteId)
      expect(source?.mainTable).toBe(mainTable)

      const data = mockDataRowQueryPaged({ siteId, sourceId, tableId: mainTable, page: 1, size: 20 })
      expect(data.total).toBe(12)
      expect(data.list.every((row) => row.sourceId === sourceId)).toBe(true)

      const tasks = mockSourceTaskPaged({ siteId, sourceId, page: 1, size: 20 })
      expect(tasks.total).toBe(6)
      expect(tasks.list.every((task) => task.sourceId === sourceId)).toBe(true)

      const nodeRuns = mockSourceNodeRuns({ sourceId })
      expect(nodeRuns).toHaveLength(2)
      expect(nodeRuns[0].totalTasks).toBe(source?.dataCount)

      const files = mockFilePaged({ siteId, sourceId, page: 1, size: 1 })
      expect(files.list[0].createDt).toBe(lastSuccessAt)
      expect(mockFileStats({ siteId, sourceId }).latestCreatedAt).toBe(lastSuccessAt)
    })
  })

  it('filePaged：按节点 / 批次ID / 类型过滤', () => {
    const all = mockFilePaged({ siteId: 'site-notice', sourceId: '600519', page: 1, size: 999 }).list
    const nodeId = all[0].nodeId
    const byNode = mockFilePaged({ siteId: 'site-notice', sourceId: '600519', nodeId, page: 1, size: 999 })
    expect(byNode.list.every((f) => f.nodeId === nodeId)).toBe(true)
    expect(byNode.total).toBeLessThan(all.length)

    const fileId = all[0].fileId
    const byBatch = mockFilePaged({ siteId: 'site-notice', sourceId: '600519', fileId, page: 1, size: 999 })
    expect(byBatch.list.every((f) => f.fileId === fileId)).toBe(true)

    const byExt = mockFilePaged({ siteId: 'site-notice', sourceId: '600519', ext: 'html', page: 1, size: 999 })
    expect(byExt.list.every((f) => f.contentType.includes('html'))).toBe(true)
    expect(byExt.list.length).toBeGreaterThan(0)
  })

  it('filePaged：分页参数生效', () => {
    const page1 = mockFilePaged({ siteId: 'site-notice', sourceId: '600519', page: 1, size: 2 })
    const page2 = mockFilePaged({ siteId: 'site-notice', sourceId: '600519', page: 2, size: 2 })
    expect(page1.list.length).toBe(2)
    expect(page1.list.map((f) => f.attachId)).not.toEqual(page2.list.map((f) => f.attachId))
    expect(page1.total).toBe(page2.total)
  })

  it('fileStats：total 与 filePaged 的 total 一致', () => {
    const stats = mockFileStats({ siteId: 'site-notice', sourceId: '600519' })
    const all = mockFilePaged({ siteId: 'site-notice', sourceId: '600519', page: 1, size: 999 })
    expect(stats.total).toBe(all.total)
    expect(stats.totalSize).toBe(all.list.reduce((n, f) => n + f.fileSize, 0))
    expect(stats).not.toHaveProperty('failed')
    expect(stats.latestCreatedAt).toBeTruthy()
  })

  it('fileStats：未知源返回全零统计', () => {
    const stats = mockFileStats({ siteId: 'site-notice', sourceId: 'ghost-source-id' })
    expect(stats).toEqual({ total: 0, totalSize: 0, latestCreatedAt: undefined })
  })
})
