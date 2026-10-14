<script setup lang="ts">
// 分类目录树（0711 R1）：替换新建采集闸门里硬编码的分类下拉，改为可搜索 + 展开 + 勾选（单选）的目录树。
// 数据来自 sourceApi.sourceCategories()（采集资产页左侧目录同源接口），树形结构由后端直接给出（SourceCategory.children）。
import { computed, onMounted, ref, watch } from 'vue'
import { sourceApi, type SourceCategory } from '@/api'

export interface CategorySelection {
  dirId?: string
  category: string
  categoryPath: string
}

const props = defineProps<{ modelValue: CategorySelection }>()
const emit = defineEmits<{ 'update:modelValue': [v: CategorySelection] }>()

const categories = ref<SourceCategory[]>([])
const keyword = ref('')
const expanded = ref<Set<string>>(new Set())
const loadedIds = ref<Set<string>>(new Set())
const loadingIds = ref<Set<string>>(new Set())

function collectKnownLoaded(nodes: SourceCategory[], hasNestedNodes: boolean) {
  nodes.forEach((n) => {
    if (hasNestedNodes || n.children?.length) loadedIds.value.add(n.id)
    if (n.children?.length) {
      expanded.value.add(n.id)
      collectKnownLoaded(n.children, hasNestedNodes)
    }
  })
}

onMounted(async () => {
  categories.value = await sourceApi.sourceCategories()
  const hasNestedNodes = categories.value.some((node) => !!node.children?.length)
  collectKnownLoaded(categories.value, hasNestedNodes)
  if (!props.modelValue.categoryPath && categories.value.length) {
    select(categories.value[0]) // 保留"有默认分类"的旧体验：首次进入自动选中第一个顶级分类
  }
})

// 搜索只能在已加载的节点里过滤，而子级默认要展开才懒加载——没展开过的分类（如「媒体」）搜不到。
// 所以第一次输入关键词时把所有未加载的子级一次拉全（按层并发），加载期间显示「正在加载」而不是「无匹配」。
// 某个节点拉失败就不记为已加载，下次输入关键词会重试。
const loadingAll = ref(false)
let loadAllPromise: Promise<void> | null = null
const LOAD_ALL_CONCURRENCY = 6
function loadAllDescendants(): Promise<void> {
  if (loadAllPromise) return loadAllPromise
  loadAllPromise = (async () => {
    loadingAll.value = true
    let failed = false
    try {
      const queue = [...categories.value]
      while (queue.length) {
        await Promise.all(queue.splice(0, LOAD_ALL_CONCURRENCY).map(async (n) => {
          if (!loadedIds.value.has(n.id)) {
            try {
              const children = await sourceApi.sourceCategories(n.id)
              if (children.length) n.children = children
              loadedIds.value.add(n.id)
            } catch {
              failed = true
            }
          }
          if (n.children?.length) queue.push(...n.children)
        }))
      }
    } finally {
      loadingAll.value = false
      if (failed) loadAllPromise = null
    }
  })()
  return loadAllPromise
}
watch(keyword, (kw) => {
  if (kw.trim()) void loadAllDescendants()
})

function matchesKeyword(node: SourceCategory, kw: string): boolean {
  if (node.name.toLowerCase().includes(kw)) return true
  return (node.children ?? []).some((c) => matchesKeyword(c, kw))
}
function filterNodes(nodes: SourceCategory[], kw: string): SourceCategory[] {
  return nodes
    .filter((n) => matchesKeyword(n, kw))
    .map((n) => ({ ...n, children: n.children ? filterNodes(n.children, kw) : n.children }))
}
const isFiltering = computed(() => !!keyword.value.trim())
const filteredTree = computed<SourceCategory[]>(() => {
  const kw = keyword.value.trim().toLowerCase()
  return kw ? filterNodes(categories.value, kw) : categories.value
})

interface FlatNode { node: SourceCategory; depth: number; hasChildren: boolean }
const flatNodes = computed<FlatNode[]>(() => {
  const result: FlatNode[] = []
  const walk = (nodes: SourceCategory[], depth: number) => {
    nodes.forEach((n) => {
      // categoryPaged 首屏不返回子级且没有统一的 hasChildren 字段，未加载节点先保留展开入口；
      // 点击后按 parentId 查询，确认无子级再收起入口。
      const hasChildren = !!n.children?.length || !loadedIds.value.has(n.id)
      result.push({ node: n, depth, hasChildren })
      if (hasChildren && (isFiltering.value || expanded.value.has(n.id))) walk(n.children ?? [], depth + 1)
    })
  }
  walk(filteredTree.value, 0)
  return result
})

async function toggle(node: SourceCategory) {
  if (loadingIds.value.has(node.id)) return
  if (!loadedIds.value.has(node.id)) {
    loadingIds.value.add(node.id)
    try {
      const children = await sourceApi.sourceCategories(node.id)
      if (children.length) {
        node.children = children
        expanded.value.add(node.id)
      }
      loadedIds.value.add(node.id)
    } finally {
      loadingIds.value.delete(node.id)
    }
    return
  }
  if (expanded.value.has(node.id)) expanded.value.delete(node.id)
  else expanded.value.add(node.id)
}
function select(node: SourceCategory) {
  emit('update:modelValue', { ...props.modelValue, dirId: node.id, category: node.name, categoryPath: node.id })
}
</script>

