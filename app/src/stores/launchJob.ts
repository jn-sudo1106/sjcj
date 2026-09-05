import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { BatchSignal, FailedBatch } from '@/views/FlowCanvas/result/useSourceLaunch'

/**
 * 批量提交作业态（0903 Y4-2）。
 *
 * ⚠️ **先把语义钉死**：这里的「暂停 / 结束」= **停止提交后续批次**。
 * 已经提交出去的任务**不回滚、不撤销**——服务端一侧没有任何 stop/cancel 端点
 * （2026-09-05 逐条查过 `endpoints.ts`），服务端级停止是 H3，未答复。
 * 所以作业条上**不许出现「已终止 / 已停止」这类绝对化文案**（Y4-4），
 * 否则用户点完看任务还在跑，会当成 bug。
 *
 * **不做持久化**（Y4-7）：作业的循环活在当前页面的 JS 里，刷新就没了。
 * 存进 localStorage 只会在刷新后留一条恢复不了的假进度，比丢掉更糟。
 *
 * **同时只允许一个作业**（Y4-2）：并发批量提交既看不清进度，也容易把后端打满。
 */
export type LaunchJobState = 'running' | 'paused' | 'aborted' | 'done'

export const useLaunchJobStore = defineStore('launchJob', () => {
  const label = ref('')
  const total = ref(0)
  const done = ref(0)
  const sent = ref(0)
  const failed = ref<FailedBatch[]>([])
  const skipped = ref<string[]>([])
  const state = ref<LaunchJobState>('done')
  /** 有没有作业在占用（running / paused 都算占用；结果条还挂着不算） */
  const busy = computed(() => state.value === 'running' || state.value === 'paused')
  /** 作业条是否可见：跑着的时候，以及结束后留一会儿看结果（Y4-6） */
  const visible = ref(false)
  /** 失败批次的重试动作（Y4-6）。由发起方登记——只有它知道怎么重发这批 ID。
   *  作业条能跨路由存活，而发起页可能已经被切走了，所以钩子挂在 store 上。 */
  const retry = ref<(() => void) | null>(null)

  // 传给 sendInBatches 的信号。**必须是同一个对象**——那边握着引用按批读，
  // 换成新对象就等于把已经在跑的循环的开关拆下来了。
  const signal: BatchSignal = { paused: false, aborted: false }

  let resultTimer: ReturnType<typeof setTimeout> | undefined

  /** 开一个作业。已有作业在跑时返回 false，调用方据此提示并放弃本次提交 */
  function start(jobLabel: string, jobTotal: number, onRetry?: () => void): boolean {
    if (busy.value) return false
    if (resultTimer) { clearTimeout(resultTimer); resultTimer = undefined }
    label.value = jobLabel
    total.value = jobTotal
    done.value = 0
    sent.value = 0
    failed.value = []
    skipped.value = []
    signal.paused = false
    signal.aborted = false
    retry.value = onRetry ?? null
    state.value = 'running'
    visible.value = true
    return true
  }

  function progress(doneCount: number, totalCount: number) {
    done.value = doneCount
    total.value = totalCount
  }

  function pause() {
    if (state.value !== 'running') return
    signal.paused = true
    state.value = 'paused'
  }
  function resume() {
    if (state.value !== 'paused') return
    signal.paused = false
    state.value = 'running'
  }
  /** 结束：剩余批次不再提交。已提交的不受影响 */
  function abort() {
    if (!busy.value) return
    signal.aborted = true
    // paused 一起放开，否则 sendInBatches 卡在暂停的等待里读不到 aborted
    signal.paused = false
    state.value = 'aborted'
  }

  /** 作业跑完（正常结束或被中止后循环退出）。结果条保留 keepMs 再收（Y4-6） */
  function finish(result: { sent: number; failed: FailedBatch[]; skipped: string[] }, keepMs = 10000) {
    sent.value = result.sent
    failed.value = result.failed
    skipped.value = result.skipped
    if (state.value !== 'aborted') state.value = 'done'
    signal.paused = false
    if (keepMs > 0) {
      resultTimer = setTimeout(() => { visible.value = false }, keepMs)
    } else {
      visible.value = false
    }
  }

  function dismiss() {
    if (resultTimer) { clearTimeout(resultTimer); resultTimer = undefined }
    visible.value = false
  }

  return {
    label, total, done, sent, failed, skipped, state, busy, visible, signal, retry,
    start, progress, pause, resume, abort, finish, dismiss,
  }
})
