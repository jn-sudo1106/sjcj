<script setup lang="ts">
// 流程选择弹窗：候选是全部现有流程，包含已标记为模板的流程。
// 两种查法，列表各以查的对象为主：
//   - 按流程：列流程（名称 / ID 查），选中即选这条流程；
//   - 按源：列源（源 ID / 名称查，默认分页列全部源），每行带它的所属流程，选中即选该源的所属流程。
// 只负责选择；复制新建、关联或更换由调用方完成。
import { computed, defineComponent, h, reactive, watch } from 'vue'
import { ElDialog } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import FlowReadonlyPreview from './FlowReadonlyPreview.vue'
import ResizableFlowSplit from './ResizableFlowSplit.vue'
import { flowCenterApi, sourceApi, type FlowRecord, type Source } from '@/api'
import { parseIdList } from '@/utils/flow/flowSearch'
import { nodeCountText, nodeCountTitle, useFlowNodeCounts } from '@/utils/flow/flowNodeCounts'
import { validFlowIdOf } from '@/utils/flow/stepPersist'

const props = defineProps<{
  modelValue: boolean
  /** 在已有操作弹窗内展示选择内容，不再创建另一层弹窗。 */
  embedded?: boolean
  busy?: boolean
  /** 本源当前所属流程：列出来但不可选（换成自己没有意义） */
  currentFlowId?: string
  /** 这些流程列出但不可选，标「已关联」（复用现有流程时排除本源已关联的） */
  excludeFlowIds?: string[]
  purpose?: 'replace' | 'bind' | 'copy'
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  pick: [flow: FlowRecord]
}>()

const state = reactive({
  mode: 'flow' as 'flow' | 'source',
  keyword: '',
  page: 1,
  size: 20,
  total: 0,
  loading: false,
  error: '',
  /** 按流程：流程列表 */
  flows: [] as FlowRecord[],
  /** 按源：源列表 + 这一页源的所属流程（流程 ID → 流程） */
  sources: [] as Source[],
  flowById: {} as Record<string, FlowRecord>,
  picked: null as FlowRecord | null,
  /** 按源时记下选的是哪一行源（多个源可能同属一条流程，高亮只标点中的那行） */
  pickedSourceId: '',
})

const { counts: nodeCounts, load: loadNodeCounts } = useFlowNodeCounts()
let seq = 0

async function loadFlows(reqId: number) {
  const raw = state.keyword.trim()
  const ids = raw ? parseIdList(raw) : null
  const result = await flowCenterApi.paged({
    page: state.page,
    size: state.size,
    field: 'createDt',
    order: 'desc',
    ...(ids ? { flowIds: ids } : { keywords: raw || undefined }),
  })
  if (reqId !== seq) return
  state.flows = result.list
  void loadNodeCounts(result.list)
  state.total = result.total
}

async function loadSources(reqId: number) {
  const raw = state.keyword.trim()
  const ids = raw ? parseIdList(raw) : null
  const result = await sourceApi.sourcePaged({
    page: state.page,
    size: state.size,
    ...(ids ? { sourceIds: ids } : raw ? { name: raw } : {}),
  })
  if (reqId !== seq) return
  const flowIds = [...new Set(result.list.map((s) => validFlowIdOf(s.flowId)).filter((id): id is string => !!id))]
  const flows = flowIds.length
    ? (await flowCenterApi.paged({ page: 1, size: flowIds.length, flowIds })).list
    : []
  if (reqId !== seq) return
  state.sources = result.list
  state.total = result.total
  state.flowById = Object.fromEntries(flows.map((f) => [f.id, f]))
}

async function load() {
  const reqId = ++seq
  state.loading = true
  state.error = ''
  try {
    await (state.mode === 'flow' ? loadFlows(reqId) : loadSources(reqId))
  } catch (e) {
    if (reqId !== seq) return
    state.flows = []
    state.sources = []
    state.total = 0
    state.error = `查询失败：${(e as Error)?.message ?? String(e)}`
  } finally {
    if (reqId === seq) state.loading = false
  }
}

function search() {
  state.page = 1
  state.picked = null
  state.pickedSourceId = ''
  void load()
}
function switchMode() {
  state.keyword = ''
  search()
}

watch(() => props.modelValue, (open) => {
  if (!open) return
  state.mode = 'flow'
  state.keyword = ''
  search()
}, { immediate: true })

function flowSelectable(f: FlowRecord | undefined): f is FlowRecord {
  return !!f && f.id !== props.currentFlowId && !props.excludeFlowIds?.includes(f.id) && !f.disabled
}
function flowOfSource(s: Source): FlowRecord | undefined {
  const id = validFlowIdOf(s.flowId)
  return id ? state.flowById[id] : undefined
}

