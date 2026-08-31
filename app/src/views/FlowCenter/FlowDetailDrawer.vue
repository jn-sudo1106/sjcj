<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { flowCenterApi, type FlowDefinition, type FlowRecord } from '@/api'
import { useFlowStore } from '@/stores/flow'
import FlowBoard from '@/views/FlowCanvas/canvas/FlowBoard.vue'
import NodeInspector from '@/views/FlowCanvas/inspector/NodeInspector.vue'

const props = defineProps<{ flow: FlowRecord | null }>()
const emit = defineEmits<{
  close: []
  saved: [flow: FlowRecord]
  apply: [flow: FlowRecord]
}>()

const canvas = useFlowStore()
const name = ref('')
const saving = ref(false)

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function definitionFromCanvas(): FlowDefinition {
  return {
    main: [...canvas.main],
    branches: clone(canvas.branches),
    configs: clone(canvas.configs),
    branchGroups: clone(canvas.branchGroups),
  }
}

function loadIntoWorkspace(flow: FlowRecord) {
  name.value = flow.name
  canvas.clearSourceCtx()
  canvas.clearSiteCtx()
  canvas.load({
    id: flow.id,
    name: flow.name,
    version: `flow-v${flow.version}`,
    main: flow.definition.main,
    branches: flow.definition.branches,
    configs: flow.definition.configs,
    branchGroups: flow.definition.branchGroups,
    updatedAt: flow.updatedAt,
  })
  const firstNode = flow.definition.main.find((id) => id !== 'start' && id !== 'end' && flow.definition.configs[id])
  canvas.select(firstNode ?? '')
  canvas.markSaved()
}

watch(() => props.flow, (flow) => {
  if (flow) loadIntoWorkspace(flow)
}, { immediate: true })

async function persistFlow(showMessage = true): Promise<FlowRecord | null> {
  if (!props.flow || saving.value) return null
  const trimmed = name.value.trim()
  if (!trimmed) {
    ElMessage.warning('请输入流程名称')
    return null
  }
  saving.value = true
  try {
    const saved = await flowCenterApi.save({
      id: props.flow.id,
      name: trimmed,
      definition: definitionFromCanvas(),
    })
    name.value = saved.name
    canvas.markSaved()
    emit('saved', saved)
    if (showMessage) ElMessage.success(`流程已保存为 v${saved.version}`)
    return saved
  } catch (error) {
    ElMessage.error(`流程保存失败：${(error as Error)?.message ?? String(error)}`)
    return null
  } finally {
    saving.value = false
  }
}

async function applyToSource() {
  const saved = canvas.dirty || name.value.trim() !== props.flow?.name
    ? await persistFlow(false)
    : props.flow
  if (saved) emit('apply', saved)
}
</script>

<template>
  <aside v-if="flow" class="fd-drawer" aria-label="流程工作区">
    <header class="fd-head">
      <div class="fd-title">
        <span class="fd-kicker">流程工作区</span>
        <input v-model="name" class="fd-name" aria-label="流程名称" @input="canvas.setFlowName(name)" />
        <p>{{ flow.id }} · v{{ flow.version }} · 更新于 {{ flow.updatedAt || '—' }}</p>
      </div>
      <button class="fd-close" type="button" title="关闭" @click="emit('close')">✕</button>
    </header>

    <div class="fd-workspace">
      <section class="fd-canvas" aria-label="流程节点">
        <FlowBoard embedded />
      </section>
      <section class="fd-inspector" aria-label="节点设置">
        <NodeInspector hide-ai />
      </section>
    </div>

    <footer class="fd-foot">
      <span class="fd-foot-note">节点配置在右侧直接修改；应用到源时会全量替换原流程。</span>
      <button class="fd-secondary" type="button" :disabled="saving" data-testid="flow-apply-to-source" @click="applyToSource">应用到源</button>
      <button class="fd-primary" type="button" :disabled="saving" data-testid="flow-save" @click="persistFlow()">{{ saving ? '保存中…' : '保存流程' }}</button>
    </footer>
  </aside>
</template>

<style scoped>
.fd-drawer { position: fixed; top: 56px; right: 0; bottom: 0; width: min(980px, calc(100vw - 256px)); max-width: 100vw; z-index: 40; display: flex; flex-direction: column; background: #fff; border-left: 1px solid var(--rc-border); box-shadow: -12px 0 32px -24px rgba(15, 23, 42, 0.48); }
.fd-head { display: flex; align-items: flex-start; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--rc-border-soft); }
.fd-title { min-width: 0; }
.fd-kicker { display: block; color: var(--rc-muted); font-size: 11px; }
.fd-name { display: block; width: min(520px, 70vw); margin: 2px 0 3px; padding: 0; border: 0; outline: 0; background: transparent; color: var(--rc-text); font-size: 15px; font-weight: 700; }
.fd-name:focus { box-shadow: inset 0 -1px 0 var(--rc-primary); }
.fd-title p { margin: 0; color: var(--rc-faint); font-size: 11px; font-variant-numeric: tabular-nums; }
.fd-close { margin-left: auto; border: 0; background: transparent; color: var(--rc-faint); font-size: 14px; cursor: pointer; }
.fd-close:hover { color: var(--rc-text); }
.fd-workspace { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(340px, 42%) minmax(420px, 1fr); gap: 10px; padding: 10px; background: #f4f7fb; }
.fd-canvas, .fd-inspector { min-width: 0; min-height: 0; }
.fd-foot { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--rc-border-soft); }
.fd-foot-note { flex: 1; color: var(--rc-faint); font-size: 11px; }
.fd-primary, .fd-secondary { height: 32px; padding: 0 14px; border-radius: 7px; font-size: 12px; font-weight: 600; cursor: pointer; }
.fd-primary { border: 1px solid var(--rc-primary); background: var(--rc-primary); color: #fff; }
.fd-secondary { border: 1px solid #bfdbfe; background: #fff; color: var(--rc-primary-ink); }
.fd-primary:disabled, .fd-secondary:disabled { opacity: .55; cursor: not-allowed; }
@media (max-width: 980px) {
  .fd-drawer { width: 100vw; }
  .fd-workspace { grid-template-columns: minmax(320px, 44%) minmax(360px, 1fr); overflow-x: auto; }
}
</style>
