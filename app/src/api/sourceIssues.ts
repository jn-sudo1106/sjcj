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

/** 四项能力 + 演示态标记。接真实接口时只换 sourceIssueApi 的实现，页面结构不用动。 */
export interface SourceIssueApi {
  paged(query: SourceIssueQuery): Promise<{ list: SourceIssue[]; total: number }>
  create(input: CreateSourceIssuesInput): Promise<SourceIssue[]>
  detail(id: string): Promise<SourceIssue>
  handle(id: string): Promise<SourceIssue>
  /** true = 内存演示台账。接真实接口时改成 false，并一并删掉这些演示提示：
   *  SourceIssuesView.vue 顶部的 si-preview 提示条和「已标记为已处理（前端演示）」，
   *  SourceIssueDrawer.vue 的处理成功提示，RegisterSourceIssuesDialog.vue 的成功提示与底部说明。 */
  preview: boolean
}

// 用户确认先做前端。尚无后端契约，不猜测 HTTP 端点、不把演示记录写进源标签或浏览器缓存。
export const sourceIssueApi: SourceIssueApi = { ...previewSourceIssues, preview: true }
