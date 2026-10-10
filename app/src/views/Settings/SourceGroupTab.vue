<script setup lang="ts">
/**
 * 源管理「来源组」目录页签（1008-03，10-09 改定方案；10-13 用户定：放系统设置）。
 *
 * 放哪：`Settings/index.vue` 页内 tab「来源组」（10-13 从采集资产页签条移到这里）。
 * 界面复用「我的分组」（`PersonalSources.vue`）的布局：左边组列表（带成员数），右边成员源列表；
 * 来源组独有的东西（流程配置、组资料）放右侧抽屉。数据不合并——「我的分组」是本机个人目录，
 * 来源组是后端 `source-group/*` 配置（决定组内源跑哪条流程，只有管理员能改）。
 *
 * 契约：
 * - 写接口只允许 admin；非 admin 全部写按钮禁用并提示。
 * - 任何写操作完成后（包括失败）重新拉 `list` 与当前组绑定，刷新 `revision`（旧平台 act() 做法，
 *   避免乐观锁冲突后一直报「已被修改」）。
 * - 错误直接展示后端 msg，不包一层「操作失败」。
 * - 成员源列表复用 `SourceOverviewView`，用 `scopeSourceGroupId` 走 `sourcePaged` 服务端筛选
 *   （2026-10-09 实测支持），255 个成员的组天然翻页。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { sourceGroupApi, flowCenterApi, sourceApi, type SourceGroup, type SourceGroupState, type SourceFlowBind, type FlowRecord } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import SourceOverviewView from '@/views/FlowCanvas/result/SourceOverviewView.vue'
import FlowDetailDrawer from '@/views/FlowCenter/FlowDetailDrawer.vue'
import GroupSourcePicker from '@/views/CollectAssets/GroupSourcePicker.vue'

const auth = useAuthStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const canWrite = computed(() => auth.role === 'admin')

// ---- 左侧组列表 ----
const groups = ref<SourceGroup[]>([])
/** 组 → 成员数（用 sourcePaged 按 sourceGroupId 筛的 count；members 接口没有 total） */
const memberCounts = ref<Record<string, number>>({})
const loading = ref(false)
const selectedGroupId = ref<string>('')
const selectedGroup = computed(() => groups.value.find((g) => g.sourceGroupId === selectedGroupId.value) ?? null)

/** 所有流程候选（排除 state=D）；选项显示「名称 · ID」 */
const flows = ref<FlowRecord[]>([])
function flowLabel(id?: string | null): string {
  if (id == null || id === '') return '未配置 / 暂不可用'
  const flow = flows.value.find((f) => f.id === id)
  return flow ? `${flow.name} · ${id}` : `流程 ${id}`
}

// ---- 右侧工具条 / 抽屉状态 ----
const flowDrawer = ref(false)
const detailDrawer = ref(false)
const detailFlow = ref<FlowRecord | null>(null)

// ---- 流程配置抽屉 ----
const groupBindings = ref<SourceFlowBind[]>([])
const groupBindingsLoaded = ref(false)
/** 编辑框的关联流程（只取启用中的 flowIds，不能把停用行带进去——bindFlows 会把列表里没有的全部停用） */
const flowIds = ref<string[]>([])
/** 编辑框的默认流程（来自 bindings 里 isDefault=1 那行，含停用） */
const defaultFlowId = ref<string>('')
const savingFlows = ref(false)
function defaultFromBindings(rows: SourceFlowBind[]): string {
  const row = rows.find((r) => r.isDefault)
  return row ? row.flowId : ''
}

// ---- 组资料抽屉 ----
const editingGroup = ref<{ sourceGroupId: string; revision: number; sourceGroupCode: string; sourceGroupName: string; description: string; state: SourceGroupState } | null>(null)
const savingGroup = ref(false)

// ---- 新建来源组弹窗 ----
const creating = ref(false)
const newCode = ref('')
const newName = ref('')
const newDescription = ref('')
const creatingGroup = ref(false)

// ---- 成员操作 ----
const selectedIds = ref<string[]>([])
const moveTarget = ref('')
const pickerVisible = ref(false)

/** 请求序号防串台：快速切组 / 刷新时旧响应不得覆盖新选中 */
let listRequest = 0
let bindingRequest = 0

