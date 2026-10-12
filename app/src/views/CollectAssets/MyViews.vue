<script setup lang="ts">
/**
 * 源管理「我的视图」（2026-10-12，原型 `设计稿/原型设计/源管理_我的视图_原型_2026-10-12.html`，
 * 方案 `设计稿/设计方案/1012-我的视图_开发设计方案_2026-10-12.md`）。
 *
 * 视图 = 用户自己保存的一套源列表查询（条件 + 排序 + 每页条数 + 隐藏列），只有自己能看到。
 * 右侧直接复用源列表 `SourceOverviewView`：`viewState` 套用视图，`stateChange` 拿到当前状态，
 * 和已保存的比较得出「有未保存的修改」。查询全走现有 sourcePaged，视图本身先存本机（sourceViewApi）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CopyDocument, Delete, MoreFilled, Plus, Refresh, RefreshLeft, Select, Setting } from '@element-plus/icons-vue'
import { siteApi, sourceApi, sourceGroupApi, type Source } from '@/api'
import { sourceViewApi, type SourceView } from '@/api/sourceViews'
import { useAuthStore } from '@/stores/auth'
import { useSourceGroupsStore } from '@/stores/sourceGroups'
import { recordSiteVisit } from '@/utils/siteRecents'
import SourceOverviewView from '@/views/FlowCanvas/result/SourceOverviewView.vue'
import { scopedSourceIds } from '@/views/FlowCanvas/result/sourceScope'
import {
  HIDEABLE_SOURCE_COLUMNS,
  emptyManualViewState,
  SOURCE_SORT_FIELDS,
  blankSourceListViewState,
  describeViewState,
  sameViewState,
  viewStateFilter,
  type SourceListViewState,
} from '@/views/FlowCanvas/result/sourceListViewState'
import SaveViewDialog from './SaveViewDialog.vue'
import GroupSourcePicker from './GroupSourcePicker.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const directories = useSourceGroupsStore()
const userId = computed(() => (auth.info?.id != null ? String(auth.info.id) : ''))

const views = ref<SourceView[]>([])
const loadError = ref('')
const activeId = ref('')
const active = computed(() => views.value.find((v) => v.viewId === activeId.value) ?? null)
/** 套给源列表的状态（换视图 / 撤销 / 应用显示设置时换成新对象，源列表据此重查） */
const appliedState = ref<SourceListViewState | null>(null)
/** 源列表报上来的当前状态（不含手选清单，清单在下面的 scopeIds 里） */
const rawState = ref<SourceListViewState | null>(null)
/**
 * 手选的源 ID 清单：`null` = 条件视图（全部源按条件筛）；数组 = 手选清单（可空）。
 * 单独存放而不放进套给源列表的状态里：添加 / 移出源只重查，不能把用户还没保存的条件改动重置掉。
 */
const scopeIds = ref<string[] | null>(null)
const liveState = computed<SourceListViewState | null>(() => (rawState.value ? { ...rawState.value, scopeIds: scopeIds.value ? [...scopeIds.value] : null } : null))
const dirty = computed(() => !!active.value && !!liveState.value && !sameViewState(liveState.value, active.value.state))
const manual = computed(() => scopeIds.value !== null)
const counts = ref<Record<string, number | null>>({})

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

async function load(preferId?: string) {
  loadError.value = ''
  try {
    views.value = await sourceViewApi.list(userId.value)
  } catch (e) {
    views.value = []
    loadError.value = e instanceof Error ? e.message : String(e)
    return
  }
  const wanted = preferId || String(route.query.view ?? '')
  const next = views.value.find((v) => v.viewId === wanted)
    ?? views.value.find((v) => v.viewId === activeId.value)
    ?? views.value.find((v) => v.isDefault)
    ?? views.value[0]
  selectView(next?.viewId ?? '', true)
  void loadCounts()
}

