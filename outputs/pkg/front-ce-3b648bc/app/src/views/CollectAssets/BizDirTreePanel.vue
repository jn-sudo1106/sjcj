<script setup lang="ts">
// 「我的分组」来源组栏里的业务目录树（1030 会议议题 5，2026-10-31）。单独一栏太占宽度，
// 嵌在来源组栏内，由父级控制显隐（点「按业务目录筛选」打开、点「完成」收起）。
// 外观与「系统目录」的目录面板（SourceDirPanel.vue，业务目录紫色主题）一致；交互：
// - 只有业务目录，不切系统目录；
// - 可勾选多个目录（10-31 用户），点目录名同勾选框；每个目录都含子目录（来源组按成员推导，算的就是目录及其子目录）；
// - 勾了父目录，子孙算在内：显示为已勾、不能单独取消；父目录勾上时去掉已单独勾的子孙，避免重复统计；
// - 不全选（全部目录 = 不筛）。
// 目录数据走 api/sourceDirs.ts 的 loadDirChildren / searchDirs，与 SourceDirPanel 共用缓存。
import { computed, reactive, ref, watch } from 'vue'
import { ArrowRight } from '@element-plus/icons-vue'
import { dirNode, dirPath, loadDirChildren, loadDirPath, searchDirs, type DirNode } from '@/api/sourceDirs'

export interface PickedBizDir { id: string; path: string }

const props = defineProps<{ selected: string[] }>()
const emit = defineEmits<{ close: []; select: [dirs: PickedBizDir[]] }>()

const ROOT = 'biz:root'
const kids = reactive(new Map<string, DirNode[]>())
const leaf = reactive(new Set<string>())
const open = reactive(new Set<string>())
const loading = reactive(new Set<string>())
const loadError = ref('')

