import { previewSourceIssues } from './mock/sourceIssues'

/** 字段与后端一致（沿用源管理口径）：状态用 `state: 0/1`，时间用 `yyyy-MM-dd HH:mm:ss`。
 *  接真实接口时只换 `sourceIssueApi` 的实现，页面结构不用动。 */
export type SourceIssueState = 0 | 1
export interface SourceIssueSource {
  sourceId: string
  sourceName: string
  siteId?: string
  siteName?: string
}
export interface SourceIssue extends SourceIssueSource {
  id: string
  description: string
  /** 0 = 待处理，1 = 已处理 */
  state: SourceIssueState
  createdBy: string
  /** 登记时间，`yyyy-MM-dd HH:mm:ss` */
  createTime: string
  handledBy?: string
  /** 处理时间，`yyyy-MM-dd HH:mm:ss`，未处理为空 */
  handleTime?: string
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