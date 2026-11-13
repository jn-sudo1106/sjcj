<script setup lang="ts">
/**
 * 批量提交作业条（0903 Y4-3）。固定在页面底部，**挂在布局层**——
 * 切页签、跳路由都不能让它消失，否则用户一走开就看不到进度也按不了暂停。
 *
 * 文案红线（Y4-4）：这里的暂停/结束只是**停止提交后续批次**，已提交的不撤销。
 * 所以条上永远写「已停止提交后续批次」，**不写「已终止 / 已停止」**。
 */
import { computed, onMounted, onUnmounted } from 'vue'
import { useLaunchJobStore } from '@/stores/launchJob'

const job = useLaunchJobStore()

/**
 * 关页面/刷新前提醒（Y4-7）。
 *
 * 循环活在当前页面的 JS 里，刷新就没了，剩余批次会**静默不发**——不提醒的话，
 * 用户会以为 3000 个都发出去了。作业态刻意**不做 localStorage 持久化**：
 * 存了也恢复不了循环，只会在刷新后留一条骗人的进度。
 *
 * 只拦真正的页面卸载，**不加路由守卫**：站内跳转不会中断这个循环（Promise 链
 * 不随组件卸载停止），拦下来只会是一次假警报。
 */
function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!job.busy) return
  event.preventDefault()
  event.returnValue = '批量任务进行中，离开将停止提交剩余批次。'
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onUnmounted(() => window.removeEventListener('beforeunload', onBeforeUnload))

const failedCount = computed(() => job.failed.reduce((n, item) => n + item.ids.length, 0))
const percent = computed(() => (job.total ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0))
const statusText = computed(() => {
  if (job.state === 'running') return `正在提交 ${job.done} / ${job.total}`
  if (job.state === 'paused') return `已暂停，已提交 ${job.done} / ${job.total}`
  if (job.state === 'aborted') return `已停止提交后续批次，已提交 ${job.sent} 个`
  return `提交完成，成功 ${job.sent} 个`
})
</script>

<template>
  <div v-if="job.visible" class="ljb" role="status" data-testid="launch-job-bar">
    <div class="ljb-main">
      <span class="ljb-label">{{ job.label }}</span>
      <span class="ljb-status" data-testid="launch-job-status">{{ statusText }}</span>
      <span v-if="failedCount" class="ljb-failed" data-testid="launch-job-failed">失败 {{ failedCount }}</span>
      <!-- 未提交与失败**分开报**：失败是发了没成，未提交是压根没发，补救动作不一样 -->
      <span v-if="job.skipped.length" class="ljb-skipped" data-testid="launch-job-skipped">未提交 {{ job.skipped.length }}</span>
    </div>
    <div class="ljb-track"><i class="ljb-fill" :style="{ width: `${percent}%` }" /></div>
    <!-- 已提交的收不回来，这句必须常驻，不能只在点暂停后才出现 -->
    <p class="ljb-note">暂停 / 结束只停止提交后续批次；已提交的任务不会撤销。</p>
    <div class="ljb-actions">
      <button v-if="job.state === 'running'" type="button" class="ljb-btn" data-testid="launch-job-pause" @click="job.pause()">暂停</button>
      <button v-else-if="job.state === 'paused'" type="button" class="ljb-btn" data-testid="launch-job-resume" @click="job.resume()">继续</button>
      <!-- 重试只重发失败的那几批，不重发全部（Y4-6）。动作由发起方登记：
           作业条能跨路由存活，发起页可能已经切走了。 -->
      <button v-if="!job.busy && failedCount && job.retry" type="button" class="ljb-btn" data-testid="launch-job-retry" @click="job.retry?.()">重试失败批次</button>
      <button v-if="job.busy" type="button" class="ljb-btn danger" data-testid="launch-job-abort" @click="job.abort()">结束</button>
      <button v-else type="button" class="ljb-btn" data-testid="launch-job-dismiss" @click="job.dismiss()">关闭</button>
    </div>
  </div>
</template>

<style scoped>
.ljb { position: fixed; right: 24px; bottom: 20px; z-index: 2200; width: 360px; max-width: calc(100vw - 32px); padding: 12px 14px; border: 1px solid var(--rc-border); border-radius: 10px; background: #fff; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16); }
.ljb-main { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
.ljb-label { font-size: 13px; font-weight: 700; color: var(--rc-text); }
.ljb-status { font-size: 12px; color: var(--rc-text-2); }
.ljb-failed { font-size: 12px; color: var(--rc-danger, #dc2626); }
.ljb-skipped { font-size: 12px; color: var(--rc-faint); }
.ljb-track { height: 4px; margin: 8px 0 6px; border-radius: 2px; background: #e2e8f0; overflow: hidden; }
.ljb-fill { display: block; height: 100%; background: var(--rc-primary); transition: width 0.2s; }
.ljb-note { margin: 0 0 8px; font-size: 11px; line-height: 1.5; color: var(--rc-faint); }
.ljb-actions { display: flex; justify-content: flex-end; gap: 8px; }
.ljb-btn { height: 26px; padding: 0 12px; border: 1px solid var(--rc-border); border-radius: 5px; background: #fff; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; }
.ljb-btn:hover { border-color: #93c5fd; color: var(--rc-primary-ink); background: var(--rc-primary-bg); }
.ljb-btn.danger { color: var(--rc-danger, #dc2626); }
.ljb-btn.danger:hover { border-color: #fca5a5; background: #fef2f2; color: var(--rc-danger, #dc2626); }
</style>
