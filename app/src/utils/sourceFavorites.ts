import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { favoriteApi } from '@/api'

/**
 * 「我收藏的源」（0924-08）。结构照 `siteFavorites.ts`，类型用 `SOURCE`；两处用不值得抽通用工厂。
 *
 * 以后端为准（`/v1/favorite/*`，B30）：userId 由后端从会话取，换浏览器 / 换电脑看到同一份。
 * 源收藏是新功能，没有本地旧数据要迁移。
 *
 * 模块级 ref 当单例：采集资产源列表、网站详情源视图共用这一份，两边点哪个都同步。
 */

/** 收藏的源 ID */
export const favoriteSourceIds = ref<Set<string>>(new Set())
/** 是否已从后端拉过一次（成败都算）：没拉过时空集不代表"没有收藏"，「我的收藏」页签要显示加载中而不是空态 */
export const favoriteSourcesLoaded = ref(false)

export function isFavoriteSource(sourceId: string): boolean {
  return favoriteSourceIds.value.has(sourceId)
}

/** 换一个新 Set 而不是原地增删：Set 的 add/delete 不会触发 ref 的依赖更新 */
function setFavorite(sourceId: string, on: boolean) {
  const next = new Set(favoriteSourceIds.value)
  if (on) next.add(sourceId)
  else next.delete(sourceId)
  favoriteSourceIds.value = next
}

/**
 * 切换收藏，返回切换后的状态。先改本地（点了立刻亮 / 灭），再发请求；失败改回去并提示，
 * 不能让星标停在后端没记下的状态。
 */
export async function toggleFavoriteSource(sourceId: string): Promise<boolean> {
  if (!sourceId) return false
  const nowFav = !favoriteSourceIds.value.has(sourceId)
  setFavorite(sourceId, nowFav)
  try {
    if (nowFav) await favoriteApi.add('SOURCE', sourceId)
    else await favoriteApi.remove('SOURCE', sourceId)
    return nowFav
  } catch (error) {
    setFavorite(sourceId, !nowFav)
    const reason = error instanceof Error && error.message ? `：${error.message}` : ''
    ElMessage.error(`${nowFav ? '收藏' : '取消收藏'}失败${reason}`)
    return !nowFav
  }
}

/** 同一时刻只跑一次加载 */
let loading: Promise<void> | null = null

/**
 * 从后端拉当前账号的全部源收藏，替换本地状态。
 * 失败（未登录、网络）不清空已有状态，也不打扰——星标只是辅助信息，别为它弹错。
 */
export function loadFavoriteSources(): Promise<void> {
  if (loading) return loading
  loading = (async () => {
    try {
      favoriteSourceIds.value = new Set(await favoriteApi.listIds('SOURCE'))
    } catch {
      /* 保留现状 */
    } finally {
      favoriteSourcesLoaded.value = true
      loading = null
    }
  })()
  return loading
}
