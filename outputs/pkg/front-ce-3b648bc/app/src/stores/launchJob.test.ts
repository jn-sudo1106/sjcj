import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLaunchJobStore } from './launchJob'

beforeEach(() => setActivePinia(createPinia()))

describe('launchJob store（Y4-2）', () => {
  it('同时只允许一个作业：第二次 start 被拒', () => {
    const job = useLaunchJobStore()
    expect(job.start('A', 100)).toBe(true)
    expect(job.start('B', 200)).toBe(false)
    expect(job.label).toBe('A')
  })

  it('作业结束后作业位释放，可以再开一个', () => {
    const job = useLaunchJobStore()
    job.start('A', 100)
    job.finish({ sent: 100, failed: [], skipped: [] }, 0)
    expect(job.busy).toBe(false)
    expect(job.start('B', 200)).toBe(true)
  })

  it('暂停/继续切换 signal.paused，结束置 aborted', () => {
    const job = useLaunchJobStore()
    job.start('A', 100)
    job.pause()
    expect([job.state, job.signal.paused]).toEqual(['paused', true])
    job.resume()
    expect([job.state, job.signal.paused]).toEqual(['running', false])
    job.abort()
    expect([job.state, job.signal.aborted]).toEqual(['aborted', true])
  })

  // abort 必须同时放开 paused：否则 sendInBatches 卡在暂停的等待循环里，永远读不到 aborted
  it('暂停中点结束能真的停下来：paused 一并放开', () => {
    const job = useLaunchJobStore()
    job.start('A', 100)
    job.pause()
    job.abort()
    expect(job.signal.paused).toBe(false)
    expect(job.signal.aborted).toBe(true)
  })

  // signal 必须是同一个对象：sendInBatches 握着引用按批读，换新对象等于把开关拆了
  it('start 复用同一个 signal 对象，只重置字段', () => {
    const job = useLaunchJobStore()
    job.start('A', 100)
    const first = job.signal
    job.abort()
    job.finish({ sent: 0, failed: [], skipped: [] }, 0)
    job.start('B', 100)
    expect(job.signal).toBe(first)
    expect(job.signal.aborted).toBe(false)
  })

  it('结果条保留一段时间后自行收起，dismiss 可立刻收', () => {
    vi.useFakeTimers()
    const job = useLaunchJobStore()
    job.start('A', 100)
    job.finish({ sent: 90, failed: [{ ids: ['1'], error: 'x' }], skipped: ['2'] }, 10000)
    expect(job.visible).toBe(true)
    vi.advanceTimersByTime(10000)
    expect(job.visible).toBe(false)
    vi.useRealTimers()
  })

  // 被中止的作业不能在 finish 里被改写成 'done'——那会把"没发完"报成"完成"
  it('中止后 finish 保持 aborted，不改写成完成', () => {
    const job = useLaunchJobStore()
    job.start('A', 100)
    job.abort()
    job.finish({ sent: 50, failed: [], skipped: ['a', 'b'] }, 0)
    expect(job.state).toBe('aborted')
    expect(job.skipped).toEqual(['a', 'b'])
  })
})
