<script setup lang="ts">
// 源数据权限「范围编辑器」：内嵌在可见/排除 tab 里的双栏主从（左目录、右该目录含子级的源）。
//
// 目录口径照源管理左侧（api/sourceDirs.ts、SourceDirPanel.vue）：cfg_category 一张表里其实有两套树，
//   · 系统目录 = 源上的单个 cs_source.CATEGORY_ID；
//   · 业务目录 = 固定根 -2 下的树，成员只在 cfg_category_source_bind，一个源能同时进多个业务目录。
// 两套树的取源谓词不同，所以这里按 kind 走源管理同一条 sourcePaged{directory}（见 listDirectorySources）；
// 原来用的 source/categorySources 只把 ID 塞进 CATEGORY_ID IN (...)，业务目录点进去永远是空的。
//
// 交互口径（与源管理左侧对齐）：
//   · 两栏共用 pane-h(48) + 搜索条(54) + 行高 40 的结构，左右逐行对齐；
//   · 目录行首是三态勾选框：勾=该目录及全部子级、横线=子级只选了一部分、空=未选；
//   · 源行是三列：勾选框 / 源 ID / 源名称；被上级目录覆盖的源显示为已勾选且禁用（半透明）；
//   · 左栏搜索跨层级平铺（带路径），右栏搜索只在当前目录取回的源里过滤；
//   · 快捷动作：全选本目录（含子级）源 / 清空(N) 本目录单独选中的源；被上级目录覆盖或没有源时禁用。
// 只做选择与回显，落库交给 groupSourceScope（一次 modify-source-scope）。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowRight, Search } from '@element-plus/icons-vue'
import { dirNode, dirPath, expandDirIds, loadDirChildren, searchDirs, type DirKind, type DirNode } from '@/api/sourceDirs'
import { listDirectorySources, type SourceGrant } from '@/api/groupSourceScope'

const props = defineProps<{ grant: SourceGrant; kind: 'accept' | 'reject'; disabled?: boolean }>()
const emit = defineEmits<{ 'update:grant': [g: SourceGrant] }>()

/** 一个目录（含子级）一次取全的上限；超过就提示改为勾选该目录，而不是把几千个 ID 塞进一条规则 */
const DIR_SRC_LIMIT = 2000
/** 右栏单次渲染上限，超出可点击加载更多 */
const PAGE_RENDER_STEP = 200
/** 单源数超过这个值就建议改为勾选目录（ID 规则太长既难维护也会被后端拒） */
const SRC_HINT_THRESHOLD = 50

interface DirSrcs { ids: string[]; names: Record<string, string>; total: number; loading: boolean; loaded: boolean }
interface DirRow { node: DirNode; depth: number }

const dirKind = ref<DirKind>('biz')
const kidsOf = reactive(new Map<string, DirNode[]>())
const leaf = reactive(new Set<string>())
const open = reactive(new Set<string>())
const dirSrcs = reactive<Record<string, DirSrcs>>({})
const focusId = ref('')
const treeLoading = ref(false)
const dirKw = ref('')
const srcKw = ref('')
const hits = ref<DirNode[] | null>(null)
const searching = ref(false)
const loadError = ref('')
const renderLimit = ref(PAGE_RENDER_STEP)

const grant = computed<SourceGrant>(() => props.grant)
/** 子级缓存按 (kind, parentId) 分开：业务目录的根层挂在 -2 下，系统目录的根层 parentId 为空 */
const kidsKey = (k: DirKind, parentId: string) => (parentId ? `${k}:${parentId}` : `${k}:root`)
const roots = computed<DirNode[]>(() => kidsOf.get(kidsKey(dirKind.value, '')) ?? [])

function isDirSel(id: string): boolean { return grant.value.dirIds.includes(id) }
function isSrcSel(id: string): boolean { return grant.value.sourceIds.includes(id) }

function emitGrant(next: SourceGrant) {
  emit('update:grant', { dirIds: [...new Set(next.dirIds)], sourceIds: [...new Set(next.sourceIds)] })
}

