<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useFlowStore } from '../../stores/flow'
import { useUiStore } from '../../stores/ui'
import { flowApi } from '../../api'
import { useRuntimeStore } from '../../stores/runtime'
import NodeLibrary from './NodeLibrary.vue'
import FlowBoard from './FlowBoard.vue'
import NodeInspector from './NodeInspector.vue'
import EdgeInspector from './EdgeInspector.vue'

const flow = useFlowStore()
const ui = useUiStore()
const runtime = useRuntimeStore()
const collapsed = ref(false)

async function onSave() {
  const res = await flowApi.flowSave(flow.serialize())
  ElMessage.success(res?.message || '流程已保存')
}
async function onPublish() {
  await flowApi.flowSave(flow.serialize())
  ElMessage.success('已保存并标记为发布候选（演示）')
}
function onTrial() {
  const runId = runtime.trial(flow.serialize())
  if (!runId) {
    ElMessage.warning('当前画布没有可试跑的节点')
    return
  }
  ElMessage.success(`已发起试跑 ${runId}，画布节点状态流转中 → 运行记录 / 数据查看`)
}

onMounted(async () => {
  // 启动恢复上次保存的流程（首次无保存则用内置种子流程）
  const saved = await flowApi.flowLoad(flow.flowId)
  if (saved) flow.load(saved)
  ui.registerAction('保存草稿', onSave)
  ui.registerAction('发布', onPublish)
  ui.registerAction('试跑', onTrial)
})
onUnmounted(() => ui.clearActions())
</script>

<template>
  <div class="rc-flow-shell" :class="{ collapsed }">
    <NodeLibrary v-model:collapsed="collapsed" />
    <FlowBoard />
    <EdgeInspector v-if="flow.activeKind === 'edge'" />
    <NodeInspector v-else />
  </div>
</template>

<style scoped>
.rc-flow-shell {
  display: grid;
  grid-template-columns: 250px minmax(620px, 1fr) 372px;
  gap: 12px;
  align-items: stretch;
  height: calc(100vh - 168px);
  min-height: 600px;
}
.rc-flow-shell.collapsed { grid-template-columns: 40px minmax(620px, 1fr) 372px; }

@media (max-width: 1240px) {
  .rc-flow-shell { grid-template-columns: 220px minmax(520px, 1fr); height: auto; }
  .rc-flow-shell.collapsed { grid-template-columns: 40px minmax(520px, 1fr); }
  .rc-flow-shell > :last-child { grid-column: 1 / -1; min-height: 520px; }
}
</style>
