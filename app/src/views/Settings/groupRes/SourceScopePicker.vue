<script setup lang="ts">
// 源数据权限「选择器」弹窗：目录 → 源 两级，懒加载 + 点选（无复选框，对齐已评审原型）。
// 交互：点目录行=展开看子目录/源；「整目录」按钮=授权整个目录（含子级）；点源行=只授权该源。
// 只负责把选择结果 emit 成 Grant（dirIds 最小集 + sourceIds），落库交给 groupSourceScope 服务层。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { sourceApi, type SourceCategory } from '@/api'
import type { SourceGrant } from '@/api/groupSourceScope'

const props = defineProps<{ modelValue: boolean; kind: 'accept' | 'reject'; initial: SourceGrant }>()
const emit = defineEmits<{ 'update:modelValue': [v: boolean]; confirm: [g: SourceGrant] }>()

const SRC_PAGE = 20

interface SrcRow { id: string; name: string }
interface DirNode {
  id: string
  name: string
  count?: number
  kids?: DirNode[]
  src?: { rows: SrcRow[]; total: number; page: number; loading: boolean }
  loadedKids: boolean
  loadedSrc: boolean
}

const rootDirs = reactive<DirNode[]>([])
const parentOf = reactive<Record<string, string | null>>({})
const expanded = reactive(new Set<string>())
const selDirs = reactive(new Set<string>())
const selSrcs = reactive(new Set<string>())
const srcShown = reactive<Record<string, number>>({}) // dirId -> 已展示源数（加载更多）
const srcNames = reactive<Record<string, string>>({}) // sourceId -> 名称（回显的源批量解析出来才能显示）
const dirNames = reactive<Record<string, string>>({}) // categoryId -> 名称（回显的目录不在树里时解析）
const loading = ref(false)
const kw = ref('')

function toNode(c: SourceCategory, parentId: string | null): DirNode {
  parentOf[String(c.id)] = parentId
  return { id: String(c.id), name: c.name, count: c.count, loadedKids: false, loadedSrc: false }
}

