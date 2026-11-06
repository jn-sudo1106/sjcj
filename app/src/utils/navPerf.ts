// 导航性能打点（**仅开发态**）：把「点菜单 → 首帧」拆成三段打到控制台，
// 免得继续靠猜优化方向：
//   守卫   = beforeEach 到 afterEach（会话恢复、权限判断）
//   首帧   = afterEach 到 nextTick + rAF（组件挂载、首屏渲染）
//   资源   = 本次导航期间新加载的 chunk（按耗时倒序取前 3，弱网时一眼看出是不是下载）
//   长任务 = 本次导航期间 >50ms 的主线程阻塞（DOM/计算，区别于网络）
//
// 生产构建里 `import.meta.env.DEV === false`，本文件整体被摇掉，零成本。
import { nextTick } from 'vue'
import type { Router } from 'vue-router'

const raf: (cb: () => void) => void =
  typeof requestAnimationFrame === 'function'
    ? (cb) => requestAnimationFrame(() => cb())
    : (cb) => {
        setTimeout(cb, 0)
      }

/** 是否打点：开发态默认开；构建产物里在控制台执行 `localStorage.setItem('navPerf','1')` 后刷新即可开 */
const NAV_PERF_ENABLED =
  import.meta.env.DEV || (typeof localStorage !== 'undefined' && localStorage.getItem('navPerf') === '1')

interface NavMark {
  path: string
  started: number
}

/** 挂上导航打点。必须注册在业务守卫之前（先注册先执行）。 */
export function setupNavPerf(router: Router): void {
  if (!NAV_PERF_ENABLED) return

  let pending: NavMark | null = null
  let longTasks: number[] = []

  try {
    if (typeof PerformanceObserver === 'function') {
      new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => longTasks.push(Math.round(entry.duration)))
      }).observe({ entryTypes: ['longtask'] })
    }
  } catch {
    // 浏览器不支持 longtask 就算了，其余指标照常打
  }

  router.beforeEach((to) => {
    pending = { path: to.path, started: performance.now() }
    longTasks = []
  })

  router.afterEach((to) => {
    if (!pending || pending.path !== to.path) return
    const mark = pending
    pending = null
    const guardDone = performance.now()

    void nextTick()
      .then(() => new Promise<void>((resolve) => raf(() => resolve())))
      .then(() => {
        const firstFrame = performance.now()
        const chunks = performance
          .getEntriesByType('resource')
          .filter((entry) => entry.startTime >= mark.started && /\/assets\/.*\.(js|css)$/.test(entry.name))
          .map((entry) => ({ name: (entry.name.split('/').pop() || '').slice(0, 34), ms: Math.round(entry.duration) }))
          .sort((a, b) => b.ms - a.ms)
          .slice(0, 3)
          .map((item) => `${item.name} ${item.ms}ms`)

        const parts = [
          `[perf] ${to.path} 总 ${Math.round(firstFrame - mark.started)}ms`,
          `守卫 ${Math.round(guardDone - mark.started)}ms`,
          `首帧 ${Math.round(firstFrame - guardDone)}ms`,
        ]
        if (chunks.length) parts.push(`资源 ${chunks.join(' · ')}`)
        if (longTasks.length) parts.push(`长任务 ${longTasks.join(',')}ms`)
        console.warn(parts.join(' · '))
      })
  })
}
