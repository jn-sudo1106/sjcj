<script setup lang="ts">
import { computed } from 'vue'

type MaintenanceAction =
  | 'reprocess'
  | 'delete-selected'
  | 'delete-source-day'
  | 'delete-source-all'
  | 'delete-ids'
  | 'mark-formal'
  | 'clear-table-day'
  | 'clear-table-all'
  | 'clear-parent'

const props = defineProps<{
  modelValue: boolean
  tableId: string
  tableName?: string
  sourceId?: string
  selectedCount: number
  isTestTable: boolean
  canClearParent: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  action: [MaintenanceAction]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

function run(action: MaintenanceAction) {
  emit('action', action)
}
</script>

<template>
  <el-drawer v-model="visible" title="数据维护" size="480px">
    <div class="dm-context">
      <div><span>当前表</span><b>{{ tableName || tableId || '未选择' }}</b></div>
      <div><span>当前源</span><b>{{ sourceId || '全部源' }}</b></div>
      <div><span>已选数据</span><b>{{ selectedCount }} 条</b></div>
    </div>

    <div class="dm-section">
      <div class="dm-section-title">处理与标识</div>
      <button class="dm-action" type="button" @click="run('reprocess')">
        <strong>重新处理后续步骤</strong>
        <span>让当前条件下的数据重新进入后续步骤。</span>
      </button>
      <button class="dm-action" type="button" :disabled="!canClearParent" @click="run('clear-parent')">
        <strong>清除父表后续标识</strong>
        <span>{{ canClearParent ? '清除选中数据的父表后续标识，操作前会再次确认。' : '仅管理员可用；请先选择当前源和数据。' }}</span>
      </button>
    </div>

    <div v-if="isTestTable" class="dm-section">
      <div class="dm-section-title">测试表数据</div>
      <button class="dm-action" type="button" :disabled="!selectedCount" @click="run('delete-selected')">
        <strong>删除选中数据</strong>
        <span>当前已选择 {{ selectedCount }} 条，删除后无法恢复。</span>
      </button>
      <button class="dm-action" type="button" @click="run('delete-source-day')">
        <strong>删除当前源当日数据</strong>
        <span>仅影响当前源当天写入的数据。</span>
      </button>
      <button class="dm-action" type="button" @click="run('delete-source-all')">
        <strong>删除当前源全部数据</strong>
        <span>仅影响当前源在本表中的全部数据。</span>
      </button>
      <button class="dm-action" type="button" @click="run('delete-ids')">
        <strong>按 ID 删除</strong>
        <span>手动输入数据 ID，每条一行。</span>
      </button>
      <button class="dm-action" type="button" @click="run('mark-formal')">
        <strong>转为正式表</strong>
        <span>转为正式表后，不再允许从页面删除表数据。</span>
      </button>
      <button class="dm-action danger" type="button" @click="run('clear-table-day')">
        <strong>清空表当日数据</strong>
        <span>清除本表当天数据，操作不可恢复。</span>
      </button>
      <button class="dm-action danger" type="button" @click="run('clear-table-all')">
        <strong>清空表全部数据</strong>
        <span>清除本表全部数据，需要输入确认短语。</span>
      </button>
    </div>
  </el-drawer>
</template>

<style scoped>
.dm-context {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--rc-border-soft);
  border-radius: var(--rc-radius-sm);
  background: #f8fafc;
  color: var(--rc-muted);
  font-size: 12px;
}
.dm-context div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}
.dm-context b {
  max-width: 280px;
  overflow: hidden;
  color: var(--rc-text-2);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dm-section {
  display: grid;
  gap: 8px;
  margin-top: 20px;
}
.dm-section-title {
  color: var(--rc-text);
  font-size: 13px;
  font-weight: 700;
}
.dm-action {
  display: grid;
  gap: 4px;
  padding: 11px 12px;
  border: 1px solid var(--rc-border-soft);
  border-radius: var(--rc-radius-sm);
  background: #fff;
  color: var(--rc-text-2);
  text-align: left;
  cursor: pointer;
}
.dm-action:hover:not(:disabled) {
  border-color: #bfdbfe;
  background: var(--rc-primary-bg);
}
.dm-action:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.dm-action strong {
  font-size: 13px;
  font-weight: 600;
}
.dm-action span {
  color: var(--rc-muted);
  font-size: 11px;
  line-height: 1.5;
}
.dm-action.danger strong {
  color: var(--rc-danger, #dc2626);
}
</style>
