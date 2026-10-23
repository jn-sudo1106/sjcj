<script setup lang="ts">
/**
 * 源流程配置抽屉（1008-04，§3.5）。源列表勾选 1 个源后打开。
 *
 * - 源在组内：只有来源组流程（组 #ID +「查看组配置」「退出来源组」）。组内源只走组流程（1021-02），
 *   不能再维护本源流程（后端 bindSourceFlows 也拒绝，10-21 186 实测）；入组前留下的自有绑定折叠成「历史自有流程（已不生效）」。
 * - 独立源：关联流程多选 + 默认流程单选 + 保存
 *   （`workflowBindingApi.save`，bindSourceFlows 整体替换带并发快照，只动 own*）+ 绑定状态表（启停开关 `updateBindingState`）。
 * - 运行入口：组内源用来源组默认，独立源用本源默认（与画布流程标签栏同口径）。
 *
 * 与来源组目录页签的「流程配置」抽屉同源（都基于 `source-group/*`），差别在对象：
 * 组抽屉管整个组的绑定（bindFlows），这里是单个源的绑定（bindSourceFlows），
 * sourceFlows 顶层字段是组的绑定（入组时），own* 是源自有的绑定。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { flowCenterApi, sourceGroupApi, workflowBindingApi, type FlowRecord, type Source, type SourceFlowBind, type SourceFlowsView } from '@/api'
import { useAuthStore } from '@/stores/auth'
import FlowDetailDrawer from '@/views/FlowCenter/FlowDetailDrawer.vue'

const props = defineProps<{
  source: Source
  /** 流程候选（排除停用）；不传时抽屉内自拉 */
  flows?: FlowRecord[]
}>()
const emit = defineEmits<{
  close: []
  saved: []
  /** 「查看组配置」→ 跳到来源组目录页签并选中该组 */
  openGroup: [sourceGroupId: string]
}>()
const auth = useAuthStore()
const canWrite = computed(() => auth.role === 'admin')

const view = ref<SourceFlowsView | null>(null)
const loading = ref(false)
const loadError = ref('')
/** 编辑框的本源关联流程（只取启用中的 ownFlowIds，不能把停用行带进去——保存会整体替换） */
const flowIds = ref<string[]>([])
const defaultFlowId = ref<string>('')
const saving = ref(false)
const detailFlow = ref<FlowRecord | null>(null)

const flowOptions = computed(() => {
  if (props.flows?.length) return props.flows
  return []
})

function flowLabel(id: string): string {
  const flow = flowOptions.value.find((f) => f.id === id)
  return flow ? `${flow.name} · ${id}` : `流程 ${id}`
}

const inGroup = computed(() => !!view.value?.sourceGroupId)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    view.value = await workflowBindingApi.view(props.source.sourceId)
    flowIds.value = [...view.value.ownFlowIds]
    const def = view.value.ownBindings.find((b) => b.isDefault)
    defaultFlowId.value = def ? def.flowId : ''
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

/** 保存：整体替换关联流程并指定默认（bindSourceFlows 带并发快照，workflowBindingApi.save 内部读最新快照） */
async function save() {
  if (!canWrite.value) return
  if (!flowIds.value.length) {
    ElMessage.warning('至少关联一条流程')
    return
  }
  if (!flowIds.value.includes(defaultFlowId.value)) {
    ElMessage.warning('请选择关联列表中的默认流程')
    return
  }
  saving.value = true
  try {
    await workflowBindingApi.save(props.source.sourceId, () => ({
      flowIds: flowIds.value,
      defaultFlowId: defaultFlowId.value,
    }))
    ElMessage.success('源流程已保存')
    emit('saved')
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error))
  } finally {
    saving.value = false
  }
}