/** 左侧每个视图的源数：sourcePaged 按视图条件查 1 条取 total；手选清单限定在清单内，空清单不发请求 */
async function loadCounts() {
  await Promise.all(views.value.map(async (v) => {
    try {
      const ids = v.state.scopeIds
      if (ids && !ids.length) {
        counts.value = { ...counts.value, [v.viewId]: 0 }
        return
      }
      const res = await sourceApi.sourcePaged({ ...viewStateFilter(v.state), ...(ids ? { sourceIds: scopedSourceIds(ids, viewStateFilter(v.state).sourceIds) } : {}), page: 1, size: 1 })
      counts.value = { ...counts.value, [v.viewId]: res.total }
    } catch {
      counts.value = { ...counts.value, [v.viewId]: null }
    }
  }))
}

function selectView(viewId: string, force = false) {
  if (!force && viewId === activeId.value) return
  activeId.value = viewId
  const view = views.value.find((v) => v.viewId === viewId)
  appliedState.value = view ? clone(view.state) : null
  rawState.value = view ? clone(view.state) : null
  scopeIds.value = view?.state.scopeIds ? [...view.state.scopeIds] : null
  if (route.query.view !== (viewId || undefined)) {
    void router.replace({ path: route.path, query: { ...route.query, view: viewId || undefined } })
  }
}

async function confirmDiscard(): Promise<boolean> {
  if (!dirty.value) return true
  try {
    await ElMessageBox.confirm('当前视图有未保存的修改，继续会丢失这些修改。', '放弃未保存的修改？', { confirmButtonText: '放弃修改', cancelButtonText: '取消', type: 'warning' })
    return true
  } catch {
    return false
  }
}
async function pickView(viewId: string) {
  if (viewId === activeId.value || !(await confirmDiscard())) return
  selectView(viewId)
}

