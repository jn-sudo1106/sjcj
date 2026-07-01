<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useFlowStore } from '../../stores/flow'
import { dataApi, type DataTableMeta, type DataRow } from '../../api'
import { iconFor } from './flowModel'
import CanvasHeader from './CanvasHeader.vue'
import DataGrid from './DataGrid.vue'

const flow = useFlowStore()
const router = useRouter()

// 横向流程图节点：把 horizontalLayout 的节点投射为带"是否数据节点"标记
interface BarNode {
  id: string
  title: string
  icon: string
  outputTable: string
  selectable: boolean
  pos: { left: number; top: number; width: number; height: number }
  branch: boolean
}
const hlayout = computed(() => flow.horizontalLayout)

// 节点条高度：默认跟随 layout 计算结果；用户可拖动分隔条调整
const barHeight = ref<number | null>(null)
const effectiveBarHeight = computed(() => barHeight.value ?? hlayout.value.totalHeight)
watch(
  () => hlayout.value.totalHeight,
  (h) => {
    if (barHeight.value == null) barHeight.value = h
  },
  { immediate: true },
)
let resizeStart = 0
let resizeStartH = 0
function onResizeMove(e: MouseEvent) {
  const next = Math.max(60, Math.min(window.innerHeight * 0.6, resizeStartH + (e.clientY - resizeStart)))
  barHeight.value = next
}
function onResizeEnd() {
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
}
function onResizeStart(e: MouseEvent) {
  e.preventDefault()
  resizeStart = e.clientY
  resizeStartH = effectiveBarHeight.value
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'row-resize'
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeEnd)
}
onBeforeUnmount(onResizeEnd)
const bar = computed<BarNode[]>(() =>
  hlayout.value.nodes.map((n) => {
    const table = n.cfg.collectCfg?.outputTable || n.cfg.outputTable || ''
    return {
      id: n.id,
      title: n.cfg.title,
      icon: iconFor(n.cfg),
      outputTable: table,
      selectable: !!table,
      pos: n.pos,
      branch: n.branch,
    }
  }),
)
const dataNodes = computed(() => bar.value.filter((n) => n.selectable))
const selectedNodeId = ref<string>('')
const page = ref(1)

// 默认选首个数据节点；切换 sourceId 后旧节点 id 不在新流程里时也重置，避免表格变空
watch(
  dataNodes,
  (nodes) => {
    if (!nodes.some((n) => n.id === selectedNodeId.value)) {
      selectedNodeId.value = nodes[0]?.id ?? ''
      page.value = 1
    }
  },
  { immediate: true },
)
const selectedTable = computed(() => bar.value.find((n) => n.id === selectedNodeId.value)?.outputTable ?? '')

function pickNode(n: BarNode) {
  if (!n.selectable) return
  selectedNodeId.value = n.id
}

// 表元 + 数据
const meta = ref<DataTableMeta | null>(null)
const rows = ref<DataRow[]>([])
const total = ref(0)
const loading = ref(false)
const filters = reactive({ dataId: '', parentId: '', state: '', sql: '' })
const size = 20

async function loadData() {
  if (!selectedTable.value) {
    meta.value = null
    rows.value = []
    total.value = 0
    return
  }
  loading.value = true
  try {
    meta.value = await dataApi.tableMeta(selectedTable.value)
    const res = await dataApi.rowQueryPaged({
      tableId: selectedTable.value,
      sourceId: flow.sourceCtx?.sourceId ?? '',
      dataId: filters.dataId || undefined,
      parentId: filters.parentId || undefined,
      state: filters.state || undefined,
      sql: filters.sql || undefined,
      page: page.value,
      size,
    })
    rows.value = res?.list ?? []
    total.value = res?.total ?? 0
  } finally {
    loading.value = false
  }
}
watch([selectedTable, page], loadData, { immediate: false })
onMounted(loadData)

