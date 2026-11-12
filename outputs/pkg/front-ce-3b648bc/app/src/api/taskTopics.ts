import { request } from './client'

/**
 * 全部队列名（后端 GET /v1/task/taskTopicList，按条件返回所有流程节点的队列）。
 * 返回形状后端没给样例，这里兼容：字符串数组 / 对象数组（取 taskTopic、topic、queue、name 之一）
 * 以及 {data|list: [...]} 的包装。
 */
function topicsOf(res: unknown): string[] {
  const holder = res as { data?: unknown; list?: unknown } | null
  const items = Array.isArray(res) ? res
    : Array.isArray(holder?.data) ? holder.data
    : Array.isArray(holder?.list) ? holder.list
    : []
  const topics = items.map((item: unknown) => {
    if (typeof item === 'string') return item
    const row = item as Record<string, unknown> | null
    const value = row?.taskTopic ?? row?.topic ?? row?.queue ?? row?.name
    return typeof value === 'string' ? value : ''
  })
  return [...new Set(topics.map((t) => t.trim()).filter(Boolean))]
}

export interface TaskTopicQuery {
  startTime?: string
  endTime?: string
  sourceId?: string
  siteId?: string
}

/**
 * 同 topTaskPaged：一个过滤条件都没有时后端直接回空（防全表扫描），所以调用方至少带时间范围或源 / 网站。
 * 这里只传范围类条件，不传状态 / 队列——候选要列全，不能随队列、状态的选择收缩。
 */
export async function taskTopicList(query: TaskTopicQuery, signal?: AbortSignal): Promise<string[]> {
  const params = Object.fromEntries(Object.entries(query).filter(([, v]) => v))
  return topicsOf(await request<unknown>('task/taskTopicList', params, { method: 'GET', signal }))
}
