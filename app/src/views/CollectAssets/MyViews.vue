<script setup lang="ts">
/**
 * 源管理「我的视图」目录版（2026-10-13，原型 `设计稿/原型设计/源管理_我的视图_目录树原型_2026-10-13.html`，
 * 方案 `设计稿/设计方案/1013-我的视图目录版_开发设计方案_2026-10-13.md`）。
 *
 * 一个视图 = 用户自建的一套目录（广发、浦发各一套），只有自己能看到。左边：视图下拉 + 目录树；
 * 右边：选中目录里的源（10-14 定：没有根目录、父目录不汇总子目录），复用源列表 `SourceOverviewView`（`scopeSourceIds` 传算好的源 ID）。
 * 目录里可以放单个源，也可以绑定来源组（组里新加的源自动带进来；移出组的源留在目录里，10-15 确认）；随组带入的源可单独移出（排除，可恢复）。
 * 每次修改立即保存（真实接口：目录走分类接口、源走 changeSources，见 api/sourceViews.ts）。数据模型与操作见 viewDirs.ts。
 */
import { computed, h, onActivated, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, MoreFilled, Plus, Refresh, Setting, Star } from '@element-plus/icons-vue'
import { sourceApi, sourceGroupApi, type Source } from '@/api'
import { defaultDisplay, sourceViewApi, sourceViewBackend, type SourceView, type SourceViewBackend, type ViewDisplay } from '@/api/sourceViews'
import { useAuthStore } from '@/stores/auth'
import { useSourceGroupsStore } from '@/stores/sourceGroups'
import { recordSiteVisit } from '@/utils/siteRecents'
import { trackClick } from '@/utils/logEvents'
import SourceOverviewView from '@/views/FlowCanvas/result/SourceOverviewView.vue'
import { HIDEABLE_SOURCE_COLUMNS, SOURCE_SORT_FIELDS, blankSourceListViewState, type SourceListViewState } from '@/views/FlowCanvas/result/sourceListViewState'
import SaveViewDialog from './SaveViewDialog.vue'
import GroupSourcePicker from './GroupSourcePicker.vue'
import ViewDirTree, { type DirCommand } from './ViewDirTree.vue'
import { clearGroupMembersCache, loadGroupMembers } from './groupMembers'
import {
  addDir, addSources, allIds, bindGroup, boundGroups, childrenOf, deleteDir, descendantIds, dirById, emptyTree, groupIdsIn, missingOf, moveSources,
  onlyViaGroup, pathOf, pathText, placesOf, removeSources, renameDir, resolveIds, restoreExcluded, unbindGroup,
  type GroupMembers, type ViewContainer, type ViewTree,
} from './viewDirs'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const directories = useSourceGroupsStore()
const userId = computed(() => (auth.info?.id != null ? String(auth.info.id) : ''))

// ---- 视图 ----
const views = ref<SourceView[]>([])
const loadError = ref('')
const activeId = ref('')
const active = computed(() => views.value.find((v) => v.viewId === activeId.value) ?? null)
/** 当前视图的目录树（真实接口下切视图时现读） */
const tree = ref<ViewTree>(emptyTree())
const treeLoading = ref(false)
const treeError = ref('')
/** 选中的目录；'' = 还没有目录 */
const selectedDir = ref('')
const backend = ref<SourceViewBackend | null>(null)
const localLeft = ref(0)
const importing = ref(false)
const saving = ref(false)

// ---- 来源组 ----
const members = ref<GroupMembers>({})
const membersError = ref('')
const groupNames = ref(new Map<string, string>())
const groupName = (id: string) => groupNames.value.get(id) ?? `#${id}`
async function loadGroupNames() {
  try { groupNames.value = new Map((await sourceGroupApi.list()).map((g) => [g.sourceGroupId, g.sourceGroupName])) } catch { /* 拿不到就显示 #ID */ }
}
async function loadMembers() {
  membersError.value = ''
  const ids = boundGroups(tree.value)
  if (!ids.length) { members.value = {}; return }
  try {
    members.value = await loadGroupMembers(ids)
  } catch (e) {
    membersError.value = `来源组成员加载失败：${e instanceof Error ? e.message : String(e)}`
  }
}
watch(() => boundGroups(tree.value).join(','), () => void loadMembers())

// ---- 派生 ----
const scopeIds = computed(() => resolveIds(tree.value, selectedDir.value, members.value))
/** 每次保存成功加 1：按 viewCategoryId 查时参数不变，靠它让源列表重查 */
const scopeVersion = ref(0)
/**
 * 真实接口下按目录让后端查（sourcePaged 的 viewCategoryId = 目录里的源 ∪ 来源组当前成员 − 排除），不再拼源 ID。
 * 本机兜底没有分类 ID，传前端算好的源 ID。
 */
