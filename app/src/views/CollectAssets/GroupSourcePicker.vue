<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { sourceApi, sourceGroupApi, type Source } from '@/api'
import { useSourceGroupsStore } from '@/stores/sourceGroups'
import GroupJoinConfirmDialog from './GroupJoinConfirmDialog.vue'
import { JOIN_CHECK_MAX, findOwnFlows, joinGroup, joinResultText, type JoinCandidate, type OwnFlowRow } from './groupJoin'
const props = withDefaults(defineProps<{
  modelValue: boolean
  groupId: string
  /** 1008-03 来源组「添加源」：true 时保存走 `source-group/changeMembers` 加入后端来源组，
   *  而不是本机分组 store。选中的源分属不同组时分批提交（changeMembers 一次只接受一个 expected）。
   *  1021-03：先查源自己的流程，有的话弹「入组确认」，确认后先解绑再入组（groupJoin.ts）。 */
  backendMode?: boolean
  /** backend 模式的来源组名（入组确认弹窗标题用；不传显示「组 #ID」） */
  groupName?: string
  /** 「我的视图」添加源（2026-10-12）：不写任何东西，只把选中的源 ID 通过 pick 事件交给父级 */
  pickMode?: boolean
  title?: string
  confirmText?: string
  initialSourceIds?: string[]
  busy?: boolean
  /**
   * 「我的视图」目录版（2026-10-13）：查询条件加「来源组」。选中某个组后列表只列组成员，
   * 上方给出「绑定整个来源组」（emit bindGroup，组里新加的源自动带进视图）；不点就是只勾几个源。
   */
  groupFilter?: boolean
  /** 目标里已经绑定的来源组：选中时提示已绑定，不再给绑定按钮 */
  boundGroups?: string[]
  /**
   * 1016：已绑定来源组里「未在视图」的源（来源组 ID → 源 ID）。后端绑定时只带入组里当时的成员，
   * 之后新加的不会自动进来；选中这样的组时提示数量、行上标「未在视图」，可只看这些并一键全选。
   */
  missingByGroup?: Record<string, string[]>
  /** 打开时预选的来源组 / 是否只看未在视图的源（视图页提示条「查看并加入」进来） */
  initialGroupId?: string
  initialMissingOnly?: boolean
}>(), { backendMode: false, pickMode: false, initialSourceIds: () => [], groupFilter: false, boundGroups: () => [], missingByGroup: () => ({}), initialGroupId: '', initialMissingOnly: false })
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** backendMode 保存成功后通知父级重拉（revision 会变） */
  saved: []
  pick: [ids: string[]]
  bindGroup: [groupId: string]
}>()
const groups = useSourceGroupsStore()
const field = ref<'name' | 'sourceIds'>('name')
const groupId = ref('')
const groupOptions = ref<{ id: string; name: string; state: string }[]>([])
const selectedGroup = computed(() => groupOptions.value.find((g) => g.id === groupId.value))
async function loadGroupOptions() {
  if (!props.groupFilter || groupOptions.value.length) return
  try {
    groupOptions.value = (await sourceGroupApi.list()).map((g) => ({ id: g.sourceGroupId, name: g.sourceGroupName, state: g.state }))
  } catch {
    groupOptions.value = [] // 拉不到就只能按名称 / ID 选源
  }
}
/** 选中的来源组里还没进视图的源 */
const missingIds = computed(() => (groupId.value ? props.missingByGroup[groupId.value] ?? [] : []))
const missingSet = computed(() => new Set(missingIds.value))
const missingOnly = ref(false)
function setMissingOnly(on: boolean) { missingOnly.value = on; search() }
function selectAllMissing() { selected.value = [...new Set([...selected.value, ...missingIds.value])] }
function onGroupChange() { missingOnly.value = false; search() }
function bindSelectedGroup() {
  if (!groupId.value) return
  emit('bindGroup', groupId.value)
  emit('update:modelValue', false)
}
const keyword = ref('')
const page = ref(1)
const size = ref(20)
const total = ref(0)
const rows = ref<Source[]>([])
const selected = ref<string[]>([])
const loading = ref(false)
const error = ref('')
let sequence = 0
async function load() {
  const request = ++sequence
  loading.value = true
  error.value = ''
  try {
    const kw = keyword.value.trim()
    let query: Record<string, string | undefined> = { [field.value]: kw || undefined }
    if (missingOnly.value) {
      // 只看未在视图的：源 ID 限定为这批；按 ID 查时再跟输入的 ID 取交集
      const typed = field.value === 'sourceIds' && kw ? new Set(kw.split(/[,，\s]+/).filter(Boolean)) : null
      const ids = typed ? missingIds.value.filter((id) => typed.has(id)) : missingIds.value
      if (!ids.length) {
        if (request !== sequence) return
        rows.value = []
        total.value = 0
        return
      }
      query = { ...(field.value === 'name' ? { name: kw || undefined } : {}), sourceIds: ids.join(',') }
    }
    const result = await sourceApi.sourcePaged({ page: page.value, size: size.value, ...query, sourceGroupId: groupId.value || undefined })
    if (request !== sequence) return
    rows.value = result.list
    total.value = result.total
    result.list.forEach((r) => seen.set(r.sourceId, r))
  } catch (e) {
    if (request !== sequence) return
    rows.value = []
    total.value = 0
    error.value = e instanceof Error ? e.message : '加载失败，请重试'
  } finally { if (request === sequence) loading.value = false }
}
function search() { page.value = 1; void load() }
watch(() => props.modelValue, open => {
  ++sequence
  if (open) {
    selected.value = [...new Set(props.initialSourceIds)]; keyword.value = ''; page.value = 1
    if (selected.value.length) { field.value = 'sourceIds'; keyword.value = selected.value.join(',') }
    groupId.value = props.groupFilter ? props.initialGroupId : ''
    missingOnly.value = !!groupId.value && props.initialMissingOnly
    void load(); void loadGroupOptions()
  }
}, { immediate: true })
function toggle(id: string) {
  selected.value = selected.value.includes(id) ? selected.value.filter(value => value !== id) : [...selected.value, id]
}
// 表头「全选本页」（2026-10-12）：只动当前页的行，其它页已选的保持不变（跨页保留）
const pageAllSelected = computed(() => rows.value.length > 0 && rows.value.every((r) => selected.value.includes(r.sourceId)))
const pageSomeSelected = computed(() => !pageAllSelected.value && rows.value.some((r) => selected.value.includes(r.sourceId)))
function togglePage(on: boolean) {
  const pageIds = rows.value.map((r) => r.sourceId)
  selected.value = on
    ? [...new Set([...selected.value, ...pageIds])]
    : selected.value.filter((id) => !pageIds.includes(id))
}
/** 翻页看过的行（「已选」跨页保留，入组时要每个源的名称和当前归属） */
const seen = new Map<string, Source>()
/** 勾选的全部源：看过的直接用，没看过的（打开时预选的）按 ID 补查 */
async function selectedSources(): Promise<JoinCandidate[]> {
  const missing = selected.value.filter((id) => !seen.has(id))
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100)
    const result = await sourceApi.sourcePaged({ page: 1, size: chunk.length, sourceIds: chunk.join(',') })
    result.list.forEach((r) => seen.set(r.sourceId, r))
  }
  return selected.value.map((id) => {
    const row = seen.get(id)
    return { sourceId: id, name: row?.name ?? id, sourceGroupId: row?.sourceGroupId ?? null }
  })
}
async function save() {
  if (props.pickMode) {
    emit('pick', [...selected.value])
    emit('update:modelValue', false)
    return
  }
  if (!props.backendMode) {
    try {
      groups.assign(selected.value, [props.groupId])
      ElMessage.success('已加入分组，已有成员自动去重')
      emit('update:modelValue', false)
    } catch (e) { ElMessage.error(e instanceof Error ? e.message : '本机保存失败') }
    return
  }
  // backend 模式：先查自有流程 → 有就弹入组确认 → 先解绑再入组（1021-03）
  if (selected.value.length > JOIN_CHECK_MAX) {
    ElMessage.warning(`一次最多加入 ${JOIN_CHECK_MAX} 个源（要逐个检查源自己的流程），请分批勾选`)
    return
  }
  joining.value = true
  try {
    joinSources.value = (await selectedSources()).filter((s) => s.sourceGroupId !== props.groupId)
    const own = await findOwnFlows(joinSources.value)
    if (own.length) ownRows.value = own
    else await runJoin([])
  } catch (e) {
    ElMessage.error(`检查源的流程失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    joining.value = false
  }
}
const joining = ref(false)
const joinSources = ref<JoinCandidate[]>([])
const ownRows = ref<OwnFlowRow[] | null>(null)
async function runJoin(excludeIds: string[]) {
  joining.value = true
  try {
    const skip = new Set(excludeIds)
    const result = await joinGroup({
      groupId: props.groupId,
      sources: joinSources.value.filter((s) => !skip.has(s.sourceId)),
      unbindIds: (ownRows.value ?? []).map((r) => r.sourceId).filter((id) => !skip.has(id)),
    })
    ownRows.value = null
    if (result.failures.length) ElMessage.error(joinResultText(result))
    else ElMessage.success(`${joinResultText(result)}${skip.size ? `，${skip.size} 个源未加入` : ''}`)
    // 前面几批已经生效，失败了父级照样要重拉
    if (result.joined) emit('saved')
    if (!result.failures.length) emit('update:modelValue', false)
  } finally {
    joining.value = false
  }
}
</script>
<template>
  <el-dialog :model-value="modelValue" :title="title || '选择源加入分组'" width="980px" style="max-width: calc(100vw - 32px)" append-to-body :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy" @update:model-value="emit('update:modelValue', $event)">
    <div class="picker-layout" :class="{ 'with-aside': $slots.aside }" :inert="busy">
    <aside v-if="$slots.aside" class="picker-aside"><slot name="aside" /></aside>
    <div class="picker-main">
    <div class="picker-filter">
      <el-select v-if="groupFilter" v-model="groupId" clearable placeholder="全部来源组" style="width: 160px" aria-label="来源组" data-testid="picker-group" @change="onGroupChange">
        <el-option v-for="g in groupOptions" :key="g.id" :label="g.name" :value="g.id" :disabled="g.state !== 'ACTIVE'" />
      </el-select>
      <el-select v-model="field" style="width: 110px" aria-label="查询字段"><el-option label="源名称" value="name" /><el-option label="源 ID" value="sourceIds" /></el-select>
      <el-input v-model="keyword" :placeholder="field === 'sourceIds' ? '多个源 ID 用逗号分隔' : '输入源名称'" clearable @keyup.enter="search" />
      <el-button type="primary" @click="search">查询</el-button>
    </div>
    <div v-if="groupFilter && selectedGroup" class="picker-bind" data-testid="picker-bind-bar">
      <template v-if="boundGroups.includes(selectedGroup.id)">
        <span v-if="missingIds.length" data-testid="picker-missing-hint">
          来源组「{{ selectedGroup.name }}」已绑定在这里，其中 <b>{{ missingIds.length }} 个源还没在这里</b>（绑定时只带入组里当时的源，之后新加的需要勾选加入）。
        </span>
        <span v-else>来源组「{{ selectedGroup.name }}」已绑定在这里，组里的源都已在这里。</span>
        <template v-if="missingIds.length">
          <el-button size="small" data-testid="picker-missing-only" @click="setMissingOnly(!missingOnly)">{{ missingOnly ? '看组里全部源' : `只看未在这里的 ${missingIds.length} 个源` }}</el-button>
          <el-button size="small" type="primary" plain data-testid="picker-select-missing" @click="selectAllMissing">全部勾选这 {{ missingIds.length }} 个源</el-button>
        </template>
      </template>
      <template v-else>
        <span>来源组「{{ selectedGroup.name }}」共 {{ total }} 个源。<b>绑定整个来源组</b>：带入组里现有的源，之后组里新加的源会在视图里提示，勾选后加入；或者在下面只勾需要的几个源。</span>
        <el-button size="small" data-testid="picker-bind-group" @click="bindSelectedGroup">绑定整个来源组</el-button>
      </template>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-table v-loading="loading" :data="rows" :max-height="'calc(100vh - 340px)'" size="small" row-key="sourceId">
      <el-table-column width="42">
        <template #header><el-checkbox :model-value="pageAllSelected" :indeterminate="pageSomeSelected" :disabled="!rows.length" aria-label="全选本页" title="全选本页" data-testid="picker-select-page" @change="togglePage(!!$event)" /></template>
        <template #default="{ row }"><el-checkbox :model-value="selected.includes(row.sourceId)" :aria-label="`选择 ${row.name}`" @change="toggle(row.sourceId)" /></template></el-table-column>
      <el-table-column prop="sourceId" label="源 ID" :width="$slots.aside ? 100 : 120" />
      <el-table-column label="源名称" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">{{ row.name }}<el-tag v-if="missingSet.has(row.sourceId)" size="small" type="warning" effect="plain" class="picker-missing-tag" data-testid="picker-missing-tag">未在这里</el-tag></template>
      </el-table-column>
      <el-table-column prop="siteId" label="网站 ID" width="100" />
      <el-table-column prop="url" label="URL" :min-width="$slots.aside ? 140 : 200" show-overflow-tooltip />
    </el-table>
    <el-pagination v-model:current-page="page" v-model:page-size="size" :total="total" :page-sizes="[20, 40, 100]" layout="total, sizes, prev, pager, next" small @current-change="load" @size-change="search" />
    </div>
    </div>
    <template #footer><div class="picker-footer"><span>已选 {{ selected.length }} 个源（跨页保留）</span><el-button :icon="Refresh" circle size="small" :disabled="busy" aria-label="刷新源列表" title="刷新源列表" @click="load" /><el-button :disabled="busy" @click="emit('update:modelValue', false)">取消</el-button><slot name="submit" :ids="selected"><el-button type="primary" :disabled="!selected.length" :loading="joining" data-testid="picker-save" @click="save">{{ confirmText || '加入分组' }}</el-button></slot></div></template>
  </el-dialog>
  <GroupJoinConfirmDialog
    v-if="ownRows"
    :group-id="props.groupId"
    :group-name="groupName || `组 #${props.groupId}`"
    :rows="ownRows"
    :direct-count="joinSources.length - ownRows.length"
    :busy="joining"
    @back="ownRows = null"
    @close="ownRows = null"
    @confirm="runJoin"
  />
</template>
<style scoped>
.picker-layout.with-aside { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 16px; }
.picker-main { min-width: 0; }
.picker-aside { min-width: 0; padding-right: 12px; border-right: 1px solid var(--rc-border); }
@media (max-width: 760px) {
  .picker-layout.with-aside { grid-template-columns: minmax(0, 1fr); }
  .picker-aside { padding-right: 0; border-right: 0; }
}
.picker-filter { display: flex; gap: 8px; margin-bottom: 12px; }
.picker-filter .el-input { flex: 1; }
.picker-bind { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding: 8px 12px; border-radius: 8px; background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; font-size: 12px; }
.picker-bind { flex-wrap: wrap; }
.picker-bind span { flex: 1 1 320px; }
.picker-missing-tag { margin-left: 6px; }
.picker-footer { display: flex; gap: 8px; align-items: center; justify-content: flex-end; }
.picker-footer span { margin-right: auto; color: var(--rc-muted); }
.el-pagination { margin-top: 12px; }
</style>
