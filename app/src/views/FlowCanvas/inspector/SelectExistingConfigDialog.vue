<script setup lang="ts">
// 选择已有配置（0824-00 §5.3 / §6.1）。
// 默认数据源和旧平台「本步骤使用配置」一致：item/next/configs/same 按源查同资源配置，
// 合并顺序 [...list2, ...list1]——list1 = 同域/local，list2 = 其它域推荐，不是全库。
// 打开后自动接 configPaged（0828 §2.1-2b 的「载入更多」），列表触底继续翻页，不再单独放按钮。
// 关键词：同资源列表先本地筛；同时按 ID/名称打 configPaged。
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { configApi, type Config } from '@/api'

const PAGE_SIZE = 50

const props = defineProps<{ open: boolean; sourceId?: string; currentConfigId?: string; configType?: string }>()
const emit = defineEmits<{ 'update:open': [boolean]; select: [Config] }>()

const loading = ref(false)
const keyword = ref('')
const sameList = ref<Config[]>([])
const moreList = ref<Config[]>([])
const morePage = ref(0)
const moreTotal = ref<number | null>(null)
const moreLoading = ref(false)
const searchList = ref<Config[]>([])
const searchPage = ref(0)
const searchTotal = ref<number | null>(null)
const searchLoading = ref(false)
const listRef = ref<HTMLElement | null>(null)
const sentinelRef = ref<HTMLElement | null>(null)

let kwTimer: ReturnType<typeof setTimeout> | undefined
let searchSeq = 0
let endObserver: IntersectionObserver | undefined

function mergeUnique(base: Config[], add: Config[]): Config[] {
  const seen = new Set(base.map((c) => c.configId))
  const out = [...base]
  for (const c of add) {
    if (seen.has(c.configId)) continue
    seen.add(c.configId)
    out.push(c)
  }
  return out
}

function isCompatible(c: Config) {
  return props.configType === undefined || c.configType === undefined || c.configType === props.configType
}

const kw = computed(() => keyword.value.trim())
const busy = computed(() => loading.value || moreLoading.value || searchLoading.value)

const filtered = computed(() => {
  const k = kw.value.toLowerCase()
  if (!k) return mergeUnique(sameList.value, moreList.value).filter(isCompatible)
  const localHits = sameList.value.filter((c) =>
    isCompatible(c) && (c.name.toLowerCase().includes(k) || c.configId.includes(k)),
  )
  return mergeUnique(localHits, searchList.value.filter(isCompatible))
})

const hasMore = computed(() => {
  if (kw.value) {
    if (searchTotal.value == null) return false
    return searchPage.value * PAGE_SIZE < searchTotal.value
  }
  if (moreTotal.value == null) return true
  return morePage.value * PAGE_SIZE < moreTotal.value
})