const viewCategoryScope = computed(() => (backend.value === 'remote' && selectedDir.value ? selectedDir.value : undefined))
const counts = computed(() => {
  const out: Record<string, number> = {}
  for (const d of tree.value.dirs) out[d.id] = resolveIds(tree.value, d.id, members.value).length
  return out
})
const totalCount = computed(() => allIds(tree.value, members.value).length)
const container = computed<ViewContainer>(() => dirById(tree.value, selectedDir.value) ?? { sources: [], groups: [], excluded: [] })
/** 1016：绑定来源组后组里新加、还没进这个目录的源（后端绑定时只带入当时的成员） */
const missingHere = computed(() => missingOf(container.value, members.value))
const missingByGroup = computed(() => Object.fromEntries(missingHere.value.map((m) => [m.groupId, m.ids])))
/** 来源组在这个目录里实际有几个源（扣掉排除和还没加入的） */
const groupInCount = (g: string) => groupIdsIn(container.value, g, members.value).filter((m) => !container.value.excluded.includes(m)).length
const pathLabel = computed(() => pathOf(tree.value, selectedDir.value).map((d) => d.name))
const targetLabel = computed(() => pathText(tree.value, selectedDir.value))
/** 移到目录的候选：除了当前目录，全部目录（按路径） */
const moveTargets = computed(() => tree.value.dirs
  .filter((d) => d.id !== selectedDir.value)
  .map((d) => ({ id: d.id, label: pathText(tree.value, d.id) }))
  .sort((a, b) => a.label.localeCompare(b.label, 'zh')))
const placeText = (sourceId: string) => placesOf(tree.value, sourceId, members.value, groupName).join('；')
const viaGroup = (sourceId: string) => {
  const g = onlyViaGroup(tree.value, selectedDir.value, sourceId, members.value)
  return g ? groupName(g) : ''
}

/** 源列表的显示设置（隐藏列 / 排序 / 每页条数）随视图保存；条件栏是临时筛选，不存 */
// 保存目录后视图对象会换新，但显示设置没变：经字符串中转，内容不变就不给源列表新对象，免得它再重查一次
const displayKey = computed(() => JSON.stringify(active.value?.display ?? defaultDisplay()))
const listState = computed<SourceListViewState>(() => {
  const d = JSON.parse(displayKey.value) as ViewDisplay
  return { ...blankSourceListViewState(), hiddenColumns: d.hiddenColumns, sortField: d.sortField, sortDirection: d.sortDirection, pageSize: d.pageSize }
})

