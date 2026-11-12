import { describe, expect, it } from 'vitest'
import type { MonitorRecordView, MonitorSourceRow } from '@/api/types/monitorCenter'
import { summarizeSource, summarizeSources } from '@/utils/monitor/sourceSummary'
import { EXEC_TEXT } from '@/utils/monitor/record'
import {
  checkCoverageOf,
  coverageOf,
  dataHintOf,
  dataPillOf,
  execNotifyOf,
  filterSourceRows,
  matchCheckDate,
  businessDateOf,
  todayOf,
  formatAt,
  lastCheckOf,
  monitorDataOf,
  monitorExecOf,
  monitorKindText,
  monitorPlanOf,
  monitorPublishText,
  monitorSummaryOf,
  sourceBucket,
  sourceHintOf,
  sourceStats,
  sourceSubtitleOf,
  sourceTitleOf,
} from './sourceRows'

function rec(patch: Partial<MonitorRecordView> = {}): MonitorRecordView {
  return {
    id: 'm1',
    sourceId: 's1',
    name: '检查项',
    kind: 'ai',
    enabled: true,
    schedule: '0 8 * * *',
    publishStatus: 'ready',
    exec: 'succeeded',
    data: 'normal',
    notify: 'unknown',
    count: '10',
    conf: {},
    raw: {} as MonitorRecordView['raw'],
    ...patch,
  }
}

function row(
  monitors: MonitorRecordView[],
  source: { id: string; name?: string; tableName?: string } = { id: 's1', name: '源一' },
): MonitorSourceRow {
  return summarizeSource(source.id, monitors, { id: source.id, name: source.name ?? source.id, tableName: source.tableName })
}

describe('最近检查日期筛选', () => {
  const now = new Date('2026-11-12T04:30:00Z') // 北京时间 12:30，同一天
  const today = todayOf(now)

  it('业务时区切日：UTC 深夜算北京时间次日', () => {
    expect(businessDateOf('2026-11-11T16:30:00Z')).toBe('2026-11-12')
    expect(businessDateOf('2026-11-11T15:30:00Z')).toBe('2026-11-11')
  })

  it('今天已检查只留业务时区今天有检查记录的源', () => {
    const checked = row([rec({ lastCheckAt: '2026-11-12T01:00:00Z' })])
    const yesterday = row([rec({ lastCheckAt: '2026-11-11T01:00:00Z' })])
    const never = row([rec({ lastCheckAt: undefined })])
    expect(matchCheckDate(checked, 'today', now)).toBe(true)
    expect(matchCheckDate(yesterday, 'today', now)).toBe(false)
    expect(matchCheckDate(never, 'today', now)).toBe(false)
    expect(today).toBe('2026-11-12')
  })

  it('今天未检查包含从未检查过的源', () => {
    expect(matchCheckDate(row([rec({ lastCheckAt: '2026-11-11T01:00:00Z' })]), 'not-today', now)).toBe(true)
    expect(matchCheckDate(row([rec({ lastCheckAt: undefined })]), 'not-today', now)).toBe(true)
    expect(matchCheckDate(row([rec({ lastCheckAt: '2026-11-12T01:00:00Z' })]), 'not-today', now)).toBe(false)
  })

  it('filterSourceRows 组合筛选时保留全部语义', () => {
    const rows = [
      row([rec({ lastCheckAt: '2026-11-12T01:00:00Z' })]),
      row([rec({ lastCheckAt: '2026-11-11T01:00:00Z' })]),
    ]
    const filtered = filterSourceRows(rows, { sourceId: '', enable: 'all', status: 'all', keyword: '', checkDate: 'today' }, now)
    expect(filtered).toHaveLength(1)
  })
})

