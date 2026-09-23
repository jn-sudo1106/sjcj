import { ref } from 'vue'

/**
 * 「最近打开的网站」（0917-17 的后半条）。
 *
 * 会上那句「在关注列表里可以看到他最近看的那些（网站）」当时分不清指收藏还是最近访问，
 * 拆成两条问过，2026-09-21 用户定：**两个都要**，最近打开挂在排序下拉里。
 *
 * **它解决的是收藏解决不了的那一半**：收藏要事先标记，而"找半天"那次他并没有先收藏过；
 * 最近打开不用标记，去过就在。
 *
 * 与 `siteFavorites` 的区别：
 * - 收藏是**显式的、无上限、无序**（靠置顶 + 过滤用）；
 * - 最近打开是**隐式的、有上限、有序**（最近在前，只留 {@link MAX} 条）。
 *
 * 收藏 2026-09-23 已改存后端（B30）；最近打开仍是本地存、换电脑就没了。
 * 要持久化的话，后端收藏表按 itemType 区分，另起一个类型就能顺带装下。
 */
const KEY = 'rc.site.recent'
/** 留 10 条：再多就不叫"最近"了，下拉里也看不过来 */
const MAX = 10

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string' && !!v).slice(0, MAX)
  } catch {
    return []
  }
}

function write(ids: string[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids))
  } catch {
    /* 隐私模式 / 配额满：存不下就算了，本次会话内仍然生效 */
  }
}

/** 最近打开的网站 ID，**最近的在前**。 */
export const recentSiteIds = ref<string[]>(read())

/**
 * 记一次"打开了这个网站"。
 *
 * 在**所有带 siteId 的进入动作**上调用，包括点源 chip 进具体源——那也是通过这个网站进去的，
 * 不记的话最常见的一种进入方式就丢了，下次照样要找半天。
 */
export function recordSiteVisit(siteId: string): void {
  if (!siteId) return
  const id = String(siteId)
  // 已经在最前面就什么都不做：连着点同一个网站不该反复写 localStorage
  if (recentSiteIds.value[0] === id) return
  const next = [id, ...recentSiteIds.value.filter((x) => x !== id)].slice(0, MAX)
  recentSiteIds.value = next
  write(next)
}

/** 排在第几位（0 = 最近）；不在列表里返回 {@link MAX}，方便直接拿去排序 */
export function recentRankOf(siteId: string): number {
  const i = recentSiteIds.value.indexOf(siteId)
  return i < 0 ? MAX : i
}

// 跨标签页同步：另一个标签页写了，这边跟着读（storage 事件只在其他标签页写入时触发）
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) recentSiteIds.value = read()
  })
}
