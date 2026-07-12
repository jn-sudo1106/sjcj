<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { sourceApi, dataApi, type Source, type DataTableMeta, type DataRow } from '../../api'
import { buildHorizontalLayout, buildSourceSeed, iconFor, nodeOutputTable, pickFinalMainNodeId, type NodeConfig } from './flowModel'
import DataGrid from './DataGrid.vue'

// 分屏对比（0701 问题三 · 方案 C）单栏内容：给定 sourceId 独立加载、独立渲染，
// 不读写全局 flow store（对比态两栏可能同时显示两个不同的源，flow store 单实例装不下）。
const props = defineProps<{ sourceId: string; label: string }>()

const loadingFlow = ref(false)
const localMain = ref<string[]>([])
const localConfigs = ref<Record<string, NodeConfig>>({})

async function loadFlow(sourceId: string) {
  if (!sourceId) return
  loadingFlow.value = true
  try {
    const [source, steps] = await Promise.all([sourceApi.sourceDetail(sourceId), sourceApi.sourceSteps(sourceId)])
    if (!source) {
      loadingFlow.value = false
      return
    }
    const seed = buildSourceSeed(source as Source, steps ?? [])
    localMain.value = seed.main
    localConfigs.value = seed.configs
  } finally {
    loadingFlow.value = false
  }
}
watch(() => props.sourceId, (sid) => loadFlow(sid), { immediate: true })

const hlayout = computed(() => buildHorizontalLayout(localMain.value, [], localConfigs.value))

interface BarNode {
  id: string
  title: string
  icon: string
  outputTable: string
  selectable: boolean
  pos: { left: number; top: number; width: number; height: number }
  final: boolean
}
const bar = computed<BarNode[]>(() => {
  const nodes = hlayout.value.nodes
  const finalId = pickFinalMainNodeId(nodes)
  return nodes.map((n) => {
    const table = nodeOutputTable(n.cfg)
    return {
      id: n.id, title: n.cfg.title, icon: iconFor(n.cfg), outputTable: table,
      selectable: !!table, pos: n.pos, branch: false, final: n.id === finalId,
    }
  })
})
const dataNodes = computed(() => bar.value.filter((n) => n.selectable))
const selectedNodeId = ref('')
const page = ref(1)
const filters = reactive({ dataId: '', state: '' })
const size = 10

watch(dataNodes, (nodes) => {
  if (!nodes.some((n) => n.id === selectedNodeId.value)) {
    selectedNodeId.value = (nodes.find((n) => n.final) ?? nodes[0])?.id ?? ''
    page.value = 1
  }
})
const selectedTable = computed(() => bar.value.find((n) => n.id === selectedNodeId.value)?.outputTable ?? '')

const meta = ref<DataTableMeta | null>(null)
const rows = ref<DataRow[]>([])
const total = ref(0)
const loading = ref(false)

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
        sourceId: props.sourceId,
        dataId: filters.dataId || undefined,
        state: filters.state || undefined,
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
watch([selectedTable, page], loadData)

function runQuery() {
  page.value = 1
  loadData()
}
function pickNode(n: BarNode) {
  if (!n.selectable) return
  selectedNodeId.value = n.id
}
function prevPage() {
  if (page.value > 1) page.value -= 1
}
function nextPage() {
  if (page.value * size < total.value) page.value += 1
}
</script>

