<script setup lang="ts">
import { ref, watch } from 'vue'
import { runnerManagementApi } from '@/api/runnerManagement'
const props = defineProps<{ configId?: string }>()
const enabled = ref(false), loading = ref(false), error = ref('')
let sequence = 0
async function load() {
  const owner = props.configId
  const current = ++sequence
  enabled.value = false; error.value = ''
  if (!owner) return
  loading.value = true
  try { const result = await runnerManagementApi.nodeGenerationSettings(owner); if (current === sequence) enabled.value = result.enabled }
  catch (e) { if (current === sequence) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (current === sequence) loading.value = false }
}
watch(() => props.configId, load, { immediate: true })
async function change() {
  const owner = props.configId, current = sequence
  if (!owner || loading.value) return false
  loading.value = true
  try { const result = await runnerManagementApi.saveNodeGenerationSettings({ configId: owner, enabled: !enabled.value }); if (current === sequence) { enabled.value = result.enabled; error.value = '' } }
  catch (e) { if (current === sequence) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (current === sequence) loading.value = false }
  return false
}
</script>
<template>
  <div class="rc-field" data-testid="source-code-generation-switch">
    <label>是否启用代码生成</label>
    <div><el-switch :model-value="enabled" :loading="loading" :disabled="!configId || !!error" :before-change="change" /><span class="generation-status">{{ enabled ? '已启用' : '未启用' }}</span></div>
    <small v-if="error" role="alert">加载或保存失败：{{ error }}<button type="button" @click="load">重新读取</button></small>
    <small v-else>{{ configId ? '自动保存。源列表生成任务时，按首节点开关检查，再执行已保存 AI 生成配置的节点。' : '请先保存节点配置。' }}</small>
  </div>
</template>
<style scoped>
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; }
.generation-status { margin-left: 8px; font-size: 12px; }
small { color: var(--rc-muted); line-height: 1.5; }
</style>
