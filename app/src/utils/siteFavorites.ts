import { ref } from 'vue'

/**
 * 「我收藏的网站」（0917-17）。
 *
 * **本地存，不等后端。** 会上原话：「他多的话，可能要点一个什么收藏」——产品要的是现在就能用，
 * 而后端没有收藏字段，加一个要走一轮需求 + 建表。
 *
 * **不蹭 `cfg_site.tags`**：那套标签是分号分隔、**清不掉**、筛选还是子串匹配
 * （见 `0916-网站标签_后端接口需求`），拿它当收藏会把业务标签污染掉，而且删不干净。
 *
 * 代价明确：**换浏览器 / 换电脑不同步**。后端哪天给了字段，一次性脚本迁移即可
 * （读这里的 localStorage，写后端）。
 *
 * 状态放模块级 ref 而不是 store：卡片、表格、工具条三处要共享同一份，
 * 模块级 ref 天然就是单例，比起一个只存一个 Set 的 store 更省事
 * （与 `pageSizePref.ts` / `railPref.ts` 同一套路数，只是多了响应式）。
 */
const KEY = 'rc.site.favorites'

function read(): Set<string> {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    // 认不出来的值（老版本写的、被手改的）一律当没有，不要让一行坏数据把列表带崩
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string' && !!v)) : new Set()
  } catch {
    return new Set()
  }
}

function write(ids: Set<string>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...ids]))
  } catch {
    /* 隐私模式 / 配额满：存不下就算了，本次会话内仍然生效 */
  }
}

/** 收藏的网站 ID。三处共用这一份。 */
export const favoriteSiteIds = ref<Set<string>>(read())

export function isFavoriteSite(siteId: string): boolean {
  return favoriteSiteIds.value.has(siteId)
}

/** 切换收藏，返回切换后的状态。 */
export function toggleFavoriteSite(siteId: string): boolean {
  if (!siteId) return false
  // 换一个新 Set 而不是原地增删：Set 的 add/delete 不会触发 ref 的依赖更新
  const next = new Set(favoriteSiteIds.value)
  const nowFav = !next.has(siteId)
  if (nowFav) next.add(siteId)
  else next.delete(siteId)
  favoriteSiteIds.value = next
  write(next)
  return nowFav
}

/**
 * 跨标签页同步：在另一个标签页点了星，这边的列表也要跟着变
 * （页签条的存在让"同时开两个标签页"很常见）。
 * `storage` 事件只在**其他**标签页的写入时触发，不会和本页的写形成回环。
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) favoriteSiteIds.value = read()
  })
}