function runQuery() {
  page.value = 1
  loadData()
}
function clearFilters() {
  filters.dataId = ''
  filters.parentId = ''
  filters.state = ''
  filters.sql = ''
  runQuery()
}
function prevPage() {
  if (page.value > 1) page.value -= 1
}
function nextPage() {
  if (page.value * size < total.value) page.value += 1
}

// 详情 drawer
const detail = reactive<{ visible: boolean; row: DataRow | null }>({ visible: false, row: null })
function onRowClick(r: DataRow) {
  detail.row = r
  detail.visible = true
  editing.value = false
}
function onRowAction(r: DataRow, cmd: string) {
  if (cmd === 'detail') {
    detail.row = r
    detail.visible = true
    editing.value = false
  } else if (cmd === 'tasks') {
    router.push({ path: '/runs', query: { dataId: r.dataId } })
  }
}

// 行操作的"详情"复用列内容；为人类可读，做一份 prop → desc 映射
const detailFields = computed(() => {
  if (!detail.row || !meta.value) return [] as { label: string; prop: string; value: string }[]
  return meta.value.fields.map((f) => ({
    label: `${f.desc}（${f.prop}）`,
    prop: f.prop,
    value: String(detail.row?.values?.[f.prop] ?? '—'),
  }))
})

// 行编辑（Phase 4.4）
const editing = ref(false)
const editValues = reactive<Record<string, string>>({})
const saving = ref(false)
function startEdit() {
  if (!detail.row) return
  Object.keys(editValues).forEach((k) => delete editValues[k])
  detailFields.value.forEach((f) => { editValues[f.prop] = String(detail.row?.values?.[f.prop] ?? '') })
  editing.value = true
}
function cancelEdit() {
  editing.value = false
}
async function saveEdit() {
  if (!detail.row || !selectedTable.value) return
  saving.value = true
  try {
    const res = await dataApi.rowUpdate(selectedTable.value, detail.row.dataId, { ...editValues })
    if (res?.row) {
      detail.row.values = res.row.values
      const idx = rows.value.findIndex((r) => r.dataId === detail.row?.dataId)
      if (idx >= 0) rows.value[idx] = { ...rows.value[idx], values: res.row.values }
    }
    ElMessage.success(res?.message || '已保存')
    editing.value = false
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="rv-shell">
    <CanvasHeader />

    <div class="rv-bar" :style="{ height: effectiveBarHeight + 'px' }">
      <div class="rv-bar-canvas" :style="{ width: hlayout.totalWidth + 'px', height: hlayout.totalHeight + 'px' }">
        <svg :width="hlayout.totalWidth" :height="hlayout.totalHeight" aria-hidden="true">
          <defs>
            <marker id="rv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="#94a3b8" />
            </marker>
          </defs>
          <path v-for="(e, i) in hlayout.mainEdges" :key="'m' + i" :d="e.d" class="rv-edge" :class="{ rule: e.rule }" marker-end="url(#rv-arrow)" />
          <path v-for="(e, i) in hlayout.branchEdges" :key="'b' + i" :d="e.d" class="rv-edge dashed" marker-end="url(#rv-arrow)" />
        </svg>

        <div
          v-for="t in hlayout.terminals"
          :key="t.id"
          class="rv-term"
          :style="{ left: t.pos.left + 'px', top: t.pos.top + 'px', width: t.pos.width + 'px', height: t.pos.height + 'px' }"
        >{{ t.label }}</div>

        <button
          v-for="n in bar"
          :key="n.id"
          class="rv-node"
          :class="{ on: selectedNodeId === n.id, disabled: !n.selectable, branch: n.branch }"
          type="button"
          :disabled="!n.selectable"
          :title="n.selectable ? `查看输出表 ${n.outputTable}` : '该节点无输出表'"
          :style="{ left: n.pos.left + 'px', top: n.pos.top + 'px', width: n.pos.width + 'px', height: n.pos.height + 'px' }"
          @click="pickNode(n)"
        >
          <span class="rv-node-icon">{{ n.icon }}</span>
          <span class="rv-node-text">
            <span class="rv-node-title">{{ n.title }}</span>
            <span class="rv-node-sub">{{ n.outputTable || '无输出表' }}</span>
          </span>
        </button>
      </div>
      <div v-if="!bar.length" class="rv-bar-empty">当前流程没有可查看数据的节点</div>
    </div>
    <div class="rv-resize" :title="'拖动调整流程图高度'" @mousedown="onResizeStart">
      <span class="rv-resize-grip" aria-hidden="true"></span>
    </div>

    <div class="rv-filters">
      <input v-model="filters.dataId" class="rv-input" placeholder="数据 ID" @keyup.enter="runQuery" />
      <input v-model="filters.parentId" class="rv-input" placeholder="父 ID" @keyup.enter="runQuery" />
      <select v-model="filters.state" class="rv-input">
        <option value="">状态（全部）</option>
        <option value="C">C 成功</option>
        <option value="E">E 出错</option>
        <option value="L">L 处理中</option>
      </select>
      <input v-model="filters.sql" class="rv-input flex" placeholder="SQL 条件 / 关键词（如 CREATE_DT > curdate()）" @keyup.enter="runQuery" />
      <button class="rc-btn primary" type="button" @click="runQuery">查询</button>
      <button class="rc-btn" type="button" @click="clearFilters">清空</button>
    </div>

    <div class="rv-tablehead">
      <span class="rv-tablename">{{ meta?.tableName || '—' }}</span>
      <span class="rv-tablecount">{{ total.toLocaleString() }} 行</span>
      <span class="rv-spacer" />
      <span class="muted">第 {{ page }} 页 · 每页 {{ size }}</span>
    </div>

    <DataGrid
      class="rv-grid"
      :meta="meta"
      :rows="rows"
      :loading="loading"
      :selected-id="detail.row?.dataId"
      @row-click="onRowClick"
      @row-action="onRowAction"
    />

    <div class="rv-pager">
      <button class="rc-btn" type="button" :disabled="page <= 1" @click="prevPage">上一页</button>
      <button class="rc-btn" type="button" :disabled="page * size >= total" @click="nextPage">下一页</button>
    </div>

    <el-drawer v-model="detail.visible" :with-header="false" size="480px">
      <div v-if="detail.row" class="rv-detail">
        <div class="rv-d-head">
          <div>
            <div class="rv-d-title">{{ detail.row.title }}</div>
            <div class="rv-d-sub">数据 ID {{ detail.row.dataId }}</div>
          </div>
          <button class="rc-btn ghost" type="button" @click="detail.visible = false">关闭</button>
        </div>
        <dl v-if="!editing" class="rc-kv">
          <template v-for="f in detailFields" :key="f.label">
            <dt>{{ f.label }}</dt>
            <dd>{{ f.value }}</dd>
          </template>
        </dl>
        <dl v-else class="rc-kv rc-kv-edit">
          <template v-for="f in detailFields" :key="f.label">
            <dt>{{ f.label }}</dt>
            <dd><input class="rv-edit-input" v-model="editValues[f.prop]" /></dd>
          </template>
        </dl>
        <div class="rv-d-foot">
          <template v-if="editing">
            <button class="rc-btn primary" type="button" :disabled="saving" @click="saveEdit">{{ saving ? '保存中…' : '保存' }}</button>
            <button class="rc-btn" type="button" :disabled="saving" @click="cancelEdit">取消</button>
          </template>
          <template v-else>
            <button class="rc-btn" type="button" @click="startEdit">编辑</button>
            <button class="rc-btn" type="button" @click="onRowAction(detail.row, 'tasks')">查后续任务实例 ›</button>
          </template>
        </div>
      </div>
    </el-drawer>
  </main>
</template>

<style scoped>
.rv-shell { background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); overflow: hidden; height: 100%; display: flex; flex-direction: column; }

.rv-bar { position: relative; padding: 12px 0; background: #f8fafc; overflow: auto; }
.rv-resize { height: 6px; background: var(--rc-border-soft); cursor: row-resize; position: relative; transition: background 0.15s; }
.rv-resize:hover { background: var(--rc-primary-bg); }
.rv-resize-grip { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 28px; height: 2px; background: var(--rc-faint); border-radius: 1px; box-shadow: 0 4px 0 var(--rc-faint); }
.rv-bar-canvas { position: relative; }
.rv-bar svg { position: absolute; inset: 0; pointer-events: none; }
.rv-edge { fill: none; stroke: #94a3b8; stroke-width: 1.4; }
.rv-edge.rule { stroke: #60a5fa; }
.rv-edge.dashed { stroke-dasharray: 5 4; }
.rv-bar-empty { color: var(--rc-faint); font-size: 12px; padding: 16px; text-align: center; }
.rv-term { position: absolute; border: 1px solid var(--rc-border); border-radius: 999px; background: #fff; color: var(--rc-text-2); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; box-shadow: 0 2px 8px -5px rgba(15, 23, 42, 0.2); }
.rv-node { position: absolute; display: flex; align-items: center; gap: 8px; padding: 0 12px; border: 1px solid var(--rc-border); border-radius: 10px; background: #fff; cursor: pointer; transition: border-color 0.15s, background 0.15s, box-shadow 0.15s; box-sizing: border-box; text-align: left; }
.rv-node:hover:not(.disabled):not(.on) { border-color: #bfdbfe; box-shadow: 0 4px 12px -8px rgba(37, 99, 235, 0.4); }
.rv-node.on { border: 2px solid var(--rc-primary); background: var(--rc-primary-bg); }
.rv-node.disabled { opacity: 0.5; cursor: not-allowed; background: #f8fafc; }
.rv-node.branch { border-style: dashed; }
.rv-node-icon { width: 30px; height: 30px; flex: none; display: inline-flex; align-items: center; justify-content: center; border-radius: 7px; background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-size: 12px; font-weight: 700; }
.rv-node.disabled .rv-node-icon { background: #f1f5f9; color: var(--rc-faint); }
.rv-node-text { display: flex; flex-direction: column; line-height: 1.3; min-width: 0; flex: 1; }
.rv-node-title { font-size: 12px; font-weight: 700; color: var(--rc-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rv-node.on .rv-node-title { color: var(--rc-primary-ink); }
.rv-node-sub { font-size: 10px; color: var(--rc-faint); font-family: var(--rc-mono, monospace); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rv-node.on .rv-node-sub { color: var(--rc-primary); }

.rv-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; }
.rv-input { height: 28px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 6px; font-size: 12px; outline: none; min-width: 110px; background: #fff; }
.rv-input.flex { flex: 1; min-width: 200px; font-family: var(--rc-mono, monospace); }
.rv-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rv-filters .rc-btn { height: 28px; padding: 0 14px; font-size: 12px; }

.rv-tablehead { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; }
.rv-tablename { font-family: var(--rc-mono, monospace); font-size: 12px; color: var(--rc-text-2); }
.rv-tablecount { font-size: 12px; color: var(--rc-faint); }
.rv-spacer { flex: 1; }
.muted { color: var(--rc-faint); font-size: 12px; }

.rv-grid { flex: 1; min-height: 0; }
.rv-pager { display: flex; gap: 6px; justify-content: flex-end; padding: 8px 12px; border-top: 1px solid var(--rc-border-soft); background: #fff; }
.rv-pager .rc-btn { height: 28px; padding: 0 12px; font-size: 12px; }

.rv-detail { padding: 18px; }
.rv-d-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.rv-d-title { font-size: 14px; font-weight: 700; color: var(--rc-text); }
.rv-d-sub { font-size: 11px; color: var(--rc-faint); margin-top: 3px; }
.rv-d-foot { display: flex; gap: 8px; margin-top: 16px; }
.rc-btn.ghost { background: transparent; border-color: var(--rc-border); color: var(--rc-text-2); }
.rv-edit-input { width: 100%; border: 1px solid #dbe3ee; border-radius: 6px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 5px 8px; outline: none; }
.rv-edit-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
</style>
