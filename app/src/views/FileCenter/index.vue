<script setup lang="ts">
// 文件中心（方案 A，11-08 用户拍板「按照A实现」）：左栏业务目录树，右栏只放 SiteFileView。
// 范围只有「目录」一维：目录收窄的是右栏源选择器里可选的源（业务目录成员）；选源 = 单源直查
// （后端 total 准确），不选源 = 整张文件表全量（表头会明示「未选源 → 整表全量」）。
// 「目录 → 源 → 文件」的选择链由 SiteFileView 内的源选择器承担，这里不再自建源下拉/范围条。
//
// 目录内源候选由 SiteFileView 的 GlobalSourceSelect 走 `sourcePaged` 的 directory 条件：
// 业务目录成员在 cfg_category_source_bind，后端用 `SOURCE_ID IN ...` 谓词解析范围；前端不枚举源 ID，
// 也不调 category/listSources（那套只对系统目录成立，业务目录永远查到空）。
//
// URL 只承载 dirId / sourceId：`?dirId=X` 选中目录，`?sourceId=Y` 作为 initial-source-id 传给
// SiteFileView（越界清源由 SiteFileView 的 sourceScopeDirId watcher 负责）。旧 `?siteId=` 忽略，
// 并用一次性 ElMessage 告知用户（不再常驻提示行、不再有 ? ? tooltip）。
//
// 版式（1106 §3.2）：左栏复用源管理 SourceDirPanel 的 .sdp-* 样式（业务目录紫色主题、30px 行、
// ArrowRight 箭头、可折叠成 36px 竖排 rail）；右栏不设范围条，目录面包屑与「未选源」说明改由
// SiteFileView 表头承载（scopeLabel / 目录范围提示）。
//
// 已知限制（本次不改，需后端跟进）：
// 1. SiteFileView 内部切源不回写 URL（组件无 emits），URL 里的 sourceId 只在进入时生效；
// 2. 未选源时展示的是**整张文件表**的全量记录，不是目录内跨源汇总——目录级跨源文件分页需后端聚合接口。
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowRight } from '@element-plus/icons-vue'
import { BIZ_DIR_ROOT_ID, dirNode, dirPath, loadDirChildren, loadDirPath, searchDirs, type DirNode } from '@/api/sourceDirs'
import SiteFileView from '@/views/FlowCanvas/result/SiteFileView.vue'

const route = useRoute()
const router = useRouter()

const SEARCH_DELAY = 300

const dirId = ref('')
const sourceId = ref('')
const dirNames = ref<string[]>([])
/** 左栏折叠态：折叠后只留 36px 竖排 rail，与源管理左栏一致 */
const dirCollapsed = ref(false)

// ---------------- 业务目录树 ----------------
const dirRoot = ref<DirNode[]>([])
// 用 reactive Map：子级回来后要触发 dirRows 重新计算
const dirKids = reactive(new Map<string, DirNode[]>())
const dirOpen = reactive(new Set<string>())
const dirLeaf = reactive(new Set<string>())
const dirLoading = reactive(new Set<string>())
const dirError = ref('')
const dirKeyword = ref('')
const dirHits = ref<DirNode[] | null>(null)
const dirSearching = ref(false)
const dirSearchError = ref('')
let dirSearchTimer: ReturnType<typeof setTimeout> | undefined
let dirSearchSeq = 0

interface DirRow {
  node: DirNode
  depth: number
}
const dirRows = computed<DirRow[]>(() => {
  const out: DirRow[] = []
  const walk = (list: DirNode[], depth: number) => {
    for (const node of list) {
      out.push({ node, depth })
      if (dirOpen.has(node.id)) walk(dirKids.get(node.id) ?? [], depth + 1)
    }
  }
  walk(dirRoot.value, 0)
  return out
})
const dirRootLoading = computed(() => dirLoading.has('biz:root'))

function dirCacheKey(parentId: string): string {
  return parentId || 'biz:root'
}

async function ensureDirKids(parentId = ''): Promise<DirNode[]> {
  const key = dirCacheKey(parentId)
  const cached = dirKids.get(key)
  if (cached) return cached
  dirLoading.add(key)
  try {
    const list = await loadDirChildren('biz', parentId)
    dirKids.set(key, list)
    if (parentId && !list.length) dirLeaf.add(parentId)
    if (!parentId) dirRoot.value = list
    dirError.value = ''
    return list
  } catch (cause) {
    // 只有根层失败才占满面板；子级拉不到只当没子目录，别让整棵树报错
    if (!parentId) dirError.value = `目录加载失败：${cause instanceof Error ? cause.message : String(cause)}`
    return []
  } finally {
    dirLoading.delete(key)
  }
}

async function toggleDir(node: DirNode): Promise<void> {
  if (dirOpen.has(node.id)) {
    dirOpen.delete(node.id)
    return
  }
  dirOpen.add(node.id)
  await ensureDirKids(node.id)
}

