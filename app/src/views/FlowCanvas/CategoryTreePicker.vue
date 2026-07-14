<script setup lang="ts">
// 分类目录树（0711 R1）：替换新建采集闸门里硬编码的分类下拉，改为可搜索 + 展开 + 勾选（单选）的目录树。
// 数据来自 sourceApi.sourceCategories()（采集资产页左侧目录同源接口），树形结构由后端直接给出（SourceCategory.children）。
import { computed, onMounted, ref } from 'vue'
import { sourceApi, type SourceCategory } from '../../api'

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

function collectExpandable(nodes: SourceCategory[]) {
  nodes.forEach((n) => {
    if (n.children?.length) {
      expanded.value.add(n.id)
      collectExpandable(n.children)
    }
  })
}

onMounted(async () => {
  categories.value = await sourceApi.sourceCategories()
  collectExpandable(categories.value) // 目录层级不深，默认全部展开，方便一眼看全
  if (!props.modelValue.categoryPath && categories.value.length) {
    select(categories.value[0]) // 保留"有默认分类"的旧体验：首次进入自动选中第一个顶级分类
  }
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
      const hasChildren = !!n.children?.length
      result.push({ node: n, depth, hasChildren })
      if (hasChildren && (isFiltering.value || expanded.value.has(n.id))) walk(n.children!, depth + 1)
    })
  }
  walk(filteredTree.value, 0)
  return result
})

function toggle(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
}
function select(node: SourceCategory) {
  emit('update:modelValue', { ...props.modelValue, category: node.name, categoryPath: node.id })
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
          @click.stop="toggle(item.node.id)"
        >{{ isFiltering || expanded.has(item.node.id) ? '▾' : '▸' }}</span>
        <label class="ctp-check" @click.stop="select(item.node)">
          <input
            type="radio"
            name="new-collect-category"
            :checked="item.node.id === modelValue.categoryPath"
          />
          <span class="ctp-name">{{ item.node.name }}</span>
          <span class="ctp-count">（{{ item.node.count }}）</span>
        </label>
      </div>
      <div v-if="!flatNodes.length" class="ctp-empty">无匹配分类</div>
    </div>
    <div class="ctp-selected">已选分类：{{ modelValue.categoryPath || '未选择' }}</div>
  </div>
</template>

<style scoped>
.ctp { display: flex; flex-direction: column; gap: 8px; }
.ctp-search { height: 30px; padding: 0 9px; box-sizing: border-box; border: 1px solid var(--rc-border); border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; outline: none; }
.ctp-search::placeholder { color: var(--rc-faint); }
.ctp-search:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.ctp-tree { max-height: 220px; overflow: auto; padding: 6px; border: 1px solid #dbe3ee; border-radius: 8px; }
.ctp-row { display: flex; align-items: center; gap: 4px; padding-right: 8px; cursor: pointer; border-radius: 6px; outline: none; }
.ctp-row:hover, .ctp-row:focus-visible { background: #f8fafc; }
.ctp-toggle { flex: none; width: 16px; text-align: center; color: var(--rc-muted); font-size: 11px; cursor: pointer; user-select: none; }
.ctp-toggle.invisible { visibility: hidden; cursor: default; }
.ctp-check { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; cursor: pointer; }
.ctp-name { color: var(--rc-text); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ctp-count { color: var(--rc-faint); font-size: 11px; flex: none; }
.ctp-empty { padding: 10px; text-align: center; color: var(--rc-faint); font-size: 12px; }
.ctp-selected { color: var(--rc-muted); font-size: 11px; }
</style>
