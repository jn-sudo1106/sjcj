<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { sourceIssueApi, type SourceIssue } from '@/api/sourceIssues'
import { useAuthStore } from '@/stores/auth'
import { localDateTime } from '@/utils/format/localDateTime'

const props = defineProps<{ modelValue: boolean; issueId: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; handled: []; openSource: [issue: SourceIssue] }>()
const auth = useAuthStore()
const issue = ref<SourceIssue | null>(null)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
let request = 0
onBeforeUnmount(() => { request++ })
async function load() {
  const seq = ++request
  issue.value = null
  error.value = ''
  if (!props.modelValue || !props.issueId) return
  loading.value = true
  try {
    const result = await sourceIssueApi.detail(props.issueId)
    if (seq === request) issue.value = result
  } catch (cause) {
    if (seq === request) error.value = (cause as Error)?.message || '问题详情加载失败'
  } finally {
    if (seq === request) loading.value = false
  }
}
watch(() => [props.modelValue, props.issueId], load, { immediate: true })
async function handle() {
  if (auth.role !== 'admin' || !issue.value || saving.value || issue.value.state === 1) return
  const id = issue.value.id
  saving.value = true
  try {
    const result = await sourceIssueApi.handle(id)
    if (props.issueId === id) issue.value = result
    ElMessage.success('已标记为已处理')
    emit('handled')
  } catch (cause) {
    ElMessage.error((cause as Error)?.message || '处理失败，请重试')
  } finally { saving.value = false }
}
</script>

<template>
  <el-drawer :model-value="modelValue" title="问题详情" size="480px" append-to-body class="source-issue-drawer" data-testid="source-issue-drawer" @update:model-value="emit('update:modelValue', $event)">
    <div v-loading="loading" class="sid-body">
      <div v-if="error" role="alert"><p>{{ error }}</p><el-button @click="load">重新加载</el-button></div>
      <template v-else-if="issue">
        <el-tag :type="issue.state === 0 ? 'warning' : 'success'" effect="light">{{ issue.state === 0 ? '待处理' : '已处理' }}</el-tag>
        <div class="sid-source"><button v-if="issue.sourceAvailable" class="sid-link" type="button" @click="emit('openSource', issue)">{{ issue.sourceName }}</button><span v-else>{{ issue.sourceName }}（已删除）</span><small>源 ID {{ issue.sourceId }}<template v-if="issue.siteName"> · {{ issue.siteName }}</template></small></div>
        <dl class="sid-meta"><div><dt>登记人</dt><dd>{{ issue.createdBy }}</dd></div><div><dt>登记时间</dt><dd>{{ localDateTime(issue.createTime) }}</dd></div><template v-if="issue.state === 1"><div><dt>处理人</dt><dd>{{ issue.handledBy || '—' }}</dd></div><div><dt>处理时间</dt><dd>{{ localDateTime(issue.handleTime) }}</dd></div></template></dl>
        <h3>问题描述</h3><p class="sid-description" data-testid="source-issue-full-description">{{ issue.description }}</p>
        <div class="sid-actions"><el-button v-if="issue.sourceAvailable" @click="emit('openSource', issue)">进入源工作区</el-button><el-button v-if="auth.role === 'admin' && issue.state === 0" type="primary" :loading="saving" data-testid="source-issue-detail-handle" @click="handle">标记已处理</el-button></div>
      </template>
    </div>
  </el-drawer>
</template>

<style scoped>
.sid-body { min-height: 100px; }
.sid-source { margin: 20px 0; padding: 12px; border-radius: 7px; background: var(--rc-bg); }
.sid-link { padding: 0; border: 0; background: transparent; color: var(--rc-primary); font: inherit; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
.sid-source small { display: block; margin-top: 5px; color: var(--rc-muted); }
.sid-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 20px 12px; }
.sid-meta dt { color: var(--rc-muted); font-size: 12px; }
.sid-meta dd { margin: 6px 0 0; font-size: 13px; overflow-wrap: anywhere; }
h3 { margin: 22px 0 0; padding-top: 18px; border-top: 1px solid var(--rc-border); font-size: 14px; }
.sid-description { line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; }
.sid-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 24px; }
.sid-actions :deep(.el-button + .el-button) { margin-left: 0; }
</style>
<style>
.source-issue-drawer { max-width: calc(100vw - 24px); }
</style>
