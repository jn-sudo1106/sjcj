<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { siteApi, type Site } from '@/api'
import SiteFileView from '@/views/FlowCanvas/result/SiteFileView.vue'

const route = useRoute()
const router = useRouter()

const sites = ref<Site[]>([])
const siteId = ref('')
const loading = ref(false)
const error = ref('')
const keyword = ref('')

// 网站列表一次已全部拉回（最多 1000 个），搜索在本地按名称或 ID 过滤，不再打接口
const visibleSites = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return sites.value
  return sites.value.filter((site) => site.name.toLowerCase().includes(text) || site.siteId.toLowerCase().includes(text))
})

function queryString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function syncFromRoute() {
  siteId.value = queryString(route.query.siteId)
}

async function loadSites() {
  loading.value = true
  error.value = ''
  try {
    const result = await siteApi.sitePaged({ page: 1, size: 1000 })
    sites.value = result.list
    const routeSiteId = queryString(route.query.siteId)
    if (routeSiteId && !result.list.some((site) => site.siteId === routeSiteId)) {
      siteId.value = ''
      error.value = '当前网站不存在或无权访问，请重新选择'
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '加载网站列表失败，请重试'
  } finally {
    loading.value = false
  }
}

function selectSite(value: string) {
  siteId.value = value
  void router.replace({ path: '/files', query: value ? { siteId: value } : {} })
}

function retry() {
  void loadSites()
}

onMounted(() => {
  syncFromRoute()
  void loadSites()
})
watch(() => route.query.siteId, syncFromRoute)
</script>

<template>
  <!-- 左侧网站列表 + 右侧文件视图（1105 会议：与源管理的左侧目录一致，原来是顶部下拉选网站） -->
  <main class="fc-shell">
    <aside class="fc-sites" aria-label="网站" data-testid="file-center-site-panel">
      <div class="fc-sites-head">网站</div>
      <input v-model="keyword" class="fc-search" placeholder="搜索网站名称 / ID" aria-label="搜索网站" data-testid="file-center-site-search">
      <div class="fc-sites-list">
        <div v-if="loading" class="fc-sites-empty">正在加载网站列表…</div>
        <template v-else>
          <div v-if="error" class="fc-sites-empty fc-error">
            <span>{{ error }}</span>
            <button class="fc-link" type="button" data-testid="file-center-retry" @click="retry">重试</button>
          </div>
          <button
            class="fc-site-row"
            :class="{ on: !siteId }"
            type="button"
            data-testid="file-center-site-all"
            @click="selectSite('')"
          >
            <span class="fc-site-name">全部网站</span>
          </button>
          <button
            v-for="site in visibleSites"
            :key="site.siteId"
            class="fc-site-row"
            :class="{ on: siteId === site.siteId }"
            type="button"
            :title="`${site.name}（${site.siteId}）`"
            data-testid="file-center-site-row"
            @click="selectSite(site.siteId)"
          >
            <span class="fc-site-name">{{ site.name }}</span>
            <span class="fc-site-count">{{ site.sourceCount }}</span>
          </button>
          <div v-if="keyword.trim() && !visibleSites.length" class="fc-sites-empty">没有匹配的网站</div>
        </template>
      </div>
      <div class="fc-sites-foot">共 {{ sites.length }} 个网站 · 右侧数字为源数量</div>
    </aside>
    <SiteFileView :site-id="siteId || undefined" :initial-source-id="siteId ? queryString(route.query.sourceId) : undefined" class="fc-files" />
  </main>
</template>

<style scoped>
/* 版式对齐源管理左侧目录面板 SourceDirPanel（.sdp-*）：252px 宽、30px 行高、选中行主色浅底 */
.fc-shell { display: grid; grid-template-columns: 252px minmax(0, 1fr); gap: 12px; height: 100%; min-height: 0; }
.fc-sites { display: flex; flex-direction: column; min-height: 0; padding: 12px; background: #fff; border: 1px solid var(--rc-border); border-radius: 12px; }
.fc-sites-head { flex: none; margin-bottom: 10px; color: var(--rc-text); font-size: 13px; font-weight: 600; }
.fc-search { flex: none; box-sizing: border-box; width: 100%; height: 30px; padding: 0 10px; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; font-size: 13px; outline: none; }
.fc-search:focus { border-color: var(--rc-primary); }
.fc-sites-list { flex: 1; min-height: 0; margin-top: 8px; overflow: auto; }
.fc-site-row { display: flex; align-items: center; gap: 6px; width: 100%; height: 30px; padding: 0 6px; border: 0; border-radius: 6px; background: none; color: var(--rc-text); font-size: 13px; text-align: left; cursor: pointer; }
.fc-site-row:hover { background: #f1f5f9; }
.fc-site-row.on { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.fc-site-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fc-site-count { flex: none; color: var(--rc-faint); font-size: 11px; font-variant-numeric: tabular-nums; }
.fc-sites-empty { display: flex; align-items: center; gap: 8px; padding: 10px 6px; color: var(--rc-faint); font-size: 12px; }
.fc-error { color: var(--rc-error); }
.fc-link { border: 0; background: none; padding: 0; color: var(--rc-primary); font-size: 12px; cursor: pointer; }
.fc-sites-foot { flex: none; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--rc-border-soft); color: var(--rc-faint); font-size: 12px; }
.fc-files { min-width: 0; min-height: 0; }
@media (max-width: 900px) {
  .fc-shell { grid-template-columns: 1fr; grid-template-rows: 240px minmax(0, 1fr); }
}
</style>