async function ensureKids(parentId = ''): Promise<DirNode[]> {
  const key = parentId || ROOT
  const cached = kids.get(key)
  if (cached) return cached
  loading.add(key)
  try {
    const list = await loadDirChildren('biz', parentId)
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

interface Row { node: DirNode; depth: number }
const rows = computed<Row[]>(() => {
  const out: Row[] = []
  const walk = (list: DirNode[], depth: number) => {
    for (const node of list) {
      out.push({ node, depth })
      if (open.has(node.id)) walk(kids.get(node.id) ?? [], depth + 1)
    }
  }
  walk(kids.get(ROOT) ?? [], 0)
  return out
})
async function toggle(node: DirNode) {
  if (open.has(node.id)) { open.delete(node.id); return }
  open.add(node.id)
  await ensureKids(node.id)
}

// ---- 勾选（父目录含子孙，同 SourceDirPanel 的父子口径） ----
const parentOf = (id: string) => { const p = dirNode(id)?.parentId; return p === '-2' || p === '-1' ? '' : p || '' }
function isBelow(id: string, ancestor: string): boolean {
  const seen = new Set<string>()
  for (let p = parentOf(id); p && !seen.has(p); p = parentOf(p)) { if (p === ancestor) return true; seen.add(p) }
  return false
}
/** 被已勾的上级目录覆盖（含子级）：显示为已勾，不能单独操作 */
const coveredBy = (id: string) => props.selected.find((s) => s !== id && isBelow(id, s)) ?? ''
const isChecked = (id: string) => props.selected.includes(id) || !!coveredBy(id)
const pathOf = (id: string, name = id) => dirPath(id).join(' / ') || name
async function check(node: DirNode, on: boolean) {
  if (coveredBy(node.id)) return
  // 搜索结果可能是还没展开过的深层目录：先补齐祖先链，父子判断才准
  if (on && node.parentId && !dirNode(node.parentId)) await loadDirPath(node.id).catch(() => [])
  const next = on
    ? [...props.selected.filter((id) => !isBelow(id, node.id)), node.id]
    : props.selected.filter((id) => id !== node.id)
  emit('select', next.map((id) => ({ id, path: pathOf(id, id === node.id ? node.name : id) })))
}

// ---- 搜索（跨层级，结果平铺带路径） ----
const keyword = ref('')
const hits = ref<DirNode[] | null>(null)
const searching = ref(false)
let kwTimer: ReturnType<typeof setTimeout> | undefined
let searchSeq = 0
watch(keyword, (kw) => {
  clearTimeout(kwTimer)
  if (!kw.trim()) { hits.value = null; return }
  kwTimer = setTimeout(async () => {
    const seq = ++searchSeq
    searching.value = true
    try {
      const list = await searchDirs('biz', kw.trim())
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

void ensureKids()
</script>

<template>
  <section class="bdt" data-testid="biz-dir-tree">
    <div class="bdt-head">
      <strong>选择业务目录</strong>
      <button class="bdt-fold" type="button" title="收起目录，回到来源组列表" data-testid="biz-dir-fold" @click="emit('close')">完成</button>
    </div>
    <input v-model="keyword" class="bdt-search" placeholder="搜索目录" aria-label="搜索业务目录" data-testid="biz-dir-search">
    <div class="bdt-sub">
      <span>{{ selected.length ? `已选 ${selected.length} 个目录（含子级）` : '可勾选多个目录' }}</span>
      <button v-if="selected.length" class="bdt-link" type="button" data-testid="biz-dir-clear" @click="emit('select', [])">清空</button>
    </div>
    <div class="bdt-tree">
      <template v-if="hits">
        <div v-if="searching" class="bdt-empty">搜索中…</div>
        <div v-else-if="!hits.length" class="bdt-empty">没有匹配的目录</div>
        <label
          v-for="node in hits"
          v-else
          :key="node.id"
          class="bdt-row"
          :class="{ on: isChecked(node.id), covered: !!coveredBy(node.id) }"
          :title="coveredBy(node.id) ? `已含在「${pathOf(coveredBy(node.id))}」里` : undefined"
          data-testid="biz-dir-node"
        >
          <span class="bdt-caret" />
          <input type="checkbox" :checked="isChecked(node.id)" :disabled="!!coveredBy(node.id)" :aria-label="`勾选 ${node.name}`" @change="check(node, ($event.target as HTMLInputElement).checked)">
          <span class="bdt-name">{{ node.name }}<span v-if="parentPathOf(node)" class="bdt-path">{{ parentPathOf(node) }}</span></span>
        </label>
      </template>
      <template v-else>
        <div
          v-for="row in rows"
          :key="row.node.id"
          class="bdt-row"
          :class="{ on: isChecked(row.node.id), covered: !!coveredBy(row.node.id) }"
          :style="{ paddingLeft: `${4 + row.depth * 16}px` }"
          :data-dir="row.node.id"
          data-testid="biz-dir-node"
        >
          <button
            v-if="!leaf.has(row.node.id)"
            class="bdt-caret btn"
            :class="{ open: open.has(row.node.id) }"
            type="button"
            :aria-label="open.has(row.node.id) ? '收起' : '展开'"
            @click="toggle(row.node)"
          ><el-icon><ArrowRight /></el-icon></button>
          <span v-else class="bdt-caret" />
          <label class="bdt-label" :title="coveredBy(row.node.id) ? `已含在「${pathOf(coveredBy(row.node.id))}」里` : pathOf(row.node.id, row.node.name)">
            <input
              type="checkbox"
              :checked="isChecked(row.node.id)"
              :disabled="!!coveredBy(row.node.id)"
              :aria-label="`勾选 ${row.node.name}`"
              data-testid="biz-dir-check"
              @change="check(row.node, ($event.target as HTMLInputElement).checked)"
            >
            <span class="bdt-name" data-testid="biz-dir-name">{{ row.node.name }}</span>
          </label>
        </div>
        <div v-if="loading.has(ROOT)" class="bdt-empty">加载中…</div>
        <div v-else-if="loadError" class="bdt-empty err">{{ loadError }}</div>
        <div v-else-if="!rows.length" class="bdt-empty">还没有业务目录</div>
      </template>
    </div>
    <div class="bdt-foot">组内有源在任一所选目录（含子级）里就显示；目录维护在「系统设置 → 分类目录」</div>
  </section>
</template>

<style scoped>
/* 与 SourceDirPanel 业务目录主题同一套尺寸与颜色；外框由所在的来源组栏提供 */
.bdt { display: flex; flex-direction: column; min-height: 0; }
.bdt-head { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 8px; font-size: 12px; color: #7c3aed; }
.bdt-fold { flex: none; height: 24px; padding: 0 10px; border: 1px solid #ddd6fe; border-radius: 6px; background: #f5f3ff; color: #7c3aed; cursor: pointer; font-size: 12px; font-weight: 600; }
.bdt-fold:hover { border-color: #c4b5fd; background: #ede9fe; }
.bdt-search { flex: none; box-sizing: border-box; width: 100%; height: 30px; min-height: 30px; padding: 0 10px; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; font-size: 13px; line-height: 28px; outline: none; }
.bdt-search:focus { border-color: #7c3aed; }
.bdt-sub { flex: none; display: flex; align-items: center; justify-content: space-between; min-height: 20px; margin: 8px 2px 4px; color: var(--rc-faint); font-size: 12px; }
.bdt-link { border: 0; background: none; padding: 0; color: #7c3aed; font-size: 12px; cursor: pointer; }
.bdt-tree { flex: 1; min-height: 0; overflow: auto; }
.bdt-row { flex: none; display: flex; align-items: center; gap: 4px; height: 30px; padding: 0 4px; border-radius: 6px; color: var(--rc-text); font-size: 13px; }
.bdt-row:hover { background: #f1f5f9; }
.bdt-row.on { background: #f5f3ff; color: #7c3aed; }
.bdt-caret { flex: none; width: 16px; height: 16px; display: inline-grid; place-items: center; color: var(--rc-faint); font-size: 12px; }
.bdt-caret.btn { border: 0; background: none; padding: 0; cursor: pointer; border-radius: 4px; }
.bdt-caret.btn:hover { color: var(--rc-text); }
.bdt-caret .el-icon { transition: transform .15s; }
.bdt-caret.open .el-icon { transform: rotate(90deg); }
.bdt-label { flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; cursor: pointer; }
.bdt-row input { flex: none; margin: 0 2px 0 0; accent-color: #7c3aed; cursor: pointer; }
.bdt-row.covered input { cursor: not-allowed; }
.bdt-row.covered { color: var(--rc-text-2); }
.bdt-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.bdt-path { margin-left: 6px; color: var(--rc-faint); font-size: 11px; }
.bdt-empty { padding: 10px 6px; color: var(--rc-faint); font-size: 12px; }
.bdt-empty.err { color: var(--rc-error); }
.bdt-foot { flex: none; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--rc-border-soft); color: var(--rc-faint); font-size: 12px; line-height: 1.5; }
</style>
