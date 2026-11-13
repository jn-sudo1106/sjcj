// 队列告警（/v1/mq/check/*）mock —— 旧 data-view `src/api/queue-check.js` 的 5 个端点。
//
// 内存表：写操作真落库，刷新 paged 能看到变更（与 mock/monitor.ts 的 CHECKS 同一套路）。
// 契约口径都按旧平台页面语义对齐：
//   · 查询参数名与记录字段名不一致——query.queue → queueName（「队列名」）、query.name → queueDesc（「描述」）；
//   · enable 与 isDelete 同向：'0'=在用 / '1'=停用 / '-1'=历史删除的 / ''=全部；
//   · 表头排序：sortField（queueName/maxSize/minConsumer/maxRate）+ sortOrder（'ascend'/'descend'）。
import type { MqCheck, Paged } from '../types'

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

/** 内存表：全部写操作落这里 */
const MQ_CHECKS: MqCheck[] = [
  {
    queueId: 'mq-1', queueName: 'source-config-dispatch', state: 'E',
    lastMsg: '2026-10-13 08:10:02---[X]:积压 1240 条, 超过阈值 1000',
    queueDesc: '源配置下发队列', maxSize: 1000, minConsumer: 2, minRate: 10, maxRate: 5000,
    check: '', checkMsg: '源配置下发积压', isDelete: 0,
    createDt: '2026-09-01 10:00:00', updateDt: '2026-10-13 08:10:02',
    lastRun: '2026-10-13 08:10:02', nextRun: '2026-10-13 09:10:00',
  },
  {
    queueId: 'mq-2', queueName: 'snatch-task', state: 'C',
    lastMsg: '2026-10-13 08:10:01---正常, 数量:88',
    queueDesc: '抓取任务队列', maxSize: 5000, minConsumer: 1, minRate: 5, maxRate: 20000,
    check: '', checkMsg: '', isDelete: 0,
    createDt: '2026-09-01 10:00:00', updateDt: '2026-10-13 08:10:01',
    lastRun: '2026-10-13 08:10:01', nextRun: '2026-10-13 09:10:00',
  },
  {
    queueId: 'mq-3', queueName: 'rule-eval', state: 'E',
    lastMsg: '2026-10-13 08:12:33---[X]:失败堆积 3 条, 消费速率低于阈值',
    queueDesc: '规则引擎求值队列', maxSize: 500, minConsumer: 2, minRate: 20, maxRate: 3000,
    check: 'cnt > 100', checkMsg: '规则求值队列消费过慢', isDelete: 0,
    createDt: '2026-09-02 11:20:00', updateDt: '2026-10-13 08:12:33',
    lastRun: '2026-10-13 08:12:33', nextRun: '2026-10-13 09:12:00',
  },
  {
    queueId: 'mq-4', queueName: 'data-sink', state: 'C',
    lastMsg: '2026-10-13 08:11:00---正常, 数量:30',
    queueDesc: '数据落地队列', maxSize: 2000, minConsumer: 1, minRate: 5, maxRate: 8000,
    check: '', checkMsg: '', isDelete: 0,
    createDt: '2026-09-03 09:00:00', updateDt: '2026-10-13 08:11:00',
    lastRun: '2026-10-13 08:11:00', nextRun: '2026-10-13 09:11:00',
  },
  {
    queueId: 'mq-5', queueName: 'ocr-task', state: 'C',
    lastMsg: '2026-10-12 20:00:12---正常, 数量:412',
    queueDesc: 'OCR 识别任务队列', maxSize: 3000, minConsumer: 2, minRate: 10, maxRate: 6000,
    check: '', checkMsg: '', isDelete: 1,
    createDt: '2026-09-05 14:00:00', updateDt: '2026-10-10 09:30:00',
    lastRun: '2026-10-10 09:30:00', nextRun: '—',
  },
  {
    queueId: 'mq-6', queueName: 'mail-fetch', state: 'C',
    lastMsg: '2026-09-28 07:00:05---正常, 数量:96',
    queueDesc: '邮件抓取队列（已下线）', maxSize: 500, minConsumer: 1, minRate: 1, maxRate: 1000,
    check: '', checkMsg: '', isDelete: -1,
    createDt: '2026-08-28 07:00:00', updateDt: '2026-09-28 07:00:05',
    lastRun: '2026-09-28 07:00:05', nextRun: '—',
  },
]

let mqCheckNextId = 100

/** 可分页排序的列（与列定义里的 sorter:true 一致）：其余字段一律忽略，避免脏参数影响演示 */
const SORTABLE_FIELDS = new Set(['queueName', 'maxSize', 'minConsumer', 'maxRate'])