/** 已知父链（只到已经加载过的节点；没加载的当未知，不拿来断言勾满） */
function ancestorsOf(id: string): string[] {
  const chain: string[] = []
  let cur: string | undefined = dirNode(id)?.parentId || undefined
  while (cur) {
    chain.push(cur)
    cur = dirNode(cur)?.parentId || undefined
  }
  return chain
}

/** 被祖先目录勾选覆盖：本目录及子级都已在授权范围内，不能再单独改 */
function coveredByAncestor(id: string): boolean { return ancestorsOf(id).some(isDirSel) }

/** 已经加载出来的全部后代 ID（懒加载下只有展开过的那几层） */
function descendantsLoaded(id: string): string[] {
  const acc: string[] = []
  const walk = (parent: string) => (kidsOf.get(kidsKey(dirKind.value, parent)) ?? []).forEach((kid) => { acc.push(kid.id); walk(kid.id) })
  walk(id)
  return acc
}

/**
 * 某源是否已在授权范围内：被单独选中，或被某个「已取过源并且被勾选」的目录覆盖。
 * 只看已取过源的目录 —— 没取过的目录不知道它含不含这个源，宁可不认，也不要把没验证的状态说成已授权。
 */
function srcCovered(id: string): boolean {
  if (isSrcSel(id)) return true
  return grant.value.dirIds.some((dir) => {
    const bucket = dirSrcs[dir]
    return !!bucket?.loaded && bucket.ids.includes(id)
  })
}

const bucketAll = (id: string) => { const b = dirSrcs[id]; return !!b?.loaded && b.ids.length > 0 && b.ids.every(srcCovered) }
const bucketSome = (id: string) => { const b = dirSrcs[id]; return !!b?.loaded && b.ids.some(srcCovered) }

/**
 * 三态勾选（组织架构那种）。
 * 勾 = 该目录本身被勾选（后端展开成自身+全部后代），或它取回的子树源已经全覆盖（子级逐个勾满时也会归到这里）；
 * 横线 = 取回的子树里只覆盖了一部分，或已加载的后代里有勾上的目录；
 * 空 = 什么都没有。
 * 没取过源的目录不给勾也不给横线判定 —— 懒加载下缺证据就保守显示。
 */
function dirChecked(id: string): boolean { return isDirSel(id) || bucketAll(id) }

function dirPartial(id: string): boolean {
  if (dirChecked(id)) return false
  if (bucketSome(id)) return true
  return descendantsLoaded(id).some((d) => isDirSel(d) || bucketSome(d))
}

async function toggleDir(id: string, checked: boolean) {
  if (props.disabled) return
  const desc = new Set(descendantsLoaded(id))
  const dirIds = grant.value.dirIds.filter((d) => d !== id && !desc.has(d))
  const bucket = dirSrcs[id]
  if (checked) {
    // 勾上=自身及全部子级；子树里单独选中的源已被覆盖，收掉避免规则重复
    emitGrant({
      dirIds: [...dirIds, id],
      sourceIds: bucket?.loaded ? grant.value.sourceIds.filter((s) => !bucket.ids.includes(s)) : grant.value.sourceIds,
    })
    // 子级是懒加载的：只把节点标成展开取不到人，得先把子级取回来，用户才看得到「子级已被覆盖、勾选框变灰」
    if (!leaf.has(id)) {
      const list = await ensureKids(dirKind.value, id)
      if (list.length) open.add(id)
    }
    return
  }
  if (isDirSel(id)) {
    // 真按目录授权时只收目录条目：存量规则里可能混着手写的单源 ID，不替用户多删
    emitGrant({ dirIds, sourceIds: grant.value.sourceIds })
    return
  }
  // 勾满来自「子级逐层勾到」或「取回的子树源全选」，取消时把这两类一起收掉，否则点完还是勾
  const covered = new Set<string>()
  ;[id, ...desc].forEach((d) => {
    if (d !== id && isDirSel(d)) return
    const b = dirSrcs[d]
    if (b?.loaded) b.ids.forEach((s) => covered.add(s))
  })
  emitGrant({ dirIds, sourceIds: grant.value.sourceIds.filter((s) => !covered.has(s)) })
}

