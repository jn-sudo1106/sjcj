import { readLoginUsername } from '../auth'
import type { CreateSourceIssuesInput, SourceIssue, SourceIssueQuery } from '../sourceIssues'
import { localDate } from '@/utils/format/localDateTime'
import { useAuthStore } from '@/stores/auth'

// 仅用于已标识的前端演示，会话内共享，刷新页面即重置；不代表共享台账已接入。
const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString()
let nextId = 4
const records: SourceIssue[] = [
  { id: 'preview-3', sourceId: '440106716', name: '海关-8位-出口-美元-商品分组_copy', siteId: '58', siteName: '海关总署', description: '部分月份的商品数据缺失，请检查月份遍历规则并补采。', status: 'open', createdBy: '李明', createdAt: ago(0) },
  { id: 'preview-2', sourceId: '440106715', name: '阿里法拍详细信息', siteId: '61', siteName: '淘宝', description: '拍卖日期与入库日期不一致，需要检查日期提取配置。', status: 'open', createdBy: '张悦', createdAt: ago(1) },
  { id: 'preview-1', sourceId: '440106714', name: '导入2610', siteId: '44', siteName: '链家', description: '详情页请求持续超时。', status: 'handled', createdBy: '李明', createdAt: ago(3), handledBy: '王磊', handledAt: ago(2) },
]
const actor = () => readLoginUsername() || useAuthStore().name || '当前账号'
const copy = (record: SourceIssue): SourceIssue => ({ ...record })

function find(id: string): SourceIssue {
  const record = records.find(row => row.id === id)
  if (!record) throw new Error('问题记录不存在，请刷新列表')
  return record
}

export const previewSourceIssues = {
  async paged(query: SourceIssueQuery): Promise<{ list: SourceIssue[]; total: number }> {
    const keyword = query.keyword.trim().toLowerCase()
    const matched = records.filter(row => {
      const date = localDate(new Date(row.createdAt))
      return (query.status === 'all' || row.status === query.status)
        && (!keyword || `${row.description} ${row.name} ${row.sourceId}`.toLowerCase().includes(keyword))
        && (!query.startDate || date >= query.startDate)
        && (!query.endDate || date <= query.endDate)
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id, undefined, { numeric: true }))
    const start = (query.page - 1) * query.size
    return { list: matched.slice(start, start + query.size).map(copy), total: matched.length }
  },
  async create(input: CreateSourceIssuesInput): Promise<SourceIssue[]> {
    const description = input.description.trim()
    if (!description) throw new Error('请填写问题描述')
    if (description.length > 1000) throw new Error('问题描述不能超过 1000 字')
    const sources = [...new Map(input.sources.map(source => [source.sourceId, source])).values()]
    if (!sources.length || sources.some(source => !source.sourceId)) throw new Error('请先选择有效的源')
    const createdAt = new Date().toISOString()
    const createdBy = actor()
    const created: SourceIssue[] = sources.map(source => ({
      ...source, id: `preview-${nextId++}`, description, status: 'open', createdBy, createdAt,
    }))
    records.unshift(...created)
    return created.map(copy)
  },
  async detail(id: string): Promise<SourceIssue> {
    return copy(find(id))
  },
  async handle(id: string): Promise<SourceIssue> {
    const record = find(id)
    if (record.status !== 'handled') {
      record.status = 'handled'
      record.handledBy = actor()
      record.handledAt = new Date().toISOString()
    }
    return copy(record)
  },
}
