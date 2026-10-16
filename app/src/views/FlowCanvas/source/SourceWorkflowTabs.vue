<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { workflowBindingApi, type FlowRecord, type WorkflowBinding } from '@/api'
const localFlowTarget = import.meta.env.VITE_FLOW_PROXY_TARGET
import { useFlowStore } from '@/stores/flow'
import { copyWholeFlow } from '@/utils/flow/copiedConfigs'
import { reportDetachResult } from '@/utils/flow/applyTemplateToSource'
import { makeBlankTemplateDefinition } from '@/utils/flow/flowTemplates'
import ReplaceFlowDialog from '../shared/ReplaceFlowDialog.vue'
import { copyFlowErrorText } from '@/utils/flow/flowPublish'
import FlowVersionBar from '../canvas/FlowVersionBar.vue'

const props = defineProps<{ sourceId: string }>()
const route = useRoute()
const router = useRouter()
const flow = useFlowStore()

const rows = ref<WorkflowBinding[]>([])
const loading = ref(false)
const adding = ref(false)
const addMenuOpen = ref(false)
const copyOpen = ref(false)
const versionBusy = ref(false)
// 入组的源分两段：来源组的流程（只读，要改去来源组）在前，源自有的流程在后；「＋」只往本源这段加（10-15 后端放行）
const groupRows = computed(() => rows.value.filter(row => row.inherited))
const ownRows = computed(() => rows.value.filter(row => !row.inherited))
const groupId = computed(() => groupRows.value[0]?.bindId ?? '')

const activeFlowId = computed(() => String(route.query.flowId || flow.sourceCtx?.flowId || ''))
const activeWorkflowId = computed(() => {
  const explicit = String(route.query.workflowId || flow.sourceCtx?.activeWorkflowId || '')
  if (explicit) return explicit
  const current = activeFlowId.value
  return rows.value.find(row => [row.workflowId, row.draftFlowId, row.publishedFlowId].includes(current))?.workflowId ?? current
})
const activeRow = computed(() => rows.value.find(row => row.workflowId === activeWorkflowId.value))

async function load() {
  loading.value = true
  try {
    rows.value = await workflowBindingApi.list(props.sourceId)
  } catch (error) {
    ElMessage.error(`流程页签加载失败：${(error as Error)?.message ?? String(error)}`)
  } finally {
    loading.value = false
  }
}

async function openFlow(workflowId: string) {
  const row = rows.value.find(item => item.workflowId === workflowId)
  // 正式版本模式下，流程图就是编辑工作区。第一次打开已发布流程时直接进入隔离草稿，
  // 避免用户点下拉框或“＋”后才发现整块画布被只读样式拦住。
  if (row?.versionManaged === true && !row.draftFlowId) {
    await createDraft(row, { notify: false })
    return
  }
  const targetFlowId = row?.draftFlowId ?? row?.publishedFlowId ?? row?.workflowId ?? workflowId
  if (!workflowId || (workflowId === activeWorkflowId.value && targetFlowId === activeFlowId.value)) return
  await router.replace({
    path: '/canvas',
    query: { ...route.query, view: 'flow', flowMode: 'canvas', workflowId, flowId: targetFlowId },
  })
}

async function finishCreate(workflowId: string) {
  await load()
  await openFlow(workflowId)
}

function versionLabel(row: WorkflowBinding): string {
  if (row.draftVersionNo) return `草稿 v${row.draftVersionNo}`
  if (row.publishedVersionNo) return `已发布 v${row.publishedVersionNo}`
  return row.versionStatus === 'DRAFT' ? '草稿' : '未发布'
}