watch(dirKeyword, (value) => {
  if (dirSearchTimer) clearTimeout(dirSearchTimer)
  const keyword = value.trim()
  if (!keyword) {
    dirHits.value = null
    dirSearching.value = false
    dirSearchError.value = ''
    return
  }
  dirSearchTimer = setTimeout(() => void runDirSearch(keyword), SEARCH_DELAY)
})

async function runDirSearch(keyword: string): Promise<void> {
  const seq = ++dirSearchSeq
  dirSearching.value = true
  dirSearchError.value = ''
  try {
    const hits = await searchDirs('biz', keyword)
    if (seq === dirSearchSeq) dirHits.value = hits
  } catch (cause) {
    if (seq !== dirSearchSeq) return
    dirHits.value = []
    dirSearchError.value = `目录搜索失败：${cause instanceof Error ? cause.message : String(cause)}`
  } finally {
    if (seq === dirSearchSeq) dirSearching.value = false
  }
}

/** 搜索命中的目录可能还很深：带上已加载的父级路径，便于在平铺结果里认出来 */
function hitPath(node: DirNode): string {
  return node.parentId ? dirPath(node.parentId).join(' / ') : ''
}

/** 展开某个目录的祖先链，让深链选中的目录能在树里露出来（只开祖先，不擅自展开自己） */
async function revealDir(id: string): Promise<void> {
  const chain: string[] = []
  const seen = new Set<string>()
  for (let cur = dirNode(id)?.parentId ?? ''; cur && cur !== BIZ_DIR_ROOT_ID && !seen.has(cur);) {
    seen.add(cur)
    chain.unshift(cur)
    cur = dirNode(cur)?.parentId ?? ''
  }
  await ensureDirKids()
  for (const nodeId of chain) {
    const kids = await ensureDirKids(nodeId)
    if (kids.length) dirOpen.add(nodeId)
  }
}

async function loadDirNames(id: string): Promise<void> {
  try {
    const names = await loadDirPath(id)
    if (dirId.value === id && names.length) dirNames.value = names
  } catch {
    // 名字拿不到就退回「目录 <id>」，不影响范围本身
  }
}

// ---------------- 选择与 URL ----------------
function queryString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** URL 只承载「目录 + 源」两个范围维度；旧的 siteId 会在这里被移除 */
function syncRoute(): void {
  const query: Record<string, string> = {}
  if (dirId.value) query.dirId = dirId.value
  if (sourceId.value) query.sourceId = sourceId.value
  const current = route.query
  const same = queryString(current.dirId) === (query.dirId ?? '')
    && queryString(current.sourceId) === (query.sourceId ?? '')
    && !('siteId' in current)
  if (same) return
  void router.replace({ path: '/files', query })
}

/** 选目录只改目录范围；源的越界校验交给 SiteFileView（目录 → 源 的收窄在右栏内完成） */
async function pickDir(node: DirNode | null): Promise<void> {
  const next = node?.id ?? ''
  if (next === dirId.value) return
  dirId.value = next
  dirNames.value = node ? dirPath(node.id) : []
  if (node) {
    void revealDir(node.id)
    // 搜索命中或深链进来的子目录，已加载节点拼不出完整祖先链时补一次路径
    if (node.parentId) void loadDirNames(node.id)
  }
  syncRoute()
}

async function restoreDir(id: string): Promise<void> {
  try {
    await loadDirPath(id)
    if (dirId.value !== id) return
    dirNames.value = dirPath(id)
    void revealDir(id)
  } catch {
    if (dirId.value !== id) return
    dirId.value = ''
    dirNames.value = []
    ElMessage.warning('目录不存在或无权访问，已回到全部业务目录')
  }
}

let restoring = false
/** 首次进入时状态和空路由「恰好相同」，也要跑一次首屏加载，之后才允许早退 */
let routeSynced = false
async function restoreFromRoute(): Promise<void> {
  if (restoring) return
  const nextDir = queryString(route.query.dirId)
  const nextSource = queryString(route.query.sourceId)
  const legacySite = queryString(route.query.siteId)
  if (routeSynced && nextDir === dirId.value && nextSource === sourceId.value && !legacySite) return
  routeSynced = true
  restoring = true
  try {
    dirId.value = nextDir
    sourceId.value = nextSource
    dirNames.value = nextDir ? dirPath(nextDir) : []
    if (nextDir) await restoreDir(nextDir)
    syncRoute()
    // 旧链接的 ?siteId= 已不再是范围维度：忽略但明确告知（一次性，不常驻）
    if (legacySite) ElMessage.warning(`网站范围已改为按源查看，已忽略 ?siteId=${legacySite}`)
  } finally {
    restoring = false
  }
}

