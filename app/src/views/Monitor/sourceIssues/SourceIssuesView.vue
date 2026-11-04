<script setup lang="ts">
import { onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { sourceIssueApi, type SourceIssue, type SourceIssueQuery, type SourceIssueState } from '@/api/sourceIssues'
import { addDays, localDate, localDateTime } from '@/utils/format/localDateTime'
import SourceIssueDrawer from './SourceIssueDrawer.vue'

const route = useRoute()
const router = useRouter()
/** 字段与接口一致：state 用 0/1，空串表示「全部」（提交时不传 state）；日期用 yyyy-MM-dd。 */
const form = reactive({ keyword: '', state: '' as SourceIssueState | '', startDate: '', endDate: '' })
const filters = reactive<SourceIssueQuery>({ keyword: '', state: undefined, createTimeStart: '', createTimeEnd: '', page: 1, size: 20 })
const rows = ref<SourceIssue[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
const handling = ref(new Set<string>())
const detailOpen = ref(false)
const detailId = ref('')
let request = 0
let disposed = false
onBeforeUnmount(() => { disposed = true; request++ })

const text = (value: unknown) => typeof value === 'string' ? value : ''
const positive = (value: unknown, fallback: number) => Math.max(1, Math.floor(Number(value)) || fallback)
const dateValue = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(text(value)) ? text(value) : ''
const stateValue = (value: unknown): SourceIssueState | '' => text(value) === '1' ? 1 : text(value) === '0' ? 0 : ''
const pageSize = () => [20, 40, 100].includes(Number(route.query.issueSize)) ? Number(route.query.issueSize) : 20
function queryFromForm(page: number, size: number): SourceIssueQuery {
  return {
    keyword: form.keyword.trim(),
    state: form.state === '' ? undefined : form.state,
    createTimeStart: form.startDate,
    // 后端口径：上界传页面结束日的次日，按 < 排他
    createTimeEnd: form.endDate ? addDays(form.endDate, 1) : '',
    page,
    size,
  }
}
function readRoute() {
  Object.assign(form, {
    keyword: text(route.query.issueKeyword),
    state: stateValue(route.query.issueState),
    startDate: dateValue(route.query.issueTimeStart),
    endDate: dateValue(route.query.issueTimeEnd),
  })
  Object.assign(filters, queryFromForm(positive(route.query.issuePage, 1), pageSize()))
}
async function setQuery(query: SourceIssueQuery) {
  const target = { path: '/monitor', query: {
    ...route.query, tab: 'sourceIssues', issueState: query.state === undefined ? 'all' : String(query.state),
    issueKeyword: query.keyword || undefined, issueTimeStart: query.createTimeStart || undefined,
    issueTimeEnd: query.createTimeEnd ? addDays(query.createTimeEnd, -1) : undefined,
    issuePage: String(query.page), issueSize: String(query.size),
  } }
  if (router.resolve(target).fullPath === route.fullPath) await load()
  else await router.replace(target)
}
async function load() {
  if (disposed) return
  const seq = ++request
  loading.value = true
  error.value = ''
  try {
    const result = await sourceIssueApi.paged({ ...filters })
    if (seq !== request || disposed) return
    const lastPage = Math.max(1, Math.ceil(result.total / filters.size))
    if (filters.page > lastPage) { void setQuery({ ...filters, page: lastPage }); return }
    rows.value = result.list
    total.value = result.total
  } catch (cause) {
    if (seq !== request || disposed) return
    rows.value = []
    total.value = 0
    error.value = (cause as Error)?.message || '问题列表加载失败，请重试'
  } finally {
    if (seq === request && !disposed) loading.value = false
  }
}
watch(() => [route.query.issueState, route.query.issueKeyword, route.query.issueTimeStart, route.query.issueTimeEnd, route.query.issuePage, route.query.issueSize], () => { readRoute(); void load() }, { immediate: true })
function search() {
  if (form.startDate && form.endDate && form.startDate > form.endDate) {
    ElMessage.warning('开始日期不能晚于结束日期')
    return
  }
  void setQuery(queryFromForm(1, filters.size))
}
function reset() {
  Object.assign(form, { keyword: '', state: '', startDate: '', endDate: '' })
  search()
}
function today() {
  form.startDate = localDate()
  form.endDate = form.startDate
  search()
}
async function handle(issue: SourceIssue) {
  if (issue.state === 1 || handling.value.has(issue.id)) return
  handling.value.add(issue.id)
  try {
    await sourceIssueApi.handle(issue.id)
    if (disposed) return
    ElMessage.success('已标记为已处理（前端演示）')
    await load()
  } catch (cause) {
    if (!disposed) ElMessage.error((cause as Error)?.message || '处理失败，请重试')
  } finally { handling.value.delete(issue.id) }
}
function openDetail(issue: SourceIssue) {
  detailId.value = issue.id
  detailOpen.value = true
}
function openSource(issue: SourceIssue) {
  const back = router.resolve({ path: '/monitor', query: { ...route.query, tab: 'sourceIssues' } }).fullPath
  void router.push({ path: '/canvas', query: { sourceId: issue.sourceId, siteId: issue.siteId || undefined, view: 'overview', sourceIssueReturn: back } })
}
</script>

<template>
  <section class="si-shell" data-testid="source-issues-view">
    <el-alert v-if="sourceIssueApi.preview" class="si-preview" title="前端演示：当前为示例台账，记录仅在本次页面会话内保留，尚未接入共享台账。" type="info" :closable="false" show-icon />
    <form class="si-filters" @submit.prevent="search">
      <el-input v-model="form.keyword" class="si-keyword" placeholder="问题描述 / 源名称 / 源 ID" aria-label="问题关键词" clearable data-testid="source-issues-keyword" />
      <label class="si-field"><span>状态</span><el-select v-model="form.state" aria-label="问题状态" data-testid="source-issues-state"><el-option label="全部" value="" /><el-option label="待处理" :value="0" /><el-option label="已处理" :value="1" /></el-select></label>
      <label class="si-field si-date"><span>登记时间</span><el-date-picker v-model="form.startDate" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" placeholder="开始日期" aria-label="登记开始日期" data-testid="source-issues-start" /><span>至</span><el-date-picker v-model="form.endDate" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" placeholder="结束日期" aria-label="登记结束日期" data-testid="source-issues-end" /></label>
      <el-button link type="primary" @click="today">今天</el-button>
      <el-button type="primary" native-type="submit" data-testid="source-issues-search">查询</el-button>
      <el-button data-testid="source-issues-reset" @click="reset">重置</el-button>
      <el-button class="si-refresh" :icon="Refresh" :loading="loading" aria-label="刷新问题列表" title="刷新问题列表" data-testid="source-issues-refresh" @click="load" />
    </form>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon data-testid="source-issues-error"><el-button link type="primary" @click="load">重新加载</el-button></el-alert>
    <el-table v-loading="loading" :data="rows" row-key="id" class="si-table" :empty-text="error ? '问题列表加载失败' : '暂无符合条件的问题'" data-testid="source-issues-table">
      <el-table-column label="问题描述" min-width="250"><template #default="{ row }"><button class="si-description" type="button" :title="row.description" @click="openDetail(row)">{{ row.description }}</button></template></el-table-column>
      <el-table-column label="关联源" min-width="205"><template #default="{ row }"><button class="si-source" type="button" :data-testid="`source-issue-source-${row.id}`" @click="openSource(row)">{{ row.sourceName }}</button><small class="si-caption">{{ row.sourceId }}<template v-if="row.siteName"> · {{ row.siteName }}</template></small></template></el-table-column>
      <el-table-column prop="createdBy" label="登记人" width="90" />
      <el-table-column label="登记时间" width="165"><template #default="{ row }">{{ localDateTime(row.createTime) }}</template></el-table-column>
      <el-table-column label="状态" width="95"><template #default="{ row }"><el-tag :type="row.state === 0 ? 'warning' : 'success'" size="small" effect="light">{{ row.state === 0 ? '待处理' : '已处理' }}</el-tag></template></el-table-column>
      <el-table-column label="操作" width="150"><template #default="{ row }"><div class="si-row-actions"><el-button link type="primary" @click="openDetail(row)">详情</el-button><el-button v-if="row.state === 0" link type="primary" :loading="handling.has(row.id)" :disabled="loading" :data-testid="`source-issue-handle-${row.id}`" @click="handle(row)">标记已处理</el-button></div></template></el-table-column>
    </el-table>
    <div class="si-pager"><el-pagination :current-page="filters.page" :page-size="filters.size" :total="total" :page-sizes="[20, 40, 100]" layout="total, sizes, prev, pager, next, jumper" background small data-testid="source-issues-pagination" @current-change="setQuery({ ...filters, page: $event })" @size-change="setQuery({ ...filters, page: 1, size: $event })" /></div>
    <SourceIssueDrawer v-if="detailOpen" v-model="detailOpen" :issue-id="detailId" @handled="load" @open-source="openSource" />
  </section>
</template>

<style scoped>
.si-shell { padding: 12px; border: 1px solid var(--rc-border); border-radius: var(--rc-radius, 8px); background: var(--rc-surface); }
.si-preview { margin-bottom: 14px; }
.si-filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.si-keyword { width: 260px; }
.si-field { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; color: var(--rc-text-2); font-size: 13px; }
.si-field :deep(.el-select) { width: 110px; }
.si-date :deep(.el-date-editor.el-input) { width: 145px; }
.si-filters :deep(.el-button + .el-button) { margin-left: 0; }
.si-refresh { width: 32px; padding: 0; }
.si-table { font-size: 12px; }
.si-table :deep(th.el-table__cell) { background: var(--rc-bg); color: var(--rc-text-2); }
.si-description, .si-source { display: block; padding: 0; border: 0; background: transparent; font: inherit; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
.si-description { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--rc-text); line-height: 1.7; }
.si-source { color: var(--rc-primary); }
.si-description:hover { color: var(--rc-primary); }
.si-caption { display: block; margin-top: 4px; color: var(--rc-muted); font-size: 11px; }
.si-row-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.si-row-actions :deep(.el-button + .el-button) { margin-left: 0; }
.si-pager { display: flex; justify-content: flex-end; margin-top: 16px; }
@media (max-width: 760px) { .si-shell { padding: 12px; } .si-keyword { width: 100%; } .si-date { flex-wrap: wrap; } .si-pager { overflow-x: auto; } }
</style>