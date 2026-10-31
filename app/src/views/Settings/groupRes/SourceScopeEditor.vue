<script setup lang="ts">
// 源数据权限「范围编辑器」：内嵌在可见/排除 tab 里的双栏主从（左目录、右该目录的源）。
//
// 交互口径（对齐已评审原型）：
//   · 两栏共用 pane-h(48) + 搜索条(54) + 行高 40 的结构，左右逐行对齐；
//   · 已选目录=蓝底+左侧蓝条+实心蓝胶囊，已选源=绿底+左侧绿条+实心绿胶囊；被整目录覆盖的源半透明并标「随整目录」；
//   · 左栏搜索只过滤目录（命中自动展开父链），右栏搜索只在当前目录的源里过滤；
//   · 快捷动作：全选本目录源 / 清空(N) 本目录单独选中的源 / 整目录授权；被整目录覆盖或目录无直属源时禁用。
// 只做选择与回显，落库交给 groupSourceScope（一次 modify-source-scope）。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { listCategorySources, listScopeCategories, minimizeDirIds, type ScopeCategoryNode, type SourceGrant } from '@/api/groupSourceScope'

const props = defineProps<{ grant: SourceGrant; kind: 'accept' | 'reject'; disabled?: boolean }>()
const emit = defineEmits<{ 'update:grant': [g: SourceGrant] }>()

/** 一个目录一次取全的上限；超过就要提示改用整目录授权，而不是把几千个 ID 塞进一条规则 */
const DIR_SRC_LIMIT = 2000
/** 右栏单次渲染上限，超出可点击加载更多 */
const PAGE_RENDER_STEP = 200
const renderLimit = ref(PAGE_RENDER_STEP)
/** 单源数超过这个值就建议走整目录（ID 规则太长既难维护也会被后端拒） */
const SRC_HINT_THRESHOLD = 50

interface DirRow { node: ScopeCategoryNode; depth: number }
interface DirSrcs { ids: string[]; names: Record<string, string>; total: number; loading: boolean; loaded: boolean }

const tree = ref<ScopeCategoryNode[]>([])
const byId = reactive(new Map<string, ScopeCategoryNode>())
const childIds = reactive(new Map<string, string[]>())
const parentIdOf = reactive<Record<string, string | null>>({})
const dirSrcs = reactive<Record<string, DirSrcs>>({})
const expanded = reactive(new Set<string>())
const focusId = ref('')
const treeLoading = ref(false)
const dirKw = ref('')
const srcKw = ref('')

const grant = computed<SourceGrant>(() => props.grant)