/** 绑定状态表：启用 / 停用一条绑定（启用时所属的组 / 源没有默认流程会被后端拒绝，前端先拦） */
async function toggleBindingState(row: SourceFlowBind) {
  if (!canWrite.value) return
  const next = row.state === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
  const hasDefault = row.sourceGroupId ? !!view.value?.defaultFlowId : !!defaultFlowId.value
  if (next === 'ACTIVE' && !hasDefault) {
    ElMessage.warning('请先设置默认流程，再启用这条绑定')
    return
  }
  try {
    await sourceGroupApi.updateBindingState(row, next)
    ElMessage.success(next === 'ACTIVE' ? '已启用' : '已停用')
    emit('saved')
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error))
  }
}

/** 退出来源组：changeMembers target=null，expected=当前组 */
async function leaveGroup() {
  if (!canWrite.value || !view.value?.sourceGroupId) return
  try {
    await ElMessageBox.confirm(`确定把「${props.source.name}」移出来源组？移出后不再使用来源组的流程，按本源自己的流程运行。`, '确认退出来源组', { type: 'warning' })
  } catch {
    return
  }
  try {
    await sourceGroupApi.changeMembers({
      sourceIds: [props.source.sourceId],
      sourceGroupId: null,
      expectedSourceGroupId: view.value.sourceGroupId,
    })
    emit('saved')
    // 退组后抽屉直接切到「本源流程」；入组前留下的自有绑定会重新生效（10-21 186 实测），按退组后的实际结果提示
    await load()
    const own = view.value?.ownFlowIds ?? []
    if (own.length) ElMessage.success(`已退出来源组，按本源原有流程运行：${own.map(flowLabel).join('、')}`)
    else ElMessage.warning('已退出来源组。本源还没有流程，请在下方关联流程后才能运行')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error))
  }
}

async function openFlowNode(flowId: string) {
  try {
    detailFlow.value = await flowCenterApi.detail(flowId)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error))
  }
}

watch(() => props.source, () => void load(), { immediate: true })
</script>

