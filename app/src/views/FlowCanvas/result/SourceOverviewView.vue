<script setup lang="ts">
// 网站详情（左侧“全部”）下的源总览：默认仍停留在当前网站，只有用户主动切换范围才跨网站查询。
import { computed, onMounted, ref, watch } from 'vue'
import { siteApi, sourceApi, type Site, type Source } from '@/api'

const props = defineProps<{ currentSiteId: string }>()
const emit = defineEmits<{ openSource: [source: Source] }>()

type Scope = 'current' | 'all' | 'site'

const scope = ref<Scope>('current')
const selectedSiteId = ref('')
const sites = ref<Site[]>([])
const rows = ref<Source[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(20)
const loading = ref(false)
const loadError = ref('')
const sourceIds = ref('')
const name = ref('')
const configId = ref('')
const state = ref('all')

const effectiveSiteId = computed(() => {
  if (scope.value === 'current') return props.currentSiteId
  if (scope.value === 'site') return selectedSiteId.value
  return ''
})
const scopeLabel = computed(() => {
  if (scope.value === 'all') return '跨网站 · 全部网站'
  const current = sites.value.find((site) => site.siteId === effectiveSiteId.value)
  return current?.name || '当前网站'
})
const siteNames = computed(() => Object.fromEntries(sites.value.map((site) => [site.siteId, site.name])))
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / size.value)))

