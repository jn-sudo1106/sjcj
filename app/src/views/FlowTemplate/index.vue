<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { flowTemplateApi, type FlowTemplate, type FlowTemplateDefinition, type Site, type Source } from '../../api'
import { useFlowStore } from '../../stores/flow'
import { useUiStore } from '../../stores/ui'
import FlowBoard from '@/views/FlowCanvas/canvas/FlowBoard.vue'
import NodeInspector from '@/views/FlowCanvas/inspector/NodeInspector.vue'
import { makeBlankTemplateDefinition } from '@/utils/flow/flowTemplates'
import type { FlowDef } from '@/views/FlowCanvas/canvas/flowModel'

type FlowSnapshot = {
  definition: FlowDef
  sourceCtx: Source | null
  siteCtx: Site | null
  selectedId: string
  activeTab: string
  dirty: boolean
}

const flow = useFlowStore()
const ui = useUiStore()
const templates = ref<FlowTemplate[]>([])
const draft = ref<FlowTemplate | null>(null)
const loading = ref(false)
const saving = ref(false)
const snapshot = ref<FlowSnapshot | null>(null)

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function templateDefinitionFromCanvas(): FlowTemplateDefinition {
  return {
    main: [...flow.main],
    branches: clone(flow.branches),
    configs: clone(flow.configs),
    branchGroups: clone(flow.branchGroups),
  }
}

function captureFlowSnapshot() {
  if (snapshot.value) return
  snapshot.value = {
    definition: flow.serialize(),
    sourceCtx: flow.sourceCtx ? clone(flow.sourceCtx) : null,
    siteCtx: flow.siteCtx ? clone(flow.siteCtx) : null,
    selectedId: flow.selectedId,
    activeTab: flow.activeTab,
    dirty: flow.dirty,
  }
}

function loadTemplateIntoCanvas(template: FlowTemplate) {
  captureFlowSnapshot()
  flow.clearSourceCtx()
  flow.clearSiteCtx()
  flow.load({
    id: `template:${template.id}`,
    name: template.name,
    version: `template-v${template.version}`,
    main: template.definition.main,
    branches: template.definition.branches,
    configs: template.definition.configs,
    branchGroups: template.definition.branchGroups,
    updatedAt: template.updatedAt,
  })
}

