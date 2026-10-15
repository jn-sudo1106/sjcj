/**
 * 来源组成员缓存（2026-10-13「我的视图」目录版）：目录绑定的是来源组，成员在查询时现拉（组里新加的源自动带进视图）。
 * `source-group/members` 没有 total，按页拉到没有下一页为止；同一个组在一次读目录的过程里只拉一次；「我的视图」每次读目录前清空（组成员可能在「我的分组」里改过）。
 */
import { sourceGroupApi } from '@/api'
import type { GroupMembers } from './viewDirs'

/** 后端 limit 最大 500（501 报「分页参数不合法」，10-13 dev 实测），members 会多要 1 条判下一页，所以每页 499 */
const PAGE = 499
/** 单个来源组最多拉这么多成员，防异常接口死循环（目前最大的组 255 个） */
const MAX_MEMBERS = 20000
const cache = new Map<string, Promise<string[]>>()

async function fetchAll(groupId: string): Promise<string[]> {
  const ids: string[] = []
  for (let offset = 0; offset < MAX_MEMBERS; offset += PAGE) {
    const { rows, hasMore } = await sourceGroupApi.members(groupId, offset, PAGE)
    ids.push(...rows.map((r) => r.sourceId).filter(Boolean))
    if (!hasMore) break
  }
  return ids
}

/** 拉这些来源组的成员（已缓存的直接用）；某个组拉失败就整体抛出，调用方提示，不悄悄当成空组 */
export async function loadGroupMembers(groupIds: string[]): Promise<GroupMembers> {
  const out: GroupMembers = {}
  await Promise.all(groupIds.map(async (id) => {
    let p = cache.get(id)
    if (!p) {
      p = fetchAll(id)
      cache.set(id, p)
      p.catch(() => cache.delete(id))
    }
    out[id] = await p
  }))
  return out
}

export function clearGroupMembersCache() {
  cache.clear()
}
