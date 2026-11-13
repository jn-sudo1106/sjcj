import { describe, expect, it } from 'vitest'
import type { MonitorCheckConf, MonitorRecordView } from '@/api/types/monitorCenter'
import {
  DEFAULT_WINDOW_HOURS,
  MAX_TIME_COLUMN_OPTIONS,
  buildSaveFeedback,
  confFromForm,
  emptyForm,
  formFromRecord,
  formSignature,
  looksLikeTimeColumn,
  normalizeWindowHours,
  needsRegenerate,
  regenerateReasons,
  scheduleIntervalHours,
  timeColumnOptionsOf,
  windowOfForm,
} from './model'

function recordOf(conf: MonitorCheckConf, overrides: Partial<MonitorRecordView> = {}): MonitorRecordView {
  return {
    id: 'mon-1',
    sourceId: 's1',
    sourceName: '测试源',
    name: '测试监控',
    tableName: 'sense_data.TB_RAW',
    kind: 'ai',
    enabled: true,
    schedule: '0 0 6-22 * * ?',
    publishStatus: 'ready',
    effectiveVersion: 'v1',
    exec: 'succeeded',
    data: 'normal',
    notify: 'unknown',
    count: '',
    conf,
    raw: {} as MonitorRecordView['raw'],
    ...overrides,
  }
}

describe('入库时间字段候选', () => {
  it('只保留像时间列的真实字段，其余字段不出现', () => {
    const options = timeColumnOptionsOf(['title', 'publish_time', 'CREATE_DT', 'content', 'stat_DATE', 'update_dt'])
    expect(options).toEqual(['publish_time', 'CREATE_DT', 'stat_DATE', 'update_dt'])
  })

  it('拿不到字段清单时退回固定候选（不是伪造列名，是让用户手选）', () => {
    expect(timeColumnOptionsOf([])).toEqual(['CREATE_DT', 'UPDATE_DT', 'MODIFY_DT', 'publish_time', 'time'])
    expect(timeColumnOptionsOf(null)).toEqual(['CREATE_DT', 'UPDATE_DT', 'MODIFY_DT', 'publish_time', 'time'])
  })

  it('清单里没有时间列时同样退回固定候选', () => {
    expect(timeColumnOptionsOf(['title', 'content'])).toEqual(['CREATE_DT', 'UPDATE_DT', 'MODIFY_DT', 'publish_time', 'time'])
  })

  it('已保存的值即使不在候选里也保留为可选项（旧记录打开不能显示空白）', () => {
    expect(timeColumnOptionsOf(['publish_time'], 'CREATE_DT')).toEqual(['CREATE_DT', 'publish_time'])
  })

  it('候选最多 20 个', () => {
    const fields = Array.from({ length: 30 }, (_, index) => `col_${index}_dt`)
    expect(timeColumnOptionsOf(fields)).toHaveLength(MAX_TIME_COLUMN_OPTIONS)
  })

  it('像时间列的判定大小写不敏感', () => {
    expect(looksLikeTimeColumn('CREATE_DT')).toBe(true)
    expect(looksLikeTimeColumn('publish_time')).toBe(true)
    expect(looksLikeTimeColumn('stat_date')).toBe(true)
    expect(looksLikeTimeColumn('title')).toBe(false)
    expect(looksLikeTimeColumn('')).toBe(false)
  })
})

describe('检查窗口小时数归一', () => {
  it('空值/非法值退回默认 24，合法值取整并夹到 1–720', () => {
    expect(normalizeWindowHours('')).toBe(DEFAULT_WINDOW_HOURS)
    expect(normalizeWindowHours('abc')).toBe(DEFAULT_WINDOW_HOURS)
    expect(normalizeWindowHours(0)).toBe(1)
    expect(normalizeWindowHours('12.6')).toBe(13)
    expect(normalizeWindowHours(9999)).toBe(720)
  })
})

describe('执行计划间隔推 window.periodHours', () => {
  it('能算的日内周期按实际间隔', () => {
    // 每天 6–22 点每小时一次
    expect(scheduleIntervalHours('0 0 6-22 * * ?')).toBe(1)
    // 每 2 小时一次
    expect(scheduleIntervalHours('0 0 */2 * * ?')).toBe(2)
    // 每 5 分钟一次：小时粒度下按 1 小时
    expect(scheduleIntervalHours('0 */5 * * * ?')).toBe(1)
    // 每天 8 点、20 点两次：最小间隔 12 小时
    expect(scheduleIntervalHours('0 0 8,20 * * ?')).toBe(12)
    // 每天一次
    expect(scheduleIntervalHours('0 0 6 * * ?')).toBe(24)
  })

  it('算不出来（空/AFTER/非 6 段）一律退回 24，不瞎猜', () => {
    expect(scheduleIntervalHours('')).toBe(DEFAULT_WINDOW_HOURS)
    expect(scheduleIntervalHours('AFTER:30m')).toBe(DEFAULT_WINDOW_HOURS)
    expect(scheduleIntervalHours('*/5 * * * *')).toBe(DEFAULT_WINDOW_HOURS)
  })
})

