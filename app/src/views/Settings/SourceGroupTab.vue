<script setup lang="ts">
/**
 * 源管理「来源组」目录页签（1008-03，10-09 改定方案）。
 *
 * 放哪：源管理（`CollectAssets/index.vue`）的「我的分组」页签。10-13 曾移到系统设置、源管理只读；
 * 同日 leo 定：「先把功能上上去，管理员也是在源管理里面改」，迁回源管理并可编辑，系统设置不再有这一页（权限后面再管）。
 * 界面复用「我的分组」（`PersonalSources.vue`）的布局：左边组列表（可搜索，成员数按可见行限流加载），右边成员源列表；
 * 来源组独有的东西（流程配置、组资料）放右侧抽屉。数据不合并——「我的分组」是本机个人目录，
 * 来源组是后端 `source-group/*` 配置（决定组内源跑哪条流程，只有管理员能改）。
 *
 * 契约：
 * - 写接口只允许 admin；非 admin 全部写按钮禁用并提示。
 * - 任何写操作完成后（包括失败）重新拉 `list` 与当前组绑定，刷新 `revision`（旧平台 act() 做法，
 *   避免乐观锁冲突后一直报「已被修改」）。
 * - 错误直接展示后端 msg，不包一层「操作失败」。
 * - 成员源列表复用 `SourceOverviewView`，用 `scopeSourceGroupId` 走 `sourcePaged` 服务端筛选
 *   （2026-10-09 实测支持），255 个成员的组天然翻页。
 */
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, FolderOpened, Plus, Refresh, Search } from '@element-plus/icons-vue'
import { sourceGroupApi, flowCenterApi, sourceApi, type Source, type SourceGroup, type SourceGroupState, type SourceFlowBind, type FlowRecord } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { recordSiteVisit } from '@/utils/siteRecents'
import { trackClick } from '@/utils/logEvents'
import SourceOverviewView from '@/views/FlowCanvas/result/SourceOverviewView.vue'
import FlowDetailDrawer from '@/views/FlowCenter/FlowDetailDrawer.vue'
import GroupSourcePicker from '@/views/CollectAssets/GroupSourcePicker.vue'
import FlowPickerDialog from '@/views/CollectAssets/FlowPickerDialog.vue'
import BizDirTreePanel, { type PickedBizDir } from '@/views/CollectAssets/BizDirTreePanel.vue'
import SourceGroupFlowDiffDrawer from './SourceGroupFlowDiffDrawer.vue'
import { bizDirGroupIds, resetBizDirGroupCache } from '@/api/sourceDirs'

const auth = useAuthStore()
// 2026-10-13：本页挂在源管理「我的分组」（从系统设置迁回，管理员也在这里改），不再有只读模式
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const canWrite = computed(() => auth.role === 'admin')

// ---- 左侧组列表 ----
const groups = ref<SourceGroup[]>([])
const loading = ref(false)
const selectedGroupId = ref<string>('')
const selectedGroup = computed(() => groups.value.find((g) => g.sourceGroupId === selectedGroupId.value) ?? null)
const diffGroup = ref<SourceGroup | null>(null)
const diffDefaultFlowLabel = ref('')
function openFlowDiff() {
  if (!selectedGroup.value) return
  diffGroup.value = { ...selectedGroup.value }
  diffDefaultFlowLabel.value = flowLabel(selectedGroup.value.defaultFlowId)
}
/** 左侧列表按组名 / 编码 / ID 筛（前端过滤，list 接口一次返回全部组） */
const groupKeyword = ref('')
const visibleGroups = computed(() => {
  const keyword = groupKeyword.value.trim().toLowerCase()
  const inDir = dirGroupIds.value
  return groups.value.filter((g) => (!inDir || inDir.has(g.sourceGroupId))
    && (!keyword || [g.sourceGroupName, g.sourceGroupCode, g.sourceGroupId].some((v) => v?.toLowerCase().includes(keyword))))
})

/**
 * 按业务目录筛组（1030 会议议题 5，10-31 定按成员推导、只读）：组内有源在所选目录（含子目录）里就算。
 * 来源组本身不挂目录，所以没有「未分类」；大目录要翻十几页，显示进度。
 * 10-31：目录从下拉框改为业务目录树（BizDirTreePanel，样式同系统目录面板）；单独一栏太占宽度，
 * 收进来源组这一栏：点「按业务目录筛选」时目录树在原地替换组列表，点「完成」收起。
 * 10-31 用户：可选多个目录，取并集——组内有源在任一所选目录（含子级）里就显示（同系统目录多选口径）。
 */
const bizDirs = ref<PickedBizDir[]>([])
const bizDirIds = computed(() => bizDirs.value.map((d) => d.id))
/** 范围条文案：两个以内全列，再多只列前两个 + 总数（全名在悬停提示里） */
const bizDirLabel = computed(() => {
  const names = bizDirs.value.map((d) => d.path)
  return names.length <= 2 ? names.join('、') : `${names.slice(0, 2).join('、')} 等 ${names.length} 个目录`
})
const dirOpen = ref(false)
const dirGroupIds = ref<Set<string> | null>(null)
const dirLoading = ref(false)
const dirProgress = ref('')
const dirError = ref('')
/** 目录里的组数（不受搜索框影响；visibleGroups 还叠了关键字） */
const dirGroupCount = computed(() => {
  const inDir = dirGroupIds.value
  return inDir ? groups.value.filter((g) => inDir.has(g.sourceGroupId)).length : 0
})
let dirSeq = 0
async function onBizDirChange(dirs: PickedBizDir[]) {
  bizDirs.value = dirs
  const reqId = ++dirSeq
  dirError.value = ''
  dirProgress.value = ''
  if (!dirs.length) {
    dirGroupIds.value = null
    dirLoading.value = false
    return
  }
  dirLoading.value = true
  try {
    // 逐个目录统计再取并集（每个目录内部已并发翻页、有缓存，多目录不再叠加并发）
    const union = new Set<string>()
    for (const [i, dir] of dirs.entries()) {
      const ids = await bizDirGroupIds(dir.id, (done, total) => {
        if (reqId === dirSeq && (total > 1 || dirs.length > 1)) {
          dirProgress.value = dirs.length > 1 ? `统计中 第 ${i + 1}/${dirs.length} 个目录 ${done}/${total}` : `统计中 ${done}/${total}`
        }
      })
      if (reqId !== dirSeq) return
      ids.forEach((id) => union.add(id))
    }
    dirGroupIds.value = union
  } catch (error) {
    if (reqId === dirSeq) {
      dirGroupIds.value = null
      dirError.value = `业务目录筛选失败：${error instanceof Error ? error.message : String(error)}`
    }
  } finally {
    if (reqId === dirSeq) {
      dirLoading.value = false
      dirProgress.value = ''
    }
  }
}