async function reloadGroups(): Promise<void> {
  const request = ++listRequest
  loading.value = true
  try {
    const rows = await sourceGroupApi.list()
    if (request !== listRequest) return
    groups.value = rows
    // 选中组被删 / 刷新后不存在 → 清空选中
    if (selectedGroupId.value && !rows.some((g) => g.sourceGroupId === selectedGroupId.value)) {
      selectedGroupId.value = ''
    }
    if (selectedGroupId.value) {
      await loadGroupDetail(selectedGroupId.value)
    }
    void loadMemberCounts(rows, request)
  } catch (error) {
    if (request === listRequest) ElMessage.error((error as Error)?.message ?? String(error))
  } finally {
    if (request === listRequest) loading.value = false
  }
}

/** 每个组的成员数：sourcePaged 按 sourceGroupId 筛一次拿 count（members 接口没有 total） */
async function loadMemberCounts(rows: SourceGroup[], request: number): Promise<void> {
  const counts: Record<string, number> = {}
  await Promise.all(rows.map(async (g) => {
    try {
      const result = await sourceApi.sourcePaged({ page: 1, size: 1, sourceGroupId: g.sourceGroupId })
      counts[g.sourceGroupId] = result.total
    } catch {
      counts[g.sourceGroupId] = 0
    }
  }))
  if (request === listRequest) memberCounts.value = counts
}

async function loadFlows(): Promise<void> {
  try {
    const rows = await flowCenterApi.list()
    flows.value = rows.filter((f) => f.state !== 'D')
  } catch (error) {
    ElMessage.error((error as Error)?.message ?? String(error))
  }
}

function selectGroup(id: string): void {
  selectedGroupId.value = id
  void loadGroupDetail(id)
}

async function loadGroupDetail(id: string): Promise<void> {
  const request = ++bindingRequest
  groupBindingsLoaded.value = false
  groupBindings.value = []
  flowIds.value = selectedGroup.value ? [...selectedGroup.value.flowIds] : []
  defaultFlowId.value = ''
  selectedIds.value = []
  const group = groups.value.find((g) => g.sourceGroupId === id)
  if (!group) return
  try {
    const bindings = await sourceGroupApi.bindings({ sourceGroupId: id })
    if (request !== bindingRequest) return
    groupBindings.value = bindings
    defaultFlowId.value = defaultFromBindings(bindings)
    groupBindingsLoaded.value = true
  } catch (error) {
    if (request === bindingRequest) ElMessage.error((error as Error)?.message ?? String(error))
  }
}

/** 打开组流程配置抽屉：重新拉一次绑定（revision 可能已变） */
function openFlowDrawer(): void {
  if (!selectedGroup.value) return
  flowDrawer.value = true
  void loadGroupDetail(selectedGroup.value.sourceGroupId)
}

function openDetailDrawer(): void {
  if (!selectedGroup.value) return
  detailDrawer.value = true
  editingGroup.value = selectedGroup.value
    ? { sourceGroupId: selectedGroup.value.sourceGroupId, revision: selectedGroup.value.revision, sourceGroupCode: selectedGroup.value.sourceGroupCode, sourceGroupName: selectedGroup.value.sourceGroupName, description: selectedGroup.value.description ?? '', state: selectedGroup.value.state }
    : null
}

/** 保存组流程（bindFlows 整体替换；编辑初值只取启用中的 flowIds） */
async function saveFlows(): Promise<void> {
  const group = selectedGroup.value
  if (!canWrite.value || !group) return
  if (!groupBindingsLoaded.value) {
    ElMessage.warning('请先成功加载组绑定，再保存流程')
    return
  }
  if (group.state !== 'ACTIVE') {
    ElMessage.warning('组已停用，请先在「组资料」中启用后修改流程列表')
    return
  }
  if (flowIds.value.length && !flowIds.value.includes(defaultFlowId.value)) {
    ElMessage.warning('请选择关联列表中的默认流程')
    return
  }
  savingFlows.value = true
  try {
    await sourceGroupApi.bindFlows({
      sourceGroupId: group.sourceGroupId,
      revision: group.revision,
      flowIds: flowIds.value,
      defaultFlowId: flowIds.value.length ? defaultFlowId.value : null,
    })
    ElMessage.success('组流程已保存')
  } catch (error) {
    ElMessage.error((error as Error)?.message ?? String(error))
  } finally {
    savingFlows.value = false
  }
  void reloadGroups()
}

