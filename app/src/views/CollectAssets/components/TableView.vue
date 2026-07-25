<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Edit, Operation } from '@element-plus/icons-vue'
import { siteApi, sourceApi, type Source, type Site } from '@/api'
import { siteIcon } from '@/utils/visual/siteVisual'

const props = defineProps<{
  sites: Site[]
  loading: boolean
  total: number
  page: number
  size: number
}>()

const emit = defineEmits<{
  'update:page': [value: number]
  'update:size': [value: number]
  'pageChange': []
  'sizeChange': []
  'openEditor': [site: Site]
}>()

const router = useRouter()

// 表格视图：树形展开子源，勾选作用于子源级
const expanded = ref<Set<string>>(new Set())
const childrenCache = reactive<Record<string, Source[]>>({})
const childrenLoading = reactive<Record<string, boolean>>({})
const selectedIds = ref<string[]>([])

// 表格：展开 / 懒加载子源
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
  props.sites.forEach((s) => ensureChildren(s.siteId))
  expanded.value = new Set(props.sites.map((s) => s.siteId))
}
function collapseAll() {
  expanded.value = new Set()
}
function onTableExpandCommand(cmd: string) {
  if (cmd === 'expand') expandAll()
  if (cmd === 'collapse') collapseAll()
}

// 多选
const visibleChildren = computed<Source[]>(() =>
  props.sites.flatMap((s) => (expanded.value.has(s.siteId) ? (childrenCache[s.siteId] ?? []) : [])),
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
  for (const site of props.sites) {
    map.set(site.siteId, siteCheckState(site.siteId))
  }
  return map
})
// 性能审查 P2-1：把 selectedIds 数组转 Set，让 siteCheckState 的 includes O(n) → O(1)
// 每次 selectedIds 变化才重新构造 Set（computed 缓存），原本每行 filter 都遍历 selectedIds
const selectedSet = computed(() => new Set(selectedIds.value))
function siteCheckState(siteId: string): { checked: boolean; indeterminate: boolean } {
  const ids = (childrenCache[siteId] ?? []).map((c) => c.sourceId)
  if (!ids.length) return { checked: false, indeterminate: false }
  const sel = selectedSet.value
  const hit = ids.filter((id) => sel.has(id)).length
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

// 展示辅助
function statusMeta(s: Source): { type: 'info' | 'success' | 'danger' | 'primary'; text: string } {
  if (s.disabled) return { type: 'info', text: '已停用' }
  if (s.state === 'C') return { type: 'success', text: '成功' }
  if (s.state === 'E') return { type: 'danger', text: '出错' }
  if (s.state === 'L') return { type: 'primary', text: '运行中' }
  return { type: 'info', text: '未知' }
}

function openSourceCanvas(s: Source, view?: 'data' | 'task') {
  router.push({ path: '/canvas', query: { sourceId: s.sourceId, ...(view ? { view } : {}) } })
}
function openSourceData(s: Source) {
  openSourceCanvas(s, 'data')
}
function openSiteCanvas(site: Site, view?: 'data') {
  router.push({ path: '/canvas', query: { siteId: site.siteId, ...(view ? { view } : {}) } })
}
function openSiteData(site: Site) {
  router.push({ path: '/canvas', query: { siteId: site.siteId, view: 'data' } })
}

// 子源行内操作
async function confirmDanger(title: string, body: string, run: () => Promise<{ message?: string }>) {
  const { ElMessageBox } = await import('element-plus')
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

function onRowSnatch(s: Source) {
  confirmDanger('发抓取', `将向子源「${s.name}」下发抓取任务，是否继续？`, () => sourceApi.sendSnatch([s.sourceId]))
}
function onRowToggle(s: Source) {
  const willDisable = !s.disabled
  confirmDanger(willDisable ? '停用子源' : '启用子源', `确认${willDisable ? '停用' : '启用'}子源「${s.name}」？`, async () => {
    const res = await sourceApi.changeSourceEnable(s.sourceId, willDisable)
    if (res?.ok) {
      s.disabled = willDisable
    }
    return res
  })
}

function onSizeChange() {
  emit('update:page', 1)
  emit('sizeChange')
}

defineExpose({
  selectedIds,
  childrenCache,
  expanded,
  siteCheckMap,
  allChecked,
  indeterminate,
  toggleAll,
  toggleRow,
  toggleSite,
  toggleExpand,
  onTableExpandCommand,
  onRowSnatch,
  onRowToggle,
  statusMeta,
  openSourceCanvas,
  openSourceData,
  openSiteCanvas,
  openSiteData,
  siteIcon,
  onSizeChange,
})
</script>

<template>
  <div v-loading="loading" class="rc-card ca-table-card">
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
                  <button class="ca-op-btn" type="button" title="编辑网站基本信息" @click="emit('openEditor', site)"><el-icon :size="14"><Edit /></el-icon></button>
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
      </div>
    </div>
    <div class="ca-pager">
      <span class="ca-pager-total">共 {{ total }} 条</span>
      <el-pagination
        :current-page="page"
        :page-size="size"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="sizes, prev, pager, next"
        background
        small
        @current-change="(p: number) => emit('update:page', p)"
        @size-change="onSizeChange"
      />
    </div>
  </div>
</template>

<style scoped>
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

.ca-pager { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--rc-border-soft); }
.ca-pager-total { margin-right: auto; color: var(--rc-muted); font-size: 12px; }
</style>
