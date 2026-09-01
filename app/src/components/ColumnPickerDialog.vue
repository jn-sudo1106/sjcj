<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { IDENTITY_COL_PROPS, mergeFilteredReorder, reorderProps } from '@/utils/table/columnPrefs'

export interface ColumnPickerItem {
  prop: string
  label: string
}

const props = withDefaults(defineProps<{
  open: boolean
  columns: ColumnPickerItem[]
  hidden: string[]
  order: string[]
  identityProps?: readonly string[]
  minVisible?: number
  /** 一个"业务预设"的列集合，非空时多给一个一键选中的快捷项（0831 F10「下一步字段」） */
  presetProps?: string[]
  presetLabel?: string
}>(), {
  identityProps: () => IDENTITY_COL_PROPS,
  minVisible: 1,
  presetProps: () => [],
  presetLabel: '仅预设列',
})

const emit = defineEmits<{
  'update:open': [boolean]
  confirm: [{ hidden: string[]; order: string[] }]
}>()

const keyword = ref('')
const draftHidden = ref<Set<string>>(new Set())
const draftOrder = ref<string[]>([])
const dragProp = ref('')
const focusProp = ref('')

watch(() => props.open, (open) => {
  if (!open) return
  keyword.value = ''
  dragProp.value = ''
  draftHidden.value = new Set(props.hidden)
  draftOrder.value = props.order.length ? [...props.order] : props.columns.map((c) => c.prop)
  focusProp.value = draftOrder.value[0] ?? ''
}, { immediate: true })

const byProp = computed(() => new Map(props.columns.map((c) => [c.prop, c])))

const orderedColumns = computed(() => {
  const map = byProp.value
  return draftOrder.value.map((prop) => map.get(prop)).filter((c): c is ColumnPickerItem => !!c)
})

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return orderedColumns.value
  return orderedColumns.value.filter((c) => c.label.toLowerCase().includes(kw) || c.prop.toLowerCase().includes(kw))
})

const visibleCount = computed(() => orderedColumns.value.filter((c) => !draftHidden.value.has(c.prop)).length)
const showIdentity = computed(() => props.identityProps.some((prop) => byProp.value.has(prop)))

function close() {
  emit('update:open', false)
}

function toggle(prop: string) {
  const next = new Set(draftHidden.value)
  if (next.has(prop)) {
    next.delete(prop)
  } else {
    if (visibleCount.value <= props.minVisible) {
      ElMessage.warning('至少保留一列可见')
      return
    }
    next.add(prop)
  }
  draftHidden.value = next
}

function selectAll() {
  draftHidden.value = new Set()
}

function keepOnly(props_: readonly string[]) {
  const keep = new Set(props_.filter((prop) => byProp.value.has(prop)))
  if (keep.size < props.minVisible) {
    ElMessage.warning('至少保留一列可见')
    return
  }
  draftHidden.value = new Set(props.columns.map((c) => c.prop).filter((prop) => !keep.has(prop)))
}

function identityOnly() {
  keepOnly(props.identityProps)
}

const availablePreset = computed(() => props.presetProps.filter((prop) => byProp.value.has(prop)))
function presetOnly() {
  keepOnly(availablePreset.value)
}

function restoreDefault() {
  draftHidden.value = new Set()
  draftOrder.value = props.columns.map((c) => c.prop)
}

function onDragStart(prop: string, event: DragEvent) {
  dragProp.value = prop
  event.dataTransfer?.setData('text/plain', prop)
  const row = event.target instanceof Element ? event.target.closest('.cpk-row') : null
  try {
    if (row) event.dataTransfer?.setDragImage(row, 8, 8)
  } catch {
    // jsdom 没有 DragEvent.setDragImage
  }
}

function onDrop(targetProp: string) {
  const from = dragProp.value
  dragProp.value = ''
  if (!from || from === targetProp) return
  const visible = filtered.value.map((c) => c.prop)
  if (!visible.includes(from) || !visible.includes(targetProp)) return
  const visNext = reorderProps(visible, from, targetProp)
  draftOrder.value = mergeFilteredReorder(draftOrder.value, visible, visNext)
}

function moveFocus(delta: number) {
  const list = filtered.value
  if (!list.length) return
  const idx = Math.max(0, list.findIndex((c) => c.prop === focusProp.value))
  const next = list[Math.min(list.length - 1, Math.max(0, idx + delta))]
  focusProp.value = next.prop
}

function moveRow(delta: number) {
  const list = filtered.value.map((c) => c.prop)
  const from = focusProp.value
  const idx = list.indexOf(from)
  const target = list[idx + delta]
  if (!from || !target) return
  draftOrder.value = mergeFilteredReorder(draftOrder.value, list, reorderProps(list, from, target))
}

function onListKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (event.altKey) moveRow(1)
    else moveFocus(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (event.altKey) moveRow(-1)
    else moveFocus(-1)
  } else if (event.key === ' ') {
    event.preventDefault()
    if (focusProp.value) toggle(focusProp.value)
  }
}

function onConfirm() {
  emit('confirm', { hidden: [...draftHidden.value], order: draftOrder.value })
  close()
}
</script>

