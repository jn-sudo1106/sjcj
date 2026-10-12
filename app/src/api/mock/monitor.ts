import type { CkSourcePayload, CkSourceRecord, CkSourcePage } from '../types/rule'
import type { HealthCard, MqQueue, SyncRow, AlarmRow, SourceCheck, SourceCheckLog, Paged } from '../types'

const HEALTH: HealthCard[] = [
  { key: 'qinglong', name: '执行器（青龙）', status: 'ok', detail: '4 / 5 节点在线' },
  { key: 'rule-gw', name: '规则引擎网关', status: 'warn', detail: '裸开无鉴权，待接鉴权代理' },
  { key: 'mq', name: '消息队列 MQ', status: 'warn', detail: '2 个队列积压告警' },
  { key: 'func', name: '函数工具', status: 'ok', detail: 'evaluate 正常' },
]

const MQ: MqQueue[] = [
  { name: 'source-config-dispatch', pending: 1240, failed: 12, state: 'warn' },
  { name: 'snatch-task', pending: 88, failed: 0, state: 'ok' },
  { name: 'rule-eval', pending: 0, failed: 3, state: 'err' },
  { name: 'data-sink', pending: 30, failed: 0, state: 'ok' },
]

const SYNC: SyncRow[] = [
  { client: 'dc-client-01', status: '已同步', diff: 0, externalChanged: false },
  { client: 'dc-client-02', status: '有差异', diff: 14, externalChanged: true },
  { client: 'dc-client-03', status: '已同步', diff: 0, externalChanged: false },
]

const ALARMS: AlarmRow[] = [
  { alarmId: 'a1', level: 'fail', text: '微博舆情链路抓取失败：Cookie 失效', at: '2026-06-19 06:02' },
  { alarmId: 'a2', level: 'block', text: 'rule-eval 队列失败堆积 3 条', at: '2026-06-19 07:30' },
  { alarmId: 'a3', level: 'recover', text: '公告规则采集链路已恢复正常', at: '2026-06-19 07:05' },
]

export function mockHealth(): HealthCard[] {
  return HEALTH
}
export function mockMq(): MqQueue[] {
  return MQ
}
export function mockSync(): SyncRow[] {
  return SYNC
}
export function mockAlarms(): AlarmRow[] {
  return ALARMS
}
export function mockMonitorStats(): { healthText: string; queueAlarms: number; cacheWindow: string; dangerOpen: number } {
  return {
    healthText: '4/5',
    queueAlarms: MQ.filter((q) => q.state !== 'ok').length,
    cacheWindow: '1 min',
    dangerOpen: 0,
  }
}

// ck_source 监控源配置（vanv-data-engine SourceController，2026-09-05）：数据监控节点保存时
// syncMonitorCkSource 走 list → 有则 update / 无则 insert。mock 用内存表复刻这个往返，
// 自增 id 模拟 insert 返回主键；update 按 sourceId 全行匹配（后端语义），命中数>0 返回 true。
const CK_SOURCE_STORE: CkSourceRecord[] = []
let ckSourceNextId = 1

export function mockCkSourceList(params?: Record<string, unknown>): CkSourceRecord[] {
  const sourceId = String(params?.sourceId ?? '')
  return CK_SOURCE_STORE.filter((row) => String(row.sourceId) === sourceId)
}

/**
 * ck_source 分页（/api/source/page，2026-09-18）：与真实后端同口径——
 * 按主键倒序、name/sourceId 可选筛选、pageNum 从 1 起。
 */
export function mockCkSourcePage(params?: Record<string, unknown>): CkSourcePage {
  const sourceId = String(params?.sourceId ?? '')
  const name = String(params?.name ?? '').trim().toLowerCase()
  const pageNum = Math.max(Number(params?.pageNum) || 1, 1)
  const pageSize = Math.min(Math.max(Number(params?.pageSize) || 20, 1), 200)

  const matched = CK_SOURCE_STORE
    .filter((row) => !sourceId || String(row.sourceId) === sourceId)
    .filter((row) => !name || row.name?.toLowerCase().includes(name))
    .sort((a, b) => b.id - a.id)
  const total = matched.length
  const pages = total === 0 ? 0 : Math.ceil(total / pageSize)
  const list = matched.slice((pageNum - 1) * pageSize, pageNum * pageSize)
  return { total, pages, pageNum, pageSize, list }
}

