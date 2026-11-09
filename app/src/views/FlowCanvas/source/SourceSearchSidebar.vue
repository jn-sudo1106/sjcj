<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Back, Refresh } from '@element-plus/icons-vue'
import { sourceApi, type Source } from '@/api'
import { useSourceSearchStore, sourceSearchListPath } from '@/stores/sourceSearch'
import { useUiStore } from '@/stores/ui'
import { useRoute, useRouter } from 'vue-router'
import { describeFilters } from '../result/useSourceLaunch'
import SiteSourceSwitcher from './SiteSourceSwitcher.vue'
import SourceRowActions, { type SourceRowActionKind } from './SourceRowActions.vue'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ contextId?: string; siteId: string; activeKey: string }>()
const emit = defineEmits<{ pick: [source: Source]; edited: [source: Source] }>()
const search = useSourceSearchStore()
const ui = useUiStore()
const router = useRouter()
const route = useRoute()
const context = computed(() => search.get(props.contextId))
const hasSite = computed(() => !!props.siteId && props.siteId !== '0' && props.siteId !== '-1')
const mode = computed(() => context.value?.mode === 'site' && hasSite.value ? 'site' : 'search')
const collapsed = ref(false)
const rows = ref<Source[]>([])
const loading = ref(false)
const error = ref('')
const listElement = ref<HTMLElement>()
const rowActions = ref<InstanceType<typeof SourceRowActions>>()
const description = computed(() => context.value ? describeFilters(context.value.query) : '')
// 侧栏不分页：一次取回本次查询的前 N 个源，剩余交给「返回搜索列表」看
const RESULT_LIMIT = 200
let requestSeq = 0
async function load() {
  const seq = ++requestSeq
  const current = context.value
  if (!current || mode.value !== 'search') return
  loading.value = true
  error.value = ''
  rows.value = []
  try {
    const result = current.empty || current.query.sourceIds === ''
      ? { list: [], total: 0 }
      : await sourceApi.sourcePaged({ ...current.query, page: 1, size: RESULT_LIMIT })
    if (seq !== requestSeq) return
    rows.value = result.list
    current.total = result.total
    if (listElement.value) listElement.value.scrollTop = 0
  } catch (reason) {
    if (seq === requestSeq) error.value = `加载搜索结果失败：${reason instanceof Error ? reason.message : String(reason)}`
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}
watch(() => [context.value?.id, mode.value, ui.sourceListRevision], () => { void load() }, { immediate: true })
onBeforeUnmount(() => { requestSeq++ })
function returnToList() {
  if (context.value) void router.push(sourceSearchListPath(context.value.returnTo, context.value.id))
  else void router.push(sourceSearchListPath(typeof route.query.returnTo === 'string' ? route.query.returnTo : '/collect'))
}
function changeMode(event: Event) {
  const next = (event.target as HTMLSelectElement).value as 'search' | 'site'
  if (next === 'site' && !hasSite.value) return
  if (context.value) context.value.mode = next
}
// 右键菜单里的动作都在 SourceRowActions 里做完了：这里只管结果——
// 重取本次搜索结果（watch ui.sourceListRevision 会触发 load，其他列表也跟着刷新），
// 编辑/重命名当前源时把新值抛给画布去同步页签和 flow store；删掉的是当前源就退回搜索列表。
function onRowChanged(kind: SourceRowActionKind, source: Source) {
  ui.notifySourceListChanged()
  if (kind === 'edited' || kind === 'renamed') emit('edited', source)
  if (kind === 'deleted' && source.sourceId === props.activeKey) returnToList()
}
function siteLabel(source: Source) {
  if (source.siteName) return source.siteName
  return source.siteId && source.siteId !== '0' ? `网站 #${source.siteId}` : '未关联网站'
}
</script>

<template>
  <SiteSourceSwitcher v-if="!context && !contextId" v-bind="$attrs" :site-id="siteId" :active-key="activeKey" @pick="emit('pick', $event)" />
  <aside v-else-if="!context" class="search-side"><p class="search-empty search-failed">本次搜索已失效，请返回列表重新查询。<button class="search-retry" @click="returnToList">返回搜索列表</button></p></aside>
  <aside v-else class="search-side" :class="{ collapsed }" data-testid="source-search-sidebar">
    <button v-if="collapsed" class="search-expand" type="button" aria-label="展开搜索结果" title="展开搜索结果" @click="collapsed = false">»</button>
    <template v-else>
      <div class="search-mode">
        <button class="search-return" type="button" aria-label="返回搜索列表" title="返回搜索列表" @click="returnToList"><el-icon><Back /></el-icon></button>
        <select class="search-mode-select" :value="mode" aria-label="源列表范围" data-testid="search-mode" @change="changeMode">
          <option value="search">本次搜索结果</option>
          <option value="site" :disabled="!hasSite">所属网站源</option>
        </select>
        <button class="search-collapse" type="button" aria-label="收起搜索结果" title="收起搜索结果" @click="collapsed = true">«</button>
      </div>
      <template v-if="mode === 'search'">
        <div class="search-section">
          <span class="search-section-title">搜索结果 ({{ context.total }})</span>
          <span class="search-section-actions">
            <button class="search-refresh" type="button" aria-label="刷新搜索结果" title="刷新搜索结果" :disabled="loading" @click="load"><el-icon><Refresh /></el-icon></button>
          </span>
        </div>
        <div class="search-hit">
          <span class="search-hit-label" :title="context.label">{{ context.label }}</span>
          <strong class="search-hit-text" :title="description">{{ description || '全部源' }}</strong>
        </div>
        <p v-if="!loading && !error && rows.length && activeKey && !rows.some(source => source.sourceId === activeKey)" class="search-hint">当前源不在本页结果中</p>
        <div ref="listElement" class="search-list" :aria-busy="loading">
          <p v-if="loading" class="search-empty">正在加载…</p>
          <p v-else-if="error" class="search-empty search-failed" role="alert">{{ error }}<button class="search-retry" @click="load">重试</button></p>
          <p v-else-if="!rows.length" class="search-empty">没有符合原查询条件的源</p>
          <template v-else>
            <button v-for="source in rows" :key="source.sourceId" class="search-item" :class="{ active: activeKey === source.sourceId }" type="button" :aria-current="activeKey === source.sourceId ? 'true' : undefined" :title="`${source.name}\n${source.sourceId} · ${siteLabel(source)}`" @click="emit('pick', source)" @contextmenu.prevent.stop="rowActions?.open($event, source)">
              <span class="search-dot" />
              <span class="search-row-text">
                <span class="search-row-name">{{ source.name }}</span>
                <span class="search-row-meta"><span class="search-row-id">{{ source.sourceId }}</span><span class="search-tag" :class="{ muted: !source.siteName }" :title="siteLabel(source)">{{ siteLabel(source) }}</span></span>
              </span>
            </button>
          </template>
        </div>
        <div v-if="context.total > rows.length" class="search-foot">
          <button class="search-foot-btn" type="button" @click="returnToList">本次共 {{ context.total }} 个源，回到搜索列表查看</button>
        </div>
      </template>
      <template v-else>
        <div class="search-site-body">
          <SiteSourceSwitcher v-bind="$attrs" :site-id="siteId" :active-key="activeKey" @pick="emit('pick', $event)" />
        </div>
      </template>
    </template>
  </aside>

  <SourceRowActions v-if="mode === 'search'" ref="rowActions" @changed="onRowChanged" />
</template>

<style scoped>
.search-side { flex: none; display: flex; flex-direction: column; width: 260px; min-height: 0; overflow: hidden; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); background: #fbfdff; }
.search-side.collapsed { width: 30px; align-items: center; justify-content: flex-start; padding-top: 8px; background: #fff; }

.search-expand { width: 24px; height: 24px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--rc-muted); font-size: 14px; cursor: pointer; }
.search-expand:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }

