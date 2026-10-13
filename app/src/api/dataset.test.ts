// 指标数据集接口层（旧 data-view `src/api/dataset.js`）。
// 这一层守的是**请求契约**：打到哪条路径、什么 method、参数放 query 还是 body——尤其是分页路径的
// **大小写**（真实是 dataSetPaged，大写 S），以及「POST + 参数在 query」这种旧后端的怪口径。
// 所以这里把 client.request 整个换成 spy，只断请求形状，不跑 mock。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const req = vi.hoisted(() => vi.fn(() => Promise.resolve({ total: 0, list: [] })))

vi.mock('./client', () => ({ request: req }))

import {
  changeDatasetEnable,
  copyDataset,
  datasetPaged,
  deleteDataSets,
  genDatasetFromSource,
  runMeasureNow,
  updateDataSet,
} from './dataset'

type Call = [string, Record<string, unknown> | undefined, Record<string, unknown> | undefined]

/** 取第 n 次调用的入参（[endpoint, params, options]） */
function call(n = 0) {
  return req.mock.calls[n] as unknown as Call
}

beforeEach(() => {
  req.mockClear()
})

describe('dataset · 分页契约', () => {
  it('打真实路径 dataset/dataSetPaged（大写 S），GET + query', async () => {
    await datasetPaged({ datasetId: '1001', page: 1, limit: 10 })
    const [endpoint, params, options] = call()
    expect(endpoint).toBe('dataset/dataSetPaged')
    expect(options?.method).toBe('GET')
    expect(params).toMatchObject({ datasetId: '1001', page: 1, limit: 10 })
  })

  it('旧 s-table 的 pageNo/pageSize 改名成 page/limit，并且不再下发原键', async () => {
    await datasetPaged({ pageNo: 3, pageSize: 40 } as never)
    const [, params] = call()
    expect(params).toMatchObject({ page: 3, limit: 40 })
    expect(params).not.toHaveProperty('pageNo')
    expect(params).not.toHaveProperty('pageSize')
  })

  it('已给的 page/limit 优先（不受 pageNo/pageSize 影响）', async () => {
    await datasetPaged({ page: 2, limit: 20, pageNo: 9, pageSize: 99 } as never)
    const [, params] = call()
    expect(params).toMatchObject({ page: 2, limit: 20 })
  })

  it('筛选与排序键原样透传（含旧页会带上的 entryType / configId）', async () => {
    await datasetPaged({
      datasetId: '', sourceId: '161725', entryTypeId: '1001', enable: '0',
      entryType: '1001', configId: '70598', sortField: 'measureCnt', sortOrder: 'descend',
    })
    const [, params] = call()
    expect(params).toMatchObject({
      sourceId: '161725', entryTypeId: '1001', enable: '0',
      entryType: '1001', configId: '70598', sortField: 'measureCnt', sortOrder: 'descend',
    })
  })
})

describe('dataset · 写操作契约（对齐旧 api/dataset.js）', () => {
  it('修改：POST + body（不是 query，paramsIn 缺省即 body）', async () => {
    await updateDataSet({ datasetId: 1001, datasetName: 'x' })
    const [endpoint, params, options] = call()
    expect(endpoint).toBe('dataset/updateDataSet')
    expect(options?.method).toBe('POST')
    expect(options?.paramsIn).toBeUndefined()
    expect(params).toMatchObject({ datasetId: 1001, datasetName: 'x' })
  })

  it('删除：POST 但 ids 走 query（旧层写的是 method=post 且把 ids 塞进 params）', async () => {
    await deleteDataSets([1001, 1002])
    const [endpoint, params, options] = call()
    expect(endpoint).toBe('dataset/delete')
    expect(options?.method).toBe('POST')
    expect(options?.paramsIn).toBe('query')
    expect(params).toEqual({ ids: '1001,1002' })
  })

  it('启停：GET ?ids=a,b&enable=（enable 原样直传 0/1，不做布尔转换）', async () => {
    await changeDatasetEnable([1001, 1002], 1)
    const [endpoint, params, options] = call()
    expect(endpoint).toBe('dataset/changeEnable')
    expect(options?.method).toBe('GET')
    expect(params).toEqual({ ids: '1001,1002', enable: 1 })
  })

  it('由源生成：GET ?sourceId=&entryTypeId=', async () => {
    await genDatasetFromSource('161725', '1001')
    const [endpoint, params, options] = call()
    expect(endpoint).toBe('dataset/genFromSource')
    expect(options?.method).toBe('GET')
    expect(params).toEqual({ sourceId: '161725', entryTypeId: '1001' })
  })

  it('复制：GET ?id=&name=&sourceId=（旧页只传 id，另两个键保持 undefined）', async () => {
    await copyDataset(1001)
    const [endpoint, params, options] = call()
    expect(endpoint).toBe('dataset/copy')
    expect(options?.method).toBe('GET')
    expect(params).toEqual({ id: 1001, name: undefined, sourceId: undefined })
  })

  it('立即执行：GET ?ids=a,b&last=（last 为 null = 从上次 ID 继续）', async () => {
    await runMeasureNow([1001, 1002], null)
    const [endpoint, params, options] = call()
    expect(endpoint).toBe('dataset/runNow')
    expect(options?.method).toBe('GET')
    expect(params).toEqual({ ids: '1001,1002', last: null })
  })
})