/** 只查视口内的组，最多 3 个请求；离开视口的未开始请求不排队。 */
const groupList = ref<HTMLElement>()
const memberCounts = ref<Record<string, number | null>>({})
const visibleCountIds = new Set<string>()
const pendingCountIds = new Set<string>()
let countObserver: IntersectionObserver | undefined
let countsActive = false
let countRequests = 0
let countVersion = 0

function loadVisibleCounts(): void {
  if (!countsActive) return
  for (const id of visibleCountIds) {
    if (countRequests >= 3) break
    if (id in memberCounts.value || pendingCountIds.has(id)) continue
    const version = countVersion
    countRequests++
    pendingCountIds.add(id)
    void sourceApi.sourcePaged({ page: 1, size: 1, sourceGroupId: id }).then((page) => {
      if (version === countVersion) memberCounts.value[id] = page.total
    }).catch(() => {
      if (version === countVersion) memberCounts.value[id] = null
    }).finally(() => {
      countRequests--
      pendingCountIds.delete(id)
      loadVisibleCounts()
    })
  }
}

function resetMemberCounts(): void {
  countVersion++
  memberCounts.value = {}
  loadVisibleCounts()
}

function observeMemberCounts(): void {
  countsActive = true
  if (typeof IntersectionObserver === 'undefined') return
  countObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const id = (entry.target as HTMLElement).dataset.groupId!
      if (entry.isIntersecting) visibleCountIds.add(id)
      else visibleCountIds.delete(id)
    }
    loadVisibleCounts()
  }, { root: groupList.value })
  groupList.value?.querySelectorAll<HTMLElement>('[data-group-id]').forEach((el) => countObserver!.observe(el))
}

const vMemberCount = {
  mounted(el: HTMLElement) { countObserver?.observe(el) },
  beforeUnmount(el: HTMLElement) {
    countObserver?.unobserve(el)
    visibleCountIds.delete(el.dataset.groupId!)
  },
}

function stopMemberCounts(): void {
  countsActive = false
  countObserver?.disconnect()
  visibleCountIds.clear()
}

/** 成员变了（本页或其他页面改了来源组成员）：成员数重查，目录推导结果作废，已选目录重新统计 */
watch(() => ui.sourceListRevision, () => {
  resetMemberCounts()
  resetBizDirGroupCache()
  if (bizDirs.value.length) void onBizDirChange(bizDirs.value)
})
onMounted(observeMemberCounts)
onActivated(observeMemberCounts)
onDeactivated(stopMemberCounts)
onUnmounted(() => { stopMemberCounts(); countVersion++ })

/** 所有流程候选（排除 state=D）；选项显示「名称 · ID」 */
const flows = ref<FlowRecord[]>([])
function flowLabel(id?: string | null): string {
  if (id == null || id === '') return '未配置 / 暂不可用'
  const flow = flows.value.find((f) => f.id === id)
  return flow ? `${flow.name} · ${id}` : `流程 ${id}`
}

// ---- 右侧工具条 / 抽屉状态 ----
const flowDrawer = ref(false)
const detailDrawer = ref(false)
const detailFlow = ref<FlowRecord | null>(null)

// ---- 流程配置抽屉 ----
const groupBindings = ref<SourceFlowBind[]>([])
const groupBindingsLoaded = ref(false)
/** 编辑框的关联流程（只取启用中的 flowIds，不能把停用行带进去——bindFlows 会把列表里没有的全部停用） */
const flowIds = ref<string[]>([])
/** 编辑框的默认流程（来自 bindings 里 isDefault=1 那行，含停用） */
const defaultFlowId = ref<string>('')
const savingFlows = ref(false)
function defaultFromBindings(rows: SourceFlowBind[]): string {
  const row = rows.find((r) => r.isDefault)
  return row ? row.flowId : ''
}
/** 关联流程用流程选择弹窗挑（与源流程配置同一个，1030 议题 3），回填到 flowIds */
const flowPickerOpen = ref(false)
function onFlowsPicked(picked: FlowRecord[]): void {
  for (const flow of picked) {
    if (flow.name && !flows.value.some((f) => f.id === flow.id)) flows.value = [...flows.value, flow]
  }
  flowIds.value = picked.map((f) => f.id)
  if (!flowIds.value.includes(defaultFlowId.value)) defaultFlowId.value = flowIds.value.length === 1 ? flowIds.value[0]! : ''
  flowPickerOpen.value = false
}
function removeFlowId(id: string): void {
  flowIds.value = flowIds.value.filter((x) => x !== id)
  if (defaultFlowId.value === id) defaultFlowId.value = ''
}

// ---- 组资料抽屉 ----
const editingGroup = ref<{ sourceGroupId: string; revision: number; sourceGroupCode: string; sourceGroupName: string; description: string; state: SourceGroupState } | null>(null)
const savingGroup = ref(false)

// ---- 新建来源组弹窗 ----
const creating = ref(false)
const newCode = ref('')
const newName = ref('')
const newDescription = ref('')
const creatingGroup = ref(false)

// ---- 成员操作 ----
const selectedIds = ref<string[]>([])
const moveTarget = ref('')
const pickerVisible = ref(false)

/** 请求序号防串台：快速切组 / 刷新时旧响应不得覆盖新选中 */
let listRequest = 0
let bindingRequest = 0