/** 表头面包屑：未选目录时为空串，由 SiteFileView 决定不渲染「目录：」前缀 */
const dirLabel = computed(() => (
  dirId.value ? (dirNames.value.length ? dirNames.value.join(' / ') : `目录 ${dirId.value}`) : ''
))

onMounted(() => {
  void ensureDirKids()
  void restoreFromRoute()
})
watch(() => [route.query.dirId, route.query.siteId, route.query.sourceId], () => void restoreFromRoute())
onBeforeUnmount(() => {
  if (dirSearchTimer) clearTimeout(dirSearchTimer)
})
</script>

<template>
  <main class="fc-shell" :class="{ folded: dirCollapsed }">
    <!-- 左栏：业务目录树，样式复用源管理 SourceDirPanel 的 .sdp-*（业务目录紫色主题、30px 行、可折叠） -->
    <section v-if="!dirCollapsed" class="sdp biz" aria-label="业务目录" data-testid="file-center-dir-panel">
      <div class="sdp-head">
        <div class="sdp-kind single" role="tablist" aria-label="目录类型">
          <button type="button" role="tab" aria-selected="true" class="on" data-testid="file-center-dir-kind">业务目录</button>
        </div>
        <button
          class="sdp-fold"
          type="button"
          title="收起目录"
          aria-label="收起目录"
          data-testid="file-center-dir-collapse"
          @click="dirCollapsed = true"
        >«</button>
      </div>
      <input
        v-model="dirKeyword"
        class="sdp-search"
        placeholder="搜索目录"
        aria-label="搜索业务目录"
        data-testid="file-center-dir-search"
      >
      <div class="sdp-tree" data-testid="file-center-dir-tree">
        <template v-if="dirHits">
          <div v-if="dirSearching" class="sdp-empty">搜索中…</div>
          <div v-else-if="dirSearchError" class="sdp-empty err">{{ dirSearchError }}</div>
          <div v-else-if="!dirHits.length" class="sdp-empty" data-testid="file-center-dir-no-match">没有匹配的目录</div>
          <template v-else>
            <button
              v-for="node in dirHits"
              :key="node.id"
              class="sdp-row"
              :class="{ on: dirId === node.id }"
              type="button"
              :data-dir="node.id"
              data-testid="file-center-dir-hit"
              @click="pickDir(node)"
            >
              <span class="sdp-caret" />
              <span class="sdp-name" :title="node.name">{{ node.name }}</span>
              <span v-if="hitPath(node)" class="sdp-path">{{ hitPath(node) }}</span>
            </button>
          </template>
        </template>
        <template v-else>
          <div
            class="sdp-row"
            :class="{ on: !dirId }"
            data-testid="file-center-dir-all"
            @click="pickDir(null)"
          >
            <span class="sdp-caret" />
            <span class="sdp-name">全部业务目录</span>
          </div>
          <div
            v-for="row in dirRows"
            :key="row.node.id"
            class="sdp-row"
            :class="{ on: dirId === row.node.id }"
            :style="{ paddingLeft: `${4 + row.depth * 16}px` }"
            :data-dir="row.node.id"
            data-testid="file-center-dir-row"
          >
            <button
              v-if="!dirLeaf.has(row.node.id)"
              class="sdp-caret btn"
              :class="{ open: dirOpen.has(row.node.id) }"
              type="button"
              :aria-label="dirOpen.has(row.node.id) ? '收起目录' : '展开目录'"
              data-testid="file-center-dir-caret"
              @click.stop="toggleDir(row.node)"
            ><el-icon><ArrowRight /></el-icon></button>
            <span v-else class="sdp-caret" />
            <button
              class="sdp-name btn"
              type="button"
              :title="dirPath(row.node.id).join(' / ') || row.node.name"
              data-testid="file-center-dir-name"
              @click="pickDir(row.node)"
            >{{ row.node.name }}</button>
            <span v-if="row.node.count != null" class="sdp-count">{{ row.node.count }}</span>
          </div>
          <div v-if="dirRootLoading" class="sdp-empty">加载中…</div>
          <div v-else-if="dirError" class="sdp-empty err">
            <span>{{ dirError }}</span>
            <button class="sdp-link" type="button" data-testid="file-center-dir-retry" @click="ensureDirKids()">重试</button>
          </div>
          <div v-else-if="!dirRows.length" class="sdp-empty">还没有业务目录</div>
        </template>
      </div>
      <div class="sdp-foot">目录的新增、改名、删除在「系统设置 → 分类目录」</div>
    </section>
    <button
      v-else
      class="sdp-rail biz"
      type="button"
      title="展开目录"
      aria-label="展开目录"
      data-testid="file-center-dir-rail"
      @click="dirCollapsed = false"
    >
      <span class="sdp-rail-arrow">»</span>
      <span class="sdp-rail-txt">业务目录</span>
      <span v-if="dirId" class="sdp-rail-dot">1</span>
    </button>

    <!-- 右栏：不再有范围条——目录面包屑与「未选源」说明由 SiteFileView 表头承载 -->
    <SiteFileView
      :initial-source-id="sourceId || undefined"
      :source-scope-dir-id="dirId || undefined"
      :scope-label="dirLabel"
      class="fc-files"
    />
  </main>
