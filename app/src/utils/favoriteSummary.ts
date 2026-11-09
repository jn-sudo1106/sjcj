import { computed, ref } from 'vue'
import { favoriteSiteIds, favoriteSitesLoaded, loadFavoriteSites } from './siteFavorites'
import { favoriteSourceIds, favoriteSourcesLoaded, loadFavoriteSources } from './sourceFavorites'
import { favoriteEntryIds, favoriteEntriesLoaded, loadFavoriteEntries } from './entryFavorites'

/**
 * 「我的收藏」汇总（1108-总览页我的收藏入口）。
 *
 * 三份收藏各有一个模块级单例（网站 / 源 / 表），本文件只做**汇总**，不另存一份数据——
 * 否则总览上的数字会和源管理、数据中心的星标对不上。页面里不要再散落 `size + size` 的加法。
 */

export interface FavoriteSummary {
  /** 收藏的网站数（SITE） */
  sites: number
  /** 收藏的源数（SOURCE） */
  sources: number
  /** 收藏的数据表数（ENTRY_TYPE） */
  entries: number
  /** 采集网站 + 源：弹层第 1 行（`/collect?tab=favorite`）的数字 */
  collected: number
  /** 三类合计：胶囊上的数字 */
  total: number
  /** 还没拉过：数字先不显示，避免 0 → 12 跳变 */
  loading: boolean
  /** 三类都没拉到且手上没有旧数据可显示 */
  failed: boolean
  /** 三类都拉过且都为空 */
  empty: boolean
}

/** 最近一次并发拉取里是否有失败（成功会清掉） */
const failedOnce = ref(false)

const allLoaded = computed(
  () => favoriteSitesLoaded.value && favoriteSourcesLoaded.value && favoriteEntriesLoaded.value,
)

export const favoriteSummary = computed<FavoriteSummary>(() => {
  const sites = favoriteSiteIds.value.size
  const sources = favoriteSourceIds.value.size
  const entries = favoriteEntryIds.value.size
  const total = sites + sources + entries
  const loading = !allLoaded.value
  // 失败只在"手上没有可显示的数据"时才露出来：三份单例失败都保留现状，
  // 已经拉到的数字继续显示，别因为一次刷新失败把徽标清空。
  const failed = !loading && failedOnce.value && total === 0
  return {
    sites,
    sources,
    entries,
    collected: sites + sources,
    total,
    loading,
    failed,
    empty: !loading && !failed && total === 0,
  }
})

/** 仅测试用：模块级状态在同一个 jsdom 进程里会跨用例残留，用它把"失败过"的标记清掉 */
export function resetFavoriteSummaryForTest(): void {
  failedOnce.value = false
  inFlight = null
}

let inFlight: Promise<void> | null = null

/**
 * 并发拉三类收藏（三份 loader 自带 in-flight 去重，不会重复打接口）。
 * 进总览页时调一次；不开「弹层展开再请求」——首屏已经拿到数字，展开就该是即时的。
 */
export function loadFavoriteSummary(): Promise<void> {
  if (inFlight) return inFlight
  inFlight = Promise.all([loadFavoriteSites(), loadFavoriteSources(), loadFavoriteEntries()])
    .then((results) => {
      failedOnce.value = results.some((ok) => !ok)
    })
    .catch(() => {
      failedOnce.value = true
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}