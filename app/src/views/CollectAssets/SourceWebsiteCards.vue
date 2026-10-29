<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Site } from '@/api'
import type { SourceFilter } from '@/views/FlowCanvas/result/useSourceLaunch'
import { favoriteSiteIds } from '@/utils/siteFavorites'
import SiteCardGrid from './SiteCardGrid.vue'
import { querySiteCards, type SiteCardResult } from './siteCardQuery'

const props = defineProps<{ query: SourceFilter; scopeEmpty: boolean; emptyText?: string; catalog?: Site[]; catalogLoading?: boolean; catalogError?: string; includeEmptySiteIds?: string[] }>()
const emit = defineEmits<{ editSite: [Site]; deleteSite: [Site]; showSources: []; retryCatalog: [] }>()
const result = ref<SiteCardResult>({ sites: [], unbound: 0 })
const loading = ref(false)
const error = ref('')
const progress = ref('')
const page = ref(1)
const size = ref(20)
let sequence = 0
const gridVersion = ref(0)
const orderedSites = computed(() => [...result.value.sites].sort((a, b) => {
  const fa = favoriteSiteIds.value.has(a.siteId) ? 0 : 1
  const fb = favoriteSiteIds.value.has(b.siteId) ? 0 : 1
  return fa - fb || (b.updatedAt || '').localeCompare(a.updatedAt || '')
}))
const sites = computed(() => orderedSites.value.slice((page.value - 1) * size.value, page.value * size.value))
const sourceTotal = computed(() => result.value.sites.reduce((sum, site) => sum + (result.value.sourceScope?.matches[site.siteId]?.total ?? site.sourceCount), 0))
async function load() {
  const current = ++sequence
  result.value = { sites: [], unbound: 0 }
  page.value = 1
  error.value = props.catalogError || ''
  progress.value = ''
  loading.value = !!props.catalogLoading
  if (props.scopeEmpty || props.catalogLoading || error.value) return
  loading.value = true
  try {
    const next = await querySiteCards(props.query, {
      isCurrent: () => current === sequence,
      catalog: props.catalog,
      includeEmptySiteIds: props.includeEmptySiteIds,
      onProgress: (done, total) => { if (current === sequence) progress.value = `正在读取命中源 ${done} / ${total}…` },
    })
    if (current !== sequence) return
    result.value = next
    gridVersion.value++
  } catch (cause) {
    if (current === sequence) error.value = `加载网站卡片失败：${cause instanceof Error ? cause.message : String(cause)}`
  } finally {
    if (current === sequence) loading.value = false
  }
}
watch([() => props.query, () => props.scopeEmpty, () => props.catalog, () => props.catalogLoading, () => props.catalogError], load, { immediate: true })
watch(() => orderedSites.value.length, total => { page.value = Math.min(page.value, Math.max(1, Math.ceil(total / size.value))) })
onBeforeUnmount(() => { sequence++ })
</script>

<template>
  <div class="swc-shell" data-testid="source-website-cards">
    <div class="swc-summary" aria-live="polite">
      <span v-if="loading">{{ progress || '正在加载网站…' }}</span>
      <span v-else-if="!error">{{ result.sites.length }} 个网站 · {{ result.sourceScope ? '命中' : '共' }} {{ sourceTotal }} 个源</span>
      <slot name="summary-extra" />
      <span v-if="result.sourceScope && !loading && !error" class="swc-count-hint">源数：命中 / 全站</span>
      <span v-if="result.unbound && !loading && !error" class="swc-notice" data-testid="website-unbound-sources">{{ result.unbound.toLocaleString() }} 个源未关联网站<button type="button" @click="emit('showSources')">查看源列表</button></span>
    </div>
    <div class="swc-content">
      <div v-if="error" class="swc-error" role="alert">{{ error }}<button class="rc-btn" type="button" @click="catalogError ? emit('retryCatalog') : load()">重新加载</button></div>
      <SiteCardGrid v-else :key="gridVersion" :sites="sites" :loading="loading" :source-scope="result.sourceScope" :empty-text="scopeEmpty ? emptyText : '没有匹配的网站，请调整筛选条件'" @open-editor="emit('editSite', $event)" @delete-site="emit('deleteSite', $event)" />
    </div>
    <div class="swc-pager">
      <span>共 {{ result.sites.length }} 个网站</span>
      <el-pagination v-model:current-page="page" v-model:page-size="size" :total="result.sites.length" :page-sizes="[10, 20, 50]" layout="sizes, prev, pager, next, jumper" background size="small" @size-change="page = 1" />
    </div>
  </div>
</template>

<style scoped>
.swc-shell { display: flex; flex: 1; flex-direction: column; min-height: 0; min-width: 0; }
.swc-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 4px 0; color: var(--rc-muted); font-size: 12px; line-height: 20px; }
.swc-count-hint { margin-left: auto; font-size: 11px; }
.swc-content { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 4px 12px; }
.swc-notice { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-left: auto; color: var(--rc-muted); font-size: 11px; }
.swc-notice button { padding: 0; border: 0; background: transparent; color: var(--rc-primary); font: inherit; cursor: pointer; }
.swc-error { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 20px; color: var(--rc-error); font-size: 12px; }
.swc-pager { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 12px; padding: 10px 0; border-top: 1px solid var(--rc-border-soft); color: var(--rc-muted); font-size: 12px; }
.swc-pager :deep(.el-pagination) { flex-wrap: wrap; row-gap: 6px; }
</style>
