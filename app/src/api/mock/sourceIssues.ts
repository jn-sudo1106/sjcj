import { readLoginUsername } from '../auth'
import type { CreateSourceIssuesInput, SourceIssue, SourceIssueQuery } from '../sourceIssues'
import { useAuthStore } from '@/stores/auth'

// 仅用于已标识的前端演示，会话内共享，刷新页面即重置；不代表共享台账已接入。
const pad = (value: number) => String(value).padStart(2, '0')
const serverTime = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
const ago = (days: number) => serverTime(new Date(Date.now() - days * 86400000))

// 演示台账里的源只用于示例展示名称；真实接口由后端按 sourceId 回填 sourceName/siteId/siteName。
const PREVIEW_SOURCES: Record<string, { sourceName: string; siteId?: string; siteName?: string }> = {
  440106716: { sourceName: '海关-8位-出口-美元-商品分组_copy', siteId: '58', siteName: '海关总署' },
  440106715: { sourceName: '阿里法拍详细信息', siteId: '61', siteName: '淘宝' },
  440106714: { sourceName: '导入2610', siteId: '44', siteName: '链家' },
}
const previewSource = (sourceId: string) => PREVIEW_SOURCES[sourceId] ?? { sourceName: `源 ${sourceId}` }

let nextId = 4
const records: SourceIssue[] = [
  { id: 'preview-3', sourceId: '440106716', ...previewSource('440106716'), description: '部分月份的商品数据缺失，请检查月份遍历规则并补采。', state: 0, createdBy: '李明', createTime: ago(0) },
  { id: 'preview-2', sourceId: '440106715', ...previewSource('440106715'), description: '拍卖日期与入库日期不一致，需要检查日期提取配置。', state: 0, createdBy: '张悦', createTime: ago(1) },
  { id: 'preview-1', sourceId: '440106714', ...previewSource('440106714'), description: '详情页请求持续超时。', state: 1, createdBy: '李明', createTime: ago(3), handledBy: '王磊', handleTime: ago(2) },
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
      const date = row.createTime.slice(0, 10)
      return (query.state === undefined || row.state === query.state)
        && (!keyword || `${row.description} ${row.sourceName} ${row.sourceId}`.toLowerCase().includes(keyword))
        && (!query.createTimeStart || date >= query.createTimeStart)
        && (!query.createTimeEnd || date < query.createTimeEnd)
    }).sort((a, b) => b.createTime.localeCompare(a.createTime) || b.id.localeCompare(a.id, undefined, { numeric: true }))
    const start = (query.page - 1) * query.size
    return { list: matched.slice(start, start + query.size).map(copy), total: matched.length }
  },
  async create(input: CreateSourceIssuesInput): Promise<SourceIssue[]> {
    const description = input.description.trim()
    if (!description) throw new Error('请填写问题描述')
    if (description.length > 1000) throw new Error('问题描述不能超过 1000 字')
    const sourceIds = [...new Set(input.sourceIds.map(id => id.trim()))]
    if (!sourceIds.length || sourceIds.some(id => !id)) throw new Error('请先选择有效的源')
    const createTime = serverTime()
    const createdBy = actor()
    const created: SourceIssue[] = sourceIds.map(sourceId => ({
      sourceId, ...previewSource(sourceId), id: `preview-${nextId++}`, description, state: 0, createdBy, createTime,
    }))
    records.unshift(...created)
    return created.map(copy)
  },
  async detail(id: string): Promise<SourceIssue> {
    return copy(find(id))
  },
  async handle(id: string): Promise<SourceIssue> {
    const record = find(id)
    if (record.state !== 1) {
      record.state = 1
      record.handledBy = actor()
      record.handleTime = serverTime()
    }
    return copy(record)
  },
}