describe('dataPillOf', () => {
  it('未配置检查不显示绿色', () => {
    const pill = dataPillOf(row([]))
    expect(pill).toEqual({ text: '未配置检查', tone: 'muted' })
  })

  it('全部停用显示已停用而不是数据正常', () => {
    const pill = dataPillOf(row([rec({ enabled: false })]))
    expect(pill.text).toBe('已停用')
    expect(pill.tone).not.toBe('ok')
  })

  it('执行失败显示「执行失败 · 数量未知」且不当作数据异常', () => {
    const pill = dataPillOf(row([rec({ exec: 'failed', data: 'unknown' })]))
    expect(pill.text).toBe('执行失败 · 数量未知')
    expect(pill.tone).toBe('warn')
  })

  it('数据异常优先于执行失败', () => {
    const pill = dataPillOf(row([rec({ data: 'abnormal' }), rec({ id: 'm2', exec: 'failed', data: 'unknown' })]))
    expect(pill).toEqual({ text: '数据异常', tone: 'err' })
  })

  it('草稿显示未生效', () => {
    const pill = dataPillOf(row([rec({ publishStatus: 'draft', exec: 'none', data: 'unknown' })]))
    expect(pill).toEqual({ text: '未生效 · 不会执行', tone: 'warn' })
  })

  it('尚未执行不显示绿色', () => {
    const pill = dataPillOf(row([rec({ exec: 'none', data: 'unknown' })]))
    expect(pill.text).toBe('尚未检查')
    expect(pill.tone).not.toBe('ok')
  })

  it('全部启用项 no_data：共享层判「无待检记录」，不显示绿色', () => {
    const source = row([rec({ exec: 'succeeded', data: 'no_data' })])
    expect(source.label).toBe('无待检记录')
    expect(source.tone).toBe('warn')
    expect(dataPillOf(source)).toEqual({ text: '无待检记录', tone: 'warn' })
    expect(sourceBucket(source)).toBe('pending')
  })

  it('一项通过一项 no_data 时整源仍是数据正常，不误标黄', () => {
    const source = row([rec(), rec({ id: 'm2', exec: 'succeeded', data: 'no_data' })])
    expect(source.label).toBe('数据正常')
    expect(dataPillOf(source)).toEqual({ text: '数据正常', tone: 'ok' })
    expect(sourceBucket(source)).toBe('normal')
  })

  it('只有所有启用项都通过才显示绿色', () => {
    const pill = dataPillOf(row([rec(), rec({ id: 'm2' })]))
    expect(pill).toEqual({ text: '数据正常', tone: 'ok' })
  })
})

describe('sourceBucket 与筛选', () => {
  const rows = [
    row([rec({ data: 'abnormal' })], { id: 's-abnormal', name: '异常源' }),
    row([rec({ exec: 'timeout', data: 'unknown' })], { id: 's-failed', name: '失败源', tableName: 'sense_data.detail_main' }),
    row([rec({ publishStatus: 'draft', exec: 'none', data: 'unknown' })], { id: 's-draft', name: '草稿源' }),
    row([rec({ exec: 'none', data: 'unknown' })], { id: 's-unchecked', name: '未检查源' }),
    row([rec({ exec: 'succeeded', data: 'unknown' })], { id: 's-pending', name: '待判断源' }),
    row([rec()], { id: 's-normal', name: '正常源' }),
    row([rec({ enabled: false, data: 'unknown' })], { id: 's-disabled', name: '停用源' }),
    row([], { id: 's-empty', name: '未配置源' }),
  ]

  it('分桶与 label 优先级一致', () => {
    expect(rows.map((item) => sourceBucket(item))).toEqual([
      'abnormal',
      'failed',
      'draft',
      'unchecked',
      'pending',
      'normal',
      'disabled',
      'unconfigured',
    ])
  })

  it('按数据情况筛选只返回命中的源', () => {
    const matched = filterSourceRows(rows, { sourceId: '', enable: 'all', status: 'failed', keyword: '' })
    expect(matched.map((item) => item.sourceId)).toEqual(['s-failed'])
  })

  it('按启停筛选区分已停用与未配置', () => {
    const disabled = filterSourceRows(rows, { sourceId: '', enable: 'disabled', status: 'all', keyword: '' })
    expect(disabled.map((item) => item.sourceId)).toEqual(['s-disabled'])
    const empty = filterSourceRows(rows, { sourceId: '', enable: 'unconfigured', status: 'all', keyword: '' })
    expect(empty.map((item) => item.sourceId)).toEqual(['s-empty'])
  })

  it('关键词同时匹配源名与源 ID，且不区分大小写', () => {
    const byName = filterSourceRows(rows, { sourceId: '', enable: 'all', status: 'all', keyword: '未配置' })
    expect(byName.map((item) => item.sourceId)).toEqual(['s-empty'])
    const byId = filterSourceRows(rows, { sourceId: '', enable: 'all', status: 'all', keyword: 'S-FAILED' })
    expect(byId.map((item) => item.sourceId)).toEqual(['s-failed'])
  })

  it('关键词也匹配主表（列表只有一个源筛选框）', () => {
    const byTable = filterSourceRows(rows, { sourceId: '', enable: 'all', status: 'all', keyword: 'detail' })
    expect(byTable.map((item) => item.sourceId)).toEqual(['s-failed'])
  })

  it('源筛选锁定单个源，空白关键词不影响结果', () => {
    const matched = filterSourceRows(rows, { sourceId: 's-normal', enable: 'all', status: 'all', keyword: '  ' })
    expect(matched.map((item) => item.sourceId)).toEqual(['s-normal'])
  })
})

