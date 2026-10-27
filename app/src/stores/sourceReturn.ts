import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { LocationQuery, LocationQueryRaw } from 'vue-router'
import { currentBackendHost } from '@/api/client'
import { normalizeSourceView } from '@/utils/url/workspaceRoute'
import { useAuthStore } from './auth'

interface SourceReturnPoint {
  sourceId: string
  name: string
  query: Record<string, string>
}

const QUERY_KEYS = ['siteId', 'sourceGroupId', 'flowId', 'workflowId', 'versionId', 'flowMode', 'nodeId', 'tab', 'tableId'] as const
const STORAGE_PREFIX = 'rc-source-return:'

function normalize(point: SourceReturnPoint): SourceReturnPoint {
  const query: Record<string, string> = { sourceId: point.sourceId, view: normalizeSourceView(point.query.view) }
  for (const key of QUERY_KEYS) {
    if (typeof point.query[key] === 'string' && point.query[key]) query[key] = point.query[key]
  }
  if (typeof point.query.returnTo === 'string' && /^\/collect(?:\?|$)/.test(point.query.returnTo)) {
    query.returnTo = point.query.returnTo
  }
  return { sourceId: point.sourceId, name: point.name || point.sourceId, query }
}

export const useSourceReturnStore = defineStore('sourceReturn', () => {
  const auth = useAuthStore()
  const scope = computed(() => auth.isLoggedIn && auth.info ? `${currentBackendHost()}:${auth.info.id}` : '')
  const point = ref<SourceReturnPoint | null>(null)

  watch(scope, (key, previous) => {
    point.value = null
    try {
      if (!key && previous) sessionStorage.removeItem(STORAGE_PREFIX + previous)
      if (!key) return
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_PREFIX + key) || 'null') as SourceReturnPoint | null
      if (saved && typeof saved.sourceId === 'string' && saved.sourceId && typeof saved.name === 'string' && saved.query && typeof saved.query === 'object') {
        point.value = normalize(saved)
      }
    } catch { /* 返回入口不依赖浏览器存储可用 */ }
  }, { immediate: true, flush: 'sync' })

  function remember(sourceId: string, name: string, query: LocationQuery | LocationQueryRaw) {
    if (!scope.value || !sourceId) return
    const strings = Object.fromEntries(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    point.value = normalize({ sourceId, name, query: strings })
    try { sessionStorage.setItem(STORAGE_PREFIX + scope.value, JSON.stringify(point.value)) } catch { /* 保留本次内存记录 */ }
  }

  function clear(sourceId?: string) {
    if (sourceId && point.value?.sourceId !== sourceId) return
    point.value = null
    try { if (scope.value) sessionStorage.removeItem(STORAGE_PREFIX + scope.value) } catch { /* 同上 */ }
  }

  return { point, remember, clear }
})
