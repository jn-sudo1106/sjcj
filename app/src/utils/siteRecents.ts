import { ref } from 'vue'
import { logReportApi } from '@/api'

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
 * **2026-10-19 起以后端通用埋点为准**（`/api/v1/log-report/*`，接口文档「通用埋点」）：
 * 此前是纯 localStorage（键 `rc.site.recent`），换电脑就没了；现在同一账号换浏览器 / 换电脑
 * 看到的是同一份。旧键不再读取，首次成功拉到后端数据后一次性删除（不回填——回填等于给
 * 每条旧记录伪造一个"当前时间"，会把真实时间序打乱）。
 *
 * 实现上是「**本地乐观 + 后端权威**」：
 * - `recordSiteVisit` 先就地置顶（保证点完返回列表立刻正确），再尽力上报后端；
 * - `loadRecentSites` 进页面 / 切回 tab 时用后端结果覆盖本地，失败保留现状不置空。
 */

/** 旧版本地记录的键。只剩一次性清理在读，不再写入 */
const LEGACY_KEY = 'rc.site.recent'

/** 留 10 条：再多就不叫"最近"了，下拉里也看不过来（后端 limit 上限 100，想放宽只改这里） */
const MAX = 10

/** 最近打开的网站 ID，**最近的在前**。初始为空，由 {@link loadRecentSites} 从后端填充 */
export const recentSiteIds = ref<string[]>([])

/** 首次后端加载是否已完成：区分「还没拉到」和「确实一条都没有」，避免空态文案闪一下 */
export const recentLoaded = ref(false)

/**
 * 记一次"打开了这个网站"。
 *
 * 在**所有带 siteId 的进入动作**上调用，包括点源 chip 进具体源——那也是通过这个网站进去的，
 * 不记的话最常见的一种进入方式就丢了，下次照样要找半天。
 *
 * 同步返回（不阻塞跳转）：本地先置顶，上报是尽力而为，失败静默——埋点挂了也不能让人点不进去。
 *
 * @param siteName 网站名，尽量传：`recent` 列表直接展示 `contentTitle`，不传后端标题会是空的
 */
export function recordSiteVisit(siteId: string, siteName?: string): void {
  if (!siteId) return
  const id = String(siteId)
  // 已经在最前面就整体跳过：既不用重排，也不再打一次 ENTER
  // （连着点同一个网站——进卡片又退回来再进——不该把明细表刷成一串重复行）
  if (recentSiteIds.value[0] === id) return
  recentSiteIds.value = [id, ...recentSiteIds.value.filter((x) => x !== id)].slice(0, MAX)
  void logReportApi
    .report({
      action: 'ENTER',
      contentType: 'SITE',
      contentId: id,
      contentTitle: siteName,
      firstModule: '采集资产',
      pageName: '网站详情',
      eventCode: 'site_open',
    })
    .catch(() => {
      /* 尽力而为：失败不影响跳转，也不弹提示 */
    })
}

/** 同一时刻只跑一次加载：网站列表 / 收藏 / 最近打开几个 tab 挂载时会同时来要 */
let loading: Promise<void> | null = null

/**
 * 从后端拉当前账号「最近打开的网站」，替换本地状态。进页面、切回 tab 时调用。
 *
 * 失败（未登录、网络、后端未部署）**不清空已有状态、不弹错**——最近打开只是辅助入口，
 * 不能因为它挂了让整块列表变空。成功后顺手删掉旧版 localStorage 键（一次性清理，不回填）。
 */
export function loadRecentSites(): Promise<void> {
  if (loading) return loading
  loading = (async () => {
    try {
      const res = await logReportApi.recentRaw({ contentType: 'SITE', action: 'ENTER', limit: MAX })
      // 成功判定按 RspResult：success === true（code 是字符串 "0"，不作为判据）
      if (res?.success !== true) return
      // 接口文档：RspResult 的 data「无数据时为 null」——null 要当"确实没有"处理，
      // 不能当成失败，否则空账号会一直卡在"正在加载最近打开…"。
      const items = Array.isArray(res.data) ? res.data : []
      recentSiteIds.value = items
        .map((item) => String(item?.contentId ?? ''))
        .filter(Boolean)
        .slice(0, MAX)
      recentLoaded.value = true
      clearLegacyLocal()
    } catch {
      /* 保留现状 */
    } finally {
      loading = null
    }
  })()
  return loading
}

/** 旧版本地记录一次性清理：用不上就别留着，免得下一个人以为它还在生效 */
function clearLegacyLocal(): void {
  try {
    window.localStorage.removeItem(LEGACY_KEY)
  } catch {
    /* 隐私模式 / 配额异常：删不掉也不影响功能 */
  }
}

/** 排在第几位（0 = 最近）；不在列表里返回 {@link MAX}，方便直接拿去排序 */
export function recentRankOf(siteId: string): number {
  const i = recentSiteIds.value.indexOf(siteId)
  return i < 0 ? MAX : i
}
