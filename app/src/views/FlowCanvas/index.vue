<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useFlowStore } from '../../stores/flow'
import { useUiStore } from '../../stores/ui'
import { flowApi, sourceApi } from '../../api'
import { useRuntimeStore } from '../../stores/runtime'
import NodeLibrary from './NodeLibrary.vue'
import FlowBoard from './FlowBoard.vue'
import NodeInspector from './NodeInspector.vue'
import EdgeInspector from './EdgeInspector.vue'
import ResultView from './ResultView.vue'

const route = useRoute()
const flow = useFlowStore()
const ui = useUiStore()
const runtime = useRuntimeStore()
const collapsed = ref(false)
const isDataView = computed(() => route.query.view === 'data' && !!flow.sourceCtx)

async function loadSourceFlow(sourceId: string) {
  const [source, steps] = await Promise.all([
    sourceApi.sourceDetail(sourceId),
    sourceApi.sourceSteps(sourceId),
  ])
  if (source) flow.loadFromSource(source, steps ?? [])
}

async function onSave() {
  const res = await flowApi.flowSave(flow.serialize())
  flow.markSaved()
  ElMessage.success(res?.message || '流程已保存')
}
async function onPublish() {
  const errs = flow.validateFlow()
  if (errs.length) {
    ElMessage.warning(`发布前请修正：${errs[0]}${errs.length > 1 ? ` 等 ${errs.length} 项` : ''}`)
    return
  }
  await flowApi.flowSave(flow.serialize())
  flow.markSaved()
  ElMessage.success('已保存并标记为发布候选（演示）')
}
function onTrial() {
  if (runtime.running) {
    ElMessage.warning('已有试跑正在进行，请稍候')
    return
  }
  const runId = runtime.trial(flow.serialize())
  if (!runId) {
    ElMessage.warning('当前画布没有可试跑的节点（已停用 / 规划中 / 缺 URL 或输出表的采集节点会被跳过）')
    return
  }
  ElMessage.success(`已发起试跑 ${runId}，画布节点状态流转中 → 运行记录 / 数据查看`)
}

onMounted(async () => {
  const sourceId = String(route.query.sourceId ?? '')
  if (sourceId) {
    collapsed.value = true
    await loadSourceFlow(sourceId)
  } else {
    // 默认进画布即空白：源详情通过侧栏导回时也走这条路径
    flow.newFlow('blank')
  }
  ui.registerAction('保存草稿', onSave)
  ui.registerAction('发布', onPublish)
  ui.registerAction('试跑', onTrial)
})
watch(
  () => route.query.sourceId,
  async (nv, ov) => {
    if (nv === ov) return
    const sid = String(nv ?? '')
    if (sid) {
      collapsed.value = true
      await loadSourceFlow(sid)
    } else {
      flow.newFlow('blank')
    }
  },
)
onUnmounted(() => {
  ui.clearActions()
  flow.clearSourceCtx()
})
</script>

<template>
  <ResultView v-if="isDataView" class="rc-flow-result" />
  <div v-else class="rc-flow-shell" :class="{ collapsed, 'source-mode': !!flow.sourceCtx }">
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
.rc-flow-shell.source-mode { grid-template-columns: 250px minmax(560px, 1fr) 480px; }
.rc-flow-shell.source-mode.collapsed { grid-template-columns: 40px minmax(560px, 1fr) 480px; }
.rc-flow-result { height: calc(100vh - 168px); min-height: 600px; }

@media (max-width: 1240px) {
  .rc-flow-shell { grid-template-columns: 220px minmax(520px, 1fr); height: auto; }
  .rc-flow-shell.collapsed { grid-template-columns: 40px minmax(520px, 1fr); }
  .rc-flow-shell.source-mode { grid-template-columns: 220px minmax(480px, 1fr); }
  .rc-flow-shell.source-mode.collapsed { grid-template-columns: 40px minmax(480px, 1fr); }
  .rc-flow-shell > :last-child { grid-column: 1 / -1; min-height: 520px; }
}
</style>
