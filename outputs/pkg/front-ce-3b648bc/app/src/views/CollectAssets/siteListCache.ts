import type { Site, SourceCategory } from '@/api'

export interface CollectAssetsCache {
  sites: Site[] | null
  categories: SourceCategory[] | null
  tags: string[] | null
  stats: { total: number; error: number; notify: number; siteTotal?: number } | null
}

export const collectAssetsCache: CollectAssetsCache = {
  sites: null,
  categories: null,
  tags: null,
  stats: null,
}

/**
 * 网站列表缓存的写入序号（2026-09-23）。
 *
 * 缓存是模块级的，「网站列表」和「我收藏的网站」两个 tab 各有一个 SourceTab 实例在写它；
 * 组件里的 listRequestSeq 只能挡住**本实例**的过期请求。这里再加一道全局的：
 * 发请求前领号，回来时只有比已写入的更新才落缓存；clear 会把之前领的号全部作废，
 * 免得清缓存之前发出去的请求晚回来又把旧数据写回去。
 */
let sitesTicket = 0
let sitesWrittenTicket = 0

export function beginSitesFetch(): number {
  return ++sitesTicket
}

export function commitSites(ticket: number, list: Site[]) {
  if (ticket <= sitesWrittenTicket) return
  sitesWrittenTicket = ticket
  collectAssetsCache.sites = list
}

export function clearCollectAssetsCache() {
  collectAssetsCache.sites = null
  collectAssetsCache.categories = null
  collectAssetsCache.tags = null
  collectAssetsCache.stats = null
  sitesWrittenTicket = sitesTicket
}
