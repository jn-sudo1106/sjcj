<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { Site } from '@/api'
import type { SourceFilter } from '@/views/FlowCanvas/result/useSourceLaunch'
import type { SiteScopeSort } from '@/api/sourceDirectoryScope'
import SiteCardGrid from './SiteCardGrid.vue'
import { querySiteCards, type SiteCardResult } from './siteCardQuery'

const props = withDefaults(defineProps<{ query: SourceFilter; scopeEmpty: boolean; emptyText?: string; includeEmptySiteIds?: string[]; active?: boolean; refreshVersion?: number }>(), { active: true })
const emit = defineEmits<{ editSite: [Site]; deleteSite: [Site]; showSources: [] }>()
const emptyResult = (): SiteCardResult => ({ sites: [], total: 0, matchedSourceTotal: 0, unbound: 0 })
const result = ref<SiteCardResult>(emptyResult())
const loading = ref(false)
const error = ref('')
const page = ref(1)
const size = ref(20)
const sort = ref<SiteScopeSort>('editedDesc')
let sequence = 0
let controller: AbortController | undefined
const gridVersion = ref(0)
async function load() {
  if (props.active === false) { controller?.abort(); sequence++; loading.value = false; return }
  const current = ++sequence
  controller?.abort()
  error.value = ''
  if (props.scopeEmpty) { result.value = emptyResult(); loading.value = false; return }
  controller = new AbortController()
  result.value = { ...emptyResult(), total: result.value.total }
  loading.value = true
  try {
    const next = await querySiteCards(props.query, { page: page.value, size: size.value, sort: sort.value,
      isCurrent: () => current === sequence, signal: controller.signal, includeEmptySiteIds: props.includeEmptySiteIds })
    if (current !== sequence) return
    result.value = next
    gridVersion.value++
  } catch (cause) {
    if (current === sequence) { error.value = `加载网站卡片失败：${cause instanceof Error ? cause.message : String(cause)}` }
  } finally {
    if (current === sequence) loading.value = false
  }
}
// One watcher batches a page-size/sort/filter reset into one data query.
watch([() => props.query, () => props.scopeEmpty, () => props.includeEmptySiteIds, sort, size], () => { page.value = 1 }, { flush: 'sync' })
watch([() => props.query, () => props.scopeEmpty, () => props.includeEmptySiteIds, page, size, sort, () => props.active, () => props.refreshVersion], load, { immediate: true })
onBeforeUnmount(() => { sequence++; controller?.abort() })
</script>

<template>
  <div class="swc-shell" data-testid="source-website-cards">
    <div class="swc-summary" aria-live="polite">
      <span v-if="loading">正在加载网站…</span>
      <span v-else-if="!error">{{ result.total }} 个网站 · 命中 {{ result.matchedSourceTotal }} 个源</span>
      <slot name="summary-extra" />
      <label class="swc-sort">排序 <select v-model="sort" aria-label="网站排序" data-testid="website-sort">
        <option value="editedDesc">最近编辑</option><option value="siteIdAsc">网站 ID 升序</option><option value="siteIdDesc">网站 ID 降序</option>
        <option value="sourceCountAsc">命中源数量升序</option><option value="sourceCountDesc">命中源数量降序</option>
      </select></label>
      <span v-if="result.sourceScope && !loading && !error" class="swc-count-hint">源数：命中 / 全站</span>
      <span v-if="result.unbound && !loading && !error" class="swc-notice" data-testid="website-unbound-sources">{{ result.unbound.toLocaleString() }} 个源未关联网站<button type="button" @click="emit('showSources')">查看源列表</button></span>
    </div>
    <div class="swc-content">
      <div v-if="error" class="swc-error" role="alert">{{ error }}<button class="rc-btn" type="button" @click="load()">重新加载</button></div>
      <SiteCardGrid v-else :key="gridVersion" :sites="result.sites" :loading="loading" :source-scope="result.sourceScope" :empty-text="scopeEmpty ? emptyText : '没有匹配的网站，请调整筛选条件'" @favorite-changed="load()" @open-editor="emit('editSite', $event)" @delete-site="emit('deleteSite', $event)" />
    </div>
    <div v-if="!error" class="swc-pager">
      <span>共 {{ result.total }} 个网站</span>
      <el-pagination v-model:current-page="page" v-model:page-size="size" :total="result.total" :page-sizes="[10, 20, 50]" layout="sizes, prev, pager, next, jumper" background size="small" />
    </div>
  </div>
</template>

<style scoped>
.swc-shell { display: flex; flex: 1; flex-direction: column; min-height: 0; min-width: 0; }
.swc-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 4px 0; color: var(--rc-muted); font-size: 12px; line-height: 20px; }
.swc-sort { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; }
.swc-sort select { padding: 3px 5px; border: 1px solid var(--rc-border); border-radius: 5px; background: #fff; color: var(--rc-text-2); font: inherit; }
.swc-count-hint { margin-left: auto; font-size: 11px; }
.swc-content { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 4px 12px; }
.swc-notice { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-left: auto; color: var(--rc-muted); font-size: 11px; }
.swc-notice button { padding: 0; border: 0; background: transparent; color: var(--rc-primary); font: inherit; cursor: pointer; }
.swc-error { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 20px; color: var(--rc-error); font-size: 12px; }
.swc-pager { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 12px; padding: 10px 0; border-top: 1px solid var(--rc-border-soft); color: var(--rc-muted); font-size: 12px; }
.swc-pager :deep(.el-pagination) { flex-wrap: wrap; row-gap: 6px; }
</style>