function onFlowRowClick(row: FlowRecord) {
  if (!flowSelectable(row)) return
  state.picked = row
}
function onSourceRowClick(row: Source) {
  const f = flowOfSource(row)
  if (!flowSelectable(f)) return
  state.picked = f
  state.pickedSourceId = row.sourceId
}
function flowRowClass({ row }: { row: FlowRecord }) {
  if (!flowSelectable(row)) return 'rfd-row-off'
  return state.picked?.id === row.id ? 'rfd-row-picked' : ''
}
function sourceRowClass({ row }: { row: Source }) {
  if (!flowSelectable(flowOfSource(row))) return 'rfd-row-off'
  return state.pickedSourceId === row.sourceId ? 'rfd-row-picked' : ''
}
/** 所属流程列的附注：当前 / 已关联 / 已禁用 / 模板 */
function flowTag(f: FlowRecord | undefined) {
  if (!f) return ''
  if (f.id === props.currentFlowId) return '当前'
  if (props.excludeFlowIds?.includes(f.id)) return '已关联'
  if (f.disabled) return '已禁用'
  return f.isTemplate ? '模板' : ''
}

const placeholder = computed(() => (state.mode === 'flow'
  ? '流程 ID / 名称，多个 ID 用逗号分隔'
  : '源 ID / 源名称，多个 ID 用逗号分隔'))
const emptyText = computed(() => state.error || (state.mode === 'flow' ? '没有匹配的流程' : '没有匹配的源'))
const dialogTitle = computed(() => props.purpose === 'bind'
  ? '关联已有流程'
  : props.purpose === 'copy' ? '从流程或模板新建' : '更换流程')
const dialogHint = computed(() => props.purpose === 'bind'
  ? '关联后与其他源共用同一流程，修改流程可能影响其他源；关联后可在流程列表中设置主流程。'
  : props.purpose === 'copy'
    ? '复制优先使用已发布版本；没有发布版时使用草稿。节点配置复制为独立一份，修改副本不影响原流程。'
    : '选中的流程会整条复制一份作为本源的新流程，原流程不动；确认时可选择新增一套配置或复用原配置。')
const confirmText = computed(() => props.purpose === 'bind'
  ? '关联此流程'
  : props.purpose === 'copy' ? '以此新建' : '更换为此流程')

const InlinePicker = defineComponent({
  inheritAttrs: false,
  setup(_, { slots }) {
    return () => h('div', { class: 'rfd-embedded' }, [slots.default?.(), h('div', { class: 'rfd-inline-footer' }, slots.footer?.())])
  },
})

function close() {
  emit('update:modelValue', false)
}
function confirm() {
  if (state.picked) emit('pick', state.picked)
}
</script>

<template>
  <component
    :is="embedded ? InlinePicker : ElDialog"
    :model-value="modelValue"
    class="rfd-dialog"
    :title="dialogTitle"
    width="min(1440px, calc(100vw - 32px))"
    append-to-body
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <p class="rfd-hint">{{ dialogHint }}</p>
    <div class="rfd-toolbar">
      <select v-model="state.mode" class="rfd-input rfd-mode" aria-label="查询方式" data-testid="replace-flow-mode" @change="switchMode">
        <option value="flow">按流程</option>
        <option value="source">按源</option>
      </select>
      <input
        v-model="state.keyword"
        class="rfd-input rfd-keyword"
        :placeholder="placeholder"
        aria-label="查询关键字"
        data-testid="replace-flow-keyword"
        @keyup.enter="search"
      />
      <button class="rc-btn primary" type="button" data-testid="replace-flow-query" @click="search">查询</button>
      <span class="rfd-spacer" />
      <button class="rfd-refresh" type="button" title="刷新" aria-label="刷新" @click="load">
        <el-icon><Refresh /></el-icon>
      </button>
    </div>

    <ResizableFlowSplit class="rfd-content" :initial-width="390">
    <template #left>
    <div class="rfd-list">
    <el-table
      v-if="state.mode === 'flow'"
      v-loading="state.loading"
      class="rfd-table"
      :data="state.flows"
      :empty-text="emptyText"
      :row-class-name="flowRowClass"
      height="100%"
      data-testid="replace-flow-table"
      @row-click="onFlowRowClick"
    >
      <el-table-column width="34" align="center">
        <template #default="{ row }">
          <input type="radio" name="replace-flow" :checked="state.picked?.id === row.id" :disabled="!flowSelectable(row)" :aria-label="`选择流程 ${row.name}`" />
        </template>
      </el-table-column>
      <el-table-column label="流程名称 / ID" min-width="100">
        <template #default="{ row }">
          <span class="rfd-name">{{ row.name }}</span>
          <span v-if="flowTag(row)" class="rfd-tag" :class="{ tpl: flowTag(row) === '模板' }">{{ flowTag(row) }}</span>
          <small class="rfd-id rfd-muted">{{ row.id }}</small>
        </template>
      </el-table-column>
      <el-table-column label="节点" width="48" align="right">
        <template #default="{ row }"><span :title="nodeCountTitle(nodeCounts, row.id)">{{ nodeCountText(nodeCounts, row.id) }}</span></template>
      </el-table-column>
      <el-table-column label="源数" width="52" align="right">
        <template #default="{ row }">{{ row.sourceCnt ?? '—' }}</template>
      </el-table-column>
    </el-table>

    <el-table
      v-else
      v-loading="state.loading"
      class="rfd-table"
      :data="state.sources"
      :empty-text="emptyText"
      :row-class-name="sourceRowClass"
      height="100%"
      data-testid="replace-flow-table"
      @row-click="onSourceRowClick"
    >
      <el-table-column width="34" align="center">
        <template #default="{ row }">
          <input
            type="radio"
            name="replace-flow"
            :checked="state.pickedSourceId === row.sourceId"
            :disabled="!flowSelectable(flowOfSource(row))"
            :aria-label="`选择源 ${row.name} 的所属流程`"
          />
        </template>
      </el-table-column>
      <el-table-column label="源名称 / 源 ID" min-width="100">
        <template #default="{ row }"><span class="rfd-name">{{ row.name }}</span><small class="rfd-id rfd-muted">{{ row.sourceId }}</small></template>
      </el-table-column>
      <el-table-column label="所属流程" min-width="100">
        <template #default="{ row }">
          <template v-if="flowOfSource(row)">
            <span class="rfd-name" :title="flowOfSource(row)!.name">{{ flowOfSource(row)!.name }}</span>
            <small class="rfd-id rfd-muted">{{ flowOfSource(row)!.id }}</small>
            <span v-if="flowTag(flowOfSource(row))" class="rfd-tag" :class="{ tpl: flowTag(flowOfSource(row)) === '模板' }">{{ flowTag(flowOfSource(row)) }}</span>
          </template>
          <span v-else class="rfd-muted">无所属流程</span>
        </template>
      </el-table-column>
    </el-table>

    <div class="rfd-pager">
      <el-pagination
        v-model:current-page="state.page"
        v-model:page-size="state.size"
        :total="state.total"
        :page-sizes="[20, 40, 100]"
        layout="prev, pager, next"
        background
        size="small"
        @current-change="load"
        @size-change="search"
      />
    </div>

    </div>
    </template>
    <template #right><FlowReadonlyPreview class="rfd-preview" :flow="state.picked" /></template>
    </ResizableFlowSplit>

    <template #footer>
      <span v-if="state.picked" class="rfd-picked">
        已选：{{ state.picked.name }}（#{{ state.picked.id }}）
      </span>
      <button class="rc-btn" type="button" :disabled="busy" @click="close">{{ embedded ? '返回' : '取消' }}</button>
      <button
        class="rc-btn primary rfd-confirm"
        type="button"
        data-testid="replace-flow-confirm"
        :disabled="!state.picked || busy"
        @click="confirm"
      >{{ confirmText }}</button>
    </template>
  </component>
