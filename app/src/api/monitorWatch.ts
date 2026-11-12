import { requestRunnerManagement } from './runnerManagement'

export type MonitorWatchQueueStatus =
  | 'ok'
  | 'missing'
  | 'backlog'
  | 'insufficient'
  | 'slow_consumer'
  | 'too_fast'
  | 'no_consumer'

export interface MonitorWatchQueueItem {
  name: string
  status: MonitorWatchQueueStatus
  reason: string
  messages: number
  unacked: number
  consumers: number
  consumeRate: number
}

export interface MonitorWatchOverdueItem {
  monitorId: string
  sourceId: string
  name: string
  cron: string
  due: string
  lastRun?: string | null
  lastLog?: string | null
}

export interface MonitorWatchSnapshot {
  at: string
  graceMinutes: number
  queue: {
    reachable: boolean
    error: string | null
    items: MonitorWatchQueueItem[]
    summary: { total: number; problems: number }
  }
  monitors: {
    available: boolean
    error?: string
    graceMinutes: number
    count: number
    items: MonitorWatchOverdueItem[]
  }
  summary: {
    queueProblems: number
    queueUnobservable: number
    overdueMonitors: number
    healthy: boolean
  }
}

export interface MonitorWatchStatus {
  latest: MonitorWatchSnapshot | null
  configured: { mq: boolean; db: boolean; notify: boolean }
}

export const monitorWatchApi = {
  status: () => requestRunnerManagement<MonitorWatchStatus>('/monitor-watch'),
  scan: () => requestRunnerManagement<MonitorWatchSnapshot>('/monitor-watch/scan', 'POST', {}),
}