/** 绑定状态表：启用 / 停用一条绑定（启用时组没有默认流程会被后端拒绝，前端先拦） */
async function toggleBindingState(row: SourceFlowBind): Promise<void> {
  if (!canWrite.value) return
  const next = row.state === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
  if (next === 'ACTIVE' && !defaultFlowId.value) {
    ElMessage.warning('请先设置默认流程，再启用这条绑定')
    return
  }
  try {
    await sourceGroupApi.updateBindingState(row, next)
    ElMessage.success(next === 'ACTIVE' ? '已启用' : '已停用')
  } catch (error) {
    ElMessage.error((error as Error)?.message ?? String(error))
  }
  void reloadGroups()
}

/** 保存组资料（带 revision；状态变更二次确认） */
async function saveGroupDetail(): Promise<void> {
  const group = editingGroup.value
  if (!canWrite.value || !group) return
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(group.sourceGroupCode.trim())) {
    ElMessage.warning('组编码需以字母 / 数字开头，可含字母、数字、下划线、连字符，最长 64 位')
    return
  }
  if (!group.sourceGroupName.trim()) {
    ElMessage.warning('请填写组名称')
    return
  }
  const stateChanged = selectedGroup.value?.state !== group.state
  if (stateChanged && group.state === 'DISABLED') {
    try {
      await ElMessageBox.confirm(`停用「${group.sourceGroupName.trim()}」后，全部成员不能启动新任务。确定停用？`, '确认停用来源组', { type: 'warning' })
    } catch {
      return
    }
  }
  savingGroup.value = true
  try {
    await sourceGroupApi.update({
      sourceGroupId: group.sourceGroupId,
      revision: group.revision,
      sourceGroupCode: group.sourceGroupCode.trim(),
      sourceGroupName: group.sourceGroupName.trim(),
      description: group.description.trim(),
      state: group.state,
    })
    ElMessage.success('组资料已保存')
    detailDrawer.value = false
  } catch (error) {
    ElMessage.error((error as Error)?.message ?? String(error))
  } finally {
    savingGroup.value = false
  }
  void reloadGroups()
}

/** 删除来源组：先确认没有成员，有成员直接提示不发请求 */
async function removeGroup(): Promise<void> {
  const group = selectedGroup.value
  if (!canWrite.value || !group) return
  try {
    const page = await sourceGroupApi.members(group.sourceGroupId, 0, 1)
    if (page.rows.length > 0) {
      // members 只取了 1 条用来判断有没有成员；数量用左侧的成员数（sourcePaged 的 count）
      const count = memberCounts.value[group.sourceGroupId]
      ElMessage.warning(`「${group.sourceGroupName}」还有${count ? ` ${count} 个` : ''}成员，请先移出全部成员再删除`)
      return
    }
  } catch (error) {
    ElMessage.error((error as Error)?.message ?? String(error))
    return
  }
  try {
    await ElMessageBox.confirm(`确定删除来源组「${group.sourceGroupName}」（#${group.sourceGroupId}）？`, '确认删除来源组', { type: 'warning' })
  } catch {
    return
  }
  try {
    await sourceGroupApi.remove({ sourceGroupId: group.sourceGroupId, revision: group.revision })
    ElMessage.success('来源组已删除')
    selectedGroupId.value = ''
    detailDrawer.value = false
  } catch (error) {
    ElMessage.error((error as Error)?.message ?? String(error))
  }
  void reloadGroups()
}

/** 新建来源组（成功后选中新组，打开「流程配置」抽屉） */
async function createGroup(): Promise<void> {
  if (!canWrite.value) return
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(newCode.value.trim())) {
    ElMessage.warning('组编码需以字母 / 数字开头，可含字母、数字、下划线、连字符，最长 64 位')
    return
  }
  if (!newName.value.trim()) {
    ElMessage.warning('请填写组名称')
    return
  }
  creatingGroup.value = true
  const code = newCode.value.trim()
  try {
    await sourceGroupApi.add({
      sourceGroupCode: code,
      sourceGroupName: newName.value.trim(),
      description: newDescription.value.trim() || undefined,
    })
    ElMessage.success('来源组已创建')
    creating.value = false
    newCode.value = ''
    newName.value = ''
    newDescription.value = ''
    await reloadGroups()
    // 按组编码找新组（list 的顺序后端没约定，不能取末尾），选中它并打开「流程配置」抽屉
    const created = groups.value.find((g) => g.sourceGroupCode === code)
    if (created) {
      selectGroup(created.sourceGroupId)
      flowDrawer.value = true
    }
  } catch (error) {
    ElMessage.error((error as Error)?.message ?? String(error))
  } finally {
    creatingGroup.value = false
  }
}

