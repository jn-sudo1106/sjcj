<script setup lang="ts">
// 网站详情（左侧“全部”）下的源总览：只查当前网站，不提供跨网站/指定网站范围切换
// （0812 会议纠偏：进入网站后源/数据/文件/监控范围必须固定为当前 siteId，不能从网站详情跨站查询）。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { sourceApi, type Source } from '@/api'
import {
  SOURCE_MARK_COLORS,
  colorValue,
  flagFromColor,
  issueTagForWrite,
  mergeIssueTags,
  normalizeIssueTag,
  readRecentIssueTags,
  rememberIssueTags,
  visibleIssueTags,
} from '@/utils/sourceMark'
import SourceMarkPopover from './SourceMarkPopover.vue'

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
const tagFilter = ref('')
const colorFilter = ref('')
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
      // ⚠️ 用 siteIds（复数）而不是 siteId：**后端只认复数那个**。
      // 2026-08-28 实测：`sourcePaged({ siteId: 1 })` 返回 16929 条（= 全库，过滤被忽略），
      // `sourcePaged({ siteIds: '1' })` 返回 20 条，与 `site/sources?siteId=1` 一致。
      // 这个 bug 一直在：网站详情下的源视图从来显示的都是全库的源，不是本网站的。
      siteIds: props.currentSiteId || undefined,
      sourceIds: sourceIds.value || undefined,
      name: name.value || undefined,
      state: statusFilter.value === 'all' || statusFilter.value === 'disabled' ? undefined : statusFilter.value,
      enable: statusFilter.value === 'disabled' ? '1' : statusFilter.value === 'all' ? undefined : '0',
      tags: tagFilter.value ? [issueTagForWrite(tagFilter.value)].filter(Boolean) : [],
      flag: flagFromColor(colorFilter.value) || undefined,
      field: sortField.value || undefined,
      sorted: sortField.value ? (sortDirection.value === 'asc' ? 1 : -1) : undefined,
      type: sortField.value ? (sortDirection.value === 'asc' ? 'ASC' : 'DESC') : undefined,
    })
    if (requestId !== sourceRequestSeq) return
    rows.value = applyMarkOverlay(result.list).filter(matchesMarkFilters)
    total.value = tagFilter.value || colorFilter.value
      ? (rows.value.length === result.list.length ? result.total : rows.value.length)
      : result.total
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
  tagFilter.value = ''
  colorFilter.value = ''
  colorMenuOpen.value = false
  search()
}
function pickColorFilter(key: string) {
  colorFilter.value = key
  colorMenuOpen.value = false
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

// ---- 勾选 + 批量（0828 W5-4）----
// 落在**源视图这张表**上，不是左侧边栏：这里才是"面向一批源做事"的地方
//（左侧边栏是切换当前源用的，勾选批量放那儿是我一开始理解错了）。
// 复用已有接口，不新起批量端点：发抓取用 sendSnatchWithParam（与单源同一个，ids 传多个），
// 启停用 changeSourceEnable 逐个调（后端没有批量启停端点，旧平台源列表页也是自己循环调的）。
const selectedIds = ref<string[]>([])
const selectedSet = computed(() => new Set(selectedIds.value))
const selectMode = computed(() => selectedIds.value.length > 0)
const selectedSources = computed(() => rows.value.filter((r) => selectedSet.value.has(r.sourceId)))
const allChecked = computed(() => rows.value.length > 0 && rows.value.every((r) => selectedSet.value.has(r.sourceId)))
const someChecked = computed(() => selectMode.value && !allChecked.value)

function toggleRow(sourceId: string) {
  selectedIds.value = selectedSet.value.has(sourceId)
    ? selectedIds.value.filter((id) => id !== sourceId)
    : [...selectedIds.value, sourceId]
}
function toggleAll() {
  selectedIds.value = allChecked.value ? [] : rows.value.map((r) => r.sourceId)
}
function clearSelection() {
  selectedIds.value = []
}

async function batchSendSnatch() {
  const targets = selectedSources.value.filter((r) => !r.disabled)
  if (!targets.length) {
    ElMessage.warning('选中的源都已停用，无法发起抓取')
    return
  }
  try {
    await ElMessageBox.confirm(`确认对选中的 ${targets.length} 个源发起抓取？`, '批量发起抓取', {
      type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    const res = await sourceApi.sendSnatchWithParam({
      ids: targets.map((r) => r.sourceId), param: {}, all: 0, include: [], skip: 0,
    })
    ElMessage.success(res?.message || `已对 ${targets.length} 个源发起抓取`)
    clearSelection()
  } catch (error) {
    ElMessage.error(`批量发起抓取失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function batchToggleEnable(disable: boolean) {
  const targets = selectedSources.value.filter((r) => !!r.disabled !== disable)
  if (!targets.length) {
    ElMessage.info(disable ? '所选源都已停用' : '所选源都已启用')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认${disable ? '停用' : '启用'}选中的 ${targets.length} 个源？`,
      disable ? '批量停用' : '批量启用',
      { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  // allSettled 而不是 all：一个失败不该把其余已成功的丢掉，最后如实报成败数
  const results = await Promise.allSettled(targets.map((r) => sourceApi.changeSourceEnable(r.sourceId, disable)))
  const failed = results.filter((r) => r.status === 'rejected').length
  if (failed) ElMessage.warning(`${targets.length - failed} 个成功，${failed} 个失败`)
  else ElMessage.success(`已${disable ? '停用' : '启用'} ${targets.length} 个源`)
  clearSelection()
  await loadSources()
}

// ---- 问题标记（0824-03 / 源视图原型）----
// 写入走旧 /v1/source/tagSource、setColor（live + 生产白名单），tags / usedFlag 入库后旧平台也能看到。
// 当前页仍用 overlay 立刻出点；发抓取不清标。
const markOpen = ref(false)
const markAnchorRef = ref<HTMLElement | null>(null)
const colorMenuOpen = ref(false)
const colorFilterRef = ref<HTMLElement | null>(null)
const colorFilterLabel = computed(() => SOURCE_MARK_COLORS.find((item) => item.key === colorFilter.value)?.label || '全部')
const markToast = ref('')
const lastSavedTag = ref('')
const recentTags = ref(readRecentIssueTags())
const markOverlay = new Map<string, { tags?: string[]; color?: string | null }>()
const MARK_OVERLAY_KEY = 'sjcj.source.markOverlay'
try {
  const stored = JSON.parse(sessionStorage.getItem(MARK_OVERLAY_KEY) || '{}') as Record<string, { tags?: string[]; color?: string | null }>
  Object.entries(stored).forEach(([id, patch]) => markOverlay.set(id, patch))
} catch {
  /* ignore broken session overlay */
}

function persistMarkOverlay() {
  sessionStorage.setItem(MARK_OVERLAY_KEY, JSON.stringify(Object.fromEntries(markOverlay)))
}

function matchesMarkFilters(source: Source) {
  const wantTag = normalizeIssueTag(tagFilter.value)
  if (wantTag && !(source.tags ?? []).includes(wantTag)) return false
  if (colorFilter.value && source.color !== colorFilter.value) return false
  return true
}
function applyMarkOverlay(list: Source[]) {
  return list.map((source) => {
    const patch = markOverlay.get(source.sourceId)
    if (!patch) return source
    return {
      ...source,
      tags: patch.tags ?? source.tags,
      color: patch.color === null ? undefined : (patch.color ?? source.color),
    }
  })
}
function writeOverlay(ids: string[], patch: { tags?: string[] | 'clear'; color?: string | null }) {
  ids.forEach((id) => {
    const prev = markOverlay.get(id) ?? {}
    const row = rows.value.find((item) => item.sourceId === id)
    const tags = patch.tags === 'clear'
      ? []
      : patch.tags
        ? mergeIssueTags(prev.tags ?? row?.tags, patch.tags)
        : (prev.tags ?? row?.tags)
    const color = patch.color === undefined ? (prev.color ?? row?.color ?? null) : patch.color
    markOverlay.set(id, { tags, color })
  })
  rows.value.forEach((row) => {
    const next = markOverlay.get(row.sourceId)
    if (!next) return
    row.tags = next.tags
    row.color = next.color || undefined
  })
  persistMarkOverlay()
}
function toggleMarkPopover() {
  markOpen.value = !markOpen.value
}
function closeMarkPopover() {
  markOpen.value = false
}
function onMarkPointerDown(event: MouseEvent) {
  const root = markAnchorRef.value
  if (markOpen.value && root && !root.contains(event.target as Node)) closeMarkPopover()
  const colorRoot = colorFilterRef.value
  if (colorMenuOpen.value && colorRoot && !colorRoot.contains(event.target as Node)) colorMenuOpen.value = false
}
function onMarkKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    closeMarkPopover()
    colorMenuOpen.value = false
  }
}

async function saveMarks(payload: { tags: string[]; color: string }) {
  const ids = [...selectedIds.value]
  if (!ids.length) return
  if (!payload.tags.length && !payload.color) {
    ElMessage.warning('请选择标签或颜色标识')
    return
  }
  const tasks: Promise<unknown>[] = []
  if (payload.tags.length) tasks.push(sourceApi.tagSource(ids, payload.tags, 'add'))
  if (payload.color) tasks.push(sourceApi.setColor(ids, flagFromColor(payload.color)))
  const results = await Promise.allSettled(tasks)
  writeOverlay(ids, { tags: payload.tags.length ? payload.tags : undefined, color: payload.color || undefined })
  if (payload.tags.length) recentTags.value = rememberIssueTags(payload.tags)
  lastSavedTag.value = payload.tags[0] || ''
  closeMarkPopover()
  const failed = results.filter((item) => item.status === 'rejected').length
  if (failed) ElMessage.warning(`已更新 ${ids.length} 个源的标记，其中 ${failed} 个写入未成功`)
  markToast.value = `已更新 ${ids.length} 个源的标记`
}
async function clearSelectedTags() {
  const ids = [...selectedIds.value]
  if (!ids.length) return
  try {
    await ElMessageBox.confirm(
      `确认清除选中的 ${ids.length} 个源的标签？颜色标识不受影响。`,
      '移除标签',
      { type: 'warning', confirmButtonText: '确认清除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await sourceApi.tagSource(ids, [], 'clear')
  } catch (error) {
    ElMessage.error(`清除标签失败：${error instanceof Error ? error.message : String(error)}`)
    return
  }
  writeOverlay(ids, { tags: 'clear' })
  closeMarkPopover()
  markToast.value = `已清除 ${ids.length} 个源的标签`
  lastSavedTag.value = ''
}
async function clearSelectedColor() {
  const ids = [...selectedIds.value]
  if (!ids.length) return
  try {
    await sourceApi.setColor(ids, undefined, true)
  } catch (error) {
    ElMessage.error(`清除颜色标识失败：${error instanceof Error ? error.message : String(error)}`)
    return
  }
  writeOverlay(ids, { color: null })
  closeMarkPopover()
  markToast.value = `已清除 ${ids.length} 个源的颜色标识`
}
function viewMarkedBatch() {
  if (lastSavedTag.value) tagFilter.value = lastSavedTag.value
  markToast.value = ''
  selectedIds.value = []
  rows.value = applyMarkOverlay(rows.value).filter(matchesMarkFilters)
  total.value = rows.value.length
}
function tagPreview(source: Source) {
  return visibleIssueTags(source.tags)
}

watch(rows, () => {
  clearSelection()
  closeMarkPopover()
})

onMounted(() => {
  document.addEventListener('mousedown', onMarkPointerDown)
  document.addEventListener('keydown', onMarkKeydown)
  void loadSources()
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onMarkPointerDown)
  document.removeEventListener('keydown', onMarkKeydown)
})
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
      <label>标签
        <input v-model="tagFilter" data-testid="source-overview-tag" placeholder="标签名称" @keyup.enter="search" />
      </label>
      <label>颜色标识
        <div ref="colorFilterRef" class="sov-color-dd">
          <button
            class="sov-color-dd-btn"
            type="button"
            data-testid="source-overview-color"
            :aria-expanded="colorMenuOpen"
            @click="colorMenuOpen = !colorMenuOpen"
          >
            <i v-if="colorValue(colorFilter)" class="sov-mark-dot" :style="{ background: colorValue(colorFilter) }" />
            <span>{{ colorFilterLabel }}</span>
          </button>
          <div v-if="colorMenuOpen" class="sov-color-dd-menu" data-testid="source-overview-color-menu">
            <button type="button" :class="{ on: !colorFilter }" data-testid="source-overview-color-all" @click="pickColorFilter('')">全部</button>
            <button
              v-for="color in SOURCE_MARK_COLORS"
              :key="color.key"
              type="button"
              :class="{ on: colorFilter === color.key }"
              :data-testid="`source-overview-color-${color.key}`"
              @click="pickColorFilter(color.key)"
            >
              <i class="sov-mark-dot" :style="{ background: color.value }" />{{ color.label }}
            </button>
          </div>
        </div>
      </label>
      <button class="sov-btn primary" type="button" data-testid="source-overview-search" @click="search">查询</button>
      <button class="sov-btn" type="button" @click="clearFilters">清空</button>
    </div>

    <div class="sov-summary">
      <span>共 {{ total }} 个源</span>
      <!-- 批量条：勾中才出现，不占常态空间（0828 W5-4） -->
      <template v-if="selectMode">
        <span class="sov-batch-count" data-testid="source-batch-count">已选 {{ selectedIds.length }}</span>
        <div ref="markAnchorRef" class="sov-mark-anchor">
          <button class="sov-btn sov-mark-btn" type="button" data-testid="batch-mark" :aria-expanded="markOpen" @click="toggleMarkPopover">添加标记</button>
          <SourceMarkPopover
            v-if="markOpen"
            :selected-count="selectedIds.length"
            :recent-tags="recentTags"
            @save="saveMarks"
            @clear-tags="clearSelectedTags"
            @clear-color="clearSelectedColor"
          />
        </div>
        <button class="sov-btn primary" type="button" data-testid="batch-snatch" @click="batchSendSnatch">发起抓取</button>
        <button class="sov-btn" type="button" data-testid="batch-enable" @click="batchToggleEnable(false)">启用</button>
        <button class="sov-btn danger" type="button" data-testid="batch-disable" @click="batchToggleEnable(true)">停用</button>
        <button class="sov-btn ghost" type="button" data-testid="batch-clear" @click="clearSelection">取消</button>
      </template>
    </div>
    <div class="sov-table-wrap" :class="{ loading }">
      <table class="sov-table">
        <thead>
          <tr>
            <th class="sov-check-col">
              <input
                type="checkbox"
                aria-label="全选本页"
                data-testid="source-check-all"
                :checked="allChecked"
                :indeterminate="someChecked"
                @change="toggleAll"
              />
            </th>
            <th><button class="sov-sort" type="button" :title="sortLabel('SOURCE_ID')" @click="toggleSort('SOURCE_ID')">源 ID <span>{{ sortField === 'SOURCE_ID' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕' }}</span></button></th>
            <th>源名称</th>
            <th>URL</th><th>主表</th>
            <th>标签</th>
            <th><button class="sov-sort" type="button" :title="sortLabel('DATA_CNT')" @click="toggleSort('DATA_CNT')">数据 <span>{{ sortField === 'DATA_CNT' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕' }}</span></button></th>
            <th>新入</th><th>成功</th><th>最近任务</th><th>最近成功</th><th>状态</th><th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="source in rows" :key="source.sourceId" :class="{ picked: selectedSet.has(source.sourceId) }">
            <td class="sov-check-col">
              <input
                type="checkbox"
                :aria-label="`选择 ${source.name}`"
                :data-testid="`source-check-${source.sourceId}`"
                :checked="selectedSet.has(source.sourceId)"
                @change="toggleRow(source.sourceId)"
              />
            </td>
            <td>
              <div class="sov-source-id">
                <i v-if="colorValue(source.color)" class="sov-mark-dot" :style="{ background: colorValue(source.color) }" />
                {{ source.sourceId }}
              </div>
            </td>
            <td class="sov-name" :title="source.name"><button class="sov-link sov-source-link" type="button" data-testid="source-overview-source-link" @click="emit('openSource', source)">{{ source.name }}</button></td>
            <td class="sov-url" :title="source.url">{{ source.url || '—' }}</td>
            <td>{{ source.mainTable || '—' }}</td>
            <td>
              <div class="sov-row-tags" data-testid="source-issue-tags">
                <span v-for="tag in tagPreview(source).shown" :key="tag">{{ tag }}</span>
                <em v-if="tagPreview(source).extra">+{{ tagPreview(source).extra }}</em>
                <template v-if="!(source.tags && source.tags.length)">—</template>
              </div>
            </td>
            <td>{{ source.dataCount ?? '—' }}</td>
            <td>{{ source.newInCount ?? '—' }}</td>
            <td>{{ source.successCount ?? '—' }}</td>
            <td>{{ source.lastTaskAt || '—' }}</td>
            <td>{{ source.lastSuccessAt || '—' }}</td>
            <td><span class="sov-state" :class="{ error: source.state === 'E' && !source.disabled, muted: source.disabled }">{{ sourceState(source) }}</span></td>
            <td :title="source.remark">{{ source.remark || '—' }}</td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="13" class="sov-empty">{{ loadError || '暂无符合条件的源' }}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="sov-pager">
      <span>第 {{ page }} / {{ totalPages }} 页</span>
      <button class="sov-btn" type="button" :disabled="page <= 1" @click="previousPage">上一页</button>
      <button class="sov-btn" type="button" :disabled="page >= totalPages" @click="nextPage">下一页</button>
    </div>
    <div v-if="markToast" class="sov-toast" data-testid="source-mark-toast">
      <span>{{ markToast }}</span>
      <button v-if="lastSavedTag" type="button" data-testid="source-mark-view-batch" @click="viewMarkedBatch">查看这一批</button>
      <button class="sov-toast-close" type="button" aria-label="关闭提示" @click="markToast = ''">×</button>
    </div>
  </section>
</template>

<style scoped>
.sov-shell { display: flex; flex: 1; min-height: 0; flex-direction: column; padding: 12px; background: #f8fafc; gap: 10px; }
.sov-filter { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; padding: 10px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #fff; }
.sov-filter label { display: grid; gap: 4px; color: var(--rc-muted); font-size: 11px; }
.sov-filter input, .sov-filter select { height: 30px; min-width: 116px; padding: 0 8px; border: 1px solid #dbe3ee; border-radius: 6px; color: var(--rc-text); background: #fff; font-size: 12px; }
.sov-filter input:focus, .sov-filter select:focus { outline: 0; border-color: #60a5fa; box-shadow: 0 0 0 2px #dbeafe; }
.sov-color-dd { position: relative; }
.sov-color-dd-btn { display: flex; align-items: center; gap: 7px; height: 30px; min-width: 116px; padding: 0 8px; border: 1px solid #dbe3ee; border-radius: 6px; background: #fff; color: var(--rc-text); cursor: pointer; font-size: 12px; text-align: left; }
.sov-color-dd-btn:focus { outline: 0; border-color: #60a5fa; box-shadow: 0 0 0 2px #dbeafe; }
.sov-color-dd-menu { position: absolute; z-index: 12; top: calc(100% + 4px); left: 0; display: grid; min-width: 100%; padding: 4px; border: 1px solid #dce5f1; border-radius: 6px; background: #fff; box-shadow: 0 8px 22px rgba(15, 23, 42, .12); }
.sov-color-dd-menu button { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 8px; border: 0; border-radius: 4px; background: transparent; color: var(--rc-text-2); cursor: pointer; font-size: 12px; text-align: left; }
.sov-color-dd-menu button.on, .sov-color-dd-menu button:hover { background: #edf4ff; color: var(--rc-primary); }
.sov-color-dd-menu .sov-mark-dot { width: 10px; height: 10px; }
.sov-btn { height: 30px; padding: 0 10px; border: 1px solid #d5e2f2; border-radius: 6px; background: #fff; color: var(--rc-text-2); cursor: pointer; font-size: 12px; font-weight: 600; }
.sov-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.sov-btn:disabled { cursor: not-allowed; opacity: .5; }
.sov-summary { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; color: var(--rc-text-2); font-size: 12px; }
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
.sov-check-col { width: 34px; text-align: center; }
.sov-check-col input { cursor: pointer; accent-color: var(--rc-primary); margin: 0; }
.sov-table tbody tr.picked { background: var(--rc-primary-bg); }
.sov-batch-count { font-weight: 700; color: var(--rc-primary-ink); }
.sov-mark-anchor { position: relative; }
.sov-mark-btn { border-color: #7da4ff; color: var(--rc-primary); }
.sov-source-id { display: flex; align-items: center; gap: 8px; }
.sov-mark-dot { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; }
.sov-row-tags { display: flex; align-items: center; gap: 4px; }
.sov-row-tags span, .sov-row-tags em { height: 23px; padding: 0 6px; border: 1px solid #dbe3ed; border-radius: 4px; background: #f8fafc; color: var(--rc-muted); font-size: 10px; font-style: normal; line-height: 21px; white-space: nowrap; }
.sov-row-tags em { padding: 0 5px; color: var(--rc-text-2); }
.sov-toast { position: fixed; z-index: 50; top: 18px; left: 50%; display: flex; align-items: center; gap: 9px; min-width: 300px; height: 44px; padding: 0 13px; border: 1px solid #d8eadc; border-radius: 7px; background: #f0fdf4; box-shadow: 0 8px 20px rgba(15, 23, 42, .12); color: #166534; transform: translateX(-50%); font-size: 12px; }
.sov-toast button { border: 0; background: transparent; color: var(--rc-primary); cursor: pointer; font-size: 11px; font-weight: 700; }
.sov-toast-close { margin-left: auto; padding: 0; color: var(--rc-muted) !important; font-size: 16px !important; }
.sov-btn.danger { color: #b91c1c; border-color: #fecaca; }
.sov-btn.ghost { color: var(--rc-faint); }
.sov-state { display: inline-flex; padding: 2px 7px; border-radius: 999px; background: #ecfdf3; color: #15803d; font-size: 11px; font-weight: 700; }
.sov-state.error { background: #fef2f2; color: #dc2626; }
.sov-state.muted { background: #f1f5f9; color: #64748b; }
.sov-link { border: 0; background: transparent; color: var(--rc-primary); cursor: pointer; font-size: 12px; font-weight: 600; }
.sov-sort { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; }
.sov-sort span { color: #94a3b8; font-size: 11px; }
.sov-pager { display: flex; align-items: center; justify-content: flex-end; gap: 8px; color: var(--rc-faint); font-size: 11px; }
</style>
