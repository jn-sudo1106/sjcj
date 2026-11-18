<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { runnerManagementApi as api, type ModelInterface, type ModelInterfaceCall } from '@/api/runnerManagement'
import { formatRunnerDateTime } from '@/utils/format/runnerHeartbeat'
const props = defineProps<{ model: ModelInterface }>()
const emit = defineEmits<{ close: [] }>()
const open = ref(true), page = ref(1), rows = ref<ModelInterfaceCall[]>([]), total = ref(0), loading = ref(false), error = ref('')
const purposes = { generation: '生成脚本', test: '接口测试', 'prompt-edit': '修改提示词' }
const statuses = { running: '调用中', succeeded: '调用完成', failed: '调用失败', interrupted: '结果未确认' }
let sequence = 0
async function load() {
  const request = ++sequence, id = props.model.id
  loading.value = true; error.value = ''; rows.value = []
  try {
    const result = await api.modelInterfaceCalls(id, page.value)
    if (request !== sequence) return
    if (result.interfaceId !== id) throw new Error('调用记录与当前智能体不匹配')
    rows.value = result.items; total.value = result.total
  } catch (e) { if (request === sequence) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (request === sequence) loading.value = false }
}
watch(() => props.model.id, () => { page.value = 1; total.value = 0; void load() }, { immediate: true })
onBeforeUnmount(() => { sequence++ })
function taskLink(row: ModelInterfaceCall) { return { path: '/tasks', query: { tab: 'code-generation', codeTaskId: row.taskId, codeConfigId: row.configId || undefined } } }
</script>

<template>
  <el-drawer v-model="open" :title="`调用记录 · ${model.name}`" size="min(840px, 94vw)" append-to-body data-testid="model-calls-drawer" @closed="emit('close')">
    <div class="model-calls">
      <header><span>{{ model.endpoint }}<small v-if="model.cdpPort">智能体端口 {{ model.cdpPort }}</small></span><el-button :icon="Refresh" circle :loading="loading" aria-label="刷新调用记录" @click="load" /></header>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <p v-if="loading" role="status">正在读取调用记录…</p>
      <el-empty v-else-if="!error && !rows.length" description="暂无调用记录" />
      <article v-for="row in rows" :key="row.callId" class="model-call" data-testid="model-call-record">
        <div class="model-call-heading"><b>{{ purposes[row.purpose] || row.purpose }}</b><el-tag :type="row.status === 'failed' ? 'danger' : row.status === 'succeeded' ? 'success' : 'primary'" size="small">{{ statuses[row.status] }}</el-tag><time>{{ formatRunnerDateTime(row.startedAt) }}</time></div>
        <dl><div><dt>执行机器</dt><dd>{{ row.serverAddress || '未记录' }}</dd></div><div><dt>智能体端口 / 模型</dt><dd>{{ row.cdpPort ?? '未记录' }} · {{ row.model || '默认模型' }}</dd></div><div><dt>耗时</dt><dd>{{ row.durationMs === null ? row.status === 'running' ? '执行中' : '未记录' : `${(row.durationMs / 1000).toFixed(2)} 秒` }}</dd></div><div><dt>HTTP 状态</dt><dd>{{ row.httpStatus ?? '未记录' }}</dd></div><div class="wide"><dt>调用地址</dt><dd>{{ row.endpoint }}</dd></div><div v-if="row.taskId" class="wide"><dt>关联任务</dt><dd><RouterLink v-if="row.purpose === 'generation' && row.taskRecorded" :to="taskLink(row)" target="_blank" rel="noopener">{{ row.taskId }}</RouterLink><span v-else>{{ row.taskId }}</span><span v-if="row.configId"> · 配置 {{ row.configId }}</span></dd></div></dl>
        <p v-if="row.message" :class="{ failed: row.status === 'failed' }">{{ row.message }}</p>
        <small v-if="row.historical">由历史生成任务恢复</small>
      </article>
      <el-pagination v-if="total" v-model:current-page="page" :page-size="20" :total="total" layout="total, prev, pager, next" @current-change="load" />
    </div>
  </el-drawer>
</template>

<style scoped>
.model-calls{display:flex;flex-direction:column;gap:14px;min-width:0;font-size:13px}.model-calls>header{display:flex;align-items:center;justify-content:space-between;gap:12px}.model-calls>header span{overflow-wrap:anywhere;min-width:0}.model-calls small{display:block;margin-top:4px;color:var(--el-text-color-secondary);font-size:11px}.model-call{padding:12px 14px;border:1px solid var(--el-border-color-light);border-radius:8px}.model-call-heading{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.model-call time{margin-left:auto;color:var(--el-text-color-secondary);font-size:12px}.model-call dl{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:0}.model-call .wide{grid-column:1/-1}.model-call dt{font-size:11px;color:var(--el-text-color-secondary)}.model-call dd{margin:4px 0 0;overflow-wrap:anywhere}.model-call a{color:var(--el-color-primary);text-decoration:none}.model-call p{margin-bottom:0;white-space:pre-wrap;overflow-wrap:anywhere}.model-call p.failed{color:var(--el-color-danger)}@media(max-width:600px){.model-call dl{grid-template-columns:1fr}.model-call time{margin-left:0}}
</style>