// ---- 加载 ----
const onThisPage = () => route.path === '/collect' && route.query.tab === 'views'
async function load(preferId?: string) {
  loadError.value = ''
  try {
    views.value = await sourceViewApi.list(userId.value)
  } catch (e) {
    views.value = []
    loadError.value = e instanceof Error ? e.message : String(e)
    return
  }
  backend.value = sourceViewBackend()
  localLeft.value = backend.value === 'remote' ? sourceViewApi.localViews(userId.value).length : 0
  const wanted = preferId || String(route.query.viewId ?? '')
  const next = views.value.find((v) => v.viewId === wanted)
    ?? views.value.find((v) => v.viewId === activeId.value)
    ?? views.value.find((v) => v.isDefault)
    ?? views.value[0]
  selectView(next?.viewId ?? '', true)
}
function selectView(viewId: string, keepDir = false) {
  if (viewId !== activeId.value || !keepDir) selectedDir.value = ''
  activeId.value = viewId
  void loadTree()
  // 只在本页自己的地址上改（本页被 KeepAlive 缓存，跳到源详情后还活着，见 aa368d5）
  if (onThisPage() && route.query.viewId !== (viewId || undefined)) {
    void router.replace({ path: route.path, query: { ...route.query, viewId: viewId || undefined } })
  }
}
/** 读当前视图的目录树；选中的目录没了就选第一个一级目录 */
async function loadTree() {
  const view = active.value
  treeError.value = ''
  if (!view) { tree.value = emptyTree(); selectedDir.value = ''; return }
  treeLoading.value = true
  // 来源组成员可能在「我的分组」里改过：每次读目录都重新拉，不用上次的缓存
  clearGroupMembersCache()
  try {
    const loaded = await sourceViewApi.loadTree(userId.value, view)
    if (activeId.value !== view.viewId) return
    tree.value = loaded
    void loadMembers()
  } catch (e) {
    if (activeId.value !== view.viewId) return
    tree.value = emptyTree()
    treeError.value = `目录加载失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    if (activeId.value === view.viewId) treeLoading.value = false
  }
}

/** 保存修改后的目录树，返回保存后的树（新目录换成了真实 ID）。失败时前面的步骤可能已经生效，重读一次 */
async function commit(next: ViewTree, done?: string): Promise<ViewTree | null> {
  const view = active.value
  if (!view || saving.value) return null
  saving.value = true
  try {
    const saved = await sourceViewApi.saveTree(userId.value, view, tree.value, next)
    views.value = views.value.map((v) => (v.viewId === saved.view.viewId ? saved.view : v))
    tree.value = saved.tree
    scopeVersion.value += 1
    if (done) ElMessage.success(done)
    return saved.tree
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
    await load(view.viewId)
    return null
  } finally {
    saving.value = false
  }
}
/** 树的操作会校验（同名、上限等），出错直接提示，不发请求 */
function tryTree(fn: () => ViewTree): ViewTree | null {
  try { return fn() } catch (e) { ElMessage.warning(e instanceof Error ? e.message : String(e)); return null }
}

// ---- 视图：新建 / 重命名 / 默认 / 删除 ----
type NameMode = 'newView' | 'renameView'
const nameOpen = ref(false)
const nameMode = ref<NameMode>('newView')
const nameBusy = ref(false)
const nameError = ref('')
function openName(mode: NameMode) { nameMode.value = mode; nameError.value = ''; nameOpen.value = true }
async function submitName({ name, isDefault }: { name: string; isDefault: boolean }) {
  nameBusy.value = true
  nameError.value = ''
  try {
    if (nameMode.value === 'renameView' && active.value) {
      const saved = await sourceViewApi.update(userId.value, { viewId: active.value.viewId, revision: active.value.revision, viewName: name })
      views.value = views.value.map((v) => (v.viewId === saved.viewId ? saved : v))
    } else {
      const created = await sourceViewApi.add(userId.value, { viewName: name, tree: emptyTree(), isDefault })
      if (isDefault) setDefaultEntry()
      await load(created.viewId)
      ElMessage.success(`已新建视图「${created.viewName}」，先建目录，再往目录里添加源`)
    }
    nameOpen.value = false
  } catch (e) {
    nameError.value = e instanceof Error ? e.message : String(e)
  } finally {
    nameBusy.value = false
  }
}
function setDefaultEntry() {
  try { directories.setPreference('view') } catch { /* 偏好写失败不影响视图本身 */ }
}
async function onViewCommand(command: string) {
  const view = active.value
  if (!view) return
  if (command === 'rename') return openName('renameView')
  if (command === 'default') {
    try {
      const saved = await sourceViewApi.update(userId.value, { viewId: view.viewId, revision: view.revision, isDefault: true })
      setDefaultEntry()
      await load(saved.viewId)
      ElMessage.success('已设为默认进入：打开源管理直接进入这个视图')
    } catch (e) {
      ElMessage.error(e instanceof Error ? e.message : String(e))
    }
    return
  }
  if (command === 'delete') {
    try {
      await ElMessageBox.confirm(`删除视图「${view.viewName}」？里面的目录和目录里源的关联关系一起删除，源本身不受影响，删除后不能恢复。`, '删除视图', { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning', confirmButtonClass: 'el-button--danger' })
    } catch {
      return
    }
    try {
      await sourceViewApi.remove(userId.value, view)
      if (view.isDefault && directories.preference === 'view') directories.setPreference('system')
      activeId.value = ''
      await load()
      ElMessage.success(`已删除视图「${view.viewName}」`)
    } catch (e) {
      ElMessage.error(`删除失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

// ---- 目录：新建 / 重命名 / 删除 ----
async function askDirName(title: string, value = ''): Promise<string | null> {
  try {
    const { value: name } = await ElMessageBox.prompt('1–40 个字，同级不能重名', title, {
      inputValue: value, confirmButtonText: '确定', cancelButtonText: '取消',
      inputValidator: (v: string) => (!!v.trim() && v.trim().length <= 40) || '目录名称为1到40个字符',
    })
    return name.trim()
  } catch {
    return null
  }
}
/** parentId 为 null 时建一级目录 */
async function newDir(parentId: string | null) {
  const name = await askDirName(parentId ? `在「${pathText(tree.value, parentId)}」下新建子目录` : '新建目录')
  if (!name) return
  const next = tryTree(() => addDir(tree.value, parentId, name).tree)
  const saved = next && await commit(next)
  // 真实接口下新目录的 ID 换成了分类 ID，按「同级同名」找（同级不重名）
  if (saved) selectedDir.value = saved.dirs.find((d) => d.parentId === parentId && d.name === name)?.id ?? selectedDir.value
}
async function onDirCommand(command: DirCommand, id: string) {
  if (command === 'newChild') return newDir(id)
  if (command === 'addSources') { selectedDir.value = id; openPicker(); return }
  if (command === 'rename') {
    const d = dirById(tree.value, id)
    const name = d && await askDirName('重命名目录', d.name)
    if (!name) return
    const next = tryTree(() => renameDir(tree.value, id, name))
    if (next) await commit(next)
    return
  }
  if (command === 'delete') {
    const subCount = descendantIds(tree.value, id).length - 1
    const danger = { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' as const, confirmButtonClass: 'el-button--danger' }
    try {
      await ElMessageBox.confirm(`删除目录「${pathText(tree.value, id)}」？目录里的源只是不在这个视图里了，源本身不受影响。`, '删除目录', danger)
      // 10-14 定：有子目录时再提醒一次，确认后子目录和它们的源关联关系一起删
      if (subCount) await ElMessageBox.confirm(`「${pathText(tree.value, id)}」下还有 ${subCount} 个子目录，会一起删除，子目录里源的关联关系也一起删除（源本身不受影响）。确定继续？`, '目录下有子目录', { ...danger, confirmButtonText: '一起删除' })
    } catch {
      return
    }
    await commit(deleteDir(tree.value, id), subCount ? `已删除目录及 ${subCount} 个子目录` : '已删除目录')
  }
}
watch(tree, () => {
  if (!dirById(tree.value, selectedDir.value)) selectedDir.value = childrenOf(tree.value, null)[0]?.id ?? ''
})

// ---- 添加源 / 绑定来源组 ----
const pickerOpen = ref(false)
/** 打开选源弹窗时预选的来源组，以及是否只看「未在视图」的源（从提示条进来时） */
const pickerGroup = ref('')
const pickerMissingOnly = ref(false)
function openPicker(groupId = '', missingOnly = false) {
  pickerGroup.value = groupId
  pickerMissingOnly.value = missingOnly
  pickerOpen.value = true
}
async function onPick(ids: string[]) {
  const before = new Set(container.value.sources)
  const next = tryTree(() => addSources(tree.value, selectedDir.value, ids))
  if (next) await commit(next, `已添加 ${ids.filter((id) => !before.has(id)).length} 个源到「${targetLabel.value}」`)
}
async function onBindGroup(groupId: string) {
  await commit(bindGroup(tree.value, selectedDir.value, groupId), `已绑定来源组「${groupName(groupId)}」，组里现有的源已加入；之后组里新加的源会在这里提示，勾选后加入`)
}
/** 解绑时提示里最多列出这么多个源名 */
const UNBIND_LIST_MAX = 20
/** 源 ID → 「名称（ID）」；查不到名称就只显示 ID */
async function sourceLabels(ids: string[]): Promise<string[]> {
  try {
    const { list } = await sourceApi.sourcePaged({ page: 1, size: ids.length, sourceIds: ids.join(',') })
    const names = new Map(list.map((s) => [s.sourceId, s.name]))
    return ids.map((id) => (names.get(id) ? `${names.get(id)}（${id}）` : id))
  } catch {
    return ids
  }
}
/**
 * 解绑来源组（10-15 定）：组里当前的源会跟着从这个目录移出，先列出来问要不要保留；
 * 保留的转成「单独添加」，以后不要了让用户自己移出。
 */
async function unbind(groupId: string) {
  const c = container.value
  const leaving = (members.value[groupId] ?? []).filter((id) => !c.excluded.includes(id) && !c.sources.includes(id))
  const title = `解绑来源组「${groupName(groupId)}」`
  if (!leaving.length) {
    try {
      await ElMessageBox.confirm(`解绑后来源组本身不受影响，「${targetLabel.value}」里单独添加的源保留。`, title, { confirmButtonText: '解绑', cancelButtonText: '取消', type: 'warning' })
    } catch {
      return
    }
    await commit(unbindGroup(tree.value, selectedDir.value, groupId, members.value), `已解绑来源组「${groupName(groupId)}」`)
    return
  }
  const labels = await sourceLabels(leaving.slice(0, UNBIND_LIST_MAX))
  let keep: boolean
  try {
    // 弹窗渲染在组件外，scoped 样式管不到，列表样式写内联
    await ElMessageBox.confirm(h('div', { 'data-testid': 'mv-unbind-list' }, [
      h('p', { style: 'margin: 0' }, `解绑后，下面 ${leaving.length} 个随来源组带进来的源会从「${targetLabel.value}」移出（来源组本身不受影响）。要保留它们吗？保留的会转成单独添加，以后不要了可以自己移出。`),
      h('ul', { style: 'max-height: 240px; overflow-y: auto; margin: 8px 0; padding-left: 18px; font-size: 12px' }, labels.map((l) => h('li', l))),
      leaving.length > UNBIND_LIST_MAX ? h('p', { style: 'margin: 0; font-size: 12px' }, `…等共 ${leaving.length} 个`) : null,
    ]), title, { confirmButtonText: '保留这些源', cancelButtonText: '一起移出', distinguishCancelAndClose: true, type: 'warning' })
    keep = true
  } catch (action) {
    if (action !== 'cancel') return // 关掉弹窗 = 不解绑
    keep = false
  }
  const unbound = unbindGroup(tree.value, selectedDir.value, groupId, members.value)
  const next = tryTree(() => (keep ? addSources(unbound, selectedDir.value, leaving) : unbound))
  if (next) await commit(next, keep ? `已解绑来源组「${groupName(groupId)}」，${leaving.length} 个源已保留为单独添加` : `已解绑来源组「${groupName(groupId)}」，移出 ${leaving.length} 个源`)
}
async function restore() {
  await commit(restoreExcluded(tree.value, selectedDir.value), '已恢复被排除的源')
}

// ---- 移出 / 移到目录 ----
async function removeSelected(ids: string[]) {
  if (!ids.length) return
  const via = ids.filter((id) => onlyViaGroup(tree.value, selectedDir.value, id, members.value)).length
  try {
    await ElMessageBox.confirm(`把 ${ids.length} 个源移出「${targetLabel.value}」？${via ? `其中 ${via} 个是随来源组带进来的，会在这里排除（来源组本身不变，可以恢复）。` : ''}源本身不受影响。`, '移出源', { confirmButtonText: '移出', cancelButtonText: '取消', type: 'warning' })
  } catch {
    return
  }
  await commit(removeSources(tree.value, selectedDir.value, ids, members.value), `已移出 ${ids.length} 个源`)
}
async function moveSelected(ids: string[], toId: string) {
  if (!ids.length) return
  const next = tryTree(() => moveSources(tree.value, selectedDir.value, toId, ids, members.value))
  if (next) await commit(next, `已把 ${ids.length} 个源移到「${pathText(tree.value, toId)}」`)
}

// ---- 显示设置 ----
const displayOpen = ref(false)
const displayDraft = ref<ViewDisplay>(defaultDisplay())
function openDisplay() { displayDraft.value = JSON.parse(JSON.stringify(active.value?.display ?? defaultDisplay())) as ViewDisplay; displayOpen.value = true }
function toggleColumn(key: string, show: boolean) {
  const hidden = displayDraft.value.hiddenColumns
  displayDraft.value.hiddenColumns = show ? hidden.filter((k) => k !== key) : [...hidden, key]
}
async function applyDisplay() {
  const view = active.value
  if (!view || saving.value) return
  saving.value = true
  try {
    const saved = await sourceViewApi.update(userId.value, { viewId: view.viewId, revision: view.revision, display: displayDraft.value })
    views.value = views.value.map((v) => (v.viewId === saved.viewId ? saved : v))
    ElMessage.success('显示设置已保存')
    displayOpen.value = false
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    ElMessage.error(message)
    if (/视图已变化/.test(message)) await load(view.viewId)
  } finally {
    saving.value = false
  }
}

// ---- 本机视图导入账号（接口上线后） ----
async function importLocal() {
  if (importing.value) return
  importing.value = true
  try {
    const { imported, failed } = await sourceViewApi.importLocal(userId.value)
    if (failed.length) ElMessage.warning(`已导入 ${imported} 个，${failed.length} 个没导入成功（${failed[0]}）`)
    else ElMessage.success(`已把 ${imported} 个本机视图导入账号`)
    await load()
  } catch (e) {
    ElMessage.error(`导入失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    importing.value = false
  }
}

// ---- 打开源 / 网站 ----
function openSource(source: Source, view: 'overview' | 'data' = 'overview') {
  if (source.siteId && source.siteId !== '0') recordSiteVisit(source.siteId, source.siteName)
  trackClick('SOURCE', source.sourceId, source.name, {
    eventCode: 'source_open',
    eventName: '打开源',
    firstModule: '采集资产',
    pageName: '我的视图',
  })
  void router.push({ path: '/canvas', query: { ...(source.siteId && source.siteId !== '0' ? { siteId: source.siteId } : {}), sourceId: source.sourceId, view, ...(view === 'data' && source.mainTable ? { tableId: source.mainTable } : {}), returnTo: route.fullPath } })
}
function openSite(siteId: string) {
  recordSiteVisit(siteId)
  void router.push({ path: '/canvas', query: { siteId, view: 'source', returnTo: route.fullPath } })
}
function openSourceGroup(sourceGroupId: string) {
  void router.push({ path: '/collect', query: { tab: 'personal', group: sourceGroupId } })
}
function refresh() {
  clearGroupMembersCache()
  scopeVersion.value += 1
  void loadGroupNames()
  void load(activeId.value)
}

watch(userId, () => void load())
watch(() => route.query.viewId, (id) => {
  if (!onThisPage() || !id || id === activeId.value) return
  if (views.value.some((v) => v.viewId === id)) selectView(String(id))
  else void load(String(id))
})
onMounted(() => {
  void load()
  void loadGroupNames()
})
// 本页被 KeepAlive 缓存：从别的页面（如「我的分组」改了组成员）回来时重读，第一次激活和 onMounted 重复，跳过
let activatedOnce = false
onActivated(() => {
  if (!activatedOnce) { activatedOnce = true; return }
  scopeVersion.value += 1
  void loadGroupNames()
  void load(activeId.value)
})
</script>

<template>
  <div class="mv-tab" data-testid="my-views">
    <div class="mv-body">
      <aside class="mv-nav">
        <div class="mv-view-switch">
          <el-select
            :model-value="activeId || undefined"
            placeholder="还没有视图"
            :disabled="!views.length"
            data-testid="mv-view-select"
            @update:model-value="selectView(String($event))"
          >
            <el-option v-for="v in views" :key="v.viewId" :value="v.viewId" :label="`视图：${v.viewName}${v.isDefault ? ' ★' : ''}`" />
          </el-select>
          <button class="mv-icon-btn bordered" type="button" title="新建视图" aria-label="新建视图" data-testid="mv-new" @click="openName('newView')"><el-icon><Plus /></el-icon></button>
          <el-dropdown v-if="active" trigger="click" @command="onViewCommand">
            <button class="mv-icon-btn bordered" type="button" title="视图操作" aria-label="视图操作" data-testid="mv-view-more"><el-icon><MoreFilled /></el-icon></button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="rename" :icon="Edit">重命名视图</el-dropdown-item>
                <el-dropdown-item command="default" :icon="Star" :disabled="active.isDefault && directories.preference === 'view'">设为默认进入</el-dropdown-item>
                <el-dropdown-item command="delete" :icon="Delete" divided>删除视图</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <template v-if="active">
          <div class="mv-nav-title"><strong>目录</strong><small>{{ treeLoading ? '加载中…' : `${tree.dirs.length} 个目录 · ${totalCount} 个源` }}</small></div>
          <p v-if="treeError" class="mv-tree-error" data-testid="mv-tree-error">{{ treeError }}</p>
          <div class="mv-tree">
            <ViewDirTree :tree="tree" :selected="selectedDir" :counts="counts" :group-name="groupName" @select="selectedDir = $event" @command="onDirCommand" />
          </div>
          <div class="mv-nav-foot">
            <el-button size="small" :icon="Plus" data-testid="mv-new-dir" @click="newDir(null)">目录</el-button>
          </div>
        </template>
        <div v-else class="mv-empty">{{ loadError || '还没有视图，点上面「＋」新建' }}</div>
        <p v-if="backend === 'local'" class="mv-note" data-testid="mv-local-note">视图暂存在本机浏览器，换电脑或清缓存会丢失。</p>
        <div v-if="localLeft" class="mv-import" data-testid="mv-import">
          <span>这台电脑上还有 {{ localLeft }} 个之前存在本机的视图</span>
          <el-button size="small" type="primary" plain :loading="importing" data-testid="mv-import-btn" @click="importLocal">导入到账号</el-button>
        </div>
      </aside>

      <section class="mv-content">
        <template v-if="active">
          <div class="mv-toolbar">
            <span class="mv-path" data-testid="mv-path">
              {{ active.viewName }}<template v-for="(p, i) in pathLabel" :key="i"> / <b v-if="i === pathLabel.length - 1">{{ p }}</b><template v-else>{{ p }}</template></template>
            </span>
            <span class="mv-badge">🔒 仅自己可见</span>
            <div class="mv-actions">
              <button class="mv-icon-btn" type="button" title="添加源 / 绑定来源组" aria-label="添加源" data-testid="mv-add-sources" :disabled="!selectedDir" @click="openPicker()"><el-icon><Plus /></el-icon></button>
              <button class="mv-icon-btn" type="button" title="显示设置" aria-label="显示设置" data-testid="mv-display" @click="openDisplay"><el-icon><Setting /></el-icon></button>
              <button class="mv-icon-btn" type="button" title="刷新（重新拉来源组成员）" aria-label="刷新" @click="refresh"><el-icon><Refresh /></el-icon></button>
            </div>
          </div>
          <el-alert v-if="tree.convertedFromCondition" type="info" show-icon :closable="false" class="mv-alert" data-testid="mv-converted" title="这个视图原来是按条件筛选的，现在视图改成了目录：请新建目录再添加源（10-13 起不再支持条件视图）" />
          <el-alert v-if="membersError" type="error" show-icon :closable="false" class="mv-alert" :title="membersError" />
          <el-alert v-for="m in missingHere" :key="m.groupId" type="warning" show-icon :closable="false" class="mv-alert" data-testid="mv-missing">
            <template #title>
              来源组「{{ groupName(m.groupId) }}」有 {{ m.ids.length }} 个源还没在这个目录里（绑定时只带入组里当时的源，之后新加的需要手动加入）
              <el-button link type="primary" size="small" data-testid="mv-missing-open" @click="openPicker(m.groupId, true)">查看并加入</el-button>
            </template>
          </el-alert>
          <div v-if="container.groups.length || container.excluded.length" class="mv-groups" data-testid="mv-group-bar">
            <span v-if="container.groups.length" class="mv-groups-label">这个目录绑定的来源组：</span>
            <span v-for="g in container.groups" :key="g" class="mv-gchip" title="绑定时带入组里当时的源；组里之后新加的源不会自动进来，会在上方提示，勾选后加入。移出组的源会留在这个目录里，不要了可以自己移出">
              来源组 <b>{{ groupName(g) }}</b> · {{ groupInCount(g) }}/{{ (members[g] ?? []).length }} 个源
              <button type="button" title="解绑这个来源组" :aria-label="`解绑来源组 ${groupName(g)}`" data-testid="mv-unbind" @click="unbind(g)">×</button>
            </span>
            <span v-if="container.excluded.length" class="mv-groups-label">已从来源组排除 {{ container.excluded.length }} 个源 <el-button link type="primary" size="small" data-testid="mv-restore" @click="restore">恢复</el-button></span>
          </div>
          <el-empty v-if="!selectedDir" :description="treeLoading ? '目录加载中…' : '这个视图还没有目录：点左下「＋ 目录」新建，再往目录里添加源'" />
          <SourceOverviewView
            v-else
            :key="`${activeId}:${selectedDir}`"
            current-site-id=""
            group-ops
            :view-state="listState"
            :scope-view-category-id="viewCategoryScope"
            :scope-version="scopeVersion"
            :scope-source-ids="viewCategoryScope ? undefined : scopeIds"
            :scope-empty-text="'这个目录里还没有源，点右上「＋」添加'"
            extra-column-label="所在目录"
            @open-source="openSource"
            @open-source-data="openSource($event, 'data')"
            @open-site="openSite"
            @open-source-group="openSourceGroup"
          >
            <template #extra-cell="{ source }">
              <span :title="placeText(source.sourceId)">{{ placeText(source.sourceId) || '—' }}</span>
              <span v-if="viaGroup(source.sourceId)" class="mv-via" title="随来源组带进来的；移出会在这里排除，来源组本身不变">随来源组 {{ viaGroup(source.sourceId) }}</span>
            </template>
            <template #selection-actions="{ ids }">
              <el-dropdown v-if="moveTargets.length" trigger="click" max-height="320px" @command="(to: string) => moveSelected(ids, to)">
                <el-button size="small" data-testid="mv-move">移到目录 ▾</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-for="t in moveTargets" :key="t.id" :command="t.id">{{ t.label }}</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <el-button size="small" data-testid="mv-remove-sources" @click="removeSelected(ids)">移出此目录</el-button>
            </template>
          </SourceOverviewView>
        </template>
        <el-empty v-else description="还没有视图。点左上「＋」新建一个视图，再建目录、添加源">
          <el-button type="primary" @click="openName('newView')">新建视图</el-button>
        </el-empty>
      </section>
    </div>

    <GroupSourcePicker
      v-model="pickerOpen"
      group-id=""
      pick-mode
      group-filter
      :bound-groups="container.groups"
      :missing-by-group="missingByGroup"
      :initial-group-id="pickerGroup"
      :initial-missing-only="pickerMissingOnly"
      :title="`添加源到「${targetLabel}」`"
      confirm-text="添加到目录"
      @pick="onPick"
      @bind-group="onBindGroup"
    />

    <SaveViewDialog
      v-model="nameOpen"
      :title="nameMode === 'newView' ? '新建视图' : '重命名视图'"
      :initial-name="nameMode === 'renameView' ? active?.viewName : ''"
      :show-default="nameMode === 'newView'"
      :summary="nameMode === 'newView' ? '视图只有你自己能看到。建好后先建目录（可以多级），再往目录里添加源或绑定来源组。' : ''"
      :busy="nameBusy"
      :error="nameError"
      @submit="submitName"
    />

    <el-drawer v-model="displayOpen" title="显示设置" size="360px" append-to-body data-testid="mv-display-drawer">
      <div class="mv-drawer">
        <div class="mv-sec">显示的列</div>
        <p class="mv-hint">源 ID、源名称、所在目录固定显示。</p>
        <el-checkbox
          v-for="c in HIDEABLE_SOURCE_COLUMNS"
          :key="c.key"
          :model-value="!displayDraft.hiddenColumns.includes(c.key)"
          :data-testid="`mv-col-${c.key}`"
          @update:model-value="toggleColumn(c.key, !!$event)"
        >{{ c.label }}</el-checkbox>
        <div class="mv-sec">默认排序</div>
        <div class="mv-sort">
          <el-select v-model="displayDraft.sortField" size="small" placeholder="不排序">
            <el-option label="不排序" value="" />
            <el-option v-for="f in SOURCE_SORT_FIELDS" :key="f.value" :label="f.label" :value="f.value" />
          </el-select>
          <el-select v-model="displayDraft.sortDirection" size="small" :disabled="!displayDraft.sortField" style="width: 90px">
            <el-option label="升序" value="asc" />
            <el-option label="降序" value="desc" />
          </el-select>
        </div>
        <div class="mv-sec">每页条数</div>
        <el-select v-model="displayDraft.pageSize" size="small" style="width: 120px">
          <el-option v-for="n in [10, 20, 50, 100]" :key="n" :label="`${n} 条`" :value="n" />
        </el-select>
        <p class="mv-hint">显示设置按视图保存，不影响系统目录。</p>
      </div>
      <template #footer>
        <el-button @click="displayOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" data-testid="mv-display-apply" @click="applyDisplay">保存</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.mv-tab { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.mv-body { display: flex; gap: 12px; flex: 1; min-height: 0; }
.mv-nav { width: 220px; flex-shrink: 0; display: flex; flex-direction: column; padding: 12px; border: 1px solid var(--rc-border-soft); border-radius: 10px; background: #fff; }
.mv-view-switch { display: flex; align-items: center; gap: 6px; }
.mv-view-switch .el-select { flex: 1; min-width: 0; }
.mv-nav-title { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin: 14px 0 8px; padding: 0 2px; font-size: 13px; }
.mv-nav-title small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--rc-faint); font-size: 11px; }
.mv-view-switch :deep(.el-select__wrapper) { font-size: 13px; }
.mv-tree { flex: 1; min-height: 0; overflow-y: auto; }
.mv-nav-foot { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--rc-border-soft); }
.mv-tree-error { margin: 0 0 6px; font-size: 12px; color: var(--el-color-danger); line-height: 1.5; }
.mv-empty { color: var(--rc-faint); font-size: 12px; padding: 16px 8px; text-align: center; }
.mv-note { font-size: 12px; color: var(--rc-faint); line-height: 1.6; margin: 8px 0 0; }
.mv-import { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; margin-top: 8px; padding: 8px 10px; border-radius: 6px; background: #eff6ff; color: #1e40af; font-size: 12px; line-height: 1.5; }
.mv-content { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.mv-toolbar { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: #fff; border: 1px solid var(--rc-border-soft); border-radius: 8px; margin-bottom: 8px; font-size: 13px; flex-wrap: wrap; }
.mv-path { color: var(--rc-faint); max-width: 520px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mv-path b { color: var(--rc-text); font-size: 14px; }
.mv-badge { padding: 1px 8px; border-radius: 10px; background: #f1f5f9; color: var(--rc-text-2); font-size: 12px; white-space: nowrap; }
.mv-actions { display: flex; margin-left: auto; gap: 2px; align-items: center; }
.mv-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--rc-muted, #64748b); font-size: 16px; cursor: pointer; flex: none; }
.mv-icon-btn.bordered { border: 1px solid var(--rc-border); background: #fff; }
.mv-icon-btn:hover:not(:disabled) { background: var(--rc-primary-bg, #eff6ff); color: var(--rc-primary, #2563eb); }
.mv-icon-btn:focus-visible { outline: 2px solid var(--rc-primary, #2563eb); outline-offset: 1px; }
.mv-alert { margin-bottom: 8px; }
.mv-groups { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 2px 8px; }
.mv-groups-label { color: var(--rc-faint); font-size: 12px; }
.mv-gchip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 4px 2px 10px; border-radius: 14px; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; font-size: 12px; }
.mv-gchip button { border: 0; background: none; color: #059669; cursor: pointer; width: 18px; height: 18px; border-radius: 50%; }
.mv-gchip button:hover { background: #d1fae5; }
.mv-via { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 4px; background: #ecfdf5; color: #047857; font-size: 11px; }
/* 条件沿用源列表的紧凑宽度和自动换行；查询 / 清空按钮另起一行靠右（用户 10-13 定）。 */
.mv-content :deep(.sov-filter.is-compact .sov-filter-actions) {
  flex-basis: 100%; flex-wrap: wrap; justify-content: flex-end; margin-left: 0;
}
.mv-drawer { display: flex; flex-direction: column; gap: 6px; }
.mv-sec { font-weight: 600; margin-top: 10px; }
.mv-hint { margin: 0; font-size: 12px; color: var(--rc-faint); }
.mv-sort { display: flex; gap: 8px; }
</style>
