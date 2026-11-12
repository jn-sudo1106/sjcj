// 单次运行详情的数据整形：冻结快照只读、缺失「未记录」、旧日志降级、通知无回执「未取得回执」。
import { describe, expect, it } from 'vitest'
import type { MonitorRunView } from '@/api/types/monitorCenter'
import {
  DELIVERY_NOTE,
  LEGACY_NOTE,
  MISSING_TEXT,
  NO_RECEIPT_TEXT,
  checkRows,
  checksEmptyText,
  countTextOf,
  deliveryEmptyText,
  deliveryRows,
  logRefOf,
  logSourceText,
  logTextOf,
  snapshotFields,
  snapshotMethodLabels,
  snapshotScript,
  summaryFields,
  triggerTextOf,
  windowFields,
} from './runDetail'

function run(over: Partial<MonitorRunView> = {}): MonitorRunView {
  return {
    id: 'l1',
    sourceId: 's1',
    monitorName: '日增量监控',
    at: '2026-09-09 11:00:46',
    trigger: 'legacy',
    exec: 'succeeded',
    data: 'normal',
    notify: 'unknown',
    count: '1240',
    deliveries: [],
    legacy: true,
    ...over,
  }
}

describe('summaryFields · 结论与实际数值', () => {
  it('异常条数未知 → 「未记录」；检查条数未知 → 「—」；0 不省略', () => {
    const fields = summaryFields(run({ count: '', abnormalCount: undefined }))
    const byLabel = Object.fromEntries(fields.map((field) => [field.label, field]))
    expect(byLabel['检查条数'].value).toBe('—')
    expect(byLabel['检查条数'].missing).toBe(true)
    expect(byLabel['异常条数'].value).toBe('—')
    expect(byLabel['异常条数'].missing).toBe(true)
    expect(byLabel['触发方式'].value).toBe('旧日志')

    const zero = Object.fromEntries(
      summaryFields(run({ count: '0', abnormalCount: 0 })).map((field) => [field.label, field]),
    )
    expect(zero['检查条数'].value).toBe('0')
    expect(zero['异常条数'].value).toBe('0')
    expect(zero['检查条数'].missing).toBeFalsy()
  })

  it('执行消息存在才占一整行', () => {
    const withMessage = summaryFields(run({ message: '执行失败：连接超时' }))
    expect(withMessage.some((field) => field.label === '执行消息' && field.wide)).toBe(true)
    expect(summaryFields(run()).some((field) => field.label === '执行消息')).toBe(false)
  })

  it('countTextOf：undefined → 「—」，0 → 「0」', () => {
    expect(countTextOf(undefined)).toBe('—')
    expect(countTextOf(0)).toBe('0')
    expect(countTextOf(12)).toBe('12')
  })
})

describe('windowFields · 数据范围（窗口 + 时区）', () => {
  it('窗口和时区缺失都写「未记录」，不拿浏览器时区补', () => {
    const fields = windowFields(run())
    expect(fields.map((field) => field.value)).toEqual([MISSING_TEXT, MISSING_TEXT])
    expect(fields.every((field) => field.missing)).toBe(true)
  })

  it('C06 的时区字段按原样展示', () => {
    const fields = windowFields(
      run({ window: { start: '2026-11-11 00:00:00', end: '2026-11-11 23:59:59', timezone: 'Asia/Shanghai' } }),
    )
    expect(fields[0].value).toBe('2026-11-11 00:00:00 ~ 2026-11-11 23:59:59')
    expect(fields[1].value).toBe('Asia/Shanghai')
  })
})

describe('snapshotFields · 冻结配置快照', () => {
  it('没有快照就是空数组（页面显示「未记录」），不伪造', () => {
    expect(snapshotFields(undefined)).toEqual([])
    expect(snapshotScript(undefined)).toBe('')
    expect(snapshotMethodLabels(undefined)).toEqual([])
  })

  it('有快照时缺失字段逐个「未记录」，方法/策略翻成可读文案', () => {
    const fields = Object.fromEntries(
      snapshotFields({
        version: 'v3',
        name: '日增量监控',
        methods: ['required_null', 'daily_count'],
        plan: { text: '每天 06:00' },
        notifyOn: 'error',
        channels: ['wecom', 'email'],
        nullPolicy: 'abnormal',
        noDataPolicy: 'no_data',
      }).map((field) => [field.label, field]),
    )
    expect(fields['版本'].value).toBe('v3')
    expect(fields['快照摘要'].value).toBe(MISSING_TEXT)
    expect(fields['快照摘要'].missing).toBe(true)
    expect(fields['检查方法'].value).toContain('必填字段非空')
    expect(fields['检查方法'].value).toContain('每日数据量')
    expect(fields['执行计划'].value).toBe('每天 06:00')
    expect(fields['通知策略'].value).toBe('仅异常时')
    expect(fields['通知渠道'].value).toBe('wecom、email')
    expect(fields['空值策略'].value).toBe('空值判为异常')
    expect(fields['无数据策略'].value).toBe('无待检记录')
  })

  it('不认识的策略值原样保留，不吞掉', () => {
    const fields = snapshotFields({ notifyOn: 'future-policy' })
    expect(fields.find((field) => field.label === '通知策略')?.value).toBe('future-policy')
  })

  it('脚本去掉首尾空白；方法名走 methodLabel', () => {
    expect(snapshotScript({ script: '  const a = 1\n' })).toBe('const a = 1')
    expect(snapshotMethodLabels({ methods: ['value_range', 'required_null'] })).toEqual(['通用数值范围', '必填字段非空'])
  })
})