async function reloadGroups(): Promise<void> {
  const request = ++listRequest
  loading.value = true
  try {
    const rows = await sourceGroupApi.list()
    if (request !== listRequest) return
    groups.value = rows
    resetMemberCounts()
    // 选中组被删 / 刷新后不存在 → 清空选中
    if (selectedGroupId.value && !rows.some((g) => g.sourceGroupId === selectedGroupId.value)) {
      selectedGroupId.value = ''
    }
    if (selectedGroupId.value) {
      await loadGroupDetail(selectedGroupId.value)
    }
  } catch (error) {
    if (request === listRequest) ElMessage.error((error as Error)?.message ?? String(error))
  } finally {
    if (request === listRequest) loading.value = false
  }
}

async function loadFlows(): Promise<void> {
  try {
    const rows = await flowCenterApi.list()
    flows.value = rows.filter((f) => f.state !== 'D')
  } catch (error) {
    ElMessage.error((error as Error)?.message ?? String(error))
  }
}

function selectGroup(id: string): void {
  selectedGroupId.value = id
  void loadGroupDetail(id)
}

async function loadGroupDetail(id: string): Promise<void> {
  const request = ++bindingRequest
  groupBindingsLoaded.value = false
  groupBindings.value = []
  flowIds.value = selectedGroup.value ? [...selectedGroup.value.flowIds] : []
  defaultFlowId.value = ''
  selectedIds.value = []
  const group = groups.value.find((g) => g.sourceGroupId === id)
  if (!group) return
  try {
    const bindings = await sourceGroupApi.bindings({ sourceGroupId: id })
    if (request !== bindingRequest) return
    groupBindings.value = bindings
    defaultFlowId.value = defaultFromBindings(bindings)
    groupBindingsLoaded.value = true
  } catch (error) {
    if (request === bindingRequest) ElMessage.error((error as Error)?.message ?? String(error))
  }
}

/** 打开组流程配置抽屉：重新拉一次绑定（revision 可能已变） */
function openFlowDrawer(): void {
  if (!selectedGroup.value) return
  flowDrawer.value = true
  void loadGroupDetail(selectedGroup.value.sourceGroupId)
}

function openDetailDrawer(): void {
  if (!selectedGroup.value) return
  detailDrawer.value = true
  editingGroup.value = selectedGroup.value
    ? { sourceGroupId: selectedGroup.value.sourceGroupId, revision: selectedGroup.value.revision, sourceGroupCode: selectedGroup.value.sourceGroupCode, sourceGroupName: selectedGroup.value.sourceGroupName, description: selectedGroup.value.description ?? '', state: selectedGroup.value.state }
    : null
}

/** 保存组流程（bindFlows 整体替换；编辑初值只取启用中的 flowIds） */
async function saveFlows(): Promise<void> {
  const group = selectedGroup.value
  if (!canWrite.value || !group) return
  if (!groupBindingsLoaded.value) {
    ElMessage.warning('请先成功加载组绑定，再保存流程')
    return
  }
  if (group.state !== 'ACTIVE') {
    ElMessage.warning('组已停用，请先在「组资料」中启用后修改流程列表')
    return
  }
  if (flowIds.value.length && !flowIds.value.includes(defaultFlowId.value)) {
    ElMessage.warning('请选择关联列表中的默认流程')
    return
  }
  savingFlows.value = true
  try {
    await sourceGroupApi.bindFlows({
      sourceGroupId: group.sourceGroupId,
      revision: group.revision,
      flowIds: flowIds.value,
      defaultFlowId: flowIds.value.length ? defaultFlowId.value : null,
    })
    ElMessage.success('组流程已保存')
  } catch (error) {
    ElMessage.error((error as Error)?.message ?? String(error))
  } finally {
    savingFlows.value = false
  }
  void reloadGroups()
}

/** 绑定状态表：启用 / 停用一条绑定（启用时组没有默认流程会被后端拒绝，前端先拦） */
async function toggleBindingState(row: SourceFlowBind): Promise<void> {
  if (!canWrite.value) return
  const next = row.state === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
  if (next === 'ACTIVE' && !defaultFlowId.value) {
    ElMessage.warning('请先设置默认流程，再启用这条绑定')
    return
  }
  try {
    await sourceGroupApi.updateBindingState(row, next)
    ElMessage.success(next === 'ACTIVE' ? '已启用' : '已停用')
  } catch (error) {
    ElMessage.error((error as Error)?.message ?? String(error))
  }
  void reloadGroups()
}

/** 保存组资料（带 revision；状态变更二次确认） */
async function saveGroupDetail(): Promise<void> {
  const group = editingGroup.value
  if (!canWrite.value || !group) return
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(group.sourceGroupCode.trim())) {
    ElMessage.warning('组编码需以字母 / 数字开头，可含字母、数字、下划线、连字符，最长 64 位')
    return
  }
  if (!group.sourceGroupName.trim()) {
    ElMessage.warning('请填写组名称')
    return
  }
  const stateChanged = selectedGroup.value?.state !== group.state
  if (stateChanged && group.state === 'DISABLED') {
    try {
      await ElMessageBox.confirm(`停用「${group.sourceGroupName.trim()}」后，全部成员不能启动新任务。确定停用？`, '确认停用来源组', { type: 'warning' })
    } catch {
      return
    }
  }
  savingGroup.value = true
  try {
    await sourceGroupApi.update({
      sourceGroupId: group.sourceGroupId,
      revision: group.revision,
      sourceGroupCode: group.sourceGroupCode.trim(),
      sourceGroupName: group.sourceGroupName.trim(),
      description: group.description.trim(),
      state: group.state,
    })
    ElMessage.success('组资料已保存')
    detailDrawer.value = false
  } catch (error) {
    ElMessage.error((error as Error)?.message ?? String(error))
  } finally {
    savingGroup.value = false
  }
  void reloadGroups()
}