<template>
  <section class="cp-pane">
    <div class="cp-head">
      <span class="cp-head-name">{{ label }}</span>
      <span class="cp-head-id">{{ sourceId }}</span>
    </div>
    <div class="cp-bar">
      <button
        v-for="n in bar"
        :key="n.id"
        class="cp-node"
        :class="{ on: selectedNodeId === n.id, disabled: !n.selectable }"
        type="button"
        :disabled="!n.selectable"
        :title="n.selectable ? `查看输出表 ${n.outputTable}` : '该节点无输出表'"
        @click="pickNode(n)"
      >
        <span class="cp-node-icon">{{ n.icon }}</span>
        <span class="cp-node-text">
          <span class="cp-node-title">{{ n.title }}</span>
          <span class="cp-node-sub">{{ n.outputTable || '无输出表' }}</span>
        </span>
        <span v-if="n.final" class="cp-node-final">最终</span>
      </button>
      <span v-if="!bar.length && !loadingFlow" class="cp-bar-empty">该流程没有可查看数据的节点</span>
    </div>

    <div class="cp-filters">
      <input v-model="filters.dataId" class="cp-input" placeholder="数据 ID" @keyup.enter="runQuery" />
      <select v-model="filters.state" class="cp-input" @change="runQuery">
        <option value="">状态（全部）</option>
        <option value="C">C 成功</option>
        <option value="E">E 出错</option>
        <option value="L">L 处理中</option>
      </select>
      <button class="rc-btn primary" type="button" @click="runQuery">查询</button>
    </div>

    <div class="cp-tablehead">
      <span class="cp-tablename">{{ meta?.tableName || '—' }}</span>
      <span class="cp-tablecount">{{ total.toLocaleString() }} 行</span>
    </div>

    <DataGrid class="cp-grid" :meta="meta" :rows="rows" :loading="loading" compact hide-actions />

    <div class="cp-pager">
      <button class="rc-btn" type="button" :disabled="page <= 1" @click="prevPage">上一页</button>
      <span class="cp-page-info">第 {{ page }} 页</span>
      <button class="rc-btn" type="button" :disabled="page * size >= total" @click="nextPage">下一页</button>
    </div>
  </section>
</template>

<style scoped>
.cp-pane { display: flex; flex-direction: column; height: 100%; min-width: 0; background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); overflow: hidden; }
.cp-head { display: flex; align-items: baseline; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--rc-border-soft); background: #f8fafc; }
.cp-head-name { font-size: 12px; font-weight: 700; color: var(--rc-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cp-head-id { font-size: 10px; color: var(--rc-faint); font-family: var(--rc-mono, monospace); }
.cp-bar { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--rc-border-soft); }
.cp-bar-empty { color: var(--rc-faint); font-size: 11px; padding: 4px 0; }
.cp-node { position: relative; display: flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid var(--rc-border); border-radius: 8px; background: #fff; cursor: pointer; }
.cp-node:hover:not(.disabled):not(.on) { border-color: #bfdbfe; }
.cp-node.on { border: 2px solid var(--rc-primary); background: var(--rc-primary-bg); }
.cp-node.disabled { opacity: 0.5; cursor: not-allowed; }
.cp-node-icon { width: 22px; height: 22px; flex: none; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-size: 10px; font-weight: 700; }
.cp-node-text { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
.cp-node-title { font-size: 11px; font-weight: 700; color: var(--rc-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 96px; }
.cp-node-sub { font-size: 9px; color: var(--rc-faint); font-family: var(--rc-mono, monospace); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 96px; }
.cp-node-final { position: absolute; top: -7px; right: 4px; font-size: 8px; font-weight: 700; padding: 0 4px; border-radius: 4px; background: var(--rc-ok-bg); color: var(--rc-ok); border: 1px solid currentColor; line-height: 1.4; }
.cp-filters { display: flex; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--rc-border-soft); }
.cp-input { height: 26px; padding: 0 8px; border: 1px solid var(--rc-border); border-radius: 6px; font-size: 11px; outline: none; min-width: 90px; }
.cp-filters .rc-btn { height: 26px; padding: 0 10px; font-size: 11px; }
.cp-tablehead { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--rc-border-soft); }
.cp-tablename { font-family: var(--rc-mono, monospace); font-size: 11px; color: var(--rc-text-2); }
.cp-tablecount { font-size: 11px; color: var(--rc-faint); }
.cp-grid { flex: 1; min-height: 0; }
.cp-pager { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 6px 10px; border-top: 1px solid var(--rc-border-soft); }
.cp-pager .rc-btn { height: 26px; padding: 0 10px; font-size: 11px; }
.cp-page-info { font-size: 11px; color: var(--rc-faint); }
</style>