async function loadTree() {
  treeLoading.value = true
  try {
    const rows = await listScopeCategories()
    tree.value = rows
    byId.clear()
    childIds.clear()
    Object.keys(parentIdOf).forEach((k) => delete parentIdOf[k])
    rows.forEach((n) => {
      byId.set(n.id, n)
      parentIdOf[n.id] = n.parentId
      if (n.parentId) {
        const arr = childIds.get(n.parentId) ?? []
        arr.push(n.id)
        childIds.set(n.parentId, arr)
      }
    })
    if (!focusId.value) {
      const first = rows.find((n) => n.directCount > 0) ?? rows[0]
      if (first) {
        // 自动展开聚焦目录的父链，否则打开时命中的子目录藏在一个个收起的父级里
        let p = parentIdOf[first.id]
        while (p) {
          expanded.add(p)
          p = parentIdOf[p]
        }
        focusDir(first.id)
      }
    }
  } catch (e) {
    ElMessage.error(`加载目录失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    treeLoading.value = false
  }
}

function descendantsOf(id: string, acc: string[] = []): string[] {
  (childIds.get(id) ?? []).forEach((kid) => { acc.push(kid); descendantsOf(kid, acc) })
  return acc
}

/** 自身或任一祖先被整目录授权 */
function isCovered(id: string): boolean {
  let cur: string | null | undefined = id
  while (cur) {
    if (isDirSel(cur)) return true
    cur = parentIdOf[cur]
  }
  return false
}

function isDirSel(id: string): boolean { return grant.value.dirIds.includes(id) }
function isSrcSel(id: string): boolean { return grant.value.sourceIds.includes(id) }

function emitGrant(next: SourceGrant) {
  emit('update:grant', { dirIds: [...new Set(next.dirIds)], sourceIds: [...new Set(next.sourceIds)] })
}

function toggleDir(id: string) {
  if (props.disabled) return
  const node = byId.get(id)
  if (isDirSel(id)) {
    emitGrant({ dirIds: grant.value.dirIds.filter((d) => d !== id), sourceIds: grant.value.sourceIds })
    return
  }
  const desc = new Set(descendantsOf(id))
  // 整目录已经覆盖子目录与其已单独选中的源，收掉避免规则重复
  const dirIds = [...grant.value.dirIds.filter((d) => d !== id && !desc.has(d)), id]
  const srcIds = grant.value.sourceIds.filter((s) => {
    const owner = srcOwnerId(s)
    return !(owner === id || (owner != null && desc.has(owner)))
  })
  emitGrant({ dirIds, sourceIds: srcIds })
  if (node && node.directCount === 0 && node.hasChildren) {
    expanded.add(id)
  }
}

function toggleSrc(id: string) {
  if (props.disabled) return
  emitGrant({
    dirIds: grant.value.dirIds,
    sourceIds: isSrcSel(id) ? grant.value.sourceIds.filter((s) => s !== id) : [...grant.value.sourceIds, id],
  })
}

/** 源 ID → 所在目录（只在已加载过的目录里认得；认不出就当未知，不影响选择） */
function srcOwnerId(srcId: string): string | null {
  const hit = Object.keys(dirSrcs).find((dir) => dirSrcs[dir].ids.includes(srcId))
  return hit ?? null
}

function selectAllDirSrcs() {
  if (props.disabled || !focusId.value) return
  const bucket = dirSrcs[focusId.value]
  if (!bucket?.loaded) return
  if (bucket.total > bucket.ids.length) {
    ElMessage.warning(`该目录源数 ${bucket.total} 超过单次取数上限，请改用「整目录授权」`)
    return
  }
  const merged = [...new Set([...grant.value.sourceIds, ...bucket.ids])]
  emitGrant({ dirIds: grant.value.dirIds, sourceIds: merged })
  if (bucket.ids.length > SRC_HINT_THRESHOLD) {
    ElMessage.warning(`本目录已选 ${bucket.ids.length} 个源；源这么多建议直接「整目录授权」，单源规则会很难维护`)
  }
}

function clearDirSrcs() {
  if (props.disabled || !focusId.value) return
  const bucket = dirSrcs[focusId.value]
  if (!bucket?.loaded) return
  const inDir = new Set(bucket.ids)
  emitGrant({ dirIds: grant.value.dirIds, sourceIds: grant.value.sourceIds.filter((s) => !inDir.has(s)) })
}

async function ensureDirSources(id: string) {
  if (!dirSrcs[id]) dirSrcs[id] = { ids: [], names: {}, total: 0, loading: false, loaded: false }
  // 必须取回代理引用再改：直接改局部原始对象不会触发响应式更新（徽标/按钮禁用态会停在旧值）
  const bucket = dirSrcs[id]
  if (bucket.loaded || bucket.loading) return
  bucket.loading = true
  try {
    const res = await listCategorySources(id, { allSub: false, limit: DIR_SRC_LIMIT })
    bucket.ids = res.list.map((s) => s.id).filter(Boolean)
    bucket.names = Object.fromEntries(res.list.map((s) => [s.id, s.name]))
    bucket.total = res.total
    bucket.loaded = true
  } catch (e) {
    ElMessage.error(`加载该目录的源失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    bucket.loading = false
  }
}

function focusDir(id: string) {
  focusId.value = id
  renderLimit.value = PAGE_RENDER_STEP
  void ensureDirSources(id)
}

function loadMoreSources() {
  renderLimit.value += PAGE_RENDER_STEP
}

function expandAll() {
  tree.value.forEach((node) => {
    if (node.hasChildren) expanded.add(node.id)
  })
}

function collapseAll() {
  expanded.clear()
}

function dirMatches(node: ScopeCategoryNode, k: string): boolean {
  if (!k) return true
  if (node.name.toLowerCase().includes(k)) return true
  return (childIds.get(node.id) ?? []).some((kid) => {
    const child = byId.get(kid)
    return child ? dirMatches(child, k) : false
  })
}

const dirRows = computed<DirRow[]>(() => {
  const k = dirKw.value.trim().toLowerCase()
  const out: DirRow[] = []
  const walk = (ids: string[], depth: number) => {
    ids.forEach((id) => {
      const node = byId.get(id)
      if (!node) return
      if (!dirMatches(node, k)) return
      out.push({ node, depth })
      const open = k ? true : expanded.has(id)
      if (open) walk(childIds.get(id) ?? [], depth + 1)
    })
  }
  walk(tree.value.filter((n) => !n.parentId || !byId.has(n.parentId)).map((n) => n.id), 0)
  return out
})

const focusNode = computed<ScopeCategoryNode | null>(() => (focusId.value ? byId.get(focusId.value) ?? null : null))
const focusBucket = computed<DirSrcs | null>(() => (focusId.value ? dirSrcs[focusId.value] ?? null : null))
const focusSelCount = computed(() => {
  const bucket = focusBucket.value
  if (!bucket) return 0
  return bucket.ids.reduce((acc, id) => acc + (isSrcSel(id) ? 1 : 0), 0)
})
const focusCovered = computed(() => (focusId.value ? isCovered(focusId.value) : false))

const srcRows = computed(() => {
  const bucket = focusBucket.value
  if (!bucket) return []
  const k = srcKw.value.trim().toLowerCase()
  return bucket.ids
    .filter((id) => !k || (bucket.names[id] ?? '').toLowerCase().includes(k))
    .slice(0, renderLimit.value)
    .map((id) => ({ id, name: bucket.names[id] || id }))
})
const srcHidden = computed(() => {
  const bucket = focusBucket.value
  if (!bucket) return 0
  const k = srcKw.value.trim().toLowerCase()
  const matched = bucket.ids.filter((id) => !k || (bucket.names[id] ?? '').toLowerCase().includes(k)).length
  return Math.max(0, matched - srcRows.value.length)
})

/** 徽标：有缓存时显示“该目录已选/总数”，否则只显示总数 */
function dirBadge(node: ScopeCategoryNode): string {
  const bucket = dirSrcs[node.id]
  if (bucket?.loaded) {
    const sel = bucket.ids.reduce((acc, id) => acc + (isSrcSel(id) ? 1 : 0), 0)
    return sel > 0 ? `${sel}/${bucket.ids.length}` : `${node.directCount}`
  }
  return `${node.directCount}`
}
function dirBadgeSel(node: ScopeCategoryNode): boolean {
  const bucket = dirSrcs[node.id]
  return !!bucket?.loaded && bucket.ids.some((id) => isSrcSel(id))
}

/** 回显兜底：后端 remarks.roots 缺失时拿到的是展开后的目录全量，按目录树收敛成最小集 */
watch(tree, () => {
  if (!tree.value.length) return
  const minimal = minimizeDirIds(grant.value.dirIds, parentIdOf)
  if (minimal.length !== grant.value.dirIds.length) {
    emitGrant({ dirIds: minimal, sourceIds: grant.value.sourceIds })
  }
})

function toggleExpand(id: string) {
  if (expanded.has(id)) expanded.delete(id)
  else expanded.add(id)
}

defineExpose({ reload: loadTree })
onMounted(() => { void loadTree() })
</script>

<template>
  <div class="sse">
    <div class="sse-pane sse-cats">
      <div class="sse-pane-h">
        <span class="p">
          <span class="t">目录</span>
          <span class="sub">点选查看源 · 整目录=含子级</span>
        </span>
        <span class="btns">
          <button
            type="button"
            class="mini"
            title="展开全部目录"
            data-testid="sse-expand-all"
            @click="expandAll"
          >全部展开</button>
          <button
            type="button"
            class="mini"
            title="折叠全部目录"
            data-testid="sse-collapse-all"
            @click="collapseAll"
          >全部折叠</button>
        </span>
      </div>
      <div class="sse-pane-search">
        <el-input v-model="dirKw" size="small" clearable :prefix-icon="Search" placeholder="搜索目录名称" data-testid="sse-dir-kw" />
      </div>
      <div v-loading="treeLoading" class="sse-list">
        <div
          v-for="row in dirRows"
          :key="`d${row.node.id}`"
          class="sse-row dir"
          :class="{ sel: isDirSel(row.node.id), focus: row.node.id === focusId }"
          :style="{ paddingLeft: `${8 + row.depth * 16}px` }"
          :data-dir="row.node.id"
          @click="focusDir(row.node.id)"
        >
          <span
            class="caret"
            @click.stop="row.node.hasChildren && toggleExpand(row.node.id)"
          >{{ row.node.hasChildren ? (expanded.has(row.node.id) || dirKw ? '▾' : '▸') : '' }}</span>
          <span class="fi">📁</span>
          <span class="nm">{{ row.node.name }}</span>
          <span class="badge" :class="{ ok: dirBadgeSel(row.node) }">{{ dirBadge(row.node) }}</span>
          <button
            v-if="isDirSel(row.node.id)"
            class="pill sel"
            :disabled="disabled"
            :data-dir-pill="row.node.id"
            @click.stop="toggleDir(row.node.id)"
          >✓ 整目录</button>
          <button
            v-else
            class="pill"
            :disabled="disabled || isCovered(row.node.id)"
            :data-dir-pill="row.node.id"
            @click.stop="toggleDir(row.node.id)"
          >整目录</button>
        </div>
        <div v-if="!dirRows.length && !treeLoading" class="sse-empty">无匹配目录</div>
      </div>
    </div>

    <div class="sse-pane sse-srcs">
      <div class="sse-pane-h">
        <span class="p">
          <span class="t" data-testid="sse-focus-dir">源 · {{ focusNode ? focusNode.name : '未选择目录' }}</span>
          <span v-if="focusBucket?.loaded" class="sub">已选 {{ focusSelCount }}/{{ focusBucket.ids.length }}</span>
        </span>
        <span class="btns">
          <button
            class="mini"
            :disabled="disabled || !focusNode || !focusBucket?.loaded || focusCovered || focusNode.directCount === 0 || focusSelCount === focusBucket.ids.length"
            title="把本目录下的源全部单独加入"
            data-testid="sse-select-all"
            @click="selectAllDirSrcs"
          >全选</button>
          <button
            class="mini danger"
            :disabled="disabled || !focusBucket?.loaded || focusCovered || focusSelCount === 0"
            :title="`清除本目录下 ${focusSelCount} 个单独选中的源`"
            data-testid="sse-clear"
            @click="clearDirSrcs"
          >{{ focusSelCount ? `清空 (${focusSelCount})` : '清空' }}</button>
          <button
            class="mini whole"
            :class="{ on: focusId && isDirSel(focusId) }"
            :disabled="disabled || !focusId"
            data-testid="sse-whole"
            @click="focusId && toggleDir(focusId)"
          >{{ focusId && isDirSel(focusId) ? '✓ 已整目录' : '整目录授权' }}</button>
        </span>
      </div>
      <div class="sse-pane-search">
        <el-input v-model="srcKw" size="small" clearable :prefix-icon="Search" placeholder="搜索本目录下的源" data-testid="sse-src-kw" />
      </div>
      <div v-loading="!!focusBucket?.loading" class="sse-list">
        <div
          v-for="s in srcRows"
          :key="`s${s.id}`"
          class="sse-row src"
          :class="{ sel: isSrcSel(s.id), cov: focusCovered && !isSrcSel(s.id) }"
          :data-src="s.id"
          @click="!focusCovered && toggleSrc(s.id)"
        >
          <span class="fi">📄</span>
          <span class="nm">{{ s.name }}</span>
          <span class="id">#{{ s.id }}</span>
          <span v-if="focusCovered" class="pill cov" :data-src-pill="s.id">随整目录</span>
          <button v-else-if="isSrcSel(s.id)" class="pill sel" :disabled="disabled" :data-src-pill="s.id" @click.stop="toggleSrc(s.id)">✓ 已选</button>
          <button v-else class="pill" :disabled="disabled" :data-src-pill="s.id" @click.stop="toggleSrc(s.id)">加入</button>
        </div>
        <div v-if="srcHidden > 0" class="sse-more">
          <span>还有 {{ srcHidden }} 条未渲染</span>
          <button
            type="button"
            class="mini sse-more-btn"
            data-testid="sse-load-more"
            @click="loadMoreSources"
          >加载更多 ({{ Math.min(PAGE_RENDER_STEP, srcHidden) }})</button>
        </div>
        <div
          v-if="!srcRows.length && !focusBucket?.loading"
          class="sse-empty"
        >{{ focusNode ? (focusNode.directCount === 0 ? '该目录没有直属源，请在左侧选择其子目录' : '无匹配源') : '在左侧点一个目录' }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 两栏同构：pane-h 48 + 搜索条 54 + 行高 40，左右逐行对齐 */
.sse { display: flex; min-height: 0; height: 100%; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
.sse-pane { display: flex; flex-direction: column; min-height: 0; }
.sse-cats { width: 44%; border-right: 1px solid #e2e8f0; }
.sse-srcs { width: 56%; background: #f8fafc; }
.sse-pane-h { height: 48px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 14px; border-bottom: 1px solid #e2e8f0; font-size: 13px; font-weight: 600; }
.sse-pane-h .sub { font-size: 12px; color: #94a3b8; font-weight: 400; flex-shrink: 0; }
.sse-pane-h .p { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
.sse-pane-h .p .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sse-pane-h .btns { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
.sse-pane-search { height: 54px; flex-shrink: 0; display: flex; align-items: center; padding: 0 12px; border-bottom: 1px solid #e2e8f0; }
.sse-list { flex: 1; overflow: auto; }
.sse-row { height: 40px; display: flex; align-items: center; gap: 8px; padding: 0 12px; border-bottom: 1px solid #eef0f3; cursor: pointer; border-left: 3px solid transparent; }
.sse-row:hover { background: #f1f5f9; }
.sse-row .caret { width: 14px; text-align: center; color: #94a3b8; user-select: none; flex-shrink: 0; }
.sse-row .fi { flex-shrink: 0; }
.sse-row .nm { font-size: 13px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sse-row .id { font: 11px ui-monospace, monospace; color: #94a3b8; flex-shrink: 0; }
.sse-row .badge { font-size: 11px; color: #64748b; background: #eef2ff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0 6px; line-height: 17px; flex-shrink: 0; }
.sse-row .badge.ok { color: #15803d; background: #ecfdf5; border-color: #a7f3d0; }
.sse-row.dir.sel { background: #eff6ff; border-left-color: #2563eb; }
.sse-row.src.sel { background: #ecfdf5; border-left-color: #16a34a; }
.sse-row.src.cov { opacity: .55; }
.sse-row.dir.focus { box-shadow: inset 0 0 0 1px #bfdbfe; }
.pill { border: 1px solid #e2e8f0; background: #fff; color: #475569; border-radius: 14px; padding: 2px 10px; font-size: 11px; cursor: pointer; flex-shrink: 0; }
.pill:hover:not(:disabled) { border-color: #2563eb; color: #2563eb; }
.pill.sel { background: #2563eb; border-color: #2563eb; color: #fff; }
.sse-row.src .pill.sel { background: #16a34a; border-color: #16a34a; color: #fff; }
.pill.cov { color: #94a3b8; border-style: dashed; pointer-events: none; }
.pill:disabled, .mini:disabled { opacity: .45; cursor: not-allowed; }
.mini { border: 1px solid #e2e8f0; background: #fff; color: #475569; border-radius: 6px; padding: 3px 10px; font-size: 12px; cursor: pointer; }
.mini:hover:not(:disabled) { border-color: #2563eb; color: #2563eb; }
.mini.danger:hover:not(:disabled) { border-color: #dc2626; color: #dc2626; }
.mini.whole.on { background: #2563eb; border-color: #2563eb; color: #fff; }
.sse-empty { padding: 40px 10px; text-align: center; color: #94a3b8; font-size: 13px; }
.sse-more { padding: 8px 12px; font-size: 11px; color: #64748b; display: flex; align-items: center; justify-content: space-between; background: #fff; border-bottom: 1px solid #eef0f3; }
.sse-more-btn { color: #2563eb; border-color: #bfdbfe; }
</style>
