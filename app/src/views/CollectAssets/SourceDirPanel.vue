<script setup lang="ts">
// 源管理「系统目录」页签左侧的目录面板（2026-10-21，原型：设计稿/原型设计/源管理_系统目录与业务目录_原型_2026-10-21.html）。
//
// 10-21 定的口径：
// - 「系统目录 / 业务目录」二选一，各自保留选择；不能同时筛；
// - 和旧平台 CategoryTree 一致：点名称 = 只看这一个目录（含子级）；勾选父目录 = 子孙全勾，部分勾选时父级半选；
// - 目录的新增 / 改名 / 删除 / 移动在系统设置里，这里不给入口；
// - 面板可折叠，折叠后窄条上显示已选目录数，筛选不变。
// 目录数据与后端口径见 api/sourceDirs.ts。
import { computed, reactive, ref, watch } from 'vue'
import { ArrowRight } from '@element-plus/icons-vue'
import { dirNode, dirPath, expandDirIds, loadDirChildren, searchDirs, type DirKind, type DirNode } from '@/api/sourceDirs'

export interface DirScope {
  kind: DirKind
  /** 业务目录全选仍限定在目录树内；空目录树也不能退回全部源。 */
  all?: boolean
  /** 筛选用的目录 ID（已含子级）；空且未全选 = 不按目录筛 */
  dirIds: string[]
  /** 汇总行展示：选中的最上层目录（父级全勾时不再列子级） */
  labels: { id: string; path: string; hasKids: boolean }[]
}

const props = defineProps<{ collapsed: boolean }>()
const emit = defineEmits<{ 'update:collapsed': [boolean]; change: [DirScope] }>()

const kind = ref<DirKind>('biz')
const kids = reactive(new Map<string, DirNode[]>())
const leaf = reactive(new Set<string>())
const open = reactive(new Set<string>())
const loading = reactive(new Set<string>())
const loadError = ref('')
const checked = reactive({ sys: new Set<string>(), biz: new Set<string>() })
const focus = reactive<{ sys: string | null; biz: string | null }>({ sys: null, biz: null })
const allChecked = reactive({ sys: false, biz: true })
const selectingAll = ref(false)

const rootKey = (k: DirKind) => `${k}:root`
async function ensureKids(k: DirKind, parentId = ''): Promise<DirNode[]> {
  const key = parentId || rootKey(k)
  const cached = kids.get(key)
  if (cached) return cached
  loading.add(key)
  try {
    const list = await loadDirChildren(k, parentId)
    kids.set(key, list)
    if (parentId && !list.length) leaf.add(parentId)
    loadError.value = ''
    return list
  } catch (error) {
    loadError.value = `目录加载失败：${(error as Error)?.message ?? String(error)}`
    return []
  } finally {
    loading.delete(key)
  }
}

// ---- 树行 ----
interface Row { node: DirNode; depth: number }
const rows = computed<Row[]>(() => {
  const out: Row[] = []
  const walk = (list: DirNode[], depth: number) => {
    for (const node of list) {
      out.push({ node, depth })
      if (open.has(node.id)) walk(kids.get(node.id) ?? [], depth + 1)
    }
  }
  walk(kids.get(rootKey(kind.value)) ?? [], 0)
  return out
})
async function toggle(node: DirNode) {
  if (open.has(node.id)) { open.delete(node.id); return }
  open.add(node.id)
  await ensureKids(kind.value, node.id)
}

// ---- 勾选（父子联动） ----
const curChecked = computed(() => checked[kind.value])
function hasCheckedDescendant(id: string): boolean {
  return (kids.get(id) ?? []).some((c) => curChecked.value.has(c.id) || hasCheckedDescendant(c.id))
}
const isPartial = (id: string) => !curChecked.value.has(id) && hasCheckedDescendant(id)
async function onCheck(node: DirNode, on: boolean) {
  const k = kind.value
  const set = checked[k]
  focus[k] = null
  const ids = await expandDirIds(k, [node.id])
  ids.forEach((id) => (on ? set.add(id) : set.delete(id)))
  // 往上修父级：勾上时子级全勾才勾父级；取消时祖先一律取消
  for (let p = node.parentId; p; p = dirNode(p)?.parentId ?? '') {
    const siblings = kids.get(p) ?? []
    if (on && siblings.length && siblings.every((c) => set.has(c.id))) set.add(p)
    else set.delete(p)
  }
  const roots = kids.get(rootKey(k)) ?? []
  allChecked[k] = roots.length > 0 && roots.every((root) => set.has(root.id))
  void emitScope()
}
function onFocus(node: DirNode) {
  if (selectingAll.value) return
  const k = kind.value
  allChecked[k] = false
  checked[k].clear()
  focus[k] = focus[k] === node.id ? null : node.id
  if (focus[k] && !leaf.has(node.id)) void toggleOpen(node)
  void emitScope()
}
async function toggleOpen(node: DirNode) {
  if (!open.has(node.id)) { open.add(node.id); await ensureKids(kind.value, node.id) }
}