describe('windowOfForm 表单 → checkConf.window', () => {
  it('三种窗口类型分别写 today / hours / period', () => {
    const base = emptyForm()
    expect(windowOfForm({ ...base, windowType: 'today' })).toEqual({ type: 'today' })
    expect(windowOfForm({ ...base, windowType: 'hours', windowHours: '12' })).toEqual({ type: 'hours', hours: 12 })
    expect(
      windowOfForm({ ...base, windowType: 'hours', windowHours: '9999' }),
    ).toEqual({ type: 'hours', hours: 720 })
    expect(
      windowOfForm({ ...base, windowType: 'period', schedule: '0 0 */2 * * ?' }),
    ).toEqual({ type: 'period', periodHours: 2 })
  })
})

describe('formFromRecord / confFromForm 的 timeColumn 与 window 互转', () => {
  it('回填已有 timeColumn 与 hours 窗口', () => {
    const form = formFromRecord(recordOf({
      kind: 'ai',
      methods: ['today_landed'],
      timeColumn: 'CREATE_DT',
      window: { type: 'hours', hours: 6 },
    }))
    expect(form.timeColumn).toBe('CREATE_DT')
    expect(form.windowType).toBe('hours')
    expect(form.windowHours).toBe('6')
  })

  it('未配置窗口按「当日」；period 类型保持 hours 默认值', () => {
    const today = formFromRecord(recordOf({ kind: 'ai', methods: ['today_landed'] }))
    expect(today.windowType).toBe('today')
    expect(today.windowHours).toBe(String(DEFAULT_WINDOW_HOURS))

    const period = formFromRecord(recordOf({ kind: 'ai', methods: ['today_landed'], window: { type: 'period', periodHours: 4 } }))
    expect(period.windowType).toBe('period')
  })

  it('保存写 timeColumn 与 window，未识别键整包保留', () => {
    const form = {
      ...emptyForm(),
      kind: 'ai' as const,
      methods: ['today_landed'],
      timeColumn: 'CREATE_DT',
      windowType: 'hours' as const,
      windowHours: '12',
    }
    const conf = confFromForm(form, {
      kind: 'ai',
      customKey: 'keep-me',
      orchestration: { describe: '旧编排' },
    } as MonitorCheckConf)
    expect(conf.timeColumn).toBe('CREATE_DT')
    expect(conf.window).toEqual({ type: 'hours', hours: 12 })
    expect(conf.customKey).toBe('keep-me')
    expect(conf.orchestration).toEqual({ describe: '旧编排' })
  })

  it('timeColumn 为空时不写假列名（删除该键），脚本自报错', () => {
    const form = { ...emptyForm(), kind: 'ai' as const, methods: ['today_landed'], timeColumn: '', windowType: 'today' as const }
    const conf = confFromForm(form, { kind: 'ai', timeColumn: 'CREATE_DT' } as MonitorCheckConf)
    expect('timeColumn' in conf).toBe(false)
    expect(conf.window).toEqual({ type: 'today' })
  })

  it('规则检查分支不覆写基线里的 timeColumn/window', () => {
    const form = { ...emptyForm(), kind: 'rule' as const }
    const conf = confFromForm(form, {
      kind: 'rule',
      timeColumn: 'CREATE_DT',
      window: { type: 'hours', hours: 3 },
    } as MonitorCheckConf)
    expect(conf.timeColumn).toBe('CREATE_DT')
    expect(conf.window).toEqual({ type: 'hours', hours: 3 })
  })
})

