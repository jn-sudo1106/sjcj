<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { runnerManagementApi, type DeploymentTaskDetail, type GeneratedDeploymentJob } from '@/api/runnerManagement'
import { formatRunnerDateTime } from '@/utils/format/runnerHeartbeat'

const props = defineProps<{ job: GeneratedDeploymentJob }>()
const detail = ref<DeploymentTaskDetail | null>(null), loading = ref(false), error = ref('')
const activeTab = defineModel<string>('tab', { default: 'info' })
const stages: Record<string, string> = { created: '创建任务', waiting_resource: '等待资源', queued: '等待下发', resource: '匹配资源', baseline: '读取已有版本', source: '读取 Git 代码', scope: '确定下发范围', package: '打包与检查', packaged: '制品就绪', delivering: '下发代码', requested: '提交下发', received: 'Runner 接收', 'directory-check': '目录检查', download: '下载代码', verify: '摘要和签名校验', install: '写入目录', installed: '写入完成', finished: '下发回执', success: '部署成功', failed: '执行失败', superseded: '已被替代', retry: '重试任务' }
const output = computed(() => detail.value?.events.map(event =>
  `[${formatRunnerDateTime(event.time)}] [${event.level.toUpperCase()}] ${stages[event.stage] || event.stage}：${event.message}${event.detail ? '\n' + event.detail : ''}`).join('\n\n') || '暂无过程输出')
const duration = computed(() => {
  if (!detail.value?.finishedAt) return ''
  const elapsed = Date.parse(detail.value.finishedAt) - Date.parse(detail.value.createdAt)
  return Number.isFinite(elapsed) && elapsed >= 0 ? `${(elapsed / 1000).toFixed(1)} 秒` : ''
})
let sequence = 0, active = true
async function refresh() {
  if (!active) return
  const request = ++sequence, identifier = props.job.jobId
  loading.value = true; error.value = ''
  try {
    const result = await runnerManagementApi.deploymentTaskDetail(identifier)
    if (result.jobId !== identifier) throw new Error('任务执行记录不匹配，请刷新重试')
    if (request === sequence) detail.value = result
  } catch (e) { if (request === sequence) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (request === sequence) loading.value = false }
}
watch([() => props.job.jobId, () => props.job.status, () => props.job.updatedAt, () => props.job.deliveryId], (value, previous) => {
  if (value[0] !== previous?.[0]) detail.value = null
  void refresh()
}, { immediate: true })
function suspend() { active = false; sequence++ }
onBeforeUnmount(suspend)
onDeactivated(suspend)
onActivated(() => { if (!active) { active = true; void refresh() } })
defineExpose({ refresh })
</script>

<template>
  <section class="deployment-task-process" data-testid="deployment-task-process">
    <header><strong>执行过程</strong><span v-if="duration">总耗时：{{ duration }}</span><el-button link :loading="loading" @click="refresh">刷新记录</el-button></header>
    <p v-if="detail?.finishedAt">任务已结束，以下为执行时保存的记录。</p>
    <el-alert v-if="error" :title="`执行记录读取失败：${error}`" type="warning" :closable="false" />
    <p v-else-if="loading && !detail" role="status">正在读取执行记录…</p>
    <p v-if="detail && !detail.historyAvailable">历史任务的部分准备过程未记录，以下展示已有记录。</p>
    <el-tabs v-model="activeTab" data-testid="deployment-task-detail-tabs">
    <el-tab-pane label="部署信息" name="info">
      <slot />
      <template v-if="detail">
      <ol><li v-for="event in detail.events" :key="event.eventId" :class="{ 'is-error': event.level === 'error' }"><div><time>{{ formatRunnerDateTime(event.time) }}</time><strong>{{ stages[event.stage] || event.stage }}</strong></div><p>{{ event.message }}</p><pre v-if="event.detail">{{ event.detail }}</pre></li></ol>
      <p v-if="!detail.events.length">暂无执行记录</p>
      </template>
    </el-tab-pane>
    <el-tab-pane label="过程输出" name="output"><pre class="deployment-process-output" data-testid="deployment-process-output">{{ output }}</pre></el-tab-pane>
    <el-tab-pane v-if="$slots.files" label="部署文件" name="files" lazy><slot name="files" /></el-tab-pane>
    </el-tabs>
  </section>
</template>

<style scoped>
.deployment-task-process{margin:16px 0;padding-top:12px;border-top:1px solid var(--el-border-color-lighter);font-size:12px}
header{display:flex;align-items:center;gap:12px;flex-wrap:wrap}header span,p,time{color:var(--el-text-color-secondary)}header .el-button{margin-left:auto}
ol{margin:12px 0 0;padding:0;list-style:none}li{margin-left:4px;padding:0 0 14px 12px;border-left:2px solid var(--el-border-color-lighter)}li>div{display:flex;gap:10px;flex-wrap:wrap}li p{margin:5px 0;white-space:pre-wrap;overflow-wrap:anywhere}
pre{margin:5px 0;white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;color:var(--el-text-color-secondary)}.is-error strong,.is-error p{color:var(--el-color-danger)}
.deployment-process-output{margin:8px 0;padding:12px;border:1px solid var(--el-border-color-lighter);border-radius:6px;background:var(--el-fill-color-light);color:var(--el-text-color-primary);font-family:Consolas,Monaco,monospace;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}
</style>
