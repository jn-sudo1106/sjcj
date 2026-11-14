// 源维度列表的展示口径（纯函数，便于单测）。
//
// 为什么单独放一层：一行里的「数据情况 / 执行与通知 / 计划覆盖」各自有优先级和降级口径，
// 散在模板里既容易互相矛盾，也无法在 1366×768 下逐个断言。这里只做「把视图模型翻译成文案」，
// 不重新判定状态——判定在 `utils/monitor/sourceSummary.ts`（共享层，不在本页作用域）。

import type { MonitorDataStatus, MonitorExecStatus, MonitorSourceRow } from '@/api/types/monitorCenter'
import { DATA_TEXT, EXEC_TEXT } from '@/utils/monitor/record'
import { methodLabel } from '@/utils/monitor/methods'

export type Tone = 'ok' | 'run' | 'warn' | 'err' | 'muted'

/** 高优先级筛选：源、启停、数据情况。关键词单独处理，因为它同时匹配源名与源 ID。 */
export type EnableFilter = 'all' | 'enabled' | 'disabled' | 'unconfigured'
export type StatusFilter =
  | 'all'
  | 'abnormal'
  | 'failed'
  | 'draft'
  | 'unchecked'
  | 'pending'
  | 'normal'
  | 'disabled'
  | 'unconfigured'

/** 最近检查日期筛选：24 万源里「今天到底哪些源查过」是日常最常用的一个视角 */
export type CheckDateFilter = 'all' | 'today' | 'not-today'

export interface SourceListQuery {
  /** 源上下文时锁到该源；全局/网站上下文由源选择器给值 */
  sourceId: string
  enable: EnableFilter
  status: StatusFilter
  keyword: string
  checkDate?: CheckDateFilter
}

export const CHECK_DATE_OPTIONS: Array<{ value: CheckDateFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'today', label: '今天已检查' },
  { value: 'not-today', label: '今天未检查' },
]

export interface SourceStats {
  /** 本页源数（按源维度，不是监控记录数） */
  total: number
  /** 本页存在数据异常的源；与 execFailed 不互斥 */
  abnormal: number
  /** 本页存在启用中执行失败的源；与 abnormal 不互斥 */
  execFailed: number
}

export const ENABLE_OPTIONS: ReadonlyArray<{ value: EnableFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'enabled', label: '已启用' },
  { value: 'disabled', label: '已停用' },
  { value: 'unconfigured', label: '未配置检查' },
]

export const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'abnormal', label: '数据异常' },
  { value: 'failed', label: '执行失败' },
  { value: 'draft', label: '未生效' },
  { value: 'unchecked', label: '尚未检查' },
  { value: 'pending', label: '待判断' },
  { value: 'normal', label: '数据正常' },
  { value: 'disabled', label: '已停用' },
  { value: 'unconfigured', label: '未配置检查' },
]

/** 与源级「执行失败」口径一致：超时/取消都算没跑成，不能只看 failed。 */
const FAILED_EXECS: ReadonlySet<MonitorExecStatus> = new Set(['failed', 'timeout', 'cancelled'])

const DATA_TONES: Record<MonitorDataStatus, Tone> = {
  normal: 'ok',
  abnormal: 'err',
  no_data: 'warn',
  unknown: 'muted',
}

const LABEL_TONES: Record<MonitorSourceRow['tone'], Tone> = {
  good: 'ok',
  bad: 'err',
  warn: 'warn',
  unknown: 'muted',
  muted: 'muted',
}

/** 数据情况胶囊。 */
export function dataPillOf(row: MonitorSourceRow): { text: string; tone: Tone } {
  // §四：`no_data`（本次无待检记录）不是通过。共享层已把「全部启用项都是 no_data」
  // 判成「无待检记录」/warn，这里只在共享层仍给 good 时兜底。
  // 注意排除「同源另一项真查到数据并通过」的情况——那种整源就是数据正常，
  // 否则一行里会出现「数据正常」标签配「无待检记录」胶囊的自相矛盾。
  if (row.monitorTotal > 0 && row.monitorEnabled > 0 && row.data === 'no_data' && row.label !== '数据正常') {
    return { text: '无待检记录', tone: 'warn' }
  }
  return { text: row.label, tone: LABEL_TONES[row.tone] }
}