export function mockCkSourceInsert(params?: Record<string, unknown>): number {
  const record: CkSourceRecord = {
    ...(params as unknown as CkSourcePayload),
    id: ckSourceNextId++,
  }
  CK_SOURCE_STORE.push(record)
  return record.id
}

export function mockCkSourceUpdate(params?: Record<string, unknown>): boolean {
  const payload = params as unknown as CkSourcePayload
  // 后端语义：body 里为 null 的字段保留原列值 → 用传了的字段覆盖，没传的留旧值。
  // 可写字段对齐后端 SourceService.updateBySourceId 的 wrapper.set 清单（CREATE_DT 不在其中：
  // 那一列 update 永不修改）。
  let hit = 0
  for (const row of CK_SOURCE_STORE) {
    if (row.sourceId !== payload.sourceId) continue
    Object.assign(row, {
      ...(payload.name != null ? { name: payload.name } : {}),
      ...(payload.schedule != null ? { schedule: payload.schedule } : {}),
      ...(payload.tableName != null ? { tableName: payload.tableName } : {}),
      ...(payload.checkConf != null ? { checkConf: payload.checkConf } : {}),
      ...(payload.state != null ? { state: payload.state } : {}),
      ...(payload.isDelete != null ? { isDelete: payload.isDelete } : {}),
      ...(payload.ver != null ? { ver: payload.ver } : {}),
    })
    hit++
  }
  return hit > 0
}

// ---------- 源监控（0910 迁入，第一期只读 + 开关） ----------
// 覆盖三种要看的形态：告警中、正常、已停用。lastMsg 保留旧平台那种
// `时间---[X]:文本` 的前缀，好验证视图有没有把重复的时间戳剥掉。
//
// 内存表：所有写操作都落这里，刷新 paged 能看到变更。
let ckNextId = 100
const CHECKS: SourceCheck[] = [
  {
    id: 'ck-1', isDelete: 0, state: 'E', name: '日增量监控',
    lastMsg: '2026-09-09 11:00:46---[X]:今日酒价百容酒价监控-日增量-异常, 数量:0',
    tableName: 'sense_data.tb_jjjk', schedule: '0 0 * * * ?',
    nextRun: '2026-09-09 12:00:00', lastRun: '2026-09-09 11:00:19',
    sourceId: '391007770', checkConf: '{"timeType":"day","minSize":"1"}',
  },
  {
    id: 'ck-2', isDelete: 0, state: 'C', name: '小时增量监控',
    lastMsg: '2026-09-09 11:00:12---正常, 数量:1240',
    tableName: 'sense_data.tb_cnews', schedule: '0 0 * * * ?',
    nextRun: '2026-09-09 12:00:00', lastRun: '2026-09-09 11:00:12',
    sourceId: '391007770', checkConf: '{"timeType":"hour","minSize":"100"}',
  },
  {
    id: 'ck-3', isDelete: 1, state: 'C', name: '全量比对（已停用）',
    lastMsg: '2026-09-01 03:00:05---正常, 数量:88231',
    tableName: 'sense_data.tb_cnews', schedule: '0 0 3 * * ?',
    nextRun: '—', lastRun: '2026-09-01 03:00:05',
    sourceId: '391007770', checkConf: '{}',
  },
]

export function mockSourceCheckPaged(params?: Record<string, unknown>): Paged<SourceCheck> {
  const enable = String(params?.enable ?? '')
  const state = String(params?.state ?? '')
  const name = String(params?.name ?? '')
  const list = CHECKS.filter((c) => (!enable || String(c.isDelete) === enable)
    && (!state || c.state === state)
    && (!name || c.name.includes(name)))
  return { total: list.length, list }
}