async function loadSame() {
  if (!props.sourceId) {
    sameList.value = []
    return
  }
  loading.value = true
  try {
    sameList.value = await configApi.sameConfigs(props.sourceId, props.currentConfigId)
  } catch (e) {
    ElMessage.error(`加载同资源配置失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    loading.value = false
  }
  await loadMore()
}

function resetCatalog() {
  keyword.value = ''
  sameList.value = []
  moreList.value = []
  morePage.value = 0
  moreTotal.value = null
  searchList.value = []
  searchPage.value = 0
  searchTotal.value = null
}

function teardownObserver() {
  endObserver?.disconnect()
  endObserver = undefined
}

function setupObserver() {
  teardownObserver()
  if (typeof IntersectionObserver === 'undefined') return
  if (!listRef.value || !sentinelRef.value) return
  endObserver = new IntersectionObserver(
    (entries) => { if (entries.some((e) => e.isIntersecting)) void onReachEnd() },
    { root: listRef.value, rootMargin: '80px' },
  )
  endObserver.observe(sentinelRef.value)
}

async function fillIfShort() {
  await nextTick()
  const el = listRef.value
  if (!el || !hasMore.value || busy.value) return
  // jsdom 里 clientHeight 常为 0，这时不能当成「没撑满」一直翻页
  if (el.clientHeight <= 0) return
  if (el.scrollHeight <= el.clientHeight + 8) await onReachEnd()
}

async function onReachEnd() {
  if (!hasMore.value || busy.value) return
  await loadMore()
  await fillIfShort()
}

watch(() => props.open, async (v) => {
  if (!v) {
    teardownObserver()
    return
  }
  clearTimeout(kwTimer)
  resetCatalog()
  await loadSame()
  await nextTick()
  setupObserver()
  await fillIfShort()
}, { immediate: true })

watch(keyword, (v) => {
  clearTimeout(kwTimer)
  const trimmed = v.trim()
  if (!trimmed) {
    searchSeq += 1
    searchList.value = []
    searchPage.value = 0
    searchTotal.value = null
    searchLoading.value = false
    void nextTick(async () => {
      setupObserver()
      await fillIfShort()
    })
    return
  }
  kwTimer = setTimeout(async () => {
    await fetchSearchPage(1, false)
    await nextTick()
    setupObserver()
    await fillIfShort()
  }, 300)
})

async function fetchMorePage(page: number) {
  moreLoading.value = true
  try {
    const r = await configApi.configPaged({ page, size: PAGE_SIZE })
    moreTotal.value = r.total
    moreList.value = page <= 1 ? r.list : mergeUnique(moreList.value, r.list)
    morePage.value = page
  } catch (e) {
    ElMessage.error(`加载配置列表失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    moreLoading.value = false
  }
}

async function fetchSearchPage(page: number, append: boolean) {
  const q = kw.value
  if (!q) return
  const seq = ++searchSeq
  searchLoading.value = true
  try {
    const r = await configApi.configPaged({ keyword: q, page, size: PAGE_SIZE })
    if (seq !== searchSeq) return
    searchTotal.value = r.total
    searchList.value = append ? mergeUnique(searchList.value, r.list) : r.list
    searchPage.value = page
  } catch (e) {
    if (seq !== searchSeq) return
    ElMessage.error(`搜索配置失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    if (seq === searchSeq) searchLoading.value = false
  }
}

async function loadMore() {
  if (busy.value || !props.sourceId) return
  if (kw.value) {
    if (searchTotal.value != null && searchPage.value * PAGE_SIZE >= searchTotal.value) return
    await fetchSearchPage(searchPage.value + 1, true)
    return
  }
  if (moreTotal.value != null && morePage.value * PAGE_SIZE >= moreTotal.value) return
  await fetchMorePage(morePage.value + 1)
}

onBeforeUnmount(teardownObserver)

function close() {
  emit('update:open', false)
}
function onPick(config: Config) {
  emit('select', config)
  close()
}
</script>

<template>
  <el-dialog :model-value="open" title="选择已有配置" width="640px" :close-on-click-modal="false" @update:model-value="close">
    <input v-model="keyword" class="secd-search" placeholder="按配置 ID / 名称筛选（可搜全库）" />
    <div class="secd-hint">默认先列本源同资源配置，其余配置向下滚动自动加载；也可按 ID / 名称搜索全库。</div>
    <div ref="listRef" v-loading="loading || (searchLoading && searchPage === 0)" class="secd-list">
      <div v-if="!loading && !sourceId" class="secd-empty">当前不是源画布，无法按源查同资源配置。</div>
      <div v-else-if="!loading && !searchLoading && !filtered.length" class="secd-empty">暂无可选配置</div>
      <button
        v-for="c in filtered"
        :key="c.configId"
        class="secd-row"
        type="button"
        :class="{ current: c.configId === currentConfigId }"
        @click="onPick(c)"
      >
        <div class="secd-row-main">
          <span class="secd-id">#{{ c.configId }}</span>
          <span class="secd-name">{{ c.name }}</span>
          <span v-if="c.configId === currentConfigId" class="secd-tag">当前</span>
        </div>
        <div class="secd-row-sub">
          <span v-if="c.domain">{{ c.domain }}</span>
          <span v-if="c.topic">队列 {{ c.topic }}</span>
          <span v-if="c.entryTypeId">输出表 {{ c.entryTypeId }}</span>
        </div>
      </button>
      <div v-if="moreLoading" class="secd-status">加载中…</div>
      <div v-if="sourceId && hasMore" ref="sentinelRef" class="secd-sentinel" data-testid="config-load-sentinel" />
    </div>
  </el-dialog>
</template>

<style scoped>
.secd-search { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; margin-bottom: 8px; }
.secd-hint { color: var(--rc-faint); font-size: 11px; line-height: 1.5; margin-bottom: 8px; }
.secd-list { max-height: 46vh; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
.secd-empty, .secd-status { color: var(--rc-faint); font-size: 12px; padding: 12px 0; text-align: center; }
.secd-row { text-align: left; border: 1px solid var(--rc-border); border-radius: 8px; background: #fff; padding: 8px 10px; cursor: pointer; }
.secd-row:hover { border-color: var(--rc-primary); background: var(--rc-primary-bg); }
.secd-row.current { border-color: var(--rc-primary); }
.secd-row-main { display: flex; align-items: center; gap: 8px; }
.secd-id { font-size: 11px; font-weight: 700; color: var(--rc-text-2); font-variant-numeric: tabular-nums; }
.secd-name { font-size: 12px; font-weight: 600; color: var(--rc-text); }
.secd-tag { font-size: 10px; color: var(--rc-primary-ink); background: var(--rc-primary-bg); border-radius: 4px; padding: 1px 5px; }
.secd-row-sub { display: flex; gap: 10px; margin-top: 3px; color: var(--rc-faint); font-size: 10px; }
.secd-sentinel { height: 1px; flex-shrink: 0; }
</style>
