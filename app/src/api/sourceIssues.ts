import { previewSourceIssues } from './mock/sourceIssues'

/** 前端展示模型；接口契约确认后，仅在本文件替换演示实现。 */
export type SourceIssueStatus = 'open' | 'handled'
export interface SourceIssueSource {
  sourceId: string
  name: string
  siteId?: string
  siteName?: string
}
export interface SourceIssue extends SourceIssueSource {
  id: string
  description: string
  status: SourceIssueStatus
  createdBy: string
  createdAt: string
  handledBy?: string
  handledAt?: string
}
export interface SourceIssueQuery {
  keyword: string
  status: SourceIssueStatus | 'all'
  startDate: string
  endDate: string
  page: number
  size: number
}
export interface CreateSourceIssuesInput {
  sources: SourceIssueSource[]
  description: string
}

// 用户确认先做前端。尚无后端契约，不猜测 HTTP 端点、不把演示记录写进源标签或浏览器缓存。
export const sourceIssueApi = { ...previewSourceIssues, preview: true as const }
