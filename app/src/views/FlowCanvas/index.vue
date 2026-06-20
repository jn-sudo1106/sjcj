<script setup lang="ts">
import { ref } from 'vue'
import { useFlowStore } from '../../stores/flow'
import NodeLibrary from './NodeLibrary.vue'
import FlowBoard from './FlowBoard.vue'
import NodeInspector from './NodeInspector.vue'
import EdgeInspector from './EdgeInspector.vue'

const flow = useFlowStore()
const collapsed = ref(false)
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