/** 移出选中成员（target=null，expected=本组） */
async function removeMembers(): Promise<void> {
  const group = selectedGroup.value
  if (!canWrite.value || !group || !selectedIds.value.length) return
  try {
    await ElMessageBox.confirm(`确定把这 ${selectedIds.value.length} 个来源移出「${group.sourceGroupName}」？移出后不恢复旧绑定，需重新配置独立流程才能运行。`, '确认移出来源组', { type: 'warning' })
  } catch {
    return
  }
  try {
    await sourceGroupApi.changeMembers({ sourceIds: selectedIds.value, sourceGroupId: null, expectedSourceGroupId: group.sourceGroupId })
    ElMessage.success(`已移出 ${selectedIds.value.length} 个来源`)
  } catch (error) {
    ElMessage.error((error as Error)?.message ?? String(error))
  }
  afterMemberChange()
}

/** 成员变了（包括失败，可能部分生效）：右侧成员列表重查，左侧组列表 / 成员数 / revision 重拉 */
function afterMemberChange(): void {
  ui.notifySourceListChanged()
  void reloadGroups()
}

/** 换到其他组（选目标组，expected=本组） */
async function moveMembers(): Promise<void> {
  const group = selectedGroup.value
  if (!canWrite.value || !group || !selectedIds.value.length) return
  if (!moveTarget.value || moveTarget.value === group.sourceGroupId) {
    ElMessage.warning('请选择目标组（不能是当前组）')
    return
  }
  const targetName = groups.value.find((g) => g.sourceGroupId === moveTarget.value)?.sourceGroupName ?? ''
  try {
    await ElMessageBox.confirm(`把这 ${selectedIds.value.length} 个来源换入「${targetName}」？加入后统一使用目标组流程。`, '确认换组', { type: 'warning' })
  } catch {
    return
  }
  try {
    await sourceGroupApi.changeMembers({ sourceIds: selectedIds.value, sourceGroupId: moveTarget.value, expectedSourceGroupId: group.sourceGroupId })
    ElMessage.success(`已换入 ${selectedIds.value.length} 个来源`)
    moveTarget.value = ''
  } catch (error) {
    ElMessage.error((error as Error)?.message ?? String(error))
  }
  afterMemberChange()
}

/** 打开源：与网站详情「源视图」同一落点（SourceTab.openSourceFromList 同口径） */
function openSource(source: { sourceId: string; siteId?: string }, view: 'overview' | 'data' = 'overview'): void {
  void router.push({
    path: '/canvas',
    query: { ...(source.siteId && source.siteId !== '0' ? { siteId: source.siteId } : {}), sourceId: source.sourceId, view, returnTo: route.fullPath },
  })
}

/** 查看流程节点：拉详情后打开 FlowDetailDrawer */
async function openFlowDetail(flowId: string): Promise<void> {
  try {
    detailFlow.value = await flowCenterApi.detail(flowId)
  } catch (error) {
    ElMessage.error((error as Error)?.message ?? String(error))
  }
}

watch(selectedGroup, () => {
  if (!selectedGroup.value) return
  editingGroup.value = {
    sourceGroupId: selectedGroup.value.sourceGroupId,
    revision: selectedGroup.value.revision,
    sourceGroupCode: selectedGroup.value.sourceGroupCode,
    sourceGroupName: selectedGroup.value.sourceGroupName,
    description: selectedGroup.value.description ?? '',
    state: selectedGroup.value.state,
  }
}, { immediate: true })

onMounted(() => {
  void loadFlows()
  void reloadGroups()
  // 1008-04：从源列表点来源组名跳过来（/settings?tab=source-group&group=<id>）时，选中该组
  const fromQuery = String(route.query.group ?? '')
  if (fromQuery && /^\d+$/.test(fromQuery)) {
    selectedGroupId.value = fromQuery
  }
})
// 同页签内再次点来源组名（tab 没变，KeepAlive 不重挂）：watch query.group 选中新组
watch(() => route.query.group, (id) => {
  if (id != null && /^\d+$/.test(String(id))) selectGroup(String(id))
})
</script>

