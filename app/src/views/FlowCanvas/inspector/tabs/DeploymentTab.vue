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
const filesExpanded = ref(false)
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
watch(() => [sourceId.value, flowId.value, id.value, configId.value, ready.value], () => {
  filesExpanded.value = false
  void loadArchive()
}, { immediate: true })
</script>

<template>
  <div class="deployment-tab" data-testid="node-deployment-tab">
    <p v-if="templateDefaults" class="dt-empty-notice">模板中不指定实际部署机器，请在源的流程节点中配置部署目标。</p>
    <p v-else-if="!ready" class="dt-empty-notice">请先保存节点配置，并在具体源的流程中选择部署机器。</p>
    <NodeDeploymentTargets
      v-else
      :key="`${sourceId}:${flowId}:${id}:${configId}`"
      :source-id="sourceId"
      :flow-id="flowId"
      :step-id="id"
      :config-id="configId"
      :config-type="configType"
      :queue-name="queue"
      :archive-id="archive?.archiveId"
      :archive-commit="archive?.gitCommit"
      :archive-loading="loading"
      @refresh-archive="loadArchive"
    >
      <div class="deployment-code">
        <div class="dc-row">
          <span class="dc-label">最新代码</span>
          <template v-if="archive">
            <code class="dc-commit" :title="archive.gitCommit">{{ archive.gitCommit.slice(0, 12) }}</code>
            <button
              v-if="archive.files.length"
              type="button"
              class="dc-toggle"
              @click="filesExpanded = !filesExpanded"
            >
              {{ archive.files.length }} 个文件 {{ filesExpanded ? '▴' : '▾' }}
            </button>
          </template>
          <span v-else-if="loading" class="dc-muted">加载中…</span>
          <span v-else class="dc-muted">暂无已归档代码</span>
        </div>
        <div v-if="archive && archive.files.length" v-show="filesExpanded" class="dc-files">
          <div v-for="file in archive.files" :key="file.path" class="dc-file">
            <code :title="file.path">{{ file.path }}</code>
          </div>
        </div>
        <p v-if="error" role="alert" class="dc-error">{{ error }}</p>
      </div>
    </NodeDeploymentTargets>
  </div>
</template>

<style scoped>
.deployment-tab { min-width: 0; }
.dt-empty-notice { margin: 0; padding: 10px 12px; border-radius: 6px; background: var(--el-fill-color-light); color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.5; }
.deployment-code { display: grid; gap: 6px; font-size: 12px; min-width: 0; }
.dc-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.dc-label { color: var(--el-text-color-secondary); white-space: nowrap; }
.dc-commit { padding: 1px 6px; border-radius: 4px; background: var(--el-fill-color); color: var(--el-text-color-primary); font-size: 11px; }
.dc-toggle { border: 0; background: transparent; padding: 0; color: var(--el-color-primary); font-size: 11px; cursor: pointer; white-space: nowrap; }
.dc-toggle:hover { text-decoration: underline; }
.dc-muted { color: var(--el-text-color-secondary); font-size: 11px; }
.dc-files { display: grid; gap: 3px; padding: 6px 8px; border-radius: 6px; background: var(--el-fill-color-light); }
.dc-file code { display: block; font-size: 11px; color: var(--el-text-color-regular); overflow-wrap: anywhere; }
.dc-error { margin: 0; color: var(--el-color-danger); font-size: 11px; }
</style>
