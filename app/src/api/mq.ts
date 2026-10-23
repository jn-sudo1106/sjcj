// MQ 消息队列（RabbitMQ 管理接口透传）—— 1:1 迁移旧 data-view `src/api/mq.js`。
//
// 端点契约（旧文件逐条对齐；路径去掉 /v1/ 前缀，由 client.ts 拼 BASE_URL=/api/v1/）：
//   listQueues      GET /v1/mq/queues        ?pageNo=1&pageSize=1000&flag=&cond=&state=&page=1&limit=1000
//                                            → 队列列表（两组分页参数都要发，见 listQueues 的注释）
//   queueConsumers  GET /v1/mq/queueDetail2  ?queue=                                 → 消费者列表（裸数组）
//   fetchMessage    GET /v1/mq/message       ?requeue=&count=&queue=                 → 消息体（裸 JSON 文本）
//   purgeQueue      GET /v1/mq/purgeQueue    ?key=&queue=                            → 清空队列
//
// ⚠️ 旧版「分页」是硬塞的：s-table 的 loadData 塞 `{pageNo, pageSize}`，`queuesPaged` 里再写死
//    `parameter.page = 1 / limit = 1000`，页面上 s-table 的 pagination 又关掉了 ——
//    这一屏从来就没有真分页，一次拉 1000 条，而且请求里**两组分页参数并存**（见 listQueues 的注释）。
//    不要"顺手"精简成一组、也别改成真分页：改了就等于换了契约。
// ⚠️ 空查询条件不发（旧版是 undefined，axios 会把键整个丢掉），别拿 `cond=` 空串去撞后端。
// ⚠️ `mq/message` 的响应体是一段**裸 JSON 文本**（RabbitMQ 管理接口原样透传，不带 {code,data} 信封），
//    旧版用 `eval('(' + res + ')')` 硬解 —— eval 在 CSP/严格模式下会炸，这里改用 JSON.parse，
//    并兼容三种形态：裸数组 / {data:'...'} / {message:'...'}（见 parseMessages）。
// ⚠️ `mq/queueDetail2` 与 `mq/queues` 的返回形状不一致：前者是裸数组，后者是 {code,data,count} 信封。
//    统一走 pickList 兜底，两种形状都不至于让页面白屏。
import { request } from './client'

const EP = {
  queues: 'mq/queues',
  queueDetail: 'mq/queueDetail2',
  message: 'mq/message',
  purge: 'mq/purgeQueue',
} as const

/** RabbitMQ 速率明细（message_stats.*_details） */
export interface MqRateDetail {
  rate?: number
  interval?: number
  [key: string]: unknown
}

/** message_stats：生产 / 消费 / 应答三组速率 */
export interface MqMessageStats {
  publish_details?: MqRateDetail
  deliver_get_details?: MqRateDetail
  ack_details?: MqRateDetail
  [key: string]: unknown
}

/**
 * 队列行（RabbitMQ `/api/queues` 的字段 + 后端补的两个告警字段）。
 * 字段名保持后端原样（messages_ready 这类下划线命名不转驼峰）——旧页面全按原名取值，
 * 这里若转成 readyMessages 只会让 1:1 对齐变成翻译游戏。
 */
export interface MqQueue {
  vhost: string
  name: string
  /** 可用消息数 */
  messages?: number
  messages_ready?: number
  /** 已投递未确认（锁定） */
  messages_unacknowledged?: number
  consumers?: number
  message_stats?: MqMessageStats
  /** 队列告警状态：E=出错 / C=正常 / NO=未配置（后端补的字段） */
  notifyState?: string
  /** 该队列命中的告警规则条数（后端补的字段） */
  notifyCount?: number
  [key: string]: unknown
}

/** 队列列表查询条件（旧 queryParam 的三个键，外加被硬编码的分页参数） */
export interface MqQueueQuery {
  /** ''=不限 / 'on'=非0队列 */
  flag?: string
  /** 队列名称关键字（旧字段名就叫 cond） */
  cond?: string
  /** ''=不限 / 'E' 出错 / 'C' 正常 / 'NO' 未配置 */
  state?: string
}

/** 消费者行（后端 queueDetail2 的字段，注意是驼峰：nodeName / deliverRate） */
export interface MqConsumer {
  nodeName?: string
  prefetch?: number
  messages_unacknowledged?: number
  deliverRate?: number
  ackRate?: number
  idealSince?: string
  [key: string]: unknown
}

/** 一条队列消息 */
export interface MqMessage {
  payload: string
  properties: Record<string, unknown>
}