// ---- 对外：当前范围 ----
const topChecked = computed(() => [...curChecked.value].filter((id) => {
  const parent = dirNode(id)?.parentId
  return !(parent && curChecked.value.has(parent))
}))
const pickedCount = computed(() => topChecked.value.length || (focus[kind.value] ? 1 : 0))
let scopeSeq = 0
async function emitScope() {
  const seq = ++scopeSeq
  const k = kind.value
  const set = checked[k]
  let dirIds: string[] = []
  let labelIds: string[] = []
  if (set.size) {
    dirIds = [...set]
    labelIds = topChecked.value
  } else if (focus[k]) {
    labelIds = [focus[k]!]
    dirIds = await expandDirIds(k, labelIds)
  }
  if (seq !== scopeSeq) return
  emit('change', {
    kind: k,
    all: allChecked[k],
    dirIds,
    labels: labelIds.map((id) => ({ id, path: dirPath(id).join(' / ') || id, hasKids: !leaf.has(id) && (kids.get(id)?.length ?? 1) > 0 })),
  })
}
function clear() {
  allChecked[kind.value] = false
  checked[kind.value].clear()
  focus[kind.value] = null
  void emitScope()
}
async function selectAll() {
  const k = kind.value
  selectingAll.value = true
  try {
    const roots = await ensureKids(k)
    const ids = await expandDirIds(k, roots.map((node) => node.id))
    checked[k].clear()
    ids.forEach((id) => checked[k].add(id))
    focus[k] = null
    allChecked[k] = true
    await emitScope()
  } finally {
    selectingAll.value = false
  }
}
defineExpose({ clear })

async function switchKind(k: DirKind) {
  if (kind.value === k) return
  kind.value = k
  keyword.value = ''
  await ensureKids(k)
  void emitScope()
}

// ---- 搜索（跨层级，结果平铺带路径） ----
const keyword = ref('')
const hits = ref<DirNode[] | null>(null)
const searching = ref(false)
let kwTimer: ReturnType<typeof setTimeout> | undefined
let searchSeq = 0
watch([keyword, kind], ([kw]) => {
  clearTimeout(kwTimer)
  if (!kw.trim()) { hits.value = null; return }
  kwTimer = setTimeout(async () => {
    const seq = ++searchSeq
    searching.value = true
    try {
      const list = await searchDirs(kind.value, kw.trim())
      if (seq === searchSeq) hits.value = list
    } catch {
      if (seq === searchSeq) hits.value = []
    } finally {
      if (seq === searchSeq) searching.value = false
    }
  }, 300)
})
function parentPathOf(node: DirNode): string {
  return node.parentId ? dirPath(node.parentId).join(' / ') : ''
}
void selectAll()
</script>