/**
 * 筛选用的「数据情况」分桶。
 * 直接读 sourceSummary 的 tone/label：优先级只维护在共享层一处，
 * 页面再算一套必然会在以后某次口径调整时漂移（筛出来和显示的对不上）。
 */
export function sourceBucket(row: MonitorSourceRow): StatusFilter {
  if (row.tone === 'muted') return row.monitorTotal === 0 ? 'unconfigured' : 'disabled'
  if (row.tone === 'bad') return 'abnormal'
  if (row.tone === 'good') return 'normal'
  if (row.tone === 'warn') {
    if (row.label.startsWith('执行失败')) return 'failed'
    if (row.label.startsWith('未生效')) return 'draft'
    // 「无待检记录」既没失败也没通过，归到待判断一类，避免被「数据正常」筛出来
    return 'pending'
  }
  // unknown 只有两种：「尚未检查」和「待判断」
  return row.label.startsWith('尚未检查') ? 'unchecked' : 'pending'
}

export function matchEnable(row: MonitorSourceRow, filter: EnableFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'enabled') return row.monitorEnabled > 0
  if (filter === 'disabled') return row.monitorTotal > 0 && row.monitorEnabled === 0
  return row.monitorTotal === 0
}

/** 关键词只匹配源名与源 ID（原型文案：搜索源名称或 ID），不做全字段模糊。 */
/**
 * 关键词匹配：源名称 / 源 ID / 主表。
 * 列表只有一个源筛选框（两个框并排会让人猜哪个生效），所以这里覆盖业务实际会用来找源的三样。
 */
export function matchKeyword(row: MonitorSourceRow, keyword: string): boolean {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return true
  return (
    (row.sourceName ?? '').toLowerCase().includes(kw) ||
    row.sourceId.toLowerCase().includes(kw) ||
    (row.tableName ?? '').toLowerCase().includes(kw)
  )
}

/**
 * 「最近检查」按业务时区（Asia/Shanghai）切日：后端时间戳可能是 ISO 带时区，
 * 直接截字符串会把 UTC 晚上算成第二天。
 */
export function businessDateOf(value: string | undefined): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(parsed)
}

export function todayOf(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now)
}

export function matchCheckDate(row: MonitorSourceRow, filter: CheckDateFilter, now: Date = new Date()): boolean {
  if (!filter || filter === 'all') return true
  const checkedOn = businessDateOf(row.lastCheckAt)
  const today = todayOf(now)
  // 没有任何检查记录 = 今天没检查过（不算「今天查过」）
  if (filter === 'today') return checkedOn === today
  return checkedOn !== today
}

export function filterSourceRows(rows: MonitorSourceRow[], query: SourceListQuery, now: Date = new Date()): MonitorSourceRow[] {
  return rows.filter((row) => {
    if (query.sourceId && row.sourceId !== query.sourceId) return false
    if (!matchEnable(row, query.enable)) return false
    if (query.status !== 'all' && sourceBucket(row) !== query.status) return false
    if (!matchCheckDate(row, query.checkDate ?? 'all', now)) return false
    return matchKeyword(row, query.keyword)
  })
}

export function sourceStats(rows: MonitorSourceRow[]): SourceStats {
  return {
    total: rows.length,
    // 服务端聚合行没有逐条 monitors，只有整源 data；两种来源都要算，否则聚合模式下永远显示 0
    abnormal: rows.filter(
      (row) => row.data === 'abnormal' || row.monitors.some((m) => m.data === 'abnormal'),
    ).length,
    execFailed: rows.filter((row) => row.monitors.some((m) => m.enabled && FAILED_EXECS.has(m.exec))).length,
  }
}

