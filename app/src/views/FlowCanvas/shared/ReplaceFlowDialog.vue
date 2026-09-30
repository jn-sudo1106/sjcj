<script setup lang="ts">
// 画布「更换流程」的选择弹窗（0930）：候选是**全部流程**（「套用流程模板」只列模板）。
// 两种查法，列表各以查的对象为主：
//   - 按流程：列流程（名称 / ID 查），选中即选这条流程；
//   - 按源：列源（源 ID / 名称查，默认分页列全部源），每行带它的所属流程，选中即选该源的所属流程。
// 只负责选，复制 + 换绑由 CanvasHeader 调 copyFlowToSource 完成。
import { computed, reactive, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { flowCenterApi, sourceApi, type FlowRecord, type Source } from '@/api'
import { parseIdList } from '@/utils/flow/flowSearch'
import { validFlowIdOf } from '@/utils/flow/stepPersist'

const props = defineProps<{
  modelValue: boolean
  /** 本源当前所属流程：列出来但不可选（换成自己没有意义） */
  currentFlowId?: string
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
  return !!f && f.id !== props.currentFlowId && !f.disabled
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
/** 所属流程列的附注：当前 / 已禁用 / 模板 */
function flowTag(f: FlowRecord | undefined) {
  if (!f) return ''
  if (f.id === props.currentFlowId) return '当前'
  if (f.disabled) return '已禁用'
  return f.isTemplate ? '模板' : ''
}

const placeholder = computed(() => (state.mode === 'flow'
  ? '流程 ID / 名称，多个 ID 用逗号分隔'
  : '源 ID / 源名称，多个 ID 用逗号分隔'))
const emptyText = computed(() => state.error || (state.mode === 'flow' ? '没有匹配的流程' : '没有匹配的源'))

function close() {
  emit('update:modelValue', false)
}
function confirm() {
  if (state.picked) emit('pick', state.picked)
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    class="rfd-dialog"
    title="更换流程"
    width="860px"
    append-to-body
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <p class="rfd-hint">选中的流程会整条复制一份作为本源的新流程，节点配置各自独立；原流程不动。</p>
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

    <el-table
      v-if="state.mode === 'flow'"
      v-loading="state.loading"
      class="rfd-table"
      :data="state.flows"
      :empty-text="emptyText"
      :row-class-name="flowRowClass"
      height="min(400px, calc(100vh - 330px))"
      data-testid="replace-flow-table"
      @row-click="onFlowRowClick"
    >
      <el-table-column width="52" align="center">
        <template #default="{ row }">
          <input type="radio" name="replace-flow" :checked="state.picked?.id === row.id" :disabled="!flowSelectable(row)" :aria-label="`选择流程 ${row.name}`" />
        </template>
      </el-table-column>
      <el-table-column label="流程 ID" width="110">
        <template #default="{ row }"><span class="rfd-mono">{{ row.id }}</span></template>
      </el-table-column>
      <el-table-column label="名称" min-width="260">
        <template #default="{ row }">
          <span class="rfd-name" :title="row.name">{{ row.name }}</span>
          <span v-if="flowTag(row)" class="rfd-tag" :class="{ tpl: flowTag(row) === '模板' }">{{ flowTag(row) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="使用源数" width="90" align="right">
        <template #default="{ row }">{{ row.sourceCnt ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="更新时间" width="170">
        <template #default="{ row }"><span class="rfd-muted">{{ row.updatedAt || '—' }}</span></template>
      </el-table-column>
    </el-table>

    <el-table
      v-else
      v-loading="state.loading"
      class="rfd-table"
      :data="state.sources"
      :empty-text="emptyText"
      :row-class-name="sourceRowClass"
      height="min(400px, calc(100vh - 330px))"
      data-testid="replace-flow-table"
      @row-click="onSourceRowClick"
    >
      <el-table-column width="52" align="center">
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
      <el-table-column label="源 ID" width="110">
        <template #default="{ row }"><span class="rfd-mono">{{ row.sourceId }}</span></template>
      </el-table-column>
      <el-table-column label="源名称" min-width="220">
        <template #default="{ row }"><span class="rfd-ellipsis" :title="row.name">{{ row.name }}</span></template>
      </el-table-column>
      <el-table-column label="所属流程" min-width="260">
        <template #default="{ row }">
          <template v-if="flowOfSource(row)">
            <span class="rfd-name" :title="flowOfSource(row)!.name">{{ flowOfSource(row)!.name }}</span>
            <span class="rfd-muted rfd-mono"> #{{ flowOfSource(row)!.id }}</span>
            <span v-if="flowTag(flowOfSource(row))" class="rfd-tag" :class="{ tpl: flowTag(flowOfSource(row)) === '模板' }">{{ flowTag(flowOfSource(row)) }}</span>
          </template>
          <span v-else class="rfd-muted">无所属流程</span>
        </template>
      </el-table-column>
      <el-table-column label="流程使用源数" width="110" align="right">
        <template #default="{ row }">{{ flowOfSource(row)?.sourceCnt ?? '—' }}</template>
      </el-table-column>
    </el-table>

    <div class="rfd-pager">
      <el-pagination
        v-model:current-page="state.page"
        v-model:page-size="state.size"
        :total="state.total"
        :page-sizes="[20, 40, 100]"
        layout="total, sizes, prev, pager, next"
        background
        small
        @current-change="load"
        @size-change="search"
      />
    </div>

    <template #footer>
      <span v-if="state.picked" class="rfd-picked">已选：{{ state.picked.name }}（#{{ state.picked.id }}）</span>
      <button class="rc-btn" type="button" @click="close">取消</button>
      <button
        class="rc-btn primary rfd-confirm"
        type="button"
        data-testid="replace-flow-confirm"
        :disabled="!state.picked"
        @click="confirm"
      >更换为此流程</button>
    </template>
  </el-dialog>
</template>

<style scoped>
.rfd-hint { margin: 0 0 10px; font-size: 12px; color: var(--rc-muted); }
.rfd-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.rfd-input { height: 28px; box-sizing: border-box; padding: 0 8px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; font-size: 13px; color: var(--rc-text); }
.rfd-mode { width: 88px; }
.rfd-keyword { width: 300px; }
.rfd-spacer { flex: 1; }
.rfd-refresh { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 1px solid #d5e2f2; border-radius: 7px; background: #fff; color: var(--rc-text-2); cursor: pointer; }
.rfd-refresh:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rfd-table :deep(.el-table__row) { cursor: pointer; }
.rfd-table :deep(.rfd-row-off) { cursor: default; color: var(--rc-faint); }
.rfd-table :deep(.rfd-row-picked > td) { background: var(--rc-primary-bg) !important; }
.rfd-mono { font-variant-numeric: tabular-nums; }
.rfd-name { font-weight: 600; }
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
.el-dialog.rfd-dialog { max-width: calc(100vw - 48px); margin: 5vh auto; }
.rfd-dialog .el-dialog__footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
</style>