describe('sourceStats', () => {
  it('异常与执行失败分开计数，同一源可同时计入', () => {
    const stats = sourceStats([
      row([rec({ data: 'abnormal' }), rec({ id: 'm2', exec: 'failed', data: 'unknown' })]),
      row([rec()], { id: 's2' }),
    ])
    expect(stats).toEqual({ total: 2, abnormal: 1, execFailed: 1 })
  })

  it('停用项的失败不计入本页执行失败', () => {
    const stats = sourceStats([row([rec({ enabled: false, exec: 'failed', data: 'unknown' })])])
    expect(stats.execFailed).toBe(0)
  })
})

describe('未配置检查的源也要出行', () => {
  it('传入源目录时未配置源出现，且标记 unconfigured', () => {
    const rows = summarizeSources(
      [rec({ sourceId: 's1' })],
      [
        { id: 's1', name: '有监控的源' },
        { id: 's2', name: '没监控的源' },
      ],
    )
    expect(rows).toHaveLength(2)
    const empty = rows.find((item) => item.sourceId === 's2')
    expect(empty?.unconfigured).toBe(true)
    expect(empty?.monitorTotal).toBe(0)
    expect(empty?.label).toBe('未配置检查')
  })
})

describe('coverageOf', () => {
  it('未配置源显示 — 而不是 0', () => {
    expect(coverageOf(row([]))).toMatchObject({ main: '—', sub: '尚未配置检查' })
  })

  it('无 C07 显示「—（需服务端聚合）」并说明不推算', () => {
    const coverage = coverageOf(row([rec()]))
    expect(coverage.main).toBe('—（需服务端聚合）')
    expect(coverage.sub).toBe('本页不推算漏跑')
    expect(coverage.title).toContain('C07')
    expect(coverage.title).toContain('不按时隙推算')
  })

  it('有聚合数据时才显示已完成 / 应到期', () => {
    const source = row([rec()])
    source.coverage = { status: 'completed', due: 4, finished: 3, succeeded: 3, failed: 0, missed: 0 }
    expect(coverageOf(source).main).toBe('3 / 4')
  })
})

describe('checkCoverageOf / dataHintOf', () => {
  it('检查覆盖说明已配置与启用数量', () => {
    expect(checkCoverageOf(row([rec(), rec({ id: 'm2', enabled: false })]))).toEqual({
      main: '已配置 2 · 启用 1',
      sub: '1 项停用',
    })
    expect(checkCoverageOf(row([]))).toEqual({ main: '已配置 0', sub: '尚未配置检查' })
  })

  it('数据情况解释按最差事实给出，未配置/停用不给结论', () => {
    expect(dataHintOf(row([]))).toBe('新增监控后才有结论')
    expect(dataHintOf(row([rec({ enabled: false }), rec({ id: 'm2', enabled: false })]))).toBe('2 项检查全部停用')
    expect(dataHintOf(row([rec({ data: 'abnormal' }), rec({ id: 'm2', exec: 'failed', data: 'unknown' })]))).toBe(
      '1 项异常 · 1 项执行失败',
    )
    expect(dataHintOf(row([rec({ exec: 'timeout', data: 'unknown' })]))).toBe('1 项执行失败，数量未知')
    expect(dataHintOf(row([rec({ publishStatus: 'draft', exec: 'none', data: 'unknown' })]))).toBe(
      '1 项启用但无有效版本，不会执行',
    )
    expect(dataHintOf(row([rec({ exec: 'none', data: 'unknown' })]))).toBe('1 项尚未执行，不能显示正常')
    expect(dataHintOf(row([rec({ exec: 'succeeded', data: 'unknown' })]))).toBe('1 项待判断')
    expect(dataHintOf(row([rec()]))).toBe('各项均通过')
  })
})

