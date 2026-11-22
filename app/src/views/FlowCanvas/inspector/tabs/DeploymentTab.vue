<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useFlowStore } from '@/stores/flow'
import { canvasFlowIdOf } from '@/stores/flowVersion'
import { configTypeFrom } from '@/utils/flow/nodeConfigPayload'
import { runnerManagementApi, type GeneratedCodeArchive } from '@/api/runnerManagement'
import { useNodeEditorContext } from '../nodeEditorContext'
import NodeDeploymentTargets from '../NodeDeploymentTargets.vue'

const props = defineProps<{ templateDefaults?: boolean }>()
const flow = useFlowStore(), { cfg, id, sourceId } = useNodeEditorContext()
const flowId = computed(() => canvasFlowIdOf(flow))
const configId = computed(() => cfg.value?.configId || '')
const configType = computed(() => cfg.value?.configType || String(cfg.value ? configTypeFrom(cfg.value) ?? '' : ''))
const queue = computed(() => cfg.value?.taskCfg?.queue?.trim() || (sourceId.value ? `${sourceId.value}_main` : ''))
const ready = computed(() => !props.templateDefaults && !!configId.value && !!sourceId.value && !!flowId.value && !!id.value)
const archive = ref<GeneratedCodeArchive | null>(null), error = ref(''), loading = ref(false)
let sequence = 0
onBeforeUnmount(() => { sequence++ })
async function loadArchive() {
  const seq = ++sequence; archive.value = null; error.value = ''
  if (!ready.value) return
  loading.value = true
  try {
    const result = await runnerManagementApi.generatedCodeState(configId.value, { sourceId: sourceId.value, flowId: flowId.value, stepId: id.value })
    if (seq === sequence) archive.value = result.archive?.status === 'committed' ? result.archive : null
  } catch (e) { if (seq === sequence) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (seq === sequence) loading.value = false }
}
watch(() => [sourceId.value, flowId.value, id.value, configId.value, ready.value], loadArchive, { immediate: true })
</script>

<template>
  <div data-testid="node-deployment-tab">
    <p v-if="templateDefaults">模板中不指定实际部署机器，请在源的流程节点中配置部署目标。</p>
    <p v-else-if="!ready">请先保存节点配置，并在具体源的流程中选择部署机器。</p>
    <NodeDeploymentTargets v-else :key="`${sourceId}:${flowId}:${id}:${configId}`" :source-id="sourceId" :flow-id="flowId" :step-id="id" :config-id="configId" :config-type="configType" :queue-name="queue" :archive-id="archive?.archiveId">
      <div class="deployment-code">
        <strong>当前源的生成代码</strong><el-button link :loading="loading" @click="loadArchive">刷新代码</el-button>
        <template v-if="archive"><div>Git 版本：{{ archive.gitCommit.slice(0, 12) }}</div><div v-for="file in archive.files" :key="file.path"><code>{{ file.path }}</code></div></template>
        <p v-else-if="!loading">暂无已归档的生成代码</p>
        <p v-if="error" role="alert">{{ error }}</p>
      </div>
    </NodeDeploymentTargets>
  </div>
</template>

<style scoped>
.deployment-code { margin-bottom:14px; padding:10px; background:var(--el-fill-color-light); border-radius:6px; font-size:12px; overflow-wrap:anywhere; }
.deployment-code div { margin-top:6px; }
[role=alert] { color:var(--el-color-danger); }
</style>
