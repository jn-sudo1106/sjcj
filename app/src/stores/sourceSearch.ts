import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { currentBackendHost } from '@/api/client'
import { useAuthStore } from './auth'
import type { SourceFilter } from '@/views/FlowCanvas/result/useSourceLaunch'
import type { SourceListViewState } from '@/views/FlowCanvas/result/sourceListViewState'
import type { DirScope } from '@/views/CollectAssets/SourceDirPanel.vue'
import type { Router, RouteLocationNormalizedLoaded } from 'vue-router'

interface SourceSearchListState {
  directoryScope?: DirScope
  directoryCollapsed?: boolean
  viewDirectoryId?: string
  dataQueryHitIds?: string[]
}

export interface SourceSearchOrigin {
  query: SourceFilter
  empty: boolean
  viewState: SourceListViewState
  page: number
  scrollTop: number
  scrollLeft: number
  total: number
  label: string
  returnTo: string
  listState?: SourceSearchListState
}
export interface SourceSearchContext extends SourceSearchOrigin {
  id: string
  mode: 'search' | 'site'
}
export interface SourceSearchNavigation {
  returnTo: string
  label: string
  restoreId?: string
  listState?: SourceSearchListState
}

export function sourceSearchListPath(path: string, contextId?: string): string {
  const url = new URL(path.startsWith('/') && !path.startsWith('//') ? path : '/collect', 'http://workspace.local')
  url.searchParams.delete('sourceSearchReturn')
  if (contextId) url.searchParams.set('sourceSearchReturn', contextId)
  return `${url.pathname}${url.search}${url.hash}`
}

// 只持久化查询和浏览位置，不保存列表行；刷新后按原条件重新分页查询。
export const useSourceSearchStore = defineStore('sourceSearch', () => {
  const auth = useAuthStore()
  const key = computed(() => `rc-source-search:${currentBackendHost()}:${auth.info?.id ?? 'anonymous'}`)
  const contexts = ref<Record<string, SourceSearchContext>>({})
  watch(key, () => {
    try {
      const value = JSON.parse(sessionStorage.getItem(key.value) || '{}')
      contexts.value = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    }
    catch { contexts.value = {} }
  }, { immediate: true, flush: 'sync' })
  watch(contexts, value => {
    try { sessionStorage.setItem(key.value, JSON.stringify(value)) }
    catch { /* 存储空间不足时，本次会话内仍可正常返回和切源。 */ }
  }, { deep: true, flush: 'sync' })

  function create(origin: SourceSearchOrigin): string {
    const id = `search-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    contexts.value[id] = {
      ...JSON.parse(JSON.stringify(origin)), id,
      returnTo: sourceSearchListPath(origin.returnTo),
      mode: 'search',
    }
    return id
  }
  function get(id: unknown): SourceSearchContext | undefined {
    if (typeof id !== 'string') return undefined
    const value = contexts.value[id]
    return value?.id === id && value.query && value.viewState && typeof value.returnTo === 'string' ? value : undefined
  }
  return { contexts, create, get }
})

export function sourceSearchRoute(contextId?: string): { sourceSearch?: string; returnTo?: string } {
  if (!contextId) return {}
  const context = useSourceSearchStore().get(contextId)
  return context ? { sourceSearch: context.id, returnTo: sourceSearchListPath(context.returnTo, context.id) } : { sourceSearch: contextId }
}

export function finishSourceSearchReturn(router: Router, route: RouteLocationNormalizedLoaded) {
  if (!route.query.sourceSearchReturn) return
  const query = { ...route.query }
  delete query.sourceSearchReturn
  void router.replace({ path: route.path, query })
}
