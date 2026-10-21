// MQ 接口层（旧 data-view `src/api/mq.js` → api/mq.ts）契约回归。
//
// 重点锁两件事：
//   ① `mq/queues` 的**两组分页参数**：老请求是
//      `?pageNo=1&pageSize=1000&flag=on&page=1&limit=1000`（s-table 塞一组、api 层再硬塞一组）。
//      2026-10-20 首版只发了 page/limit，列表条数跟旧平台对不上——这就是那条用例存在的原因。
//   ② `mq/message` 的响应是裸 JSON 文本，不是 {code,data} 信封，且旧版用 eval 硬解。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { request } from './client'
import { fetchMessage, listQueues, purgeQueue, queueConsumers } from './mq'

vi.mock('./client', () => ({ request: vi.fn() }))

const mocked = vi.mocked(request)

beforeEach(() => {
  mocked.mockReset()
})

describe('listQueues', () => {
  it('照旧平台发两组分页参数，空条件不发（flag 始终带）', async () => {
    mocked.mockResolvedValue({ list: [], total: 0 } as never)
    await listQueues({ flag: 'on', cond: '', state: '' })
    expect(mocked).toHaveBeenCalledWith(
      'mq/queues',
      { pageNo: 1, pageSize: 1000, flag: 'on', page: 1, limit: 1000 },
      { method: 'GET' },
    )
  })

  it('cond / state 有值才带上', async () => {
    mocked.mockResolvedValue({ list: [], total: 0 } as never)
    await listQueues({ flag: '', cond: 'ocr', state: 'E' })
    expect(mocked).toHaveBeenCalledWith(
      'mq/queues',
      { pageNo: 1, pageSize: 1000, flag: '', cond: 'ocr', state: 'E', page: 1, limit: 1000 },
      { method: 'GET' },
    )
  })

  it('信封 {code,data,count} 与裸数组都能取到行', async () => {
    mocked.mockResolvedValue({ list: [{ name: 'a' }], total: 1 } as never)
    expect(await listQueues()).toEqual([{ name: 'a' }])
    mocked.mockResolvedValue([{ name: 'b' }] as never)
    expect(await listQueues()).toEqual([{ name: 'b' }])
    mocked.mockResolvedValue(null as never)
    expect(await listQueues()).toEqual([])
  })
})

describe('queueConsumers', () => {
  it('只带 queue，裸数组直出', async () => {
    mocked.mockResolvedValue([{ nodeName: 'rabbit@node1' }] as never)
    expect(await queueConsumers('ocr-task')).toEqual([{ nodeName: 'rabbit@node1' }])
    expect(mocked).toHaveBeenCalledWith('mq/queueDetail2', { queue: 'ocr-task' }, { method: 'GET' })
  })
})

describe('fetchMessage', () => {
  it('裸 JSON 文本按数组解析（旧版 eval 的位置）', async () => {
    mocked.mockResolvedValue('[{"payload":"{\\"a\\":1}","properties":{"routing_key":"k"}}]' as never)
    expect(await fetchMessage({ queue: 'q', count: 1, requeue: true })).toEqual([
      { payload: '{"a":1}', properties: { routing_key: 'k' } },
    ])
    expect(mocked).toHaveBeenCalledWith(
      'mq/message',
      { requeue: true, count: 1, queue: 'q' },
      { method: 'GET', responseType: 'json-or-text' },
    )
  })

  it('已经是数组 / 落在信封 message 里 / 干脆解析不出来，都不抛错', async () => {
    mocked.mockResolvedValue([{ payload: 'x', properties: {} }] as never)
    expect(await fetchMessage({ queue: 'q', count: 1, requeue: false })).toHaveLength(1)

    mocked.mockResolvedValue({ ok: true, message: '[{"payload":"y","properties":{}}]' } as never)
    expect(await fetchMessage({ queue: 'q', count: 2, requeue: true })).toEqual([
      { payload: 'y', properties: {} },
    ])

    // RabbitMQ 空队列会回空串，旧版 eval('()') 直接抛
    mocked.mockResolvedValue({ ok: true, message: '操作成功' } as never)
    expect(await fetchMessage({ queue: 'q', count: 1, requeue: true })).toEqual([])
  })
})

describe('purgeQueue', () => {
  it('key 与 queue 原样透传', async () => {
    mocked.mockResolvedValue({ ok: true } as never)
    await purgeQueue({ queue: 'q', key: 11 })
    expect(mocked).toHaveBeenCalledWith('mq/purgeQueue', { key: 11, queue: 'q' }, { method: 'GET' })
  })
})
