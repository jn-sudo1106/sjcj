<script setup lang="ts">
// 网站源范围选择器（0812 计划 M2-3）：数据、文件等需要在"全部源/具体源"之间切换的
// 视图共用同一个选择器（方案 §5.1）。候选项只取当前 siteId 下的源，绝不能出现别的
// 网站的源；请求失败展示重试，不能悄悄退回"全部源"或跨网站数据兜底。
import { computed, onMounted, ref, watch } from 'vue'
import { siteApi, type Source } from '@/api'

const props = defineProps<{ siteId: string; modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [sourceId: string] }>()

const sources = ref<Source[]>([])
const loading = ref(false)
const error = ref('')
const keyword = ref('')
const open = ref(false)

const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return sources.value
  return sources.value.filter((s) => s.sourceId.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
})
const selected = computed(() => sources.value.find((s) => s.sourceId === props.modelValue) ?? null)

let requestId = 0
async function load() {
  const id = ++requestId
  loading.value = true
  error.value = ''
  sources.value = []
  try {
    const result = await siteApi.siteSources(props.siteId)
    if (id !== requestId) return
    sources.value = result
  } catch (err) {
    if (id !== requestId) return
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (id === requestId) loading.value = false
  }
}
onMounted(() => load())
watch(() => props.siteId, () => {
  emit('update:modelValue', '')
  void load()
})

// "全部源"只在下拉里出现一次（不额外放一个常驻按钮）：切换源和回到全部源是同一件事——
// 选一个候选项，不需要两套不同的控件来做。
function pick(sourceId: string) {
  emit('update:modelValue', sourceId)
  keyword.value = ''
  open.value = false
}
function retry() {
  void load()
}
function onFocus() {
  open.value = true
}
// 选过一次源之后，mousedown.prevent 保住的是输入框的焦点，所以再点一次输入框不会触发
// focus 事件（本来就是焦点元素），下拉就再也弹不出来了——跟 SiteTableSelect 同一个 bug，
// mousedown 不依赖"是否已经是焦点元素"，每次点击都会触发，用它兜底才能保证再点一次总能
// 重新展开。
function onMousedown() {
  open.value = true
}
function onBlur() {
  // 留一点时间给点击选项的 mousedown 先触发，不然 blur 先关掉下拉，点击就落空了。
  window.setTimeout(() => { open.value = false }, 150)
}
</script>

<template>
  <div class="sss-wrap">
    <div class="sss-field">
      <input
        v-model="keyword"
        class="sss-input"
        data-testid="site-source-select-input"
        :placeholder="selected ? `[${selected.sourceId}] ${selected.name}` : '全部源（按源 ID 或源名称搜索切到具体源）'"
        @focus="onFocus"
        @mousedown="onMousedown"
        @blur="onBlur"
      />
    </div>
    <div v-if="open" class="sss-options" data-testid="site-source-select-options">
      <div v-if="loading && !sources.length" class="sss-empty">加载中…</div>
      <div v-else-if="error" class="sss-empty sss-error">
        {{ error }}
        <button class="sss-retry" type="button" data-testid="site-source-select-retry" @mousedown.prevent="retry">重试</button>
      </div>
      <template v-else>
        <button
          v-if="!keyword"
          type="button"
          class="sss-option"
          data-testid="site-source-select-option-all"
          :class="{ active: !modelValue }"
          @mousedown.prevent="pick('')"
        >全部源</button>
        <div v-if="!filtered.length" class="sss-empty">{{ keyword ? '没有匹配的源' : '该网站暂无源' }}</div>
        <button
          v-for="s in filtered"
          :key="s.sourceId"
          type="button"
          class="sss-option"
          data-testid="site-source-select-option"
          :class="{ active: s.sourceId === modelValue }"
          @mousedown.prevent="pick(s.sourceId)"
        >
          <span class="sss-option-name">{{ s.name }}</span>
          <span class="sss-option-id">{{ s.sourceId }}</span>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.sss-wrap { position: relative; min-width: 220px; }
.sss-field { display: flex; align-items: center; gap: 6px; }
.sss-input { flex: 1; height: 28px; padding: 0 9px; border: 1px solid var(--rc-border); border-radius: 6px; font-size: 12px; outline: none; background: #fff; }
.sss-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.sss-options { position: absolute; z-index: 5; top: 32px; left: 0; right: 0; max-height: 260px; overflow-y: auto; border: 1px solid var(--rc-border); border-radius: 7px; background: #fff; box-shadow: 0 12px 28px -12px rgba(15, 23, 42, 0.3); }
.sss-empty { padding: 10px; color: var(--rc-faint); font-size: 12px; text-align: center; }
.sss-error { color: var(--rc-error); display: flex; align-items: center; justify-content: center; gap: 8px; }
.sss-retry { flex: none; height: 22px; padding: 0 9px; border: 1px solid var(--rc-border); border-radius: 5px; background: #fff; color: var(--rc-text-2); font-size: 11px; cursor: pointer; }
.sss-option { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: 0; border-bottom: 1px solid var(--rc-border-soft); background: #fff; color: var(--rc-text-2); font-size: 12px; text-align: left; cursor: pointer; }
.sss-option:last-child { border-bottom: 0; }
.sss-option:hover, .sss-option.active { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.sss-option-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.sss-option-id { flex: none; font-family: monospace; font-size: 10px; color: var(--rc-faint); }
</style>