function replaceTemplateInList(saved: FlowTemplate) {
  templates.value = [
    saved,
    ...templates.value.filter((template) => template.id !== saved.id),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

async function loadTemplates(selectId = draft.value?.id) {
  loading.value = true
  try {
    templates.value = await flowTemplateApi.list()
    const selected = templates.value.find((template) => template.id === selectId) ?? templates.value[0]
    if (selected) await selectTemplate(selected)
  } finally {
    loading.value = false
  }
}

async function selectTemplate(template: FlowTemplate) {
  if (draft.value?.id !== template.id && flow.dirty) {
    try {
      await ElMessageBox.confirm('当前模板有未保存改动，切换后将丢失这些改动。是否继续？', '切换流程模板', {
        type: 'warning', confirmButtonText: '切换', cancelButtonText: '取消',
      })
    } catch {
      return
    }
  }
  const detail = await flowTemplateApi.detail(template.id)
  if (!detail) return
  draft.value = detail
  loadTemplateIntoCanvas(detail)
}

async function createTemplate() {
  try {
    const { value } = await ElMessageBox.prompt('新模板会以完整的节点默认配置作为子源的可编辑起点。', '新建流程模板', {
      inputValue: '未命名模板',
      inputPattern: /\S+/,
      inputErrorMessage: '请输入模板名称',
      confirmButtonText: '新建',
      cancelButtonText: '取消',
    })
    const created = await flowTemplateApi.save({ name: value.trim(), definition: makeBlankTemplateDefinition() })
    draft.value = created
    replaceTemplateInList(created)
    loadTemplateIntoCanvas(created)
    ElMessage.success('已新建流程模板')
  } catch {
    // 用户取消新建不提示。
  }
}

async function renameTemplate(template: FlowTemplate) {
  try {
    const { value } = await ElMessageBox.prompt('重命名会生成该模板的新版本；已绑定子源仍固定使用原版本。', '重命名流程模板', {
      inputValue: template.name,
      inputPattern: /\S+/,
      inputErrorMessage: '请输入模板名称',
      confirmButtonText: '保存新版本',
      cancelButtonText: '取消',
    })
    const detail = await flowTemplateApi.detail(template.id)
    if (!detail) return
    const saved = await flowTemplateApi.save({ id: detail.id, name: value.trim(), definition: detail.definition })
    replaceTemplateInList(saved)
    if (draft.value?.id === saved.id) {
      draft.value = saved
      loadTemplateIntoCanvas(saved)
    }
    ElMessage.success(`已保存为 v${saved.version}`)
  } catch {
    // 用户取消重命名不提示。
  }
}

function onNameInput() {
  if (draft.value) flow.setFlowName(draft.value.name)
}

async function saveTemplate() {
  if (!draft.value) return
  if (!draft.value.name.trim()) {
    ElMessage.warning('请输入模板名称')
    return
  }
  saving.value = true
  try {
    const saved = await flowTemplateApi.save({
      id: draft.value.id,
      name: draft.value.name.trim(),
      definition: templateDefinitionFromCanvas(),
    })
    draft.value = saved
    replaceTemplateInList(saved)
    loadTemplateIntoCanvas(saved)
    ElMessage.success(`模板已保存为 v${saved.version}；子源仍可独立修改配置`)
  } finally {
    saving.value = false
  }
}

onMounted(() => { void loadTemplates() })

onBeforeUnmount(() => {
  const saved = snapshot.value
  if (!saved) return
  flow.clearSourceCtx()
  flow.clearSiteCtx()
  flow.load(saved.definition)
  flow.sourceCtx = saved.sourceCtx ? clone(saved.sourceCtx) : null
  flow.siteCtx = saved.siteCtx ? clone(saved.siteCtx) : null
  flow.selectedId = saved.selectedId
  flow.setActiveTab(saved.activeTab)
  flow.dirty = saved.dirty
})
</script>

<template>
  <div class="ft-page" v-loading="loading">
    <aside class="ft-list" aria-label="流程模板列表">
      <div class="ft-list-head">
        <div>
          <div class="ft-eyebrow">可复用流程</div>
          <h2>流程模板</h2>
        </div>
        <button class="rc-btn primary" type="button" @click="createTemplate">＋ 新建</button>
      </div>
      <p class="ft-hint">模板提供完整的节点默认配置；应用后，子源可继续按自己的 URL、表、参数和运行设置修改。</p>
      <div v-for="template in templates" :key="template.id" class="ft-item" :class="{ on: draft?.id === template.id }">
        <button class="ft-item-select" type="button" :aria-current="draft?.id === template.id || undefined" @click="selectTemplate(template)">
          <strong>{{ template.name }}</strong>
          <small>v{{ template.version }} · {{ template.updatedAt }}</small>
        </button>
        <button class="ft-item-rename" type="button" @click="renameTemplate(template)">重命名</button>
      </div>
    </aside>

    <main class="ft-editor">
      <template v-if="draft">
        <div class="ft-editor-head">
          <div>
            <div class="ft-eyebrow">模板 {{ draft.id }} · 当前 v{{ draft.version }}</div>
            <input v-model="draft.name" class="ft-name" aria-label="模板名称" @input="onNameInput" />
          </div>
          <div class="ft-editor-actions">
            <span>在画布中添加、移动节点；在右侧编辑节点配置</span>
            <button class="rc-btn primary" type="button" :disabled="saving" @click="saveTemplate">{{ saving ? '保存中…' : '保存为新版本' }}</button>
          </div>
        </div>

        <div class="ft-boundary">
          <strong>模板编辑</strong>
          <span>画布和右侧配置与流程视图一致。这里配置的是默认值，子源应用模板后可独立改写，不会反向修改模板。</span>
        </div>

        <div class="ft-flow-shell" :class="{ expanded: ui.inspectorExpanded }">
          <FlowBoard />
          <div class="ft-insp-splitter" aria-hidden="true" />
          <NodeInspector />
        </div>
      </template>
      <div v-else class="ft-empty">从左侧选择一个模板，或新建模板开始编排。</div>
    </main>
  </div>
</template>

<style scoped>
.ft-page { display: grid; grid-template-columns: 280px minmax(0, 1fr); height: 100%; min-height: 600px; border: 1px solid var(--rc-border); border-radius: 12px; overflow: hidden; background: #fff; }
.ft-list { min-height: 0; overflow: auto; padding: 18px 14px; background: #f8fafc; border-right: 1px solid var(--rc-border); }
.ft-list-head, .ft-editor-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ft-list h2 { margin: 2px 0 0; font-size: 17px; }
.ft-eyebrow { color: var(--rc-faint); font-size: 11px; }
.ft-hint { margin: 14px 0; color: var(--rc-muted); font-size: 12px; line-height: 1.55; }
.ft-item { display: flex; align-items: center; gap: 6px; margin: 6px 0; border: 1px solid transparent; border-radius: 8px; }
.ft-item:hover, .ft-item.on { border-color: #bfdbfe; background: var(--rc-primary-bg); }
.ft-item-select { min-width: 0; flex: 1; display: grid; gap: 3px; border: 0; padding: 10px; background: transparent; text-align: left; cursor: pointer; }
.ft-item-select strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--rc-text); font-size: 13px; }
.ft-item-select small { color: var(--rc-faint); font-size: 10px; }
.ft-item-rename { flex: none; border: 0; padding: 4px 8px; background: transparent; color: var(--rc-primary); font-size: 11px; cursor: pointer; }
.ft-editor { display: flex; min-width: 0; min-height: 0; flex-direction: column; padding: 18px; background: #fff; }
.ft-editor-head { align-items: flex-end; padding: 0 2px 16px; border-bottom: 1px solid var(--rc-border-soft); }
.ft-name { width: min(420px, 44vw); border: 0; border-bottom: 1px solid transparent; padding: 4px 0; background: transparent; color: var(--rc-text); font-size: 22px; font-weight: 700; outline: none; }
.ft-name:focus { border-bottom-color: var(--rc-primary); }
.ft-editor-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; color: var(--rc-faint); font-size: 11px; }
.ft-editor-actions .rc-btn { height: 32px; white-space: nowrap; }
.ft-boundary { display: grid; grid-template-columns: auto 1fr; gap: 8px; margin: 14px 2px; padding: 10px 12px; border: 1px solid #bfdbfe; border-radius: 8px; background: #eff6ff; color: var(--rc-text-2); font-size: 12px; line-height: 1.5; }
.ft-boundary strong { color: var(--rc-primary-ink); }
.ft-flow-shell { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(480px, 1fr) 6px var(--insp-w, 480px); gap: 8px; }
.ft-flow-shell.expanded { grid-template-columns: minmax(0, 1fr) 6px minmax(0, 60vw); }
.ft-insp-splitter { position: relative; border-radius: 3px; }
.ft-insp-splitter::before { content: ''; position: absolute; left: 2px; top: 0; bottom: 0; width: 2px; border-radius: 1px; background: var(--rc-border); }
.ft-empty { display: grid; min-height: 420px; place-items: center; color: var(--rc-muted); }
@media (max-width: 1240px) { .ft-page { height: auto; } .ft-flow-shell, .ft-flow-shell.expanded { grid-template-columns: minmax(0, 1fr); } .ft-insp-splitter { display: none; } .ft-flow-shell > :last-child { min-height: 520px; } }
@media (max-width: 820px) { .ft-page { grid-template-columns: 1fr; } .ft-list { border-right: 0; border-bottom: 1px solid var(--rc-border); } .ft-editor-head, .ft-editor-actions { align-items: flex-start; flex-direction: column; } .ft-name { width: 100%; } .ft-boundary { grid-template-columns: 1fr; } }
</style>