/** 变更启停（真实改内存表）。enable: 0=启用 → isDelete=0；1=停用 → isDelete=1 */
export function mockSourceCheckChangeEnable(params?: Record<string, unknown>) {
  const ids = String(params?.ids ?? '').split(',').filter(Boolean)
  const enable = Number(params?.enable ?? 0) // 0=启用, 1=停用
  const nextIsDelete = enable === 0 ? 0 : 1
  let hit = 0
  for (const id of ids) {
    const row = CHECKS.find((c) => c.id === id)
    if (row) { row.isDelete = nextIsDelete; hit++ }
  }
  return { ok: true, demo: true, message: hit > 0 ? (enable === 0 ? '已启用' : '已停用') : '未找到对应记录' }
}

export function mockSourceCheckRunNow() {
  return { ok: true, demo: true, message: '已触发校验（演示）' }
}

export function mockSourceCheckAdd(params?: Record<string, unknown>) {
  const id = `ck-${ckNextId++}`
  const now = new Date()
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  const row: SourceCheck = {
    id,
    isDelete: 0,
    state: 'C',
    name: String(params?.name ?? '新建监控'),
    lastMsg: `${fmt(now)}---正常, 数量:0`,
    tableName: String(params?.tableName ?? ''),
    schedule: String(params?.schedule ?? '0 0 6-22 * * ?'),
    nextRun: '—',
    lastRun: fmt(now),
    sourceId: String(params?.sourceId ?? ''),
    checkConf: String(params?.checkConf ?? '{}'),
  }
  CHECKS.push(row)
  return { ok: true, id, message: '新增成功（演示）' }
}

export function mockSourceCheckUpdate(params?: Record<string, unknown>) {
  const id = String(params?.id ?? '')
  const row = CHECKS.find((c) => c.id === id)
  if (!row) return { ok: false, message: '未找到要修改的记录' }
  if (params?.name != null) row.name = String(params.name)
  if (params?.tableName != null) row.tableName = String(params.tableName)
  if (params?.schedule != null) row.schedule = String(params.schedule)
  if (params?.checkConf != null) row.checkConf = String(params.checkConf)
  if (params?.isDelete != null) row.isDelete = Number(params.isDelete)
  return { ok: true, message: '修改成功（演示）' }
}

export function mockSourceCheckDelete(params?: Record<string, unknown>) {
  const ids = String(params?.ids ?? '').split(',').filter(Boolean)
  const before = CHECKS.length
  for (const id of ids) {
    const idx = CHECKS.findIndex((c) => c.id === id)
    if (idx >= 0) CHECKS.splice(idx, 1)
  }
  const removed = before - CHECKS.length
  return { ok: true, message: `删除 ${removed} 条成功（演示）` }
}

export function mockSourceCheckCheckOne(params?: Record<string, unknown>) {
  // 演示模式：checkConf 是合法 JSON 就成功，否则失败
  try {
    JSON.parse(String(params?.checkConf ?? '{}'))
    return { ok: true, message: '规则校验成功（演示）', data: params }
  } catch (err) {
    return { ok: false, message: 'checkConf 不是合法 JSON: ' + (err as Error).message }
  }
}

/** 把 cron 字段展开成允许值集合；`*` / `?` / 空 → null（表示不限） */
function expandCronField(expr: unknown, min: number, max: number): Set<number> | null {
  const text = String(expr ?? '').trim()
  if (!text || text === '*' || text === '?') return null
  const out = new Set<number>()
  for (const part of text.split(',')) {
    const [rangeRaw, stepRaw] = part.split('/')
    const step = stepRaw ? Number(stepRaw) : 1
    if (!Number.isFinite(step) || step <= 0) return null
    let lo = min
    let hi = max
    if (rangeRaw !== '*') {
      const [a, b] = rangeRaw.split('-')
      lo = Number(a)
      hi = b === undefined || b === '' ? lo : Number(b)
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
    }
    for (let v = Math.max(lo, min); v <= Math.min(hi, max); v += step) out.add(v)
  }
  return out
}

