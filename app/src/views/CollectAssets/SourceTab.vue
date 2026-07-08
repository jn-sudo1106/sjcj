<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Grid, List, Refresh, Edit, CopyDocument } from '@element-plus/icons-vue'
import { sourceApi, siteApi, type Source, type Site, type SourceCategory, type SourceLog, type TaskInst } from '../../api'
import { useUiStore } from '../../stores/ui'
import { useWorkspaceStore, MAX_SOURCE_TABS } from '../../stores/workspace'
import SiteCardGrid from './SiteCardGrid.vue'
import { siteIcon } from './siteVisual'

const ui = useUiStore()
const route = useRoute()
const router = useRouter()

// 总览页下钻：?state=E / external / disabled 预置筛选（0707 优化·Phase3：网站粒度收窄为 all/error）
const VALID_STATES = ['all', 'error']

// ---- 分类 / 标签 / 统计 ----
const categories = ref<SourceCategory[]>([])
const allTags = ref<string[]>([])
const stats = reactive({ total: 0, error: 0, externalChanged: 0, disabled: 0 })

// ---- 筛选（Dify 式一排：分类 / 标签 / 状态 / 排序 / 搜索，0707 优化·Phase3） ----
const keyword = ref('')
const categoryFilter = ref('')
const tagFilter = ref('')
const stateFilter = ref('all')
const sortBy = ref<'updated' | 'name'>('updated')

