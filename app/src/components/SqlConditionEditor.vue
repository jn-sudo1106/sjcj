<script setup lang="ts">
// 保留调用方原有输入控件（含 autocomplete），只统一放大编辑与草稿回填。
import { computed, ref, watch } from 'vue'
import { ElButton, ElDialog, ElDropdown, ElDropdownItem, ElDropdownMenu } from 'element-plus'
import { ArrowDown, FullScreen } from '@element-plus/icons-vue'
import { clearSqlConditions, readSqlConditions } from '@/utils/sqlConditionHistory'

const props = defineProps<{
  modelValue: string
  tableId?: string
  tableName?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const opened = ref(false)
const draft = ref('')
const editor = ref<HTMLTextAreaElement>()
const recent = ref<string[]>([])
function refreshRecent() {
  recent.value = readSqlConditions(props.tableId)
}
function selectRecent(command: number | 'clear') {
  if (command === 'clear') {
    clearSqlConditions(props.tableId)
    refreshRecent()
  } else {
    draft.value = recent.value[command] ?? draft.value
  }
}
// 原生单行 input 会直接删除换行，把 NULL\nAND 显示成 NULLAND；紧凑框用空格展示，草稿仍保留原文。
const compactValue = computed(() => props.modelValue.replace(/\r\n|\r|\n/g, ' '))
function update(value: string) {
  emit('update:modelValue', value)
}

function open() {
  draft.value = props.modelValue
  refreshRecent()
  opened.value = true
}
function apply() {
  emit('update:modelValue', draft.value)
  opened.value = false
}
// 外部清空、切表时丢弃旧草稿，避免应用到另一个查询上下文。
watch([() => props.modelValue, () => props.tableId], () => { opened.value = false })
</script>

<template>
  <span class="sql-condition-field">
    <slot :value="compactValue" :update="update" />
    <!-- 只留图标按钮，不写「放大」两个字（2026-09-05）：条件框本来就窄，
         这两个字白占宽度；图标 + title/aria-label 已经说清楚了。 -->
    <button class="sql-expand" type="button" aria-label="放大编辑 SQL 条件" title="放大编辑 SQL 条件" @click="open">
      <FullScreen aria-hidden="true" />
    </button>
    <ElDialog
      v-model="opened"
      title="SQL 条件"
      width="900px"
      top="6vh"
      :style="{ maxWidth: 'calc(100vw - 32px)' }"
      append-to-body
      destroy-on-close
      :close-on-click-modal="false"
      @opened="editor?.focus()"
      @keydown.esc.stop="opened = false"
    >
      <div class="sql-editor-body">
        <div class="sql-editor-head">
          <p v-if="tableId || tableName" class="sql-table">
            当前数据表：{{ tableName || tableId }}<template v-if="tableName && tableId && tableName !== tableId">（{{ tableId }}）</template>
          </p>
          <ElDropdown trigger="click" :max-height="280" @visible-change="refreshRecent" @command="selectRecent">
            <ElButton size="small" class="sql-recent-trigger">最近条件<ArrowDown class="sql-recent-arrow" /></ElButton>
            <template #dropdown>
              <ElDropdownMenu>
                <ElDropdownItem v-if="!recent.length" disabled>暂无最近条件，成功查询后自动记录</ElDropdownItem>
                <ElDropdownItem v-for="(condition, index) in recent" :key="condition" :command="index">
                  <span class="sql-recent-condition" :title="condition">{{ condition }}</span>
                </ElDropdownItem>
                <ElDropdownItem v-if="recent.length" command="clear" divided>清空当前表的最近条件</ElDropdownItem>
              </ElDropdownMenu>
            </template>
          </ElDropdown>
        </div>
        <textarea
          ref="editor"
          v-model="draft"
          class="sql-editor"
          aria-label="SQL 条件编辑区"
          placeholder="如 K1 LIKE '%关键词%' AND K5 IS NOT NULL"
          spellcheck="false"
        />
        <p class="sql-hint">使用列头上的物理列名，仅填写筛选条件。</p>
      </div>
      <template #footer>
        <div class="sql-editor-footer">
          <span class="sql-hint">应用后回填查询框，不会自动查询</span>
          <div class="sql-editor-actions">
            <ElButton @click="opened = false">取消</ElButton>
            <ElButton type="primary" @click="apply">应用条件</ElButton>
          </div>
        </div>
      </template>
    </ElDialog>
  </span>
</template>

<style scoped>
.sql-condition-field { position: relative; display: inline-flex; align-items: center; width: 240px; min-width: 0; max-width: 100%; vertical-align: middle; }
.sql-condition-field :deep(input) { width: 100%; min-width: 0; max-width: none; padding-right: 60px; }
.sql-condition-field :deep(.el-input), .sql-condition-field :deep(.el-autocomplete) { width: 100%; min-width: 0; }
.sql-condition-field :deep(.el-input__wrapper) { padding-right: 58px; }
.sql-condition-field :deep(.el-input__inner) { padding-right: 0; }
.sql-expand { position: absolute; right: 5px; top: 50%; transform: translateY(-50%); display: inline-flex; align-items: center; justify-content: center; padding: 4px; border: 0; border-radius: 4px; background: var(--rc-surface, #fff); color: var(--rc-muted, #64748b); font-size: 12px; white-space: nowrap; cursor: pointer; }
.sql-expand svg { width: 13px; height: 13px; }
.sql-expand:hover { color: var(--rc-primary, #2563eb); background: var(--rc-primary-bg, #eff6ff); }
.sql-expand:focus-visible { outline: 2px solid var(--rc-primary, #2563eb); outline-offset: 1px; }
.sql-editor-body { display: flex; flex-direction: column; gap: 12px; }
.sql-editor-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.sql-editor-head :deep(.el-dropdown) { margin-left: auto; }
.sql-recent-arrow { width: 12px; height: 12px; margin-left: 6px; }
.sql-recent-condition { display: block; max-width: min(460px, calc(100vw - 80px)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--rc-mono, monospace); }
.sql-table, .sql-hint { margin: 0; color: var(--rc-muted, #64748b); font-size: 12px; overflow-wrap: anywhere; }
.sql-editor { box-sizing: border-box; width: 100%; height: clamp(140px, 38vh, 320px); min-height: 120px; max-height: 45vh; padding: 12px 14px; resize: vertical; border: 1px solid var(--rc-border, #e2e8f0); border-radius: 6px; background: var(--rc-surface, #fff); color: var(--rc-text, #0f172a); font: 14px/1.7 var(--rc-mono, monospace); }
.sql-editor:focus { border-color: var(--rc-primary, #2563eb); outline: 2px solid var(--rc-primary-bg, #eff6ff); }
.sql-editor-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.sql-editor-actions { display: flex; margin-left: auto; }
</style>