async function loadRoots() {
  rootDirs.length = 0
  Object.keys(parentOf).forEach((k) => delete parentOf[k])
  // 只重置“树/展开/分页”状态；选中集(selDirs/selSrcs)由 watch 从 initial 回填，这里不能再清，
  // 否则打开弹窗会把该组已有的源/目录选择冲掉。
  expanded.clear()
  Object.keys(srcShown).forEach((k) => delete srcShown[k])
  loading.value = true
  try {
    const roots = await sourceApi.sourceCategories(undefined)
    roots.forEach((c) => rootDirs.push(toNode(c, null)))
    // 预取一层的子级，保证根上展开箭头/叶子判定正确
    for (const d of [...rootDirs]) await loadKids(d)
  } catch (e) {
    ElMessage.error(`加载目录失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    loading.value = false
  }
}

async function loadKids(d: DirNode) {
  if (d.loadedKids) return
  try {
    const kids = await sourceApi.sourceCategories(d.id)
    d.kids = kids.map((c) => toNode(c, d.id))
    d.loadedKids = true
  } catch {
    d.kids = []
    d.loadedKids = true
  }
}

async function loadSources(d: DirNode, page = 1) {
  if (d.src?.loading) return
  if (!d.src) d.src = { rows: [], total: 0, page: 0, loading: true }
  d.src.loading = true
  try {
    const res = await sourceApi.sourcePaged({ category: d.id, page, size: SRC_PAGE })
    const rows = res.list.map((s) => ({ id: String(s.sourceId), name: s.name }))
    d.src.rows = page === 1 ? rows : [...d.src.rows, ...rows]
    d.src.total = res.total
    d.src.page = page
    srcShown[d.id] = d.src.rows.length
  } catch {
    d.src.rows = page === 1 ? [] : d.src.rows
    d.src.total = d.src.total || 0
  } finally {
    d.src.loading = false
    d.loadedSrc = true
  }
}

async function toggleExpand(d: DirNode) {
  if (expanded.has(d.id)) { expanded.delete(d.id); return }
  expanded.add(d.id)
  await loadKids(d)
  await loadSources(d)
}

// 某目录是否被“整目录”选中（自身或任一祖先在 selDirs）
function coveredDir(dirId: string): boolean {
  let p: string | null | undefined = dirId
  while (p) { if (selDirs.has(p)) return true; p = parentOf[p] }
  return selDirs.has(dirId)
}

function descendantsOf(d: DirNode, acc: string[] = []): string[] {
  (d.kids ?? []).forEach((k) => { acc.push(k.id); descendantsOf(k, acc) })
  return acc
}

function toggleDir(d: DirNode) {
  if (selDirs.has(d.id)) { selDirs.delete(d.id); return }
  selDirs.add(d.id)
  dirNames[d.id] = d.name
  // 去掉被它包含的子目录选择与子树内单源选择（整目录已覆盖）
  const desc = new Set(descendantsOf(d))
  ;[...selDirs].forEach((id) => { if (desc.has(id)) selDirs.delete(id) })
  ;[...selSrcs].forEach((id) => { const l = leafDirOfSource(id); if (l && (l === d.id || desc.has(l))) selSrcs.delete(id) })
}

// 源 id → 其所在目录 id（用于 covered 判定与分组展示）
const srcDirMap = reactive<Record<string, string>>({})
function leafDirOfSource(srcId: string): string | undefined { return srcDirMap[srcId] }
function toggleSrc(d: DirNode, s: SrcRow) {
  if (coveredDir(d.id)) return
  srcDirMap[s.id] = d.id
  srcNames[s.id] = s.name
  if (selSrcs.has(s.id)) selSrcs.delete(s.id)
  else selSrcs.add(s.id)
}

function selectAllSources(d: DirNode) {
  if (coveredDir(d.id)) return
  d.src?.rows.forEach((s) => { srcDirMap[s.id] = d.id; srcNames[s.id] = s.name; selSrcs.add(s.id) })
}

// —— 扁平渲染行 ——
interface Row { key: string; type: 'dir' | 'srcHead' | 'src' | 'more'; depth: number; dir?: DirNode; src?: SrcRow }
const rows = computed<Row[]>(() => {
  const k = kw.value.trim().toLowerCase()
  const out: Row[] = []
  const dirMatch = (d: DirNode): boolean => !k || d.name.toLowerCase().includes(k) || (d.kids ?? []).some(dirMatch)
  function walk(list: DirNode[], depth: number) {
    list.forEach((d) => {
      if (k && !dirMatch(d)) return
      out.push({ key: `d${d.id}`, type: 'dir', depth, dir: d })
      const open = expanded.has(d.id) || !!k
      if (!open) return
      ;(d.kids ?? []).forEach(() => {})
      if (d.kids?.length) walk(d.kids, depth + 1)
      if (d.src) {
        out.push({ key: `h${d.id}`, type: 'srcHead', depth: depth + 1, dir: d })
        const shown = k ? d.src.rows : d.src.rows.slice(0, srcShown[d.id] ?? SRC_PAGE)
        shown
          .filter((s) => !k || s.name.toLowerCase().includes(k) || d.name.toLowerCase().includes(k))
          .forEach((s) => out.push({ key: `s${s.id}`, type: 'src', depth: depth + 2, dir: d, src: s }))
        if (!k && d.src.rows.length < d.src.total) out.push({ key: `m${d.id}`, type: 'more', depth: depth + 2, dir: d })
      }
    })
  }
  walk(rootDirs, 0)
  return out
})

const picked = computed(() => ({ dirs: [...selDirs], srcs: [...selSrcs] }))

// 回显带进来的源/目录不在已加载的树里，需要单独解析名称才能显示。
async function resolveSourceNames() {
  const missing = [...selSrcs].filter((id) => !srcNames[id])
  if (!missing.length) return
  const CHUNK = 200
  for (let i = 0; i < missing.length; i += CHUNK) {
    const batch = missing.slice(i, i + CHUNK)
    try {
      const res = await sourceApi.sourcePaged({ sourceIds: batch, page: 1, size: batch.length })
      res.list.forEach((s) => { srcNames[String(s.sourceId)] = s.name })
    } catch {
      // 解析不到就显示裸 ID，不阻断
    }
  }
}
async function resolveDirNames() {
  const missing = [...selDirs].filter((id) => !dirNames[id] && !findDirName(rootDirs, id))
  for (const id of missing) {
    try {
      const c = await sourceApi.categoryById(id)
      if (c) dirNames[id] = c.name
    } catch {
      // 忽略
    }
  }
}

// 打开时按 initial 回填 + 拉根目录 + 解析回显项名称
watch(() => props.modelValue, (v) => {
  if (!v) return
  selDirs.clear(); selSrcs.clear()
  props.initial.dirIds.forEach((id) => selDirs.add(id))
  props.initial.sourceIds.forEach((id) => selSrcs.add(id))
  kw.value = ''
  void loadRoots().then(() => resolveDirNames())
  void resolveSourceNames()
})

function confirm() {
  emit('confirm', { dirIds: [...selDirs], sourceIds: [...selSrcs] })
  emit('update:modelValue', false)
}
function close() { emit('update:modelValue', false) }

function findDirName(list: DirNode[], id: string): string | undefined {
  for (const d of list) {
    if (d.id === id) return d.name
    const hit = findDirName(d.kids ?? [], id)
    if (hit) return hit
  }
  return undefined
}
const dirName = (id: string): string => dirNames[id] || findDirName(rootDirs, id) || id
const SRC_PICK_CAP = 50
const pickedSrcList = computed(() => [...selSrcs].map((id) => ({ id, name: srcNames[id] || id })))
const pickedSrcShown = computed(() => pickedSrcList.value.slice(0, SRC_PICK_CAP))
const pickedSrcRest = computed(() => Math.max(0, pickedSrcList.value.length - SRC_PICK_CAP))
</script>

<template>
  <el-dialog :model-value="modelValue" :title="kind === 'accept' ? '选择可见范围' : '选择排除范围'" width="640px" append-to-body @update:model-value="close">
    <div class="ssp">
      <el-input v-model="kw" size="small" clearable placeholder="搜索目录名称…" class="ssp-search" />
      <div class="ssp-tree" v-loading="loading">
        <template v-for="r in rows" :key="r.key">
          <div
            v-if="r.type === 'dir'"
            class="ssp-row ssp-dir"
            :class="{ sel: r.dir && selDirs.has(r.dir.id) }"
            :style="{ paddingLeft: `${4 + r.depth * 16}px` }"
            @click="toggleExpand(r.dir!)"
          >
            <span class="ssp-caret">{{ expanded.has(r.dir!.id) || kw ? '▾' : '▸' }}</span>
            <span class="ssp-ico">📁</span>
            <span class="ssp-nm">{{ r.dir!.name }}</span>
            <span v-if="r.dir!.count != null" class="ssp-cnt">{{ r.dir!.count }}</span>
            <span v-if="selDirs.has(r.dir!.id)" class="ssp-state">整目录已选</span>
            <button class="ssp-btn" :class="{ on: selDirs.has(r.dir!.id) }" @click.stop="toggleDir(r.dir!)">
              {{ selDirs.has(r.dir!.id) ? '取消整目录' : '整目录' }}
            </button>
          </div>

          <div v-else-if="r.type === 'srcHead'" class="ssp-src-head" :style="{ paddingLeft: `${4 + r.depth * 16}px` }">
            📄 源（共 {{ r.dir!.src?.total ?? 0 }}）
            <span v-if="r.dir && coveredDir(r.dir.id)" class="ssp-cov">已随上级整目录授权</span>
            <button v-else class="ssp-btn" @click.stop="selectAllSources(r.dir!)">全选本目录源</button>
          </div>

          <div
            v-else-if="r.type === 'src'"
            class="ssp-row ssp-src"
            :class="{ sel: selSrcs.has(r.src!.id), cov: r.dir && coveredDir(r.dir.id) }"
            :style="{ paddingLeft: `${4 + r.depth * 16}px` }"
            @click="toggleSrc(r.dir!, r.src!)"
          >
            <span class="ssp-ico">📄</span>
            <span class="ssp-nm">{{ r.src!.name }}</span>
            <span v-if="r.dir && coveredDir(r.dir.id)" class="ssp-state cov">随上级</span>
            <span v-else-if="selSrcs.has(r.src!.id)" class="ssp-state ok">已选</span>
          </div>

          <div v-else class="ssp-more" :style="{ paddingLeft: `${4 + r.depth * 16}px` }" @click="loadSources(r.dir!, (r.dir!.src?.page ?? 0) + 1)">
            还有 {{ (r.dir!.src!.total ?? 0) - r.dir!.src!.rows.length }} 个源 · 加载更多…
          </div>
        </template>
        <div v-if="!rows.length && !loading" class="ssp-empty">无匹配目录</div>
      </div>

      <div class="ssp-picked">
        <span class="ssp-picked-lbl">已选（{{ picked.dirs.length + picked.srcs.length }}）：</span>
        <span v-if="!picked.dirs.length && !picked.srcs.length" class="ssp-empty-inline">暂未选择</span>
        <span v-for="id in picked.dirs" :key="`pd${id}`" class="ssp-tag">📁 {{ dirName(id) }}<span class="ssp-sub">整目录</span><i class="ssp-x" @click="selDirs.delete(id)">×</i></span>
        <span v-for="s in pickedSrcShown" :key="`ps${s.id}`" class="ssp-tag ssp-tag-src">📄 {{ s.name }}<i class="ssp-x" @click="selSrcs.delete(s.id)">×</i></span>
        <span v-if="pickedSrcRest > 0" class="ssp-more-inline">+{{ pickedSrcRest }} 更多（展开对应目录可逐个取消）</span>
      </div>
    </div>
    <template #footer>
      <el-button size="small" @click="close">取消</el-button>
      <el-button size="small" type="primary" @click="confirm">确认</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ssp { display: flex; flex-direction: column; gap: 10px; }
.ssp-search { width: 240px; }
.ssp-tree { border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; max-height: 360px; overflow: auto; padding: 6px; }
.ssp-row { display: flex; align-items: center; gap: 6px; min-height: 32px; padding: 2px 8px; border-radius: 7px; cursor: pointer; border: 1px solid transparent; }
.ssp-row:hover { background: #fff; border-color: #dbeafe; }
.ssp-dir.sel { background: #eff6ff; border-color: #bfdbfe; }
.ssp-src.sel { background: #ecfdf5; border-color: #a7f3d0; }
.ssp-src.cov { opacity: .6; }
.ssp-caret { width: 16px; text-align: center; color: #64748b; user-select: none; }
.ssp-ico { width: 14px; }
.ssp-nm { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ssp-cnt { font-size: 11px; color: #64748b; background: #eef2ff; border-radius: 9px; padding: 1px 6px; }
.ssp-state { margin-left: auto; font-size: 11px; }
.ssp-state.ok { color: #16a34a; font-weight: 600; }
.ssp-state.cov { color: #94a3b8; }
.ssp-btn { margin-left: auto; border: 1px solid #e2e8f0; background: #fff; color: #475569; border-radius: 5px; padding: 1px 8px; font-size: 11px; cursor: pointer; }
.ssp-btn:hover { border-color: #2563eb; color: #2563eb; }
.ssp-btn.on { background: #2563eb; border-color: #2563eb; color: #fff; }
.ssp-src-head { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #64748b; padding: 4px 8px; }
.ssp-cov { color: #94a3b8; }
.ssp-more { font-size: 11px; color: #2563eb; padding: 4px 8px; cursor: pointer; }
.ssp-empty { padding: 20px; text-align: center; color: #94a3b8; font-size: 12px; }
.ssp-picked { border: 1px solid #f1f5f9; border-radius: 8px; background: #f8fafc; padding: 8px 10px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-height: 40px; }
.ssp-picked-lbl { font-size: 12px; color: #64748b; }
.ssp-empty-inline { font-size: 12px; color: #94a3b8; }
.ssp-tag { display: inline-flex; align-items: center; gap: 5px; background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; border-radius: 6px; padding: 3px 7px; font-size: 12px; }
.ssp-tag-src { background: #ecfdf5; border-color: #a7f3d0; color: #15803d; }
.ssp-sub { color: #64748b; font-size: 11px; }
.ssp-more-inline { font-size: 11px; color: #94a3b8; align-self: center; }
.ssp-x { cursor: pointer; font-style: normal; font-weight: 700; opacity: .6; }
.ssp-x:hover { opacity: 1; }
</style>