/** 删除来源组：先确认没有成员，有成员直接提示不发请求 */
async function removeGroup(): Promise<void> {
  const group = selectedGroup.value
  if (!canWrite.value || !group) return
  try {
    const page = await sourceGroupApi.members(group.sourceGroupId, 0, 1)
    if (page.rows.length > 0) {
      // members 只取了 1 条用来判断有没有成员、没有 total；数量另用 sourcePaged 按组筛的 count，取不到就不报数
      const count = await sourceApi.sourcePaged({ page: 1, size: 1, sourceGroupId: group.sourceGroupId }).then((r) => r.total).catch(() => 0)
      ElMessage.warning(`「${group.sourceGroupName}」还有${count ? ` ${count} 个` : ''}成员，请先移出全部成员再删除`)
      return
    }
  } catch (error) {
    ElMessage.error((error as Error)?.message ?? String(error))
    return
  }
  try {
    await ElMessageBox.confirm(`确定删除来源组「${group.sourceGroupName}」（#${group.sourceGroupId}）？`, '确认删除来源组', { type: 'warning' })
  } catch {
    return
  }
  try {
    await sourceGroupApi.remove({ sourceGroupId: group.sourceGroupId, revision: group.revision })
    ElMessage.success('来源组已删除')
    selectedGroupId.value = ''
    detailDrawer.value = false
  } catch (error) {
    ElMessage.error((error as Error)?.message ?? String(error))
  }
  void reloadGroups()
}

/** 新建来源组（成功后选中新组，打开「流程配置」抽屉） */
async function createGroup(): Promise<void> {
  if (!canWrite.value) return
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(newCode.value.trim())) {
    ElMessage.warning('组编码需以字母 / 数字开头，可含字母、数字、下划线、连字符，最长 64 位')
    return
  }
  if (!newName.value.trim()) {
    ElMessage.warning('请填写组名称')
    return
  }
  creatingGroup.value = true
  const code = newCode.value.trim()
  try {
    await sourceGroupApi.add({
      sourceGroupCode: code,
      sourceGroupName: newName.value.trim(),
      description: newDescription.value.trim() || undefined,
    })
    ElMessage.success('来源组已创建')
    creating.value = false
    newCode.value = ''
    newName.value = ''
    newDescription.value = ''
    await reloadGroups()
    // 按组编码找新组（list 的顺序后端没约定，不能取末尾），选中它并打开「流程配置」抽屉
    const created = groups.value.find((g) => g.sourceGroupCode === code)
    if (created) {
      selectGroup(created.sourceGroupId)
      flowDrawer.value = true
    }
  } catch (error) {
    ElMessage.error((error as Error)?.message ?? String(error))
  } finally {
    creatingGroup.value = false
  }
}

/** 移出选中成员（target=null，expected=本组） */
async function removeMembers(): Promise<void> {
  const group = selectedGroup.value
  if (!canWrite.value || !group || !selectedIds.value.length) return
  try {
    await sourceGroupApi.changeMembers({ sourceIds: selectedIds.value, sourceGroupId: null, expectedSourceGroupId: group.sourceGroupId })
    ElMessage.success(`已移出 ${selectedIds.value.length} 个来源`)
  } catch (error) {
    ElMessage.error((error as Error)?.message ?? String(error))
  }
  afterMemberChange()
}

/** 成员变了（包括失败，可能部分生效）：右侧成员列表重查，左侧组列表 / 成员数 / revision 重拉 */
function afterMemberChange(): void {
  ui.notifySourceListChanged()
  void reloadGroups()
}

/** 换到其他组（选目标组，expected=本组） */
async function moveMembers(): Promise<void> {
  const group = selectedGroup.value
  if (!canWrite.value || !group || !selectedIds.value.length) return
  if (!moveTarget.value || moveTarget.value === group.sourceGroupId) {
    ElMessage.warning('请选择目标组（不能是当前组）')
    return
  }
  const targetName = groups.value.find((g) => g.sourceGroupId === moveTarget.value)?.sourceGroupName ?? ''
  try {
    await ElMessageBox.confirm(`把这 ${selectedIds.value.length} 个来源换入「${targetName}」？加入后统一使用目标组流程。`, '确认换组', { type: 'warning' })
  } catch {
    return
  }
  try {
    await sourceGroupApi.changeMembers({ sourceIds: selectedIds.value, sourceGroupId: moveTarget.value, expectedSourceGroupId: group.sourceGroupId })
    ElMessage.success(`已换入 ${selectedIds.value.length} 个来源`)
    moveTarget.value = ''
  } catch (error) {
    ElMessage.error((error as Error)?.message ?? String(error))
  }
  afterMemberChange()
}

/** 打开源：与网站详情「源视图」同一落点（SourceTab.openSourceFromList 同口径）。
 *  同样记一笔「最近打开的网站」——「我的分组」也是源管理的常见入口，不记会漏掉一整条进入路径。 */
function openSource(source: Source, view: 'overview' | 'data' = 'overview'): void {
  if (source.siteId && source.siteId !== '0') recordSiteVisit(source.siteId, source.siteName)
  trackClick('SOURCE', source.sourceId, source.name, {
    eventCode: 'source_open',
    eventName: '打开源',
    firstModule: '采集资产',
    pageName: '我的分组',
  })
  void router.push({
    path: '/canvas',
    query: { ...(source.siteId && source.siteId !== '0' ? { siteId: source.siteId } : {}), sourceId: source.sourceId, view, ...(view === 'data' && source.mainTable ? { tableId: source.mainTable } : {}), returnTo: route.fullPath },
  })
}

/** 打开网站（源列表里的「所属网站」链接）：同样记一笔 */
function openSite(siteId: string): void {
  recordSiteVisit(siteId)
  void router.push({ path: '/canvas', query: { siteId, view: 'source', returnTo: route.fullPath } })
}

/** 查看流程节点：拉详情后打开 FlowDetailDrawer */
async function openFlowDetail(flowId: string): Promise<void> {
  try {
    detailFlow.value = await flowCenterApi.detail(flowId)
  } catch (error) {
    ElMessage.error((error as Error)?.message ?? String(error))
  }
}

watch(selectedGroup, () => {
  if (!selectedGroup.value) return
  editingGroup.value = {
    sourceGroupId: selectedGroup.value.sourceGroupId,
    revision: selectedGroup.value.revision,
    sourceGroupCode: selectedGroup.value.sourceGroupCode,
    sourceGroupName: selectedGroup.value.sourceGroupName,
    description: selectedGroup.value.description ?? '',
    state: selectedGroup.value.state,
  }
}, { immediate: true })

