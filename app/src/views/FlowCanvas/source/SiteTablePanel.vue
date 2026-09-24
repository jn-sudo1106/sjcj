<script setup lang="ts">
// 网站「全部源 · 数据视图」左栏的数据表列表（0924-10）。
// 会上原话：「全部源-数据视图重构，左侧新增数据表列表，展示所有的源涉及的表，支持数据表和源的切换，
// 需求背景是系统左侧为列表，右侧为详情」。只在网站态 + 数据视图出现（Q4），由 SiteSourceSwitcher 挂载。
//
// 数据来自 siteApi.siteUsedTables：本站源的主表 ∪ 流程节点的输入 / 输出表，按涉及源数倒序。
// 样式与同一侧栏里的源列表一致（行高、选中态、搜索框）。
import { computed, onMounted, ref, watch } from 'vue'
import { siteApi, type SiteUsedTablesResult, type UsedTable } from '@/api'

const props = defineProps<{
  siteId: string
  /** 当前选中的表（来自地址栏 tableId） */
  activeTableId: string
  /** 地址栏没带表时优先选它（从源页签点回「全部」时复现上次看的表），再不然选第一张 */
  preferredTableId?: string
}>()
const emit = defineEmits<{ pick: [table: UsedTable] }>()

const result = ref<SiteUsedTablesResult | null>(null)
const loading = ref(false)
const loadError = ref('')
const kw = ref('')
let seq = 0

async function load(force = false) {
  const id = ++seq
  loading.value = true
  loadError.value = ''
  try {
    const next = await siteApi.siteUsedTables(props.siteId, { force })
    if (id !== seq) return
    result.value = next
    ensureSelection()
  } catch (e) {
    if (id !== seq) return
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (id === seq) loading.value = false
  }
}

/** 地址栏的表不在本站（换了网站 / 表被删）或压根没带：退到上次看的表，再退到第一张 */
function ensureSelection() {
  const tables = result.value?.tables ?? []
  if (!tables.length) return
  if (tables.some((t) => t.tableId === props.activeTableId)) return
  const next = tables.find((t) => t.tableId === props.preferredTableId) ?? tables[0]!
  emit('pick', next)
}

const tables = computed(() => result.value?.tables ?? [])
const filtered = computed(() => {
  const q = kw.value.trim().toLowerCase()
  if (!q) return tables.value
  return tables.value.filter((t) =>
    t.tableId.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.tableName.toLowerCase().includes(q))
})
/** 列表底部的说明：哪些源的子节点表可能没统计进来 */
const partialHint = computed(() => {
  const r = result.value
  if (!r) return ''
  const parts: string[] = []
  if (r.noFlowSourceCnt) parts.push(`${r.noFlowSourceCnt} 个源未关联流程，仅统计了主表`)
  if (r.failedFlowIds.length) parts.push(`${r.failedFlowIds.length} 个流程的节点没查到`)
  return parts.join('；')
})

onMounted(() => load())
watch(() => props.siteId, () => {
  kw.value = ''
  void load()
})
watch(() => props.activeTableId, () => ensureSelection())
</script>

<template>
  <div class="stp" data-testid="site-table-panel">
    <input v-model="kw" class="stp-search" placeholder="搜索表名 / 表 ID" data-testid="site-table-search" />
    <div class="stp-list">
      <div v-if="loading && !tables.length" class="stp-empty">正在统计本站用到的表…</div>
      <div v-else-if="loadError && !tables.length" class="stp-empty stp-failed">
        表列表加载失败<button type="button" class="stp-retry" data-testid="site-table-retry" @click="load(true)">重试</button>
      </div>
      <div v-else-if="!filtered.length" class="stp-empty">{{ kw ? '没有匹配的表' : '本站的源还没有用到任何表' }}</div>
      <button
        v-for="t in filtered"
        :key="t.tableId"
        class="stp-row"
        :class="{ active: t.tableId === activeTableId }"
        type="button"
        data-testid="site-table-row"
        :title="`${t.name} · ${t.tableId}${t.tableName ? ` · ${t.tableName}` : ''}\n涉及 ${t.sourceCnt} 个源${t.role === 'STEP' ? '（流程子节点的表）' : ''}`"
        @click="emit('pick', t)"
      >
        <span class="stp-row-text">
          <span class="stp-row-head">
            <span class="stp-row-name">{{ t.name }}</span>
            <span v-if="t.role === 'STEP'" class="stp-tag" title="只出现在流程子节点上，不是任何源的主表">子节点</span>
          </span>
          <span class="stp-row-id">{{ t.tableId }}</span>
        </span>
        <span class="stp-count" :title="`涉及 ${t.sourceCnt} 个源`">{{ t.sourceCnt }}</span>
      </button>
      <div v-if="partialHint" class="stp-hint" data-testid="site-table-partial">
        {{ partialHint }}<button v-if="result?.failedFlowIds.length" type="button" class="stp-retry" @click="load(true)">重试</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stp { flex: 1; min-height: 0; display: flex; flex-direction: column; }
/* 以下与 SiteSourceSwitcher 的 .ssw-search / .ssw-list / .ssw-row 同一套尺寸与配色 */
.stp-search {
  flex: none; height: 28px; margin: 8px 8px 6px; padding: 0 9px;
  border: 1px solid var(--rc-border); border-radius: 7px; background: #fff;
  color: var(--rc-text); font-size: 12px; outline: none;
}
.stp-search:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.stp-list { flex: 1; overflow-y: auto; padding: 0 6px 6px; scrollbar-width: thin; }
.stp-row {
  width: 100%; display: flex; align-items: center; gap: 6px; padding: 6px 8px;
  border: 0; border-radius: 7px; background: transparent; color: var(--rc-text);
  font-size: 12px; text-align: left; cursor: pointer;
}
.stp-row:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.stp-row.active { background: var(--rc-primary); color: #fff; font-weight: 700; }
.stp-row-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.stp-row-head { display: flex; align-items: center; gap: 4px; min-width: 0; }
.stp-row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.4; }
.stp-row-id { font-size: 11px; opacity: 0.6; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.2; margin-top: 1px; }
.stp-row.active .stp-row-id { opacity: 0.85; }
.stp-tag { flex: none; font-size: 9px; font-weight: 700; color: var(--rc-primary-ink); background: var(--rc-primary-bg); border: 1px solid #bfdbfe; border-radius: 3px; padding: 0 4px; line-height: 14px; }
.stp-row.active .stp-tag { color: #fff; background: rgba(255, 255, 255, 0.2); border-color: rgba(255, 255, 255, 0.4); }
.stp-count { flex: none; min-width: 20px; padding: 0 5px; border-radius: 9px; background: #eef2f7; color: var(--rc-muted); font-size: 11px; line-height: 18px; text-align: center; font-variant-numeric: tabular-nums; }
.stp-row.active .stp-count { background: rgba(255, 255, 255, 0.22); color: #fff; }
.stp-empty { padding: 14px 8px; text-align: center; font-size: 11px; color: var(--rc-faint); }
.stp-failed { color: var(--rc-danger, #dc2626); }
.stp-hint { margin-top: 6px; padding: 6px 8px; font-size: 11px; line-height: 1.5; color: var(--rc-faint); }
.stp-retry { margin-left: 6px; padding: 0; border: 0; background: transparent; color: var(--rc-primary); font-size: 11px; cursor: pointer; }
.stp-retry:hover { text-decoration: underline; }
</style>
