<script setup lang="ts">
// 网站详情（左侧“全部”）下的源总览：只查当前网站，不提供跨网站/指定网站范围切换
// （0812 会议纠偏：进入网站后源/数据/文件/监控范围必须固定为当前 siteId，不能从网站详情跨站查询）。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { sourceApi, type Source } from '@/api'
import {
  issueTagForWrite,
  mergeIssueTags,
  normalizeIssueTag,
  readRecentIssueTags,
  rememberIssueTags,
  visibleIssueTags,
} from '@/utils/sourceMark'
import SourceMarkPopover from './SourceMarkPopover.vue'
import EditSourceMarkDialog from './EditSourceMarkDialog.vue'
import LaunchConfirmDialog from './LaunchConfirmDialog.vue'
import SourceParamModal from '@/views/FlowCanvas/source/SourceParamModal.vue'
import { hasLoadParams, normalizeLoadParams } from '@/views/FlowCanvas/source/paramNormalize'
import { downloadCsv, toCsv } from '@/utils/format/csvExport'
import {
  CollectLimitError,
  SOURCE_EXPORT_HEADER,
  collectAllUnderQuery,
  describeFilters,
  partitionLaunchTargets,
  resolveScope,
  sendInBatches,
  sourceToExportRow,
  type LaunchScope,
  type SourceFilter,
} from './useSourceLaunch'

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
// 备注：生产源列表页筛选区就有，后端认 remark（旧列表列同名）。本地那份旧代码快照比线上旧，
// queryParam 里还没有，不能拿它当"后端不支持"的依据。旁边的「责任人」0831 明确暂不做。
const remarkFilter = ref('')
const sortField = ref('')
const sortDirection = ref<'asc' | 'desc'>('asc')
let sourceRequestSeq = 0

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / size.value)))

function currentQuery(): SourceFilter {
  return {
    siteIds: props.currentSiteId || undefined,
    sourceIds: sourceIds.value || undefined,
    name: name.value || undefined,
    state: statusFilter.value === 'all' || statusFilter.value === 'disabled' ? undefined : statusFilter.value,
    enable: statusFilter.value === 'disabled' ? '1' : statusFilter.value === 'all' ? undefined : '0',
    tags: tagFilter.value ? [issueTagForWrite(tagFilter.value)].filter(Boolean) : [],
    remark: remarkFilter.value || undefined,
    field: sortField.value || undefined,
    sorted: sortField.value ? (sortDirection.value === 'asc' ? 1 : -1) : undefined,
    type: sortField.value ? (sortDirection.value === 'asc' ? 'ASC' : 'DESC') : undefined,
  }
}

async function fetchSourcePage(query: SourceFilter & { page: number; size: number }) {
  return sourceApi.sourcePaged(query)
}

