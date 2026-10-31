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
 *
 * 1030 会议：关联流程改用选择器弹窗（FlowPickerDialog，可搜索、看节点数、行内预览节点）；
 * 独立源额外推荐「同网站其他源在用的流程」（按 site/sources 的默认流程计数），没有就不显示。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { flowCenterApi, siteApi, sourceGroupApi, workflowBindingApi, type FlowRecord, type Source, type SourceFlowBind, type SourceFlowsView } from '@/api'
import { useAuthStore } from '@/stores/auth'
import FlowDetailDrawer from '@/views/FlowCenter/FlowDetailDrawer.vue'
import FlowPickerDialog from './FlowPickerDialog.vue'

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

/** 候选列表里没有的流程（选择器里挑的、推荐出来的）名称另存一份 */
const extraFlowNames = ref<Record<string, string>>({})
function flowLabel(id: string): string {
  const name = flowOptions.value.find((f) => f.id === id)?.name || extraFlowNames.value[id]
  return name ? `${name} · ${id}` : `流程 ${id}`
}

/** 同网站其他源在用的流程：flowId → 源数（只统计默认流程） */
const siteFlowCounts = ref<Record<string, number>>({})
const RECOMMEND_LIMIT = 3
/** 查过发现已停用 / 已删除的流程，不推荐（候选列表本来就排除停用，推荐不能绕过去） */
const unavailableFlowIds = ref<Set<string>>(new Set())
const recommendations = computed(() => Object.entries(siteFlowCounts.value)
  .filter(([id]) => !flowIds.value.includes(id) && !unavailableFlowIds.value.has(id))
  .sort((a, b) => b[1] - a[1])
  .slice(0, RECOMMEND_LIMIT)
  .map(([id, count]) => ({ id, count })))
let siteSeq = 0
/** 已经拉过推荐的源：保存 / 启停后重查 view 时不再重复拉整站源（大站一次几千行） */
let siteFlowsKey = ''
const hasSite = computed(() => !!props.source.siteId && props.source.siteId !== '0' && props.source.siteId !== '-1')
/** 只给独立源拉：组内源不显示推荐，没必要拉整站源 */
async function loadSiteFlows() {
  const key = `${props.source.sourceId}@${props.source.siteId ?? ''}`
  if (key === siteFlowsKey) return
  siteFlowsKey = key
  const reqId = ++siteSeq
  siteFlowCounts.value = {}
  const siteId = props.source.siteId
  if (!siteId || !hasSite.value) return
  try {
    const sources = await siteApi.siteSources(siteId)
    if (reqId !== siteSeq) return
    const counts: Record<string, number> = {}
    for (const s of sources) {
      if (s.sourceId === props.source.sourceId || !s.flowId) continue
      counts[s.flowId] = (counts[s.flowId] ?? 0) + 1
    }
    siteFlowCounts.value = counts
  } catch {
    // 推荐只是辅助：网站源读不到就不显示推荐，不打断流程配置；下次重查 view 时再试
    if (reqId === siteSeq) siteFlowsKey = ''
  }
}
function clearSiteFlows() {
  siteSeq++
  siteFlowsKey = ''
  siteFlowCounts.value = {}
}
/**
 * 只给展示出来的几条补名称、剔除停用 / 已删除的；加入一条后顶上来的也会补。
 * 候选列表（props.flows）里的流程已排除停用、自带名称，不用查。
 */
const checkedFlowIds = new Set<string>()
watch(recommendations, async (list) => {
  const todo = list.map((r) => r.id).filter((id) => !checkedFlowIds.has(id) && !flowOptions.value.some((f) => f.id === id))
  if (!todo.length) return
  todo.forEach((id) => checkedFlowIds.add(id))
  try {
    const found = (await flowCenterApi.paged({ page: 1, size: todo.length, flowIds: todo })).list
    rememberFlowNames(found)
    const unavailable = todo.filter((id) => !found.some((f) => f.id === id && !f.disabled))
    if (unavailable.length) unavailableFlowIds.value = new Set([...unavailableFlowIds.value, ...unavailable])
  } catch {
    todo.forEach((id) => checkedFlowIds.delete(id))
  }
})
function rememberFlowNames(flows: FlowRecord[]) {
  const next = { ...extraFlowNames.value }
  for (const f of flows) if (f.name) next[f.id] = f.name
  extraFlowNames.value = next
}
function addRecommended(id: string) {
  if (!flowIds.value.includes(id)) flowIds.value = [...flowIds.value, id]
  if (!defaultFlowId.value) defaultFlowId.value = id
}

const pickerOpen = ref(false)
function onPicked(flows: FlowRecord[]) {
  rememberFlowNames(flows)
  flowIds.value = flows.map((f) => f.id)
  if (!flowIds.value.includes(defaultFlowId.value)) defaultFlowId.value = flowIds.value.length === 1 ? flowIds.value[0] : ''
  pickerOpen.value = false
}
function removeFlow(id: string) {
  flowIds.value = flowIds.value.filter((x) => x !== id)
  if (defaultFlowId.value === id) defaultFlowId.value = ''
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
    if (view.value.sourceGroupId) clearSiteFlows()
    else void loadSiteFlows()
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
    await sourceGroupApi.changeMembers({
      sourceIds: [props.source.sourceId],
      sourceGroupId: null,
      expectedSourceGroupId: view.value.sourceGroupId,
    })
    emit('saved')
    // 退组后恢复自有流程，重查并切到「本源流程」。
    await load()
    ElMessage.success('已退出来源组')
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
      <p class="sfcd-source-id" data-testid="sfcd-source-id">源 ID：{{ source.sourceId }}<template v-if="hasSite"> · 网站 ID：{{ source.siteId }}</template></p>
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
          <div class="sfcd-flow-tags" data-testid="sfcd-flow-ids">
            <el-tag v-for="id in flowIds" :key="id" :closable="canWrite" disable-transitions @close="removeFlow(id)">{{ flowLabel(id) }}</el-tag>
            <span v-if="!flowIds.length" class="sfcd-flow-summary">还没有关联流程</span>
          </div>
          <div>
            <el-button size="small" :disabled="!canWrite" data-testid="sfcd-pick-flows" @click="pickerOpen = true">选择流程</el-button>
          </div>
        </div>
        <div v-if="recommendations.length" class="sfcd-recommend" data-testid="sfcd-recommend">
          <label>本网站其他源在用的流程</label>
          <div v-for="r in recommendations" :key="r.id" class="sfcd-recommend-row" data-testid="sfcd-recommend-row">
            <span class="sfcd-recommend-name" :title="flowLabel(r.id)">{{ flowLabel(r.id) }}</span>
            <span class="sfcd-flow-summary">本网站 {{ r.count }} 个源在用</span>
            <el-button link type="primary" size="small" :disabled="!canWrite" data-testid="sfcd-recommend-add" @click="addRecommended(r.id)">加入</el-button>
          </div>
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
    <FlowPickerDialog v-if="pickerOpen" :selected="flowIds" :site-flow-counts="siteFlowCounts" @close="pickerOpen = false" @confirm="onPicked" />
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
.sfcd-source-id { margin: 0; font-size: 12px; color: var(--rc-text-2); }
.sfcd-flow-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.sfcd-recommend { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border: 1px dashed var(--rc-border); border-radius: 6px; }
.sfcd-recommend > label { font-size: 12px; color: var(--rc-text-2); }
.sfcd-recommend-row { display: flex; align-items: center; gap: 8px; }
.sfcd-recommend-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.sfcd-section { margin: 0; color: var(--rc-text); font-size: 13px; font-weight: 650; }
</style>