<template>
  <div class="ctp">
    <input v-model="keyword" class="rc-input ctp-search" placeholder="搜索分类" />
    <div class="rc-tree ctp-tree">
      <div
        v-for="item in flatNodes"
        :key="item.node.id"
        class="rc-tree-row ctp-row"
        :class="{ active: item.node.id === modelValue.categoryPath }"
        :style="{ paddingLeft: `${8 + item.depth * 18}px` }"
        role="radio"
        :aria-checked="item.node.id === modelValue.categoryPath"
        tabindex="0"
        @click="select(item.node)"
        @keydown.enter.prevent="select(item.node)"
        @keydown.space.prevent="select(item.node)"
      >
        <span
          class="ctp-toggle"
          :class="{ invisible: !item.hasChildren }"
          @click.stop="toggle(item.node)"
        >{{ loadingIds.has(item.node.id) ? '…' : (isFiltering || expanded.has(item.node.id) ? '▾' : '▸') }}</span>
        <label class="ctp-check" @click.stop="select(item.node)">
          <input
            type="radio"
            name="new-collect-category"
            :checked="item.node.id === modelValue.categoryPath"
          />
          <span class="ctp-radio" aria-hidden="true" />
          <span class="ctp-name">{{ item.node.name }}</span>
          <span v-if="item.node.count != null" class="ctp-count">{{ item.node.count }}</span>
        </label>
      </div>
      <div v-if="!flatNodes.length" class="ctp-empty">{{ loadingAll ? '正在加载全部分类…' : '无匹配分类' }}</div>
    </div>
    <div class="ctp-selected">
      <span class="ctp-selected-label">已选分类</span>
      <span class="ctp-selected-value">{{ modelValue.category || '未选择' }}</span>
    </div>
  </div>
</template>

<style scoped>
.ctp { display: flex; flex-direction: column; gap: 9px; }
.ctp-search { height: 34px; padding: 0 11px; box-sizing: border-box; border: 1px solid var(--rc-border); border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; outline: none; transition: border-color .15s, box-shadow .15s; }
.ctp-search::placeholder { color: var(--rc-faint); }
.ctp-search:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.ctp-tree { max-height: 236px; overflow: auto; padding: 6px; border: 1px solid var(--rc-border); border-radius: 9px; background: #f8fafc; box-shadow: inset 0 1px 2px rgba(15, 23, 42, .02); scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent; }
.ctp-row { display: flex; align-items: center; gap: 5px; min-height: 34px; box-sizing: border-box; padding: 2px 8px 2px 4px; cursor: pointer; border: 1px solid transparent; border-radius: 7px; outline: none; color: var(--rc-text-2); transition: background .12s, border-color .12s, color .12s, box-shadow .12s; }
.ctp-row:hover, .ctp-row:focus-visible { background: #fff; border-color: #dbeafe; color: var(--rc-primary-ink); }
.ctp-row.active { background: var(--rc-primary-bg); border-color: #bfdbfe; color: var(--rc-primary-ink); box-shadow: inset 3px 0 0 var(--rc-primary); }
.ctp-toggle { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 20px; height: 24px; border-radius: 5px; color: var(--rc-muted); font-size: 11px; cursor: pointer; user-select: none; }
.ctp-toggle:hover { background: #eaf2ff; color: var(--rc-primary-ink); }
.ctp-toggle.invisible { visibility: hidden; cursor: default; }
.ctp-check { position: relative; display: flex; align-items: center; gap: 7px; min-width: 0; flex: 1; cursor: pointer; }
.ctp-check input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.ctp-radio { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 15px; height: 15px; box-sizing: border-box; border: 1.5px solid #94a3b8; border-radius: 50%; background: #fff; }
.ctp-check input:checked + .ctp-radio { border-color: var(--rc-primary); box-shadow: 0 0 0 3px #dbeafe; }
.ctp-check input:checked + .ctp-radio::after { width: 7px; height: 7px; border-radius: 50%; background: var(--rc-primary); content: ''; }
.ctp-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: inherit; font-size: 12px; line-height: 20px; }
.ctp-count { flex: none; min-width: 18px; padding: 1px 6px; box-sizing: border-box; border-radius: 9px; background: #eef2ff; color: var(--rc-muted); font-size: 11px; line-height: 16px; text-align: center; font-variant-numeric: tabular-nums; }
.ctp-row.active .ctp-name { font-weight: 700; }
.ctp-row.active .ctp-count { background: #dbeafe; color: var(--rc-primary-ink); }
.ctp-empty { padding: 22px 10px; text-align: center; color: var(--rc-faint); font-size: 12px; }
.ctp-selected { display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 0 10px; box-sizing: border-box; border: 1px solid var(--rc-border-soft); border-radius: 7px; background: #f8fafc; color: var(--rc-muted); font-size: 11px; }
.ctp-selected-label { flex: none; color: var(--rc-muted); }
.ctp-selected-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--rc-primary-ink); font-weight: 700; }
</style>