async function createDraft(row: WorkflowBinding, options: { notify?: boolean } = {}) {
  if (versionBusy.value) return
  versionBusy.value = true
  try {
    const state = await workflowBindingApi.ensureDraft(row.workflowId)
    await load()
    await router.replace({
      path: '/canvas',
      query: { ...route.query, view: 'flow', flowMode: 'canvas', workflowId: row.workflowId, flowId: state.draftFlowId },
    })
    if (options.notify !== false) {
      ElMessage.success(`已创建草稿 v${state.draftVersionNo ?? ''}，后续修改不会影响当前发布版`)
    }
  } catch (error) {
    ElMessage.error(`创建草稿失败：${(error as Error)?.message ?? String(error)}`)
  } finally {
    versionBusy.value = false
  }
}

async function publishDraft(row: WorkflowBinding) {
  if (versionBusy.value || !row.draftVersionNo) return
  try {
    await ElMessageBox.confirm(
      `发布 v${row.draftVersionNo} 后，新发起的任务将使用这一版本；已经启动的任务继续使用原版本。`,
      '发布流程版本',
      { type: 'warning', confirmButtonText: '发布', cancelButtonText: '取消' },
    )
    versionBusy.value = true
    const state = await workflowBindingApi.publish(row.workflowId)
    await load()
    await router.replace({
      path: '/canvas',
      query: { ...route.query, view: 'flow', flowMode: 'list', workflowId: row.workflowId, flowId: state.publishedFlowId },
    })
    ElMessage.success(`流程 v${state.publishedVersionNo ?? row.draftVersionNo} 已发布`)
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(`发布失败：${(error as Error)?.message ?? String(error)}`)
  } finally {
    versionBusy.value = false
  }
}

async function createBlank() {
  addMenuOpen.value = false
  if (adding.value) return
  try {
    const result = await ElMessageBox.prompt('创建后会新增一个流程标签，可直接在画布和右侧配置区继续编辑。', '新建空白流程', {
      inputValue: `新流程-${new Date().toISOString().slice(0, 10)}`,
      inputPlaceholder: '流程名称',
      inputValidator: value => value.trim() ? true : '请输入流程名称',
      confirmButtonText: '创建并打开',
      cancelButtonText: '取消',
    })
    adding.value = true
    const created = await workflowBindingApi.createForSource({
      sourceId: props.sourceId,
      name: result.value.trim(),
      definition: makeBlankTemplateDefinition(),
      primary: !rows.value.some(row => !row.inherited || row.own),
    })
    ElMessage.success(`流程「${created.workflowName}」已创建`)
    await finishCreate(created.workflowId)
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(`新建流程失败：${(error as Error)?.message ?? String(error)}`)
  } finally {
    adding.value = false
  }
}

function chooseExisting() {
  addMenuOpen.value = false
  copyOpen.value = true
}

async function copyExisting(sourceFlow: FlowRecord) {
  if (adding.value) return
  try {
    const result = await ElMessageBox.prompt(
      `将复制「${sourceFlow.name}」的流程结构和节点配置，生成一条互不影响的新流程。`,
      '从流程或模板新建',
      {
        inputValue: `${sourceFlow.name}_副本`,
        inputPlaceholder: '新流程名称',
        inputValidator: value => value.trim() ? true : '请输入流程名称',
        confirmButtonText: '复制并打开',
        cancelButtonText: '取消',
      },
    )
    adding.value = true
    const copied = await copyWholeFlow(sourceFlow.id, result.value.trim(), {
      sourceFlowRef: `流程「${sourceFlow.name}」#${sourceFlow.id}`,
    })
    try {
      await workflowBindingApi.bind({
        sourceId: props.sourceId,
        workflowId: copied.flowId,
        primary: !rows.value.some(row => !row.inherited || row.own),
      })
    } catch (error) {
      throw new Error(`已生成流程 #${copied.flowId}，但关联当前源失败：${(error as Error)?.message ?? String(error)}`)
    }
    reportDetachResult(copied.detach, `原流程「${sourceFlow.name}」`)
    ElMessage.success(`已从「${sourceFlow.name}」创建新流程`)
    await finishCreate(copied.flowId)
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(copyFlowErrorText((error as Error)?.message ?? String(error)))
  } finally {
    adding.value = false
  }
}