/** 时间只展示到分钟：13.6 寸下 MM-DD HH:mm 足够判断新鲜度，秒没有信息量。 */
export function formatAt(at?: string): string {
  if (!at) return ''
  const text = String(at).replace('T', ' ')
  const matched = /^(\d{4})-(\d{2})-(\d{2})[ ](\d{2}):(\d{2})/.exec(text)
  if (matched) return `${matched[2]}-${matched[3]} ${matched[4]}:${matched[5]}`
  return text.length > 16 ? text.slice(0, 16) : text
}

/** 检查覆盖列：已配置 N 项、其中启用 M 项。 */
export function checkCoverageOf(row: MonitorSourceRow): { main: string; sub: string } {
  if (row.monitorTotal === 0) return { main: '已配置 0', sub: '尚未配置检查' }
  const stopped = row.monitorTotal - row.monitorEnabled
  return {
    main: `已配置 ${row.monitorTotal} · 启用 ${row.monitorEnabled}`,
    sub: stopped > 0 ? `${stopped} 项停用` : '全部启用',
  }
}

/** 计划覆盖列：当前没有 C07 聚合，只能如实说「需服务端聚合」，不按时隙推算。 */
export function coverageOf(row: MonitorSourceRow): { main: string; sub: string; title: string } {
  if (row.monitorTotal === 0) {
    return { main: '—', sub: '尚未配置检查', title: '该源还没有监控记录，配置后才会有计划覆盖' }
  }
  if (row.monitorEnabled === 0) {
    return { main: '—', sub: '全部停用，不排期', title: '该源的检查项全部停用，服务端不为其安排时隙，因此不算漏跑' }
  }
  if (row.coverage && !row.coverageUnavailable) {
    const { due, finished, missed } = row.coverage
    return {
      main: `应 ${due} · 完成 ${finished}`,
      sub: missed > 0 ? `漏 ${missed}` : '无漏跑',
      title: `今天按时隙应执行 ${due} 次，已完成 ${finished} 次${missed > 0 ? `，漏跑 ${missed} 次` : ''}`
        + '（按 cron 时隙计算，本月早于宽限期的时隙不算漏跑）',
    }
  }
  return {
    main: '—（计划不可推算）',
    sub: '本页不推算漏跑',
    title: '计划覆盖需要服务端按时隙聚合（C07），当前接口未就绪；本页不按时隙推算，也不把本页数量当全站',
  }
}

/** 数据情况胶囊下面的解释：数字只数「本页能数的事实」，缺的维度不给 0。 */
export function dataHintOf(row: MonitorSourceRow): string {
  if (row.monitorTotal === 0) return '新增监控后才有结论'
  if (row.monitorEnabled === 0) return `${row.monitorTotal} 项检查全部停用`
  const enabled = row.monitors.filter((m) => m.enabled)
  const abnormal = row.monitors.filter((m) => m.data === 'abnormal').length
  const execFailed = enabled.filter((m) => FAILED_EXECS.has(m.exec)).length
  if (abnormal > 0) {
    return execFailed > 0 ? `${abnormal} 项异常 · ${execFailed} 项执行失败` : `${abnormal} 项异常`
  }
  if (execFailed > 0) return `${execFailed} 项执行失败，数量未知`
  const drafts = enabled.filter((m) => m.publishStatus === 'draft').length
  if (drafts > 0) return `${drafts} 项启用但无有效版本，不会执行`
  if (!enabled.some((m) => m.exec !== 'none')) return `${enabled.length} 项尚未执行，不能显示正常`
  if (row.data === 'no_data') return `${enabled.length} 项本次无待检记录，不算通过`
  const unknown = enabled.filter((m) => m.data === 'unknown').length
  if (unknown > 0) return `${unknown} 项待判断`
  return '各项均通过'
}

