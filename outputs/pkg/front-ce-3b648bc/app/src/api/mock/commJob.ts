// 通用定时任务 / 自定义告警（/v1/comm-job/*）mock —— 旧 data-view `src/api/comm-job.js` 的 7 个端点。
//
// 内存表：写操作真落库，刷新 paged 能看到变更（与 mock/queueCheck.ts 同一套路）。
//
// 查询参数字段映射（旧页 CommJobList 的搜索栏是「队列名 / ID / 描述 / 状态」，
// 字段名沿用旧 queryParam，但 COMM_JOB 记录上没有 queueName / queueDesc 这两个字段）：
//   · queue   → jobName 模糊（「队列名」这一栏实际筛的是定时名）
//   · queueId → jobId   模糊
//   · name    → jobName 模糊（「描述」这一栏：旧前端没暴露后端拿它比哪个字段；
//               参照同类页 ConfigList 的 `name` → configName 口径，推断落在实体名字段 jobName 上）
//   · enable  → isDelete（'0' 在用 / '1' 停用 / '-1' 历史删除的 / '' 或未传 = 全部）
// ⚠️ 上面 queue / name 的落库字段是**按同类页推断**的，联调时按真实后端行为校准。
import type { CommJob, Paged } from '../types'

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

/** 相对当前时刻偏移若干分钟再格式化 —— 让「下次运行 / 上次运行」的相对时间演示起来有变化 */
const shift = (minutes: number) => stamp(new Date(Date.now() + minutes * 60_000))

/** 内存表：全部写操作落这里。
 *  nextRun 取未来、lastRun 取过去，这样列表上「下次运行」显示「N 分钟后」、
 * 「上次运行」显示「N 分钟前」，与旧 timeago 过滤器的双向展示口径一致。 */
const COMM_JOBS: CommJob[] = [
  {
    jobId: '1001', jobType: 'sqlCheck', jobName: '订单积压告警',
    lastMsg: `${shift(-12)}---[X]:近 15 分钟订单队列积压 1280 > 1000`,
    sqlDef: 'select count(1) as cnt from t_order where state = 0',
    ruleDef: 'cnt > 1000',
    jobParam: '{"mail":"ops@demo.com"}',
    schedule: '0 */5 * * * ?',
    nextRun: shift(3), runCnt: 288, successCnt: 288, lastRun: shift(-12),
    isDelete: 0, createDt: '2026-06-01 09:00:00', updateDt: shift(-12),
  },
  {
    jobId: '1002', jobType: 'sql', jobName: '每日报表归档',
    lastMsg: `${shift(-260)}---正常, 归档 18422 行`,
    sqlDef: 'insert into t_report_archive select * from t_report where dt = current_date - 1',
    ruleDef: '',
    jobParam: '',
    schedule: '0 0 2 * * ?',
    nextRun: shift(45), runCnt: 137, successCnt: 136, lastRun: shift(-260),
    isDelete: 0, createDt: '2026-05-18 10:20:00', updateDt: shift(-260),
  },
  {
    jobId: '1003', jobType: 'sqlCheck', jobName: '支付失败率告警',
    lastMsg: `${shift(-6)}---正常, 失败率 0.31%`,
    sqlDef: "select round(sum(case when state='F' then 1 else 0 end) / count(1) * 100, 2) as rate from t_pay where dt = current_date",
    ruleDef: 'rate > 3',
    jobParam: '{"mail":"pay@demo.com;risk@demo.com"}',
    schedule: '0 */10 * * * ?',
    nextRun: shift(7), runCnt: 512, successCnt: 512, lastRun: shift(-6),
    isDelete: 0, createDt: '2026-07-02 14:05:00', updateDt: shift(-6),
  },
  {
    jobId: '1004', jobType: 'sql', jobName: '慢查询统计',
    lastMsg: `${shift(-95)}---正常, 统计 62 条`,
    sqlDef: 'select sql_text, elapsed from t_slow_log where dt = current_date',
    ruleDef: '',
    jobParam: '{"topN":50}',
    schedule: '0 30 1 * * ?',
    nextRun: shift(120), runCnt: 88, successCnt: 85, lastRun: shift(-95),
    isDelete: 0, createDt: '2026-08-11 16:40:00', updateDt: shift(-95),
  },
  {
    jobId: '1005', jobType: 'sqlCheck', jobName: '短信配额告警（已停用）',
    lastMsg: `${shift(-4320)}---[X]:当日短信配额已用 98%`,
    sqlDef: 'select used / total * 100 as pct from t_sms_quota where dt = current_date',
    ruleDef: 'pct > 95',
    jobParam: '',
    schedule: '0 0 */2 * * ?',
    nextRun: '—', runCnt: 41, successCnt: 39, lastRun: shift(-4320),
    isDelete: 1, createDt: '2026-06-20 11:00:00', updateDt: shift(-4320),
  },
  {
    jobId: '1006', jobType: 'sql', jobName: '历史订单清理（已下线）',
    lastMsg: `${shift(-43200)}---正常, 清理 9021 行`,
    sqlDef: 'delete from t_order_his where dt < current_date - 365',
    ruleDef: '',
    jobParam: '',
    schedule: '0 0 3 1 * ?',
    nextRun: '—', runCnt: 12, successCnt: 12, lastRun: shift(-43200),
    isDelete: -1, createDt: '2025-12-01 09:30:00', updateDt: shift(-43200),
  },
]

let commJobNextId = 1100

