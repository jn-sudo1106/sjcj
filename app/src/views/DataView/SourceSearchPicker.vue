<script setup lang="ts">
// 数据中心「数据查询」的源搜索（对照网站数据视图左栏「源列表」：搜索源 / 来源组）。
// 与原来的「选择源（ID或名称）」下拉相比：可以直接按源名/源 ID 搜全库的源，选中即切到该源看它的查询结果；
// 来源组用来收窄搜索范围（组的成员多、名字长的场景下比纯关键词好找）。
// 空关键词且未选来源组时，仍列出当前数据表里有数据的源，保留原来「看这张表里有哪些源」的能力。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Search, Close } from '@element-plus/icons-vue'
import { sourceApi, sourceGroupApi, type Source, type SourceGroup, type SourceOption } from '../../api'

/** 搜索结果行：跨表命中时带 mainTable，父级据此切到该源的默认数据表 */
interface PickedSource extends SourceOption {
  mainTable?: string
  siteName?: string
  sourceGroupId?: string
}

const props = withDefaults(defineProps<{
  /** 已选源 ID（v-model） */
  modelValue?: string
  /** 已选源名称（父级已有缓存时传入，省一次反查） */
  modelLabel?: string
  /** 当前数据表里有数据的源（空关键词时的候选，来自 distinctSource 预览） */
  preview?: SourceOption[]
  previewLoading?: boolean
  /** 当前数据表：命中的源主表不一样时在行里标出来（仍可直接选中，用于给当前表录首条数据） */
  currentTable?: string
  placeholder?: string
}>(), {
  modelValue: '',
  modelLabel: '',
  preview: () => [],
  previewLoading: false,
  currentTable: '',
  placeholder: '搜索源 / 来源组',
})

const emit = defineEmits<{
  'update:modelValue': [sourceId: string]
  /** 选中某个源（null = 清除） */
  picked: [source: PickedSource | null]
}>()

const DEBOUNCE_MS = 300
const RESULT_SIZE = 30

const rootRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
const open = ref(false)
const keyword = ref('')
const groupId = ref('')
const groups = ref<SourceGroup[]>([])
const groupsFailed = ref(false)
const results = ref<PickedSource[]>([])
const resultTotal = ref(0)
const loading = ref(false)
const failed = ref(false)
const activeIndex = ref(-1)
let searchTimer: ReturnType<typeof setTimeout> | undefined
let requestId = 0

const trimmedKeyword = computed(() => keyword.value.trim())
const selectedLabel = computed(() => {
  if (!props.modelValue) return ''
  return props.modelLabel ? `${props.modelValue} ${props.modelLabel}` : props.modelValue
})

/** 空关键词且未选组时回落当前表的源预览；否则用搜索结果 */
const options = computed<PickedSource[]>(() => {
  if (trimmedKeyword.value || groupId.value) return results.value
  return props.preview.map((option) => ({ sourceId: option.sourceId, name: option.name }))
})
const listLoading = computed(() => (trimmedKeyword.value || groupId.value ? loading.value : props.previewLoading))
const groupNames = computed(() => new Map(groups.value.map((group) => [group.sourceGroupId, group.sourceGroupName])))
const groupName = (id?: string) => (id ? groupNames.value.get(id) || `组 #${id}` : '未分组')
const emptyText = computed(() => {
  if (failed.value) return '搜索失败，请重试'
  if (trimmedKeyword.value) return '没有匹配的源'
  if (groupId.value) return '该来源组下没有可用源'
  return '当前数据表还没有可选的源'
})
/** 输入框展示：展开时是关键词，收起时是已选源 */
const inputValue = computed(() => (open.value ? keyword.value : selectedLabel.value))

function toPicked(source: Source): PickedSource {
  return {
    sourceId: source.sourceId,
    name: source.name,
    mainTable: source.mainTable,
    siteName: source.siteName,
    sourceGroupId: source.sourceGroupId,
  }
}

async function loadGroups() {
  groupsFailed.value = false
  try {
    groups.value = await sourceGroupApi.list()
  } catch {
    groups.value = []
    groupsFailed.value = true
  }
}

