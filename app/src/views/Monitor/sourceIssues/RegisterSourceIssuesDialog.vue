<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { SOURCE_ISSUE_BATCH_LIMIT, sourceIssueApi, type SourceIssue, type SourceIssueSource } from '@/api/sourceIssues'
import { readLoginUsername } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ sources: SourceIssueSource[] }>()
const emit = defineEmits<{ close: []; registered: [records: SourceIssue[]] }>()
const auth = useAuthStore()
const targets = computed(() => [...new Map(props.sources.map(source => [source.sourceId, source])).values()])
const overLimit = computed(() => targets.value.length > SOURCE_ISSUE_BATCH_LIMIT)
const description = ref('')
const saving = ref(false)
const error = ref('')
// 以登录接口返回的会话账号为准，与服务端登记人一致。
const account = computed(() => auth.name || readLoginUsername() || '当前账号')

function close() {
  if (!saving.value) emit('close')
}
async function submit() {
  if (saving.value || overLimit.value) return
  if (!description.value.trim()) { error.value = '请填写问题描述'; return }
  if (!targets.value.length) { error.value = '请先选择源'; return }
  saving.value = true
  error.value = ''
  try {
    const records = await sourceIssueApi.create({ sourceIds: targets.value.map(source => source.sourceId), description: description.value.trim() })
    ElMessage.success(`已为 ${records.length} 个源分别登记问题`)
    emit('registered', records)
    emit('close')
  } catch (cause) {
    error.value = (cause as Error)?.message || '未能确认登记结果，请先到台账核对。'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="true" title="登记问题" width="520px" class="source-issue-register" append-to-body :show-close="!saving" :close-on-click-modal="false" :close-on-press-escape="!saving" data-testid="source-issue-register-dialog" @update:model-value="close">
    <div class="sir-body">
      <p class="sir-summary">已选 {{ targets.length }} 个源<span v-if="targets.length > 1"> · 同一描述分别登记，每条问题可独立处理</span></p>
      <ul class="sir-sources" aria-label="本次登记的源">
        <li v-for="source in targets" :key="source.sourceId"><span>{{ source.sourceName }}</span><small>{{ source.sourceId }}</small></li>
      </ul>
      <label class="sir-label" for="source-issue-description">问题描述 <span>*</span></label>
      <el-input id="source-issue-description" type="textarea" v-model="description" class="sir-description" aria-label="问题描述" :disabled="saving" maxlength="1000" :rows="5" resize="vertical" placeholder="描述发现的问题，例如：网站已更新，但平台连续两天没有新增数据。" data-testid="source-issue-description" @input="error = ''" />
      <div class="sir-meta"><span>登记账号：{{ account }}</span><span>登记时间：提交时自动记录</span></div>
      <p v-if="error" class="sir-error" role="alert" data-testid="source-issue-register-error">{{ error }}</p>
      <p v-if="overLimit" class="sir-error" role="alert">单次最多登记 {{ SOURCE_ISSUE_BATCH_LIMIT }} 个源，请减少选择后提交。</p>
    </div>
    <template #footer>
      <el-button :disabled="saving" @click="close">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!targets.length || overLimit" data-testid="source-issue-register-submit" @click="submit">{{ targets.length > 1 ? `登记 ${targets.length} 条问题` : '登记' }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.sir-body { max-height: calc(100vh - 250px); overflow-y: auto; }
.sir-summary { margin: 0; font-size: 13px; color: var(--rc-text); }
.sir-summary span { color: var(--rc-muted); font-size: 12px; }
.sir-sources { display: grid; gap: 8px; margin: 14px 0 20px; padding: 0; list-style: none; }
.sir-sources li { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; }
.sir-sources li span { overflow-wrap: anywhere; }
.sir-sources small { flex-shrink: 0; color: var(--rc-muted); font-size: 11px; }
.sir-label { display: block; margin-bottom: 8px; font-size: 13px; }
.sir-label span, .sir-error { color: var(--rc-error); }
.sir-description { width: 100%; }
.sir-meta { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-top: 12px; color: var(--rc-muted); font-size: 12px; }
.sir-error { font-size: 12px; margin: 10px 0 0; }
</style>
<style>
.el-dialog.source-issue-register { max-width: calc(100vw - 32px); margin-top: 8vh; }
</style>