describe('execNotifyOf', () => {
  it('执行失败与通知未取得回执分开显示', () => {
    const cell = execNotifyOf(row([rec({ exec: 'failed', data: 'unknown', conf: { notifyOn: 'error' } })]))
    expect(cell.exec).toBe('1 项执行失败')
    expect(cell.execTone).toBe('err')
    expect(cell.notify).toBe('未取得回执')
    expect(cell.notifyTitle).toContain('C08')
  })

  it('没有通知策略时显示未配置通知', () => {
    expect(execNotifyOf(row([rec()])).notify).toBe('未配置通知')
  })

  it('通知失败数优先于未取得回执', () => {
    const cell = execNotifyOf(row([rec({ notify: 'failed', conf: { notifyOn: 'all' } })]))
    expect(cell.notify).toBe('1 项通知失败')
    expect(cell.notifyTone).toBe('err')
  })

  it('停用源不显示执行与数据结论', () => {
    const cell = execNotifyOf(row([rec({ enabled: false })]))
    expect(cell.exec).toBe('—')
    expect(cell.execTitle).toBe('已停用，不执行')
  })

  it('未配置源全部显示 —', () => {
    const cell = execNotifyOf(row([]))
    expect(cell.exec).toBe('—')
    expect(cell.notify).toBe('—')
  })

  it('排队/执行中不能说执行成功', () => {
    expect(execNotifyOf(row([rec({ exec: 'queued' })])).exec).toBe('已受理 · 排队中')
    expect(execNotifyOf(row([rec({ exec: 'running' })])).exec).toBe('执行中')
    expect(execNotifyOf(row([rec({ exec: 'none', data: 'unknown' })])).exec).toBe('1 项尚未执行')
    expect(execNotifyOf(row([rec()])).exec).toBe('执行正常')
  })
})

describe('lastCheckOf / formatAt', () => {
  it('没有记录时显示尚未检查，不暗示漏跑', () => {
    expect(lastCheckOf(row([rec({ exec: 'none', data: 'unknown' })]))).toMatchObject({
      main: '尚未检查',
      sub: '首次执行前不算漏跑',
    })
  })

  it('有记录时显示到分钟并带执行结论', () => {
    const source = row([rec({ exec: 'succeeded', lastCheckAt: '2026-11-10 08:30:00' })])
    expect(lastCheckOf(source)).toMatchObject({ main: '11-10 08:30', sub: EXEC_TEXT.succeeded })
  })

  it('时间格式兼容 ISO 与空值', () => {
    expect(formatAt('2026-11-10T08:30:00')).toBe('11-10 08:30')
    expect(formatAt('2026-11-10 08:30:00.000')).toBe('11-10 08:30')
    expect(formatAt(undefined)).toBe('')
  })
})

