import type { HealthCard, MqQueue, SyncRow, AlarmRow } from '../types'

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