.search-return, .search-refresh, .search-collapse { flex: none; display: inline-flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--rc-muted); cursor: pointer; }
.search-return { width: 22px; height: 30px; font-size: 13px; }
.search-refresh { width: 22px; height: 20px; font-size: 12px; }
.search-collapse { width: 20px; height: 30px; color: var(--rc-faint); font-size: 13px; }
.search-return:hover, .search-refresh:hover:not(:disabled) { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.search-collapse:hover { background: #f1f5f9; color: var(--rc-text); }
.search-refresh:disabled { cursor: default; opacity: .4; }

.search-section { flex: none; display: flex; align-items: center; justify-content: space-between; margin: 6px 6px 0; padding: 3px 4px 3px 9px; border: 1px solid var(--rc-border-soft); border-radius: 6px; background: #f1f5f9; color: var(--rc-text-2); font-size: 11px; font-weight: 700; }
.search-section-actions { display: flex; align-items: center; }

.search-mode { flex: none; display: flex; align-items: center; gap: 4px; padding: 8px 8px 0; }
.search-mode-select { flex: 1; min-width: 0; height: 30px; padding: 0 8px; border: 1px solid var(--rc-border); border-radius: 7px; background: #fff; color: var(--rc-text-2); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.search-mode-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; outline: none; }

.search-hit { flex: none; display: grid; gap: 2px; margin: 8px 8px 6px; padding: 5px 8px; border: 1px solid #bfdbfe; border-radius: 6px; background: var(--rc-primary-bg); }
.search-hit-label, .search-hit-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.search-hit-label { font-size: 10px; color: var(--rc-muted); }
.search-hit-text { font-size: 11px; font-weight: 600; color: var(--rc-primary-ink); }
.search-hint { flex: none; margin: 0 8px 6px; padding: 5px 8px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; font-size: 11px; color: var(--rc-muted); }

.search-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 6px 6px; scrollbar-width: thin; }
.search-item { display: flex; align-items: center; gap: 7px; width: 100%; padding: 8px; border: 0; border-radius: 7px; background: transparent; color: var(--rc-text-2); font-size: 13px; text-align: left; cursor: pointer; }
.search-item:hover { background: var(--rc-primary-bg); }
.search-item.active { background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-weight: 700; }
.search-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--rc-ok); }
.search-row-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.search-row-name { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; line-height: 1.4; }
.search-row-meta { display: flex; align-items: center; gap: 5px; min-width: 0; margin-top: 3px; }
.search-row-id { flex: none; font-family: monospace; font-size: 11px; font-weight: 400; opacity: .6; }
.search-tag { min-width: 0; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 1px 4px; border-radius: 3px; background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-size: 11px; font-weight: 400; }
.search-item.active .search-row-id { opacity: .85; }
.search-tag.muted { color: var(--rc-muted); background: var(--rc-border-soft); }
.search-item.active .search-tag { background: #fff; }
.search-item.active .search-tag.muted { background: var(--rc-border-soft); }

.search-empty { margin: 0; padding: 14px 8px; text-align: center; font-size: 11px; color: var(--rc-faint); line-height: 1.7; overflow-wrap: anywhere; }
.search-failed { color: var(--rc-error); }
.search-retry { margin-left: 6px; padding: 0; border: 0; background: transparent; color: var(--rc-primary); font-size: 11px; cursor: pointer; }
.search-retry:hover { text-decoration: underline; }

.search-foot { flex: none; display: flex; align-items: center; gap: 6px; padding: 6px 8px 8px; border-top: 1px solid var(--rc-border-soft); }
.search-foot-btn { flex: 1; height: 26px; padding: 0 8px; border: 1px dashed var(--rc-border); border-radius: 7px; background: transparent; color: var(--rc-muted); font-size: 11px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.search-foot-btn:hover:not(:disabled) { border-color: var(--rc-primary); color: var(--rc-primary-ink); }

.search-site-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
/* 内嵌旧侧栏：它自身是 flex:none + 固定 260px，这里用更高优先级把高度撑满，列表才能内滚 */
.search-site-body :deep(.ssw-side) { flex: 1 1 auto; width: auto; height: 100%; min-height: 0; border: 0; border-top: 1px solid var(--rc-border-soft); border-radius: 0; }
.search-site-body :deep(.ssw-collapse) { display: none; }

button:focus-visible { outline: 2px solid var(--rc-primary); outline-offset: -2px; }
@media (max-width: 1440px) { .search-side { width: 248px; } }
</style>