async function loadSources() {
  const requestId = ++sourceRequestSeq
  loading.value = true
  loadError.value = ''
  try {
    const result = await fetchSourcePage({ ...currentQuery(), page: page.value, size: size.value })
    if (requestId !== sourceRequestSeq) return
    // 不再对服务端结果做二次过滤（0831 X0）。2026-08-31 会上实测：搜「内容重复」时
    // 开发人员当场说"他查到了，但是没返回"——就是这里，服务端明明返回了 N 行，
    // 客户端 matchesMarkFilters 又按精确相等滤了一遍，把 N 行滤成 0 行。
    // 两边口径本来就不可能对齐：服务端按什么语义匹配 tags（精确/前缀/模糊、要不要带 #）
    // 我们并不知道，任何本地复刻都是在猜；而且 total 一旦按过滤后的行数改写，
    // 分页页数也跟着错。服务端返回什么就展示什么，这是唯一自洽的口径。
    rows.value = applyMarkOverlay(result.list)
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
  tagFilter.value = ''
  remarkFilter.value = ''
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

// ---- 发任务（0831 X2）----
// 按钮常驻：没勾选 = 按当前筛选条件全量发（前端分页收 ID，G1 未给端点时的兜底）；
// 勾了 = 只发勾上的。`all` 恒为 0，那是「所有参数」不是「所有源」。
const launchOpen = ref(false)
const launchSending = ref(false)
const launchScope = ref<LaunchScope | null>(null)
const launchPreview = ref({ sendCount: 0, disabledCount: 0, paramCount: 0, paramNames: [] as string[] })
const collectProgress = ref('')
const failedBatches = ref<{ ids: string[]; error: string }[]>([])
/** query 模式在打开确认弹窗前就把可发送的 id 收齐，弹窗数字才能跟实际发送对得上 */
let collectedSendableIds: string[] = []
let collectAbort: AbortController | null = null
const paramModalRef = ref<InstanceType<typeof SourceParamModal>>()

async function sendWithParamsCallback(
  ids: string[],
  param: Record<string, string>,
  _all: number,
  include: string[],
  skip: number,
  queue: string,
) {
  // 即便弹窗把 all 勾上了，这里也压成 0：那是参数全排列，跟「发全部源」无关，不能从这条入口漏出去。
  return sourceApi.sendSnatchWithParam({ ids, param, all: 0, include, skip, queue })
}

async function openLaunch() {
  failedBatches.value = []
  collectedSendableIds = []
  const scope = resolveScope(selectedIds.value, total.value, currentQuery())
  launchScope.value = scope
  if (scope.mode === 'selected') {
    const { sendable, disabled, param } = partitionLaunchTargets(selectedSources.value)
    launchPreview.value = {
      sendCount: sendable.length + param.length,
      disabledCount: disabled.length,
      paramCount: param.length,
      paramNames: param.map((s) => s.name),
    }
    if (!sendable.length && !param.length) {
      ElMessage.warning('选中的源都已停用，无法发任务')
      return
    }
    launchOpen.value = true
    return
  }
  if (!scope.hitCount) {
    ElMessage.warning('当前筛选没有命中任何源')
    return
  }
  collectAbort = new AbortController()
  collectProgress.value = '正在收集源…'
  try {
    const sources = await collectAllUnderQuery(scope.query, {
      fetchPage: fetchSourcePage,
      signal: collectAbort.signal,
      onProgress: (got, all) => { collectProgress.value = `已获取 ${got.toLocaleString()} / ${all.toLocaleString()}` },
    })
    const { sendable, disabled, param } = partitionLaunchTargets(sources)
    collectedSendableIds = sendable.map((s) => s.sourceId)
    launchPreview.value = {
      sendCount: sendable.length,
      disabledCount: disabled.length,
      paramCount: param.length,
      paramNames: param.map((s) => s.name).slice(0, 8),
    }
    if (!sendable.length) {
      ElMessage.warning(param.length ? '命中的都是参数源，请勾选后单独发送' : '没有可发送的源')
      return
    }
    launchOpen.value = true
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') return
    if (error instanceof CollectLimitError) {
      ElMessage.warning(error.message)
      return
    }
    ElMessage.error(`收集源失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    collectProgress.value = ''
  }
}

async function confirmLaunch(skip: number) {
  const scope = launchScope.value
  if (!scope || launchSending.value) return
  launchSending.value = true
  collectProgress.value = ''
  try {
    if (scope.mode === 'selected') await launchSelected(skip)
    else await dispatchIds(collectedSendableIds, skip)
  } finally {
    launchSending.value = false
    collectProgress.value = ''
  }
}

async function launchSelected(skip: number) {
  const { sendable, param } = partitionLaunchTargets(selectedSources.value)
  const ids = [...sendable, ...param].map((s) => s.sourceId)
  if (!ids.length) return
  try {
    const raw = await sourceApi.loadParams(ids)
    if (hasLoadParams(normalizeLoadParams(raw))) {
      launchOpen.value = false
      paramModalRef.value?.showParam(raw, [...sendable, ...param].map((s) => ({ sourceId: s.sourceId, name: s.name })))
      clearSelection()
      return
    }
  } catch (error) {
    ElMessage.error(`读取参数失败：${error instanceof Error ? error.message : String(error)}`)
    return
  }
  await dispatchIds(ids, skip)
}

async function dispatchIds(ids: string[], skip: number) {
  collectProgress.value = `发送中 0 / ${ids.length}`
  const result = await sendInBatches(ids, (batch) =>
    sourceApi.sendSnatchWithParam({ ids: batch, param: {}, all: 0, include: [], skip }),
    { onBatch: (done, all) => { collectProgress.value = `发送中 ${done} / ${all}` } },
  )
  failedBatches.value = result.failed
  launchOpen.value = false
  if (result.failed.length) {
    const failedCount = result.failed.reduce((n, item) => n + item.ids.length, 0)
    ElMessage.warning(`已发 ${result.sent} 个，失败 ${failedCount} 个。任务已下发的无法撤回，可重试失败批次。`)
  } else {
    ElMessage.success(`已对 ${result.sent} 个源发任务`)
    clearSelection()
  }
}

async function retryFailedBatches() {
  const pending = failedBatches.value
  if (!pending.length || launchSending.value) return
  launchSending.value = true
  try {
    const nextFailed: typeof pending = []
    let sent = 0
    for (const batch of pending) {
      try {
        await sourceApi.sendSnatchWithParam({ ids: batch.ids, param: {}, all: 0, include: [], skip: 0 })
        sent += batch.ids.length
      } catch (error) {
        nextFailed.push({ ids: batch.ids, error: error instanceof Error ? error.message : String(error) })
      }
    }
    failedBatches.value = nextFailed
    if (nextFailed.length) ElMessage.warning(`重试后又发出 ${sent} 个，仍失败 ${nextFailed.reduce((n, i) => n + i.ids.length, 0)} 个`)
    else ElMessage.success(`失败批次已全部重试成功，共 ${sent} 个`)
  } finally {
    launchSending.value = false
  }
}

function closeLaunch() {
  collectAbort?.abort()
  launchOpen.value = false
  launchSending.value = false
}

async function exportSources() {
  collectAbort = new AbortController()
  collectProgress.value = '正在导出…'
  try {
    const sources = await collectAllUnderQuery(currentQuery(), {
      fetchPage: fetchSourcePage,
      signal: collectAbort.signal,
      onProgress: (got, all) => { collectProgress.value = `已获取 ${got.toLocaleString()} / ${all.toLocaleString()}` },
    })
    const csv = toCsv([ [...SOURCE_EXPORT_HEADER], ...sources.map(sourceToExportRow) ])
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    downloadCsv(`源列表_${props.currentSiteId || 'site'}_${date}.csv`, csv)
    ElMessage.success(`已导出 ${sources.length} 个源`)
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') return
    if (error instanceof CollectLimitError) {
      ElMessage.warning(error.message)
      return
    }
    ElMessage.error(`导出失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    collectProgress.value = ''
    collectAbort = null
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
  // 一次请求发全部 id：旧 changeEnable 本来就是批量端点，之前这里逐个调是因为适配层还是 mock 占位
  try {
    const res = await sourceApi.changeSourceEnableBatch(targets.map((r) => r.sourceId), disable)
    ElMessage.success(res?.message || `已${disable ? '停用' : '启用'} ${targets.length} 个源`)
  } catch (error) {
    ElMessage.error(`批量${disable ? '停用' : '启用'}失败：${error instanceof Error ? error.message : String(error)}`)
  }
  clearSelection()
  await loadSources()
}

// ---- 问题标记（0824-03 / 源视图原型；0831 F01 去掉颜色，只剩标签）----
// 写入走旧 /v1/source/tagSource（live + 生产白名单），tags 入库后旧平台也能看到。
// 当前页仍用 overlay 立刻出效果；发抓取不清标。
const markOpen = ref(false)
const markAnchorRef = ref<HTMLElement | null>(null)
const markToast = ref('')
const lastSavedTag = ref('')

// 标签候选：服务端 source/sourceTags 拿到的是**当前查询条件下真实存在**的标签，
// 包含程序打进去的那些；本机 readRecentIssueTags() 只记得这台机器上手工打过的。
// 两者合并，服务端的排前面。拿不到就静默退回本地——候选只是输入辅助，不该因为它挂了就不能打标。
const localTags = ref(readRecentIssueTags())
const serverTags = ref<string[]>([])
const tagCandidates = computed(() => [...new Set([...serverTags.value, ...localTags.value])].slice(0, 24))

type MarkPatch = { tags?: string[]; remark?: string }
const markOverlay = new Map<string, MarkPatch>()
const MARK_OVERLAY_KEY = 'sjcj.source.markOverlay'
try {
  const stored = JSON.parse(sessionStorage.getItem(MARK_OVERLAY_KEY) || '{}') as Record<string, MarkPatch>
  Object.entries(stored).forEach(([id, patch]) => markOverlay.set(id, patch))
} catch {
  /* ignore broken session overlay */
}

function persistMarkOverlay() {
  sessionStorage.setItem(MARK_OVERLAY_KEY, JSON.stringify(Object.fromEntries(markOverlay)))
}

/**
 * 只给「查看这一批」用（打完标后不重新请求、就地把本页筛到刚标的那批）。
 * **不要拿它过滤服务端返回的列表**——那正是 X0 修掉的 bug。
 *
 * 匹配放宽成包含而不是精确相等：这里比的是本地 overlay 刚写进去的标签，
 * 而用户在筛选框里输的可能是「重复」这种半截词，精确相等会一条都留不下。
 */
function matchesMarkFilters(source: Source) {
  const wantTag = normalizeIssueTag(tagFilter.value)
  if (wantTag && !(source.tags ?? []).some((tag) => tag.includes(wantTag))) return false
  return true
}
function applyMarkOverlay(list: Source[]) {
  return list.map((source) => {
    const patch = markOverlay.get(source.sourceId)
    if (!patch) return source
    return {
      ...source,
      tags: patch.tags ?? source.tags,
      remark: patch.remark ?? source.remark,
    }
  })
}
/**
 * `tags` 三种写法各对应一种真实场景，别合并：
 *   - `string[]`  批量条追加（tagSource add，服务端也是追加，所以本地 merge）
 *   - `'clear'`   批量条清空
 *   - `{ set }`   行内编辑（updateSource 全量覆盖，本地必须同样覆盖而不是并进去，
 *                 否则用户删掉的那个标签会被 merge 又加回来）
 */
function writeOverlay(ids: string[], patch: { tags?: string[] | 'clear' | { set: string[] }; remark?: string }) {
  ids.forEach((id) => {
    const prev = markOverlay.get(id) ?? {}
    const row = rows.value.find((item) => item.sourceId === id)
    const current = prev.tags ?? row?.tags
    const tags = patch.tags === 'clear'
      ? []
      : Array.isArray(patch.tags)
        ? mergeIssueTags(current, patch.tags)
        : patch.tags
          ? [...patch.tags.set]
          : current
    markOverlay.set(id, { tags, remark: patch.remark ?? prev.remark ?? row?.remark })
  })
  rows.value.forEach((row) => {
    const next = markOverlay.get(row.sourceId)
    if (!next) return
    row.tags = next.tags
    row.remark = next.remark
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
}
function onMarkKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMarkPopover()
}

async function saveMarks(payload: { tags: string[] }) {
  const ids = [...selectedIds.value]
  if (!ids.length) return
  if (!payload.tags.length) {
    ElMessage.warning('请选择或输入标签')
    return
  }
  let failed = false
  try {
    await sourceApi.tagSource(ids, payload.tags, 'add')
  } catch {
    failed = true
  }
  writeOverlay(ids, { tags: payload.tags })
  localTags.value = rememberIssueTags(payload.tags)
  lastSavedTag.value = payload.tags[0] || ''
  closeMarkPopover()
  if (failed) ElMessage.warning(`已更新 ${ids.length} 个源的标签，但写入未成功`)
  markToast.value = `已更新 ${ids.length} 个源的标签`
}
async function clearSelectedTags() {
  const ids = [...selectedIds.value]
  if (!ids.length) return
  try {
    await ElMessageBox.confirm(
      `确认清空选中的 ${ids.length} 个源的全部标签？这些源上的标签会一个不剩，无法只删其中一个。`,
      '清空标签',
      { type: 'warning', confirmButtonText: '确认清空', cancelButtonText: '取消' },
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

// ---- 行内编辑标签与备注（0831 F02/F04）----
// 批量条只能「追加」和「清空」——想删掉三个标签里中间那个，只有这条路。
// 走 updateSource 全量覆盖，与旧平台备注弹窗（SourceList.vue:1520-1561）同一条接口、同一批字段。
const editTarget = ref<Source | null>(null)
function openMarkEditor(source: Source) {
  editTarget.value = source
}
function onMarkEdited(payload: { tags: string[]; remark: string }) {
  const id = editTarget.value?.sourceId
  editTarget.value = null
  if (!id) return
  // set 而不是 merge：这是覆盖语义，用户删掉的标签不能被 merge 加回来
  writeOverlay([id], { tags: { set: payload.tags }, remark: payload.remark })
  if (payload.tags.length) localTags.value = rememberIssueTags(payload.tags)
}

/**
 * 标签候选：入参就是当前查询条件（旧 querySourceTags 的口径，SourceSearch.vue:199-207），
 * 所以候选跟着筛选条件走——筛到某个网站，看到的就是这个网站下真实存在的标签。
 * 失败不提示：候选只是输入辅助，为它弹一个红条会盖住用户正在做的事。
 */
async function loadTagCandidates() {
  try {
    serverTags.value = await sourceApi.sourceTags({
      siteIds: props.currentSiteId || undefined,
      sourceIds: sourceIds.value || undefined,
      name: name.value || undefined,
    })
  } catch {
    serverTags.value = []
  }
}

watch(rows, () => {
  clearSelection()
  closeMarkPopover()
})

onMounted(() => {
  document.addEventListener('mousedown', onMarkPointerDown)
  document.addEventListener('keydown', onMarkKeydown)
  void loadSources()
  void loadTagCandidates()
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onMarkPointerDown)
  document.removeEventListener('keydown', onMarkKeydown)
})
watch(() => props.currentSiteId, () => {
  page.value = 1
  void loadSources()
  void loadTagCandidates()
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
        <!-- list 只做输入建议，不限制取值：程序打的标签未必在候选里，硬限制会让人筛不出来（F03） -->
        <input
          v-model="tagFilter"
          list="source-tag-candidates"
          data-testid="source-overview-tag"
          placeholder="标签名称"
          @keyup.enter="search"
        />
        <datalist id="source-tag-candidates" data-testid="source-tag-candidates">
          <option v-for="tag in tagCandidates" :key="tag" :value="tag" />
        </datalist>
      </label>
      <label>备注
        <input v-model="remarkFilter" data-testid="source-overview-remark" placeholder="备注关键字" @keyup.enter="search" />
      </label>
      <button class="sov-btn primary" type="button" data-testid="source-overview-search" @click="search">查询</button>
      <button class="sov-btn" type="button" @click="clearFilters">清空</button>
    </div>

    <div class="sov-summary">
      <span>共 {{ total }} 个源</span>
      <button class="sov-btn primary" type="button" data-testid="source-launch" @click="openLaunch">发任务</button>
      <button class="sov-icon-btn" type="button" data-testid="source-export" title="导出当前筛选结果" aria-label="导出" @click="exportSources">⤓</button>
      <span v-if="collectProgress" class="sov-progress" data-testid="source-collect-progress">{{ collectProgress }}</span>
      <button v-if="failedBatches.length" class="sov-btn" type="button" data-testid="source-retry-failed" @click="retryFailedBatches">重试失败批次（{{ failedBatches.reduce((n, b) => n + b.ids.length, 0) }}）</button>
      <template v-if="selectMode">
        <span class="sov-batch-count" data-testid="source-batch-count">已选 {{ selectedIds.length }}</span>
        <div ref="markAnchorRef" class="sov-mark-anchor">
          <button class="sov-btn sov-mark-btn" type="button" data-testid="batch-mark" :aria-expanded="markOpen" @click="toggleMarkPopover">添加标记</button>
          <SourceMarkPopover
            v-if="markOpen"
            :selected-count="selectedIds.length"
            :recent-tags="tagCandidates"
            @save="saveMarks"
            @clear-tags="clearSelectedTags"
          />
        </div>
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
            <td>{{ source.sourceId }}</td>
            <td class="sov-name" :title="source.name"><button class="sov-link sov-source-link" type="button" data-testid="source-overview-source-link" @click="emit('openSource', source)">{{ source.name }}</button></td>
            <td class="sov-url" :title="source.url">{{ source.url || '—' }}</td>
            <td>{{ source.mainTable || '—' }}</td>
            <td>
              <!-- 标签列与备注列都点开同一个弹窗：想删掉某一个标签只有这条路（批量条只能追加/清空） -->
              <button
                class="sov-cell-edit"
                type="button"
                data-testid="source-mark-edit"
                title="编辑标签与备注"
                @click="openMarkEditor(source)"
              >
                <span class="sov-row-tags" data-testid="source-issue-tags">
                  <span v-for="tag in tagPreview(source).shown" :key="tag">{{ tag }}</span>
                  <em v-if="tagPreview(source).extra">+{{ tagPreview(source).extra }}</em>
                  <template v-if="!(source.tags && source.tags.length)">—</template>
                </span>
              </button>
            </td>
            <td>{{ source.dataCount ?? '—' }}</td>
            <td>{{ source.newInCount ?? '—' }}</td>
            <td>{{ source.successCount ?? '—' }}</td>
            <td>{{ source.lastTaskAt || '—' }}</td>
            <td>{{ source.lastSuccessAt || '—' }}</td>
            <td><span class="sov-state" :class="{ error: source.state === 'E' && !source.disabled, muted: source.disabled }">{{ sourceState(source) }}</span></td>
            <td>
              <button
                class="sov-remark sov-cell-edit"
                type="button"
                data-testid="source-remark-edit"
                :title="source.remark || '编辑标签与备注'"
                @click="openMarkEditor(source)"
              >{{ source.remark || '—' }}</button>
            </td>
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
    <EditSourceMarkDialog
      v-if="editTarget"
      :source="editTarget"
      :tag-candidates="tagCandidates"
      @saved="onMarkEdited"
      @close="editTarget = null"
    />
    <LaunchConfirmDialog
      v-if="launchOpen && launchScope"
      :mode="launchScope.mode"
      :hit-count="launchScope.hitCount"
      :send-count="launchPreview.sendCount"
      :disabled-count="launchPreview.disabledCount"
      :param-count="launchPreview.paramCount"
      :param-names="launchPreview.paramNames"
      :filter-text="launchScope.mode === 'query' ? describeFilters(launchScope.query) : ''"
      :sending="launchSending"
      @confirm="confirmLaunch"
      @close="closeLaunch"
    />
    <SourceParamModal ref="paramModalRef" :callback="sendWithParamsCallback" />
  </section>
</template>

<style scoped>
.sov-shell { display: flex; flex: 1; min-height: 0; flex-direction: column; padding: 12px; background: #f8fafc; gap: 10px; }
.sov-filter { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; padding: 10px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #fff; }
.sov-filter label { display: grid; gap: 4px; color: var(--rc-muted); font-size: 11px; }
.sov-filter input, .sov-filter select { height: 30px; min-width: 116px; padding: 0 8px; border: 1px solid #dbe3ee; border-radius: 6px; color: var(--rc-text); background: #fff; font-size: 12px; }
.sov-filter input:focus, .sov-filter select:focus { outline: 0; border-color: #60a5fa; box-shadow: 0 0 0 2px #dbeafe; }
.sov-filter input:disabled { background: #f4f6f9; color: var(--rc-faint); cursor: not-allowed; }
.sov-btn { height: 30px; padding: 0 10px; border: 1px solid #d5e2f2; border-radius: 6px; background: #fff; color: var(--rc-text-2); cursor: pointer; font-size: 12px; font-weight: 600; }
.sov-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.sov-icon-btn { display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid #d5e2f2; border-radius: 6px; background: #fff; color: var(--rc-text-2); cursor: pointer; font-size: 14px; }
.sov-icon-btn:hover { border-color: var(--rc-primary); color: var(--rc-primary); }
.sov-progress { color: var(--rc-muted); font-size: 11px; }
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
.sov-cell-edit { max-width: 200px; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; text-align: left; }
.sov-cell-edit:hover { color: var(--rc-primary); }
.sov-remark { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sov-row-tags { display: inline-flex; align-items: center; gap: 4px; }
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
