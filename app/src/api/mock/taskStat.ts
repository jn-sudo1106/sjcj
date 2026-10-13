// 任务统计（/v1/task/stat）mock —— 只服务于新登记的 `task/stat` 端点。
//
// 形态 1:1 对齐真实后端：
//   · 不带 state 的请求 → 返回**没有 state 字段**的行（总数视角）
//   · 带 state 的请求（单状态或逗号分隔多状态）→ 每行带 state（后端支持多状态聚合的 v2 形态，
//     任务统计页的「能力探测」正是靠 sub[0].state 是否存在来判 v1/v2）
//   · 行字段只有 sourceId / configId / cnt（+ state），聚合维度由 group 决定：
//     source=按来源（configId 不返回）、config=按配置（sourceId 不返回）、both=来源+配置
//
// 数据是**合成**的，但内部自洽：先给每个「来源×配置」定一组按状态的权重（权重和=1），
// 再按请求窗口的天数等比放大，所以：
//   Σ各状态 cnt == 总数视角的 cnt（状态构成图不会出现切片和 > 合计的荒唐值）
//   错误率 = E / 总数，162050 与 161801 这两个分组是「全失败」，用来演示错误率 100% 的告警条。
import type { TaskStatQuery, TaskStatRow } from '../taskStat'

interface StatSeed {
  sourceId: string | null
  configId: string | null
  /** 每天的任务量 */
  perDay: number
  /** 状态分布（权重和为 1；含 PIE 图未单列的状态，好让「其他」切片非空） */
  dist: Record<string, number>
}

/** 合成种子。161801 / 162050 全失败 → 错误率 100%，页面的告警条与「错误率 ≥」筛选能看出效果。 */
const SEEDS: StatSeed[] = [
  {
    sourceId: '161725',
    configId: '70598',
    perDay: 120,
    dist: { C: 0.72, E: 0.1, AC: 0.05, W1: 0.05, W: 0.03, L: 0.01, WD: 0.02, WA: 0.02 },
  },
  { sourceId: '161801', configId: '70611', perDay: 60, dist: { E: 1 } },
  { sourceId: '161900', configId: '70812', perDay: 30, dist: { C: 0.45, E: 0.2, L: 0.3, RC: 0.05 } },
  { sourceId: '161901', configId: '70833', perDay: 12, dist: { C: 0.9, AC: 0.1 } },
  { sourceId: '162050', configId: '70901', perDay: 8, dist: { E: 1 } },
  // 配置为空 / 来源为空各留一条：验证 both 维度下的「-」与 keyOf 的 s-/c- 兜底
  { sourceId: '162060', configId: null, perDay: 5, dist: { C: 0.6, E: 0.4 } },
  { sourceId: null, configId: '70955', perDay: 4, dist: { C: 1 } },
]

const pad = (n: number) => String(n).padStart(2, '0')

/** 把 yyyy-MM-dd / yyyy-MM-dd HH:mm:ss 解成毫秒（解不出返回 null） */
function parseTime(v: string): number | null {
  if (!v) return null
  const iso = v.includes(' ') ? v.replace(' ', 'T') : `${v}T00:00:00`
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

/**
 * 请求窗口天数（含首尾）。
 * 与旧页的组装口径对应：要么 date（单日），要么 startTime/endTime（时间范围，最多 30 天）。
 * 只给一端时按 1 天算（与旧页 clampRange 只在两端都有时裁剪一致）。
 */
export function statWindowDays(query: TaskStatQuery): number {
  const start = parseTime(String(query.startTime ?? '').trim())
  const end = parseTime(String(query.endTime ?? '').trim())
  if (start !== null && end !== null && end >= start) {
    return Math.max(1, Math.floor((end - start) / 86_400_000) + 1)
  }
  return 1
}

/** 取某一状态在这一天里的条数：round(perDay × 天数 × 权重) */
function seedCnt(seed: StatSeed, state: string, days: number): number {
  return Math.round(seed.perDay * days * (seed.dist[state] ?? 0))
}

interface Bucket {
  sourceId: string | null
  configId: string | null
  /** state → cnt；key 为 '*' 表示「全部状态合计」 */
  byState: Map<string, number>
}

/**
 * 任务统计 mock。
 *
 * 筛选口径：sourceId / configId 按**包含**匹配（演示环境里输入半截 ID 也能看到效果），
 * state 支持单值与逗号分隔多值。
 */
export function mockTaskStat(params?: Record<string, unknown>): TaskStatRow[] {
  const text = (key: string) => String(params?.[key] ?? '').trim()
  const group = (text('group') || 'source') as NonNullable<TaskStatQuery['group']>
  const stateParam = text('state')
  const sourceIdFilter = text('sourceId')
  const configIdFilter = text('configId')
  const days = statWindowDays({
    date: text('date'),
    startTime: text('startTime'),
    endTime: text('endTime'),
  })
  const states = stateParam ? stateParam.split(',').map((s) => s.trim()).filter(Boolean) : []

  const hit = SEEDS.filter((seed) => {
    if (sourceIdFilter && !String(seed.sourceId ?? '').includes(sourceIdFilter)) return false
    if (configIdFilter && !String(seed.configId ?? '').includes(configIdFilter)) return false
    return true
  })

  // 按 group 聚合：key = 分组键；bucket 内累加各状态条数
  const buckets = new Map<string, Bucket>()
  hit.forEach((seed) => {
    // 缺失的那一维不参与分组（真实后端按来源聚合时不会返回 configId）
    const sourceId = group === 'config' ? null : seed.sourceId
    const configId = group === 'source' ? null : seed.configId
    if (group === 'source' && !sourceId) return
    if (group === 'config' && !configId) return
    const key = `${sourceId ?? '-'}|${configId ?? '-'}`
    const bucket = buckets.get(key) ?? { sourceId, configId, byState: new Map<string, number>() }
    const all = Object.keys(seed.dist).reduce((sum, state) => sum + seedCnt(seed, state, days), 0)
    bucket.byState.set('*', (bucket.byState.get('*') ?? 0) + all)
    states.forEach((state) => {
      const cnt = seedCnt(seed, state, days)
      if (cnt > 0) bucket.byState.set(state, (bucket.byState.get(state) ?? 0) + cnt)
    })
    buckets.set(key, bucket)
  })

  const rows: TaskStatRow[] = []
  buckets.forEach((bucket) => {
    if (!states.length) {
      // 总数视角：不带 state 字段
      const cnt = bucket.byState.get('*') ?? 0
      if (cnt > 0) rows.push({ sourceId: bucket.sourceId, configId: bucket.configId, cnt })
      return
    }
    states.forEach((state) => {
      const cnt = bucket.byState.get(state) ?? 0
      if (cnt > 0) rows.push({ sourceId: bucket.sourceId, configId: bucket.configId, cnt, state })
    })
  })

  // 与后端一致：按 cnt 降序（页面自己还会再排一次，这里保证看起来就是有序的）
  return rows.sort((a, b) => Number(b.cnt) - Number(a.cnt))
}

/** 供页面/测试复用的时间戳格式化（mock 不返回值，保留给断言用） */
export const mockStamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