describe('展开行文案', () => {
  it('方式与发布就绪', () => {
    expect(monitorKindText('ai')).toBe('AI 脚本')
    expect(monitorKindText('rule')).toBe('规则检查')
    expect(monitorPublishText('draft')).toBe('草稿 · 未生效')
    expect(monitorPublishText('pending')).toBe('待发布')
    expect(monitorPublishText('failed')).toBe('发布失败')
    expect(monitorPublishText('ready', 'v3')).toBe('生效 v3')
    expect(monitorPublishText('ready')).toBe('已生效')
  })

  it('检查摘要：AI 看方法、规则看数量范围，minSize=0 要保留', () => {
    expect(monitorSummaryOf({ kind: 'ai', conf: { methods: ['a', 'b', 'c'] } })).toBe('a + b 等 3 项')
    expect(monitorSummaryOf({ kind: 'ai', conf: { methods: ['a'] } })).toBe('a')
    expect(monitorSummaryOf({ kind: 'ai', conf: { methods: [] } })).toBe('未选检查方法')
    expect(monitorSummaryOf({ kind: 'rule', conf: { minSize: 0, maxSize: 100 } })).toBe('新增量 · 0—100 条')
    expect(monitorSummaryOf({ kind: 'rule', conf: {} })).toBe('新增量 · 未限制')
  })

  it('执行计划显示 cron 与下次时间', () => {
    expect(monitorPlanOf({ schedule: '0 8 * * *', nextRun: '2026-11-10T08:30:00' })).toEqual({
      plan: '0 8 * * *',
      next: '11-10 08:30',
    })
    expect(monitorPlanOf({ schedule: '' })).toEqual({ plan: '—', next: '—' })
  })

  it('下次执行优先取执行器排期（AI 记录的 NEXT_RUN 停在远期）', () => {
    expect(
      monitorPlanOf({
        schedule: '0 0 8 * * ?',
        nextRun: '2027-01-01T08:00:00',
        conf: { schedule: { next: '2026-11-13 08:00:00' } },
      }),
    ).toEqual({ plan: '0 0 8 * * ?', next: '11-13 08:00' })
    // 没有执行器排期时仍回落旧字段
    expect(monitorPlanOf({ schedule: '0 0 8 * * ?', nextRun: '2026-11-13T08:00:00', conf: {} })).toEqual({
      plan: '0 0 8 * * ?',
      next: '11-13 08:00',
    })
  })

  it('停用项不显示数据结论', () => {
    expect(monitorDataOf({ enabled: false, data: 'abnormal' })).toEqual({
      text: '—',
      tone: 'muted',
      title: '已停用，不显示数据结论',
    })
    expect(monitorDataOf({ enabled: true, data: 'normal' })).toMatchObject({ text: '数据正常', tone: 'ok' })
    expect(monitorDataOf({ enabled: true, data: 'abnormal' })).toMatchObject({ text: '数据异常', tone: 'err' })
  })

  it('执行状态色调区分失败、进行中与未知', () => {
    expect(monitorExecOf({ exec: 'failed' })).toEqual({ text: '执行失败', tone: 'err' })
    expect(monitorExecOf({ exec: 'running' })).toEqual({ text: '执行中', tone: 'run' })
    expect(monitorExecOf({ exec: 'succeeded' })).toEqual({ text: '执行成功', tone: 'muted' })
  })
})
describe('sourceTitleOf / sourceSubtitleOf / sourceHintOf', () => {
  it('主标题优先用源名称，不展示裸 ID', () => {
    expect(sourceTitleOf({ sourceId: '301236115', sourceName: '上市公司新闻' })).toBe('上市公司新闻')
  })

  it('拿不到名称时才退回「源 <ID>」，并明确标注', () => {
    expect(sourceTitleOf({ sourceId: '301236115' })).toBe('源 301236115')
    expect(sourceTitleOf({ sourceId: '301236115', sourceName: '   ' })).toBe('源 301236115')
  })

  it('副标题是网站 + 主表，不含源 ID', () => {
    const text = sourceSubtitleOf({ siteName: '财经资讯站', tableName: 'news_main' })
    expect(text).toBe('财经资讯站 · news_main')
    expect(text).not.toContain('301236115')
  })

  it('副标题字段缺失时给出可读的未回显提示，而不是留空或补 ID', () => {
    expect(sourceSubtitleOf({})).toBe('—')
    expect(sourceSubtitleOf({ siteName: '站A' })).toBe('站A')
    expect(sourceSubtitleOf({ tableName: 'sense_data.news_main' })).toBe('sense_data.news_main')
    expect(sourceSubtitleOf({ siteName: '站A', tableName: 'sense_data.news_main' })).toBe('站A · sense_data.news_main')
  })

  it('悬停提示里保留源 ID，便于排查', () => {
    const hint = sourceHintOf({ sourceId: '301236115', sourceName: '上市公司新闻', siteName: '财经资讯站', tableName: 'news_main' })
    expect(hint).toContain('上市公司新闻')
    expect(hint).toContain('源 ID 301236115')
    expect(hint).toContain('news_main')
  })
})
