<script setup lang="ts">
// 流程中心「关联流程到源」的选源弹窗（0903 §2.6 H05 的加强版，对齐旧平台）：
// 表格勾选 + 按「源名称 / ID」「所属网站」「所属流程」服务端筛 + ID 批量检索 + 全选本页。
// 「所属网站」（1105 会议）：一个网站下的源通常共用流程，选网站后点「全选全部」即可一次关联。
// 2026-11-09：「网站」列补网站名（后端 siteName 常为空，用网站清单缓存兜底）；「仅看未关联到本流程」
// 改成整范围本地筛（后端没有「不等于某流程」的条件），total / 翻页 / 全选全部与前面的筛选条件同一口径。
// 提交动作仍在 FlowCenter 的 confirmApply（分批 + 作业条 + 二次确认文案），这里只负责选。
import { computed, reactive, ref, watch } from 'vue'
import { ElDialog, ElMessage } from 'element-plus'
import { flowCenterApi, siteApi, sourceApi, type FlowRecord, type Source } from '@/api'
import { useSourceGroupNames } from './sourceGroupNames'

const props = defineProps<{
  /** 目标流程；非 null 时弹窗打开 */
  flow: FlowRecord | null
  /** 已选源 ID（v-model） */
  modelValue: string[]
  submitting?: boolean
  progress?: string
  /** 嵌在「关联到源」弹窗的「添加关联」页签里（2026-10-21）：不渲染自己的弹窗外壳，底部按钮放在内容末尾 */
  embedded?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [string[]]
  confirm: []
  close: []
}>()

const PAGE_SIZE = 20

const keyword = ref('')
const flowFilter = ref('')
const siteFilter = ref('')
const siteOptions = ref<{ id: string; name: string }[]>([])
const siteOptLoading = ref(false)
const flowOptions = ref<{ id: string; name: string }[]>([])
const flowOptLoading = ref(false)
const onlyUnbound = ref(false)

// 1008-06：组内源禁选；1021-04：「所属来源组」单独一列（组名可点跳我的分组），当前流程列标「组统一配置」。
const { loadGroupNames, groupNameOf, openSourceGroup } = useSourceGroupNames()
/** 组内源：统一使用组流程，不允许单独关联本流程 */
function inGroup(source: Source): boolean {
  return !!source.sourceGroupId
}
function groupLabel(source: Source): string {
  return source.sourceGroupId ? `组统一配置：${groupNameOf(source.sourceGroupId)}` : ''
}

