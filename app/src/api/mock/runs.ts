import type { RunRow, RunNode } from '../types'

const RUNS: RunRow[] = [
  { runId: 'RUN-20260619-08', flow: '行情快照链路', state: 'L', startedAt: '2026-06-19 08:05:00', owner: 'ops_chen', ruleHits: 0 },
  { runId: 'RUN-20260619-07', flow: '公告规则采集链路_v3', state: 'C', startedAt: '2026-06-19 07:00:00', finishedAt: '2026-06-19 07:03:20', owner: 'dev_zhonghe', ruleHits: 12 },
  { runId: 'RUN-20260619-06', flow: '微博舆情链路', state: 'E', startedAt: '2026-06-19 06:00:00', finishedAt: '2026-06-19 06:02:10', owner: 'data_wang', ruleHits: 3 },
  { runId: 'RUN-20260619-05', flow: '基金评论清洗链路', state: 'C', startedAt: '2026-06-19 06:40:00', finishedAt: '2026-06-19 06:41:50', owner: 'dev_liang', ruleHits: 8 },
  { runId: 'RUN-20260618-21', flow: '公告规则采集链路_v3', state: 'C', startedAt: '2026-06-18 07:00:00', finishedAt: '2026-06-18 07:03:01', owner: 'dev_zhonghe', ruleHits: 10 },
]

const NODES: Record<string, RunNode[]> = {
  'RUN-20260619-07': [
    { nodeId: 'n1', name: '公告列表抓取', state: 'C', input: 'seed_url', output: 'TB_STOCK_NOTICE', failAction: '-', extTaskId: 'TK-99021', extTraceId: '-' },
    { nodeId: 'n2', name: '公告详情抓取', state: 'C', input: 'detail_url', output: 'TB_STOCK_NOTICE', failAction: '-', extTaskId: 'TK-99022', extTraceId: '-' },
    { nodeId: 'n3', name: 'AI 抽取', state: 'C', input: 'content', output: 'extract_json', failAction: '-', extTaskId: '-', extTraceId: 'TRACE-5521' },
    { nodeId: 'n4', name: '规则处理', state: 'C', input: 'extract_json', output: 'tagged', failAction: '-', extTaskId: '-', extTraceId: 'TRACE-5522' },
    { nodeId: 'n5', name: '落表', state: 'C', input: 'tagged', output: 'TB_STOCK_NOTICE', failAction: '-', extTaskId: '-', extTraceId: '-' },
  ],
  'RUN-20260619-06': [
    { nodeId: 'n1', name: '微博列表抓取', state: 'C', input: 'seed_url', output: 'TB_WEIBO_FEED', failAction: '-', extTaskId: 'TK-90011', extTraceId: '-' },
    { nodeId: 'n2', name: '微博详情抓取', state: 'E', input: 'detail_url', output: '-', failAction: '重试3次后告警', extTaskId: 'TK-90012', extTraceId: '-' },
    { nodeId: 'n3', name: '规则处理', state: 'L', input: 'feed', output: '-', failAction: '-', extTaskId: '-', extTraceId: 'TRACE-6001' },
  ],
}

export function mockRuns(): RunRow[] {
  return RUNS
}
export function mockRunNodes(params?: Record<string, unknown>): RunNode[] {
  return NODES[String(params?.runId ?? '')] ?? []
}
export function mockRunStats(): { completed: number; failed: number; running: number; ruleHits: number } {
  return {
    completed: RUNS.filter((r) => r.state === 'C').length,
    failed: RUNS.filter((r) => r.state === 'E').length,
    running: RUNS.filter((r) => r.state === 'L').length,
    ruleHits: RUNS.reduce((s, r) => s + (r.ruleHits ?? 0), 0),
  }
}