</template>

<style scoped>
:deep(.rfd-inline-footer) { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.rfd-content { height:min(610px, calc(100vh - 270px)); min-height:300px; }
.rfd-list { display:flex; flex-direction:column; height:100%; min-height:0; min-width:0; }
.rfd-table { flex:1; min-height:0; font-size:12px; }
.rfd-preview { min-width:0; }
.rfd-hint { margin: 0 0 10px; font-size: 12px; color: var(--rc-muted); }
.rfd-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.rfd-input { height: 28px; box-sizing: border-box; padding: 0 8px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; font-size: 13px; color: var(--rc-text); }
.rfd-mode { width: 88px; }
.rfd-keyword { width: 300px; max-width: 45%; }
.rfd-spacer { flex: 1; }
.rfd-refresh { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 1px solid #d5e2f2; border-radius: 7px; background: #fff; color: var(--rc-text-2); cursor: pointer; }
.rfd-refresh:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rfd-table :deep(.el-table__row) { cursor: pointer; }
.rfd-table :deep(.rfd-row-off) { cursor: default; color: var(--rc-faint); }
.rfd-table :deep(.rfd-row-picked > td) { background: var(--rc-primary-bg) !important; }
.rfd-mono { font-variant-numeric: tabular-nums; }
.rfd-name { font-weight: 600; overflow-wrap:anywhere; white-space:normal; }
.rfd-id { display:block; overflow-wrap:anywhere; font-size:12px; line-height:1.4; }
.rfd-table :deep(.cell) { padding-left:4px; padding-right:4px; white-space:normal; overflow-wrap:anywhere; line-height:1.45; }
.rfd-tag { margin-left: 6px; padding: 0 5px; border: 1px solid var(--rc-border); border-radius: 4px; font-size: 11px; color: var(--rc-muted); }
.rfd-tag.tpl { border-color: #bfdbfe; color: var(--rc-primary-ink); }
.rfd-ellipsis { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rfd-muted { color: var(--rc-muted); }
.rfd-pager { display: flex; justify-content: flex-end; margin-top: 10px; }
.rfd-picked { margin-right: auto; font-size: 12px; color: var(--rc-text-2); }
/* rc-btn 全局没有禁用态：没选流程时确认按钮要看得出不可点 */
.rfd-confirm:disabled { opacity: 0.45; cursor: not-allowed; pointer-events: none; }
</style>

<style>
/* append-to-body 后弹窗外框不在本组件作用域内，外框样式只能不带 scoped（类名已加前缀防冲突） */
.el-dialog.rfd-dialog { max-width: calc(100vw - 32px); margin: 3vh auto; }
.rfd-dialog .el-dialog__footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
</style>