const rows = ref<Source[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const error = ref('')

/**
 * 「仅看未关联到本流程」的本地结果集（2026-11-09）：后端 `sourcePaged` 没有「不等于某流程」的条件
 * （`sourceCondParams` 里 flowId 是精确匹配），勾上后只能把当前筛选范围整个取回来再本地筛。
 * 这样 total / 翻页 / 全选全部才和前面的「源名称 / 所属网站 / 所属流程」是同一套口径，不会出现
 * 「共 637 条、但每页大半都被滤掉、页码也对不上」的情况。null 表示当前没走本地筛。
 * 判断口径与「当前流程」列一致（cs_source.FLOW_ID）；新关联表里的多流程绑定不在这个筛子里。
 */
const unboundRows = ref<Source[] | null>(null)
let unboundSignature = ''

/** 该源是否已按本流程运行（「当前流程」列与「仅看未关联」共用同一判断） */
function isBoundToFlow(source: Source): boolean {
  return !!props.flow && String(source.flowId ?? '') === String(props.flow.id)
}

/** 本地分页：把一整批源按当前页码切出一页 */
function pageSlice(list: Source[]): Source[] {
  const start = (page.value - 1) * PAGE_SIZE
  return list.slice(start, start + PAGE_SIZE)
}

const idImport = reactive({ open: false, text: '', loading: false })

// 「全选全部」一次把当前筛选下的所有源都选中（翻页选不完）。数量上限兜底：
// changeFlowBatch 单次 5000、前端按 500 分批，2 万以内都能收拾；再多先让用户收窄条件。
const SELECT_ALL_PAGE = 1000
const SELECT_ALL_MAX = 20_000
const selectingAll = ref(false)
// 「全选全部」快照（筛选签名 + 当时选中的 ID）：提交前复核据此只回补快照之后新进入范围的源，
// 用户全选后手动取消的源仍在快照里，不会被回补。
const selectAllSnapshot = ref<{ signature: string; ids: Set<string> } | null>(null)

// 选中态：modelValue 直接透传，另存名字缓存好在标签上显示
const CHIP_LIMIT = 15
const selectedSet = computed(() => new Set(props.modelValue))
const nameCache = ref(new Map<string, string>())
const selectedChips = computed(() =>
  props.modelValue.slice(0, CHIP_LIMIT).map((id) => ({ id, name: nameCache.value.get(id) || '' })),
)
const chipsMore = computed(() => Math.max(0, props.modelValue.length - CHIP_LIMIT))
function setSelected(ids: string[]) {
  emit('update:modelValue', [...new Set(ids)])
}
function toggle(source: Source) {
  if (inGroup(source)) {
    ElMessage.warning(groupLabel(source) || '该源在来源组内，流程由组统一配置，不能单独关联')
    return
  }
  nameCache.value.set(source.sourceId, source.name)
  const next = selectedSet.value.has(source.sourceId)
    ? props.modelValue.filter((id) => id !== source.sourceId)
    : [...props.modelValue, source.sourceId]
  setSelected(next)
}
function pickPage() {
  const pickable = visibleRows.value.filter((s) => !inGroup(s))
  pickable.forEach((s) => nameCache.value.set(s.sourceId, s.name))
  setSelected([...props.modelValue, ...pickable.map((s) => s.sourceId)])
}
function clearSelected() {
  setSelected([])
  chipsExpanded.value = false
  selectAllSnapshot.value = null
}

/** 当前筛选范围超过全量取回的上限：本地筛也要先取全，取不动就先请用户收窄 */
class RangeTooLargeError extends Error {}

/**
 * 按同一套筛选把当前范围下的源全部取回来（1106 §4.5）：「全选全部」「仅看未关联」与提交前范围复核
 * 共用，保证几条路径取的是同一批数据，不会出现「全选时带了这个网站，复核时漏掉」。
 */
async function fetchAllServerRows(): Promise<Source[]> {
  const first = await sourceApi.sourcePaged(buildQuery({ page: 1, size: SELECT_ALL_PAGE }))
  if (first.total > SELECT_ALL_MAX) {
    throw new RangeTooLargeError(`匹配 ${first.total} 个，太多了——请先用「源名称」「所属网站」或「所属流程」收窄`)
  }
  const collected = [...first.list]
  for (let p = 2; first.list.length === SELECT_ALL_PAGE && collected.length < first.total; p++) {
    const res = await sourceApi.sourcePaged(buildQuery({ page: p, size: SELECT_ALL_PAGE }))
    if (!res.list.length) break
    collected.push(...res.list)
    if (res.list.length < SELECT_ALL_PAGE) break
  }
  return collected
}

async function fetchAllMatching(): Promise<{ rows: Source[]; picked: Source[] }> {
  const collected = await fetchAllServerRows()
  const rows = onlyUnbound.value && props.flow
    ? collected.filter((s) => !isBoundToFlow(s))
    : collected
  // 1008-06：组内源不能单独关联，全选/复核都跳过
  return { rows, picked: rows.filter((s) => !inGroup(s)) }
}

/** 当前筛选下全选（「仅看未关联」同样生效；范围过大由 fetchAllServerRows 拦下） */
async function pickAllMatching() {
  if (selectingAll.value) return
  selectingAll.value = true
  const signature = filterSignature()
  try {
    const { rows, picked } = await fetchAllMatching()
    picked.forEach((s) => nameCache.value.set(s.sourceId, s.name))
    const next = [...props.modelValue, ...picked.map((s) => s.sourceId)]
    setSelected(next)
    // 快照：提交前复核据此只回补"全选之后才进入范围"的源；用户随后手动取消的源仍在快照里，不会被回补
    selectAllSnapshot.value = { signature, ids: new Set(next) }
    const skipped = rows.length - picked.length
    ElMessage.success(`已选中全部 ${picked.length} 个源${skipped ? `（跳过 ${skipped} 个组内源）` : ''}`)
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    if (e instanceof RangeTooLargeError) ElMessage.warning(msg)
    else ElMessage.error(`全选失败：${msg}`)
  } finally {
    selectingAll.value = false
  }
}

// 表格渲染的当前页行：普通模式直接用服务端分页结果；「仅看未关联」模式用本地筛完再切页
// （见 unboundRows 注释），两者都不在这里再做逐行过滤，避免 total 与页面口径不一致。
const visibleRows = computed(() => rows.value)

function flowTag(source: Source): { text: string; cls: string } {
  const fid = String(source.flowId ?? '')
  if (!fid) return { text: '无流程', cls: 'none' }
  if (props.flow && fid === String(props.flow.id)) return { text: `流程: ${fid}`, cls: 'self' }
  return { text: `流程: ${fid}`, cls: 'other' }
}
function stateText(source: Source): string {
  if (source.disabled) return '停用'
  return source.state === 'E' ? '异常' : source.state === 'L' ? '运行中' : '正常'
}

/**
 * 搜索框写着「按源名称 / ID 搜索」，但后端 `name` 只匹配名称，输 ID 命中 0 条（2026-10-19 用户反馈
 * 301288849 按名称能找到、按 ID 找不到）。与 FlowSourcesDialog 同口径：纯数字当源 ID 查，其余按名称查。
 */
function keywordQuery(): { sourceId?: string; name?: string } {
  const q = keyword.value.trim()
  if (!q) return {}
  return /^\d+$/.test(q) ? { sourceId: q } : { name: q }
}

/**
 * 统一查询构造（1106 §4.5）：普通列表、翻页、全选本页、全选全部、提交前复核都从这里取参数，
 * 保证每条路径带的是同一套筛选（关键字 / 所属网站 / 所属流程 / 分页）。网站范围继续走服务端
 * `siteIds`（不退化成本地过滤，避免「看似全部、其实只有本页」）。
 */
function buildQuery(overrides: { page?: number; size?: number } = {}) {
  return {
    ...keywordQuery(),
    flowId: flowFilter.value || undefined,
    siteIds: siteFilter.value || undefined,
    page: overrides.page ?? page.value,
    size: overrides.size ?? PAGE_SIZE,
  }
}

/** 当前筛选的签名：判断「全选全部」的快照是否还对得上当前条件 */
function filterSignature(): string {
  const q = buildQuery({ page: 1, size: 0 })
  return JSON.stringify([q.sourceId ?? '', q.name ?? '', q.flowId ?? '', q.siteIds ?? '', onlyUnbound.value])
}

let reqId = 0
async function load() {
  const id = ++reqId
  loading.value = true
  error.value = ''
  try {
    // 「仅看未关联」：整个筛选范围取回来，本地筛完再分页——和前面的条件同一口径
    if (onlyUnbound.value && props.flow) {
      const signature = filterSignature()
      let all = unboundRows.value
      if (!all || unboundSignature !== signature) {
        const collected = await fetchAllServerRows()
        if (id !== reqId) return
        all = collected.filter((s) => !isBoundToFlow(s))
        unboundRows.value = all
        unboundSignature = signature
      }
      if (id !== reqId) return
      total.value = all.length
      rows.value = pageSlice(all)
      rememberRowSiteNames(all)
      return
    }
    const res = await sourceApi.sourcePaged(buildQuery())
    if (id !== reqId) return
    unboundRows.value = null
    unboundSignature = ''
    rows.value = res.list
    total.value = res.total
    rememberRowSiteNames(res.list)
  } catch (e) {
    if (id !== reqId) return
    unboundRows.value = null
    unboundSignature = ''
    rows.value = []
    total.value = 0
    const msg = (e as Error)?.message ?? String(e)
    error.value = e instanceof RangeTooLargeError ? msg : `加载源列表失败：${msg}`
  } finally {
    if (id === reqId) loading.value = false
  }
}

/**
 * 任何筛选条件变化（网站 / 所属流程 / 关键字 / 未绑定开关）都作废本次待关联勾选并回第 1 页。
 * 不清的话，先勾了 A 网站的源再切到 B 网站，提交时会把 A 的源一起带过去（§4.5 明确禁止）。
 */
function onFilterChange() {
  clearSelected()
  page.value = 1
  void load()
}

let kwTimer: ReturnType<typeof setTimeout> | undefined
function onKeyword() {
  clearTimeout(kwTimer)
  kwTimer = setTimeout(onFilterChange, 300)
}
function onOnlyUnboundChange(e: Event) {
  onlyUnbound.value = (e.target as HTMLInputElement).checked
  onFilterChange()
}

/**
 * 提交前范围复核（§4.5）：先按 ID 回查一次勾选项，再按当前筛选回补「全选全部」之后的新增源。
 *  - 已删除 / 已并入来源组 / 查不到的源剔除并提示（已有保留）；ID 批量检索进来的源不受当前筛选限制。
 *  - 用「全选全部」选过、且筛选条件没变的，把快照之后新进入范围的源补进来（缺则补）；
 *    用户全选后手动取消的源仍在快照里，不会被回补。
 * 复核接口失败不拦提交：宁可少校验一次，也不能把用户的显式动作卡死。
 */
async function revalidateSelection(): Promise<boolean> {
  const ids = [...new Set(props.modelValue)].filter(Boolean)
  if (!ids.length) return false
  let next = ids
  let dropped = 0
  try {
    const res = await sourceApi.sourcePaged({ sourceIds: ids, page: 1, size: ids.length })
    const found = new Map(res.list.map((s) => [s.sourceId, s]))
    next = ids.filter((id) => {
      const s = found.get(id)
      return !!s && !inGroup(s)
    })
    dropped = ids.length - next.length
  } catch {
    // 复核失败不拦提交，沿用原选择
  }

  let added: string[] = []
  const snapshot = selectAllSnapshot.value
  if (snapshot && snapshot.signature === filterSignature()) {
    try {
      const { picked } = await fetchAllMatching()
      added = picked.map((s) => s.sourceId).filter((id) => !next.includes(id) && !snapshot.ids.has(id))
    } catch {
      // 回补失败不拦提交
    }
  }

  if (dropped || added.length) {
    next = [...new Set([...next, ...added])]
    setSelected(next)
    if (dropped) ElMessage.warning(`提交前复核：${dropped} 个源已不可关联（已删除或已并入来源组），已从本次选择中移除`)
    if (added.length) ElMessage.info(`提交前复核：筛选范围内新增 ${added.length} 个源，已一并加入本次关联`)
  }
  if (!next.length) ElMessage.warning('勾选的源已全部不可关联，请重新选择要关联的源')
  return next.length > 0
}

const confirming = ref(false)
/** 点「确认关联」：先做提交前范围复核，再交给父级做二次确认和分批提交 */
async function onConfirm() {
  if (confirming.value || !props.modelValue.length) return
  confirming.value = true
  let ok = false
  try {
    ok = await revalidateSelection()
  } finally {
    confirming.value = false
  }
  if (ok) emit('confirm')
}

// 成功关联后父级会清空选择：快照一起丢弃，避免下次复核误回补
watch(() => props.modelValue.length, (len) => {
  if (!len) selectAllSnapshot.value = null
})

// 网站名缓存（2026-11-09）：`sourcePaged` 返回的 siteName 常常是空的（旧分页响应只给 siteId），
// 表格「网站」列就只剩一个认不出的数字。打开时先拉一份网站清单补名字（同 SourceOverviewView 的做法，
// 217 网站总量在 2000 条以内），再加上下拉搜索命中的网站和行里自带的 siteName 一起累积。
const siteNameById = ref<Record<string, string>>({})

function rememberSiteNames(entries: { id: string; name: string }[]) {
  if (!entries.length) return
  const next = { ...siteNameById.value }
  let changed = false
  for (const e of entries) {
    if (e.id && e.name && next[e.id] !== e.name) {
      next[e.id] = e.name
      changed = true
    }
  }
  if (changed) siteNameById.value = next
}
function rememberRowSiteNames(list: Source[]) {
  rememberSiteNames(list.map((s) => ({ id: String(s.siteId ?? ''), name: s.siteName ?? '' })))
}
/** 「网站」列显示：优先行里的 siteName，其次缓存里的网站名，最后退回 ID（总比空着强） */
function siteNameOf(source: Source): string {
  const id = String(source.siteId ?? '')
  if (!id) return '—'
  return source.siteName || siteNameById.value[id] || id
}

// 远程搜索会把候选项换成新的 30 条，当前选中的网站在里面查不到时 el-select 会退化成显示裸 ID；
// 把当前选中项补回列表，让筛选框始终显示网站名。
const siteSelectOptions = computed(() => {
  const cur = siteFilter.value
  if (!cur || siteOptions.value.some((o) => o.id === cur)) return siteOptions.value
  return [{ id: cur, name: siteNameById.value[cur] || cur }, ...siteOptions.value]
})

// 所属网站下拉：远程按名字搜网站（site/sitePaged 的 name 走 query，见 siteApi）
async function searchSites(q: string) {
  const kw = q.trim()
  siteOptLoading.value = true
  try {
    // 打开时（关键字为空）多取一些，顺手把网站名整份缓存下来给表格用；输入关键字时只取前 30 条候选项
    const res = await siteApi.sitePaged({ name: kw || undefined, page: 1, size: kw ? 30 : 2000 })
    siteOptions.value = res.list.map((site) => ({ id: site.siteId, name: site.name }))
    rememberSiteNames(siteOptions.value)
  } catch {
    siteOptions.value = []
  } finally {
    siteOptLoading.value = false
  }
}

// 所属流程下拉：远程按名字搜流程
async function searchFlows(q: string) {
  flowOptLoading.value = true
  try {
    const res = await flowCenterApi.paged({ keywords: q.trim() || undefined, page: 1, size: 30 })
    flowOptions.value = res.list.map((f) => ({ id: f.id, name: f.name }))
  } catch {
    flowOptions.value = []
  } finally {
    flowOptLoading.value = false
  }
}

async function submitByIds() {
  const ids = [...new Set(idImport.text.split(/[,，\n\s]+/).map((s) => s.trim()).filter(Boolean))]
  if (!ids.length) { ElMessage.warning('请输入源 ID'); return }
  idImport.loading = true
  try {
    const res = await sourceApi.sourcePaged({ sourceIds: ids, page: 1, size: ids.length })
    const found = res.list
    const missing = ids.filter((x) => !found.some((s) => s.sourceId === x))
    if (!found.length) { ElMessage.warning(`未找到匹配的源：${missing.join('、')}`); return }
    // 1008-06：组内源不能单独关联，ID 检索也跳过
    const pickable = found.filter((s) => !inGroup(s))
    const skipped = found.length - pickable.length
    pickable.forEach((s) => nameCache.value.set(s.sourceId, s.name))
    setSelected([...props.modelValue, ...pickable.map((s) => s.sourceId)])
    let msg = `已选中 ${pickable.length} 个源`
    if (skipped) msg += `；跳过 ${skipped} 个组内源`
    if (missing.length) msg += `；${missing.length} 个未找到：${missing.join('、')}`
    ElMessage.success(msg)
    idImport.text = ''
    idImport.open = false
  } catch (e) {
    ElMessage.error(`检索失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    idImport.loading = false
  }
}

// 选中多了就把标签墙收起来，只留一行汇总，点「展开」再看
const chipsExpanded = ref(false)
const showChips = computed(() => props.modelValue.length > 0 && (props.modelValue.length <= CHIP_LIMIT || chipsExpanded.value))

let lastFlowId = ''
watch(() => props.flow?.id, (id) => {
  if (!id) return
  // 换目标流程：上一次的勾选不属于这次关联，作废（首次打开不清，父级会重置；页签切换重挂载也不清）
  const switched = !!lastFlowId && lastFlowId !== String(id)
  lastFlowId = String(id)
  keyword.value = ''
  flowFilter.value = ''
  siteFilter.value = ''
  onlyUnbound.value = false
  chipsExpanded.value = false
  selectAllSnapshot.value = null
  if (switched) clearSelected()
  page.value = 1
  idImport.open = false
  idImport.text = ''
  void load()
  void loadGroupNames()
  void searchFlows('')
  void searchSites('')
}, { immediate: true })
</script>

<template>
  <component
    :is="embedded ? 'div' : ElDialog"
    v-bind="embedded ? { class: 'fsp-embedded' } : { modelValue: !!flow, title: flow ? `关联流程到源 · ${flow.name}` : '关联流程到源', width: '920px', top: '6vh', destroyOnClose: true }"
    @close="emit('close')"
  >
    <p class="fsp-note">
      勾选要关联的源，可多选。关联后这些源将<b>共用本流程的配置并按它运行</b>；此后修改这个流程的配置会同时影响它们。
    </p>
    <p class="fsp-note fsp-note-sub" data-testid="fsp-note-not-default">
      「添加关联」不等于「设为默认流程」：这里只决定这些源按哪个流程运行，源的默认流程/来源组绑定仍在来源与分组里维护。
    </p>

    <div class="fsp-filters">
      <input
        v-model="keyword"
        class="fsp-input"
        data-testid="fsp-keyword"
        placeholder="按源名称 / ID 搜索"
        @input="onKeyword"
      >
      <el-select
        v-model="siteFilter"
        class="fsp-flow"
        data-testid="fsp-site-filter"
        filterable
        remote
        clearable
        placeholder="所属网站（全部）"
        :remote-method="searchSites"
        :loading="siteOptLoading"
        @change="onFilterChange"
      >
        <el-option v-for="o in siteSelectOptions" :key="o.id" :label="`${o.name}（${o.id}）`" :value="o.id" />
      </el-select>
      <el-select
        v-model="flowFilter"
        class="fsp-flow"
        data-testid="fsp-flow-filter"
        filterable
        remote
        clearable
        placeholder="所属流程（全部）"
        :remote-method="searchFlows"
        :loading="flowOptLoading"
        @change="onFilterChange"
      >
        <el-option v-for="o in flowOptions" :key="o.id" :label="`${o.name}（${o.id}）`" :value="o.id" />
      </el-select>
      <label class="fsp-check">
        <input :checked="onlyUnbound" type="checkbox" data-testid="fsp-only-unbound" @change="onOnlyUnboundChange"> 仅看未关联到本流程
      </label>
      <button class="fsp-btn" type="button" @click="idImport.open = !idImport.open">
        {{ idImport.open ? '收起 ID 批量检索' : 'ID 批量检索' }}
      </button>
    </div>

    <div v-if="idImport.open" class="fsp-idimport">
      <textarea v-model="idImport.text" class="fsp-idbox" placeholder="粘贴源 ID，逗号或换行分隔" rows="2" />
      <button class="fsp-btn primary" type="button" :disabled="idImport.loading" @click="submitByIds">
        {{ idImport.loading ? '检索中…' : '加入选择' }}
      </button>
    </div>

    <div class="fsp-selbar">
      <button type="button" class="fsp-linkbtn" data-testid="fsp-pick-page" title="只勾选当前这一页的源（不含来源组内的源）" @click="pickPage">全选本页</button>
      <button
        v-if="total > visibleRows.length"
        type="button"
        class="fsp-linkbtn"
        data-testid="fsp-pick-all"
        title="按当前筛选（网站 / 流程 / 关键字）勾选全部源，不只是本页；不含来源组内的源"
        :disabled="selectingAll"
        @click="pickAllMatching"
      >{{ selectingAll ? '取全部中…' : `全选全部（共 ${total} 条）` }}</button>
      <span class="fsp-selbar-gap" />
      <span class="fsp-selected" data-testid="fsp-selected-count">已选 {{ modelValue.length }}</span>
      <button v-if="modelValue.length > CHIP_LIMIT" type="button" class="fsp-linkbtn" @click="chipsExpanded = !chipsExpanded">
        {{ chipsExpanded ? '收起' : '展开' }}
      </button>
      <button v-if="modelValue.length" type="button" class="fsp-linkbtn" @click="clearSelected">清空</button>
    </div>

    <div v-if="showChips" class="fsp-chips" data-testid="fsp-chips">
      <span v-for="c in selectedChips" :key="c.id" class="fsp-chip">
        {{ c.name || c.id }}
        <button type="button" class="fsp-chip-x" @click="toggle({ sourceId: c.id } as Source)">✕</button>
      </span>
      <span v-if="chipsMore" class="fsp-chip-more">…等 {{ chipsMore }} 个</span>
    </div>

    <div class="fsp-table-wrap" v-loading="loading">
      <table class="fsp-table">
        <thead>
          <tr>
            <th class="fsp-check-col" />
            <th>源 ID</th><th>源名称</th><th>网站</th><th>所属来源组</th><th>状态</th><th>当前流程</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="s in visibleRows"
            :key="s.sourceId"
            :class="{ picked: selectedSet.has(s.sourceId), 'in-group': inGroup(s) }"
            @click="toggle(s)"
          >
            <td class="fsp-check-col"><input type="checkbox" :checked="selectedSet.has(s.sourceId)" :disabled="inGroup(s)" data-testid="fsp-row-check" @click.stop="toggle(s)"></td>
            <td class="fsp-mono">{{ s.sourceId }}</td>
            <td>{{ s.name }}</td>
            <td :title="s.siteId ? `网站 ID：${s.siteId}` : ''">{{ siteNameOf(s) }}</td>
            <td>
              <button v-if="s.sourceGroupId" class="fsp-group-link" type="button" :title="`到「我的分组」查看 ${groupNameOf(s.sourceGroupId)}`" data-testid="fsp-group-name" @click.stop="openSourceGroup(s.sourceGroupId)">{{ groupNameOf(s.sourceGroupId) }}</button>
              <span v-else class="fsp-muted">—</span>
            </td>
            <td>{{ stateText(s) }}</td>
            <td>
              <template v-if="inGroup(s)">
                <span class="fsp-flowtag group" :title="groupLabel(s)" data-testid="fsp-group-tag">组统一配置</span>
              </template>
              <span v-else class="fsp-flowtag" :class="flowTag(s).cls">{{ flowTag(s).text }}</span>
            </td>
          </tr>
          <tr v-if="!visibleRows.length && !loading">
            <td colspan="7" class="fsp-empty">{{ error || (onlyUnbound ? '没有未关联到本流程的源' : '没有匹配的源') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="fsp-pager">
      <el-pagination
        v-model:current-page="page"
        :total="total"
        :page-size="PAGE_SIZE"
        layout="total, prev, pager, next, jumper"
        background
        size="small"
        @current-change="load"
      />
    </div>

    <p v-if="progress" class="fsp-note" data-testid="flow-apply-progress">{{ progress }}</p>

    <template v-if="!embedded" #footer>
      <button class="fsp-btn" type="button" @click="emit('close')">取消</button>
      <button
        class="fsp-btn primary"
        type="button"
        data-testid="flow-apply-confirm"
        :disabled="submitting || confirming || !modelValue.length"
        @click="onConfirm"
      >{{ submitting ? '关联中…' : confirming ? '复核中…' : `确认关联（${modelValue.length} 个）` }}</button>
    </template>
    <div v-if="embedded" class="fsp-embedded-foot">
      <button class="fsp-btn" type="button" @click="emit('close')">取消</button>
      <button
        class="fsp-btn primary"
        type="button"
        data-testid="flow-apply-confirm"
        :disabled="submitting || confirming || !modelValue.length"
        @click="onConfirm"
      >{{ submitting ? '关联中…' : confirming ? '复核中…' : `确认关联（${modelValue.length} 个）` }}</button>
    </div>
  </component>
</template>

<style scoped>
.fsp-embedded-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.fsp-note { margin: 0 0 10px; color: var(--rc-text-2); font-size: 12px; line-height: 1.6; }
.fsp-note-sub { color: var(--rc-faint); }
.fsp-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 8px; }
.fsp-input { height: 28px; width: 220px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 6px; font-size: 12px; outline: none; }
.fsp-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.fsp-flow { width: 220px; }
.fsp-flow :deep(.el-select__wrapper) { min-height: 28px; font-size: 12px; }
.fsp-check { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--rc-text-2); }
.fsp-selbar { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; padding: 6px 10px; border: 1px solid var(--rc-border-soft); border-radius: 7px; background: #f8fafc; font-size: 12px; }
.fsp-selbar-gap { flex: 1; }
.fsp-selected { color: var(--rc-primary); font-weight: 600; }
.fsp-btn { height: 28px; padding: 0 12px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text-2); font-size: 12px; cursor: pointer; }
.fsp-btn:hover:not(:disabled) { border-color: var(--rc-primary); color: var(--rc-primary-ink); }
.fsp-btn.primary { background: var(--rc-primary); border-color: var(--rc-primary); color: #fff; }
.fsp-btn:disabled { opacity: .5; cursor: not-allowed; }
.fsp-idimport { display: flex; gap: 8px; margin-bottom: 8px; }
.fsp-idbox { flex: 1; padding: 6px 8px; border: 1px solid var(--rc-border); border-radius: 6px; font-size: 12px; resize: vertical; }
.fsp-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; max-height: 88px; overflow-y: auto; }
.fsp-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; border-radius: 10px; background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-size: 11px; }
.fsp-chip-x { border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 10px; padding: 0; }
.fsp-chip-more { align-self: center; color: var(--rc-faint); font-size: 11px; }
.fsp-table-wrap { max-height: 44vh; overflow: auto; border: 1px solid var(--rc-border-soft); border-radius: 8px; }
.fsp-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.fsp-table th { position: sticky; top: 0; z-index: 1; background: #f8fafc; color: var(--rc-text-2); font-weight: 700; text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--rc-border); }
.fsp-table td { padding: 8px 12px; border-bottom: 1px solid var(--rc-border-soft); }
.fsp-table tbody tr { cursor: pointer; }
.fsp-table tbody tr:hover { background: var(--rc-primary-bg); }
.fsp-table tbody tr.picked { background: var(--rc-primary-bg); }
.fsp-check-col { width: 60px; text-align: center; }
.fsp-mono { font-family: var(--rc-mono, monospace); color: var(--rc-faint); }
.fsp-empty { padding: 24px 12px; text-align: center; color: var(--rc-faint); }
.fsp-linkbtn { border: 0; background: transparent; color: var(--rc-primary); font-size: 12px; cursor: pointer; padding: 0; }
.fsp-linkbtn:hover:not(:disabled) { text-decoration: underline; }
.fsp-linkbtn:disabled { color: var(--rc-faint); cursor: not-allowed; }
.fsp-flowtag { padding: 1px 6px; border-radius: 4px; font-size: 10px; white-space: nowrap; }
.fsp-flowtag.self { background: var(--rc-ok-bg, #ecfdf5); color: var(--rc-ok, #059669); border: 1px solid currentColor; }
.fsp-flowtag.other { background: #fffbeb; color: #b45309; border: 1px solid #fcd34d; }
.fsp-flowtag.none { background: #f1f5f9; color: var(--rc-faint); border: 1px solid var(--rc-border); }
.fsp-flowtag.group { background: #eef2ff; color: #4f46e5; border: 1px solid #c7d2fe; }
.fsp-group-link { padding: 0; border: 0; background: none; color: var(--rc-primary-ink); cursor: pointer; text-align: left; }
.fsp-group-link:hover { text-decoration: underline; }
.fsp-muted { color: var(--rc-faint); }
.fsp-table tbody tr.in-group { background: #f8fafc; color: var(--rc-faint); }
.fsp-table tbody tr.in-group:hover { background: #f1f5f9; }
.fsp-table tbody tr.in-group td.fsp-check-col input:disabled { cursor: not-allowed; }
.fsp-pager { display: flex; justify-content: flex-end; margin-top: 8px; }
</style>