/** 执行与通知：两件事分开写，避免「执行成功」被读成「通知已送达」。 */
export function execNotifyOf(row: MonitorSourceRow): {
  exec: string
  execTone: Tone
  execTitle: string
  notify: string
  notifyTone: Tone
  notifyTitle: string
} {
  if (row.monitorTotal === 0) {
    return {
      exec: '—',
      execTone: 'muted',
      execTitle: '尚未配置检查，没有执行记录',
      notify: '—',
      notifyTone: 'muted',
      notifyTitle: '尚未配置检查',
    }
  }
  const enabled = row.monitors.filter((m) => m.enabled)
  const notifyConfigured = row.monitors.some((m) => m.conf?.notifyOn && m.conf.notifyOn !== 'none')
  const notify = row.notifyFailures > 0
    ? { text: `${row.notifyFailures} 项通知失败`, tone: 'err' as Tone, title: '通知投递失败；失败项不影响执行结论' }
    : notifyConfigured
      // 旧接口没有 C08 投递回执，不能显示「已送达」
      ? { text: '未取得回执', tone: 'muted' as Tone, title: '当前接口不返回投递回执（C08），只能确认已提交，不能确认送达' }
      : { text: '未配置通知', tone: 'muted' as Tone, title: '检查项没有配置通知策略' }

  if (row.monitorTotal > 0 && row.monitorEnabled === 0) {
    return {
      exec: '—',
      execTone: 'muted',
      execTitle: '已停用，不执行',
      notify: notify.text,
      notifyTone: notify.tone,
      notifyTitle: notify.title,
    }
  }
  const failed = enabled.filter((m) => FAILED_EXECS.has(m.exec)).length
  if (failed > 0) {
    return {
      exec: `${failed} 项执行失败`,
      execTone: 'err',
      execTitle: '执行失败时数据结论一律为待判断，数量未知，不能当作数据异常或正常',
      notify: notify.text,
      notifyTone: notify.tone,
      notifyTitle: notify.title,
    }
  }
  if (enabled.some((m) => m.exec === 'running')) {
    return { exec: '执行中', execTone: 'run', execTitle: '执行中，尚无本次结论', notify: notify.text, notifyTone: notify.tone, notifyTitle: notify.title }
  }
  if (enabled.some((m) => m.exec === 'queued')) {
    return { exec: '已受理 · 排队中', execTone: 'run', execTitle: '受理不代表执行成功', notify: notify.text, notifyTone: notify.tone, notifyTitle: notify.title }
  }
  const unchecked = enabled.filter((m) => m.exec === 'none').length
  if (unchecked > 0) {
    return {
      exec: `${unchecked} 项尚未执行`,
      execTone: 'muted',
      execTitle: '尚未执行不能显示正常',
      notify: notify.text,
      notifyTone: notify.tone,
      notifyTitle: notify.title,
    }
  }
  return { exec: '执行正常', execTone: 'muted', execTitle: '最近一次执行没有失败', notify: notify.text, notifyTone: notify.tone, notifyTitle: notify.title }
}

/** 最近检查：时间 + 结论。没有记录时不能说「漏跑」，首次执行前不算漏跑。 */
export function lastCheckOf(row: MonitorSourceRow): { main: string; sub: string; title: string } {
  const at = formatAt(row.lastCheckAt)
  if (!at) {
    return {
      main: '尚未检查',
      sub: '首次执行前不算漏跑',
      title: '还没有任何一次正式运行的记录',
    }
  }
  return {
    main: at,
    sub: EXEC_TEXT[row.exec],
    title: `最近检查时间：${row.lastCheckAt}`,
  }
}

export function monitorKindText(kind: 'ai' | 'rule'): string {
  return kind === 'ai' ? 'AI 脚本' : '规则检查'
}

/** 发布就绪：草稿必须写「未生效」，否则会被误读为「已排期但还没跑」。 */
export function monitorPublishText(publishStatus: string, effectiveVersion?: string): string {
  if (publishStatus === 'draft') return '草稿 · 未生效'
  if (publishStatus === 'pending') return '待发布'
  if (publishStatus === 'failed') return '发布失败'
  return effectiveVersion ? `生效 ${effectiveVersion}` : '已生效'
}