<template>
  <section v-if="!props.collapsed" class="sdp" :class="{ biz: kind === 'biz' }" data-testid="source-dir-panel">
    <div class="sdp-head">
      <div class="sdp-kind" role="tablist" aria-label="目录类型">
        <button type="button" role="tab" :disabled="selectingAll" :aria-selected="kind === 'sys'" :class="{ on: kind === 'sys' }" data-testid="dir-kind-sys" @click="switchKind('sys')">系统目录</button>
        <button type="button" role="tab" :disabled="selectingAll" :aria-selected="kind === 'biz'" :class="{ on: kind === 'biz' }" data-testid="dir-kind-biz" @click="switchKind('biz')">业务目录</button>
      </div>
      <button class="sdp-fold" type="button" title="收起目录" aria-label="收起目录" data-testid="dir-panel-fold" @click="emit('update:collapsed', true)">«</button>
    </div>
    <input v-model="keyword" class="sdp-search" placeholder="搜索目录" aria-label="搜索目录" data-testid="dir-search">
    <div class="sdp-sub">
      <label class="sdp-all"><input type="checkbox" :checked="allChecked[kind]" :indeterminate.prop="!allChecked[kind] && pickedCount > 0" :disabled="selectingAll" data-testid="dir-select-all" @change="($event.target as HTMLInputElement).checked ? selectAll() : clear()">全选</label>
      <span v-if="selectingAll">加载中…</span>
      <span v-else-if="pickedCount">已选 {{ topChecked.length || 1 }} 个目录</span>
      <button v-if="pickedCount" class="sdp-link" type="button" data-testid="dir-clear" @click="clear">清空</button>
    </div>
    <div class="sdp-tree" data-testid="dir-tree">
      <template v-if="hits">
        <div v-if="searching" class="sdp-empty">搜索中…</div>
        <div v-else-if="!hits.length" class="sdp-empty">没有匹配的目录</div>
        <div
          v-for="node in hits"
          v-else
          :key="node.id"
          class="sdp-row"
          :class="{ on: !curChecked.size && focus[kind] === node.id }"
          :data-dir="node.id"
          data-testid="dir-node"
        >
          <span class="sdp-caret" />
          <input type="checkbox" :disabled="selectingAll" :checked="curChecked.has(node.id)" :aria-label="`勾选 ${node.name}`" @change="onCheck(node, ($event.target as HTMLInputElement).checked)">
          <span class="sdp-name" :title="node.name" @click="onFocus(node)">{{ node.name }}<span v-if="parentPathOf(node)" class="sdp-path">{{ parentPathOf(node) }}</span></span>
        </div>
      </template>
      <template v-else>
        <div
          v-for="row in rows"
          :key="row.node.id"
          class="sdp-row"
          :class="{ on: !curChecked.size && focus[kind] === row.node.id }"
          :style="{ paddingLeft: `${4 + row.depth * 16}px` }"
          :data-dir="row.node.id"
          data-testid="dir-node"
        >
          <button
            v-if="!leaf.has(row.node.id)"
            class="sdp-caret btn"
            :class="{ open: open.has(row.node.id) }"
            type="button"
            :aria-label="open.has(row.node.id) ? '收起' : '展开'"
            @click="toggle(row.node)"
          ><el-icon><ArrowRight /></el-icon></button>
          <span v-else class="sdp-caret" />
          <input
            type="checkbox"
            :disabled="selectingAll"
            :checked="curChecked.has(row.node.id)"
            :indeterminate.prop="isPartial(row.node.id)"
            :aria-label="`勾选 ${row.node.name}`"
            data-testid="dir-check"
            @change="onCheck(row.node, ($event.target as HTMLInputElement).checked)"
          >
          <span class="sdp-name" :title="dirPath(row.node.id).join(' / ')" data-testid="dir-name" @click="onFocus(row.node)">{{ row.node.name }}</span>
          <span v-if="row.node.count != null" class="sdp-count">{{ row.node.count }}</span>
        </div>
        <div v-if="loading.has(rootKey(kind))" class="sdp-empty">加载中…</div>
        <div v-else-if="loadError" class="sdp-empty err">{{ loadError }}</div>
        <div v-else-if="!rows.length" class="sdp-empty">{{ kind === 'biz' ? '还没有业务目录' : '还没有系统目录' }}</div>
      </template>
    </div>
    <div class="sdp-foot">目录的新增、改名、删除在「系统设置 → 分类目录」</div>
  </section>
  <button
    v-else
    class="sdp-rail"
    :class="{ biz: kind === 'biz' }"
    type="button"
    title="展开目录"
    aria-label="展开目录"
    data-testid="dir-panel-rail"
    @click="emit('update:collapsed', false)"
  >
    <span class="sdp-rail-arrow">»</span>
    <span class="sdp-rail-txt">{{ kind === 'biz' ? '业务目录' : '系统目录' }}</span>
    <span v-if="allChecked[kind] || pickedCount" class="sdp-rail-dot">{{ allChecked[kind] ? '全' : pickedCount }}</span>
  </button>
