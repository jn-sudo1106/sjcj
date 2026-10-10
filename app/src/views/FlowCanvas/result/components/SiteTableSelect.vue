<script setup lang="ts">
// 网站范围表选择器（0812 计划 M2-2）：供"全部源"状态下选择当前网站的表。
// 数据来自 siteApi.siteUsedTables：本站源的主表 ∪ 流程节点的输入 / 输出表（0924-12），
// 与左栏「数据表」列表同一份、同一个顺序（涉及源数倒序）。此前用的是全库表目录（83 张），
// 选到本站没用到的表只能查出空数据。名单可能不全时照常列出，底部写明原因，与左栏一致。
import { computed, onMounted, ref, watch } from 'vue'
import { siteApi, type UsedTable } from '@/api'

const props = defineProps<{ siteId: string; modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [tableId: string] }>()

const tables = ref<UsedTable[]>([])
/** 名单可能不全的原因（未关联流程的源只统计了主表、流程节点没查到），与左栏 SiteTablePanel 同口径 */
const partialHint = ref('')
const loading = ref(false)
const error = ref('')
const keyword = ref('')
const open = ref(false)

const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return tables.value
  return tables.value.filter((t) =>
    t.tableId.toLowerCase().includes(q) || t.tableName.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
})
const selected = computed(() => tables.value.find((t) => t.tableId === props.modelValue) ?? null)

function syncSelectedTable(nextTables: UsedTable[], selectFirst = false) {
  const firstTableId = nextTables[0]?.tableId
  if (!firstTableId) {
    if (props.modelValue) emit('update:modelValue', '')
    return
  }
  const selectedStillExists = nextTables.some((table) => table.tableId === props.modelValue)
  if (selectFirst || !selectedStillExists) emit('update:modelValue', firstTableId)
}

let requestId = 0
async function load(force = false, selectFirst = false) {
  const id = ++requestId
  loading.value = true
  error.value = ''
  tables.value = []
  partialHint.value = ''
  try {
    const result = await siteApi.siteUsedTables(props.siteId, { force })
    if (id !== requestId) return
    tables.value = result.tables
    const parts: string[] = []
    if (result.noFlowSourceCnt) parts.push(`${result.noFlowSourceCnt} 个源未关联流程，仅统计了主表`)
    if (result.failedFlowIds.length) parts.push(`${result.failedFlowIds.length} 个流程的节点没查到`)
    partialHint.value = parts.join('；')
    // 首次进入网站视图默认选择首张表；切换网站也重新按新目录选择。
    // 已选表仍在当前目录中时保留它，刷新不会打断用户正在看的表。
    syncSelectedTable(result.tables, selectFirst)
  } catch (err) {
    if (id !== requestId) return
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (id === requestId) loading.value = false
  }
}
onMounted(() => load())
watch(() => props.siteId, () => {
  emit('update:modelValue', '')
  void load(false, true)
})

function pick(table: UsedTable) {
  emit('update:modelValue', table.tableId)
  keyword.value = ''
  open.value = false
}
function refresh() {
  void load(true)
}
function onFocus() {
  open.value = true
}
// 选过一次表之后，mousedown.prevent 保住的是输入框的焦点（见 pick 处注释），所以再点一次
// 输入框不会触发 focus 事件（本来就是焦点元素），下拉就再也弹不出来了。mousedown 不依赖
// "是否已经是焦点元素"，每次点击都会触发，用它兜底才能保证再点一次总能重新展开。
function onMousedown() {
  open.value = true
}
function onBlur() {
  // 留一点时间给点击选项的 mousedown 先触发，不然 blur 先关掉下拉，点击就落空了。
  window.setTimeout(() => { open.value = false }, 150)
}
</script>

<template>
  <div class="sts-wrap">
    <div class="sts-field">
      <input
        v-model="keyword"
        class="sts-input"
        data-testid="site-table-select-input"
        :placeholder="selected ? `${selected.tableName || selected.name}（${selected.tableId}）` : '选择表（按表 ID 或表名称搜索）'"
        @focus="onFocus"
        @mousedown="onMousedown"
        @blur="onBlur"
      />
      <button class="sts-refresh" type="button" title="刷新表列表" :disabled="loading" @click="refresh">↻</button>
    </div>
    <div v-if="open" class="sts-options" data-testid="site-table-select-options">
      <div v-if="loading && !tables.length" class="sts-empty">加载中…</div>
      <div v-else-if="error" class="sts-empty sts-error">{{ error }}</div>
      <div v-else-if="!filtered.length" class="sts-empty">{{ keyword ? '没有匹配的表' : '该网站暂无可查询的表' }}</div>
      <button
        v-for="table in filtered"
        :key="table.tableId"
        type="button"
        class="sts-option"
        data-testid="site-table-select-option"
        :class="{ active: table.tableId === modelValue }"
        @mousedown.prevent="pick(table)"
      >
        <span class="sts-option-name">{{ table.name || table.tableName }}</span>
        <span class="sts-option-id">{{ table.tableId }}</span>
      </button>
      <div v-if="partialHint && !loading && !error" class="sts-hint" data-testid="site-table-select-partial-hint">{{ partialHint }}</div>
    </div>
  </div>
</template>

<style scoped>
.sts-wrap { position: relative; min-width: 220px; }
.sts-field { display: flex; align-items: center; gap: 6px; }
.sts-input { flex: 1; height: 28px; padding: 0 9px; border: 1px solid var(--rc-border); border-radius: 6px; font-size: 12px; outline: none; background: #fff; }
.sts-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.sts-refresh { flex: none; width: 28px; height: 28px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-muted); cursor: pointer; }
.sts-refresh:hover:not(:disabled) { border-color: var(--rc-primary); color: var(--rc-primary-ink); }
.sts-refresh:disabled { opacity: .55; cursor: wait; }
.sts-options { position: absolute; z-index: 5; top: 32px; left: 0; right: 0; max-height: 260px; overflow-y: auto; border: 1px solid var(--rc-border); border-radius: 7px; background: #fff; box-shadow: 0 12px 28px -12px rgba(15, 23, 42, 0.3); }
.sts-empty { padding: 10px; color: var(--rc-faint); font-size: 12px; text-align: center; }
.sts-error { color: var(--rc-error); }
.sts-hint { padding: 6px 10px; border-top: 1px solid var(--rc-border-soft); color: var(--rc-faint); font-size: 11px; line-height: 1.5; }
.sts-option { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: 0; border-bottom: 1px solid var(--rc-border-soft); background: #fff; color: var(--rc-text-2); font-size: 12px; text-align: left; cursor: pointer; }
.sts-option:last-child { border-bottom: 0; }
.sts-option:hover, .sts-option.active { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.sts-option-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.sts-option-id { flex: none; font-family: monospace; font-size: 10px; color: var(--rc-faint); }
</style>
