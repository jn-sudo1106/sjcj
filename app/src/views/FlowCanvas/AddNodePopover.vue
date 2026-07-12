<script setup lang="ts">
// 添加节点浮层（0707 优化·Phase1）：参照 Dify——点「＋」原地锚定弹层，搜索 + 分组列表，点选即插入，无确认步骤。
// 替代原居中模态弹窗；右键菜单「插入节点/决策/分头」三个入口合一为本浮层（含「逻辑」分组）。
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { LIB_GROUPS, type LibItem } from './flowModel'

const props = defineProps<{ x: number; y: number; hideLogicGroup?: boolean }>()
const emit = defineEmits<{ pick: [template: string]; close: [] }>()

const keyword = ref('')
const searchEl = ref<HTMLInputElement | null>(null)
const popEl = ref<HTMLElement | null>(null)

const filteredGroups = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  // 0707 优化·Phase6：分支内添加场景隐藏「逻辑」分组（防嵌套分支：chain 内不允许再开 FlowBranchGroup）
  const groups = props.hideLogicGroup ? LIB_GROUPS.filter((g) => g.title !== '逻辑') : LIB_GROUPS
  if (!kw) return groups
  return groups
    .map((g) => ({ ...g, items: g.items.filter((it) => it.name.toLowerCase().includes(kw) || it.desc.toLowerCase().includes(kw)) }))
    .filter((g) => g.items.length)
})
const flatItems = computed(() => filteredGroups.value.flatMap((g) => g.items))
const activeIndex = ref(0)
watch(flatItems, () => { activeIndex.value = 0 })

function pick(it: LibItem) {
  emit('pick', it.template)
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = Math.min(activeIndex.value + 1, flatItems.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const it = flatItems.value[activeIndex.value]
    if (it) pick(it)
  } else if (e.key === 'Escape') {
    emit('close')
  }
}

// 锚定定位：以触发点为基准，超出视口则回夹在可视区域内
const style = ref({ left: '0px', top: '0px' })
async function place() {
  await nextTick()
  const el = popEl.value
  if (!el) return
  const w = el.offsetWidth
  const h = el.offsetHeight
  const left = Math.min(Math.max(8, props.x), window.innerWidth - w - 8)
  const top = Math.min(Math.max(8, props.y), window.innerHeight - h - 8)
  style.value = { left: `${left}px`, top: `${top}px` }
}
watch(() => [props.x, props.y], place)

onMounted(() => {
  place()
  searchEl.value?.focus()
})
</script>

<template>
  <div ref="popEl" class="anp-pop" :style="style" @keydown="onKeydown" @click.stop>
    <input
      ref="searchEl"
      v-model="keyword"
      class="anp-search"
      type="text"
      placeholder="搜索节点、类型、描述"
    />
    <div class="anp-list">
      <template v-for="g in filteredGroups" :key="g.title">
        <div class="anp-group-title">{{ g.title }}</div>
        <button
          v-for="it in g.items"
          :key="it.template"
          type="button"
          class="anp-item"
          :class="{ active: flatItems[activeIndex] === it }"
          @click="pick(it)"
          @mouseenter="activeIndex = flatItems.indexOf(it)"
        >
          <span class="anp-item-icon">{{ it.badge ?? it.code }}</span>
          <span class="anp-item-text">
            <b>{{ it.name }}</b>
            <span>{{ it.desc }}</span>
          </span>
        </button>
      </template>
      <div v-if="!flatItems.length" class="anp-empty">没有匹配的节点</div>
    </div>
  </div>
</template>

<style scoped>
.anp-pop {
  position: fixed;
  z-index: 90;
  width: 280px;
  max-height: min(60vh, 460px);
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid var(--rc-border);
  border-radius: 10px;
  box-shadow: 0 20px 48px -18px rgba(15, 23, 42, 0.4);
  overflow: hidden;
}
.anp-search {
  flex: none;
  height: 34px;
  margin: 8px;
  padding: 0 10px;
  border: 1px solid var(--rc-border);
  border-radius: 7px;
  font-size: 12px;
  outline: none;
  background: #f8fafc;
  color: var(--rc-text);
}
.anp-search:focus { border-color: #60a5fa; background: #fff; box-shadow: 0 0 0 3px #dbeafe; }
.anp-list { flex: 1; overflow-y: auto; padding: 0 6px 8px; }
.anp-group-title { padding: 6px 8px 4px; font-size: 10px; font-weight: 700; color: var(--rc-faint); }
.anp-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 9px;
  border: 0;
  background: transparent;
  border-radius: 7px;
  padding: 6px 8px;
  cursor: pointer;
  text-align: left;
}
.anp-item.active, .anp-item:hover { background: var(--rc-primary-bg); }
.anp-item-icon {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: var(--rc-primary-bg);
  color: var(--rc-primary-ink);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 800;
}
.anp-item.active .anp-item-icon, .anp-item:hover .anp-item-icon { background: #fff; }
.anp-item-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.35; }
.anp-item-text b { font-size: 12px; font-weight: 700; color: var(--rc-text); }
.anp-item-text span { font-size: 10px; color: var(--rc-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.anp-empty { padding: 24px 8px; text-align: center; font-size: 12px; color: var(--rc-faint); }
</style>
