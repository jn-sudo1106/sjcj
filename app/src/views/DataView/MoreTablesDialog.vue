<script setup lang="ts">
import { reactive, watch } from 'vue'
import { entryApi, type EntryType } from '../../api'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; picked: [EntryType] }>()

const state = reactive<{ loading: boolean; keyword: string; page: number; size: number; total: number; list: EntryType[] }>({
  loading: false, keyword: '', page: 1, size: 20, total: 0, list: [],
})

async function load() {
  state.loading = true
  try {
    const r = await entryApi.entryPaged({ page: state.page, size: state.size, name: state.keyword || undefined })
    state.list = r.list
    state.total = r.total
  } finally {
    state.loading = false
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
function onKeywordInput() {
  clearTimeout(timer)
  timer = setTimeout(() => { state.page = 1; void load() }, 250)
}
function onPageChange() { void load() }

watch(() => props.modelValue, (v) => {
  if (!v) return
  state.keyword = ''
  state.page = 1
  void load()
})

function pick(row: EntryType) {
  emit('picked', row)
  emit('update:modelValue', false)
}
</script>

<template>
  <el-dialog :model-value="modelValue" title="加载更多数据表" width="720px" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <el-input v-model="state.keyword" clearable placeholder="按表名搜索" style="width: 260px" @input="onKeywordInput" />
    <el-table v-loading="state.loading" :data="state.list" style="width: 100%; margin-top: 12px" @row-click="pick">
      <el-table-column prop="tableId" label="表 ID" width="100" />
      <el-table-column label="表名">
        <template #default="{ row }">{{ row.name || row.tableName }}</template>
      </el-table-column>
      <el-table-column prop="tableName" label="物理表名" width="220" />
      <el-table-column prop="rowCount" label="数据量" width="100" />
    </el-table>
    <el-pagination
      v-model:current-page="state.page"
      v-model:page-size="state.size"
      :total="state.total"
      layout="total, prev, pager, next"
      background
      small
      style="margin-top: 12px"
      @current-change="onPageChange"
    />
  </el-dialog>
</template>
