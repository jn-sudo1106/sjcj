<script setup lang="ts">
import { computed } from 'vue'
import CanvasHeader from '@/views/FlowCanvas/shared/CanvasHeader.vue'
import AlertConfigPanel from '@/views/FlowCanvas/inspector/AlertConfigPanel.vue'
import { useFlowStore } from '@/stores/flow'
import { isMonitorNode } from '@/views/FlowCanvas/canvas/flowModel'
import type { MonitorAlertConfig } from '@/views/FlowCanvas/canvas/flowModel'

const flow = useFlowStore()
const cfg = computed(() => flow.selectedNode)
const id = computed(() => flow.selectedId)
const sourceLabel = computed(() => {
  const sourceName = flow.sourceCtx?.name ?? ''
  const table = cfg.value?.collectCfg?.inputTable?.trim()
    || cfg.value?.inputTable?.trim()
    || cfg.value?.ruleCfg?.inputTable?.trim()
    || cfg.value?.ruleCfg?.inputTableId?.trim()
    || ''
  return [sourceName, table].filter(Boolean).join(' / ')
})
const scriptPath = computed(() => cfg.value?.ruleCfg?.scriptPath ?? '')
const isMonitor = computed(() => isMonitorNode(cfg.value))

function setAlertConfig(config: MonitorAlertConfig) {
  if (!id.value) return
  flow.setMonitorAlertConfig(id.value, config)
}
</script>

<template>
  <main class="mcv-shell">
    <CanvasHeader />
    <div class="mcv-body">
      <AlertConfigPanel
        v-if="isMonitor"
        :node-id="id"
        :node-title="cfg?.title ?? ''"
        :source-label="sourceLabel"
        :script-path="scriptPath"
        @update:alert-config="setAlertConfig"
      />
      <!-- 页签常驻（0917）后，这一档在选中非数据监控节点时也会被点开：先说清"当前这个节点不是监控节点"，
           再给下一步动作，别只丢一句"请选择数据监控节点"让人以为是页面坏了。 -->
      <div v-else class="mcv-empty">
        当前节点不是数据监控节点，请选择数据监控节点后配置监控告警。
      </div>
    </div>
  </main>
</template>

<style scoped>
.mcv-shell { display: flex; flex-direction: column; height: 100%; overflow: hidden; background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); }
.mcv-body { flex: 1; min-height: 0; overflow: auto; padding: 12px; }
.mcv-empty { padding: 40px 12px; color: var(--rc-faint); font-size: 12px; text-align: center; }
</style>