/** 分页查询：筛选口径见文件头注释。无排序（旧 COMM_JOB 的列里没有任何 sorter:true）。 */
export function mockCommJobPaged(params?: Record<string, unknown>): Paged<CommJob> {
  const queue = String(params?.queue ?? '').trim()
  const queueId = String(params?.queueId ?? '').trim()
  const name = String(params?.name ?? '').trim()
  const enable = String(params?.enable ?? '')
  const page = Math.max(1, Number(params?.page ?? 1) || 1)
  const limit = Math.max(1, Number(params?.limit ?? 100) || 100)

  const matched = COMM_JOBS.filter((row) => {
    if (queue && !row.jobName.includes(queue)) return false
    if (queueId && !String(row.jobId).includes(queueId)) return false
    if (name && !row.jobName.includes(name)) return false
    if (enable === '0' && row.isDelete !== 0) return false
    if (enable === '1' && row.isDelete !== 1) return false
    if (enable === '-1' && !(row.isDelete < 0)) return false
    return true
  })
  return { total: matched.length, list: matched.slice((page - 1) * limit, page * limit) }
}

/** 新增（真实改内存表；jobId 自增模拟后端主键） */
export function mockCommJobAdd(params?: Record<string, unknown>) {
  const row: CommJob = {
    jobId: String(commJobNextId++),
    jobType: String(params?.jobType ?? 'sql'),
    jobName: String(params?.jobName ?? ''),
    lastMsg: '',
    sqlDef: String(params?.sqlDef ?? ''),
    ruleDef: String(params?.ruleDef ?? ''),
    jobParam: String(params?.jobParam ?? ''),
    schedule: String(params?.schedule ?? ''),
    nextRun: '—',
    runCnt: 0,
    successCnt: 0,
    lastRun: '',
    isDelete: Number(params?.isDelete ?? 0),
    createDt: stamp(new Date()),
  }
  COMM_JOBS.push(row)
  return { ok: true, id: row.jobId, message: '新增成功（演示）' }
}

/** 修改（按 jobId 定位，只覆盖传了的字段） */
export function mockCommJobUpdate(params?: Record<string, unknown>) {
  const jobId = String(params?.jobId ?? '')
  const row = COMM_JOBS.find((r) => r.jobId === jobId)
  if (!row) return { ok: false, message: '未找到要修改的记录' }
  const text = (key: string) => (params?.[key] == null ? undefined : String(params[key]))
  row.jobType = text('jobType') ?? row.jobType
  row.jobName = text('jobName') ?? row.jobName
  row.sqlDef = text('sqlDef') ?? row.sqlDef
  row.ruleDef = text('ruleDef') ?? row.ruleDef
  row.jobParam = text('jobParam') ?? row.jobParam
  row.schedule = text('schedule') ?? row.schedule
  if (params?.isDelete != null) row.isDelete = Number(params.isDelete)
  row.updateDt = stamp(new Date())
  return { ok: true, message: '修改成功（演示）' }
}

/** 变更启停（enable 与 isDelete 同向：0=启用 / 1=停用） */
export function mockCommJobChangeEnable(params?: Record<string, unknown>) {
  const ids = String(params?.ids ?? '').split(',').filter(Boolean)
  const enable = Number(params?.enable ?? 0)
  const nextIsDelete = enable === 0 ? 0 : 1
  let hit = 0
  for (const id of ids) {
    const row = COMM_JOBS.find((r) => r.jobId === id)
    if (row) {
      row.isDelete = nextIsDelete
      hit++
    }
  }
  return { ok: true, demo: true, message: hit > 0 ? (enable === 0 ? '已启用' : '已停用') : '未找到对应记录' }
}

/** 删除（ids 走 query，逗号分隔）。
 *  注意：这里做的是**物理删除**（演示上更直观）；真实后端的 /delete 也可能是逻辑删除
 *  （把 isDelete 置成负数，列表里仍能按「历史删除的」筛出来，比如 1006），联调时按真实回执确认。 */
export function mockCommJobDelete(params?: Record<string, unknown>) {
  const ids = String(params?.ids ?? '').split(',').filter(Boolean)
  const before = COMM_JOBS.length
  for (const id of ids) {
    const idx = COMM_JOBS.findIndex((r) => r.jobId === id)
    if (idx >= 0) COMM_JOBS.splice(idx, 1)
  }
  return { ok: true, message: `删除 ${before - COMM_JOBS.length} 条成功（演示）` }
}

/** 复制一条任务（旧 commJobCopy）：新记录沿用原配置，名字加 `-copy`，运行统计清零、定时不变 */
export function mockCommJobCopy(params?: Record<string, unknown>) {
  const id = String(params?.id ?? '')
  const src = COMM_JOBS.find((r) => r.jobId === id)
  if (!src) return { ok: false, message: '未找到要复制的记录' }
  const copy: CommJob = {
    ...src,
    jobId: String(commJobNextId++),
    jobName: `${src.jobName}-copy`,
    runCnt: 0,
    successCnt: 0,
    lastRun: '',
    lastMsg: '',
    createDt: stamp(new Date()),
    updateDt: stamp(new Date()),
  }
  COMM_JOBS.push(copy)
  return { ok: true, id: copy.jobId, message: '复制成功（演示），请刷新后查询最新ID' }
}

/** 立即运行（旧 runCommJob）：真实后端是异步入队；mock 里只把「上次运行 / 执行信息 / 计数」更新掉，
 *  让页面刷新后能看到变化。 */
export function mockCommJobRun(params?: Record<string, unknown>) {
  const id = String(params?.id ?? '')
  const row = COMM_JOBS.find((r) => r.jobId === id)
  if (!row) return { ok: false, message: '未找到要运行的任务' }
  const now = new Date()
  row.lastRun = stamp(now)
  row.lastMsg = `${stamp(now)}---已提交运行（演示）`
  row.runCnt = Number(row.runCnt ?? 0) + 1
  row.updateDt = stamp(now)
  return { ok: true, message: '已提交运行（演示）' }
}
