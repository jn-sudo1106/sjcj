<script setup lang="ts">
// 跨网站的全局源筛选（对齐旧平台 FileList2.vue 的"源ID"选择器，`DSourceSelect` 组件）。
// 用于"全部网站"模式下的文件中心——这时没有 siteId 可依赖，不能像 SiteSourceSelect
// 那样把某个网站下的全部源整体拉下来（生产 12343 个源、测试环境 8 万+），只能按关键词
// 服务端搜索，与"导入源"复用同一条 sourceApi.sourcePaged({ keyword }) 契约
// （SiteSourceSwitcher.vue 的"全局搜索（含跨站）"同款用法）。
//
// 不复刻旧版 DSourceSelect 的"更多源...弹窗浏览全部源列表"和"源详情抽屉"两个附加功能——
// 这里定位是"查文件时收窄范围"，不是"源管理"，旧版那两个功能服务于后者，本组件只做搜索选源。
import { computed, ref, watch } from 'vue'
import { sourceApi, type Source } from '@/api'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [sourceId: string] }>()

const DEBOUNCE_MS = 300
const RESULT_SIZE = 30

const keyword = ref('')
const results = ref<Source[]>([])
const loading = ref(false)
const error = ref('')
const open = ref(false)
// 已选中源的展示名单独缓存：它可能来自搜索结果点选，也可能来自外部传入的初始 sourceId
// （如从 URL 恢复），后者永远不在 results 里，展示不能依赖 results 是否命中。
const selectedSource = ref<Source | null>(null)
const selected = computed(() => (props.modelValue && selectedSource.value?.sourceId === props.modelValue ? selectedSource.value : null))

let searchId = 0
async function search(q: string) {
  const id = ++searchId
  loading.value = true
  error.value = ''
  try {
    const result = await sourceApi.sourcePaged({ keyword: q, size: RESULT_SIZE })
    if (id !== searchId) return
    results.value = result.list
  } catch (err) {
    if (id !== searchId) return
    results.value = []
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (id === searchId) loading.value = false
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | undefined
watch(keyword, (q) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  const trimmed = q.trim()
  if (!trimmed) {
    results.value = []
    error.value = ''
    loading.value = false
    return
  }
  debounceTimer = setTimeout(() => void search(trimmed), DEBOUNCE_MS)
})

// 外部传入/回填的 sourceId（如 URL 里的 initialSourceId）不一定在最近一次搜索结果里，
// 单独查一次拿名字用于展示；查不到也不阻断——退化为只显示 ID。
let resolveId = 0
watch(() => props.modelValue, async (id) => {
  if (!id) { selectedSource.value = null; return }
  if (selectedSource.value?.sourceId === id) return
  const requestId = ++resolveId
  try {
    const result = await sourceApi.sourcePaged({ sourceIds: [id], size: 1 })
    if (requestId !== resolveId) return
    selectedSource.value = result.list[0] ?? null
  } catch {
    if (requestId !== resolveId) return
    selectedSource.value = null
  }
}, { immediate: true })

function pick(source: Source) {
  selectedSource.value = source
  emit('update:modelValue', source.sourceId)
  keyword.value = ''
  open.value = false
}
function clear() {
  selectedSource.value = null
  emit('update:modelValue', '')
  keyword.value = ''
  open.value = false
}
function retry() {
  const trimmed = keyword.value.trim()
  if (trimmed) void search(trimmed)
}
function onFocus() {
  open.value = true
}
// 同 SiteSourceSelect：选过一次后输入框焦点未变，再点一次不会重新触发 focus，
// 靠 mousedown 兜底保证总能重新展开。
function onMousedown() {
  open.value = true
}
function onBlur() {
  window.setTimeout(() => { open.value = false }, 150)
}
</script>

<template>
  <div class="gss-wrap">
    <div class="gss-field">
      <input
        v-model="keyword"
        class="gss-input"
        data-testid="global-source-select-input"
        :placeholder="selected ? `[${selected.sourceId}] ${selected.name}` : (modelValue ? `[${modelValue}]` : '全部源（按源 ID 或名称搜索）')"
        @focus="onFocus"
        @mousedown="onMousedown"
        @blur="onBlur"
      />
    </div>
    <div v-if="open" class="gss-options" data-testid="global-source-select-options">
      <button
        v-if="modelValue"
        type="button"
        class="gss-option gss-option-all"
        data-testid="global-source-select-clear"
        @mousedown.prevent="clear"
      >全部源</button>
      <div v-if="!keyword.trim()" class="gss-empty">输入源 ID 或名称搜索</div>
      <div v-else-if="loading" class="gss-empty">搜索中…</div>
      <div v-else-if="error" class="gss-empty gss-error">
        {{ error }}
        <button class="gss-retry" type="button" data-testid="global-source-select-retry" @mousedown.prevent="retry">重试</button>
      </div>
      <template v-else>
        <div v-if="!results.length" class="gss-empty">没有匹配的源</div>
        <button
          v-for="s in results"
          :key="s.sourceId"
          type="button"
          class="gss-option"
          data-testid="global-source-select-option"
          :class="{ active: s.sourceId === modelValue }"
          @mousedown.prevent="pick(s)"
        >
          <span class="gss-option-name">{{ s.name }}</span>
          <span class="gss-option-id">{{ s.sourceId }}</span>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.gss-wrap { position: relative; min-width: 220px; }
.gss-field { display: flex; align-items: center; gap: 6px; }
.gss-input { flex: 1; height: 28px; padding: 0 9px; border: 1px solid var(--rc-border); border-radius: 6px; font-size: 12px; outline: none; background: #fff; }
.gss-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.gss-options { position: absolute; z-index: 5; top: 32px; left: 0; right: 0; max-height: 260px; overflow-y: auto; border: 1px solid var(--rc-border); border-radius: 7px; background: #fff; box-shadow: 0 12px 28px -12px rgba(15, 23, 42, 0.3); }
.gss-empty { padding: 10px; color: var(--rc-faint); font-size: 12px; text-align: center; }
.gss-error { color: var(--rc-error); display: flex; align-items: center; justify-content: center; gap: 8px; }
.gss-retry { flex: none; height: 22px; padding: 0 9px; border: 1px solid var(--rc-border); border-radius: 5px; background: #fff; color: var(--rc-text-2); font-size: 11px; cursor: pointer; }
.gss-option { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: 0; border-bottom: 1px solid var(--rc-border-soft); background: #fff; color: var(--rc-text-2); font-size: 12px; text-align: left; cursor: pointer; }
.gss-option:last-child { border-bottom: 0; }
.gss-option:hover, .gss-option.active { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.gss-option-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.gss-option-id { flex: none; font-family: monospace; font-size: 10px; color: var(--rc-faint); }
</style>