onMounted(() => {
  void loadFlows()
  void reloadGroups()
  // 1008-04：从源列表点来源组名跳过来（/collect?tab=personal&group=<id>）时，选中该组
  const fromQuery = String(route.query.group ?? '')
  if (fromQuery && /^\d+$/.test(fromQuery)) {
    selectedGroupId.value = fromQuery
  }
})
// 同页签内再次点来源组名（tab 没变，KeepAlive 不重挂）：watch query.group 选中新组
watch(() => route.query.group, (id) => {
  if (id != null && /^\d+$/.test(String(id))) selectGroup(String(id))
})
</script>

<template>
  <div class="sg-tab">
    <el-alert
      v-if="!canWrite"
      title="当前账号仅可查看，修改需要管理员权限"
      type="info"
      :closable="false"
      class="sg-perm-alert"
    />
    <div class="sg-body">
      <aside class="sg-nav">
        <div class="sg-heading">
          <strong>来源组</strong>
          <button class="sg-icon-btn bordered" type="button" title="新建来源组" aria-label="新建来源组" :disabled="!canWrite" data-testid="sg-new" @click="creating = true"><el-icon><Plus /></el-icon></button>
        </div>
        <el-input
          v-model="groupKeyword"
          class="sg-search"
          size="small"
          :prefix-icon="Search"
          clearable
          placeholder="搜索组名 / 编码 / ID"
          data-testid="sg-search"
        />
        <!-- 选了业务目录：显示范围和统计结果，× 清除（同系统目录汇总行的目录范围） -->
        <button
          v-if="!bizDirs.length"
          class="sg-dir-trigger"
          :class="{ open: dirOpen }"
          type="button"
          :aria-expanded="dirOpen"
          data-testid="sg-biz-dir-open"
          @click="dirOpen = !dirOpen"
        >
          <el-icon><FolderOpened /></el-icon><span>按业务目录筛选</span><el-icon class="sg-dir-arrow"><ArrowDown /></el-icon>
        </button>
        <div v-else class="sg-dir-scope" :class="{ error: dirError }" data-testid="sg-biz-dir-hint">
          <div class="sg-dir-line">
            <button class="sg-dir-name" type="button" :title="`${bizDirs.map((d) => d.path).join('\n')}\n（点击更换目录）`" :aria-expanded="dirOpen" data-testid="sg-biz-dir-change" @click="dirOpen = !dirOpen">业务目录：<b>{{ bizDirLabel }}</b>（含子级）</button>
            <button class="sg-dir-clear" type="button" title="清除目录范围" aria-label="清除目录范围" data-testid="sg-biz-dir-clear" @click="onBizDirChange([])">×</button>
          </div>
          <small>{{ dirError || (dirLoading ? (dirProgress || '统计中…') : `${bizDirs.length > 1 ? `所选 ${bizDirs.length} 个目录` : '该目录'}下 ${dirGroupCount} 个组（按成员推导）`) }}</small>
        </div>
        <!-- v-show：收起后保留展开状态，再打开还在原位置 -->
        <BizDirTreePanel v-show="dirOpen" class="sg-dir-tree" :selected="bizDirIds" @select="onBizDirChange" @close="dirOpen = false" />
        <div v-show="!dirOpen" ref="groupList" class="sg-list">
          <button
            v-for="g in visibleGroups"
            v-member-count
            :key="g.sourceGroupId"
            :data-group-id="g.sourceGroupId"
            type="button"
            class="sg-item"
            :class="{ active: g.sourceGroupId === selectedGroupId, disabled: g.state !== 'ACTIVE' }"
            @click="selectGroup(g.sourceGroupId)"
          >
            <span>{{ g.sourceGroupName }}<i v-if="g.state !== 'ACTIVE'" class="sg-off">停用</i></span>
            <!-- 1030 议题 5：加载中骨架、失败「!」、加载完显示数字（与网站卡片源数同风格） -->
            <small
              class="sg-count"
              :class="{ loading: memberCounts[g.sourceGroupId] === undefined, failed: memberCounts[g.sourceGroupId] === null }"
              :title="memberCounts[g.sourceGroupId] === null ? '成员数加载失败，刷新后重试' : memberCounts[g.sourceGroupId] === undefined ? '成员数加载中' : `${memberCounts[g.sourceGroupId]} 个成员`"
            >{{ memberCounts[g.sourceGroupId] === null ? '!' : memberCounts[g.sourceGroupId] ?? '' }}</small>
          </button>
          <div v-if="!groups.length" class="sg-empty">{{ loading ? '加载中…' : '暂无来源组' }}</div>
          <div v-else-if="!visibleGroups.length" class="sg-empty">没有匹配的来源组</div>
        </div>
        <p class="sg-note">来源组决定组内源跑哪条流程，修改影响全部成员；只有管理员能修改。</p>
      </aside>
      <section class="sg-content">
        <template v-if="selectedGroup">
          <div class="sg-toolbar">
            <strong>{{ selectedGroup.sourceGroupName }}</strong>
            <span class="sg-id">#{{ selectedGroup.sourceGroupId }}</span>
            <span class="sg-item-state" :class="selectedGroup.state === 'ACTIVE' ? 'on' : ''">{{ selectedGroup.state === 'ACTIVE' ? '启用' : '停用' }}</span>
            <span class="sg-flow" data-testid="sg-default-flow-label">
              默认流程：
              <a v-if="selectedGroup.defaultFlowId" href="javascript:;" @click="openFlowDetail(selectedGroup.defaultFlowId)">{{ flowLabel(selectedGroup.defaultFlowId) }}</a>
              <span v-else class="sg-faint">未配置 / 暂不可用</span>
            </span>
            <div class="sg-actions">
              <button class="sg-btn" type="button" data-testid="sg-flow-diff-btn" @click="openFlowDiff">查看流程差异</button>
              <button class="sg-btn" type="button" data-testid="sg-flow-btn" @click="openFlowDrawer">流程配置</button>
              <button class="sg-btn" type="button" data-testid="sg-detail-btn" @click="openDetailDrawer">组资料</button>
              <button class="sg-icon-btn" type="button" title="刷新" aria-label="刷新" :disabled="loading" @click="reloadGroups"><el-icon><Refresh /></el-icon></button>
            </div>
          </div>
          <SourceOverviewView
            :key="selectedGroup.sourceGroupId"
            current-site-id=""
            :scope-source-group-id="selectedGroup.sourceGroupId"
            scope-empty-text="该来源组还没有成员，可在源列表勾选后「调整来源组」，或点「添加源」"
            @open-source="openSource"
            @open-source-data="openSource($event, 'data')"
            @open-site="openSite"
          >
            <!-- 1030 议题 5：「添加源」放成员表操作区右侧，与系统目录「新增网站」同一位置 -->
            <template #filter-extra>
              <button
                class="sg-btn"
                type="button"
                :disabled="!canWrite || selectedGroup.state !== 'ACTIVE'"
                :title="selectedGroup.state !== 'ACTIVE' ? '组已停用，不能加入新成员' : '把源加入本组'"
                data-testid="sg-add-source"
                @click="pickerVisible = true"
              ><el-icon><Plus /></el-icon>添加源</button>
            </template>
            <template #selection-actions="{ ids }">
              <el-button size="small" data-testid="sg-remove-members" :disabled="!canWrite || !ids.length" @click="selectedIds = [...ids]; removeMembers()">移出来源组</el-button>
              <el-select
                v-model="moveTarget"
                size="small"
                placeholder="目标组"
                style="width: 150px"
                :disabled="!canWrite"
                data-testid="sg-move-target"
              >
                <el-option
                  v-for="g in groups"
                  :key="g.sourceGroupId"
                  :value="g.sourceGroupId"
                  :label="g.sourceGroupName"
                  :disabled="g.state !== 'ACTIVE' || g.sourceGroupId === selectedGroup.sourceGroupId"
                />
              </el-select>
              <el-button size="small" type="primary" plain data-testid="sg-move-members" :disabled="!canWrite || !ids.length || !moveTarget" @click="selectedIds = [...ids]; moveMembers()">换到其他组</el-button>
            </template>
          </SourceOverviewView>
        </template>
        <el-empty v-else :description="groups.length ? '请选择一个来源组查看成员' : '尚未创建来源组，可点左侧「新建」'" />
      </section>
    </div>

    <!-- 流程配置抽屉：结构与源流程配置抽屉（SourceFlowConfigDrawer）一致，关联流程用同一个流程选择弹窗 -->
    <el-drawer v-model="flowDrawer" :title="selectedGroup ? `流程配置 · ${selectedGroup.sourceGroupName}` : '流程配置'" size="480px" append-to-body>
      <div v-if="selectedGroup" class="sg-drawer-body">
        <p class="sg-drawer-meta">组 ID：{{ selectedGroup.sourceGroupId }} · 编码：{{ selectedGroup.sourceGroupCode }}</p>
        <el-alert title="组内来源统一使用以下流程，修改影响全部成员；需要单独配置的源请先退组" type="info" :closable="false" show-icon />
        <el-alert v-if="selectedGroup.state !== 'ACTIVE'" title="组已停用，请先在「组资料」中启用后修改流程列表" type="warning" :closable="false" show-icon />
        <p v-if="groupBindingsLoaded && defaultFlowId !== (selectedGroup.defaultFlowId ?? '')" class="sg-flow-summary warn" data-testid="sg-default-mismatch">
          配置的默认流程「{{ flowLabel(defaultFlowId) }}」当前不可用，组内任务暂用：{{ flowLabel(selectedGroup.defaultFlowId) }}
        </p>
        <h4 class="sg-section">组流程</h4>
        <div class="sg-form-row">
          <label>关联流程（可选多个）</label>
          <div class="sg-flow-tags" data-testid="sg-flow-ids">
            <el-tag
              v-for="id in flowIds"
              :key="id"
              :closable="canWrite && selectedGroup.state === 'ACTIVE'"
              disable-transitions
              :title="flowLabel(id)"
              @close="removeFlowId(id)"
            >{{ flowLabel(id) }}</el-tag>
            <span v-if="!flowIds.length" class="sg-hint">还没有关联流程</span>
          </div>
          <div>
            <el-button size="small" :disabled="!canWrite || selectedGroup.state !== 'ACTIVE'" data-testid="sg-pick-flows" @click="flowPickerOpen = true">选择流程</el-button>
          </div>
        </div>
        <div class="sg-form-row">
          <label>默认流程（未指定流程的任务使用此项）</label>
          <el-select
            v-model="defaultFlowId"
            placeholder="从关联流程中选择"
            style="width: 100%"
            :disabled="!canWrite || selectedGroup.state !== 'ACTIVE'"
            data-testid="sg-default-flow"
          >
            <el-option v-for="id in flowIds" :key="id" :value="id" :label="flowLabel(id)" />
          </el-select>
        </div>
        <div class="sg-form-row">
          <el-button
            type="primary"
            :disabled="!canWrite || !groupBindingsLoaded || selectedGroup.state !== 'ACTIVE' || savingFlows"
            :loading="savingFlows"
            data-testid="sg-save-flows"
            @click="saveFlows"
          >保存组流程</el-button>
        </div>
        <el-divider />
        <h4 class="sg-section">绑定状态</h4>
        <el-table :data="groupBindings" size="small" :empty-text="groupBindingsLoaded ? '暂无绑定' : '加载中…'" data-testid="sg-binding-table">
          <el-table-column label="流程" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">
              {{ flowLabel(row.flowId) }}
              <el-tag v-if="row.isDefault" size="small" type="primary" disable-transitions class="sg-default-tag">默认</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="96">
            <template #default="{ row }">
              <span class="sg-switch">
                <el-switch
                  :model-value="row.state === 'ACTIVE'"
                  size="small"
                  :disabled="!canWrite"
                  :aria-label="`切换 ${flowLabel(row.flowId)} 的绑定状态`"
                  data-testid="sg-binding-toggle"
                  @change="toggleBindingState(row)"
                />
                <span :class="{ off: row.state !== 'ACTIVE' }">{{ row.state === 'ACTIVE' ? '启用' : '停用' }}</span>
              </span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="76">
            <template #default="{ row }">
              <el-button link type="primary" size="small" title="查看流程节点" @click="openFlowDetail(row.flowId)">查看节点</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-drawer>

    <!-- 组资料抽屉：只读信息 + 表单，保存 / 删除放底部（删除靠左，与保存分开） -->
    <el-drawer v-model="detailDrawer" :title="editingGroup ? `组资料 · ${selectedGroup?.sourceGroupName ?? editingGroup.sourceGroupName}` : '组资料'" size="420px" append-to-body>
      <div v-if="editingGroup" class="sg-drawer-body">
        <dl class="sg-info">
          <dt>组 ID</dt><dd>{{ editingGroup.sourceGroupId }}</dd>
          <dt>成员数</dt><dd>{{ memberCounts[editingGroup.sourceGroupId] ?? '—' }}</dd>
          <dt>默认流程</dt><dd :title="flowLabel(selectedGroup?.defaultFlowId)">{{ flowLabel(selectedGroup?.defaultFlowId) }}</dd>
        </dl>
        <div class="sg-form-row">
          <label class="required">组编码</label>
          <el-input v-model="editingGroup.sourceGroupCode" :maxlength="64" :disabled="!canWrite" placeholder="字母 / 数字开头，可含 _ -，最长 64 位" data-testid="sg-code" />
        </div>
        <div class="sg-form-row">
          <label class="required">组名称</label>
          <el-input v-model="editingGroup.sourceGroupName" :maxlength="128" :disabled="!canWrite" data-testid="sg-name" />
        </div>
        <div class="sg-form-row">
          <label>描述</label>
          <el-input v-model="editingGroup.description" :maxlength="500" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" :disabled="!canWrite" />
        </div>
        <div class="sg-form-row">
          <label>状态</label>
          <span class="sg-switch">
            <el-switch v-model="editingGroup.state" active-value="ACTIVE" inactive-value="DISABLED" :disabled="!canWrite" aria-label="组状态" />
            <span :class="{ off: editingGroup.state !== 'ACTIVE' }">{{ editingGroup.state === 'ACTIVE' ? '启用' : '停用' }}</span>
          </span>
          <p class="sg-hint">停用组后，全部成员不能启动新任务。</p>
        </div>
      </div>
      <template #footer>
        <div class="sg-drawer-foot">
          <el-button type="danger" plain :disabled="!canWrite" title="删除前须先移出全部成员" data-testid="sg-remove" @click="removeGroup">删除来源组</el-button>
          <span class="sg-spacer" />
          <el-button @click="detailDrawer = false">取消</el-button>
          <el-button type="primary" :disabled="!canWrite || savingGroup" :loading="savingGroup" data-testid="sg-save-detail" @click="saveGroupDetail">保存组资料</el-button>
        </div>
      </template>
    </el-drawer>

    <!-- 新建来源组 -->
    <el-dialog v-model="creating" title="新建来源组" width="460px" append-to-body>
      <div class="sg-form-row">
        <label>组编码</label>
        <el-input v-model="newCode" :maxlength="64" placeholder="字母 / 数字开头，可含 _ -，最长 64 位" data-testid="sg-new-code" />
      </div>
      <div class="sg-form-row">
        <label>组名称</label>
        <el-input v-model="newName" :maxlength="128" data-testid="sg-new-name" />
      </div>
      <div class="sg-form-row">
        <label>描述</label>
        <el-input v-model="newDescription" :maxlength="500" type="textarea" :rows="2" />
      </div>
      <template #footer>
        <el-button @click="creating = false">取消</el-button>
        <el-button type="primary" :disabled="!canWrite || creatingGroup" :loading="creatingGroup" data-testid="sg-new-submit" @click="createGroup">保存新组</el-button>
      </template>
    </el-dialog>

    <!-- 添加源：复用「我的分组」的选源弹窗；backend 模式调 changeMembers 加入本组 -->
    <GroupSourcePicker
      v-if="selectedGroup"
      v-model="pickerVisible"
      :group-id="selectedGroup.sourceGroupId"
      :group-name="selectedGroup.sourceGroupName"
      :backend-mode="true"
      @saved="afterMemberChange"
    />

    <FlowDetailDrawer v-if="detailFlow" :flow="detailFlow" @close="detailFlow = null" />
    <SourceGroupFlowDiffDrawer v-if="diffGroup" :group="diffGroup" :default-flow-label="diffDefaultFlowLabel" @close="diffGroup = null" />
    <FlowPickerDialog v-if="flowPickerOpen" :selected="flowIds" :site-flow-counts="{}" hide-site-usage @close="flowPickerOpen = false" @confirm="onFlowsPicked" />
  </div>