/** 检查摘要：AI 看方法，规则看数量范围；都取不到时显式说「未选」，不要留空。 */
export function monitorSummaryOf(record: {
  kind: 'ai' | 'rule'
  conf?: { methods?: string[]; minSize?: number | string; maxSize?: number | string }
}): string {
  if (record.kind === 'ai') {
    const methods = (record.conf?.methods ?? []).filter((m) => Boolean(m))
    if (!methods.length) return '未选检查方法'
    const labels = methods.slice(0, 2).map((m) => methodLabel(m))
    return methods.length > 2 ? `${labels.join(' + ')} 等 ${methods.length} 项` : labels.join(' + ')
  }
  const range = (value?: number | string) => (value === undefined || value === '' ? '—' : String(value))
  // 两端都没限制时不编造数字区间（0 是真实下限，必须保留）
  if (range(record.conf?.minSize) === '—' && range(record.conf?.maxSize) === '—') return '新增量 · 未限制'
  return `新增量 · ${range(record.conf?.minSize)}—${range(record.conf?.maxSize)} 条`
}

/**
 * 执行计划：cron 与下次时间分两行，方便在窄列里扫。
 *
 * `next` 优先取 `checkConf.schedule.next`：AI 检查由执行器排期，`ck_source.NEXT_RUN`
 * 为了避开 Java 调度器停在远期，直接展示会显示成 2027 年。
 */
export function monitorPlanOf(record: {
  schedule: string
  nextRun?: string
  conf?: { cron?: string; schedule?: { next?: string } }
}): {
  plan: string
  next: string
} {
  const plan = record.schedule || record.conf?.cron || ''
  const next = record.conf?.schedule?.next || record.nextRun
  return { plan: plan || '—', next: next ? formatAt(next) : '—' }
}

/** 展开行里的「最近数据结论」：停用项不显示数据结论（旧接口停用后 state 会留着旧值）。 */
export function monitorDataOf(record: { enabled: boolean; data: MonitorDataStatus }): { text: string; tone: Tone; title: string } {
  if (!record.enabled) return { text: '—', tone: 'muted', title: '已停用，不显示数据结论' }
  return { text: DATA_TEXT[record.data], tone: DATA_TONES[record.data], title: '' }
}

export function monitorExecOf(record: { exec: MonitorExecStatus }): { text: string; tone: Tone } {
  const text = EXEC_TEXT[record.exec]
  if (FAILED_EXECS.has(record.exec)) return { text, tone: 'err' }
  if (record.exec === 'running' || record.exec === 'queued') return { text, tone: 'run' }
  return { text, tone: 'muted' }
}
/**
 * 源列的主标题：业务上认名字，不认 ID。
 * 只有拿不到名字（目录未加载 / 已删除）时才退回 ID，并明确标注「源 <ID>」，
 * 避免把裸 ID 当成名称展示（2026-11-12 反馈）。
 */
export function sourceTitleOf(row: Pick<MonitorSourceRow, 'sourceId' | 'sourceName'>): string {
  const name = (row.sourceName ?? '').trim()
  return name || `源 ${row.sourceId}`
}

/**
 * 源列的副标题：网站 + 主表，业务看得懂的两项。
 * 源 ID 不再出现在正文里，只留在 title 提示中备查。
 * 拿不到的部分直接省掉（「网站未回显 · 主表未回显」这种占位文字占地方又没信息量），
 * 两项都没有时给一个短横。
 */
export function sourceSubtitleOf(row: Pick<MonitorSourceRow, 'siteName' | 'tableName'>): string {
  const parts = [(row.siteName ?? '').trim(), (row.tableName ?? '').trim()].filter(Boolean)
  return parts.length ? parts.join(' · ') : '—'
}

/** 悬停提示：ID 放这里，排查时能看到，又不占正文。 */
export function sourceHintOf(
  row: Pick<MonitorSourceRow, 'sourceId' | 'sourceName' | 'siteName' | 'tableName'>,
): string {
  const name = (row.sourceName ?? '').trim() || '未命名源'
  return `${name}｜源 ID ${row.sourceId}｜网站 ${row.siteName || '未回显'}｜主表 ${row.tableName || '未回显'}`
}
