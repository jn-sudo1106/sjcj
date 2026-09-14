<script setup lang="ts">
// 保留调用方原有输入控件（含 autocomplete），统一字段选择、智能联想、放大编辑与草稿回填。
import { computed, ref, watch } from 'vue'
import {
  ElButton,
  ElDialog,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElInput,
  ElPopover,
} from 'element-plus'
import { ArrowDown, Clock, Filter, FullScreen, Search } from '@element-plus/icons-vue'
import { clearSqlConditions, readSqlConditions } from '@/utils/sqlConditionHistory'
import { stripTrailingSemicolon } from '@/utils/sqlCondition'
import { dataApi } from '@/api'

export interface SqlFieldItem {
  prop: string
  columnName?: string
  desc?: string
  label?: string
  type?: string
  sample?: string
}

export interface NormalizedSqlField {
  columnName: string
  desc: string
  label: string
  type?: string
}

const props = defineProps<{
  modelValue: string
  tableId?: string
  tableName?: string
  fields?: SqlFieldItem[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const root = ref<HTMLElement>()
const opened = ref(false)
const draft = ref('')
const editor = ref<HTMLTextAreaElement>()
const recent = ref<string[]>([])
const fetchedFields = ref<SqlFieldItem[]>([])
const loadingFields = ref(false)

// 字段选择 Popover 状态
const fieldPopoverOpen = ref(false)
const fieldSearch = ref('')
const fieldSearchInputRef = ref<InstanceType<typeof ElInput>>()

// 放大弹窗中字段搜索
const dialogFieldSearch = ref('')

// 智能联想下拉建议
const showSuggestions = ref(false)
const inlineSuggestions = ref<{ field: NormalizedSqlField; snippet: string; label: string; op: string }[]>([])
const activeSuggestionIndex = ref(0)

function refreshRecent() {
  recent.value = readSqlConditions(props.tableId)
}

async function ensureFields() {
  if (props.fields && props.fields.length > 0) return
  if (!props.tableId) return
  loadingFields.value = true
  try {
    const res = await dataApi.tableMeta(props.tableId)
    if (res?.fields) {
      fetchedFields.value = res.fields
    }
  } catch {
    // 忽略加载错误
  } finally {
    loadingFields.value = false
  }
}

function onFieldPopoverShow() {
  ensureFields()
  requestAnimationFrame(() => {
    fieldSearchInputRef.value?.focus()
  })
}

const normalizedFields = computed<NormalizedSqlField[]>(() => {
  const list = (props.fields && props.fields.length > 0) ? props.fields : fetchedFields.value
  if (!list.length) return []
  return list.map((f) => {
    const columnName = (f.columnName || f.prop || '').trim()
    const desc = (f.desc || f.label || '').trim()
    let label = ''
    if (f.label) {
      label = f.label
    } else if (desc && desc.toUpperCase() !== columnName.toUpperCase()) {
      label = `${desc} (${columnName})`
    } else {
      label = columnName
    }
    return {
      columnName,
      desc: desc || columnName,
      label,
      type: f.type,
    }
  }).filter((f) => Boolean(f.columnName))
})

const hasFieldsOrTable = computed(() => normalizedFields.value.length > 0 || Boolean(props.tableId))

const filteredFields = computed(() => {
  const q = fieldSearch.value.trim().toLowerCase()
  if (!q) return normalizedFields.value
  return normalizedFields.value.filter((f) =>
    f.columnName.toLowerCase().includes(q) ||
    f.desc.toLowerCase().includes(q) ||
    f.label.toLowerCase().includes(q)
  )
})

const dialogFilteredFields = computed(() => {
  const q = dialogFieldSearch.value.trim().toLowerCase()
  if (!q) return normalizedFields.value
  return normalizedFields.value.filter((f) =>
    f.columnName.toLowerCase().includes(q) ||
    f.desc.toLowerCase().includes(q) ||
    f.label.toLowerCase().includes(q)
  )
})

function buildConditionSnippet(col: string, op: string) {
  let snippet = ''
  let cursorOffset = 0
  switch (op) {
    case '= ':
    case '=':
    case "= ''":
      snippet = `${col} = ''`
      cursorOffset = snippet.length - 1
      break
    case 'LIKE':
    case "LIKE '%%'":
      snippet = `${col} LIKE '%%'`
      cursorOffset = snippet.length - 2
      break
    case 'IS NOT NULL':
      snippet = `${col} IS NOT NULL`
      cursorOffset = snippet.length
      break
    case 'IS NULL':
      snippet = `${col} IS NULL`
      cursorOffset = snippet.length
      break
    case '<>':
    case "<> ''":
      snippet = `${col} <> ''`
      cursorOffset = snippet.length - 1
      break
    default:
      snippet = `${col} = ''`
      cursorOffset = snippet.length - 1
  }
  return { snippet, cursorOffset }
}

/**
 * 在紧凑行上应用选中的字段条件。
 * 若已有条件，自动以 AND 拼接；插入后将光标聚焦于引号中，便于直接粘贴或键入值。
 */
function applyFieldConditionCompact(field: NormalizedSqlField, op: string = "= ''") {
  const { snippet, cursorOffset } = buildConditionSnippet(field.columnName, op)
  const cur = props.modelValue.trim()
  let nextVal = ''
  let cursorTarget = 0

  if (!cur) {
    nextVal = snippet
    cursorTarget = cursorOffset
  } else if (/\b(AND|OR)\s*$/i.test(cur)) {
    nextVal = `${cur} ${snippet}`
    cursorTarget = cur.length + 1 + cursorOffset
  } else {
    nextVal = `${cur} AND ${snippet}`
    cursorTarget = cur.length + 5 + cursorOffset
  }

  emit('update:modelValue', nextVal)
  fieldPopoverOpen.value = false

  requestAnimationFrame(() => {
    const input = root.value?.querySelector('input')
    if (input) {
      input.focus()
      input.setSelectionRange(cursorTarget, cursorTarget)
    }
  })
}

/**
 * 放大弹窗中点击字段插入草稿。
 */
function insertFieldToDraft(field: NormalizedSqlField, op: string = "= ''") {
  const { snippet, cursorOffset } = buildConditionSnippet(field.columnName, op)
  const ta = editor.value
  if (!ta) {
    draft.value = draft.value ? `${draft.value} AND ${snippet}` : snippet
    return
  }

  const start = ta.selectionStart ?? draft.value.length
  const end = ta.selectionEnd ?? start
  const before = draft.value.slice(0, start)
  const after = draft.value.slice(end)

  let prefix = ''
  if (before.trim().length > 0 && !/\b(AND|OR)\s*$/i.test(before.trim())) {
    prefix = ' AND '
  }

  const inserted = prefix + snippet
  draft.value = before + inserted + after

  requestAnimationFrame(() => {
    ta.focus()
    const target = start + prefix.length + cursorOffset
    ta.setSelectionRange(target, target)
  })
}

// 智能键入联想
function checkInlineSuggestions(el: HTMLInputElement) {
  if (!normalizedFields.value.length) {
    showSuggestions.value = false
    return
  }
  const val = el.value
  const pos = el.selectionStart ?? val.length
  const before = val.slice(0, pos)

  // 引号未闭合时不提示
  const singleQuotes = (before.match(/'/g) || []).length
  if (singleQuotes % 2 !== 0) {
    showSuggestions.value = false
    return
  }

  // 提取光标前的单词/词组
  const match = before.match(/([a-zA-Z0-9_\u4e00-\u9fa5]+)$/)
  if (!match) {
    showSuggestions.value = false
    return
  }

  const word = match[1].toLowerCase()
  const SQL_KEYWORDS = new Set(['and', 'or', 'not', 'is', 'null', 'like', 'in', 'between', 'where', 'select', 'from'])
  if (SQL_KEYWORDS.has(word)) {
    showSuggestions.value = false
    return
  }

  const matched = normalizedFields.value.filter((f) =>
    f.columnName.toLowerCase().startsWith(word) ||
    f.desc.toLowerCase().includes(word)
  )

  if (!matched.length) {
    showSuggestions.value = false
    return
  }

  const list: typeof inlineSuggestions.value = []
  for (const f of matched.slice(0, 4)) {
    list.push({
      field: f,
      op: "= ''",
      snippet: `${f.columnName} = ''`,
      label: `${f.columnName} = '' (${f.desc})`,
    })
    list.push({
      field: f,
      op: "LIKE '%%'",
      snippet: `${f.columnName} LIKE '%%'`,
      label: `${f.columnName} LIKE '%%' (${f.desc})`,
    })
  }
  inlineSuggestions.value = list.slice(0, 6)
  activeSuggestionIndex.value = 0
  showSuggestions.value = true
}

function applyInlineSuggestion(item: typeof inlineSuggestions.value[0]) {
  const input = root.value?.querySelector('input')
  if (!input) return
  const val = input.value
  const pos = input.selectionStart ?? val.length
  const before = val.slice(0, pos)
  const after = val.slice(pos)

  const replacedBefore = before.replace(/([a-zA-Z0-9_\u4e00-\u9fa5]+)$/, item.snippet)
  const nextVal = replacedBefore + after

  emit('update:modelValue', nextVal)
  showSuggestions.value = false

  requestAnimationFrame(() => {
    input.focus()
    const { cursorOffset } = buildConditionSnippet(item.field.columnName, item.op)
    const newPos = replacedBefore.length - item.snippet.length + cursorOffset
    input.setSelectionRange(newPos, newPos)
  })
}

function onInputNative(e: Event) {
  const el = e.target as HTMLInputElement
  if (!el || typeof el.selectionStart !== 'number') return
  checkInlineSuggestions(el)
}

function onKeyDown(e: KeyboardEvent) {
  if (!showSuggestions.value || !inlineSuggestions.value.length) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeSuggestionIndex.value = (activeSuggestionIndex.value + 1) % inlineSuggestions.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeSuggestionIndex.value = (activeSuggestionIndex.value - 1 + inlineSuggestions.value.length) % inlineSuggestions.value.length
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    if (showSuggestions.value) {
      e.preventDefault()
      applyInlineSuggestion(inlineSuggestions.value[activeSuggestionIndex.value])
    }
  } else if (e.key === 'Escape') {
    showSuggestions.value = false
  }
}

function onBlur() {
  setTimeout(() => {
    showSuggestions.value = false
  }, 200)
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

/**
 * 往紧凑框里**粘贴多行 SQL**（2026-09-09 生产实测的真实故障）。
 *
 * HTML 规范里 `<input>` 的值净化算法是「剥掉换行符」，不是「换成空格」——多行条件粘进来
 * 就成了 `…'9009349')and k24 !=''AND k17 <> 2AND k2 …`：括号、引号、数字与后面的 AND
 * 黏成一个词。后端 SQL 解析不了，报的还是一句误导人的「传到的条件含有非法注入风险」，
 * 用户完全看不出是自己粘贴时掉了换行。实测同一条件把换行换成空格就正常返回。
 *
 * 拦在组件根元素上是为了**不改任何调用点**：input 由各调用方通过 slot 自己渲染，
 * 但 paste 事件会冒泡到这里。放大弹窗那个 textarea 天生支持多行，且 ElDialog 挂在
 * body 上、不在本组件子树内，不会被这里拦到，多行原文照旧保留。
 */
function onPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text') ?? ''
  if (!/[\r\n]/.test(text)) return
  const el = e.target as HTMLInputElement | null
  if (!el || typeof el.selectionStart !== 'number') return
  e.preventDefault()
  // 紧凑框显示的是 compactValue（换行已按 1:1 换成空格），所以选区下标与 modelValue 对得上
  const start = el.selectionStart ?? 0
  const end = el.selectionEnd ?? start
  const cur = props.modelValue
  emit('update:modelValue', cur.slice(0, start) + text.replace(/\r\n|\r|\n/g, ' ') + cur.slice(end))
}

function open() {
  draft.value = props.modelValue
  refreshRecent()
  ensureFields()
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
watch([() => props.modelValue, () => props.tableId], () => {
  opened.value = false
  showSuggestions.value = false
  fetchedFields.value = []
})
</script>

<template>
  <span
    ref="root"
    class="sql-condition-field"
    @paste="onPaste"
    @input="onInputNative"
    @keydown="onKeyDown"
    @focusout="onBlur"
  >
    <slot :value="compactValue" :update="update" />

    <!-- 智能联想下拉建议（键入字段时触发） -->
    <div
      v-if="showSuggestions && inlineSuggestions.length"
      class="sql-inline-suggestions"
      role="listbox"
    >
      <div
        v-for="(item, idx) in inlineSuggestions"
        :key="item.label"
        class="sql-suggestion-item"
        :class="{ active: idx === activeSuggestionIndex }"
        @mousedown.prevent="applyInlineSuggestion(item)"
      >
        <span class="sql-sug-snippet">{{ item.snippet }}</span>
        <span class="sql-sug-desc">{{ item.field.desc }}</span>
      </div>
    </div>

    <!-- 右端图标按钮：字段选择、最近条件、放大编辑 -->
    <span class="sql-actions">
      <!-- 字段快捷查询/插入（漏斗图标） -->
      <ElPopover
        v-if="hasFieldsOrTable"
        v-model:visible="fieldPopoverOpen"
        trigger="click"
        :width="360"
        placement="bottom-end"
        popper-class="sql-field-popover"
        :teleported="true"
        @show="onFieldPopoverShow"
      >
        <template #reference>
          <button
            class="sql-icon-btn sql-field-btn"
            type="button"
            aria-label="按字段查询"
            title="按字段查询 / 插入字段条件"
          >
            <Filter aria-hidden="true" />
          </button>
        </template>
        <div class="sql-field-panel">
          <div class="sql-field-head">
            <div class="sql-field-title">
              <span>按字段查询</span>
              <span v-if="filteredFields.length" class="sql-field-count">（{{ filteredFields.length }}个字段）</span>
            </div>
            <ElInput
              ref="fieldSearchInputRef"
              v-model="fieldSearch"
              placeholder="搜索列名或字段说明（如 K23、正文）"
              size="small"
              clearable
              :prefix-icon="Search"
              class="sql-field-search"
            />
          </div>
          <div v-if="loadingFields" class="sql-field-empty">正在加载字段信息…</div>
          <div v-else-if="!filteredFields.length" class="sql-field-empty">
            {{ normalizedFields.length ? '未匹配到字段' : '当前表暂无可查询字段' }}
          </div>
          <div v-else class="sql-field-list">
            <div
              v-for="f in filteredFields"
              :key="f.columnName"
              class="sql-field-row"
              :title="`点击插入 ${f.columnName} = ''`"
              @click="applyFieldConditionCompact(f, '= \'\'')"
            >
              <span class="sql-field-badge">{{ f.columnName }}</span>
              <span class="sql-field-desc">{{ f.desc }}</span>
              <div class="sql-field-op-group" @click.stop>
                <button
                  type="button"
                  class="sql-field-op"
                  title="等于"
                  @click="applyFieldConditionCompact(f, '= \'\'')"
                >=</button>
                <button
                  type="button"
                  class="sql-field-op"
                  title="包含 (LIKE)"
                  @click="applyFieldConditionCompact(f, 'LIKE \'%%\'')"
                >LIKE</button>
                <button
                  type="button"
                  class="sql-field-op"
                  title="非空"
                  @click="applyFieldConditionCompact(f, 'IS NOT NULL')"
                >非空</button>
                <button
                  type="button"
                  class="sql-field-op"
                  title="为空"
                  @click="applyFieldConditionCompact(f, 'IS NULL')"
                >为空</button>
              </div>
            </div>
          </div>
          <div class="sql-field-foot">点击行插入「= ''」，光标自动定位在引号中</div>
        </div>
      </ElPopover>

      <ElDropdown trigger="click" :max-height="280" @visible-change="refreshRecent" @command="selectRecentCompact">
        <button class="sql-icon-btn" type="button" aria-label="最近使用的 SQL 条件" title="最近使用的 SQL 条件">
          <Clock aria-hidden="true" />
        </button>
        <template #dropdown>
          <ElDropdownMenu>
            <ElDropdownItem v-if="!recent.length" disabled>暂无最近条件，成功查询后自动记录</ElDropdownItem>
            <ElDropdownItem v-for="(condition, index) in recent" :key="condition" :command="index">
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

        <!-- 弹窗内的字段快捷插入栏 -->
        <div v-if="normalizedFields.length" class="sql-dialog-fields-bar">
          <div class="sql-dialog-fields-head">
            <span class="sql-dialog-fields-title">点击字段快捷插入：</span>
            <input
              v-model="dialogFieldSearch"
              class="sql-dialog-fields-search"
              placeholder="过滤字段..."
            />
          </div>
          <div class="sql-dialog-fields-tags">
            <button
              v-for="f in dialogFilteredFields"
              :key="f.columnName"
              type="button"
              class="sql-dialog-field-tag"
              :title="`插入 ${f.columnName} = ''`"
              @click="insertFieldToDraft(f, '= \'\'')"
            >
              <span class="tag-col">{{ f.columnName }}</span>
              <span class="tag-desc">{{ f.desc }}</span>
            </button>
          </div>
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
            <ElButton type="primary" @click="apply">确认</ElButton>
          </div>
        </div>
      </template>
    </ElDialog>
  </span>
</template>

<style scoped>
.sql-condition-field { position: relative; display: inline-flex; align-items: center; width: 240px; min-width: 0; max-width: 100%; vertical-align: middle; }
.sql-condition-field :deep(input) { width: 100%; min-width: 0; max-width: none; padding-right: 80px; }
.sql-condition-field :deep(.el-input), .sql-condition-field :deep(.el-autocomplete) { width: 100%; min-width: 0; }
.sql-condition-field :deep(.el-input__wrapper) { padding-right: 78px; }
.sql-condition-field :deep(.el-input__inner) { padding-right: 0; }
.sql-actions { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); display: inline-flex; align-items: center; gap: 1px; }
.sql-icon-btn { display: inline-flex; align-items: center; justify-content: center; padding: 4px; border: 0; border-radius: 4px; background: var(--rc-surface, #fff); color: var(--rc-muted, #64748b); cursor: pointer; }
.sql-icon-btn svg { width: 13px; height: 13px; }
.sql-icon-btn:hover { color: var(--rc-primary, #2563eb); background: var(--rc-primary-bg, #eff6ff); }
.sql-icon-btn:focus-visible { outline: 2px solid var(--rc-primary, #2563eb); outline-offset: 1px; }

/* 字段选择面板与操作 */
.sql-field-btn { color: var(--rc-muted, #64748b); }
.sql-field-panel { display: flex; flex-direction: column; gap: 8px; font-size: 12px; }
.sql-field-head { display: flex; flex-direction: column; gap: 6px; }
.sql-field-title { display: flex; align-items: center; justify-content: space-between; font-weight: 600; color: var(--rc-text, #0f172a); }
.sql-field-count { font-weight: normal; font-size: 11px; color: var(--rc-muted, #64748b); }
.sql-field-search { width: 100%; }
.sql-field-empty { padding: 12px 0; text-align: center; color: var(--rc-muted, #64748b); font-size: 12px; }
.sql-field-list { display: flex; flex-direction: column; gap: 3px; max-height: 240px; overflow-y: auto; overscroll-behavior: contain; }
.sql-field-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 8px; border-radius: 4px; cursor: pointer; transition: background 0.15s; }
.sql-field-row:hover { background: var(--rc-primary-bg, #eff6ff); }
.sql-field-badge { display: inline-block; padding: 1px 5px; border-radius: 3px; background: #e2e8f0; color: #334155; font-family: var(--rc-mono, monospace); font-size: 11px; font-weight: 600; flex-shrink: 0; }
.sql-field-desc { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--rc-text, #0f172a); }
.sql-field-op-group { display: inline-flex; align-items: center; gap: 2px; flex-shrink: 0; }
.sql-field-op { padding: 1px 5px; border: 1px solid var(--rc-border, #cbd5e1); border-radius: 3px; background: #fff; color: var(--rc-muted, #64748b); font-size: 11px; cursor: pointer; }
.sql-field-op:hover { border-color: var(--rc-primary, #2563eb); color: var(--rc-primary, #2563eb); background: #f8fafc; }
.sql-field-foot { font-size: 11px; color: var(--rc-muted, #94a3b8); margin-top: 2px; }

/* 智能联想下拉建议 */
.sql-inline-suggestions { position: absolute; top: calc(100% + 4px); left: 0; right: 0; min-width: 220px; max-height: 180px; overflow-y: auto; z-index: 2050; background: #fff; border: 1px solid var(--rc-border, #cbd5e1); border-radius: 6px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); padding: 4px; display: flex; flex-direction: column; gap: 2px; }
.sql-suggestion-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; }
.sql-suggestion-item:hover, .sql-suggestion-item.active { background: var(--rc-primary-bg, #eff6ff); color: var(--rc-primary, #2563eb); }
.sql-sug-snippet { font-family: var(--rc-mono, monospace); font-weight: 500; }
.sql-sug-desc { font-size: 11px; color: var(--rc-muted, #64748b); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 弹窗中的快捷字段栏 */
.sql-dialog-fields-bar { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; background: #f8fafc; border: 1px solid var(--rc-border, #e2e8f0); border-radius: 6px; }
.sql-dialog-fields-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sql-dialog-fields-title { font-size: 12px; color: var(--rc-text, #334155); font-weight: 500; }
.sql-dialog-fields-search { width: 140px; height: 22px; padding: 0 6px; border: 1px solid var(--rc-border, #cbd5e1); border-radius: 4px; font-size: 11px; background: #fff; }
.sql-dialog-fields-tags { display: flex; flex-wrap: wrap; gap: 4px; max-height: 84px; overflow-y: auto; }
.sql-dialog-field-tag { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border: 1px solid var(--rc-border, #cbd5e1); border-radius: 4px; background: #fff; font-size: 11px; cursor: pointer; transition: all 0.15s; }
.sql-dialog-field-tag:hover { border-color: var(--rc-primary, #2563eb); background: var(--rc-primary-bg, #eff6ff); color: var(--rc-primary, #2563eb); }
.sql-dialog-field-tag .tag-col { font-family: var(--rc-mono, monospace); font-weight: 600; color: #2563eb; }
.sql-dialog-field-tag .tag-desc { color: #475569; }

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
