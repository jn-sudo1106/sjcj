<script setup lang="ts">
import { onUnmounted, reactive, watch } from 'vue'
import { sourceApi, type Source } from '../../api'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; picked: [Source] }>()

const state = reactive<{ loading: boolean; keyword: string; page: number; size: number; total: number; list: Source[] }>({
  loading: false, keyword: '', page: 1, size: 20, total: 0, list: [],
})

async function load() {
  state.loading = true
  try {
    const r = await sourceApi.sourcePaged({ page: state.page, size: state.size, keyword: state.keyword || undefined })
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

onUnmounted(() => clearTimeout(timer))

watch(() => props.modelValue, (v) => {
  if (!v) return
  state.keyword = ''
  state.page = 1
  void load()
})

function pick(row: Source) {
  emit('picked', row)
  emit('update:modelValue', false)
}
</script>

<template>
  <el-dialog :model-value="modelValue" title="更多源" width="720px" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <el-input v-model="state.keyword" clearable placeholder="按源名/ID搜索" style="width: 260px" @input="onKeywordInput" />
    <el-table v-loading="state.loading" :data="state.list" style="width: 100%; margin-top: 12px" @row-click="pick">
      <el-table-column prop="sourceId" label="源 ID" width="110" />
      <el-table-column prop="name" label="名称" />
      <el-table-column prop="mainTable" label="主表" width="180" />
      <el-table-column prop="state" label="状态" width="90" />
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