describe('checkRows / checksEmptyText · 逐方法逐表', () => {
  it('没有 checks 时按旧日志 / 结构化分别说明，都写「未记录逐项结果」', () => {
    expect(checksEmptyText(run({ legacy: true }))).toContain('未记录逐项结果')
    expect(checksEmptyText(run({ legacy: true }))).toContain('旧日志')
    expect(checksEmptyText(run({ legacy: false }))).toContain('未记录逐项结果')
    expect(checkRows(run())).toEqual([])
  })

  it('有 checks 时逐项给出方法/表/字段/结论与条数；缺方法名时用 code 兜底', () => {
    const rows = checkRows(
      run({
        legacy: false,
        checks: [
          {
            checkKey: 'c1',
            methodCode: 'required_null',
            exec: 'failed',
            data: 'abnormal',
            tableName: 'sense_data.tb_jjjk',
            field: 'title',
            checkedCount: 100,
            abnormalCount: 3,
            samples: [{ recordId: 'r1', actual: '', reasonCode: 'NULL_TITLE' }],
          },
          {
            checkKey: 'c2',
            methodLabel: '自定义方法',
            exec: 'succeeded',
            data: 'normal',
            checkedCount: 0,
          },
        ],
      }),
    )
    expect(rows[0].method).toBe('必填字段非空')
    expect(rows[0].table).toBe('sense_data.tb_jjjk')
    expect(rows[0].exec).toBe('执行失败')
    expect(rows[0].execTone).toBe('err')
    expect(rows[0].dataTone).toBe('err')
    expect(rows[0].checked).toBe('100')
    expect(rows[0].abnormal).toBe('3')
    expect(rows[0].samples).toContain('r1')
    expect(rows[0].samples).toContain('NULL_TITLE')
    expect(rows[1].method).toBe('自定义方法')
    expect(rows[1].table).toBe('—')
    expect(rows[1].checked).toBe('0')
    expect(rows[1].abnormal).toBe('—')
    expect(rows[1].samples).toBe('—')
  })
})

describe('deliveries · 通知投递', () => {
  it('没有投递记录时：未配置通知 ≠ 未取得回执，但都不能写「已送达」', () => {
    expect(deliveryEmptyText(run({ notify: 'unknown' }))).toBe(NO_RECEIPT_TEXT)
    expect(deliveryEmptyText(run({ notify: 'none' }))).toBe('未配置通知')
    expect(deliveryEmptyText(run({ notify: 'delivered' }))).toBe(NO_RECEIPT_TEXT)
    expect(deliveryEmptyText(run({ deliveries: [{ channel: 'wecom', attempt: 1, status: 'accepted' }] }))).toBe('')
  })

  it('逐渠道 attempt 映射；accepted 显示「已受理 · 未确认送达」', () => {
    const rows = deliveryRows([
      { channel: 'wecom', target: '运维群', attempt: 2, status: 'accepted', at: '2026-11-11 10:00:00', message: 'ok' },
      { channel: 'email', attempt: 0, status: 'failed' },
    ])
    expect(rows[0].attempt).toBe('第 2 次')
    expect(rows[0].status).toBe('已受理 · 未确认送达')
    expect(rows[0].tone).toBe('warn')
    expect(rows[0].target).toBe('运维群')
    expect(rows[1].attempt).toBe(MISSING_TEXT)
    expect(rows[1].status).toBe('投递失败')
    expect(rows[1].tone).toBe('err')
    expect(rows[1].message).toBe('—')
  })

  it('投递说明明确写出受理 ≠ 送达', () => {
    expect(DELIVERY_NOTE).toContain('不等于送达')
  })
})

describe('日志 · 结构化正文与旧日志文本不混用', () => {
  it('logText 优先；旧日志回退 raw.logMsg；来源标注不同', () => {
    const structured = run({ legacy: false, logText: '结构化正文', raw: { ...baseRaw(), logMsg: '旧文本' } })
    expect(logTextOf(structured)).toBe('结构化正文')
    expect(logSourceText(structured)).toContain('结构化')

    const legacy = run({ raw: baseRaw() })
    expect(logTextOf(legacy)).toBe('2026-09-09 11:00:46---正常, 数量:1240')
    expect(logSourceText(legacy)).toContain('旧日志')
  })

  it('正文缺失返回空串（页面显示「未取得日志内容」），logRef 原样给出入口', () => {
    expect(logTextOf(run())).toBe('')
    expect(logSourceText(run())).toBe('')
    expect(logRefOf(run({ logRef: '  run/2026-11-11/abc.log  ' }))).toBe('run/2026-11-11/abc.log')
    expect(logRefOf(run())).toBe('')
  })
})

describe('常量的降级口径', () => {
  it('旧日志标注、未记录、未取得回执文案固定，页面不另写', () => {
    expect(LEGACY_NOTE).toBe('旧日志，未取得结构化结论')
    expect(MISSING_TEXT).toBe('未记录')
    expect(NO_RECEIPT_TEXT).toBe('未取得回执')
    expect(triggerTextOf('legacy')).toBe('旧日志')
  })
})

function baseRaw() {
  return {
    logId: 'l1',
    createDt: '2026-09-09 11:00:46',
    logMsg: '2026-09-09 11:00:46---正常, 数量:1240',
    name: '日增量监控',
    state: 'C',
    logType: '1',
    tableName: 'sense_data.tb_jjjk',
    sourceId: 's1',
  }
}