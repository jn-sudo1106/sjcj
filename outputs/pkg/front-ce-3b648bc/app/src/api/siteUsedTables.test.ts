// siteApi.siteUsedTables（0924-09）的请求编排：按流程去重、并发上限 4、单流程失败不阻断、结果缓存。
// 聚合规则本身见 utils/site/usedTables.test.ts。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dataApi, flowCenterApi, itemApi, siteApi, type Source, type Step } from './index'
import * as client from './client'

const src = (sourceId: string, flowId: string | undefined, mainTable = '900') =>
  ({ sourceId, flowId, mainTable, name: sourceId, url: '', configId: '', owner: '', state: 'C' }) as Source

function mockCatalog() {
  vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue({
    list1: [{ tableId: '900', tableName: 'sense_data.TB_CNEWS', name: '新闻表' }],
    list2: [],
    list3: [{ tableId: '6200023', tableName: 'sense_data.TB_FILE', name: '文件资源表' }],
  } as never)
}

describe('siteApi.siteUsedTables', () => {
  afterEach(() => vi.restoreAllMocks())

  it('按流程去重查节点，且不补查配置详情（withConfigDetails: false）', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([src('s1', 'f1'), src('s2', 'f1'), src('s3', undefined)])
    mockCatalog()
    const steps = vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([{ outputTable: '6200023' } as Step])

    const result = await siteApi.siteUsedTables('site-a', { force: true })

    expect(steps).toHaveBeenCalledTimes(1)
    expect(steps).toHaveBeenCalledWith('f1', { withConfigDetails: false })
    expect(result.tables.map((t) => [t.tableId, t.sourceCnt, t.name])).toEqual([
      ['900', 3, '新闻表'],
      ['6200023', 2, '文件资源表'],
    ])
    expect(result.noFlowSourceCnt).toBe(1)
    expect(result.failedFlowIds).toEqual([])
  })

  it('同时在飞的流程请求不超过 4 个', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue(Array.from({ length: 10 }, (_, i) => src(`s${i}`, `f${i}`)))
    mockCatalog()
    let inFlight = 0
    let peak = 0
    vi.spyOn(flowCenterApi, 'steps').mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return []
    })

    await siteApi.siteUsedTables('site-b', { force: true })
    expect(peak).toBeLessThanOrEqual(4)
  })

  it('单个流程失败不阻断：记进 failedFlowIds，其余照常出表', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([src('s1', 'f-ok'), src('s2', 'f-bad', '6200027')])
    mockCatalog()
    vi.spyOn(flowCenterApi, 'steps').mockImplementation(async (flowId) => {
      if (flowId === 'f-bad') throw new Error('502')
      return [{ outputTable: '6200023' } as Step]
    })

    const result = await siteApi.siteUsedTables('site-c', { force: true })
    expect(result.failedFlowIds).toEqual(['f-bad'])
    expect(result.tables.map((t) => t.tableId).sort()).toEqual(['6200023', '6200027', '900'])
  })

  it('同一网站命中缓存不重复请求；force 或 refreshSiteUsedTables 后重拉；失败不缓存', async () => {
    const sources = vi.spyOn(siteApi, 'siteSources').mockResolvedValue([src('s1', 'f1')])
    mockCatalog()
    vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([])

    await siteApi.siteUsedTables('site-d', { force: true })
    await siteApi.siteUsedTables('site-d')
    expect(sources).toHaveBeenCalledTimes(1)

    siteApi.refreshSiteUsedTables('site-d')
    await siteApi.siteUsedTables('site-d')
    expect(sources).toHaveBeenCalledTimes(2)

    sources.mockRejectedValueOnce(new Error('502'))
    await expect(siteApi.siteUsedTables('site-e')).rejects.toThrow('502')
    await siteApi.siteUsedTables('site-e')
    expect(sources).toHaveBeenCalledTimes(4)
  })

  it('节点写接口成功后缓存作废（输入 / 输出表可能变了）；写失败不作废', async () => {
    const sources = vi.spyOn(siteApi, 'siteSources').mockResolvedValue([src('s1', 'f1')])
    mockCatalog()
    vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([])
    const req = vi.spyOn(client, 'request')

    await siteApi.siteUsedTables('site-f', { force: true })
    req.mockResolvedValueOnce({ ok: true, message: '' })
    await itemApi.stepModify({ stepId: 'x' } as unknown as Step)
    await siteApi.siteUsedTables('site-f')
    expect(sources).toHaveBeenCalledTimes(2)

    req.mockRejectedValueOnce(new Error('502'))
    await expect(itemApi.deleteStep('x')).rejects.toThrow('502')
    await siteApi.siteUsedTables('site-f')
    expect(sources).toHaveBeenCalledTimes(2)
  })

  it('超过 60 秒自动重拉', async () => {
    vi.useFakeTimers()
    try {
      const sources = vi.spyOn(siteApi, 'siteSources').mockResolvedValue([src('s1', 'f1')])
      mockCatalog()
      vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([])
      await siteApi.siteUsedTables('site-g', { force: true })
      vi.advanceTimersByTime(59_000)
      await siteApi.siteUsedTables('site-g')
      expect(sources).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(2_000)
      await siteApi.siteUsedTables('site-g')
      expect(sources).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
