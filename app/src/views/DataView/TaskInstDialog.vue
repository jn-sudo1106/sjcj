<script setup lang="ts">
import { reactive, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { dataApi, type TaskInst } from '../../api'

const props = defineProps<{
  modelValue: boolean
  sourceId?: string
  parentId?: string | null
  taskId?: string
  configId?: string
  fileId?: string
  // 重发是危险操作（endpoints.ts danger:true），read 角色不可见（方案 DoD：写入口对 read 完全隐藏）
  canWrite?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const STATE_OPTIONS = [
  { value: '', label: '-不限-' },
  { value: 'E', label: '出错-E' },
  { value: 'C', label: '完成-C' },
  { value: 'L', label: '处理中-L' },
  { value: 'W1', label: '排队-W1' },
  { value: 'W', label: '待处理-W' },
  { value: 'AC', label: '跳过-AC' },
]

const filter = reactive({ state: '', taskSpecId: '', sourceId: '', taskId: '', configId: '', parentId: '', fileId: '' })
const page = reactive({ page: 1, size: 20, total: 0 })
const state = reactive<{ loading: boolean; rows: TaskInst[]; selected: string[] }>({ loading: false, rows: [], selected: [] })

watch(() => props.modelValue, (v) => {
  if (!v) return
  filter.sourceId = props.sourceId ?? ''
  filter.parentId = props.parentId ?? ''
  filter.taskId = props.taskId ?? ''
  filter.configId = props.configId ?? ''
  filter.fileId = props.fileId ?? ''
  page.page = 1
  void load()
})

async function load() {
  state.loading = true
  try {
    const r = await dataApi.taskInstPaged({
      page: page.page, size: page.size,
      state: filter.state || undefined,
      taskSpecId: filter.taskSpecId || undefined,
      sourceId: filter.sourceId || undefined,
      taskId: filter.taskId || undefined,
      configId: filter.configId || undefined,
      parentId: filter.parentId || undefined,
      fileId: filter.fileId || undefined,
    })
    state.rows = r.list
    page.total = r.total
    state.selected = []
  } catch (error) {
    ElMessage.error(`查询失败:${error instanceof Error ? error.message : String(error)}`)
  } finally {
    state.loading = false
  }
}
function onSearch() { page.page = 1; void load() }
function onPageChange() { void load() }

async function resend(taskIds: string[]) {
  try {
    const r = await dataApi.resendTask(taskIds)
    ElMessage.success(`已重置为待发送:${taskIds.length}` + (r.message ? ` / ${r.message}` : ''))
    await load()
  } catch (error) {
    ElMessage.error(`重置失败:${error instanceof Error ? error.message : String(error)}`)
  }
}
function resendBatch() {
  if (!state.selected.length) return
  void resend(state.selected)
}
function resendOne(row: TaskInst) {
  void resend([row.taskId])
}
</script>

<template>
  <el-dialog :model-value="modelValue" title="任务实例" width="90%" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <div class="ti-filters">
      <el-select v-model="filter.state" style="width: 120px" @change="onSearch">
        <el-option v-for="o in STATE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-input v-model="filter.taskSpecId" placeholder="任务规格" style="width: 120px" @keyup.enter="onSearch" />
      <el-input v-model="filter.sourceId" placeholder="源" style="width: 120px" @keyup.enter="onSearch" />
      <el-input v-model="filter.taskId" placeholder="任务ID" style="width: 120px" @keyup.enter="onSearch" />
      <el-input v-model="filter.configId" placeholder="配置ID" style="width: 120px" @keyup.enter="onSearch" />
      <el-input v-model="filter.parentId" placeholder="父ID" style="width: 120px" @keyup.enter="onSearch" />
      <el-input v-model="filter.fileId" placeholder="文件ID" style="width: 120px" @keyup.enter="onSearch" />
      <button class="rc-btn primary" type="button" @click="onSearch">查询</button>
    </div>
    <div v-if="canWrite && state.selected.length" class="ti-batch">
      <button class="rc-btn primary" type="button" @click="resendBatch">重发（{{ state.selected.length }}）</button>
    </div>
    <el-table
      v-loading="state.loading"
      :data="state.rows"
      style="width: 100%; margin-top: 12px"
      row-key="taskId"
      @selection-change="(rows: TaskInst[]) => (state.selected = rows.map((r) => r.taskId))"
    >
      <el-table-column v-if="canWrite" type="selection" width="42" />
      <el-table-column prop="taskId" label="任务ID" width="110" />
      <el-table-column prop="state" label="状态" width="70" />
      <el-table-column prop="taskSpecId" label="类型" width="80" />
      <el-table-column prop="typeName" label="类型名" width="110" />
      <el-table-column prop="taskName" label="任务名" />
      <el-table-column prop="sourceId" label="源ID" width="100" />
      <el-table-column prop="configId" label="配置ID" width="90" />
      <el-table-column prop="updatedAt" label="更新时间" width="140" />
      <el-table-column prop="node" label="执行节点" width="140" />
      <el-table-column prop="topic" label="主题" width="140" />
      <el-table-column prop="parentId" label="父ID" width="90" />
      <el-table-column v-if="canWrite" label="操作" width="80" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="resendOne(row)">重发</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="page.page"
      v-model:page-size="page.size"
      :total="page.total"
      :page-sizes="[10, 30, 100, 200]"
      layout="total, sizes, prev, pager, next, jumper"
      background
      small
      style="margin-top: 12px"
      @current-change="onPageChange"
      @size-change="onSearch"
    />
  </el-dialog>
</template>

<style scoped>
.ti-filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.ti-batch {
  margin: 12px 0 0;
}
</style>
