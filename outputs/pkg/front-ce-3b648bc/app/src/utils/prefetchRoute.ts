// 路由 chunk 预取：把「点击 → 下载 → 解析 → 挂载」里的下载段挪到用户把鼠标移到菜单上、
// 或首屏稳定后的空闲时段。页面 chunk 本身不大（几十 KB），但弱网/首次访问时
// 1 个 RTT 就够让人感觉「点了没反应」。
//
// 只预热路由记录上的懒加载函数（`() => import(...)`），不触碰页面逻辑，失败静默。
import type { Router } from 'vue-router'

type LazyLoader = () => Promise<unknown>

/** 已预热过的路径（同一路径只触发一次；失败会移除，允许下次重试） */
const prefetched = new Set<string>()

function asLazyLoader(component: unknown): LazyLoader | null {
  // vue-router 的懒加载记录就是 `() => import(...)`；已加载的组件是对象，跳过
  return typeof component === 'function' ? (component as LazyLoader) : null
}

/**
 * 预热某个地址对应的页面 chunk。
 * @param router 应用路由实例（用 resolve 拿到该地址最终匹配到的记录）
 * @param path 目标地址（可带 query，如 `/sync?tab=logs`）
 */
export function prefetchRoute(router: Router, path: string): void {
  const key = String(path || '').split('?')[0]
  if (!key || prefetched.has(key)) return
  prefetched.add(key)
  try {
    const matched = router.resolve(key).matched
    const record = matched[matched.length - 1]
    const components = record?.components as Record<string, unknown> | undefined
    const loader = asLazyLoader(components?.default)
    if (!loader) {
      prefetched.delete(key)
      return
    }
    const loading = loader()
    if (loading && typeof loading.catch === 'function') {
      // 部署中/网络异常导致的 chunk 404 不该打扰用户：清标记，下次还有机会
      void loading.catch(() => prefetched.delete(key))
    }
  } catch {
    prefetched.delete(key)
  }
}

/** 测试用：重置预热记录 */
export function resetPrefetchCache(): void {
  prefetched.clear()
}
