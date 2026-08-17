<script setup lang="ts">
// 网站详情（左侧“全部”）下的源总览：只查当前网站，不提供跨网站/指定网站范围切换
// （0812 会议纠偏：进入网站后源/数据/文件/监控范围必须固定为当前 siteId，不能从网站详情跨站查询）。
import { computed, onMounted, ref, watch } from 'vue'
import { sourceApi, type Source } from '@/api'

const props = defineProps<{ currentSiteId: string }>()
const emit = defineEmits<{ openSource: [source: Source] }>()

// UI 状态筛选：停用是启停字段（enable=1），不是旧接口没有的 state=disabled，
// 正常/运行中/异常需要额外带 enable=0 排除已停用记录（方案 §5.4 状态请求映射表）。
type StatusFilter = 'all' | 'C' | 'L' | 'E' | 'disabled'

const rows = ref<Source[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(20)
const loading = ref(false)
const loadError = ref('')
const sourceIds = ref('')
const name = ref('')
const statusFilter = ref<StatusFilter>('all')
const sortField = ref('')
const sortDirection = ref<'asc' | 'desc'>('asc')
let sourceRequestSeq = 0

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / size.value)))

async function loadSources() {
  const requestId = ++sourceRequestSeq
  loading.value = true
  loadError.value = ''
  try {
    const result = await sourceApi.sourcePaged({
      page: page.value,
      size: size.value,
      siteId: props.currentSiteId,
      sourceIds: sourceIds.value || undefined,
      name: name.value || undefined,
      state: statusFilter.value === 'all' || statusFilter.value === 'disabled' ? undefined : statusFilter.value,
      enable: statusFilter.value === 'disabled' ? '1' : statusFilter.value === 'all' ? undefined : '0',
      field: sortField.value || undefined,
      sorted: sortField.value ? (sortDirection.value === 'asc' ? 1 : -1) : undefined,
      type: sortField.value ? (sortDirection.value === 'asc' ? 'ASC' : 'DESC') : undefined,
    })
    if (requestId !== sourceRequestSeq) return
    rows.value = result.list
    total.value = result.total
  } catch (error) {
    if (requestId !== sourceRequestSeq) return
    rows.value = []
    total.value = 0
    loadError.value = `加载源列表失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    if (requestId === sourceRequestSeq) loading.value = false
  }
}
function search() {
  page.value = 1
  void loadSources()
}
function clearFilters() {
  sourceIds.value = ''
  name.value = ''
  statusFilter.value = 'all'
  search()
}
function toggleSort(field: string) {
  if (sortField.value === field) {
    if (sortDirection.value === 'asc') sortDirection.value = 'desc'
    else sortField.value = ''
  } else {
    sortField.value = field
    sortDirection.value = 'asc'
  }
  search()
}
function sortLabel(field: string) {
  if (sortField.value !== field) return '未排序'
  return sortDirection.value === 'asc' ? '升序' : '降序'
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

onMounted(loadSources)
watch(() => props.currentSiteId, () => {
  page.value = 1
  void loadSources()
})
</script>

<template>
  <section class="sov-shell" data-testid="source-overview">
    <div class="sov-filter">
      <label>源 ID
        <input v-model="sourceIds" data-testid="source-overview-source-ids" placeholder="多个 ID 用逗号分隔" @keyup.enter="search" />
      </label>
      <label>源名称
        <input v-model="name" data-testid="source-overview-name" placeholder="源名称" @keyup.enter="search" />
      </label>
      <label>状态
        <select v-model="statusFilter" data-testid="source-overview-state" @change="search">
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
      <span>共 {{ total }} 个源</span>
    </div>
    <div class="sov-table-wrap" :class="{ loading }">
      <table class="sov-table">
        <thead>
          <tr>
            <th><button class="sov-sort" type="button" :title="sortLabel('SOURCE_ID')" @click="toggleSort('SOURCE_ID')">源 ID <span>{{ sortField === 'SOURCE_ID' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕' }}</span></button></th>
            <th>源名称</th>
            <th>URL</th><th>主表</th>
            <th><button class="sov-sort" type="button" :title="sortLabel('DATA_CNT')" @click="toggleSort('DATA_CNT')">数据 <span>{{ sortField === 'DATA_CNT' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕' }}</span></button></th>
            <th>新入</th><th>成功</th><th>最近任务</th><th>最近成功</th><th>状态</th><th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="source in rows" :key="source.sourceId">
            <td>{{ source.sourceId }}</td>
            <td class="sov-name" :title="source.name"><button class="sov-link sov-source-link" type="button" data-testid="source-overview-source-link" @click="emit('openSource', source)">{{ source.name }}</button></td>
            <td class="sov-url" :title="source.url">{{ source.url || '—' }}</td>
            <td>{{ source.mainTable || '—' }}</td>
            <td>{{ source.dataCount ?? '—' }}</td>
            <td>{{ source.newInCount ?? '—' }}</td>
            <td>{{ source.successCount ?? '—' }}</td>
            <td>{{ source.lastTaskAt || '—' }}</td>
            <td>{{ source.lastSuccessAt || '—' }}</td>
            <td><span class="sov-state" :class="{ error: source.state === 'E' && !source.disabled, muted: source.disabled }">{{ sourceState(source) }}</span></td>
            <td :title="source.remark">{{ source.remark || '—' }}</td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="11" class="sov-empty">{{ loadError || '暂无符合条件的源' }}</td></tr>
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
.sov-source-link { display: block; max-width: 190px; overflow: hidden; padding: 0; text-align: left; text-overflow: ellipsis; }
.sov-url { max-width: 220px; overflow: hidden; text-overflow: ellipsis; color: var(--rc-primary) !important; }
.sov-empty { padding: 42px !important; text-align: center !important; color: var(--rc-faint) !important; }
.sov-state { display: inline-flex; padding: 2px 7px; border-radius: 999px; background: #ecfdf3; color: #15803d; font-size: 11px; font-weight: 700; }
.sov-state.error { background: #fef2f2; color: #dc2626; }
.sov-state.muted { background: #f1f5f9; color: #64748b; }
.sov-link { border: 0; background: transparent; color: var(--rc-primary); cursor: pointer; font-size: 12px; font-weight: 600; }
.sov-sort { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; }
.sov-sort span { color: #94a3b8; font-size: 11px; }
.sov-pager { display: flex; align-items: center; justify-content: flex-end; gap: 8px; color: var(--rc-faint); font-size: 11px; }
</style>
