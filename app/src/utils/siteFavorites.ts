import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { favoriteApi } from '@/api'

/**
 * 「我收藏的网站」（0917-17）。
 *
 * **2026-09-23 起以后端为准**（`/v1/favorite/*`，B30）：userId 由后端从会话取，同一账号换浏览器 /
 * 换电脑看到同一份。此前是纯 localStorage（后端没有能存的地方），那份数据由下方
 * {@link migrateLegacyLocal} 一次性补传上去。
 *
 * 状态放模块级 ref 而不是 store：卡片、表格、工具条三处要共享同一份，
 * 模块级 ref 天然就是单例（与 `pageSizePref.ts` / `railPref.ts` 同一套路数，只是多了响应式）。
 */

/** 旧版本地收藏的键。只剩迁移在读，迁移成功后删掉 */
const LEGACY_KEY = 'rc.site.favorites'

/** 收藏的网站 ID。三处共用这一份。 */
export const favoriteSiteIds = ref<Set<string>>(new Set())

export function isFavoriteSite(siteId: string): boolean {
  return favoriteSiteIds.value.has(siteId)
}

/** 换一个新 Set 而不是原地增删：Set 的 add/delete 不会触发 ref 的依赖更新 */
function setFavorite(siteId: string, on: boolean) {
  const next = new Set(favoriteSiteIds.value)
  if (on) next.add(siteId)
  else next.delete(siteId)
  favoriteSiteIds.value = next
}

/**
 * 切换收藏，返回切换后的状态。
 *
 * 先改本地（点了立刻亮 / 灭），再发请求；失败就改回去并提示——不能让星标停在一个后端没记下的状态，
 * 否则刷新一下就"自己消失"了，比点了没反应更让人困惑。
 */
export async function toggleFavoriteSite(siteId: string): Promise<boolean> {
  if (!siteId) return false
  const nowFav = !favoriteSiteIds.value.has(siteId)
  setFavorite(siteId, nowFav)
  try {
    if (nowFav) await favoriteApi.add('SITE', siteId)
    else await favoriteApi.remove('SITE', siteId)
    return nowFav
  } catch (error) {
    setFavorite(siteId, !nowFav)
    const reason = error instanceof Error && error.message ? `：${error.message}` : ''
    ElMessage.error(`${nowFav ? '收藏' : '取消收藏'}失败${reason}`)
    return !nowFav
  }
}

/** 同一时刻只跑一次加载：网站列表 / 收藏两个 tab 挂载时会同时来要 */
let loading: Promise<void> | null = null

/**
 * 从后端拉当前账号的全部网站收藏，替换本地状态。进页面、切回 tab 时调用。
 * 失败（未登录、网络）不清空已有状态，也不打扰——星标只是辅助信息，别为它弹错。
 */
export function loadFavoriteSites(): Promise<void> {
  if (loading) return loading
  loading = (async () => {
    try {
      const ids = await favoriteApi.listIds('SITE')
      favoriteSiteIds.value = new Set(ids)
      await migrateLegacyLocal()
    } catch {
      /* 保留现状 */
    } finally {
      loading = null
    }
  })()
  return loading
}

/**
 * 把旧版 localStorage 里的收藏补传到后端（一次性）。
 *
 * - 只补后端还没有的；后端 itemId 要求正整数，认不出的跳过（mock 时代的 `site-xxx` 这类）
 * - 全部成功才删本地那份；有失败就留着，下次进页面再补（add 幂等，重复补不会出错）
 * - 本地那份不分账号（旧实现就没有账号维度），谁先在这台浏览器登录就补到谁名下
 */
async function migrateLegacyLocal(): Promise<void> {
  let legacy: string[]
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY)
    if (!raw) return
    const parsed: unknown = JSON.parse(raw)
    legacy = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return
  }
  const pending = legacy.filter((id) => /^[1-9]\d*$/.test(id) && !favoriteSiteIds.value.has(id))
  let failed = 0
  for (const id of pending) {
    try {
      await favoriteApi.add('SITE', id)
      setFavorite(id, true)
    } catch {
      failed++
    }
  }
  if (failed) return
  try {
    window.localStorage.removeItem(LEGACY_KEY)
  } catch {
    /* 删不掉下次再试，add 幂等 */
  }
}
