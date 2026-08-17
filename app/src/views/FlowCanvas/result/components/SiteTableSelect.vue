<script setup lang="ts">
// 网站范围表选择器（0812 计划 M2-2）：供"全部源"状态下选择当前网站的表。
// 数据来自 siteApi.siteTables（前端按 site/sources + 逐源 queryEntryTypesGroup 聚合，
// 见方案 §5.3），不是真实的"网站表"后端接口——后端未提供该接口前，也不用第一个源的表冒充。
import { computed, onMounted, ref, watch } from 'vue'
import { siteApi, type SiteTableOption } from '@/api'

const props = defineProps<{ siteId: string; modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [tableId: string] }>()

const tables = ref<SiteTableOption[]>([])
const loading = ref(false)
const error = ref('')
const overThreshold = ref(false)
const sourceCount = ref(0)
const failedSourceIds = ref<string[]>([])
const keyword = ref('')
const open = ref(false)

const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return tables.value
  return tables.value.filter((t) =>
    t.tableId.toLowerCase().includes(q) || t.tableName.toLowerCase().includes(q) || (t.name ?? '').toLowerCase().includes(q))
})
const selected = computed(() => tables.value.find((t) => t.tableId === props.modelValue) ?? null)

let requestId = 0
async function load(force = false) {
  const id = ++requestId
  loading.value = true
  error.value = ''
  tables.value = []
  overThreshold.value = false
  failedSourceIds.value = []
  try {
    const result = await siteApi.siteTables(props.siteId, {
      force,
      onProgress: (partial) => {
        if (id === requestId) tables.value = partial
      },
    })
    if (id !== requestId) return
    tables.value = result.tables
    sourceCount.value = result.sourceCount
    overThreshold.value = result.overThreshold
    failedSourceIds.value = result.failedSourceIds
    // 选中的表在新结果里不存在了（切网站/刷新后表集合变化）就清空，不留着一个查不出数据的死选择。
    if (props.modelValue && !result.tables.some((t) => t.tableId === props.modelValue)) {
      emit('update:modelValue', '')
    }
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
  void load()
})

function pick(table: SiteTableOption) {
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
    <div v-if="overThreshold" class="sts-notice" data-testid="site-table-select-over-threshold">
      该网站源数量较多（{{ sourceCount }} 个），暂不自动聚合表列表，请先选择具体源查看数据。
    </div>
    <template v-else>
      <div class="sts-field">
        <input
          v-model="keyword"
          class="sts-input"
          data-testid="site-table-select-input"
          :placeholder="selected ? `${selected.tableName}（${selected.tableId}）` : '选择表（按表 ID 或表名称搜索）'"
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
          <span class="sts-option-count">{{ table.sourceCount }} 个源引用</span>
        </button>
      </div>
      <div v-if="failedSourceIds.length" class="sts-notice sts-warn" data-testid="site-table-select-partial-fail">
        {{ failedSourceIds.length }} 个源的表未能加载，列表可能不完整
      </div>
    </template>
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
.sts-option { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: 0; border-bottom: 1px solid var(--rc-border-soft); background: #fff; color: var(--rc-text-2); font-size: 12px; text-align: left; cursor: pointer; }
.sts-option:last-child { border-bottom: 0; }
.sts-option:hover, .sts-option.active { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.sts-option-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.sts-option-id { flex: none; font-family: monospace; font-size: 10px; color: var(--rc-faint); }
.sts-option-count { flex: none; font-size: 10px; color: var(--rc-faint); }
.sts-notice { padding: 8px 10px; border: 1px solid var(--rc-border-soft); border-radius: 6px; background: #f8fafc; color: var(--rc-muted); font-size: 12px; }
.sts-notice.sts-warn { margin-top: 6px; border-color: #fde68a; background: #fffbeb; color: #92400e; }
</style>