async function ensureKids(k: DirKind, parentId = ''): Promise<DirNode[]> {
  const key = kidsKey(k, parentId)
  const cached = kidsOf.get(key)
  if (cached) return cached
  try {
    const list = await loadDirChildren(k, parentId)
    kidsOf.set(key, list)
    if (parentId && !list.length) leaf.add(parentId)
    loadError.value = ''
    // 父级已勾选时，展开出来的子级 ID 是冗余条目（后端展开本来含它们），随展开收敛一次
    if (parentId && isDirSel(parentId) && list.some((c) => isDirSel(c.id))) {
      const drop = new Set(list.map((c) => c.id))
      emitGrant({ dirIds: grant.value.dirIds.filter((d) => !drop.has(d)), sourceIds: grant.value.sourceIds })
    }
    return list
  } catch (e) {
    // 失败不缓存：下次展开重试；也不让它冒充成"这个目录没有子级"
    loadError.value = `目录加载失败：${e instanceof Error ? e.message : String(e)}`
    return []
  }
}

async function ensureDirSources(id: string) {
  if (!dirSrcs[id]) dirSrcs[id] = { ids: [], names: {}, total: 0, loading: false, loaded: false }
  // 必须取回代理引用再改：直接改局部原始对象不会触发响应式更新（徽标/按钮禁用态会停在旧值）
  const bucket = dirSrcs[id]
  if (bucket.loaded || bucket.loading) return
  bucket.loading = true
  try {
    const res = await listDirectorySources(dirKind.value, id, { limit: DIR_SRC_LIMIT })
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

async function focusDir(id: string) {
  focusId.value = id
  renderLimit.value = PAGE_RENDER_STEP
  await ensureDirSources(id)
}

async function switchKind(k: DirKind) {
  if (dirKind.value === k) return
  dirKind.value = k
  dirKw.value = ''
  hits.value = null
  focusId.value = ''
  treeLoading.value = true
  try {
    const first = (await ensureKids(k))[0]
    if (first) await focusDir(first.id)
  } finally {
    treeLoading.value = false
  }
}

// 懒加载的树要「全部展开」就得先把子级取下来；expandDirIds 自带并发与缓存，取回来的层再喂给本地缓存
async function expandAll() {
  treeLoading.value = true
  try {
    const all = await expandDirIds(dirKind.value, roots.value.map((n) => n.id))
    for (const id of all) {
      const list = await ensureKids(dirKind.value, id)
      if (list.length) open.add(id)
    }
  } finally {
    treeLoading.value = false
  }
}

/** 展开箭头：第一次点要先把子级取回来，取到非空才记成展开（空目录直接算叶子，不再重复请求） */
async function toggleNode(node: DirNode) {
  if (open.has(node.id)) {
    open.delete(node.id)
    return
  }
  const list = await ensureKids(dirKind.value, node.id)
  if (list.length) open.add(node.id)
}

function collapseAll() {
  open.clear()
}

let kwTimer: ReturnType<typeof setTimeout> | undefined
let searchSeq = 0
// 搜索是跨层级的（后端 searchCategories），结果平铺并带上所属路径，命中项不在当前已加载层里也能勾到
watch(dirKw, (kw) => {
  clearTimeout(kwTimer)
  if (!kw.trim()) { hits.value = null; return }
  kwTimer = setTimeout(async () => {
    const seq = ++searchSeq
    searching.value = true
    try {
      const list = await searchDirs(dirKind.value, kw.trim())
      if (seq === searchSeq) hits.value = list
    } catch {
      if (seq === searchSeq) hits.value = []
    } finally {
      if (seq === searchSeq) searching.value = false
    }
  }, 300)
})

const rows = computed<DirRow[]>(() => {
  const out: DirRow[] = []
  const walk = (list: DirNode[], depth: number) => list.forEach((node) => {
    out.push({ node, depth })
    if (open.has(node.id)) walk(kidsOf.get(kidsKey(dirKind.value, node.id)) ?? [], depth + 1)
  })
  walk(roots.value, 0)
  return out
})

const pathOf = (node: DirNode): string => (node.parentId ? dirPath(node.parentId).join(' / ') : '')

const focusNode = computed<DirNode | null>(() => (focusId.value ? dirNode(focusId.value) ?? null : null))
const focusBucket = computed<DirSrcs | null>(() => (focusId.value ? dirSrcs[focusId.value] ?? null : null))
const focusSelCount = computed(() => {
  const bucket = focusBucket.value
  if (!bucket) return 0
  return bucket.ids.reduce((acc, id) => acc + (isSrcSel(id) ? 1 : 0), 0)
})
const focusCovered = computed(() => !!focusId.value && (isDirSel(focusId.value) || coveredByAncestor(focusId.value)))

function toggleSrc(id: string) {
  if (props.disabled) return
  emitGrant({
    dirIds: grant.value.dirIds,
    sourceIds: isSrcSel(id) ? grant.value.sourceIds.filter((s) => s !== id) : [...grant.value.sourceIds, id],
  })
}

function selectAllDirSrcs() {
  if (props.disabled || !focusId.value) return
  const bucket = focusBucket.value
  if (!bucket?.loaded) return
  if (bucket.total > bucket.ids.length) {
    ElMessage.warning(`该目录（含子级）源数 ${bucket.total} 超过单次取数上限，请改为勾选左侧该目录`)
    return
  }
  emitGrant({ dirIds: grant.value.dirIds, sourceIds: [...new Set([...grant.value.sourceIds, ...bucket.ids])] })
  if (bucket.ids.length > SRC_HINT_THRESHOLD) {
    ElMessage.warning(`本目录（含子级）已选 ${bucket.ids.length} 个源；源这么多建议直接勾选目录，单源规则会很难维护`)
  }
}

function clearDirSrcs() {
  if (props.disabled || !focusId.value) return
  const bucket = focusBucket.value
  if (!bucket?.loaded) return
  const inDir = new Set(bucket.ids)
  emitGrant({ dirIds: grant.value.dirIds, sourceIds: grant.value.sourceIds.filter((s) => !inDir.has(s)) })
}

/** 源筛选：名称或源 ID 都算命中（源 ID 就是右栏那一列，报 ID 时应该直接定位到它） */
const srcMatches = (id: string, bucket: DirSrcs, k: string) =>
  !k || id.toLowerCase().includes(k) || (bucket.names[id] ?? '').toLowerCase().includes(k)

const srcRows = computed(() => {
  const bucket = focusBucket.value
  if (!bucket) return []
  const k = srcKw.value.trim().toLowerCase()
  return bucket.ids
    .filter((id) => srcMatches(id, bucket, k))
    .slice(0, renderLimit.value)
    .map((id) => ({ id, name: bucket.names[id] || id }))
})
const srcHidden = computed(() => {
  const bucket = focusBucket.value
  if (!bucket) return 0
  const k = srcKw.value.trim().toLowerCase()
  const matched = bucket.ids.filter((id) => srcMatches(id, bucket, k)).length
  return Math.max(0, matched - srcRows.value.length)
})

function loadMoreSources() {
  renderLimit.value += PAGE_RENDER_STEP
}

onMounted(async () => {
  treeLoading.value = true
  try {
    let list = await ensureKids('biz')
    // 还没有业务目录的环境退到系统目录，别把左栏留空（口径同 SourceDirPanel.init）
    if (!list.length && !loadError.value) {
      dirKind.value = 'sys'
      list = await ensureKids('sys')
    }
    const first = list[0]
    if (first) await focusDir(first.id)
  } finally {
    treeLoading.value = false
  }
})
</script>

<template>
  <div class="sse" :class="{ biz: dirKind === 'biz' }">
    <div class="sse-pane sse-cats">
      <div class="sse-pane-h">
        <div class="sse-kind" role="tablist" aria-label="目录类型">
          <button
            type="button"
            role="tab"
            :aria-selected="dirKind === 'sys'"
            :class="{ on: dirKind === 'sys' }"
            data-testid="sse-kind-sys"
            @click="switchKind('sys')"
          >系统目录</button>
          <button
            type="button"
            role="tab"
            :aria-selected="dirKind === 'biz'"
            :class="{ on: dirKind === 'biz' }"
            data-testid="sse-kind-biz"
            @click="switchKind('biz')"
          >业务目录</button>
        </div>
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
        <div v-if="loadError" class="sse-empty" data-testid="sse-dir-error">{{ loadError }}</div>
        <template v-else-if="hits">
          <div v-if="searching" class="sse-empty">搜索中…</div>
          <div v-else-if="!hits.length" class="sse-empty">无匹配目录</div>
          <div
            v-for="node in hits"
            v-else
            :key="`h${node.id}`"
            class="sse-row dir"
            :class="{ sel: dirChecked(node.id), focus: node.id === focusId }"
            :data-dir="node.id"
            @click="focusDir(node.id)"
          >
            <span class="caret" />
            <input
              type="checkbox"
              class="sse-check"
              :checked="dirChecked(node.id)"
              :indeterminate.prop="dirPartial(node.id)"
              :disabled="disabled || coveredByAncestor(node.id)"
              :aria-label="`勾选 ${node.name}`"
              :data-dir-check="node.id"
              @click.stop
              @change="toggleDir(node.id, ($event.target as HTMLInputElement).checked)"
            >
            <span class="nm">
              {{ node.name }}
              <span v-if="pathOf(node)" class="sse-path">{{ pathOf(node) }}</span>
            </span>
          </div>
        </template>
        <template v-else>
          <div
            v-for="row in rows"
            :key="`d${row.node.id}`"
            class="sse-row dir"
            :class="{ sel: dirChecked(row.node.id), focus: row.node.id === focusId }"
            :style="{ paddingLeft: `${8 + row.depth * 16}px` }"
            :data-dir="row.node.id"
            @click="focusDir(row.node.id)"
          >
            <button
              v-if="!leaf.has(row.node.id)"
              class="caret btn"
              :class="{ open: open.has(row.node.id) }"
              type="button"
              :aria-label="open.has(row.node.id) ? '收起' : '展开'"
              @click.stop="toggleNode(row.node)"
            ><el-icon><ArrowRight /></el-icon></button>
            <span v-else class="caret" />
            <input
              type="checkbox"
              class="sse-check"
              :checked="dirChecked(row.node.id)"
              :indeterminate.prop="dirPartial(row.node.id)"
              :disabled="disabled || coveredByAncestor(row.node.id)"
              :aria-label="`勾选 ${row.node.name}`"
              :data-dir-check="row.node.id"
              @click.stop
              @change="toggleDir(row.node.id, ($event.target as HTMLInputElement).checked)"
            >
            <span class="nm">{{ row.node.name }}</span>
            <span v-if="row.node.count != null" class="badge">{{ row.node.count }}</span>
          </div>
          <div v-if="!rows.length && !treeLoading" class="sse-empty">无匹配目录</div>
        </template>
      </div>
    </div>

    <div class="sse-pane sse-srcs">
      <div class="sse-pane-h">
        <span class="p">
          <span class="t" data-testid="sse-focus-dir">源 · {{ focusNode ? focusNode.name : '未选择目录' }}</span>
          <span v-if="focusBucket?.loaded" class="sub">含子级 · 已选 {{ focusSelCount }}/{{ focusBucket.ids.length }}</span>
        </span>
        <span class="btns">
          <button
            class="mini"
            :disabled="disabled || !focusNode || !focusBucket?.loaded || focusCovered || !focusBucket.ids.length || focusSelCount === focusBucket.ids.length"
            title="把本目录及其子级的源全部单独加入"
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
        </span>
      </div>
      <div class="sse-pane-search">
        <el-input v-model="srcKw" size="small" clearable :prefix-icon="Search" placeholder="搜索本目录（含子级）的源名称或源 ID" data-testid="sse-src-kw" />
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
          <input
            type="checkbox"
            class="sse-check"
            :checked="focusCovered || isSrcSel(s.id)"
            :disabled="disabled || focusCovered"
            :aria-label="`勾选 ${s.name}`"
            :data-src-check="s.id"
            @click.stop
            @change="toggleSrc(s.id)"
          >
          <span class="col-id">#{{ s.id }}</span>
          <span class="col-nm">{{ s.name }}</span>
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
        >{{ focusNode ? (focusBucket?.loaded && !focusBucket.ids.length ? '该目录及其子级下没有源' : '无匹配源') : '在左侧点一个目录' }}</div>
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
.sse-pane-h { height: 48px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; font-weight: 600; }
.sse-pane-h .sub { font-size: 12px; color: #94a3b8; font-weight: 400; flex-shrink: 0; }
.sse-pane-h .p { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
.sse-pane-h .p .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sse-pane-h .btns { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
/* 系统/业务二选一，视觉语言照源管理左侧的 .sdp-kind（业务目录用紫、系统目录用主蓝） */
.sse-kind { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; padding: 3px; background: #eef2f7; border-radius: 8px; flex-shrink: 0; }
.sse-kind button { border: 0; background: transparent; padding: 4px 10px; border-radius: 6px; font-size: 12.5px; font-weight: 600; color: #64748b; cursor: pointer; white-space: nowrap; }
.sse-kind button.on { background: #fff; color: #2563eb; box-shadow: 0 1px 3px rgba(0, 0, 0, .1); }
.sse.biz .sse-kind button.on { color: #7c3aed; }
.sse-pane-search { height: 54px; flex-shrink: 0; display: flex; align-items: center; padding: 0 12px; border-bottom: 1px solid #e2e8f0; }
.sse-list { flex: 1; overflow: auto; }
.sse-row { height: 40px; display: flex; align-items: center; gap: 8px; padding: 0 12px; border-bottom: 1px solid #eef0f3; cursor: pointer; border-left: 3px solid transparent; }
.sse-row:hover { background: #f1f5f9; }
.sse-row .caret { width: 16px; display: inline-flex; align-items: center; justify-content: center; color: #94a3b8; flex-shrink: 0; }
.sse-row .caret.btn { border: 0; background: none; cursor: pointer; padding: 0; }
.sse-row .caret.btn.open { transform: rotate(90deg); }
.sse-check { flex-shrink: 0; margin: 0; accent-color: #2563eb; cursor: pointer; }
.sse.biz .sse-check { accent-color: #7c3aed; }
.sse-check:disabled { cursor: not-allowed; }
.sse-row .nm { font-size: 13px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 搜索结果平铺时把所属路径跟在名字后面，避免同名目录看不出层级 */
.sse-row .sse-path { margin-left: 6px; color: #94a3b8; font-size: 11px; }
/* 源行三列：勾选框 | 源 ID | 源名称 */
.sse-row .col-id { width: 128px; flex-shrink: 0; font: 11px ui-monospace, monospace; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sse-row .col-nm { font-size: 13px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sse-row .badge { font-size: 11px; color: #64748b; background: #eef2ff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0 6px; line-height: 17px; flex-shrink: 0; }
.sse-row.dir.sel { background: #eff6ff; border-left-color: #2563eb; }
.sse.biz .sse-row.dir.sel { background: #f5f3ff; border-left-color: #7c3aed; }
.sse-row.src.sel { background: #ecfdf5; border-left-color: #16a34a; }
.sse-row.src.cov { opacity: .55; }
.sse-row.dir.focus { box-shadow: inset 0 0 0 1px #bfdbfe; }
.mini { border: 1px solid #e2e8f0; background: #fff; color: #475569; border-radius: 6px; padding: 3px 10px; font-size: 12px; cursor: pointer; }
.mini:hover:not(:disabled) { border-color: #2563eb; color: #2563eb; }
.mini.danger:hover:not(:disabled) { border-color: #dc2626; color: #dc2626; }
.mini:disabled { opacity: .45; cursor: not-allowed; }
.sse-empty { padding: 40px 10px; text-align: center; color: #94a3b8; font-size: 13px; }
.sse-more { padding: 8px 12px; font-size: 11px; color: #64748b; display: flex; align-items: center; justify-content: space-between; background: #fff; border-bottom: 1px solid #eef0f3; }
.sse-more-btn { color: #2563eb; border-color: #bfdbfe; }
</style>
