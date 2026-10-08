<script setup lang="ts">
import { ref, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { sourceApi, type Source } from '@/api'
import { useSourceGroupsStore } from '@/stores/sourceGroups'
const props = defineProps<{ modelValue: boolean; groupId: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const groups = useSourceGroupsStore()
const field = ref<'name' | 'sourceIds'>('name')
const keyword = ref('')
const page = ref(1)
const size = ref(20)
const total = ref(0)
const rows = ref<Source[]>([])
const selected = ref<string[]>([])
const loading = ref(false)
const error = ref('')
let sequence = 0
async function load() {
  const request = ++sequence
  loading.value = true
  error.value = ''
  try {
    const result = await sourceApi.sourcePaged({ page: page.value, size: size.value, [field.value]: keyword.value.trim() || undefined })
    if (request !== sequence) return
    rows.value = result.list
    total.value = result.total
  } catch (e) {
    if (request !== sequence) return
    rows.value = []
    total.value = 0
    error.value = e instanceof Error ? e.message : '加载失败，请重试'
  } finally { if (request === sequence) loading.value = false }
}
function search() { page.value = 1; void load() }
watch(() => props.modelValue, open => {
  ++sequence
  if (open) { selected.value = []; keyword.value = ''; page.value = 1; void load() }
})
function toggle(id: string) {
  selected.value = selected.value.includes(id) ? selected.value.filter(value => value !== id) : [...selected.value, id]
}
function save() {
  try {
    groups.assign(selected.value, [props.groupId])
    ElMessage.success('已加入分组，已有成员自动去重')
    emit('update:modelValue', false)
  } catch (e) { ElMessage.error(e instanceof Error ? e.message : '本机保存失败') }
}
</script>
<template>
  <el-dialog :model-value="modelValue" title="选择源加入分组" width="980px" style="max-width: calc(100vw - 32px)" append-to-body @update:model-value="emit('update:modelValue', $event)">
    <div class="picker-filter">
      <el-select v-model="field" style="width: 110px" aria-label="查询字段"><el-option label="源名称" value="name" /><el-option label="源 ID" value="sourceIds" /></el-select>
      <el-input v-model="keyword" :placeholder="field === 'sourceIds' ? '多个源 ID 用逗号分隔' : '输入源名称'" clearable @keyup.enter="search" />
      <el-button type="primary" @click="search">查询</el-button>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-table v-loading="loading" :data="rows" :max-height="'calc(100vh - 340px)'" size="small" row-key="sourceId">
      <el-table-column width="42"><template #default="{ row }"><el-checkbox :model-value="selected.includes(row.sourceId)" :aria-label="`选择 ${row.name}`" @change="toggle(row.sourceId)" /></template></el-table-column>
      <el-table-column prop="sourceId" label="源 ID" width="120" />
      <el-table-column prop="name" label="源名称" min-width="160" show-overflow-tooltip />
      <el-table-column prop="siteId" label="网站 ID" width="100" />
      <el-table-column prop="url" label="URL" min-width="200" show-overflow-tooltip />
    </el-table>
    <el-pagination v-model:current-page="page" v-model:page-size="size" :total="total" :page-sizes="[20, 40, 100]" layout="total, sizes, prev, pager, next" small @current-change="load" @size-change="search" />
    <template #footer><div class="picker-footer"><span>已选 {{ selected.length }} 个源（跨页保留）</span><el-button :icon="Refresh" circle size="small" aria-label="刷新源列表" title="刷新源列表" @click="load" /><el-button @click="emit('update:modelValue', false)">取消</el-button><el-button type="primary" :disabled="!selected.length" @click="save">加入分组</el-button></div></template>
  </el-dialog>
</template>
<style scoped>
.picker-filter { display: flex; gap: 8px; margin-bottom: 12px; }
.picker-filter .el-input { flex: 1; }
.picker-footer { display: flex; gap: 8px; align-items: center; justify-content: flex-end; }
.picker-footer span { margin-right: auto; color: var(--rc-muted); }
.el-pagination { margin-top: 12px; }
</style>