<template>
  <div class="sg-tab">
    <el-alert
      v-if="!canWrite"
      title="当前账号仅可查看，修改需要管理员权限"
      type="info"
      :closable="false"
      class="sg-perm-alert"
    />
    <div class="sg-body">
      <aside class="sg-nav">
        <div class="sg-heading">
          <strong>来源组</strong>
          <el-button size="small" type="primary" :disabled="!canWrite" data-testid="sg-new" @click="creating = true">新建</el-button>
        </div>
        <div class="sg-list">
          <button
            v-for="g in groups"
            :key="g.sourceGroupId"
            type="button"
            class="sg-item"
            :class="{ active: g.sourceGroupId === selectedGroupId, disabled: g.state !== 'ACTIVE' }"
            @click="selectGroup(g.sourceGroupId)"
          >
            <span>{{ g.sourceGroupName }}<i v-if="g.state !== 'ACTIVE'" class="sg-off">停用</i></span>
            <small>{{ memberCounts[g.sourceGroupId] ?? '…' }}</small>
          </button>
          <div v-if="!groups.length" class="sg-empty">{{ loading ? '加载中…' : '暂无来源组' }}</div>
        </div>
        <p class="sg-note">来源组决定组内源跑哪条流程，修改影响全部成员；只有管理员能修改。</p>
      </aside>
      <section class="sg-content">
        <template v-if="selectedGroup">
          <div class="sg-toolbar">
            <strong>{{ selectedGroup.sourceGroupName }}</strong>
            <span class="sg-id">#{{ selectedGroup.sourceGroupId }}</span>
            <span class="sg-item-state" :class="selectedGroup.state === 'ACTIVE' ? 'on' : ''">{{ selectedGroup.state === 'ACTIVE' ? '启用' : '停用' }}</span>
            <span class="sg-flow" data-testid="sg-default-flow-label">
              默认流程：
              <a v-if="selectedGroup.defaultFlowId" href="javascript:;" @click="openFlowDetail(selectedGroup.defaultFlowId)">{{ flowLabel(selectedGroup.defaultFlowId) }}</a>
              <span v-else class="sg-faint">未配置 / 暂不可用</span>
            </span>
            <div class="sg-actions">
              <el-button
                size="small"
                :disabled="!canWrite || selectedGroup.state !== 'ACTIVE'"
                :title="selectedGroup.state !== 'ACTIVE' ? '组已停用，不能加入新成员' : ''"
                data-testid="sg-add-source"
                @click="pickerVisible = true"
              >添加源</el-button>
              <el-button size="small" data-testid="sg-flow-btn" @click="openFlowDrawer">流程配置</el-button>
              <el-button size="small" data-testid="sg-detail-btn" @click="openDetailDrawer">组资料</el-button>
              <el-button :icon="Refresh" size="small" circle title="刷新" aria-label="刷新" :disabled="loading" @click="reloadGroups" />
            </div>
          </div>
          <SourceOverviewView
            :key="selectedGroup.sourceGroupId"
            current-site-id=""
            :scope-source-group-id="selectedGroup.sourceGroupId"
            scope-empty-text="该来源组还没有成员，可在源列表勾选后「调整来源组」，或点「添加源」"
            @open-source="openSource"
            @open-source-data="openSource($event, 'data')"
            @open-site="router.push({ path: '/canvas', query: { siteId: $event, view: 'source', returnTo: route.fullPath } })"
          >
            <template #selection-actions="{ ids }">
              <el-button size="small" data-testid="sg-remove-members" :disabled="!canWrite || !ids.length" @click="selectedIds = [...ids]; removeMembers()">移出来源组</el-button>
              <el-select
                v-model="moveTarget"
                size="small"
                placeholder="目标组"
                style="width: 150px"
                :disabled="!canWrite"
                data-testid="sg-move-target"
              >
                <el-option
                  v-for="g in groups"
                  :key="g.sourceGroupId"
                  :value="g.sourceGroupId"
                  :label="g.sourceGroupName"
                  :disabled="g.state !== 'ACTIVE' || g.sourceGroupId === selectedGroup.sourceGroupId"
                />
              </el-select>
              <el-button size="small" type="primary" plain data-testid="sg-move-members" :disabled="!canWrite || !ids.length || !moveTarget" @click="selectedIds = [...ids]; moveMembers()">换到其他组</el-button>
            </template>
          </SourceOverviewView>
        </template>
        <el-empty v-else :description="groups.length ? '请选择一个来源组查看成员' : '尚未创建来源组，可点左侧「新建」'" />
      </section>
    </div>

    <!-- 流程配置抽屉 -->
    <el-drawer v-model="flowDrawer" title="流程配置" size="480px" append-to-body>
      <div v-if="selectedGroup" class="sg-drawer-body">
        <el-alert title="组内来源统一使用以下流程，修改影响全部成员；需要单独配置的源请先退组" type="info" :closable="false" show-icon />
        <p class="sg-flow-summary">
          配置默认：{{ flowLabel(defaultFlowId) }} · 当前可用默认：{{ flowLabel(selectedGroup.defaultFlowId) }}
        </p>
        <div class="sg-form-row">
          <label>关联流程（可选多个）</label>
          <el-select
            v-model="flowIds"
            multiple
            filterable
            clearable
            placeholder="选择关联流程"
            style="width: 100%"
            :disabled="!canWrite || selectedGroup.state !== 'ACTIVE'"
            data-testid="sg-flow-ids"
          >
            <el-option v-for="f in flows" :key="f.id" :value="f.id" :label="`${f.name} · ${f.id}`" />
          </el-select>
        </div>
        <div class="sg-form-row">
          <label>默认流程（未指定流程的任务使用此项）</label>
          <el-select
            v-model="defaultFlowId"
            placeholder="从关联流程中选择"
            style="width: 100%"
            :disabled="!canWrite || selectedGroup.state !== 'ACTIVE'"
            data-testid="sg-default-flow"
          >
            <el-option v-for="id in flowIds" :key="id" :value="id" :label="flowLabel(id)" />
          </el-select>
        </div>
        <div class="sg-form-row">
          <el-button
            type="primary"
            :disabled="!canWrite || !groupBindingsLoaded || selectedGroup.state !== 'ACTIVE' || savingFlows"
            :loading="savingFlows"
            data-testid="sg-save-flows"
            @click="saveFlows"
          >保存组流程</el-button>
          <span v-if="selectedGroup.state !== 'ACTIVE'" class="sg-hint">组已停用，请先在「组资料」中启用后修改流程列表。</span>
        </div>
        <el-divider />
        <el-table :data="groupBindings" size="small" :empty-text="groupBindingsLoaded ? '暂无绑定' : '加载中…'" data-testid="sg-binding-table">
          <el-table-column label="流程">
            <template #default="{ row }">{{ flowLabel(row.flowId) }}</template>
          </el-table-column>
          <el-table-column label="默认" width="70">
            <template #default="{ row }">{{ row.isDefault ? '是' : '否' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-switch
                :model-value="row.state === 'ACTIVE'"
                :disabled="!canWrite"
                :aria-label="`切换 ${flowLabel(row.flowId)} 的绑定状态`"
                data-testid="sg-binding-toggle"
                @change="toggleBindingState(row)"
              />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openFlowDetail(row.flowId)">查看流程节点</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-drawer>

    <!-- 组资料抽屉 -->
    <el-drawer v-model="detailDrawer" title="组资料" size="420px" append-to-body>
      <div v-if="editingGroup" class="sg-drawer-body">
        <div class="sg-form-row">
          <label>组编码</label>
          <el-input v-model="editingGroup.sourceGroupCode" :maxlength="64" :disabled="!canWrite" placeholder="字母 / 数字开头，可含 _ -，最长 64 位" data-testid="sg-code" />
        </div>
        <div class="sg-form-row">
          <label>组名称</label>
          <el-input v-model="editingGroup.sourceGroupName" :maxlength="128" :disabled="!canWrite" data-testid="sg-name" />
        </div>
        <div class="sg-form-row">
          <label>描述</label>
          <el-input v-model="editingGroup.description" :maxlength="500" type="textarea" :rows="2" :disabled="!canWrite" />
        </div>
        <div class="sg-form-row">
          <label>状态</label>
          <el-switch v-model="editingGroup.state" active-value="ACTIVE" inactive-value="DISABLED" :disabled="!canWrite" />
          <span class="sg-item-state" :class="editingGroup.state === 'ACTIVE' ? 'on' : ''">{{ editingGroup.state === 'ACTIVE' ? '启用' : '停用' }}</span>
        </div>
        <p class="sg-hint">停用组后，全部成员不能启动新任务。删除组前须先移出全部成员。</p>
        <div class="sg-form-row">
          <el-button type="primary" :disabled="!canWrite || savingGroup" :loading="savingGroup" data-testid="sg-save-detail" @click="saveGroupDetail">保存组资料</el-button>
          <el-button type="danger" plain :disabled="!canWrite" data-testid="sg-remove" @click="removeGroup">删除来源组</el-button>
        </div>
      </div>
    </el-drawer>

    <!-- 新建来源组 -->
    <el-dialog v-model="creating" title="新建来源组" width="460px" append-to-body>
      <div class="sg-form-row">
        <label>组编码</label>
        <el-input v-model="newCode" :maxlength="64" placeholder="字母 / 数字开头，可含 _ -，最长 64 位" data-testid="sg-new-code" />
      </div>
      <div class="sg-form-row">
        <label>组名称</label>
        <el-input v-model="newName" :maxlength="128" data-testid="sg-new-name" />
      </div>
      <div class="sg-form-row">
        <label>描述</label>
        <el-input v-model="newDescription" :maxlength="500" type="textarea" :rows="2" />
      </div>
      <template #footer>
        <el-button @click="creating = false">取消</el-button>
        <el-button type="primary" :disabled="!canWrite || creatingGroup" :loading="creatingGroup" data-testid="sg-new-submit" @click="createGroup">保存新组</el-button>
      </template>
    </el-dialog>

    <!-- 添加源：复用「我的分组」的选源弹窗；backend 模式调 changeMembers 加入本组 -->
    <GroupSourcePicker
      v-if="selectedGroup"
      v-model="pickerVisible"
      :group-id="selectedGroup.sourceGroupId"
      :backend-mode="true"
      @saved="afterMemberChange"
    />

    <FlowDetailDrawer v-if="detailFlow" :flow="detailFlow" @close="detailFlow = null" />
  </div>
