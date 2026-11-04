import { ApiError, request } from './client'

export const SOURCE_ISSUE_BATCH_LIMIT = 100

/** 字段与后端一致（沿用源管理口径）：状态用 `state: 0/1`，时间用 `yyyy-MM-dd HH:mm:ss`。 */
export type SourceIssueState = 0 | 1
export interface SourceIssueSource {
  sourceId: string
  sourceName: string
  siteId?: string | null
  siteName?: string | null
}
export interface SourceIssue extends SourceIssueSource {
  id: string
  /** 软删除的源保留问题快照，工作区入口不可用。 */
  sourceAvailable: boolean
  description: string
  /** 0 = 待处理，1 = 已处理 */
  state: SourceIssueState
  createdBy: string
  /** 登记时间，`yyyy-MM-dd HH:mm:ss` */
  createTime: string
  handledBy?: string | null
  /** 处理时间，`yyyy-MM-dd HH:mm:ss`，未处理为空 */
  handleTime?: string | null
}
export interface SourceIssueQuery {
  keyword: string
  /** 0 待处理 / 1 已处理；不传 = 全部（后端「全部时不传 state」） */
  state?: SourceIssueState
  /** 登记时间下界，`yyyy-MM-dd`，含当日 */
  createTimeStart: string
  /** 登记时间上界，`yyyy-MM-dd`，传页面结束日的次日，后端按 `<` 排他 */
  createTimeEnd: string
  page: number
  size: number
}
export interface CreateSourceIssuesInput {
  sourceIds: string[]
  description: string
}

type SourceIssuePage = { list: SourceIssue[]; total: number }

export const sourceIssueApi = {
  async paged({ size, ...query }: SourceIssueQuery): Promise<SourceIssuePage> {
    const page = await request<SourceIssuePage>('source/issue/paged', { ...query, limit: size }, { method: 'GET', mode: 'http' })
    if (!Array.isArray(page?.list) || !Number.isInteger(page.total) || page.total < 0) {
      throw new Error('源问题分页响应格式无效')
    }
    return page
  },

  async create(input: CreateSourceIssuesInput): Promise<SourceIssue[]> {
    try {
      const records = await request<SourceIssue[]>('source/issue/addBatch', { ...input }, { mode: 'http' })
      if (!Array.isArray(records) || !records.length) throw new SyntaxError('登记响应缺少记录')
      return records
    } catch (error) {
      const cause = (error instanceof ApiError ? error.cause : error) as
        { name?: string; status?: number; payload?: { code?: string | number } } | undefined
      if (cause?.name === 'TimeoutError' || cause?.name === 'TypeError' || cause?.name === 'SyntaxError'
        || (cause?.status ?? 0) >= 500 || String(cause?.payload?.code) === '500') {
        throw new Error('未能确认登记结果。请先到源问题台账核对是否已登记，再决定是否提交。')
      }
      throw error
    }
  },

  async detail(id: string): Promise<SourceIssue> {
    const issue = await request<SourceIssue>('source/issue/detail', { id }, { method: 'GET', mode: 'http' })
    if (issue?.id !== id) throw new Error('源问题详情响应格式无效')
    return issue
  },

  async handle(id: string): Promise<SourceIssue> {
    const issue = await request<SourceIssue>('source/issue/handle', { id }, { mode: 'http' })
    if (issue?.id !== id || issue.state !== 1) throw new Error('未能确认处理结果，请刷新台账核对。')
    return issue
  },
}