/** 从三种响应形状里捞出数组：裸数组 / {list} / {data:[]} */
function pickList<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[]
  const box = res as { list?: unknown; data?: unknown } | null
  if (box && Array.isArray(box.list)) return box.list as T[]
  if (box && Array.isArray(box.data)) return box.data as T[]
  return []
}

/**
 * 解析 `mq/message` 的响应。可能的形状：
 *   1. 裸数组                [{payload, properties}]        （后端直接吐文本，JSON.parse 后就是它）
 *   2. JSON 字符串           '[{...}]'                      （响应体本身就是一段字符串）
 *   3. 信封 {code,data:'…'}  client.ts 把标量 data 归到 message、字符串 data 原样放 data 字段
 * 任何解不出来的情况一律返回空数组 —— 上层按「没有消息」提示，不抛异常（旧版 eval 抛错会白屏）。
 */
function parseMessages(res: unknown): MqMessage[] {
  const unwrap = (value: unknown, depth = 0): unknown => {
    if (depth > 3) return value
    if (typeof value === 'string') {
      const text = value.trim()
      if (!text) return []
      try {
        return JSON.parse(text) as unknown
      } catch {
        return []
      }
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const box = value as Record<string, unknown>
      if (box.data !== undefined) return unwrap(box.data, depth + 1)
      if (typeof box.message === 'string') return unwrap(box.message, depth + 1)
    }
    return value
  }
  const list = unwrap(res)
  return Array.isArray(list) ? (list as MqMessage[]) : []
}

/**
 * 队列列表。
 *
 * ⚠️ 参数必须**同时**带 `pageNo/pageSize` 和 `page/limit`，这不是冗余，是旧平台的真实形状：
 *   旧 s-table 的 loadData 会先塞 `{pageNo, pageSize}`（:pageSize="1000" + 默认 current=1），
 *   旧 `queuesPaged` 再写死 `page=1 / limit=1000` 并在末尾挂上查询条件，最终请求长这样：
 *   `?pageNo=1&pageSize=1000&flag=on&page=1&limit=1000`
 *   （2026-10-20 实测 `http://118.25.96.217:9999/api/v1/mq/queues?pageNo=1&pageSize=1000&flag=on&page=1&limit=1000`）
 *   少了 pageNo/pageSize 这组，后端按自己的默认分页走，列表条数与旧平台对不上。
 *
 * ⚠️ 空条件**不发**：旧版 queryParam 初值是 `undefined`，axios 会把 undefined 的键整个丢掉，
 *   所以「不限 / 名称空 / 状态不限」时请求里根本没有 cond/state 这两个键。这里同口径——
 *   发 `cond=`（空串）是换了个契约，后端可能拿它当"按空串过滤"。
 *   `flag` 例外：它有个真实的空串取值（-不限-），旧版会原样发 `flag=`，所以始终带上。
 */
export async function listQueues(query: MqQueueQuery = {}): Promise<MqQueue[]> {
  // 键序也照旧平台来（pageNo/pageSize → 条件 → page/limit），方便直接跟老请求逐字比对
  const params: Record<string, unknown> = { pageNo: 1, pageSize: 1000, flag: query.flag ?? '' }
  if (query.cond) params.cond = query.cond
  if (query.state) params.state = query.state
  params.page = 1
  params.limit = 1000

  const res = await request<unknown>(EP.queues, params, { method: 'GET' })
  return pickList<MqQueue>(res)
}

/** 某队列的消费者列表（旧 `queueConsumers`） */
export async function queueConsumers(queue: string): Promise<MqConsumer[]> {
  const res = await request<unknown>(EP.queueDetail, { queue }, { method: 'GET' })
  return pickList<MqConsumer>(res)
}

/**
 * 取消息。`requeue=true` = 取完放回队列（页面上的「获取多条」，只是看一眼）；
 * `false` = 真删（「删除一条」，消息从队列里消失）。
 */
export async function fetchMessage(param: {
  queue: string
  count: number | string
  requeue: boolean
}): Promise<MqMessage[]> {
  const res = await request<unknown>(
    EP.message,
    { requeue: param.requeue, count: param.count, queue: param.queue },
    { method: 'GET', responseType: 'json-or-text' },
  )
  return parseMessages(res)
}

/**
 * 清空队列（不可恢复）。
 * `key` 是后端的操作校验值：旧页面 `handleClearNoAck` 传的是 `new Date().getHours()`（当前小时数）。
 * 别自作聪明改成让用户手输密码 —— 那个「删除操作密码」弹窗在旧版里是死代码，从未被打开过。
 */
export async function purgeQueue(param: { queue: string; key: number | string }): Promise<unknown> {
  return request<unknown>(EP.purge, { key: param.key, queue: param.queue }, { method: 'GET' })
}
