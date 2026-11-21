import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acquireBackgroundSlot,
  BACKGROUND_IDLE_LIMIT,
  BACKGROUND_STARVE_MS,
  beginForegroundRequest,
  requestPriorityState,
} from './requestPriority'

describe('requestPriority', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('没有前台请求时后台最多并发 BACKGROUND_IDLE_LIMIT 个', async () => {
    const releases = await Promise.all(Array.from({ length: BACKGROUND_IDLE_LIMIT }, () => acquireBackgroundSlot()))
    let third = false
    const pending = acquireBackgroundSlot().then((release) => { third = true; return release })
    await vi.advanceTimersByTimeAsync(0)
    expect(third).toBe(false)
    releases[0]!()
    const release = await pending
    expect(third).toBe(true)
    release()
    releases.slice(1).forEach((fn) => fn())
    expect(requestPriorityState()).toEqual({ foreground: 0, background: 0, waiting: 0 })
  })

  it('前台请求在途时后台等待，前台结束立即放行', async () => {
    const endForeground = beginForegroundRequest()
    let started = false
    const pending = acquireBackgroundSlot().then((release) => { started = true; return release })
    await vi.advanceTimersByTimeAsync(BACKGROUND_STARVE_MS - 100)
    expect(started).toBe(false)
    endForeground()
    const release = await pending
    expect(started).toBe(true)
    release()
  })

  it('前台一直占着时，等满 BACKGROUND_STARVE_MS 后降到 1 个继续发', async () => {
    const endForeground = beginForegroundRequest()
    const a = acquireBackgroundSlot()
    const b = acquireBackgroundSlot()
    let bStarted = false
    void b.then(() => { bStarted = true })
    await vi.advanceTimersByTimeAsync(BACKGROUND_STARVE_MS)
    const releaseA = await a
    expect(bStarted).toBe(false)
    releaseA()
    const releaseB = await b
    releaseB()
    endForeground()
    expect(requestPriorityState()).toEqual({ foreground: 0, background: 0, waiting: 0 })
  })

  it('释放函数重复调用只算一次', () => {
    const end = beginForegroundRequest()
    end()
    end()
    expect(requestPriorityState().foreground).toBe(0)
  })
})