// ---- 网站列表 / 分页 ----
const sites = ref<Site[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(10)
const loading = ref(false)

// ---- 表格视图：树形展开子源，勾选作用于子源级 ----
const expanded = ref<Set<string>>(new Set())
const childrenCache = reactive<Record<string, Source[]>>({})
const childrenLoading = reactive<Record<string, boolean>>({})
const selectedIds = ref<string[]>([])

// ---- 日志 / 任务 / 批量导入弹窗 ----
const logDlg = reactive<{ visible: boolean; rows: SourceLog[]; name: string }>({ visible: false, rows: [], name: '' })
const taskDlg = reactive<{ visible: boolean; rows: TaskInst[]; name: string }>({ visible: false, rows: [], name: '' })
const importDlg = reactive({ visible: false, template: '', deep: false, dir: '', lines: '' })

// ---- 加载 ----
function applySort(list: Site[]): Site[] {
  const arr = [...list]
  if (sortBy.value === 'name') arr.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  else arr.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  return arr
}
async function loadList() {
  loading.value = true
  try {
    const res = await siteApi.sitePaged({
      category: categoryFilter.value,
      keyword: keyword.value,
      tag: tagFilter.value,
      state: stateFilter.value,
      page: page.value,
      size: size.value,
    })
    sites.value = applySort(res.list)
    total.value = res.total
    expanded.value = new Set()
  } finally {
    loading.value = false
  }
}
async function loadCategories() {
  categories.value = await sourceApi.sourceCategories()
}
async function loadStats() {
  Object.assign(stats, await sourceApi.sourceStats())
}
async function loadTagOptions() {
  const res = await siteApi.sitePaged({ size: 999 })
  const set = new Set<string>()
  res.list.forEach((s) => (s.tags ?? []).forEach((t) => set.add(t)))
  allTags.value = [...set].sort()
}

function resetAndLoad() {
  page.value = 1
  selectedIds.value = []
  loadList()
}
function refreshAll() {
  loadList()
  loadStats()
}

let kwTimer: ReturnType<typeof setTimeout> | undefined
function onKeywordInput() {
  clearTimeout(kwTimer)
  kwTimer = setTimeout(resetAndLoad, 300)
}

function onSizeChange() {
  page.value = 1
  loadList()
}

// ---- 筛选辅助 ----
const hasFilter = computed(
  () => !!categoryFilter.value || !!keyword.value || !!tagFilter.value || stateFilter.value !== 'all',
)
function clearFilters() {
  categoryFilter.value = ''
  keyword.value = ''
  tagFilter.value = ''
  stateFilter.value = 'all'
  resetAndLoad()
}

// ---- 视图偏好：卡片（默认）/ 表格（0707 优化·Phase3） ----
const view = computed(() => ui.assetView)
function setView(v: 'card' | 'table') {
  ui.setAssetView(v)
}

// ---- 表格：展开 / 懒加载子源 ----
async function ensureChildren(siteId: string) {
  if (childrenCache[siteId] || childrenLoading[siteId]) return
  childrenLoading[siteId] = true
  try {
    childrenCache[siteId] = await siteApi.siteSources(siteId)
  } finally {
    childrenLoading[siteId] = false
  }
}
async function toggleExpand(siteId: string) {
  const next = new Set(expanded.value)
  if (next.has(siteId)) next.delete(siteId)
  else {
    next.add(siteId)
    await ensureChildren(siteId)
  }
  expanded.value = next
}
function expandAll() {
  sites.value.forEach((s) => ensureChildren(s.siteId))
  expanded.value = new Set(sites.value.map((s) => s.siteId))
}
function collapseAll() {
  expanded.value = new Set()
}

// ---- 多选（子源级；网站行 checkbox = 该站全部子源，未展开也可选，先懒加载再勾） ----
const visibleChildren = computed<Source[]>(() =>
  sites.value.flatMap((s) => (expanded.value.has(s.siteId) ? (childrenCache[s.siteId] ?? []) : [])),
)
const allChecked = computed(
  () => visibleChildren.value.length > 0 && visibleChildren.value.every((c) => selectedIds.value.includes(c.sourceId)),
)
const indeterminate = computed(
  () => !allChecked.value && visibleChildren.value.some((c) => selectedIds.value.includes(c.sourceId)),
)
function toggleAll(v: boolean | string | number) {
  const ids = visibleChildren.value.map((c) => c.sourceId)
  selectedIds.value = v ? [...new Set([...selectedIds.value, ...ids])] : selectedIds.value.filter((id) => !ids.includes(id))
}
function toggleRow(id: string) {
  const i = selectedIds.value.indexOf(id)
  if (i >= 0) selectedIds.value.splice(i, 1)
  else selectedIds.value.push(id)
}
function siteCheckState(siteId: string): { checked: boolean; indeterminate: boolean } {
  const ids = (childrenCache[siteId] ?? []).map((c) => c.sourceId)
  if (!ids.length) return { checked: false, indeterminate: false }
  const hit = ids.filter((id) => selectedIds.value.includes(id)).length
  return { checked: hit === ids.length, indeterminate: hit > 0 && hit < ids.length }
}
async function toggleSite(siteId: string) {
  await ensureChildren(siteId)
  const ids = (childrenCache[siteId] ?? []).map((c) => c.sourceId)
  if (!ids.length) return
  const allIn = ids.every((id) => selectedIds.value.includes(id))
  selectedIds.value = allIn
    ? selectedIds.value.filter((id) => !ids.includes(id))
    : [...new Set([...selectedIds.value, ...ids])]
}

// ---- 展示辅助 ----
function statusMeta(s: Source) {
  if (s.disabled) return { cls: 'muted', text: '已停用' }
  if (s.state === 'C') return { cls: 'ok', text: '成功' }
  if (s.state === 'E') return { cls: 'err', text: '出错' }
  if (s.state === 'L') return { cls: 'run', text: '运行中' }
  return { cls: 'muted', text: '未知' }
}
// 站级同步状态（0707 表格样式）：无异常=成功；部分异常=部分成功；全异常=失败
function siteSync(site: Site): { cls: string; text: string } {
  if (!site.sourceCount) return { cls: 'muted', text: '—' }
  if (site.errorCount === 0) return { cls: 'ok', text: '成功' }
  if (site.errorCount < site.sourceCount) return { cls: 'warn', text: '部分成功' }
  return { cls: 'err', text: '失败' }
}
function openSourceCanvas(s: Source, view?: 'data' | 'task') {
  // 源详情多页签（0701 问题三）：入口先登记页签（已开则激活），超限提示先关闭
  const ws = useWorkspaceStore()
  if (!ws.open(s.sourceId, s.name)) {
    ElMessage.warning(`最多同时打开 ${MAX_SOURCE_TABS} 个源页签，请先关闭部分页签`)
    return
  }
  const snap = ws.snapshotOf(s.sourceId)
  const targetView = view ?? (snap?.view === 'data' || snap?.view === 'task' ? snap.view : undefined)
  router.push({ path: '/canvas', query: { sourceId: s.sourceId, ...(targetView ? { view: targetView } : {}) } })
}
function openSourceData(s: Source) {
  openSourceCanvas(s, 'data')
}
// 网站行「编辑」→ 进入网站统一流程模板画布（0707 优化·Phase4）
function openSiteCanvas(site: Site, view?: 'data') {
  const ws = useWorkspaceStore()
  if (!ws.open(`site:${site.siteId}`, site.name)) {
    ElMessage.warning(`最多同时打开 ${MAX_SOURCE_TABS} 个源页签，请先关闭部分页签`)
    return
  }
  router.push({ path: '/canvas', query: { siteId: site.siteId, ...(view ? { view } : {}) } })
}
function openSiteData(site: Site) {
  router.push({ path: '/canvas', query: { siteId: site.siteId, view: 'data' } })
}
function copySitePlaceholder(site: Site) {
  ElMessage.info(`复制网站「${site.name}」：可在「新建采集」中选择从现有网站复制`)
}

// ---- 写类 / 高危操作：统一二次确认占位 ----
async function confirmDanger(title: string, body: string, run: () => Promise<{ message?: string }>) {
  try {
    await ElMessageBox.confirm(body, title, {
      type: 'warning',
      confirmButtonText: '确认执行',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  const res = await run()
  ElMessage.success(res?.message || '操作已提交（演示）')
}

function onCopy(s: Source) {
  confirmDanger('复制派生源', `将基于「${s.name}」复制派生一个新源，是否继续？`, () => sourceApi.copySource(s.sourceId))
}

// ---- 行内「记录」下拉 ----
async function onRecord(cmd: string, s: Source) {
  if (cmd === 'log') {
    logDlg.name = s.name
    logDlg.rows = await sourceApi.sourceLogs(s.sourceId)
    logDlg.visible = true
    return
  }
  if (cmd === 'task') {
    taskDlg.name = s.name
    taskDlg.rows = await sourceApi.sourceTasks(s.sourceId)
    taskDlg.visible = true
    return
  }
  ElMessage.info('原始文件：演示环境占位')
}

// ---- 批量 ----
function requireSelection(): boolean {
  if (!selectedIds.value.length) {
    ElMessage.warning('请先在表格视图勾选网站或子源')
    return false
  }
  return true
}
function onBatchSnatch() {
  if (!requireSelection()) return
  confirmDanger('批量发任务', `将向选中的 ${selectedIds.value.length} 个源下发抓取任务，是否继续？`, () =>
    sourceApi.sendSnatch(selectedIds.value),
  )
}
function onBatchDelete() {
  if (!requireSelection()) return
  confirmDanger('批量删除（高危）', `将删除选中的 ${selectedIds.value.length} 个源，删除后不可恢复，是否继续？`, () =>
    sourceApi.deleteSource(selectedIds.value),
  )
}
function onOperate(cmd: string) {
  if (!requireSelection()) return
  const map: Record<string, string> = {
    success: '改为成功状态', enable: '启用', disable: '禁用', delete: '删除',
    schedule: '批量定时', modify: '批量改配置',
  }
  if (cmd === 'delete') return onBatchDelete()
  confirmDanger(`${map[cmd]}（${selectedIds.value.length} 个源）`, `确认对选中源执行「${map[cmd]}」？`, () =>
    cmd === 'modify'
      ? sourceApi.batchModifyConfig(selectedIds.value, '—')
      : cmd === 'schedule'
        ? sourceApi.batchSchedule(selectedIds.value)
        : sourceApi.changeSourceEnable(selectedIds.value[0], cmd !== 'enable'),
  )
}
function onMonitor(cmd: string) {
  if (!requireSelection()) return
  if (cmd.startsWith('freq')) {
    const tag = cmd.replace('freq-', '')
    return confirmDanger('频率标识', `将选中源频率标识设为「${tag}」？`, () => sourceApi.changeFreqTag(selectedIds.value, tag))
  }
  const verb = cmd === 'normal' ? '人工核验已正常' : '人工标为异常'
  confirmDanger(verb, `确认对选中源执行「${verb}」？`, () => sourceApi.markVerified(selectedIds.value, cmd))
}

function onBatchImport() {
  importDlg.visible = true
}
async function submitImport() {
  const res = await sourceApi.batchImport(importDlg.template, importDlg.lines)
  ElMessage.success(res?.message || '批量导入已提交（演示）')
  importDlg.visible = false
}

// 新建采集（0707 优化·Phase3）：跳画布新建闸门段，先填网站基础信息 + 首批子源再进流程编排。
function openNewFlowCanvas() {
  router.push({ path: '/canvas', query: { mode: 'new' } })
}

// ---- 顶部模块按钮接线 ----
onMounted(() => {
  const qs = String(route.query.state ?? '')
  if (VALID_STATES.includes(qs)) stateFilter.value = qs
  loadCategories()
  loadStats()
  loadTagOptions()
  loadList()
  ui.registerAction('新建采集', openNewFlowCanvas)
  ui.registerAction('批量导入', onBatchImport)
  ui.registerAction('批量操作', () => {
    if (requireSelection()) ElMessage.info('已选源可在列表上方批量工具条中操作')
  })
})
onUnmounted(() => ui.clearActions())
</script>

<template>
  <div class="ca-page">
    <!-- 顶部紧凑工具条：搜索 / 汇总 / 视图切换，降低首屏占用 -->
    <div class="ca-toolbar">
      <el-input
        v-model="keyword"
        :prefix-icon="Search"
        clearable
        placeholder="搜索网站名 / ID / 责任人"
        class="ca-search"
        @input="onKeywordInput"
      />
      <select v-model="categoryFilter" class="ca-select" @change="resetAndLoad">
        <option value="">全部分类</option>
        <template v-for="g in categories" :key="g.id">
          <option :value="g.id">{{ g.name }}（{{ g.count }}）</option>
          <option v-for="c in g.children" :key="c.id" :value="c.id">　└ {{ c.name }}（{{ c.count }}）</option>
        </template>
      </select>
      <select v-model="tagFilter" class="ca-select" @change="resetAndLoad">
        <option value="">全部标签</option>
        <option v-for="t in allTags" :key="t" :value="t">{{ t }}</option>
      </select>
      <select v-model="stateFilter" class="ca-select" @change="resetAndLoad">
        <option value="all">全部状态</option>
        <option value="error">有异常子源</option>
      </select>
      <select v-model="sortBy" class="ca-select" @change="loadList">
        <option value="updated">最近修改</option>
        <option value="name">名称</option>
      </select>
      <el-button v-if="hasFilter" text class="ca-clear-filter" @click="clearFilters">清空</el-button>
      <div class="ca-stats">
        <span>网站 <b>{{ total }}</b></span>
        <span>源 <b>{{ stats.total }}</b></span>
        <span>异常 <b class="danger">{{ stats.error }}</b></span>
        <span>待确认 <b class="warn">{{ stats.externalChanged }}</b></span>
        <span>停用 <b>{{ stats.disabled }}</b></span>
      </div>
      <span class="ca-spacer" />
      <div class="ca-view-toggle">
        <button class="ca-view-btn" :class="{ active: view === 'card' }" type="button" title="卡片视图" @click="setView('card')"><el-icon :size="14"><Grid /></el-icon>卡片</button>
        <button class="ca-view-btn" :class="{ active: view === 'table' }" type="button" title="表格视图" @click="setView('table')"><el-icon :size="14"><List /></el-icon>表格</button>
      </div>
      <span class="ca-count">共 {{ total }} 个网站</span>
      <button class="ca-refresh" type="button" title="刷新" @click="refreshAll"><el-icon :size="14"><Refresh /></el-icon></button>
    </div>

    <!-- 批量工具条（选中时出现，仅表格视图会产生选中） -->
    <div v-if="selectedIds.length" class="ca-batchbar">
      <span>已选 <b>{{ selectedIds.length }}</b> 个源</span>
      <button class="rc-btn" type="button" @click="onBatchSnatch">发抓取</button>
      <el-dropdown trigger="click" @command="onOperate">
        <button class="rc-btn" type="button">操作类 ▾</button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="success">改为成功状态</el-dropdown-item>
            <el-dropdown-item command="enable">启用</el-dropdown-item>
            <el-dropdown-item command="disable">禁用</el-dropdown-item>
            <el-dropdown-item command="schedule" divided>批量定时</el-dropdown-item>
            <el-dropdown-item command="modify">批量改配置</el-dropdown-item>
            <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-dropdown trigger="click" @command="onMonitor">
        <button class="rc-btn" type="button">监控类 ▾</button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="freq-日度">频率：日度</el-dropdown-item>
            <el-dropdown-item command="freq-周度">频率：周度</el-dropdown-item>
            <el-dropdown-item command="freq-月度">频率：月度</el-dropdown-item>
            <el-dropdown-item command="normal" divided>人工核验已正常</el-dropdown-item>
            <el-dropdown-item command="abnormal">人工标为异常</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <button class="rc-btn danger" type="button" @click="onBatchDelete">批量删除</button>
      <el-button text @click="selectedIds = []">清空选择</el-button>
    </div>

    <!-- 卡片视图 -->
    <div v-if="view === 'card'" v-loading="loading" class="ca-card-body">
      <SiteCardGrid :sites="sites" />
    </div>

    <!-- 表格视图：网站行带聚合列，展开后子源行；勾选作用到子源级 -->
    <div v-else v-loading="loading" class="rc-card ca-table-card">
      <div class="ca-table-ops">
        <el-button text size="small" @click="expandAll">展开全部</el-button>
        <el-button text size="small" @click="collapseAll">收起全部</el-button>
      </div>
      <div class="rc-table-scroll">
        <table class="rc-data-table ca-table">
          <thead>
            <tr>
              <th style="width: 30px"></th>
              <th style="width: 40px">
                <el-checkbox :model-value="allChecked" :indeterminate="indeterminate" @change="toggleAll" />
              </th>
              <th>源</th>
              <th style="width: 96px">定时</th>
              <th style="width: 150px">同步状态</th>
              <th style="width: 104px">数据量</th>
              <th style="width: 88px">责任人</th>
              <th style="width: 140px">最近修改</th>
              <th style="width: 110px">操作</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="site in sites" :key="site.siteId">
              <tr class="ca-site-row">
                <td>
                  <button class="ca-expand-btn" type="button" :class="{ open: expanded.has(site.siteId) }" @click="toggleExpand(site.siteId)">›</button>
                </td>
                <td>
                  <el-checkbox
                    :model-value="siteCheckState(site.siteId).checked"
                    :indeterminate="siteCheckState(site.siteId).indeterminate"
                    @change="toggleSite(site.siteId)"
                  />
                </td>
                <td>
                  <div class="ca-site-head">
                    <span class="ca-site-icon"><el-icon :size="14"><component :is="siteIcon(site)" /></el-icon></span>
                    <button class="ca-site-name" type="button" title="进入网站统一流程" @click="openSiteCanvas(site)">{{ site.name }}</button>
                    <span class="ca-site-cat">{{ site.categoryPath?.replace(/^\//, '').replaceAll('/', ' / ') || site.category }}</span>
                    <span v-if="site.errorCount > 0" class="ca-err-pill">● {{ site.errorCount }} 个异常</span>
                  </div>
                </td>
                <td>
                  <div class="ca-cell-main">{{ site.cycle || '—' }}</div>
                  <div class="ca-cell-sub">定时运行</div>
                </td>
                <td>
                  <div class="ca-cell-main"><span class="ca-sync-dot" :class="siteSync(site).cls" />{{ siteSync(site).text }}</div>
                  <div class="ca-cell-sub">{{ site.lastTaskAt?.slice(0, 16) || '—' }}</div>
                </td>
                <td>
                  <button class="ca-count-link" type="button" title="查看该网站全部子源数据" @click="openSiteData(site)">
                    {{ (site.dataCount ?? 0).toLocaleString() }} 条
                  </button>
                </td>
                <td><div class="ca-cell-main">{{ site.owner }}</div></td>
                <td><div class="ca-cell-main soft">{{ site.updatedAt || '—' }}</div></td>
                <td>
                  <div class="ca-site-ops">
                    <button class="ca-op-btn" type="button" title="编辑网站统一流程" @click="openSiteCanvas(site)"><el-icon :size="14"><Edit /></el-icon></button>
                    <button class="ca-op-btn" type="button" title="复制网站" @click="copySitePlaceholder(site)"><el-icon :size="14"><CopyDocument /></el-icon></button>
                  </div>
                </td>
              </tr>
              <template v-if="expanded.has(site.siteId)">
                <tr v-if="childrenLoading[site.siteId]"><td colspan="9" class="ca-empty-row">加载中…</td></tr>
                <tr v-else-if="!(childrenCache[site.siteId] ?? []).length"><td colspan="9" class="ca-empty-row">该网站暂无子源</td></tr>
                <tr v-for="s in (childrenCache[site.siteId] ?? [])" :key="s.sourceId" class="ca-child-row" :class="{ active: selectedIds.includes(s.sourceId) }">
                  <td></td>
                  <td><el-checkbox :model-value="selectedIds.includes(s.sourceId)" @change="toggleRow(s.sourceId)" /></td>
                  <td>
                    <div class="ca-src">
                      <button class="ca-src-name" type="button" @click="openSourceCanvas(s)">{{ s.name }}</button>
                      <span v-if="s.externalChanged" class="ca-flag">外部变更</span>
                    </div>
                    <div class="ca-cell-sub">{{ s.sourceId }} · {{ s.url }}</div>
                  </td>
                  <td><div class="ca-cell-main">{{ s.cycle || '—' }}</div></td>
                  <td>
                    <span class="rc-status" :class="statusMeta(s).cls">{{ statusMeta(s).text }}</span>
                    <span v-if="s.alarm" class="rc-status warn ca-alarm">告警</span>
                  </td>
                  <td>
                    <button class="ca-count-link" type="button" @click="openSourceData(s)">
                      {{ (s.dataCount ?? 0).toLocaleString() }} 条
                    </button>
                  </td>
                  <td><div class="ca-cell-main">{{ s.owner }}</div></td>
                  <td><div class="ca-cell-main soft">{{ s.updatedAt || s.lastTaskAt?.slice(0, 16) || '—' }}</div></td>
                  <td>
                    <el-dropdown trigger="click" @command="(c: string) => onRecord(c, s)">
                      <el-button link type="primary" size="small">记录 ▾</el-button>
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item command="log">运行日志</el-dropdown-item>
                          <el-dropdown-item command="task">任务实例</el-dropdown-item>
                          <el-dropdown-item command="file">原始文件</el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                    <el-button link type="primary" size="small" @click="onCopy(s)">复制源</el-button>
                  </td>
                </tr>
              </template>
            </template>
          </tbody>
        </table>

        <!-- 空态 -->
        <div v-if="!loading && !sites.length" class="ca-empty">
          <div class="ca-empty-title">没有匹配的网站</div>
          <div class="muted">调整筛选条件，或返回全部网站 / 批量导入模板源。</div>
          <div class="ca-empty-actions">
            <button class="rc-btn" type="button" @click="clearFilters">清空筛选 / 返回全部网站</button>
            <button class="rc-btn primary" type="button" @click="onBatchImport">批量导入</button>
          </div>
        </div>
      </div>
      <div class="ca-pager">
        <span class="ca-pager-total">共 {{ total }} 条</span>
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="size"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="sizes, prev, pager, next"
          background
          small
          @current-change="loadList"
          @size-change="onSizeChange"
        />
      </div>
    </div>

    <!-- 卡片视图分页（贴底右对齐，网站少时不显眼） -->
    <div v-if="view === 'card' && total > size" class="ca-pager card-mode">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="size"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        background
        small
        @current-change="loadList"
        @size-change="onSizeChange"
      />
    </div>
  </div>

  <!-- 源日志弹窗 -->
  <el-dialog v-model="logDlg.visible" :title="`源日志 · ${logDlg.name}`" width="640px">
    <table class="rc-data-table">
      <thead>
        <tr><th>动作 ID</th><th>动作</th><th>结果</th><th>备注</th><th>时间</th></tr>
      </thead>
      <tbody>
        <tr v-for="l in logDlg.rows" :key="l.logId">
          <td>{{ l.logId }}</td><td>{{ l.action }}</td>
          <td><span class="rc-status ok">{{ l.result }}</span></td>
          <td>{{ l.remark }}</td><td>{{ l.at }}</td>
        </tr>
      </tbody>
    </table>
  </el-dialog>

  <!-- 任务实例弹窗 -->
  <el-dialog v-model="taskDlg.visible" :title="`任务实例 · ${taskDlg.name}`" width="760px">
    <table class="rc-data-table">
      <thead>
        <tr><th>任务 ID</th><th>状态</th><th>类型</th><th>执行节点</th><th>主题</th><th>更新时间</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="t in taskDlg.rows" :key="t.taskId">
          <td>{{ t.taskId }}</td>
          <td><span class="rc-status" :class="statusMeta({ state: t.state } as Source).cls">{{ t.state }}</span></td>
          <td>{{ t.typeName }}</td><td>{{ t.node }}</td><td>{{ t.topic }}</td><td>{{ t.updatedAt }}</td>
          <td>
            <el-button link type="danger" size="small" @click="ElMessage.info('重发：演示环境占位，高危需审批')">重发</el-button>
          </td>
        </tr>
      </tbody>
    </table>
  </el-dialog>

  <!-- 模板源批量导入弹窗 -->
  <el-dialog v-model="importDlg.visible" title="批量导入（模板源）" width="640px">
    <el-form label-width="92px" label-position="right">
      <el-form-item label="模板源">
        <el-input v-model="importDlg.template" placeholder="301287174-004432-南方中证申万有色金属ETF联接A" />
      </el-form-item>
      <el-form-item label="深度复制">
        <el-switch v-model="importDlg.deep" />
        <span class="muted ca-imp-hint">如开启，则会自动为多行数据生成多个配置</span>
      </el-form-item>
      <el-form-item label="目标目录">
        <el-input v-model="importDlg.dir" placeholder="目录 ID / 目录名" />
      </el-form-item>
      <el-form-item label="名称;URL">
        <el-input v-model="importDlg.lines" type="textarea" :rows="5" placeholder="名称与 URL 分割符；例：名称;url" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="importDlg.visible = false">取消</el-button>
      <el-button type="primary" @click="submitImport">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ca-page { display: flex; flex-direction: column; gap: 12px; }

/* ---- 顶部紧凑工具条 ---- */
.ca-toolbar {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  padding: 8px 12px;
  background: #fff;
  border: 1px solid var(--rc-border);
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
}
.ca-search { width: 250px; flex: 0 0 250px; }
.ca-search :deep(.el-input__wrapper) { border-radius: 6px; min-height: 34px; box-shadow: 0 0 0 1px var(--rc-border) inset; }
.ca-search :deep(.el-input__wrapper:hover) { box-shadow: 0 0 0 1px #bfdbfe inset; }
.ca-stats {
  display: flex;
  align-items: center;
  gap: 0;
  min-width: 0;
  color: var(--rc-text-2);
  font-size: 13px;
  white-space: nowrap;
}
.ca-stats span {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  padding: 0 8px;
  border-left: 1px solid var(--rc-border-soft);
  line-height: 20px;
}
.ca-stats span:first-child { border-left: 0; }
.ca-stats b { color: var(--rc-text); font-size: 15px; font-weight: 800; }
.ca-stats b.danger { color: var(--rc-error); }
.ca-stats b.warn { color: #d97706; }
.ca-spacer { flex: 1; min-width: 12px; }
.ca-select {
  height: 34px;
  flex: 0 0 96px;
  width: 96px;
  border: 1px solid var(--rc-border);
  border-radius: 6px;
  background: #fff;
  color: var(--rc-text);
  font-size: 12px;
  padding: 0 10px;
  outline: none;
}
.ca-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.ca-clear-filter { flex: none; padding: 0 4px; height: 30px; font-size: 12px; }
.ca-view-toggle {
  display: inline-flex;
  gap: 0;
  padding: 2px;
  border: 1px solid var(--rc-border);
  border-radius: 7px;
  background: #f8fafc;
}
.ca-view-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 11px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--rc-text-2);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
}
.ca-view-btn:hover { color: var(--rc-primary-ink); }
.ca-view-btn.active { color: var(--rc-primary); font-weight: 700; background: #fff; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06); }
.ca-count { color: var(--rc-muted); font-size: 12px; white-space: nowrap; }
.ca-refresh {
  width: 34px;
  height: 34px;
  border: 1px solid var(--rc-border);
  border-radius: 6px;
  background: #fff;
  color: var(--rc-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.ca-refresh:hover { border-color: #bfdbfe; color: var(--rc-primary); }

/* ---- 批量工具条 ---- */
.ca-batchbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border: 1px solid #bfdbfe;
  border-radius: 10px;
  background: var(--rc-primary-bg);
  font-size: 13px;
  color: var(--rc-text-2);
}
.ca-batchbar b { color: var(--rc-primary-ink); }

/* ---- 卡片视图 ---- */
.ca-card-body { min-height: 200px; }

/* ---- 表格视图 ---- */
.ca-table-card { display: flex; flex-direction: column; overflow: hidden; }
.ca-table-ops { display: flex; gap: 2px; padding: 8px 12px 0; }
.ca-table th { white-space: nowrap; }
.ca-site-row td { padding-top: 12px; padding-bottom: 12px; border-top: 1px solid var(--rc-border-soft); }
.ca-child-row { background: #fbfdff; }
.ca-child-row td { padding-top: 8px; padding-bottom: 8px; }
.ca-expand-btn {
  border: 0;
  background: transparent;
  color: var(--rc-muted);
  font-size: 14px;
  cursor: pointer;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s, background 0.12s;
}
.ca-expand-btn:hover { background: #f1f5f9; color: var(--rc-text); }
.ca-expand-btn.open { transform: rotate(90deg); }
.ca-site-head { display: flex; align-items: center; gap: 9px; min-width: 0; }
.ca-site-icon {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: linear-gradient(135deg, #60a5fa, #2563eb);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ca-site-name {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--rc-text);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.ca-site-name:hover { color: var(--rc-primary-ink); text-decoration: underline; }
.ca-site-cat { color: var(--rc-faint); font-size: 11px; white-space: nowrap; }
.ca-err-pill {
  flex: none;
  font-size: 10px;
  font-weight: 600;
  color: var(--rc-error);
  background: #fef2f2;
  border-radius: 999px;
  padding: 2px 8px;
  white-space: nowrap;
}
.ca-cell-main { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--rc-text); white-space: nowrap; }
.ca-cell-main.soft { color: var(--rc-text-2); }
.ca-cell-sub { font-size: 10px; color: var(--rc-faint); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 320px; }
.ca-sync-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; }
.ca-sync-dot.ok { background: var(--rc-ok); }
.ca-sync-dot.warn { background: #f59e0b; }
.ca-sync-dot.err { background: var(--rc-error); }
.ca-sync-dot.muted { background: var(--rc-faint); }
.ca-site-ops { display: flex; gap: 4px; }
.ca-op-btn {
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--rc-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.ca-op-btn:hover { background: var(--rc-primary-bg); color: var(--rc-primary); }
.ca-empty-row { text-align: center; color: var(--rc-faint); font-size: 12px; padding: 14px; }

.ca-src { display: flex; align-items: center; gap: 8px; }
.ca-src-name {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--rc-primary-ink);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.ca-src-name:hover { text-decoration: underline; }
.ca-flag {
  flex: none;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--rc-warn-bg);
  color: var(--rc-warn);
  font-size: 11px;
  font-weight: 600;
}
.ca-alarm { margin-left: 6px; }
.ca-count-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--rc-primary-ink);
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.ca-count-link:hover { text-decoration: underline; }

.ca-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 56px 16px;
  text-align: center;
}
.ca-empty-title { color: var(--rc-text); font-size: 14px; font-weight: 700; }
.ca-empty-actions { display: flex; gap: 10px; margin-top: 10px; }

.ca-pager { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--rc-border-soft); }
.ca-pager.card-mode { border-top: 0; padding: 0; }
.ca-pager-total { margin-right: auto; color: var(--rc-muted); font-size: 12px; }
.ca-imp-hint { margin-left: 10px; font-size: 12px; }

@media (max-width: 1240px) {
  .ca-toolbar { flex-wrap: wrap; }
  .ca-search { flex: 1 1 260px; width: auto; }
  .ca-select { flex: 1 1 116px; width: auto; }
  .ca-stats { order: 2; flex: 1 1 100%; }
  .ca-stats span:first-child { padding-left: 0; }
}
</style>