</template>

<style scoped>
.sg-tab { display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 0; }
.sg-perm-alert { flex-shrink: 0; }
.sg-body { display: flex; gap: 12px; flex: 1; min-height: 0; }
.sg-nav {
  width: 210px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 12px;
  border: 1px solid var(--rc-border-soft);
  border-radius: 10px;
  background: #fff;
}
.sg-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; }
.sg-list { flex: 1; min-height: 0; overflow-y: auto; margin-top: 12px; display: flex; flex-direction: column; gap: 2px; }
.sg-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--rc-text);
  cursor: pointer;
  text-align: left;
}
.sg-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; }
.sg-item small { color: var(--rc-faint); font-size: 11px; }
.sg-item:hover { background: #f1f5f9; }
.sg-item.active { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.sg-item.disabled { color: var(--rc-faint); }
.sg-off {
  font-style: normal;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: #e2e8f0;
  color: #64748b;
}
.sg-note { font-size: 12px; color: var(--rc-muted); line-height: 1.6; }
.sg-empty { color: var(--rc-faint); font-size: 12px; padding: 12px 8px; text-align: center; }
.sg-content { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.sg-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid var(--rc-border-soft);
  border-radius: 8px;
  margin-bottom: 8px;
  font-size: 13px;
  flex-wrap: wrap;
}
.sg-id { color: var(--rc-faint); font-size: 12px; }
.sg-item-state { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--rc-muted); }
.sg-item-state::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--rc-faint); }
.sg-item-state.on { color: var(--rc-ok); }
.sg-item-state.on::before { background: var(--rc-ok); }
.sg-flow { font-size: 12px; color: var(--rc-text-2); }
.sg-flow a { color: var(--el-color-primary); }
.sg-faint { color: var(--rc-faint); }
.sg-actions { display: flex; margin-left: auto; gap: 8px; }
.sg-drawer-body { display: flex; flex-direction: column; gap: 12px; }
.sg-flow-summary { font-size: 12px; color: var(--rc-text-2); margin: 0; }
.sg-form-row { display: flex; flex-direction: column; gap: 4px; }
.sg-form-row > label { font-size: 12px; color: var(--rc-text-2); }
.sg-hint { font-size: 12px; color: var(--rc-faint); margin: 0; }
.sg-content :deep(.sov-filter.is-compact) { flex-wrap: wrap; }
.sg-content :deep(.sov-filter.is-compact label),
.sg-content :deep(.sov-filter.is-compact .sov-field) { flex: 0 0 auto; }
@media (max-width: 1100px) { .sg-nav { width: 170px; } }
</style>
