// 智能问数域 mock。SSE 主链路（poc/chat/agent）不走 request mock 管线：
// streamAgentChat 是 fetch 直连，这里的 handler 只登记契约并显式拒绝误用，
// 避免 mock 模式编造一条「假成功」回答（页面看着成功、库里什么都没动）。
import type { BackendChatLog, BackendChatSession } from '../aiChat'

const SESSIONS: BackendChatSession[] = [
  {
    id: 9001,
    uuid: 'sess_mock_9001',
    name: '各站点采集成功率',
    userId: 1,
    createTime: '2026-11-16 09:20:00',
    updateTime: '2026-11-16 09:25:00',
    delFlag: '0',
  },
  {
    id: 9002,
    uuid: 'sess_mock_9002',
    name: '两融余额趋势',
    userId: 1,
    createTime: '2026-11-15 14:00:00',
    updateTime: '2026-11-15 14:10:00',
    delFlag: '0',
  },
]

const LOGS: BackendChatLog[] = [
  {
    id: 8001,
    sessionId: 9001,
    userId: 1,
    msg: '统计最近 7 天各站点采集成功率',
    modelMsg:
      '最近 7 天各站点采集成功率如下（示例数据）：\n\n| 站点 | 成功率 |\n| --- | --- |\n| 贝壳 | 98.2% |\n| 安居客 | 95.7% |',
    result: 'SUCCESS',
    status: 'SUCCESS',
    data: JSON.stringify({
      thinking: { completed: true, durationMs: 4200, text: '检索候选表\n生成 SQL\n执行查询' },
    }),
    createTime: '2026-11-16 09:21:00',
    updateTime: '2026-11-16 09:21:04',
  },
  {
    id: 8002,
    sessionId: 9001,
    userId: 1,
    msg: '只看成功率低于 96% 的站点',
    modelMsg: '成功率低于 96% 的站点：安居客 95.7%（示例数据）。',
    result: 'SUCCESS',
    status: 'SUCCESS',
    createTime: '2026-11-16 09:25:00',
    updateTime: '2026-11-16 09:25:03',
  },
]

export function mockAiChatAgent(): never {
  throw new Error(
    '[mock] poc/chat/agent 是 SSE 流式端点，不走 request mock 管线；请用 streamAgentChat（fetch 直连）',
  )
}

export function mockAiChatHelpQuestion(): string[] {
  return [
    '统计最近 7 天各站点采集成功率',
    '查询两融余额最近的变动趋势',
    '按机构汇总本月抓取失败条数',
    '列出规则清洗异常最多的前 5 张表',
  ]
}

export function mockAiSessionList(params?: Record<string, unknown>): BackendChatSession[] {
  const userId = params?.userId
  return SESSIONS.filter(
    (s) => s.delFlag !== '1' && (userId == null || String(s.userId) === String(userId)),
  ).map((s) => ({ ...s }))
}

export function mockAiSessionStop(params?: Record<string, unknown>) {
  const row = SESSIONS.find((s) => String(s.id) === String(params?.id))
  if (row) row.delFlag = '1'
  return { ok: true, message: '会话已删除（演示）' }
}

export function mockAiSessionName(params?: Record<string, unknown>) {
  const row = SESSIONS.find((s) => String(s.id) === String(params?.id))
  if (!row) return { ok: false, message: '会话不存在' }
  const name = String(params?.name ?? '').trim()
  if (!name) return { ok: false, message: '会话名称不能为空' }
  row.name = name
  return { ok: true, message: '已重命名（演示）' }
}

export function mockAiChatLogHistory(params?: Record<string, unknown>) {
  const sessionId = String(params?.sessionId ?? '')
  const pageNo = Math.max(1, Number(params?.pageNo ?? 1) || 1)
  const pageSize = Math.max(1, Number(params?.pageSize ?? 100) || 100)
  const rows = LOGS.filter((l) => String(l.sessionId) === sessionId).sort(
    (a, b) => Number(a.id) - Number(b.id),
  )
  const start = (pageNo - 1) * pageSize
  return { data: rows.slice(start, start + pageSize), count: rows.length }
}