/** 分页查询：旧页面筛选口径（queue→queueName、name→queueDesc、enable→isDelete）+ 表头排序 */
export function mockMqCheckPaged(params?: Record<string, unknown>): Paged<MqCheck> {
  const queue = String(params?.queue ?? '').trim()
  const queueId = String(params?.queueId ?? '').trim()
  const name = String(params?.name ?? '').trim()
  const enable = String(params?.enable ?? '')
  const page = Math.max(1, Number(params?.page ?? 1) || 1)
  const limit = Math.max(1, Number(params?.limit ?? 20) || 20)
  // 表头排序：字段 + 方向都为有效值时才排（旧口径 order = 'ascend' / 'descend'）
  const sortField = String(params?.sortField ?? '').trim()
  const sortOrder = String(params?.sortOrder ?? '').trim()

  const matched = MQ_CHECKS.filter((row) => {
    if (queue && !row.queueName.includes(queue)) return false
    if (queueId && !String(row.queueId).includes(queueId)) return false
    if (name && !row.queueDesc.includes(name)) return false
    if (enable === '0' && row.isDelete !== 0) return false
    if (enable === '1' && row.isDelete !== 1) return false
    if (enable === '-1' && !(row.isDelete < 0)) return false
    return true
  })

  if (SORTABLE_FIELDS.has(sortField) && (sortOrder === 'ascend' || sortOrder === 'descend')) {
    const dir = sortOrder === 'ascend' ? 1 : -1
    // 注意 matched 是 filter 出来的新数组，排序不会动到内存表本身的顺序
    matched.sort((a, b) => {
      if (sortField === 'queueName') return String(a.queueName).localeCompare(String(b.queueName)) * dir
      const av = Number(a[sortField as 'maxSize' | 'minConsumer' | 'maxRate']) || 0
      const bv = Number(b[sortField as 'maxSize' | 'minConsumer' | 'maxRate']) || 0
      return (av - bv) * dir
    })
  }

  return { total: matched.length, list: matched.slice((page - 1) * limit, page * limit) }
}

/** 新增（真实改内存表；queueId 自增模拟后端主键） */
export function mockMqCheckAdd(params?: Record<string, unknown>) {
  const row: MqCheck = {
    queueId: `mq-${mqCheckNextId++}`,
    queueName: String(params?.queueName ?? ''),
    state: 'C',
    lastMsg: `${stamp(new Date())}---正常, 数量:0`,
    queueDesc: String(params?.queueDesc ?? ''),
    maxSize: (params?.maxSize ?? '') as number | string,
    minConsumer: (params?.minConsumer ?? '') as number | string,
    minRate: (params?.minRate ?? '') as number | string,
    maxRate: (params?.maxRate ?? '') as number | string,
    check: String(params?.check ?? ''),
    checkMsg: String(params?.checkMsg ?? ''),
    isDelete: Number(params?.isDelete ?? 0),
    createDt: stamp(new Date()),
  }
  MQ_CHECKS.push(row)
  return { ok: true, id: row.queueId, message: '新增成功（演示）' }
}

/** 修改（按 queueId 定位，只覆盖传了的字段） */
export function mockMqCheckUpdate(params?: Record<string, unknown>) {
  const queueId = String(params?.queueId ?? '')
  const row = MQ_CHECKS.find((r) => r.queueId === queueId)
  if (!row) return { ok: false, message: '未找到要修改的记录' }
  const text = (key: string) => (params?.[key] == null ? undefined : String(params[key]))
  const num = (key: string) => (params?.[key] == null ? undefined : Number(params[key]))
  row.queueName = text('queueName') ?? row.queueName
  row.queueDesc = text('queueDesc') ?? row.queueDesc
  row.maxSize = num('maxSize') ?? row.maxSize
  row.minConsumer = num('minConsumer') ?? row.minConsumer
  row.minRate = num('minRate') ?? row.minRate
  row.maxRate = num('maxRate') ?? row.maxRate
  row.check = text('check') ?? row.check
  row.checkMsg = text('checkMsg') ?? row.checkMsg
  row.isDelete = num('isDelete') ?? row.isDelete
  row.updateDt = stamp(new Date())
  return { ok: true, message: '修改成功（演示）' }
}

/** 变更启停（enable 与 isDelete 同向：0=启用 / 1=停用） */
export function mockMqCheckChangeEnable(params?: Record<string, unknown>) {
  const ids = String(params?.ids ?? '').split(',').filter(Boolean)
  const enable = Number(params?.enable ?? 0)
  const nextIsDelete = enable === 0 ? 0 : 1
  let hit = 0
  for (const id of ids) {
    const row = MQ_CHECKS.find((r) => r.queueId === id)
    if (row) {
      row.isDelete = nextIsDelete
      hit++
    }
  }
  return { ok: true, demo: true, message: hit > 0 ? (enable === 0 ? '已启用' : '已停用') : '未找到对应记录' }
}

/** 删除（ids 走 query，逗号分隔）。
 *  注意：这里做的是**物理删除**（演示上更直观）；真实后端的 `/delete` 也可能是逻辑删除
 *  （把 isDelete 置成负数，列表里仍能按「历史删除的」筛出来，比如 mq-6），联调时按真实回执确认。 */
export function mockMqCheckDelete(params?: Record<string, unknown>) {
  const ids = String(params?.ids ?? '').split(',').filter(Boolean)
  const before = MQ_CHECKS.length
  for (const id of ids) {
    const idx = MQ_CHECKS.findIndex((r) => r.queueId === id)
    if (idx >= 0) MQ_CHECKS.splice(idx, 1)
  }
  return { ok: true, message: `删除 ${before - MQ_CHECKS.length} 条成功（演示）` }
}
