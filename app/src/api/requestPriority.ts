/**
 * 请求优先级（2026-11-19，2806 源管理「操作都慢」排查）。
 *
 * 生产网关只走 HTTP/1.1，浏览器每域 6 条连接。源管理表格视图的业务目录归属要逐目录 listSources
 *（217 上 179 个），实测切表格视图一次 213 个请求、27.9s 才发完、总共才 139KB——不是带宽，是排队：
 * 这段时间用户点任何操作都排在这堆请求后面。
 *
 * 后台请求（`priority: 'background'`）只在没有前台请求在途时发，最多 BACKGROUND_IDLE_LIMIT 个；
 * 前台一直有请求在途（慢接口 / 轮询）时，等满 BACKGROUND_STARVE_MS 后降到 1 个继续发，不会被饿死。
 */
export const BACKGROUND_IDLE_LIMIT = 2
export const BACKGROUND_STARVE_MS = 2000

let foreground = 0
let background = 0
const waiters = new Set<() => void>()

function wake() {
  const pending = [...waiters]
  waiters.clear()
  pending.forEach((fn) => fn())
}

/** 前台请求发出前调用，返回的函数在请求结束（成功 / 失败）时调用 */
export function beginForegroundRequest(): () => void {
  foreground++
  let done = false
  return () => {
    if (done) return
    done = true
    foreground--
    wake()
  }
}

/** 后台请求发出前等一个槽位；返回的函数在请求结束时调用 */
export async function acquireBackgroundSlot(): Promise<() => void> {
  const since = Date.now()
  for (;;) {
    const starved = Date.now() - since >= BACKGROUND_STARVE_MS
    const limit = foreground === 0 ? BACKGROUND_IDLE_LIMIT : starved ? 1 : 0
    if (background < limit) break
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { waiters.delete(done); resolve() }, starved ? 1000 : BACKGROUND_STARVE_MS - (Date.now() - since))
      const done = () => { clearTimeout(timer); resolve() }
      waiters.add(done)
    })
  }
  background++
  let released = false
  return () => {
    if (released) return
    released = true
    background--
    wake()
  }
}

/** 测试用 */
export function requestPriorityState() {
  return { foreground, background, waiting: waiters.size }
}