async function load() {
  const query = trimmedKeyword.value
  const group = groupId.value
  if (!query && !group) {
    results.value = []
    resultTotal.value = 0
    loading.value = false
    failed.value = false
    return
  }
  const current = ++requestId
  loading.value = true
  failed.value = false
  activeIndex.value = -1
  try {
    const merged = new Map<string, PickedSource>()
    if (query && /^\d+$/.test(query)) {
      // 纯数字优先按源 ID 精确命中，再补名称匹配（源名里也可能出现数字）
      const byId = await sourceApi.sourcePaged({ sourceIds: [query], page: 1, size: RESULT_SIZE })
      if (current !== requestId) return
      byId.list.forEach((source) => merged.set(source.sourceId, toPicked(source)))
    }
    const byName = await sourceApi.sourcePaged({
      name: query || undefined,
      sourceGroupId: group || undefined,
      page: 1,
      size: RESULT_SIZE,
    })
    if (current !== requestId) return
    byName.list.forEach((source) => {
      if (!merged.has(source.sourceId)) merged.set(source.sourceId, toPicked(source))
    })
    results.value = [...merged.values()]
    resultTotal.value = Math.max(byName.total || 0, results.value.length)
  } catch {
    if (current !== requestId) return
    results.value = []
    resultTotal.value = 0
    failed.value = true
  } finally {
    if (current === requestId) loading.value = false
  }
}

function scheduleLoad() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void load(), DEBOUNCE_MS)
}

function openPanel() {
  open.value = true
  keyword.value = ''
  activeIndex.value = -1
  if (groupId.value) void load()
}

function closePanel() {
  open.value = false
  keyword.value = ''
  activeIndex.value = -1
}

function onInput(event: Event) {
  keyword.value = (event.target as HTMLInputElement).value
  activeIndex.value = -1
  scheduleLoad()
}

function onGroupChange() {
  activeIndex.value = -1
  void load()
}

function pick(option: PickedSource) {
  if (!option.sourceId) return
  emit('update:modelValue', option.sourceId)
  emit('picked', option)
  closePanel()
  inputRef.value?.blur()
}

function clearSource() {
  emit('update:modelValue', '')
  emit('picked', null)
  closePanel()
}

function moveActive(step: number) {
  if (!open.value) {
    openPanel()
    return
  }
  const size = options.value.length
  if (!size) return
  activeIndex.value = (activeIndex.value + step + size) % size
}

function pickActive() {
  if (!open.value) return
  const option = options.value[activeIndex.value] || options.value[0]
  if (option) pick(option)
}

function onDocumentMouseDown(event: MouseEvent) {
  if (!open.value) return
  const root = rootRef.value
  if (root && !root.contains(event.target as Node)) closePanel()
}

watch(() => props.modelValue, () => {
  if (open.value) closePanel()
})

onMounted(() => {
  void loadGroups()
  document.addEventListener('mousedown', onDocumentMouseDown)
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
  document.removeEventListener('mousedown', onDocumentMouseDown)
})
</script>

