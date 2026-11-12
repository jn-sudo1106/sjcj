import { requestRunnerManagement } from './runnerManagement'

export interface MonitorBatchOptions { window: 'today' | 'hours'; hours: number; schedule: string }
export interface MonitorBatchItem {
  sourceId: string; name: string; tableId: string; tableName?: string
  status: string; message?: string; checkedCount?: number; monitorId?: string
  logId?: string; at?: string; exec?: string; data?: string
}
export interface MonitorBatch {
  batchId: string; status: string; action: string; createdAt: string; message: string
  total: number; prepared: number; counts: Record<string, number>; options: MonitorBatchOptions; items: MonitorBatchItem[]
  delivery?: {
    configured: boolean; enabled: boolean; recipient: string; lastPollAt?: string; error: string
    receipts: { status: string; subject: string; messageId: string; recipient: string; message: string; createdAt: string; acceptedAt?: string }[]
  }
}
export const monitorBatchesApi = {
  list: () => requestRunnerManagement<MonitorBatch[]>('/monitor-batches'),
  create: (body: { scope: { sourceIds: string[]; siteId?: string; name?: string }; allSources: boolean; options: MonitorBatchOptions }) =>
    requestRunnerManagement<{ batchId: string }>('/monitor-batches', 'POST', body),
  get: (id: string, page = 1) => requestRunnerManagement<MonitorBatch>(`/monitor-batches/${encodeURIComponent(id)}?page=${page}`),
  action: (id: string, action: 'apply' | 'resume' | 'pause' | 'retry' | 'verify' | 'retry_delivery') =>
    requestRunnerManagement(`/monitor-batches/${encodeURIComponent(id)}`, 'POST', { action }),
  delivery: (id: string, recipient: string, enabled: boolean) =>
    requestRunnerManagement(`/monitor-batches/${encodeURIComponent(id)}`, 'POST', { action: 'delivery', recipient, enabled }),
}