describe('formSignature 覆盖新字段（dirty 判定）', () => {
  it('改 timeColumn / 窗口类型 / 小时数都会改变签名', () => {
    const base = emptyForm()
    const signature = formSignature(base)
    expect(formSignature({ ...base, timeColumn: 'CREATE_DT' })).not.toBe(signature)
    expect(formSignature({ ...base, windowType: 'hours' })).not.toBe(signature)
    expect(formSignature({ ...base, windowHours: '12' })).not.toBe(signature)
  })
})
describe('regenerateReasons：换范围也算脚本过期', () => {
  const ai = (over: Partial<ReturnType<typeof emptyForm>> = {}) =>
    ({ ...emptyForm(), kind: 'ai' as const, sourceId: 's1', tableName: 'sense_data.TB_RAW', timeColumn: 'CREATE_DT', ...over })

  it('什么都没改时为空', () => {
    const base = ai()
    expect(regenerateReasons(base, base)).toEqual([])
    expect(needsRegenerate(base, base)).toBe(false)
  })

  it('换表/换时间列/改描述/改方法各自报出可读字段名', () => {
    const base = ai()
    expect(regenerateReasons(ai({ tableName: 'sense_data.TB_NEW' }), base)).toEqual(['检查表'])
    expect(regenerateReasons(ai({ timeColumn: 'UPDATE_DT' }), base)).toEqual(['入库时间字段'])
    expect(regenerateReasons(ai({ desc: '改过的描述' }), base)).toEqual(['描述'])
    expect(regenerateReasons(ai({ methods: ['时效性检查'] }), base)).toEqual(['监控方法'])
  })

  it('多项一起改时按固定顺序拼接，规则检查不参与', () => {
    const base = ai()
    const changed = ai({ tableName: 'sense_data.TB_NEW', desc: '新描述' })
    expect(regenerateReasons(changed, base)).toEqual(['检查表', '描述'])
    expect(regenerateReasons({ ...base, kind: 'rule' }, { ...base, kind: 'rule' })).toEqual([])
  })

  it('保存回执用具体字段名，不说笼统的「描述或方法」', () => {
    const text = buildSaveFeedback({ version: 'v3', script: 'print(1)' }, 'v3', {
      kind: 'ai',
      generated: false,
      needsRegenerate: true,
      regenerateReasons: ['检查表', '入库时间字段'],
    })
    expect(text).toContain('检查表、入库时间字段有改动')
    expect(text).toContain('检查逻辑仍是 v3')
    expect(text).not.toContain('描述或方法')
  })
})

describe('buildSaveFeedback：空执行计划不能假装已生效', () => {
  const aiConf = { version: 'v3', script: 'print(1)' } as MonitorCheckConf
  const emptySchedule = { kind: 'ai' as const, generated: false, needsRegenerate: false, scheduleEmpty: true }

  it('AI 有脚本但没有执行计划：明确「只能手动运行」，不说计划已生效', () => {
    const text = buildSaveFeedback(aiConf, 'v3', emptySchedule)
    expect(text).toContain('已保存并生效 v3')
    expect(text).toContain('未设执行计划：保存后只能手动运行；如需定时，请填写执行计划')
    expect(text).not.toContain('计划/通知/判定策略已生效')
    // 没有计划就谈不上「未自动运行一次检查」之外的计划语义，口径只留手动
    expect(text).not.toContain('未自动运行一次检查')
  })

  it('没有脚本仍按草稿回执，空计划不改变这一段', () => {
    const text = buildSaveFeedback({ version: 'v1' } as MonitorCheckConf, 'v1', emptySchedule)
    expect(text).toContain('已保存草稿')
    expect(text).not.toContain('只能手动运行')
  })

  it('AI 有脚本且有执行计划：保留计划/通知/判定策略已生效的口径', () => {
    const text = buildSaveFeedback(aiConf, 'v3', { kind: 'ai', generated: false, needsRegenerate: false })
    expect(text).toContain('已保存并生效 v3')
    expect(text).toContain('计划/通知/判定策略已生效')
    expect(text).not.toContain('只能手动运行')
  })

  it('空计划 + 需要重新生成：两段都说清楚，不夹带计划已生效', () => {
    const text = buildSaveFeedback(aiConf, 'v3', {
      kind: 'ai',
      generated: false,
      needsRegenerate: true,
      regenerateReasons: ['检查表'],
      scheduleEmpty: true,
    })
    expect(text).toContain('未设执行计划')
    expect(text).toContain('检查表有改动')
    expect(text).toContain('检查逻辑仍是 v3')
    expect(text).not.toContain('计划/通知/判定策略已生效')
  })

  it('规则检查不受 scheduleEmpty 影响，保持原口径', () => {
    const text = buildSaveFeedback({ version: 'v2' } as MonitorCheckConf, '', {
      kind: 'rule',
      generated: false,
      needsRegenerate: false,
      scheduleEmpty: true,
    })
    expect(text).toBe('已保存并生效 v2：保存的内容已发布')
  })
})
