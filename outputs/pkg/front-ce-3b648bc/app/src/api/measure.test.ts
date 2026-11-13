// 指标定义接口层（旧 data-view `src/api/measure.js`）。
// 这一层守的是**请求契约**：打到哪条路径、什么 method、参数放 query 还是 body——尤其是
// 「POST + 参数在 query」（delete / deleteMeasurePhy）与「GET 带 ids+enable」这种旧后端的怪口径。
// 所以这里把 client.request 整个换成 spy，只断请求形状，不跑 mock。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const req = vi.hoisted(() => vi.fn(() => Promise.resolve({ total: 0, list: [] })))

vi.mock('./client', () => ({ request: req }))

import {
  addMeasure,
  changeMeasureEnable,
  copyMeasure,
  deleteMeasurePhy,
  deleteMeasures,
  genMeasureFromSource,
  measurePaged,
  updateMeasure,
} from './measure'

type Call = [string, Record<string, unknown> | undefined, Record<string, unknown> | undefined]

/** 取第 n 次调用的入参（[endpoint, params, options]） */
function call(n = 0) {
  return req.mock.calls[n] as unknown as Call
}

beforeEach(() => {
  req.mockClear()
})

describe('measure · 分页契约', () => {
  it('打 measure/measurePaged（逻辑名与真实路径同名），GET + query', async () => {
    await measurePaged({ datasetId: '1001', page: 1, limit: 20 })
    const [endpoint, params, options] = call()
    expect(endpoint).toBe('measure/measurePaged')
    expect(options?.method).toBe('GET')
    expect(params).toMatchObject({ datasetId: '1001', page: 1, limit: 20 })
  })

  it('旧 s-table 的 pageNo/pageSize 改名成 page/limit，并且不再下发原键', async () => {
    await measurePaged({ pageNo: 3, pageSize: 40 } as never)
    const [, params] = call()
    expect(params).toMatchObject({ page: 3, limit: 40 })
    expect(params).not.toHaveProperty('pageNo')
    expect(params).not.toHaveProperty('pageSize')
  })

  it('已给的 page/limit 优先（不受 pageNo/pageSize 影响）', async () => {
    await measurePaged({ page: 2, limit: 20, pageNo: 9, pageSize: 99 } as never)
    const [, params] = call()
    expect(params).toMatchObject({ page: 2, limit: 20 })
  })

  it('筛选与排序键原样透传（含分类树 categorys 与旧页透传的 configId）', async () => {
    await measurePaged({
      datasetId: '', sourceId: '161725', measureCode: 'A000', enable: '0',
      categorys: '9009005', configId: '70598', sortField: 'measureId', sortOrder: 'descend',
    })
    const [, params] = call()
    expect(params).toMatchObject({
      sourceId: '161725', measureCode: 'A000', enable: '0',
      categorys: '9009005', configId: '70598', sortField: 'measureId', sortOrder: 'descend',
    })
  })
})

describe('measure · 写操作契约（对齐旧 api/measure.js）', () => {
  it('新增：POST + body（不是 query，paramsIn 缺省即 body）', async () => {
    await addMeasure({ measureCode: 'A00011', measureName: 'x' })
    const [endpoint, params, options] = call()
    expect(endpoint).toBe('measure/add')
    expect(options?.method).toBe('POST')
    expect(options?.paramsIn).toBeUndefined()
    expect(params).toMatchObject({ measureCode: 'A00011', measureName: 'x' })
  })

  it('修改：POST + body', async () => {
    await updateMeasure({ measureId: 20001, measureName: 'y' })
    const [endpoint, params, options] = call()
    expect(endpoint).toBe('measure/update')
    expect(options?.method).toBe('POST')
    expect(options?.paramsIn).toBeUndefined()
    expect(params).toMatchObject({ measureId: 20001, measureName: 'y' })
  })

  it('复制：GET ?id=&name=&sourceId=（旧页只传 id，另两个键保持 undefined）', async () => {
    await copyMeasure(20001)
    const [endpoint, params, options] = call()
    expect(endpoint).toBe('measure/copy')
    expect(options?.method).toBe('GET')
    expect(params).toEqual({ id: 20001, name: undefined, sourceId: undefined })
  })

  it('批量删除：POST 但 ids 走 query（旧层写的是 method=post 且把 ids 塞进 params）', async () => {
    await deleteMeasures([20001, 20002])
    const [endpoint, params, options] = call()
    expect(endpoint).toBe('measure/delete')
    expect(options?.method).toBe('POST')
    expect(options?.paramsIn).toBe('query')
    expect(params).toEqual({ ids: '20001,20002' })
  })

  it('物理删除：POST ?id=单个（不是 ids 数组，无法恢复）', async () => {
    await deleteMeasurePhy(20012)
    const [endpoint, params, options] = call()
    expect(endpoint).toBe('measure/deleteMeasurePhy')
    expect(options?.method).toBe('POST')
    expect(options?.paramsIn).toBe('query')
    expect(params).toEqual({ id: 20012 })
  })

  it('启停：GET ?ids=a,b&enable=（enable 原样直传 0/1，不做布尔转换）', async () => {
    await changeMeasureEnable([20001, 20002], 1)
    const [endpoint, params, options] = call()
    expect(endpoint).toBe('measure/changeEnable')
    expect(options?.method).toBe('GET')
    expect(params).toEqual({ ids: '20001,20002', enable: 1 })
  })

  it('由源生成：GET ?sourceId=&entryTypeId=', async () => {
    await genMeasureFromSource('161725', '1001')
    const [endpoint, params, options] = call()
    expect(endpoint).toBe('measure/genMeasureFromSource')
    expect(options?.method).toBe('GET')
    expect(params).toEqual({ sourceId: '161725', entryTypeId: '1001' })
  })
})