</template>

<style scoped>
.sdp { display: flex; flex-direction: column; min-height: 0; padding: 12px; background: #fff; border: 1px solid var(--rc-border); border-radius: 12px; }
.sdp-head { flex: none; display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
.sdp-kind { flex: 1; display: grid; grid-template-columns: 1fr 1fr; padding: 3px; background: #eef2f7; border-radius: 8px; }
.sdp-kind button { border: 0; background: transparent; padding: 5px 0; border-radius: 6px; font-size: 13px; font-weight: 600; color: #64748b; cursor: pointer; white-space: nowrap; }
.sdp-kind button.on { background: #fff; color: var(--rc-text); box-shadow: 0 1px 3px rgba(0, 0, 0, .1); }
.sdp.biz .sdp-kind button.on { color: #7c3aed; }
.sdp-fold { flex: none; width: 26px; height: 26px; border: 0; border-radius: 6px; background: none; color: var(--rc-faint); cursor: pointer; font-size: 14px; }
.sdp-fold:hover { background: #f1f5f9; color: var(--rc-text); }
.sdp-search { flex: none; box-sizing: border-box; width: 100%; height: 30px; min-height: 30px; padding: 0 10px; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; font-size: 13px; line-height: 28px; outline: none; }
.sdp-search:focus { border-color: var(--rc-primary); }
.sdp-sub { flex: none; display: flex; align-items: center; justify-content: space-between; min-height: 20px; margin: 8px 2px 4px; color: var(--rc-faint); font-size: 12px; }
.sdp-all { display: inline-flex; align-items: center; gap: 4px; color: var(--rc-text-2); cursor: pointer; }
.sdp-all input { margin: 0; accent-color: var(--rc-primary); }
.sdp.biz .sdp-all input { accent-color: #7c3aed; }
.sdp-link { border: 0; background: none; padding: 0; color: var(--rc-primary); font-size: 12px; cursor: pointer; }
.sdp-tree { flex: 1; min-height: 0; overflow: auto; }
.sdp-row { flex: none; display: flex; align-items: center; gap: 4px; height: 30px; padding: 0 4px; border-radius: 6px; color: var(--rc-text); font-size: 13px; }
.sdp-row:hover { background: #f1f5f9; }
.sdp-row.on { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.sdp.biz .sdp-row.on { background: #f5f3ff; color: #7c3aed; }
.sdp-row input { flex: none; margin: 0 2px 0 0; accent-color: var(--rc-primary); cursor: pointer; }
.sdp.biz .sdp-row input { accent-color: #7c3aed; }
.sdp-caret { flex: none; width: 16px; height: 16px; display: inline-grid; place-items: center; color: var(--rc-faint); font-size: 12px; }
.sdp-caret.btn { border: 0; background: none; padding: 0; cursor: pointer; border-radius: 4px; }
.sdp-caret.btn:hover { color: var(--rc-text); }
.sdp-caret .el-icon { transition: transform .15s; }
.sdp-caret.open .el-icon { transform: rotate(90deg); }
.sdp-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.sdp-path { margin-left: 6px; color: var(--rc-faint); font-size: 11px; }
.sdp-count { flex: none; color: var(--rc-faint); font-size: 11px; font-variant-numeric: tabular-nums; }
.sdp-empty { padding: 10px 6px; color: var(--rc-faint); font-size: 12px; }
.sdp-empty.err { color: var(--rc-error); }
.sdp-foot { flex: none; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--rc-border-soft); color: var(--rc-faint); font-size: 12px; }
.sdp-rail { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 36px; padding: 10px 0; border: 1px solid var(--rc-border); border-radius: 12px; background: #fff; cursor: pointer; color: var(--rc-text-2); }
.sdp-rail:hover { border-color: #bfdbfe; color: var(--rc-primary); }
.sdp-rail-arrow { color: var(--rc-faint); }
.sdp-rail-txt { writing-mode: vertical-rl; letter-spacing: 2px; font-size: 13px; font-weight: 600; }
.sdp-rail-dot { min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; background: var(--rc-primary); color: #fff; font-size: 11px; display: grid; place-items: center; }
.sdp-rail.biz .sdp-rail-dot { background: #7c3aed; }
</style>