<template>
  <div ref="rootRef" class="ssp" :class="{ 'is-open': open }" data-testid="data-source-search">
    <div class="ssp-control">
      <div class="ssp-field">
        <el-icon class="ssp-icon"><Search /></el-icon>
        <input
          ref="inputRef"
          class="ssp-input"
          type="text"
          autocomplete="off"
          :value="inputValue"
          :placeholder="placeholder"
          data-testid="data-source-search-input"
          @focus="openPanel"
          @input="onInput"
          @keydown.down.prevent="moveActive(1)"
          @keydown.up.prevent="moveActive(-1)"
          @keydown.enter.prevent="pickActive"
          @keydown.esc="closePanel"
        />
        <button
          v-if="modelValue"
          class="ssp-clear"
          type="button"
          title="清除已选源"
          data-testid="data-source-search-clear"
          @click="clearSource"
        >
          <el-icon><Close /></el-icon>
        </button>
      </div>
      <select
        v-model="groupId"
        class="ssp-group"
        title="按来源组收窄搜索范围"
        data-testid="data-source-search-group"
        @change="onGroupChange"
      >
        <option value="">全部来源组</option>
        <option v-for="group in groups" :key="group.sourceGroupId" :value="group.sourceGroupId">
          {{ group.sourceGroupName }}
        </option>
      </select>
    </div>

    <div v-if="open" class="ssp-panel" data-testid="data-source-search-panel">
      <p v-if="groupsFailed" class="ssp-tip">
        来源组加载失败
        <button class="ssp-retry" type="button" @click="loadGroups">重试</button>
      </p>
      <p v-if="listLoading" class="ssp-tip">搜索中…</p>
      <p v-else-if="!options.length" class="ssp-tip">{{ emptyText }}</p>
      <template v-else>
        <button
          v-for="(option, index) in options"
          :key="option.sourceId"
          class="ssp-option"
          :class="{ active: index === activeIndex, selected: option.sourceId === modelValue }"
          type="button"
          data-testid="data-source-search-option"
          @mousedown.prevent="pick(option)"
          @mouseenter="activeIndex = index"
        >
          <span class="ssp-name">{{ option.name }}</span>
          <span class="ssp-meta">
            <span class="ssp-id">{{ option.sourceId }}</span>
            <span v-if="option.siteName" class="ssp-tag">{{ option.siteName }}</span>
            <span v-if="option.sourceGroupId !== undefined" class="ssp-tag group" :class="{ ungrouped: !option.sourceGroupId }">
              {{ groupName(option.sourceGroupId) }}
            </span>
            <span v-if="option.mainTable && currentTable && option.mainTable !== currentTable" class="ssp-tag warn">
              主表 {{ option.mainTable }}
            </span>
          </span>
        </button>
        <p v-if="resultTotal > options.length" class="ssp-tip foot">
          共 {{ resultTotal }} 个源，仅显示前 {{ options.length }} 个，可加来源组或更精确的关键词
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ssp { position: relative; display: inline-flex; }
.ssp-control { display: flex; align-items: center; gap: 6px; }
.ssp-field {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 200px;
  height: 28px;
  padding: 0 6px 0 8px;
  border: 1px solid var(--rc-border);
  border-radius: 7px;
  background: #fff;
}
.ssp.is-open .ssp-field { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.ssp-icon { flex: none; color: var(--rc-muted); font-size: 13px; }
.ssp-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--rc-text);
  font: inherit;
  font-size: 12px;
  outline: none;
}
.ssp-input::placeholder { color: var(--rc-muted); }
.ssp-clear {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--rc-muted);
  cursor: pointer;
}
.ssp-clear:hover { background: var(--rc-border-soft); color: var(--rc-text); }
.ssp-clear :deep(svg) { width: 12px; height: 12px; }
.ssp-group {
  max-width: 140px;
  height: 28px;
  border: 1px solid var(--rc-border);
  border-radius: 7px;
  padding: 0 6px;
  background: #fff;
  color: var(--rc-text-2);
  font: inherit;
  font-size: 12px;
}
.ssp-panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 30;
  width: 340px;
  max-height: 320px;
  overflow-y: auto;
  padding: 5px;
  border: 1px solid var(--rc-border);
  border-radius: 9px;
  background: #fff;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.14);
  scrollbar-width: thin;
}
.ssp-option {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.ssp-option.active { background: var(--rc-primary-bg); }
.ssp-option.selected .ssp-name { color: var(--rc-primary-ink); }
.ssp-name { font-size: 12px; font-weight: 600; color: var(--rc-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ssp-meta { display: flex; align-items: center; gap: 5px; min-width: 0; }
.ssp-id { flex: none; font-family: var(--rc-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11px; color: var(--rc-muted); }
.ssp-tag {
  min-width: 0;
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--rc-border-soft);
  color: var(--rc-muted);
  font-size: 11px;
}
.ssp-tag.group { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.ssp-tag.group.ungrouped { background: var(--rc-border-soft); color: var(--rc-muted); }
.ssp-tag.warn { background: #fff7ed; color: #b45309; }
.ssp-tip { margin: 0; padding: 6px 8px; font-size: 12px; color: var(--rc-muted); }
.ssp-tip.foot { border-top: 1px solid var(--rc-border-soft); margin-top: 4px; font-size: 11px; }
.ssp-retry { margin-left: 4px; border: 0; padding: 0; background: transparent; color: var(--rc-primary); font-size: 12px; cursor: pointer; }
</style>