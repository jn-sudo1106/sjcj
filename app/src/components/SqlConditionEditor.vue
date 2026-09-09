<script setup lang="ts">
// 保留调用方原有输入控件（含 autocomplete），只统一放大编辑与草稿回填。
import { computed, ref, watch } from 'vue'
import { ElButton, ElDialog, ElDropdown, ElDropdownItem, ElDropdownMenu } from 'element-plus'
import { ArrowDown, Clock, FullScreen } from '@element-plus/icons-vue'
import { clearSqlConditions, readSqlConditions } from '@/utils/sqlConditionHistory'
import { stripTrailingSemicolon } from '@/utils/sqlCondition'

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
/**
 * 紧凑行上的「最近条件」（0904 I04）。
 *
 * 产品明确「**放大是放大，最近条件是最近条件，这两个不一个东西**」——原来最近条件只藏在
 * 放大弹窗里，等于逼着用户先放大才能取历史，把两件事绑成了一件。这里给紧凑行一份独立入口。
 *
 * 与弹窗里那份的区别：**这里直接落到 modelValue**（选完就填进查询框），弹窗里那份落到 draft
 * （还要点确认）。所以不能共用 selectRecent。
 */
function selectRecentCompact(command: number | 'clear') {
  if (command === 'clear') {
    clearSqlConditions(props.tableId)
    refreshRecent()
    return
  }
  const picked = recent.value[command]
  // 只填入不自动查询（0903 Y6-4 的口径，避免误触发大查询）
  if (picked !== undefined) emit('update:modelValue', picked)
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
  // 确认时削掉末尾分号（2026-09-09）：从数据库客户端整段复制过来的语句常带着它，
  // 而这里的输入是拼进 WHERE 的片段，带分号后端直接报错。
  // **只在这里做、不在 update() 里做**——紧凑行每次按键都会走 update，
  // 输入过程中的 `K2 LIKE '%;` 是合法中间态，当场削掉会把用户正在打的字符吃掉。
  emit('update:modelValue', stripTrailingSemicolon(draft.value))
  opened.value = false
}
// 外部清空、切表时丢弃旧草稿，避免应用到另一个查询上下文。
watch([() => props.modelValue, () => props.tableId], () => { opened.value = false })
</script>

<template>
  <span class="sql-condition-field">
    <slot :value="compactValue" :update="update" />
    <!-- 右端两个图标按钮：最近条件、放大编辑。
         **都不写文字**（2026-09-05）：条件框本来就窄，字白占宽度；title/aria-label 说清楚即可。
         两者是**两件事**（0904 I04 原话「放大是放大，最近条件是最近条件，这两个不一个东西」），
         所以最近条件在紧凑行独立可用，不必先放大。 -->
    <span class="sql-actions">
      <ElDropdown trigger="click" :max-height="280" @visible-change="refreshRecent" @command="selectRecentCompact">
        <button class="sql-icon-btn" type="button" aria-label="最近使用的 SQL 条件" title="最近使用的 SQL 条件">
          <Clock aria-hidden="true" />
        </button>
        <template #dropdown>
          <ElDropdownMenu>
            <ElDropdownItem v-if="!recent.length" disabled>暂无最近条件，成功查询后自动记录</ElDropdownItem>
            <ElDropdownItem v-for="(condition, index) in recent" :key="condition" :command="index">
              <!-- class 与弹窗里那份**故意不同**：两个下拉的菜单都挂在 body 上，
                   同名 class 会让选择器（和测试）分不清是哪一个 -->
              <span class="sql-recent-condition-compact" :title="condition">{{ condition }}</span>
            </ElDropdownItem>
            <ElDropdownItem v-if="recent.length" command="clear" divided>清空当前表的最近条件</ElDropdownItem>
          </ElDropdownMenu>
        </template>
      </ElDropdown>
      <button class="sql-icon-btn" type="button" aria-label="放大编辑 SQL 条件" title="放大编辑 SQL 条件" @click="open">
        <FullScreen aria-hidden="true" />
      </button>
    </span>
    <!-- close-on-click-modal 保持默认的 true（0904 I05）：产品原话
         「点一下外面就取消掉了，一般都没有取消」——点遮罩即关，所以也不留「取消」按钮。 -->
    <ElDialog
      v-model="opened"
      title="SQL 条件"
      width="900px"
      top="6vh"
      :style="{ maxWidth: 'calc(100vw - 32px)' }"
      append-to-body
      destroy-on-close
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
          <span class="sql-hint">确认后回填查询框，不会自动查询</span>
          <div class="sql-editor-actions">
            <!-- 0904 I05：产品原话「来确定吧，没什么应用条件，就是确定……
                 或者没有取消这个确定，然后点一下外面就取消掉了，一般都没有取消」 -->
            <ElButton type="primary" @click="apply">确认</ElButton>
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
.sql-actions { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); display: inline-flex; align-items: center; gap: 1px; }
.sql-icon-btn { display: inline-flex; align-items: center; justify-content: center; padding: 4px; border: 0; border-radius: 4px; background: var(--rc-surface, #fff); color: var(--rc-muted, #64748b); cursor: pointer; }
.sql-icon-btn svg { width: 13px; height: 13px; }
.sql-icon-btn:hover { color: var(--rc-primary, #2563eb); background: var(--rc-primary-bg, #eff6ff); }
.sql-icon-btn:focus-visible { outline: 2px solid var(--rc-primary, #2563eb); outline-offset: 1px; }
.sql-editor-body { display: flex; flex-direction: column; gap: 12px; }
.sql-editor-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.sql-editor-head :deep(.el-dropdown) { margin-left: auto; }
.sql-recent-arrow { width: 12px; height: 12px; margin-left: 6px; }
.sql-recent-condition, .sql-recent-condition-compact { display: block; max-width: min(460px, calc(100vw - 80px)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--rc-mono, monospace); }
.sql-table, .sql-hint { margin: 0; color: var(--rc-muted, #64748b); font-size: 12px; overflow-wrap: anywhere; }
.sql-editor { box-sizing: border-box; width: 100%; height: clamp(140px, 38vh, 320px); min-height: 120px; max-height: 45vh; padding: 12px 14px; resize: vertical; border: 1px solid var(--rc-border, #e2e8f0); border-radius: 6px; background: var(--rc-surface, #fff); color: var(--rc-text, #0f172a); font: 14px/1.7 var(--rc-mono, monospace); }
.sql-editor:focus { border-color: var(--rc-primary, #2563eb); outline: 2px solid var(--rc-primary-bg, #eff6ff); }
.sql-editor-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.sql-editor-actions { display: flex; margin-left: auto; }
</style>
