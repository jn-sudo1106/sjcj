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
    <div v-if="loading" class="fc-state">正在加载网站列表…</div>
    <div v-else-if="error" class="fc-state fc-error">
      <span>{{ error }}</span>
      <button class="rc-btn" type="button" data-testid="file-center-retry" @click="retry">重试</button>
    </div>
    <SiteFileView v-else :site-id="siteId || undefined" :initial-source-id="siteId ? queryString(route.query.sourceId) : undefined" class="fc-files">
      <template #toolbar-prefix>
        <!-- 其余筛选项（状态/自定义SQL 等）都不带外部 label，靠选项文案自解释（如"状态（不限）"）；
             这里原来多了一个常驻 <label>网站</label>，跟默认选项"全部网站"字面重复，
             去掉可见 label，用 aria-label 保无障碍语义，对齐整行的视觉语言。 -->
        <select
          id="file-center-site"
          class="fc-site-select"
          aria-label="网站"
          data-testid="file-center-site-select"
          :value="siteId"
          :disabled="loading || !!error"
          @change="selectSite(($event.target as HTMLSelectElement).value)"
        >
          <option value="">全部网站</option>
          <option v-for="site in sites" :key="site.siteId" :value="site.siteId">{{ site.name }}（{{ site.siteId }}）</option>
        </select>
      </template>
    </SiteFileView>
  </main>
</template>

<style scoped>
.fc-shell { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: 10px; }
.fc-state { flex: 1; display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 240px; padding: 40px 12px; color: var(--rc-faint); font-size: 13px; text-align: center; }
.fc-site-select { width: 170px; min-width: 170px; height: 28px; padding: 0 8px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text); font-size: 12px; }
.fc-site-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; outline: none; }
.fc-error { color: var(--rc-error); }
.fc-files { flex: 1; min-height: 0; }
</style>
