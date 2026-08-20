<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { dataApi, type DataTableMeta, type DataRow } from '@/api'
import { useRuntimeStore } from '@/stores/runtime'
import DataGrid from './DataGrid.vue'
import { withoutComposition } from '@/utils/enterKey'

const props = defineProps<{ open: boolean; tableId: string; sourceId?: string; title?: string }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const runtime = useRuntimeStore()
const meta = ref<DataTableMeta | null>(null)
const rows = ref<DataRow[]>([])
const total = ref(0)
const loading = ref(false)
const filters = reactive({ dataId: '', state: '' })
const page = ref(1)
const size = 20

const mergedRows = ref<DataRow[]>([])

async function load() {
  if (!props.tableId) return
  loading.value = true
  try {
    meta.value = await dataApi.tableMeta(props.tableId)
    const res = await dataApi.rowQueryPaged({
      tableId: props.tableId,
      sourceId: props.sourceId,
      dataId: filters.dataId || undefined,
      state: filters.state || undefined,
      page: page.value,
      size,
    })
    rows.value = res?.list ?? []
    total.value = res?.total ?? 0
    // 第一页叠加试跑样例
    const trial = page.value === 1 ? runtime.dataByTable[props.tableId] ?? [] : []
    mergedRows.value = [...trial, ...rows.value]
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.open, props.tableId] as const,
  ([open]) => {
    if (open) {
      page.value = 1
      filters.dataId = ''
      filters.state = ''
      load()
    }
  },
  { immediate: true },
)
watch(page, load)

function runQuery() {
  page.value = 1
  load()
}
function prevPage() {
  if (page.value > 1) page.value -= 1
}
function nextPage() {
  if (page.value * size < total.value) page.value += 1
}
function close() {
  emit('update:open', false)
}

// 回车触发，但跳过中文输入法上屏时的 Enter（见 utils/enterKey.ts）
const onEnterQuery = withoutComposition(() => runQuery())
</script>

<template>
  <el-dialog
    :model-value="open"
    :title="title || '查看全部数据'"
    width="1080px"
    top="6vh"
    :close-on-click-modal="false"
    @update:model-value="close"
  >
    <div class="tdd">
      <div class="tdd-head">
        <span class="tdd-name">{{ meta?.tableName || tableId }}</span>
        <span class="tdd-count">{{ total.toLocaleString() }} 行</span>
        <span class="tdd-spacer" />
        <input v-model="filters.dataId" class="tdd-input" placeholder="数据 ID" @keyup.enter="onEnterQuery" />
        <select v-model="filters.state" class="tdd-input">
          <option value="">状态（全部）</option>
          <option value="C">C 成功</option>
          <option value="E">E 出错</option>
          <option value="L">L 处理中</option>
        </select>
        <button class="rc-btn primary" type="button" @click="runQuery">查询</button>
      </div>

      <DataGrid class="tdd-grid" :meta="meta" :rows="mergedRows" :loading="loading" hide-actions />

      <div class="tdd-pager">
        <span class="muted">第 {{ page }} 页 · 每页 {{ size }}</span>
        <span class="tdd-spacer" />
        <button class="rc-btn" type="button" :disabled="page <= 1" @click="prevPage">上一页</button>
        <button class="rc-btn" type="button" :disabled="page * size >= total" @click="nextPage">下一页</button>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.tdd { display: flex; flex-direction: column; height: 64vh; }
.tdd-head { display: flex; align-items: center; gap: 8px; padding-bottom: 10px; }
.tdd-name { font-family: var(--rc-mono, monospace); font-size: 13px; color: var(--rc-text-2); }
.tdd-count { font-size: 12px; color: var(--rc-faint); }
.tdd-spacer { flex: 1; }
.tdd-input { height: 30px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 6px; font-size: 12px; outline: none; min-width: 130px; background: #fff; }
.tdd-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.tdd-grid { flex: 1; min-height: 0; border: 1px solid var(--rc-border); border-radius: 8px; overflow: hidden; }
.tdd-pager { display: flex; align-items: center; gap: 6px; padding-top: 10px; }
.muted { color: var(--rc-faint); font-size: 12px; }
.rc-btn { display: inline-flex; align-items: center; justify-content: center; height: 30px; padding: 0 14px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text-2); font-size: 13px; cursor: pointer; }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.rc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.rc-btn:hover:not(:disabled) { border-color: #bfdbfe; }
</style>