async function loadSites() {
  const result = await siteApi.sitePaged({ page: 1, size: 999, sort: 'name' })
  sites.value = result.list
}
async function loadSources() {
  loading.value = true
  loadError.value = ''
  try {
    const result = await sourceApi.sourcePaged({
      page: page.value,
      size: size.value,
      siteId: effectiveSiteId.value || undefined,
      sourceIds: sourceIds.value || undefined,
      name: name.value || undefined,
      configId: configId.value || undefined,
      state: state.value,
    })
    rows.value = result.list
    total.value = result.total
  } catch (error) {
    rows.value = []
    total.value = 0
    loadError.value = `加载源列表失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    loading.value = false
  }
}
function search() {
  page.value = 1
  void loadSources()
}
function clearFilters() {
  sourceIds.value = ''
  name.value = ''
  configId.value = ''
  state.value = 'all'
  search()
}
function onScopeChange() {
  if (scope.value === 'site' && !selectedSiteId.value) selectedSiteId.value = props.currentSiteId
  search()
}
function previousPage() {
  if (page.value <= 1) return
  page.value -= 1
  void loadSources()
}
function nextPage() {
  if (page.value >= totalPages.value) return
  page.value += 1
  void loadSources()
}
function sourceState(source: Source) {
  if (source.disabled) return '已停用'
  return source.state === 'E' ? '异常' : source.state === 'L' ? '运行中' : '正常'
}

onMounted(async () => {
  try {
    await loadSites()
  } finally {
    await loadSources()
  }
})
watch(() => props.currentSiteId, () => {
  scope.value = 'current'
  selectedSiteId.value = ''
  page.value = 1
  void loadSources()
})
</script>

<template>
  <section class="sov-shell" data-testid="source-overview">
    <div class="sov-filter">
      <label>范围
        <select v-model="scope" data-testid="source-overview-scope" @change="onScopeChange">
          <option value="current">当前网站</option>
          <option value="all">全部网站</option>
          <option value="site">指定网站</option>
        </select>
      </label>
      <label v-if="scope === 'site'">网站
        <select v-model="selectedSiteId" data-testid="source-overview-site" @change="search">
          <option v-for="site in sites" :key="site.siteId" :value="site.siteId">{{ site.name }}</option>
        </select>
      </label>
      <label>源 ID
        <input v-model="sourceIds" data-testid="source-overview-source-ids" placeholder="多个 ID 用逗号分隔" @keyup.enter="search" />
      </label>
      <label>源名称
        <input v-model="name" data-testid="source-overview-name" placeholder="源名称" @keyup.enter="search" />
      </label>
      <label>配置 ID
        <input v-model="configId" data-testid="source-overview-config" placeholder="配置 ID" @keyup.enter="search" />
      </label>
      <label>状态
        <select v-model="state" data-testid="source-overview-state" @change="search">
          <option value="all">全部</option>
          <option value="C">正常</option>
          <option value="L">运行中</option>
          <option value="E">异常</option>
          <option value="disabled">已停用</option>
        </select>
      </label>
      <button class="sov-btn primary" type="button" data-testid="source-overview-search" @click="search">查询</button>
      <button class="sov-btn" type="button" @click="clearFilters">清空</button>
    </div>

    <div class="sov-summary">
      <b>{{ scopeLabel }}</b><span>共 {{ total }} 个源</span>
    </div>
    <div class="sov-table-wrap" :class="{ loading }">
      <table class="sov-table">
        <thead>
          <tr>
            <th>源 ID</th><th>源名称</th><th>所属网站</th><th>URL</th><th>配置 ID</th><th>主表</th><th>数据</th><th>新入</th><th>成功</th><th>最近任务</th><th>最近成功</th><th>状态</th><th>备注</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="source in rows" :key="source.sourceId">
            <td>{{ source.sourceId }}</td>
            <td class="sov-name" :title="source.name">{{ source.name }}</td>
            <td>{{ siteNames[source.siteId || ''] || source.siteId || '—' }}</td>
            <td class="sov-url" :title="source.url">{{ source.url || '—' }}</td>
            <td>{{ source.configId || '—' }}</td>
            <td>{{ source.mainTable || '—' }}</td>
            <td>{{ source.dataCount ?? '—' }}</td>
            <td>{{ source.newInCount ?? '—' }}</td>
            <td>{{ source.successCount ?? '—' }}</td>
            <td>{{ source.lastTaskAt || '—' }}</td>
            <td>{{ source.lastSuccessAt || '—' }}</td>
            <td><span class="sov-state" :class="{ error: source.state === 'E' && !source.disabled, muted: source.disabled }">{{ sourceState(source) }}</span></td>
            <td :title="source.remark">{{ source.remark || '—' }}</td>
            <td><button class="sov-link" type="button" @click="emit('openSource', source)">查看</button></td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="14" class="sov-empty">{{ loadError || '暂无符合条件的源' }}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="sov-pager">
      <span>第 {{ page }} / {{ totalPages }} 页</span>
      <button class="sov-btn" type="button" :disabled="page <= 1" @click="previousPage">上一页</button>
      <button class="sov-btn" type="button" :disabled="page >= totalPages" @click="nextPage">下一页</button>
    </div>
  </section>
</template>

<style scoped>
.sov-shell { display: flex; flex: 1; min-height: 0; flex-direction: column; padding: 12px; background: #f8fafc; gap: 10px; }
.sov-filter { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; padding: 10px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #fff; }
.sov-filter label { display: grid; gap: 4px; color: var(--rc-muted); font-size: 11px; }
.sov-filter input, .sov-filter select { height: 30px; min-width: 116px; padding: 0 8px; border: 1px solid #dbe3ee; border-radius: 6px; color: var(--rc-text); background: #fff; font-size: 12px; }
.sov-filter input:focus, .sov-filter select:focus { outline: 0; border-color: #60a5fa; box-shadow: 0 0 0 2px #dbeafe; }
.sov-btn { height: 30px; padding: 0 10px; border: 1px solid #d5e2f2; border-radius: 6px; background: #fff; color: var(--rc-text-2); cursor: pointer; font-size: 12px; font-weight: 600; }
.sov-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.sov-btn:disabled { cursor: not-allowed; opacity: .5; }
.sov-summary { display: flex; gap: 8px; align-items: baseline; color: var(--rc-text-2); font-size: 12px; }
.sov-summary b { color: var(--rc-text); }
.sov-summary span { color: var(--rc-faint); }
.sov-table-wrap { min-height: 0; flex: 1; overflow: auto; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #fff; }
.sov-table-wrap.loading { opacity: .62; }
.sov-table { width: max(100%, 1260px); border-collapse: collapse; font-size: 12px; }
.sov-table th, .sov-table td { padding: 9px 10px; border-bottom: 1px solid #edf2f7; text-align: left; white-space: nowrap; color: var(--rc-text-2); }
.sov-table th { position: sticky; top: 0; z-index: 1; background: #f8fafc; color: var(--rc-muted); font-weight: 700; }
.sov-name { max-width: 190px; overflow: hidden; text-overflow: ellipsis; color: var(--rc-text) !important; font-weight: 600; }
.sov-url { max-width: 220px; overflow: hidden; text-overflow: ellipsis; color: var(--rc-primary) !important; }
.sov-empty { padding: 42px !important; text-align: center !important; color: var(--rc-faint) !important; }
.sov-state { display: inline-flex; padding: 2px 7px; border-radius: 999px; background: #ecfdf3; color: #15803d; font-size: 11px; font-weight: 700; }
.sov-state.error { background: #fef2f2; color: #dc2626; }
.sov-state.muted { background: #f1f5f9; color: #64748b; }
.sov-link { border: 0; background: transparent; color: var(--rc-primary); cursor: pointer; font-size: 12px; font-weight: 600; }
.sov-pager { display: flex; align-items: center; justify-content: flex-end; gap: 8px; color: var(--rc-faint); font-size: 11px; }
</style>