</template>

<style scoped>
.sg-tab { display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 0; }
.sg-perm-alert { flex-shrink: 0; }
.sg-body { display: flex; gap: 12px; flex: 1; min-height: 0; }
/* 左栏与系统目录的目录面板（SourceDirPanel）同宽、同边框圆角 */
.sg-nav {
  width: 252px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 12px;
  border: 1px solid var(--rc-border);
  border-radius: 12px;
  background: #fff;
}
.sg-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; }
.sg-search { margin-top: 10px; }
/* 业务目录树：展开时与系统目录面板同宽，折叠成 36px 竖条 */
/* 业务目录入口：与搜索框同高，紫色是业务目录主题色（同 SourceDirPanel 业务目录） */
.sg-dir-trigger { display: flex; align-items: center; gap: 6px; width: 100%; height: 30px; margin-top: 8px; padding: 0 10px; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-faint); font-size: 12px; cursor: pointer; }
.sg-dir-trigger > span { flex: 1; text-align: left; }
.sg-dir-trigger:hover, .sg-dir-trigger.open { border-color: #c4b5fd; color: #7c3aed; }
.sg-dir-arrow { transition: transform .15s; }
.sg-dir-trigger.open .sg-dir-arrow { transform: rotate(180deg); }
.sg-dir-tree { flex: 1; min-height: 0; margin-top: 8px; }
.sg-dir-scope { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; padding: 6px 8px; border-radius: 6px; background: #f5f3ff; font-size: 12px; color: var(--rc-text-2); }
.sg-dir-scope small { font-size: 12px; color: var(--rc-faint); }
.sg-dir-scope.error small { color: var(--rc-error); }
.sg-dir-line { display: flex; align-items: center; gap: 4px; }
.sg-dir-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0; border: 0; background: none; color: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.sg-dir-name b { color: #7c3aed; font-weight: 600; }
.sg-dir-clear { flex: none; width: 18px; height: 18px; padding: 0; border: 0; border-radius: 50%; background: none; color: #7c3aed; cursor: pointer; line-height: 18px; }
.sg-dir-clear:hover { background: #ede9fe; }
.sg-list { flex: 1; min-height: 0; overflow-y: auto; margin-top: 8px; display: flex; flex-direction: column; gap: 2px; }
.sg-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  width: 100%;
  flex: none;
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--rc-text);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.sg-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; }
.sg-count { flex-shrink: 0; color: var(--rc-muted); font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
.sg-count.loading { width: 18px; height: 10px; border-radius: 3px; background: linear-gradient(90deg, #eef2f7 25%, #e2e8f0 50%, #eef2f7 75%); background-size: 200% 100%; animation: sg-shimmer 1.2s linear infinite; }
.sg-count.failed { color: var(--rc-error, #dc2626); }
@keyframes sg-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.sg-item:hover { background: #f1f5f9; }
.sg-item.active { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.sg-item.disabled { color: var(--rc-faint); }
.sg-off {
  font-style: normal;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: #e2e8f0;
  color: #64748b;
}
.sg-note { font-size: 12px; color: var(--rc-muted); line-height: 1.6; }
.sg-empty { color: var(--rc-faint); font-size: 12px; padding: 12px 8px; text-align: center; }
.sg-content { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.sg-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid var(--rc-border-soft);
  border-radius: 8px;
  margin-bottom: 8px;
  font-size: 13px;
  flex-wrap: wrap;
}
.sg-id { color: var(--rc-faint); font-size: 12px; }
.sg-item-state { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--rc-muted); }
.sg-item-state::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--rc-faint); }
.sg-item-state.on { color: var(--rc-ok); }
.sg-item-state.on::before { background: var(--rc-ok); }
.sg-flow { font-size: 12px; color: var(--rc-text-2); }
.sg-flow a { color: var(--el-color-primary); }
.sg-faint { color: var(--rc-faint); }
.sg-actions { display: flex; align-items: center; margin-left: auto; gap: 8px; }
/* 按钮沿用源管理的紧凑描边按钮（SourceTab .ca-save-view.sm）和图标按钮（MyViews .mv-icon-btn） */
.sg-btn { display: inline-flex; align-items: center; gap: 4px; height: 30px; padding: 0 10px; border: 1px solid #d5e2f2; border-radius: 6px; background: #fff; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.sg-btn:hover:not(:disabled) { border-color: var(--rc-primary); color: var(--rc-primary); }
.sg-btn:disabled { opacity: .5; cursor: not-allowed; }
.sg-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--rc-muted); font-size: 16px; cursor: pointer; flex: none; }
.sg-icon-btn.bordered { border: 1px solid var(--rc-border); background: #fff; }
.sg-icon-btn:hover:not(:disabled) { background: var(--rc-primary-bg, #eff6ff); color: var(--rc-primary); }
.sg-icon-btn:disabled { opacity: .5; cursor: not-allowed; }
.sg-drawer-body { display: flex; flex-direction: column; gap: 12px; }
.sg-flow-summary { font-size: 12px; color: var(--rc-text-2); margin: 0; }
.sg-form-row { display: flex; flex-direction: column; gap: 4px; }
.sg-form-row > label { font-size: 12px; color: var(--rc-text-2); }
.sg-hint { font-size: 12px; color: var(--rc-faint); margin: 0; }
.sg-flow-summary.warn { color: #b45309; }
.sg-drawer-meta { margin: 0; font-size: 12px; color: var(--rc-text-2); }
.sg-section { margin: 0; color: var(--rc-text); font-size: 13px; font-weight: 650; }
.sg-flow-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.sg-flow-tags .el-tag { max-width: 100%; }
.sg-flow-tags :deep(.el-tag__content) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sg-default-tag { margin-left: 4px; }
.sg-drawer-body :deep(.el-divider) { margin: 4px 0; }
/* 开关旁写明状态（AGENTS 控件约定），停用态中性灰 */
.sg-switch { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--rc-text-2); }
.sg-switch .off { color: var(--rc-faint); }
.sg-form-row .sg-switch { align-self: flex-start; }
.sg-form-row > label.required::before { content: '*'; margin-right: 2px; color: var(--rc-error); }
.sg-info { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 6px 8px; margin: 0; padding: 10px 12px; border-radius: 8px; background: #f8fafc; font-size: 12px; }
.sg-info dt { color: var(--rc-faint); }
.sg-info dd { margin: 0; color: var(--rc-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sg-drawer-foot { display: flex; align-items: center; gap: 8px; }
.sg-spacer { flex: 1; }
/* 查询栏两行，与「我的视图」（MyViews.vue）一致：条件按比例铺满一行，按钮行靠右。
   组内范围已限定，没有「来源组」筛选，比我的视图少一列 */
.sg-content :deep(.sov-filter.is-compact) {
  display: grid; align-items: center; gap: 8px;
  grid-template-columns: minmax(270px, 3fr) minmax(72px, 1.1fr) minmax(64px, 1fr) minmax(64px, 1fr) minmax(56px, .9fr);
}
.sg-content :deep(.sov-filter.is-compact .sov-field),
.sg-content :deep(.sov-filter.is-compact label) { min-width: 0; }
.sg-content :deep(.sov-filter.is-compact .sov-search input) { min-width: 0; }
.sg-content :deep(.sov-filter.is-compact .sov-filter-actions) { grid-column: 1 / -1; justify-self: end; margin-left: 0; }
@media (max-width: 1100px) { .sg-nav { width: 170px; } }
</style>