<template>
  <el-dialog
    :model-value="open"
    class="col-picker-dialog"
    title="列显示与顺序"
    width="480px"
    append-to-body
    :close-on-click-modal="false"
    @update:model-value="close"
  >
    <div class="cpk">
      <div class="cpk-head">
        <input
          v-model="keyword"
          class="cpk-search"
          data-testid="column-picker-search"
          placeholder="筛选列名 / 物理列（K1）"
        />
        <div class="cpk-meta">
          <span class="cpk-count">已显 {{ visibleCount }} / 共 {{ columns.length }}</span>
          <button class="cpk-link" type="button" data-testid="column-picker-all" @click="selectAll">全选</button>
          <button
            v-if="availablePreset.length"
            class="cpk-link"
            type="button"
            data-testid="column-picker-preset"
            @click="presetOnly"
          >{{ presetLabel }}（{{ availablePreset.length }}）</button>
          <button v-if="showIdentity" class="cpk-link" type="button" data-testid="column-picker-identity" @click="identityOnly">仅身份列</button>
          <button class="cpk-link" type="button" data-testid="column-picker-reset" @click="restoreDefault">恢复默认</button>
        </div>
      </div>
      <div
        class="cpk-list"
        data-testid="column-picker-list"
        tabindex="0"
        @keydown="onListKeydown"
      >
        <div v-if="!filtered.length" class="cpk-empty">没有匹配的列</div>
        <div
          v-for="col in filtered"
          :key="col.prop"
          class="cpk-row"
          :class="{ on: focusProp === col.prop, dragging: dragProp === col.prop, muted: draftHidden.has(col.prop) }"
          @click="focusProp = col.prop"
          @dragover.prevent
          @drop.prevent="onDrop(col.prop)"
        >
          <span
            class="cpk-grip"
            draggable="true"
            title="拖动调整顺序"
            @dragstart="onDragStart(col.prop, $event)"
            @dragend="dragProp = ''"
          >
            <svg viewBox="0 0 12 16" width="10" height="14" aria-hidden="true">
              <circle cx="4" cy="3" r="1.2" fill="currentColor" />
              <circle cx="8" cy="3" r="1.2" fill="currentColor" />
              <circle cx="4" cy="8" r="1.2" fill="currentColor" />
              <circle cx="8" cy="8" r="1.2" fill="currentColor" />
              <circle cx="4" cy="13" r="1.2" fill="currentColor" />
              <circle cx="8" cy="13" r="1.2" fill="currentColor" />
            </svg>
          </span>
          <input
            type="checkbox"
            :checked="!draftHidden.has(col.prop)"
            :aria-label="`显示 ${col.label}`"
            @change="toggle(col.prop)"
          />
          <span class="cpk-label">{{ col.label }}</span>
        </div>
      </div>
    </div>
    <template #footer>
      <button class="rc-btn" type="button" data-testid="column-picker-cancel" @click="close">取消</button>
      <button class="rc-btn primary" type="button" data-testid="column-picker-ok" @click="onConfirm">确定</button>
    </template>
  </el-dialog>
</template>

<style scoped>
.cpk { display: flex; flex-direction: column; min-height: 0; }
.cpk-head { flex: none; display: flex; flex-direction: column; gap: 8px; padding-bottom: 10px; }
.cpk-search { height: 32px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 6px; font-size: 12px; outline: none; }
.cpk-search:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.cpk-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cpk-count { font-size: 12px; color: var(--rc-faint); }
.cpk-link { border: 0; background: none; padding: 0; color: var(--rc-primary); font-size: 12px; cursor: pointer; }
.cpk-link:hover { text-decoration: underline; }
.cpk-list { flex: 1; min-height: 180px; max-height: min(360px, calc(100vh - 280px)); overflow: auto; border: 1px solid var(--rc-border-soft); border-radius: 8px; outline: none; }
.cpk-list:focus { border-color: #bfdbfe; }
.cpk-empty { padding: 24px; text-align: center; color: var(--rc-faint); font-size: 12px; }
.cpk-row { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-bottom: 1px solid var(--rc-border-soft); font-size: 12px; color: var(--rc-text-2); }
.cpk-row:last-child { border-bottom: 0; }
.cpk-row:hover, .cpk-row.on { background: var(--rc-primary-bg); }
.cpk-row.dragging { opacity: 0.45; }
.cpk-row.muted { color: var(--rc-faint); }
.cpk-grip { flex: none; display: inline-flex; color: var(--rc-faint); cursor: grab; padding: 2px; }
.cpk-grip:active { cursor: grabbing; }
.cpk-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-btn { height: 32px; padding: 0 12px; border: 1px solid var(--rc-border); border-radius: 7px; background: #fff; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
</style>

<style>
.col-picker-dialog.el-dialog { max-width: calc(100vw - 48px); margin: 8vh auto !important; }
.col-picker-dialog .el-dialog__body { padding-top: 8px; padding-bottom: 8px; overflow: hidden; }
.col-picker-dialog .el-dialog__footer { padding-top: 8px; }
</style>
