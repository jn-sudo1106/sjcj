// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import LaunchJobBar from './LaunchJobBar.vue'
import { useLaunchJobStore } from '@/stores/launchJob'

beforeEach(() => setActivePinia(createPinia()))
const mountBar = () => mount(LaunchJobBar, { global: { plugins: [] } })

describe('批量提交作业条（Y4-3/Y4-4）', () => {
  it('没有作业时不占地方', () => {
    const w = mountBar()
    expect(w.find('[data-testid="launch-job-bar"]').exists()).toBe(false)
  })

  it('跑起来后显示进度，可暂停/继续/结束', async () => {
    const job = useLaunchJobStore()
    const w = mountBar()
    job.start('对 1200 个源发任务', 1200)
    job.progress(500, 1200)
    await w.vm.$nextTick()
    expect(w.get('[data-testid="launch-job-status"]').text()).toBe('正在提交 500 / 1200')

    await w.get('[data-testid="launch-job-pause"]').trigger('click')
    expect(w.get('[data-testid="launch-job-status"]').text()).toContain('已暂停')
    await w.get('[data-testid="launch-job-resume"]').trigger('click')
    expect(w.get('[data-testid="launch-job-status"]').text()).toContain('正在提交')
    await w.get('[data-testid="launch-job-abort"]').trigger('click')
    expect(job.signal.aborted).toBe(true)
  })

  /**
   * Y4-4 是条红线：前端只能不发后续批次，**已提交的收不回来**——服务端一侧没有任何
   * stop/cancel 端点（服务端级停止是 H3，未答复）。写「已终止/已停止」会让用户点完
   * 看任务还在跑，当成 bug。这条用例逐字锁措辞，改文案时必须一起想清楚。
   */
  it('中止后的文案是「已停止提交后续批次」，且始终写明已提交的不会撤销', async () => {
    const job = useLaunchJobStore()
    const w = mountBar()
    job.start('对 1200 个源发任务', 1200)
    job.abort()
    job.finish({ sent: 500, failed: [], skipped: ['a', 'b'] }, 10000)
    await w.vm.$nextTick()

    const text = w.get('[data-testid="launch-job-bar"]').text()
    expect(w.get('[data-testid="launch-job-status"]').text()).toBe('已停止提交后续批次，已提交 500 个')
    expect(text).toContain('已提交的任务不会撤销')
    expect(text).not.toContain('已终止')
  })

  // 失败（发了没成）和未提交（压根没发）补救动作不一样，必须分开报
  it('失败与未提交分开显示，有失败才给重试', async () => {
    const job = useLaunchJobStore()
    const w = mountBar()
    let retried = 0
    job.start('作业', 10, () => { retried += 1 })
    job.finish({ sent: 6, failed: [{ ids: ['1', '2'], error: 'x' }], skipped: ['3', '4'] }, 10000)
    await w.vm.$nextTick()

    expect(w.get('[data-testid="launch-job-failed"]').text()).toBe('失败 2')
    expect(w.get('[data-testid="launch-job-skipped"]').text()).toBe('未提交 2')
    await w.get('[data-testid="launch-job-retry"]').trigger('click')
    expect(retried).toBe(1)
  })

  it('没有失败批次就不显示重试', async () => {
    const job = useLaunchJobStore()
    const w = mountBar()
    job.start('作业', 10, () => {})
    job.finish({ sent: 10, failed: [], skipped: [] }, 10000)
    await w.vm.$nextTick()
    expect(w.find('[data-testid="launch-job-retry"]').exists()).toBe(false)
  })
})
