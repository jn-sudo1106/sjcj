<script setup lang="ts">
// 网站数据视图 · 左栏数据表模式选中「全部」时的中间区（2026-09-24 用户提）：本站涉及的表的基本信息。
// 多张表时默认落在这里（一张表时左栏直接打开那张，不经过这页）。点一行 = 进入那张表的数据。
//
// 表清单、类型、涉及源数来自 siteApi.siteUsedTables（与左栏同一份，已缓存）；
// 数据量要另算：按表在"用到它的源"里做一次 summary（backTraceSources，每 200 个源一批）。
// 所以先出表格、数据量逐张补——站 89 的 900 表涉及 1368 个源，要 7 批，不能让它把整页卡住。
import { onMounted, reactive, ref, watch } from 'vue'
import { siteApi, type SiteUsedTablesResult } from '@/api'
import { backTraceSources } from '@/utils/data/backTraceSources'

const props = defineProps<{ siteId: string }>()
const emit = defineEmits<{ pick: [tableId: string] }>()

const result = ref<SiteUsedTablesResult | null>(null)
const loading = ref(false)
const loadError = ref('')
/** tableId → 数据量；undefined = 统计中，null = 统计失败 */
const dataCounts = reactive(new Map<string, number | null>())
let seq = 0

async function load() {
  const id = ++seq
  loading.value = true
  loadError.value = ''
  dataCounts.clear()
  try {
    const used = await siteApi.siteUsedTables(props.siteId)
    if (id !== seq) return
    result.value = used
    loading.value = false
    await countRows(id, used)
  } catch (e) {
    if (id !== seq) return
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (id === seq) loading.value = false
  }
}

/**
 * 逐张表算数据量。范围与数据视图的候选源收窄同一规则：统计可能不全（有流程节点没查到 /
 * 有源未关联流程）时用全站源，否则只在用到这张表的源里算——既省请求，也不会漏。
 */
async function countRows(id: number, used: SiteUsedTablesResult) {
  const incomplete = used.failedFlowIds.length > 0 || used.noFlowSourceCnt > 0
  const siteSourceIds = incomplete ? (await siteApi.siteSources(props.siteId)).map((s) => s.sourceId) : []
  for (const table of used.tables) {
    if (id !== seq) return
    try {
      const scope = incomplete ? siteSourceIds : table.sourceIds
      const r = await backTraceSources({ tableId: table.tableId, siteId: props.siteId }, scope)
      if (id !== seq) return
      dataCounts.set(table.tableId, [...r.hitCountBySource.values()].reduce((a, b) => a + b, 0))
    } catch {
      if (id !== seq) return
      dataCounts.set(table.tableId, null)
    }
  }
}

function countText(tableId: string): string {
  if (!dataCounts.has(tableId)) return '统计中…'
  const n = dataCounts.get(tableId)
  return n == null ? '统计失败' : n.toLocaleString()
}

onMounted(load)
watch(() => props.siteId, load)
</script>

<template>
  <section class="sto" data-testid="site-tables-overview">
    <div class="sto-head">
      <span class="sto-title">本站涉及的表</span>
      <span v-if="result" class="sto-sub">共 {{ result.tables.length }} 张，点一行查看这张表的数据</span>
    </div>
    <div v-if="loading && !result" class="sto-empty">正在统计本站用到的表…</div>
    <div v-else-if="loadError && !result" class="sto-empty sto-failed">
      加载失败：{{ loadError }}<button type="button" class="sto-retry" @click="load">重试</button>
    </div>
    <div v-else-if="result && !result.tables.length" class="sto-empty">本站的源还没有用到任何表</div>
    <div v-else-if="result" class="sto-table-wrap">
      <table class="sto-table">
        <thead>
          <tr>
            <th>表名</th>
            <th>表 ID</th>
            <th>物理表名</th>
            <th>类型</th>
            <th class="num">涉及源数</th>
            <th class="num">数据量</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="t in result.tables"
            :key="t.tableId"
            data-testid="site-tables-overview-row"
            tabindex="0"
            @click="emit('pick', t.tableId)"
            @keydown.enter="emit('pick', t.tableId)"
          >
            <td class="name" :title="t.name">{{ t.name }}</td>
            <td class="mono">{{ t.tableId }}</td>
            <td class="mono muted" :title="t.tableName">{{ t.tableName || '—' }}</td>
            <td>
              <span v-if="t.role === 'STEP'" class="sto-tag" title="只出现在流程子节点上，不是任何源的主表">子节点</span>
              <span v-else class="sto-tag main">主表</span>
            </td>
            <td class="num">{{ t.sourceCnt.toLocaleString() }}</td>
            <td class="num" :class="{ muted: !dataCounts.has(t.tableId) }" data-testid="site-tables-overview-count">{{ countText(t.tableId) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="result.noFlowSourceCnt || result.failedFlowIds.length" class="sto-note">
        <template v-if="result.noFlowSourceCnt">{{ result.noFlowSourceCnt }} 个源未关联流程，子节点用到的表可能没列全。</template>
        <template v-if="result.failedFlowIds.length">{{ result.failedFlowIds.length }} 个流程的节点没查到，其子节点表可能没列全。</template>
      </p>
    </div>
  </section>
</template>

<style scoped>
.sto { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 12px; }
.sto-head { display: flex; align-items: baseline; gap: 10px; }
.sto-title { font-size: 14px; font-weight: 700; color: var(--rc-text); }
.sto-sub { font-size: 12px; color: var(--rc-muted); }
.sto-table-wrap { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #fff; }
.sto-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.sto-table th { position: sticky; top: 0; z-index: 1; padding: 9px 12px; background: #f8fafc; color: var(--rc-muted); font-weight: 600; text-align: left; border-bottom: 1px solid var(--rc-border-soft); white-space: nowrap; }
.sto-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: var(--rc-text); white-space: nowrap; }
.sto-table tbody tr { cursor: pointer; }
.sto-table tbody tr:hover, .sto-table tbody tr:focus-visible { background: var(--rc-primary-bg); outline: none; }
.sto-table .name { max-width: 260px; overflow: hidden; text-overflow: ellipsis; font-weight: 600; color: var(--rc-primary-ink); }
.sto-table .mono { font-family: monospace; }
.sto-table .muted { color: var(--rc-faint); }
.sto-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.sto-tag { display: inline-block; padding: 0 6px; border: 1px solid #bfdbfe; border-radius: 4px; background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-size: 11px; line-height: 18px; }
.sto-tag.main { border-color: var(--rc-border); background: #f8fafc; color: var(--rc-muted); }
.sto-note { margin: 0; padding: 8px 12px; font-size: 11px; color: var(--rc-faint); }
.sto-empty { padding: 42px 16px; text-align: center; font-size: 12px; color: var(--rc-faint); }
.sto-failed { color: var(--rc-danger, #dc2626); }
.sto-retry { margin-left: 8px; padding: 0; border: 0; background: transparent; color: var(--rc-primary); font-size: 12px; cursor: pointer; }
</style>