// ---- 保存 / 撤销 ----
const saving = ref(false)
async function save() {
  const view = active.value
  if (!view || !liveState.value || saving.value) return
  saving.value = true
  try {
    const saved = await sourceViewApi.update(userId.value, { viewId: view.viewId, revision: view.revision, state: clone(liveState.value) })
    views.value = views.value.map((v) => (v.viewId === saved.viewId ? saved : v))
    ElMessage.success(`已保存「${saved.viewName}」`)
    void loadCounts()
  } catch (e) {
    ElMessage.error(`保存失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    saving.value = false
  }
}
function revert() {
  if (active.value) {
    appliedState.value = clone(active.value.state)
    rawState.value = clone(active.value.state)
    scopeIds.value = active.value.state.scopeIds ? [...active.value.state.scopeIds] : null
  }
}

// ---- 命名弹窗：新建 / 另存为 / 重命名 ----
type NameMode = 'new' | 'saveAs' | 'rename'
const nameOpen = ref(false)
const nameMode = ref<NameMode>('new')
const nameBusy = ref(false)
const nameError = ref('')
const nameTitle = computed(() => ({ new: '新建视图', saveAs: '另存为新视图', rename: '重命名视图' }[nameMode.value]))
const nameInitial = computed(() => (nameMode.value === 'rename' ? active.value?.viewName : nameMode.value === 'saveAs' ? `${active.value?.viewName ?? ''} 副本` : ''))
const nameSummary = computed(() => {
  if (nameMode.value === 'new') return '新视图是空的，创建后点「添加源」挑选；条件栏可以在这些源里再筛选。'
  if (nameMode.value === 'saveAs' && liveState.value) return `保存的条件：${describeViewState(liveState.value, names).join('；') || '全部源（没有条件）'}`
  return ''
})
function openName(mode: NameMode) {
  nameMode.value = mode
  nameError.value = ''
  nameOpen.value = true
}
async function submitName({ name, isDefault }: { name: string; isDefault: boolean }) {
  nameBusy.value = true
  nameError.value = ''
  try {
    if (nameMode.value === 'rename' && active.value) {
      const saved = await sourceViewApi.update(userId.value, { viewId: active.value.viewId, revision: active.value.revision, viewName: name })
      views.value = views.value.map((v) => (v.viewId === saved.viewId ? saved : v))
      ElMessage.success('已重命名')
    } else {
      // 新建视图是空的手选清单（用户定 C）；另存为沿用当前的清单 / 条件
      const state = nameMode.value === 'saveAs' && liveState.value ? clone(liveState.value) : emptyManualViewState()
      const created = await sourceViewApi.add(userId.value, { viewName: name, state, isDefault })
      if (isDefault) setDefaultEntry()
      // 另存为后原视图保持已保存的样子，未保存的修改留在新视图里
      await load(created.viewId)
      ElMessage.success(`已创建视图「${created.viewName}」`)
    }
    nameOpen.value = false
  } catch (e) {
    nameError.value = e instanceof Error ? e.message : String(e)
  } finally {
    nameBusy.value = false
  }
}

// ---- 更多：设为默认进入 / 删除 ----
function setDefaultEntry() {
  try { directories.setPreference('view') } catch { /* 偏好写失败不影响视图本身 */ }
}
async function onMore(command: string) {
  const view = active.value
  if (!view) return
  if (command === 'rename') return openName('rename')
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
      await ElMessageBox.confirm(`删除「${view.viewName}」后不能恢复。只删除这个视图，不影响里面的源。`, '删除视图？', { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning', confirmButtonClass: 'el-button--danger' })
    } catch {
      return
    }
    try {
      await sourceViewApi.remove(userId.value, { viewId: view.viewId, revision: view.revision })
      if (view.isDefault && directories.preference === 'view') directories.setPreference('system')
      activeId.value = ''
      await load()
      ElMessage.success(`已删除「${view.viewName}」`)
    } catch (e) {
      ElMessage.error(`删除失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

// ---- 手选清单：添加源 / 移出视图（只改当前画面，点「保存」才写进视图） ----
const pickerOpen = ref(false)
function addSources(ids: string[]) {
  if (scopeIds.value === null) return
  const before = scopeIds.value.length
  scopeIds.value = [...new Set([...scopeIds.value, ...ids])]
  const added = scopeIds.value.length - before
  ElMessage.info(added ? `已添加 ${added} 个源${ids.length > added ? `（${ids.length - added} 个已在视图里）` : ''}，点「保存」后生效` : '选中的源都已经在视图里了')
}
async function removeSources(ids: string[]) {
  if (scopeIds.value === null || !ids.length) return
  try {
    await ElMessageBox.confirm(`把选中的 ${ids.length} 个源移出这个视图？只是不再显示在视图里，源本身不受影响。`, '移出视图', { confirmButtonText: '移出', cancelButtonText: '取消', type: 'warning' })
  } catch {
    return
  }
  const drop = new Set(ids)
  scopeIds.value = scopeIds.value.filter((id) => !drop.has(id))
  ElMessage.info(`已移出 ${ids.length} 个源，点「保存」后生效`)
}

// ---- 显示设置 ----
const displayOpen = ref(false)
const displayHidden = ref<string[]>([])
const displaySortField = ref('')
const displaySortDir = ref<'asc' | 'desc'>('asc')
const displayPageSize = ref(20)
function openDisplay() {
  const s = rawState.value ?? blankSourceListViewState()
  displayHidden.value = [...s.hiddenColumns]
  displaySortField.value = s.sortField
  displaySortDir.value = s.sortDirection
  displayPageSize.value = s.pageSize
  displayOpen.value = true
}
function toggleColumn(key: string, show: boolean) {
  displayHidden.value = show ? displayHidden.value.filter((k) => k !== key) : [...displayHidden.value, key]
}
function applyDisplay() {
  const base = rawState.value ?? blankSourceListViewState()
  const next = { ...clone(base), hiddenColumns: [...displayHidden.value], sortField: displaySortField.value, sortDirection: displaySortDir.value, pageSize: displayPageSize.value }
  appliedState.value = next
  rawState.value = clone(next)
  displayOpen.value = false
  ElMessage.info('已应用，点「保存」后才会存进视图')
}

// ---- 条件摘要用的名称 ----
const siteNames = ref(new Map<string, string>())
const groupNames = ref(new Map<string, string>())
const names = { site: (id: string) => siteNames.value.get(id) ?? '', group: (id: string) => groupNames.value.get(id) ?? '' }
const chips = computed(() => (liveState.value ? describeViewState(liveState.value, names) : []))
async function loadNames() {
  try { groupNames.value = new Map((await sourceGroupApi.list()).map((g) => [g.sourceGroupId, g.sourceGroupName])) } catch { /* 摘要退回显示 ID */ }
}
/** 网站名只在条件里用到网站时才拉（全量网站列表较大，与源列表的网站下拉同一个查询） */
let siteNamesLoaded = false
watch(() => liveState.value?.site, async (site) => {
  if (!site || site === '-1' || siteNamesLoaded) return
  siteNamesLoaded = true
  try { siteNames.value = new Map((await siteApi.sitePaged({ page: 1, size: 2000 })).list.map((s) => [s.siteId, s.name])) } catch { siteNamesLoaded = false }
})

// ---- 打开源 / 网站 ----
function openSource(source: Source, view: 'overview' | 'data' = 'overview') {
  if (source.siteId && source.siteId !== '0') recordSiteVisit(source.siteId)
  void router.push({ path: '/canvas', query: { ...(source.siteId && source.siteId !== '0' ? { siteId: source.siteId } : {}), sourceId: source.sourceId, view, returnTo: route.fullPath } })
}
function openSite(siteId: string) {
  recordSiteVisit(siteId)
  void router.push({ path: '/canvas', query: { siteId, view: 'source', returnTo: route.fullPath } })
}
function openSourceGroup(sourceGroupId: string) {
  void router.push({ path: '/settings', query: { tab: 'source-group', group: sourceGroupId } })
}

watch(userId, () => void load())
// 从系统目录「另存为视图」跳过来时带着新视图 ID
watch(() => route.query.view, (id) => {
  if (id && id !== activeId.value && views.value.some((v) => v.viewId === id)) selectView(String(id))
  else if (id && !views.value.some((v) => v.viewId === id)) void load(String(id))
})
onMounted(() => {
  void load()
  void loadNames()
})
</script>

<template>
  <div class="mv-tab" data-testid="my-views">
    <div class="mv-body">
      <aside class="mv-nav">
        <div class="mv-heading">
          <strong>我的视图</strong>
          <el-button size="small" type="primary" data-testid="mv-new" @click="openName('new')">新建</el-button>
        </div>
        <div class="mv-list">
          <button
            v-for="v in views"
            :key="v.viewId"
            type="button"
            class="mv-item"
            :class="{ active: v.viewId === activeId }"
            data-testid="mv-item"
            @click="pickView(v.viewId)"
          >
            <span :title="v.viewName">{{ v.viewName }}<i v-if="v.isDefault" class="mv-star" title="默认进入">★</i></span>
            <small>{{ counts[v.viewId] ?? '…' }}</small>
          </button>
          <div v-if="!views.length" class="mv-empty">{{ loadError || '还没有视图' }}</div>
        </div>
        <p class="mv-note">视图只有你自己能看到。新建的视图是空的，点「添加源」挑选，条件栏在这些源里再筛选；在「系统目录」设好条件「另存为视图」存的是条件，之后新增的源符合条件会自动出现。</p>
        <p class="mv-note mv-local">目前暂存在本机浏览器，换电脑或清缓存会丢失；后端接口上线后会提示导入到账号。</p>
      </aside>

      <section class="mv-content">
        <template v-if="active && appliedState">
          <div class="mv-toolbar">
            <strong class="mv-name" :title="active.viewName" data-testid="mv-name">{{ active.viewName }}</strong>
            <span class="mv-badge">🔒 仅自己可见</span>
            <span v-if="dirty" class="mv-badge dirty" data-testid="mv-dirty">有未保存的修改</span>
            <div class="mv-actions">
              <!-- 图标按钮，样式同流程中心操作列（fc-icon-btn）；名字放在 title / aria-label 里 -->
              <button v-if="manual" class="mv-icon-btn" type="button" title="添加源" aria-label="添加源" data-testid="mv-add-sources" @click="pickerOpen = true"><el-icon><Plus /></el-icon></button>
              <button v-if="dirty" class="mv-icon-btn" type="button" title="撤销修改" aria-label="撤销修改" data-testid="mv-revert" @click="revert"><el-icon><RefreshLeft /></el-icon></button>
              <button class="mv-icon-btn save" :class="{ on: dirty }" type="button" :disabled="!dirty || saving" :title="dirty ? '保存' : '没有未保存的修改'" aria-label="保存" data-testid="mv-save" @click="save"><el-icon><Select /></el-icon></button>
              <button class="mv-icon-btn" type="button" title="另存为新视图" aria-label="另存为" data-testid="mv-save-as" @click="openName('saveAs')"><el-icon><CopyDocument /></el-icon></button>
              <button class="mv-icon-btn" type="button" title="显示设置" aria-label="显示设置" data-testid="mv-display" @click="openDisplay"><el-icon><Setting /></el-icon></button>
              <el-dropdown trigger="click" @command="onMore">
                <button class="mv-icon-btn" type="button" title="更多" aria-label="更多" data-testid="mv-more"><el-icon><MoreFilled /></el-icon></button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="rename">重命名</el-dropdown-item>
                    <el-dropdown-item command="default" :disabled="active.isDefault && directories.preference === 'view'">设为默认进入</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <button class="mv-icon-btn danger" type="button" title="删除视图" aria-label="删除视图" data-testid="mv-delete" @click="onMore('delete')"><el-icon><Delete /></el-icon></button>
              <button class="mv-icon-btn" type="button" title="刷新" aria-label="刷新" @click="load(activeId)"><el-icon><Refresh /></el-icon></button>
            </div>
          </div>
          <div class="mv-chips" data-testid="mv-chips">
            <span v-for="c in chips" :key="c" class="mv-chip">{{ c }}</span>
            <span v-if="!chips.length" class="mv-chip">全部源（没有条件）</span>
          </div>
          <SourceOverviewView
            :key="activeId"
            current-site-id=""
            group-ops
            :view-state="appliedState"
            :scope-source-ids="scopeIds ?? undefined"
            scope-empty-text="这个视图里还没有源，点右上「添加源」挑选"
            @state-change="rawState = $event"
            @open-source="openSource"
            @open-source-data="openSource($event, 'data')"
            @open-site="openSite"
            @open-source-group="openSourceGroup"
          >
            <template v-if="manual" #selection-actions="{ ids }">
              <el-button size="small" data-testid="mv-remove-sources" @click="removeSources(ids)">移出视图</el-button>
            </template>
          </SourceOverviewView>
        </template>
        <el-empty v-else :description="views.length ? '请选择一个视图' : '还没有视图。点左侧「新建视图」，或在「系统目录」源列表设好条件后点「另存为视图」'" />
      </section>
    </div>

    <GroupSourcePicker v-model="pickerOpen" group-id="" pick-mode title="选择源添加到视图" confirm-text="添加到视图" @pick="addSources" />

    <SaveViewDialog
      v-model="nameOpen"
      :title="nameTitle"
      :initial-name="nameInitial"
      :show-default="nameMode !== 'rename'"
      :summary="nameSummary"
      :busy="nameBusy"
      :error="nameError"
      @submit="submitName"
    />

    <el-drawer v-model="displayOpen" title="显示设置" size="360px" append-to-body data-testid="mv-display-drawer">
      <div class="mv-drawer">
        <div class="mv-sec">显示的列</div>
        <p class="mv-hint">源 ID、源名称固定显示。</p>
        <el-checkbox
          v-for="c in HIDEABLE_SOURCE_COLUMNS"
          :key="c.key"
          :model-value="!displayHidden.includes(c.key)"
          :data-testid="`mv-col-${c.key}`"
          @update:model-value="toggleColumn(c.key, !!$event)"
        >{{ c.label }}</el-checkbox>
        <div class="mv-sec">默认排序</div>
        <div class="mv-sort">
          <el-select v-model="displaySortField" size="small" placeholder="不排序" data-testid="mv-sort-field">
            <el-option label="不排序" value="" />
            <el-option v-for="f in SOURCE_SORT_FIELDS" :key="f.value" :label="f.label" :value="f.value" />
          </el-select>
          <el-select v-model="displaySortDir" size="small" :disabled="!displaySortField" style="width: 90px">
            <el-option label="升序" value="asc" />
            <el-option label="降序" value="desc" />
          </el-select>
        </div>
        <div class="mv-sec">每页条数</div>
        <el-select v-model="displayPageSize" size="small" style="width: 120px" data-testid="mv-page-size">
          <el-option v-for="n in [10, 20, 50, 100]" :key="n" :label="`${n} 条`" :value="n" />
        </el-select>
        <p class="mv-hint">显示设置跟着视图保存，不影响系统目录。</p>
      </div>
      <template #footer>
        <el-button @click="displayOpen = false">取消</el-button>
        <el-button type="primary" data-testid="mv-display-apply" @click="applyDisplay">应用</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.mv-tab { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.mv-body { display: flex; gap: 12px; flex: 1; min-height: 0; }
.mv-nav { width: 210px; flex-shrink: 0; display: flex; flex-direction: column; padding: 12px; border: 1px solid var(--rc-border-soft); border-radius: 10px; background: #fff; }
.mv-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; }
.mv-list { flex: 1; min-height: 0; overflow-y: auto; margin-top: 12px; display: flex; flex-direction: column; gap: 2px; }
.mv-item { display: flex; justify-content: space-between; align-items: center; gap: 8px; width: 100%; padding: 9px 10px; border: 0; border-radius: 6px; background: transparent; color: var(--rc-text); cursor: pointer; text-align: left; }
.mv-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mv-item small { color: var(--rc-faint); font-size: 11px; flex-shrink: 0; }
.mv-item:hover { background: #f1f5f9; }
.mv-item.active { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.mv-star { font-style: normal; color: #f59e0b; margin-left: 4px; font-size: 12px; }
.mv-empty { color: var(--rc-faint); font-size: 12px; padding: 12px 8px; text-align: center; }
.mv-note { font-size: 12px; color: var(--rc-muted); line-height: 1.6; margin: 8px 0 0; }
.mv-local { color: var(--rc-faint); }
.mv-content { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.mv-toolbar { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: #fff; border: 1px solid var(--rc-border-soft); border-radius: 8px; margin-bottom: 8px; font-size: 13px; flex-wrap: wrap; }
.mv-name { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mv-badge { padding: 1px 8px; border-radius: 10px; background: #f1f5f9; color: var(--rc-text-2); font-size: 12px; white-space: nowrap; }
.mv-badge.dirty { background: #fffbeb; color: #b45309; }
.mv-actions { display: flex; margin-left: auto; gap: 2px; align-items: center; }
.mv-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--rc-muted, #64748b); font-size: 16px; cursor: pointer; }
.mv-icon-btn:hover:not(:disabled) { background: var(--rc-primary-bg, #eff6ff); color: var(--rc-primary, #2563eb); }
.mv-icon-btn.danger:hover:not(:disabled) { background: #fef3f2; color: var(--rc-error, #d92d20); }
.mv-icon-btn:focus-visible { outline: 2px solid var(--rc-primary, #2563eb); outline-offset: 1px; }
.mv-icon-btn:disabled { opacity: .4; cursor: not-allowed; }
/* 有未保存的修改时「保存」高亮成主色，提醒还没存 */
.mv-icon-btn.save.on { background: var(--rc-primary, #2563eb); color: #fff; }
.mv-icon-btn.save.on:hover:not(:disabled) { background: #1d4ed8; color: #fff; }
/* 源列表紧凑查询栏原本是整行宽度、不换行设计的；这里右栏比系统目录窄，放不下时换行，别把控件压到重叠 */
.mv-content :deep(.sov-filter.is-compact) { flex-wrap: wrap; row-gap: 8px; }
.mv-content :deep(.sov-filter.is-compact label),
.mv-content :deep(.sov-filter.is-compact .sov-field) { flex: none; }
.mv-content :deep(.sov-filter.is-compact .sov-filter-actions) { margin-left: auto; }
.mv-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.mv-chip { padding: 1px 8px; border-radius: 10px; background: #eef2ff; color: #3730a3; font-size: 12px; }
.mv-drawer { display: flex; flex-direction: column; gap: 6px; }
.mv-sec { font-weight: 600; margin-top: 10px; }
.mv-hint { margin: 0; font-size: 12px; color: var(--rc-faint); }
.mv-sort { display: flex; gap: 8px; }
</style>
