// 定时策略 → cron 表达式：节点配置 Tab「定时策略」那一块的唯一口径（2026-09-16 从
// TaskScheduleSettings.vue / ConfigTab.vue 抽出）。
//
// 为什么要抽：保存编排配置时要按「节点配置 Tab 里显示的那个 cron」落 ck_source.SCHEDULE，
// 而那个值不是简单读 `node.schedule.cron`——非「自定义 cron」的策略，显示值是**推导**出来的，
// 存着 cron 可能为空（典型场景：从源继承的定时设置、或用户只改过时间没落过 cron，
// 见 TaskScheduleSettings 里那段 immediate watch 的说明）。显示与落库必须是同一份推导，
// 否则就会出现「界面显示 0 0 8 * * ?、落库是空串」这类不一致。
import type { CollectorSchedule, NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'

function normalizeTime(time?: string): [number, number] {
  const [hour, minute] = String(time || '').split(':').map((item) => Number(item))
  return [
    Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 0,
    Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 0,
  ]
}

/**
 * 按定时策略推导 Quartz cron。与 TaskScheduleSettings 的显示完全同口径：
 * 策略缺省当「每天」、时间缺省当 0:0，所以「什么都没配」时会算出 `0 0 0 * * ?`。
 * 这个兜底值就是界面上那个 cron 框在空配置下的显示值——要落库请用 scheduleCronOf，
 * 它按「界面显示什么就返回什么」处理空配置与老数据两种情况。
 */
export function cronForSchedule(settings?: CollectorSchedule | null): string {
  const type = settings?.scheduleType || '每天'
  if (type === '自定义 cron') return settings?.cron ?? ''
  const [hour, minute] = normalizeTime(settings?.scheduleTime)
  if (type === '每5分钟一次') return '0 */5 * * * ?'
  if (type === '每小时') return `0 ${minute} * * * ?`
  if (type === '每周') {
    const weekdays = settings?.weekdays?.length ? settings.weekdays : [1]
    return `0 ${minute} ${hour} ? * ${weekdays.join(',')}`
  }
  if (type === '交易日定时') return `0 ${minute} ${hour} ? * 1-5` // 1-5 = 周一到周五（Quartz 的日-周字段）
  return `0 ${minute} ${hour} * * ?`
}

/**
 * 节点配置 Tab 上那个「cron 表达式」输入框里的值——也就是保存时该落库的 schedule。
 * 与 TaskScheduleSettings 的显示对齐——那个框显示什么，保存就落什么：
 * - 选了「自定义 cron」：用户手填的存值（此时输入框可编辑）；
 * - 选了其它策略：按策略推导（此时输入框只读，显示的本来就是推导值）；
 * - **一点定时都没配：`0 0 0 * * ?`（每天 0:0）**，也就是界面那个框在「策略=每天、时间缺省」
 *   下的兜底显示值。2026-09-16 起不再返回空串：调度侧要求 SCHEDULE 非空，空串等于这条监控
 *   不会被排期，而界面上明摆着显示了一个 cron——界面上看到的就该落库。
 *
 * 唯一的例外：没选过策略、只有老数据带下来的 cron（`{cron: '0 0 12 * * *'}`）时用存值，
 * 因为这时推导无从谈起，用「每天 0:0」覆盖掉一个真实存在的日程是净损失。
 */
export function scheduleCronOf(settings?: CollectorSchedule | null): string {
  const stored = (settings?.cron ?? '').trim()
  const type = (settings?.scheduleType ?? '').trim()
  // 自定义 cron：手填的就是唯一真值
  if (type === '自定义 cron') return stored
  // 没选策略：有存值（老数据只留了 cron）就用存值，什么都没有才用界面那个兜底显示值
  if (!type) return stored || cronForSchedule(settings ?? {}).trim()
  // 选了策略：以推导值为准（推导不出才退回存值）
  return cronForSchedule(settings).trim() || stored
}

/**
 * 节点配置 Tab 的定时设置是从三层逐字段取第一个有值的：节点自身 → 节点 collectCfg（采集类）
 * → 源。节点上没配过的字段会显示源的定时，所以保存时也不能只看 `node.schedule`。
 */
export function mergeScheduleSettings(
  node?: NodeConfig | null,
  source?: CollectorSchedule | null,
): CollectorSchedule {
  const own = node?.schedule
  const cc = node?.collectCfg
  return {
    scheduleType: own?.scheduleType ?? cc?.scheduleType ?? source?.scheduleType,
    scheduleTime: own?.scheduleTime ?? cc?.scheduleTime ?? source?.scheduleTime,
    weekdays: own?.weekdays ?? cc?.weekdays ?? source?.weekdays,
    cron: own?.cron ?? cc?.cron ?? source?.cron,
  }
}

/** 节点配置 Tab 当前显示的 cron（= 保存时要落库的 schedule）：三层合并 + 推导口径。 */
export function nodeScheduleCron(
  node?: NodeConfig | null,
  source?: CollectorSchedule | null,
): string {
  return scheduleCronOf(mergeScheduleSettings(node, source))
}