watch(() => props.sourceId, async () => {
  await load()
  const row = activeRow.value
  if (row?.versionManaged === true && !row.draftFlowId) await createDraft(row, { notify: false })
})
onMounted(async () => {
  await load()
  const row = activeRow.value
  if (row?.versionManaged === true && !row.draftFlowId) await createDraft(row, { notify: false })
})
</script>

<template>
  <div class="swt" data-testid="source-workflow-tabs">
    <span v-if="localFlowTarget" class="swt-compat" :title="localFlowTarget">流程：本地</span>
    <div class="swt-scroll" role="tablist" aria-label="当前源的流程">
      <template v-for="segment in [{ key: 'group', list: groupRows }, { key: 'own', list: ownRows }]" :key="segment.key">
        <template v-if="segment.list.length || (segment.key === 'own' && groupRows.length)">
          <span
            v-if="groupRows.length"
            class="swt-seg"
            :class="segment.key"
            :data-testid="`workflow-seg-${segment.key}`"
            :title="segment.key === 'group' ? '来源组绑定的流程，这里只能查看，要改请到来源组里配置' : '当前源自己关联的流程，可新增、设主、解除；运行时本源的主流程优先'"
          >{{ segment.key === 'group' ? `来源组 #${groupId}` : '本源' }}</span>
          <span v-if="segment.key === 'own' && groupRows.length && !ownRows.length" class="swt-empty">暂无自有流程</span>
          <button
            v-for="row in segment.list"
            :key="row.workflowId"
            class="swt-tab"
            :class="{ active: row.workflowId === activeWorkflowId, group: row.inherited }"
            type="button"
            role="tab"
            :aria-selected="row.workflowId === activeWorkflowId"
            :title="`${row.workflowName}（#${row.workflowId}）${row.inherited ? (row.own ? '：来源组和本源都关联了' : '：来源组流程') : ''}`"
            @click="openFlow(row.workflowId)"
          >
            <span class="swt-name">{{ row.workflowName }}</span>
            <span class="swt-id">#{{ row.workflowId }}</span>
            <span v-if="row.versionManaged" class="swt-version" :class="{ draft: !!row.draftVersionNo }">{{ versionLabel(row) }}</span>
            <span v-if="row.primary" class="swt-primary">主</span>
            <span v-else-if="row.groupDefault" class="swt-group-default" title="来源组的默认流程；本源有主流程时以本源为准">组默认</span>
            <span v-else-if="row.role === 'BACKFILL'" class="swt-role">补</span>
            <span v-if="row.inherited && row.own" class="swt-own-mark">本源</span>
          </button>
        </template>
      </template>
      <span v-if="loading && !rows.length" class="swt-loading">加载流程…</span>
      <span v-else-if="!loading && !rows.length" class="swt-empty">暂无流程</span>
    </div>

    <div v-if="activeRow?.versionManaged === true && !activeRow.inherited" class="swt-version-actions">
      <button
        v-if="!activeRow.draftVersionId"
        class="swt-version-btn"
        type="button"
        :disabled="versionBusy"
        @click="createDraft(activeRow)"
      >编辑新版本</button>
      <button
        v-else
        class="swt-version-btn publish"
        type="button"
        :disabled="versionBusy"
        @click="publishDraft(activeRow)"
      >发布 v{{ activeRow.draftVersionNo }}</button>
    </div>

    <!-- 217 流程版本（2026-10-11）：已发布 vN / 草稿 vN + 放弃 / 发布，紧凑徽标放在这一行，不再单独占一行 -->
    <FlowVersionBar />

    <div class="swt-add-wrap">
      <button
        class="swt-add"
        type="button"
        data-testid="workflow-add"
        :disabled="adding"
        aria-label="新增流程标签"
        title="新增流程"
        @click.stop="addMenuOpen = !addMenuOpen"
      >{{ adding ? '…' : '＋' }}</button>
      <div v-if="addMenuOpen" class="swt-add-menu" data-testid="workflow-add-menu">
        <button type="button" data-testid="workflow-create-blank" @click="createBlank">新建空白流程</button>
        <button type="button" data-testid="workflow-copy-existing" @click="chooseExisting">从现有流程或模板新建</button>
      </div>
    </div>

    <ReplaceFlowDialog
      v-if="copyOpen"
      v-model="copyOpen"
      purpose="copy"
      :current-flow-id="activeFlowId"
      @pick="copyExisting"
    />
  </div>
