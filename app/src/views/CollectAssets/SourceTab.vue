<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Grid, List, Refresh, Edit, Operation } from '@element-plus/icons-vue'
import { sourceApi, siteApi, type Source, type Site, type SourceCategory } from '../../api'
import { useUiStore } from '../../stores/ui'
import SiteCardGrid from './SiteCardGrid.vue'
import { siteIcon } from '@/utils/visual/siteVisual'

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

// ---- 加载 ----
// 排序交给 sitePaged 的 sort 参数在分页前做（0710 修复：原 applySort 只对当前页排序，跨页顺序错）
async function loadList() {
  loading.value = true
  try {
    const res = await siteApi.sitePaged({
      category: categoryFilter.value,
      keyword: keyword.value,
      tag: tagFilter.value,
      state: stateFilter.value,
      sort: sortBy.value,
      page: page.value,
      size: size.value,
    })
    sites.value = res.list
    total.value = res.total
    expanded.value = new Set()
  } catch {
    ElMessage.warning('加载网站列表失败')
    sites.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}
async function loadCategories() {
  try {
    categories.value = await sourceApi.sourceCategories()
  } catch {
    ElMessage.warning('加载分类失败')
    categories.value = []
  }
}
async function loadStats() {
  try {
    Object.assign(stats, await sourceApi.sourceStats())
  } catch {
    ElMessage.warning('加载统计失败')
  }
}
async function loadTagOptions() {
  try {
    const res = await siteApi.sitePaged({ size: 999 })
    const set = new Set<string>()
    res.list.forEach((s) => (s.tags ?? []).forEach((t) => set.add(t)))
    allTags.value = [...set].sort()
  } catch {
    ElMessage.warning('加载标签选项失败')
    allTags.value = []
  }
}

function resetAndLoad() {
  page.value = 1
  selectedIds.value = []
  loadList()
}
async function refreshAll() {
  await Promise.all([loadList(), loadStats()])
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
function onTableExpandCommand(cmd: string) {
  if (cmd === 'expand') expandAll()
  if (cmd === 'collapse') collapseAll()
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
const siteCheckMap = computed(() => {
  const map = new Map<string, { checked: boolean; indeterminate: boolean }>()
  for (const site of sites.value) {
    map.set(site.siteId, siteCheckState(site.siteId))
  }
  return map
})
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
// 显式返回类型（0714 review M3 顺手清理）：el-tag 的 type 字段期望有限 union，
// 收紧后模板 `:type="statusMeta(s).type"` 不用再 `as any` 兜底
function statusMeta(s: Source): { type: 'info' | 'success' | 'danger' | 'primary'; text: string } {
  if (s.disabled) return { type: 'info', text: '已停用' }
  if (s.state === 'C') return { type: 'success', text: '成功' }
  if (s.state === 'E') return { type: 'danger', text: '出错' }
  if (s.state === 'L') return { type: 'primary', text: '运行中' }
  return { type: 'info', text: '未知' }
}
// 页签网站化（0710 会议 B3）：入口只推路由，页签注册统一收口在画布加载（index.vue）——
// 点子源名会落到所属网站页签并在侧栏定位到该子源，无 siteId 的历史草稿源仍开独立页签
function openSourceCanvas(s: Source, view?: 'data' | 'task') {
  router.push({ path: '/canvas', query: { sourceId: s.sourceId, ...(view ? { view } : {}) } })
}
function openSourceData(s: Source) {
  openSourceCanvas(s, 'data')
}
// 网站行名称进入统一流程；编辑入口只维护网站的名称、分类和负责人。
function openSiteCanvas(site: Site, view?: 'data') {
  router.push({ path: '/canvas', query: { siteId: site.siteId, ...(view ? { view } : {}) } })
}
function openSiteData(site: Site) {
  router.push({ path: '/canvas', query: { siteId: site.siteId, view: 'data' } })
}
const siteCategoryOptions = computed(() => categories.value.flatMap((group) => [
  { path: group.id, label: group.name },
  ...(group.children ?? []).map((child) => ({ path: child.id, label: `${group.name} / ${child.name}` })),
]))
const siteEditor = reactive<{ visible: boolean; saving: boolean; site: Site | null }>({ visible: false, saving: false, site: null })
const siteForm = reactive({ siteId: '', name: '', categoryPath: '', owner: '' })
function openSiteEditor(site: Site) {
  Object.assign(siteForm, {
    siteId: site.siteId,
    name: site.name,
    categoryPath: site.categoryPath ?? '',
    owner: site.owner,
  })
  siteEditor.site = site
  siteEditor.visible = true
}
async function saveSiteEditor() {
  const category = siteForm.categoryPath.split('/').filter(Boolean)[0]
  if (!siteForm.name.trim() || !category) {
    ElMessage.warning('请填写网站名称和分类')
    return
  }
  siteEditor.saving = true
  try {
    const res = await siteApi.siteUpdate({
      siteId: siteForm.siteId,
      name: siteForm.name,
      category,
      categoryPath: siteForm.categoryPath,
      owner: siteForm.owner,
    })
    if (!res?.ok) throw new Error(res?.message)
    ElMessage.success(res.message || '网站基本信息已保存')
    siteEditor.visible = false
    siteEditor.site = null
    await Promise.all([loadList(), loadTagOptions()])
  } catch (error) {
    ElMessage.warning(error instanceof Error ? error.message : '保存网站基本信息失败')
  } finally {
    siteEditor.saving = false
  }
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

// ---- 子源行内操作（0710 会议 A3）：只留发抓取 + 停用/启用，复制派生/记录已按会议结论移除 ----
function onRowSnatch(s: Source) {
  confirmDanger('发抓取', `将向子源「${s.name}」下发抓取任务，是否继续？`, () => sourceApi.sendSnatch([s.sourceId]))
}
function onRowToggle(s: Source) {
  const willDisable = !s.disabled
  confirmDanger(willDisable ? '停用子源' : '启用子源', `确认${willDisable ? '停用' : '启用'}子源「${s.name}」？`, async () => {
    const res = await sourceApi.changeSourceEnable(s.sourceId, willDisable)
    if (res?.ok) {
      s.disabled = willDisable
      loadStats()
    }
    return res
  })
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
  // 0707 Review #1/#2 修复：
  // - success：改走专用端点 changeToSuccess（此前误用 changeSourceEnable 把源禁用）；
  // - enable/disable：changeSourceEnable 是单源签名、无批量端点，前端循环调（此前只传 selectedIds[0] 漏掉其余选中源）；
  // - schedule/modify：已是数组端点，保持原样。
  if (cmd === 'success' || cmd === 'enable' || cmd === 'disable') {
    return confirmDanger(`${map[cmd]}（${selectedIds.value.length} 个源）`, `确认对选中源执行「${map[cmd]}」？`, async () => {
      let failed = 0
      for (const id of selectedIds.value) {
        const r = cmd === 'success'
          ? await sourceApi.changeToSuccess(id)
          : await sourceApi.changeSourceEnable(id, cmd !== 'enable')
        if (!r?.ok) failed++
      }
      await loadList()
      await loadStats()
      return failed
        ? { message: `已处理 ${selectedIds.value.length - failed} 个、失败 ${failed} 个（演示）` }
        : { message: `已对 ${selectedIds.value.length} 个源执行「${map[cmd]}」（演示）` }
    })
  }
  confirmDanger(`${map[cmd]}（${selectedIds.value.length} 个源）`, `确认对选中源执行「${map[cmd]}」？`, () =>
    cmd === 'modify'
      ? sourceApi.batchModifyConfig(selectedIds.value, '-')
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
        placeholder="搜索网站名 / 子源名 / 责任人"
        class="ca-search"
        @input="onKeywordInput"
      />
      <el-select v-model="categoryFilter" placeholder="全部分类" style="width: 150px" clearable @change="resetAndLoad">
        <el-option label="全部分类" value="" />
        <template v-for="g in categories" :key="g.id">
          <el-option :label="`${g.name}（${g.count}）`" :value="g.id" />
          <el-option v-for="c in g.children" :key="c.id" :label="`　└ ${c.name}（${c.count}）`" :value="c.id" />
        </template>
      </el-select>
      <el-select v-model="tagFilter" placeholder="全部标签" style="width: 130px" clearable @change="resetAndLoad">
        <el-option label="全部标签" value="" />
        <el-option v-for="t in allTags" :key="t" :label="t" :value="t" />
      </el-select>
      <el-select v-model="stateFilter" placeholder="全部状态" style="width: 130px" clearable @change="resetAndLoad">
        <el-option label="全部状态" value="all" />
        <el-option label="有异常子源" value="error" />
      </el-select>
      <el-select v-model="sortBy" style="width: 120px" @change="loadList">
        <el-option label="最近修改" value="updated" />
        <el-option label="名称" value="name" />
      </el-select>
      <el-button v-if="hasFilter" text class="ca-clear-filter" @click="clearFilters">清空</el-button>
      <div class="ca-stats">
        <el-tag type="info" effect="plain" class="stat-tag">网站 <b>{{ total }}</b></el-tag>
        <el-tag type="info" effect="plain" class="stat-tag">源 <b>{{ stats.total }}</b></el-tag>
        <el-tag v-if="stats.error > 0" type="danger" class="stat-tag">异常 <b>{{ stats.error }}</b></el-tag>
        <el-tag v-if="stats.externalChanged > 0" type="warning" class="stat-tag">待确认 <b>{{ stats.externalChanged }}</b></el-tag>
        <el-tag v-if="stats.disabled > 0" type="info" effect="plain" class="stat-tag">停用 <b>{{ stats.disabled }}</b></el-tag>
      </div>
      <span class="ca-spacer" />
      <div class="ca-view-toggle">
        <button class="ca-view-btn" :class="{ active: view === 'card' }" type="button" title="卡片视图" @click="setView('card')"><el-icon :size="14"><Grid /></el-icon>卡片</button>
        <button class="ca-view-btn" :class="{ active: view === 'table' }" type="button" title="表格视图" @click="setView('table')"><el-icon :size="14"><List /></el-icon>表格</button>
      </div>
      <button class="ca-refresh" type="button" title="刷新" @click="refreshAll"><el-icon :size="14"><Refresh /></el-icon></button>
    </div>

    <!-- 批量工具条（选中时出现，仅表格视图会产生选中） -->
    <transition name="slide-up">
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
    </transition>

    <!-- 卡片视图 -->
    <div v-if="view === 'card'" v-loading="loading" class="ca-card-body">
      <SiteCardGrid :sites="sites" />
    </div>

    <!-- 表格视图：网站行带聚合列，展开后子源行；勾选作用到子源级 -->
    <div v-else v-loading="loading" class="rc-card ca-table-card">
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
              <th style="width: 104px">数据量</th>
              <th style="width: 88px">责任人</th>
              <th style="width: 140px">最近修改</th>
              <th style="width: 110px">
                <div class="ca-th-actions">
                  <span>操作</span>
                  <el-dropdown trigger="click" @command="onTableExpandCommand">
                    <button class="ca-expand-menu" type="button" title="展开/收起" aria-label="展开/收起"><el-icon :size="14"><Operation /></el-icon></button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="expand">展开全部</el-dropdown-item>
                        <el-dropdown-item command="collapse">收起全部</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </th>
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
                    :model-value="siteCheckMap.get(site.siteId)?.checked"
                    :indeterminate="siteCheckMap.get(site.siteId)?.indeterminate"
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
                  <button class="ca-count-link" type="button" title="查看该网站全部子源数据" @click="openSiteData(site)">
                    {{ (site.dataCount ?? 0).toLocaleString() }} 条
                  </button>
                </td>
                <td><div class="ca-cell-main">{{ site.owner }}</div></td>
                <td><div class="ca-cell-main soft">{{ site.updatedAt || '—' }}</div></td>
                <td>
                  <div class="ca-site-ops">
                    <button class="ca-op-btn" type="button" title="编辑网站基本信息" @click="openSiteEditor(site)"><el-icon :size="14"><Edit /></el-icon></button>
                  </div>
                </td>
              </tr>
              <template v-if="expanded.has(site.siteId)">
                <tr v-if="childrenLoading[site.siteId]"><td colspan="8" class="ca-empty-row">加载中…</td></tr>
                <tr v-else-if="!(childrenCache[site.siteId] ?? []).length"><td colspan="8" class="ca-empty-row">该网站暂无子源</td></tr>
                <tr v-for="s in (childrenCache[site.siteId] ?? [])" :key="s.sourceId" class="ca-child-row" :class="{ active: selectedIds.includes(s.sourceId) }">
                  <td></td>
                  <td><el-checkbox :model-value="selectedIds.includes(s.sourceId)" @change="toggleRow(s.sourceId)" /></td>
                  <td>
                    <div class="ca-src">
                      <button class="ca-src-name" type="button" @click="openSourceCanvas(s)">{{ s.name }}</button>
                      <el-tag size="small" :type="statusMeta(s).type" effect="light">{{ statusMeta(s).text }}</el-tag>
                      <el-tag v-if="s.alarm" size="small" type="warning" effect="dark">告警</el-tag>
                      <el-tag v-if="s.externalChanged" size="small" type="warning" effect="light">外部变更</el-tag>
                    </div>
                    <div class="ca-cell-sub">{{ s.sourceId }} · {{ s.url }}</div>
                  </td>
                  <td><div class="ca-cell-main">{{ s.cycle || '—' }}</div></td>
                  <td>
                    <button class="ca-count-link" type="button" @click="openSourceData(s)">
                      {{ (s.dataCount ?? 0).toLocaleString() }} 条
                    </button>
                  </td>
                  <td><div class="ca-cell-main">{{ s.owner }}</div></td>
                  <td><div class="ca-cell-main soft">{{ s.updatedAt || s.lastTaskAt?.slice(0, 16) || '—' }}</div></td>
                  <td>
                    <el-button link type="primary" size="small" @click="onRowSnatch(s)">发抓取</el-button>
                    <el-button link :type="s.disabled ? 'primary' : 'danger'" size="small" @click="onRowToggle(s)">
                      {{ s.disabled ? '启用' : '停用' }}
                    </el-button>
                  </td>
                </tr>
              </template>
            </template>
          </tbody>
        </table>

        <!-- 空态 -->
        <div v-if="!loading && !sites.length" class="ca-empty">
          <div class="ca-empty-title">没有匹配的网站</div>
          <div class="muted">调整筛选条件，或返回全部网站；批量导入子源请进入具体网站详情操作。</div>
          <div class="ca-empty-actions">
            <button class="rc-btn" type="button" @click="clearFilters">清空筛选 / 返回全部网站</button>
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

    <el-dialog v-model="siteEditor.visible" class="ca-site-editor" title="编辑网站基本信息" width="520px" align-center destroy-on-close @closed="siteEditor.site = null">
      <div v-if="siteEditor.site" class="ca-site-summary">
        <span>网站 ID：<b>{{ siteEditor.site.siteId }}</b></span><span>子源：<b>{{ siteEditor.site.sourceCount }}</b></span><span>数据量：<b>{{ (siteEditor.site.dataCount ?? 0).toLocaleString() }} 条</b></span>
      </div>
      <el-form class="ca-site-form" label-position="top">
        <el-form-item label="网站名称" required><el-input v-model="siteForm.name" placeholder="请输入网站名称" /></el-form-item>
        <el-form-item label="所属分类" required>
          <el-select v-model="siteForm.categoryPath" filterable placeholder="请选择分类" style="width: 100%"><el-option v-for="option in siteCategoryOptions" :key="option.path" :label="option.label" :value="option.path" /></el-select>
        </el-form-item>
        <el-form-item label="网站负责人"><el-input v-model="siteForm.owner" placeholder="用于网站默认归属，不会批量覆盖子源负责人" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="siteEditor.visible = false">取消</el-button><el-button type="primary" :loading="siteEditor.saving" @click="saveSiteEditor">保存</el-button></template>
    </el-dialog>
  </div>
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
  gap: 8px;
  min-width: 0;
  white-space: nowrap;
}
.stat-tag { font-size: 12px; }
.stat-tag b { font-weight: 800; font-size: 13px; margin-left: 3px; }
.ca-spacer { flex: 1; min-width: 12px; }

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
.ca-table th { white-space: nowrap; }
.ca-th-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.ca-expand-menu {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--rc-border);
  border-radius: 6px;
  background: #fff;
  color: var(--rc-text-2);
  cursor: pointer;
}
.ca-expand-menu:hover { border-color: #bfdbfe; color: var(--rc-primary-ink); background: #f8fbff; }
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
.ca-site-ops { display: flex; gap: 4px; }
.ca-site-summary { display: flex; gap: 14px; margin-bottom: 18px; color: var(--rc-faint); font-size: 12px; }.ca-site-summary b { color: var(--rc-text-2); font-weight: 600; }.ca-site-form :deep(.el-form-item) { margin-bottom: 16px; }.ca-site-form :deep(.el-form-item__label) { padding-bottom: 5px; color: var(--rc-text-2); font-size: 12px; line-height: 1.2; }.ca-site-form :deep(.el-input__wrapper), .ca-site-form :deep(.el-select__wrapper) { min-height: 34px; border-radius: 6px; box-shadow: 0 0 0 1px var(--rc-border) inset; }
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

/* ---- 动画过渡 ---- */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
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

@media (max-width: 1240px) {
  .ca-toolbar { flex-wrap: wrap; }
  .ca-search { flex: 1 1 260px; width: auto; }
  .ca-select { flex: 1 1 116px; width: auto; }
  .ca-stats { order: 2; flex: 1 1 100%; }
  .ca-stats span:first-child { padding-left: 0; }
}
</style>
