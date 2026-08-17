<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { siteApi, type Site } from '@/api'
import SiteFileView from '@/views/FlowCanvas/result/SiteFileView.vue'

const route = useRoute()
const router = useRouter()

const sites = ref<Site[]>([])
const siteId = ref('')
const loading = ref(false)
const error = ref('')

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
  <main class="fc-shell">
    <div class="fc-toolbar">
      <label class="fc-site-label" for="file-center-site">网站</label>
      <select
        id="file-center-site"
        class="fc-site-select"
        data-testid="file-center-site-select"
        :value="siteId"
        :disabled="loading || !!error"
        @change="selectSite(($event.target as HTMLSelectElement).value)"
      >
        <option value="">请选择网站</option>
        <option v-for="site in sites" :key="site.siteId" :value="site.siteId">{{ site.name }}（{{ site.siteId }}）</option>
      </select>
      <span class="fc-hint">选择网站后，可继续按源、文件名、类型和状态筛选</span>
      <button v-if="error" class="rc-btn" type="button" data-testid="file-center-retry" @click="retry">重试</button>
    </div>

    <div v-if="loading" class="fc-empty">正在加载网站列表…</div>
    <div v-else-if="error" class="fc-empty fc-error">{{ error }}</div>
    <div v-else-if="!siteId" class="fc-empty" data-testid="file-center-empty">请先选择网站，再查询该网站下的文件</div>
    <SiteFileView v-else :site-id="siteId" :initial-source-id="queryString(route.query.sourceId)" class="fc-files" />
  </main>
</template>

<style scoped>
.fc-shell { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: 10px; }
.fc-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 10px 12px; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); background: #fff; }
.fc-site-label { color: var(--rc-text-2); font-size: 12px; font-weight: 600; }
.fc-site-select { min-width: 280px; height: 30px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text); font-size: 12px; }
.fc-site-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; outline: none; }
.fc-hint { color: var(--rc-faint); font-size: 12px; }
.fc-toolbar .rc-btn { height: 28px; padding: 0 12px; font-size: 12px; }
.fc-empty { flex: 1; display: flex; align-items: center; justify-content: center; min-height: 240px; padding: 40px 12px; color: var(--rc-faint); font-size: 13px; text-align: center; }
.fc-error { color: var(--rc-error); }
.fc-files { flex: 1; min-height: 0; }
</style>