</template>

<style scoped>
/* 左栏样式对齐源管理左侧目录面板 SourceDirPanel（.sdp-*，11-08 用户反馈「跟其他页面保持一致」） */
.fc-shell { display: grid; grid-template-columns: 252px minmax(0, 1fr); gap: 12px; height: 100%; min-height: 0; }
.fc-shell.folded { grid-template-columns: 36px minmax(0, 1fr); }

.sdp { display: flex; flex-direction: column; min-height: 0; padding: 12px; background: #fff; border: 1px solid var(--rc-border); border-radius: 12px; }
.sdp-head { flex: none; display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
.sdp-kind { flex: 1; display: grid; grid-template-columns: 1fr; padding: 3px; background: #eef2f7; border-radius: 8px; }
.sdp-kind button { border: 0; background: transparent; padding: 5px 0; border-radius: 6px; font-size: 13px; font-weight: 600; color: #64748b; cursor: pointer; white-space: nowrap; }
.sdp-kind button.on { background: #fff; color: var(--rc-text); box-shadow: 0 1px 3px rgba(0, 0, 0, .1); }
.sdp.biz .sdp-kind button.on { color: #7c3aed; }
.sdp-fold { flex: none; width: 26px; height: 26px; border: 0; border-radius: 6px; background: none; color: var(--rc-faint); cursor: pointer; font-size: 14px; }
.sdp-fold:hover { background: #f1f5f9; color: var(--rc-text); }
.sdp-search { flex: none; box-sizing: border-box; width: 100%; height: 30px; min-height: 30px; padding: 0 10px; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; font-size: 13px; line-height: 28px; outline: none; }
.sdp.biz .sdp-search:focus { border-color: #7c3aed; }
.sdp-tree { flex: 1; min-height: 0; margin-top: 8px; overflow: auto; }
.sdp-row { display: flex; align-items: center; gap: 4px; width: 100%; height: 30px; padding: 0 4px; border: 0; border-radius: 6px; background: none; color: var(--rc-text); font-size: 13px; text-align: left; box-sizing: border-box; }
.sdp-row:hover { background: #f1f5f9; }
.sdp-row.on { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.sdp.biz .sdp-row.on { background: #f5f3ff; color: #7c3aed; }
.sdp-caret { flex: none; display: inline-grid; place-items: center; width: 16px; height: 16px; color: var(--rc-faint); font-size: 12px; }
.sdp-caret.btn { border: 0; background: none; padding: 0; cursor: pointer; border-radius: 4px; }
.sdp-caret.btn:hover { color: var(--rc-text); }
.sdp-caret .el-icon { transition: transform .15s; }
.sdp-caret.open .el-icon { transform: rotate(90deg); }
.sdp-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.sdp-name.btn { border: 0; background: none; padding: 0; color: inherit; font-size: 13px; text-align: left; }
.sdp-path { flex: none; margin-left: 6px; max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--rc-faint); font-size: 11px; }
.sdp-count { flex: none; color: var(--rc-faint); font-size: 11px; font-variant-numeric: tabular-nums; }
.sdp-empty { padding: 10px 6px; color: var(--rc-faint); font-size: 12px; }
.sdp-empty.err { color: var(--rc-error); }
.sdp-link { border: 0; background: none; padding: 0; color: #7c3aed; font-size: 12px; cursor: pointer; }
.sdp-foot { flex: none; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--rc-border-soft); color: var(--rc-faint); font-size: 12px; }
.sdp-rail { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 36px; padding: 10px 0; border: 1px solid var(--rc-border); border-radius: 12px; background: #fff; cursor: pointer; color: var(--rc-text-2); }
.sdp-rail:hover { border-color: #ddd6fe; color: #7c3aed; }
.sdp-rail-arrow { color: var(--rc-faint); }
.sdp-rail-txt { writing-mode: vertical-rl; letter-spacing: 2px; font-size: 13px; font-weight: 600; }
.sdp-rail-dot { min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; background: #7c3aed; color: #fff; font-size: 11px; display: grid; place-items: center; }

.fc-files { min-width: 0; min-height: 0; }
@media (max-width: 900px) {
  .fc-shell { grid-template-columns: 1fr; grid-template-rows: 240px minmax(0, 1fr); }
  .fc-shell.folded { grid-template-columns: 1fr; grid-template-rows: 40px minmax(0, 1fr); }
}
</style>