</template>

<style scoped>
.swt { position: relative; z-index: 18; display: flex; align-items: stretch; min-height: 38px; padding: 0 10px; border-bottom: 1px solid var(--rc-border); background: #f8fafc; }
.swt-scroll { display: flex; flex: 1; min-width: 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; }
.swt-tab { display: inline-flex; align-items: center; gap: 5px; max-width: 240px; min-width: 110px; padding: 0 12px; border: 0; border-right: 1px solid var(--rc-border-soft); border-bottom: 2px solid transparent; background: transparent; color: var(--rc-text-2); cursor: pointer; }
.swt-tab:hover { background: #fff; color: var(--rc-primary-ink); }
.swt-tab.active { border-bottom-color: var(--rc-primary); background: #fff; color: var(--rc-primary-ink); }
.swt-name { overflow: hidden; font-size: 12px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.swt-id { flex: none; color: var(--rc-faint); font: 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
.swt-primary, .swt-role { flex: none; padding: 1px 4px; border-radius: 4px; background: #dcfce7; color: #166534; font-size: 10px; }
.swt-role { background: #fef3c7; color: #92400e; }
.swt-version { flex: none; padding: 1px 4px; border-radius: 4px; background: #e2e8f0; color: #475569; font-size: 10px; }
.swt-version.draft { background: #fef3c7; color: #92400e; }
.swt-version-actions { display: flex; align-items: center; margin-left: 7px; }
.swt-version-btn { height: 28px; padding: 0 9px; border: 1px solid #93c5fd; border-radius: 6px; background: #eff6ff; color: #1d4ed8; font-size: 11px; cursor: pointer; white-space: nowrap; }
.swt-version-btn.publish { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.swt-version-btn:disabled { opacity: .55; cursor: not-allowed; }
.swt-loading, .swt-empty { align-self: center; padding: 0 12px; color: var(--rc-faint); font-size: 12px; }
.swt-add-wrap { position: relative; display: flex; align-items: center; margin-left: 6px; }
.swt-add { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-primary); font-size: 18px; cursor: pointer; }
.swt-add:hover { border-color: #93c5fd; background: var(--rc-primary-bg); }
.swt-add:disabled { opacity: .55; cursor: wait; }
.swt-add-menu { position: absolute; top: 32px; right: 0; z-index: 40; width: 190px; padding: 5px; border: 1px solid var(--rc-border); border-radius: 8px; background: #fff; box-shadow: 0 10px 24px rgb(15 23 42 / 14%); }
.swt-add-menu button { display: block; width: 100%; padding: 8px 10px; border: 0; border-radius: 5px; background: transparent; color: var(--rc-text-2); text-align: left; cursor: pointer; }
.swt-add-menu button:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.swt-compat { align-self: center; margin-left: 7px; color: #92400e; font-size: 10px; white-space: nowrap; }
.swt-seg { flex: none; align-self: center; margin: 0 6px 0 2px; padding: 2px 7px; border-radius: 10px; background: #e2e8f0; color: #475569; font-size: 10px; white-space: nowrap; cursor: help; }
.swt-seg.group { background: #ede9fe; color: #6d28d9; }
.swt-seg.own { margin-left: 10px; }
.swt-tab.group .swt-name { color: #6d28d9; }
.swt-group-default, .swt-own-mark { flex: none; padding: 1px 4px; border-radius: 4px; background: #ede9fe; color: #6d28d9; font-size: 10px; }
.swt-own-mark { background: #e2e8f0; color: #475569; }
</style>
