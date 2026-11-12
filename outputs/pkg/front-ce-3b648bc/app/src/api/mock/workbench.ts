import type { WorkbenchSummary } from '../types'

// 工作台摘要 — 首页 4 类摘要：最近流程 / 待发布草稿 / 失败运行 / 监控告警。
export function mockWorkbenchSummary(): WorkbenchSummary[] {
  return [
    { label: '最近流程', title: '公告规则采集链路_v3', hint: '更新于 2026-06-17 14:32', tone: 'file' },
    { label: '待发布草稿', value: '2', hint: '个流程', tone: 'draft' },
    { label: '失败运行', value: '1', hint: '次（近 24h）', tone: 'error' },
    { label: '监控告警', value: '2', hint: '条告警', tone: 'warn' },
  ]
}