<template>
  <el-drawer :model-value="true" :title="`源流程配置 · ${source.name}`" size="480px" append-to-body @close="emit('close')">
    <div class="sfcd-body" v-loading="loading">
      <p v-if="loadError" class="sfcd-error">{{ loadError }}</p>
      <template v-else-if="view">
        <!-- 组内源：来源组流程只读 + 查看组配置 / 退出来源组 -->
        <template v-if="inGroup">
          <h4 class="sfcd-section" data-testid="sfcd-group-section">来源组流程（组 #{{ view.sourceGroupId }}）</h4>
          <el-alert
            title="组内源统一使用来源组的流程。要改流程请到来源组里配置；要单独给这个源配置流程，请先退出来源组"
            type="warning"
            :closable="false"
            show-icon
          />
          <p class="sfcd-flow-summary">来源组流程：{{ view.flowIds.map(flowLabel).join('、') || '—' }}<template v-if="view.defaultFlowId">；组默认：{{ flowLabel(view.defaultFlowId) }}</template></p>
          <div class="sfcd-actions">
            <el-button type="primary" plain data-testid="sfcd-view-group" @click="emit('openGroup', view.sourceGroupId!)">查看组配置</el-button>
            <el-button type="danger" plain :disabled="!canWrite" data-testid="sfcd-leave-group" @click="leaveGroup">退出来源组</el-button>
          </div>
          <el-table :data="view.bindings" size="small" class="sfcd-bindings" :empty-text="'加载中…'">
            <el-table-column label="流程">
              <template #default="{ row }">{{ flowLabel(row.flowId) }}</template>
            </el-table-column>
            <el-table-column label="默认" width="70">
              <template #default="{ row }">{{ row.isDefault ? '是' : '否' }}</template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-switch :model-value="row.state === 'ACTIVE'" :disabled="!canWrite" :aria-label="`切换 ${flowLabel(row.flowId)}`" data-testid="sfcd-binding-toggle" @change="toggleBindingState(row)" />
              </template>
            </el-table-column>
          </el-table>
          <!-- 入组前留下的自有绑定：后端不生效、也改不了（10-21 186 实测），只折叠展示；退组后会重新生效 -->
          <el-collapse v-if="view.ownBindings.length" class="sfcd-history" data-testid="sfcd-own-history">
            <el-collapse-item :title="`历史自有流程（已不生效，${view.ownBindings.length} 条）`" name="own">
              <p class="sfcd-flow-summary">入组前给这个源单独关联的流程，在组内不会运行；退出来源组后会重新生效。</p>
              <el-table :data="view.ownBindings" size="small">
                <el-table-column label="流程">
                  <template #default="{ row }">{{ flowLabel(row.flowId) }}</template>
                </el-table-column>
                <el-table-column label="默认" width="70">
                  <template #default="{ row }">{{ row.isDefault ? '是' : '否' }}</template>
                </el-table-column>
              </el-table>
            </el-collapse-item>
          </el-collapse>
        </template>

        <!-- 独立源：本源流程多选 + 默认 + 保存 + 绑定状态表 -->
        <template v-else>
        <h4 class="sfcd-section" data-testid="sfcd-own-section">本源流程</h4>
        <el-alert title="这里配置的是本源的独立流程" type="info" :closable="false" show-icon />
        <div class="sfcd-row">
          <label>关联流程（可选多个）</label>
          <el-select v-model="flowIds" multiple filterable clearable placeholder="选择关联流程" style="width: 100%" :disabled="!canWrite" data-testid="sfcd-flow-ids">
            <el-option v-for="f in flowOptions" :key="f.id" :value="f.id" :label="`${f.name} · ${f.id}`" />
          </el-select>
        </div>
        <div class="sfcd-row">
          <label>本源默认流程（未指定流程的任务使用此项）</label>
          <el-select v-model="defaultFlowId" placeholder="从关联流程中选择" style="width: 100%" :disabled="!canWrite" data-testid="sfcd-default-flow">
            <el-option v-for="id in flowIds" :key="id" :value="id" :label="flowLabel(id)" />
          </el-select>
        </div>
        <div class="sfcd-row">
          <el-button type="primary" :disabled="!canWrite || saving" :loading="saving" data-testid="sfcd-save" @click="save">保存源流程</el-button>
        </div>
        <el-divider />
        <el-table :data="view.ownBindings" size="small" class="sfcd-bindings" :empty-text="'暂无绑定'">
          <el-table-column label="流程">
            <template #default="{ row }">{{ flowLabel(row.flowId) }}</template>
          </el-table-column>
          <el-table-column label="默认" width="70">
            <template #default="{ row }">{{ row.isDefault ? '是' : '否' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-switch :model-value="row.state === 'ACTIVE'" :disabled="!canWrite" :aria-label="`切换 ${flowLabel(row.flowId)}`" data-testid="sfcd-binding-toggle" @change="toggleBindingState(row)" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openFlowNode(row.flowId)">查看流程节点</el-button>
            </template>
          </el-table-column>
        </el-table>
        </template>
      </template>
    </div>
    <FlowDetailDrawer v-if="detailFlow" :flow="detailFlow" @close="detailFlow = null" />
  </el-drawer>
</template>

<style scoped>
.sfcd-body { display: flex; flex-direction: column; gap: 12px; }
.sfcd-error { color: #dc2626; font-size: 12px; }
.sfcd-flow-summary { font-size: 12px; color: var(--rc-text-2); margin: 0; }
.sfcd-history { border-top: 0; }
.sfcd-actions { display: flex; gap: 8px; }
.sfcd-row { display: flex; flex-direction: column; gap: 4px; }
.sfcd-row > label { font-size: 12px; color: var(--rc-text-2); }
.sfcd-bindings { margin-top: 4px; }
.sfcd-section { margin: 0; color: var(--rc-text); font-size: 13px; font-weight: 650; }
</style>
