<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useFlowStore } from '../../stores/flow'
import { useWorkspaceStore } from '../../stores/workspace'
import { dataApi, siteApi, flowApi, sourceApi, type DataTableMeta, type DataRow, type Source } from '../../api'
import { buildHorizontalLayout, buildSourceSeed, iconFor, nodeOutputTable, pickFinalMainNodeId, type HorizontalLayout } from './flowModel'
import CanvasHeader from './CanvasHeader.vue'
import DataGrid from './DataGrid.vue'

const flow = useFlowStore()
const ws = useWorkspaceStore()
const router = useRouter()

// 网站粒度上下文（0707 优化·Phase5）：无论画布当前停在网站模板还是某个子源，数据视图都站在网站粒度；
// 没有 siteId 的历史/草稿源退回原单源行为（1:1+fallback）。tabKey 对应页签条 key（源 id 或 `site:xxx` 伪 id）。
const siteId = computed(() => flow.sourceCtx?.siteId || flow.siteCtx?.siteId || '')
const tabKey = computed(() => ws.activeSourceId)

// 源筛选（可搜索下拉）：选项来自网站下全部子源；从子源画布进入时预选该子源，网站模板进入则不预选（=全部子源聚合）
const siteChildren = ref<Source[]>([])
const sourceNames = computed<Record<string, string>>(() =>
  Object.fromEntries(siteChildren.value.map((s) => [s.sourceId, s.name])),
)
async function loadSiteChildren() {
  siteChildren.value = siteId.value ? await siteApi.siteSources(siteId.value) : []
}

// 节点条：网站粒度优先取网站统一流程模板；模板未保存或模板节点没绑任何输出表时（种子网站的虚拟模板
// 刻意不带表，0710 空白引导口径——数据视图关心"哪里有数据"，无表模板查不出任何行），
// 退回用站内第一个子源的实际步骤推导末端结果集入口。查询仍按 siteId 聚合全部子源。
const templateLayout = ref<HorizontalLayout | null>(null)
async function loadTemplateLayout() {
  if (!siteId.value) {
    templateLayout.value = null
    return
  }
  const def = await flowApi.flowLoad(`site:${siteId.value}`)
  if (def && Object.values(def.configs).some((c) => nodeOutputTable(c))) {
    templateLayout.value = buildHorizontalLayout(def.main, def.branches, def.configs)
    return
  }
  const children = siteChildren.value.length ? siteChildren.value : await siteApi.siteSources(siteId.value)
  const first = children[0]
  if (!first) {
    templateLayout.value = null
    return
  }
  const steps = await sourceApi.sourceSteps(first.sourceId)
  const seed = buildSourceSeed(first, steps)
  templateLayout.value = buildHorizontalLayout(seed.main, seed.branches, seed.configs)
}
watch(siteId, () => {
  loadSiteChildren()
  loadTemplateLayout()
}, { immediate: true })

// 横向流程图节点：把 horizontalLayout 的节点投射为带"是否数据节点"标记
interface BarNode {
  id: string
  title: string
  icon: string
  outputTable: string
  selectable: boolean
  pos: { left: number; top: number; width: number; height: number }
  branch: boolean
  /** 主链末端数据节点 = 流程最终结果落表（优化 0701 问题二） */
  final: boolean
}
const hlayout = computed(() => templateLayout.value ?? flow.horizontalLayout)

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
const bar = computed<BarNode[]>(() => {
  const nodes = hlayout.value.nodes
  const finalId = pickFinalMainNodeId(nodes)
  return nodes.map((n) => {
    const table = nodeOutputTable(n.cfg)
    return {
      id: n.id,
      title: n.cfg.title,
      icon: iconFor(n.cfg),
      outputTable: table,
      selectable: !!table,
      pos: n.pos,
      branch: n.branch,
      final: n.id === finalId,
    }
  })
})
const dataNodes = computed(() => bar.value.filter((n) => n.selectable))
const selectedNodeId = ref<string>('')
const page = ref(1)
// 数据范围由页面级子源侧栏选中态决定（0710 会议 C4 = 第 7 条同一侧栏）：子源态看该子源、网站态看全站，不再自建源筛选
const filters = reactive({ dataId: '', parentId: '', state: '', sql: '' })

// 默认选末端数据节点（最终结果表）；有页签快照（0701 问题三）时优先恢复快照里的节点/过滤/页码。
// 切换页签后旧节点 id 不在新流程里时也重置，避免表格变空。
watch(
  dataNodes,
  (nodes) => {
    if (!nodes.some((n) => n.id === selectedNodeId.value)) {
      const snap = ws.snapshotOf(tabKey.value)
      const snapId = snap?.selectedNodeId && nodes.some((n) => n.id === snap.selectedNodeId) ? snap.selectedNodeId : ''
      selectedNodeId.value = snapId || ((nodes.find((n) => n.final) ?? nodes[0])?.id ?? '')
      if (snapId) {
        page.value = snap?.page ?? 1
        if (snap?.filters) {
          // 旧快照可能残留 sourceFilter 字段（0710 会议 C4 已删源筛选），只回填仍存在的键
          const { dataId, parentId, state, sql } = snap.filters
          Object.assign(filters, { dataId, parentId, state, sql })
        }
      } else {
        page.value = 1
      }
    }
  },
  { immediate: true },
)

// 浏览状态实时写入页签快照，切页签/刷新后恢复
watch([selectedNodeId, page, () => ({ ...filters })], () => {
  const key = tabKey.value
  if (key) ws.saveSnapshot(key, { selectedNodeId: selectedNodeId.value, page: page.value, filters: { ...filters } })
})
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
    const [metaRes, dataRes] = await Promise.all([
      dataApi.tableMeta(selectedTable.value),
      dataApi.rowQueryPaged({
        tableId: selectedTable.value,
        // 数据范围跟随侧栏选中态（0710 会议 C4）：停在子源上=该子源数据，停在网站上=全站聚合
        siteId: siteId.value || undefined,
        sourceId: flow.sourceCtx?.sourceId || undefined,
        dataId: filters.dataId || undefined,
        parentId: filters.parentId || undefined,
        state: filters.state || undefined,
        sql: filters.sql || undefined,
        page: page.value,
        size,
      }),
    ])
    meta.value = metaRes
    rows.value = dataRes?.list ?? []
    total.value = dataRes?.total ?? 0
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
          <span v-if="n.final" class="rv-node-final">最终结果</span>
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
      :source-names="siteId ? sourceNames : undefined"
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
            <div class="rv-d-sub">
              数据 ID {{ detail.row.dataId }}
              <template v-if="siteId">· 所属源 {{ sourceNames[detail.row.sourceId] || detail.row.sourceId }}</template>
            </div>
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
.rv-node-final { position: absolute; top: -8px; right: 8px; font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 5px; background: var(--rc-ok-bg); color: var(--rc-ok); border: 1px solid currentColor; line-height: 1.4; }

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
