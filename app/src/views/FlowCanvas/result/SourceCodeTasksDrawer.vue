<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { sourceApi, flowCenterApi, type Source } from '@/api'
import { runnerManagementApi, type SourceCodeTask, type SourceGenerationSnapshot } from '@/api/runnerManagement'
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ sources: Source[] }>()
const rows = ref<SourceCodeTask[]>([]), error = ref(''), creating = ref(false), loading = ref(false)
const skipped = ref<{ sourceId: string; name: string; reason: string }[]>([])
const labels = { queued: '待生成', running: '生成中', succeeded: '已完成', failed: '失败' }
let timer: ReturnType<typeof setTimeout> | undefined, request = 0
async function refresh() {
  const seq = ++request
  loading.value = true
  try { const result = await runnerManagementApi.sourceCodeTasks(); if (seq === request) { rows.value = result; error.value = '' } }
  catch (e) { if (seq === request) error.value = e instanceof Error ? e.message : String(e) }
  finally {
    if (seq === request) {
      loading.value = false
      if (timer) clearTimeout(timer)
      if (open.value) timer = setTimeout(() => void refresh(), 4000)
    }
  }
}
async function create() {
  if (creating.value || !props.sources.length) return
  creating.value = true; error.value = ''; skipped.value = []
  const snapshots: SourceGenerationSnapshot[] = [], failures: typeof skipped.value = []
  // Bound concurrency: each source detail is read freshly; cache only the flow topology within this submission.
  const flows = new Map<string, Awaited<ReturnType<typeof flowCenterApi.steps>>>()
  try {
    for (const selected of props.sources) {
      try {
        const source = await sourceApi.sourceDetail(selected.sourceId)
        if (!source) throw new Error('源不存在或已删除')
        const flowId = source.defaultFlowId || source.flowId
        if (!flowId || flowId === '0') throw new Error('源没有生效的默认流程')
        let nodes = flows.get(flowId)
        if (!nodes) { nodes = await flowCenterApi.steps(flowId, { withConfigDetails: false }); flows.set(flowId, nodes) }
        snapshots.push({ sourceId: source.sourceId, name: source.name, url: source.url, flowId,
          nodes: nodes.map(node => ({ configId: node.configId, name: node.name, isRoot: node.isRoot, enabled: node.enabled })) })
      } catch (e) { failures.push({ sourceId: selected.sourceId, name: selected.name, reason: e instanceof Error ? e.message : String(e) }) }
    }
    if (snapshots.length) {
      const result = await runnerManagementApi.createSourceCodeTasks(snapshots)
      skipped.value = [...failures, ...result.skipped]
      ElMessage.success(`已创建 ${result.created.length} 个代码生成任务`)
    } else skipped.value = failures
    await refresh()
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); skipped.value = failures }
  finally { creating.value = false }
}
watch(open, value => { if (timer) clearTimeout(timer); if (value) void refresh(); else { request++; loading.value = false } }, { immediate: true })
onBeforeUnmount(() => { request++; if (timer) clearTimeout(timer) })
const time = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
</script>
<template>
  <el-drawer v-model="open" title="代码生成任务" size="min(1000px, 96vw)" append-to-body destroy-on-close>
    <div class="generation-toolbar"><span>已选择 {{ sources.length }} 个源</span><el-button type="primary" :loading="creating" :disabled="!sources.length || sources.length > 200" @click="create">为选中源创建任务</el-button><el-button :loading="loading" @click="refresh">刷新</el-button></div>
    <p class="generation-note">按生效的默认流程检查首个配置节点。需先启用代码生成，并在相应节点 AI 工作区保存生成配置。任务提交后在后台执行。</p>
    <p v-if="sources.length > 200" role="alert">每次最多选择 200 个源。</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <details v-if="skipped.length" open><summary>跳过或读取失败 {{ skipped.length }} 项</summary><p v-for="(item, index) in skipped" :key="index">{{ item.name }}（{{ item.sourceId }}）：{{ item.reason }}</p></details>
    <el-table :data="rows" empty-text="暂无代码生成任务" style="width: 100%">
      <el-table-column label="源 / 流程" min-width="155"><template #default="{ row }"><strong>{{ row.sourceName }}</strong><div>{{ row.sourceId }} / {{ row.flowId }}</div></template></el-table-column>
      <el-table-column label="配置节点" min-width="145"><template #default="{ row }">{{ row.nodeName }}<div>配置 {{ row.configId }}</div></template></el-table-column>
      <el-table-column label="状态" width="80"><template #default="{ row }">{{ labels[row.status as SourceCodeTask['status']] }}</template></el-table-column>
      <el-table-column label="创建时间" width="165"><template #default="{ row }">{{ time(row.createdAt) }}</template></el-table-column>
      <el-table-column label="结果" min-width="180"><template #default="{ row }"><span>{{ row.message || '等待执行' }}</span><div v-if="row.gitCommit">Git {{ row.gitCommit.slice(0, 12) }}</div><small :title="row.taskId">任务 {{ row.taskId.slice(0, 12) }}</small></template></el-table-column>
    </el-table>
    <p class="generation-note">展示最近 200 条任务；相同源、流程和配置的待处理任务不会重复创建。</p>
  </el-drawer>
</template>
<style scoped>.generation-toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; } .generation-note, small { color: var(--rc-muted); font-size: 12px; line-height: 1.6; } details { margin: 12px 0; font-size: 12px; } details p { margin: 5px 0; } strong { font-weight: 500; }</style>
