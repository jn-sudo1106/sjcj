<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { sourceApi } from '@/api'
import type { Source } from '@/api/types/source'

/**
 * 可搜索的远程源下拉。
 *
 * 为什么不做「一次拉全量源」：全平台 6000+ 源，listSourceOptions 会翻 20 页并触发
 * MonitorQueryLimitError；这里按输入关键字（400ms 防抖）调 sourcePaged 只取前 50 条。
 */
const props = withDefaults(defineProps<{
  modelValue: string
  selectedName?: string
  placeholder?: string
  disabled?: boolean
}>(), {
  selectedName: '',
  placeholder: '输入源名称或 ID 搜索',
  disabled: false,
})

const emit = defineEmits<{ 'update:modelValue': [sourceId: string, name: string] }>()

const keyword = ref('')
const options = ref<Source[]>([])
const loading = ref(false)
const error = ref('')
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let requestSeq = 0

watch(() => props.modelValue, (sourceId) => {
  if (!sourceId) {
    keyword.value = ''
    return
  }
  if (!keyword.value) keyword.value = props.selectedName || sourceId
}, { immediate: true })

watch(() => props.selectedName, (name) => {
  if (name && props.modelValue) keyword.value = name
})

function onInput(event: Event): void {
  keyword.value = (event.target as HTMLInputElement).value
  scheduleSearch()
}

function scheduleSearch(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  requestSeq += 1
  loading.value = false
  options.value = []
  const kw = keyword.value.trim()
  if (!kw) {
    options.value = []
    error.value = ''
    return
  }
  debounceTimer = setTimeout(() => { void search(kw) }, 400)
}

async function search(keywordText: string): Promise<void> {
  const seq = ++requestSeq
  loading.value = true
  error.value = ''
  try {
    // 纯数字按源 ID 精确查（后端 sourceId 条件），否则按名称模糊查。
    // 不能两个都传：后端把它们当 AND，会得到 0 条。
    const byId = /^\d{4,}$/.test(keywordText)
    const result = await sourceApi.sourcePaged(byId
      ? { sourceId: keywordText, page: 1, size: 50 }
      : { name: keywordText, page: 1, size: 50 })
    if (seq !== requestSeq) return
    options.value = (result?.list ?? []).filter(Boolean)
  } catch (e) {
    if (seq !== requestSeq) return
    options.value = []
    error.value = `搜索源失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

function pick(source: Source): void {
  requestSeq += 1
  if (debounceTimer) clearTimeout(debounceTimer)
  loading.value = false
  keyword.value = source.name
  options.value = []
  error.value = ''
  emit('update:modelValue', String(source.sourceId), source.name)
}

function clear(): void {
  requestSeq += 1
  if (debounceTimer) clearTimeout(debounceTimer)
  loading.value = false
  keyword.value = ''
  options.value = []
  error.value = ''
  emit('update:modelValue', '', '')
}

onBeforeUnmount(() => {
  requestSeq += 1
  if (debounceTimer) clearTimeout(debounceTimer)
})
</script>

<template>
  <div class="mc-source-picker">
    <div class="mc-source-input-wrap">
      <input
        class="mc-input"
        aria-label="被监控源"
        type="text"
        :value="keyword"
        :placeholder="placeholder"
        :disabled="disabled"
        data-testid="mc-source-input"
        @input="onInput"
      >
      <button v-if="modelValue" type="button" class="mc-mini" data-testid="mc-source-clear" @click="clear">清除</button>
    </div>
    <div v-if="modelValue" class="mc-hint" data-testid="mc-source-selected">
      已选：{{ selectedName || modelValue }}（{{ modelValue }}）
    </div>
    <div v-if="loading" class="mc-hint" data-testid="mc-source-loading">搜索中…</div>
    <div v-else-if="error" class="mc-error">{{ error }}</div>
    <ul v-else-if="options.length" class="mc-source-options" data-testid="mc-source-options">
      <li v-for="item in options" :key="item.sourceId">
        <button
          type="button"
          class="mc-source-option"
          :data-testid="`mc-source-option-${item.sourceId}`"
          @click="pick(item)"
        >
          <span class="mc-source-name">{{ item.name }}</span>
          <span class="mc-faint">{{ item.sourceId }}</span>
        </button>
      </li>
    </ul>
    <div v-if="options.length >= 50" class="mc-hint" data-testid="mc-source-more">
      仅显示前 50 条，继续输入缩小范围
    </div>
  </div>
</template>

<style scoped>
.mc-source-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.mc-source-input-wrap {
  display: flex;
  gap: 6px;
  min-width: 0;
}

.mc-source-input-wrap .mc-input {
  flex: 1;
  width: 100%;
  min-width: 0;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--rc-border);
  border-radius: 6px;
  color: var(--rc-text);
  background: var(--rc-surface);
  font: inherit;
  outline: none;
}
.mc-input:focus { border-color: var(--rc-primary); box-shadow: 0 0 0 2px var(--rc-primary-bg); }
.mc-mini { padding: 0 8px; border: 1px solid var(--rc-border); border-radius: 6px; background: var(--rc-surface); color: var(--rc-muted); font: inherit; cursor: pointer; }
.mc-hint, .mc-error { margin: 0; font-size: 11px; line-height: 1.6; color: var(--rc-muted); }
.mc-error { color: var(--rc-error); }

.mc-source-options {
  list-style: none;
  margin: 0;
  padding: 4px;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius-sm, 6px);
  background: #fff;
}

.mc-source-option {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--rc-radius-sm, 6px);
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  color: var(--rc-text, #0f172a);
}

.mc-source-option:hover {
  background: var(--rc-primary-bg, #eff6ff);
}

.mc-source-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>