/**
 * 定时预览：旧平台 `GET /v1/source/lastRun?cron=`（api/util.js 的 checkCron）返回该 cron 的
 * 最近若干次运行时间，旧前端直接 `this.runs = res`（裸数组，不是 {code,data} 信封）。
 *
 * mock 口径说明：按「分」粒度向后推演（秒字段只用来取展示值，不做秒级步进），
 * 所以 `0/10 * * * * ?` 这种秒级间隔在 mock 里只体现为首个秒值 —— 够演示用，
 * 真实秒级排期以联调后端为准。周的取值按 `v % 7` 归到 JS 的 0=周日..6=周六，
 * 这样旧 UI 的「周日=0」和 Quartz 的「1=周日」两种写法都能对上。
 */
export function mockSourceCheckLastRun(params?: Record<string, unknown>): string[] {
  const cron = String(params?.cron ?? '').trim()
  const parts = cron.split(/\s+/)
  if (parts.length < 6) return []
  const [secRaw, minRaw, hourRaw, dayRaw, monRaw, weekRaw] = parts
  const secSet = expandCronField(secRaw, 0, 59)
  const minSet = expandCronField(minRaw, 0, 59)
  const hourSet = expandCronField(hourRaw, 0, 23)
  const daySet = expandCronField(dayRaw, 1, 31)
  const monSet = expandCronField(monRaw, 1, 12)
  const weekExpanded = expandCronField(weekRaw, 0, 7)
  const weekSet = weekExpanded ? new Set([...weekExpanded].map((v) => v % 7)) : null
  const sec = secSet ? ([...secSet].sort((a, b) => a - b)[0] ?? 0) : 0

  const pad = (n: number) => String(n).padStart(2, '0')
  const cursor = new Date()
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)
  const out: string[] = []
  // 最多向后找 62 天，凑够 8 条就停（月度任务也能落在窗口里）
  for (let i = 0; i < 60 * 24 * 62 && out.length < 8; i++) {
    const ok =
      (!minSet || minSet.has(cursor.getMinutes())) &&
      (!hourSet || hourSet.has(cursor.getHours())) &&
      (!daySet || daySet.has(cursor.getDate())) &&
      (!monSet || monSet.has(cursor.getMonth() + 1)) &&
      (!weekSet || weekSet.has(cursor.getDay()))
    if (ok) {
      out.push(
        `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())} ` +
          `${pad(cursor.getHours())}:${pad(cursor.getMinutes())}:${pad(sec)}`,
      )
    }
    cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return out
}

export function mockSourceCheckLogs(params?: Record<string, unknown>): Paged<SourceCheckLog> {
  const state = String(params?.state ?? '')
  const sourceId = String(params?.sourceId ?? '391007770')
  // 造够两页，好验证分页器真的在翻
  const all: SourceCheckLog[] = Array.from({ length: 26 }, (_, i) => {
    const hour = String(23 - (i % 24)).padStart(2, '0')
    const bad = i % 3 === 0
    return {
      logId: `log-${i + 1}`,
      createDt: `2026-09-09 ${hour}:00:${String(10 + (i % 40)).padStart(2, '0')}`,
      logMsg: bad
        ? `2026-09-09 ${hour}:00:46---[X]:今日酒价百容酒价监控-日增量-异常, 数量:0`
        : `2026-09-09 ${hour}:00:12---正常, 数量:${1200 + i}`,
      name: '今日酒价百容酒价监控-日增量',
      state: bad ? 'E' : 'C',
      logType: bad ? '出错' : '正常',
      tableName: 'sense_data.tb_jjjk',
      sourceId,
    }
  })
  const filtered = state ? all.filter((l) => l.state === state) : all
  const page = Number(params?.page ?? 1)
  const limit = Number(params?.limit ?? 20)
  return { total: filtered.length, list: filtered.slice((page - 1) * limit, page * limit) }
}
