import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { favoriteApi } from '@/api'

/**
 * 「表 ID 列表收藏」（1013-表ID列表排序与收藏）。结构照 `sourceFavorites.ts`，类型用 `ENTRY_TYPE`。
 *
 * 以后端为准（`/v1/favorite/*`，B30）：userId 由后端从会话取，换浏览器 / 换电脑看到同一份。
 * 后端 FavoriteController 无 itemType 白名单（只查正则 `[A-Z_]{1,32}`），`ENTRY_TYPE` 可直接用。
 *
 * 模块级 ref 当单例：表 ID 列表、只看收藏共用这一份。
 */

/** 收藏的表 ID */
export const favoriteEntryIds = ref<Set<string>>(new Set())
/** 是否已从后端拉过一次（成败都算）：没拉过时空集不代表"没有收藏" */
export const favoriteEntriesLoaded = ref(false)

export function isFavoriteEntry(tableId: string): boolean {
  return favoriteEntryIds.value.has(tableId)
}

/** 换一个新 Set 而不是原地增删：Set 的 add/delete 不会触发 ref 的依赖更新 */
function setFavorite(tableId: string, on: boolean) {
  const next = new Set(favoriteEntryIds.value)
  if (on) next.add(tableId)
  else next.delete(tableId)
  favoriteEntryIds.value = next
}

/**
 * 切换收藏，返回切换后的状态。先改本地（点了立刻亮 / 灭），再发请求；失败改回去并提示，
 * 不能让星标停在后端没记下的状态。
 */
export async function toggleFavoriteEntry(tableId: string): Promise<boolean> {
  if (!tableId) return false
  const nowFav = !favoriteEntryIds.value.has(tableId)
  setFavorite(tableId, nowFav)
  try {
    if (nowFav) await favoriteApi.add('ENTRY_TYPE', tableId)
    else await favoriteApi.remove('ENTRY_TYPE', tableId)
    return nowFav
  } catch (error) {
    setFavorite(tableId, !nowFav)
    const reason = error instanceof Error && error.message ? `：${error.message}` : ''
    ElMessage.error(`${nowFav ? '收藏' : '取消收藏'}失败${reason}`)
    return !nowFav
  }
}

/** 同一时刻只跑一次加载 */
let loading: Promise<void> | null = null

/**
 * 从后端拉当前账号的全部表收藏，替换本地状态。
 * 失败（未登录、网络）不清空已有状态，也不打扰——星标只是辅助信息，别为它弹错。
 */
export function loadFavoriteEntries(): Promise<void> {
  if (loading) return loading
  loading = (async () => {
    try {
      favoriteEntryIds.value = new Set(await favoriteApi.listIds('ENTRY_TYPE'))
    } catch {
      /* 保留现状 */
    } finally {
      favoriteEntriesLoaded.value = true
      loading = null
    }
  })()
  return loading
}
