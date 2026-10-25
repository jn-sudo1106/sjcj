<script setup lang="ts">
// 添加节点浮层（0707 优化·Phase1）：参照 Dify——点「＋」原地锚定弹层，搜索 + 分组列表，点选即插入，无确认步骤。
// 替代原居中模态弹窗；右键菜单的插入入口合一为本浮层。（「逻辑」分组的决策 / 分头已于 1008-BR-06 去掉）
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { LIB_GROUPS, type LibGroup, type LibItem } from './flowModel'
import { useDictStore } from '@/stores/dict'

const props = defineProps<{ x: number; y: number; compact?: boolean }>()
const emit = defineEmits<{ pick: [template: string]; close: []; dragstart: [event: DragEvent, template: string] }>()

const dict = useDictStore()
/**
 * 面板条目顺序（2026-10-25 用户反馈）：此前按 LIB_GROUPS 手排顺序，文件下载被排在资讯抓取
 * 后面；字典（config/sourceTypes）与静态 SNATCH_TYPES 都是编号升序（90 网页抓取 → 95 文件下载
 * → 110…）。这里统一按**编号数字**排序：90 < 95 立刻生效，字典加载前后顺序稳定（后端 SEQ 可能
 * 把后补的 95 排在最后，按字典顺序排会出现"刷新一下条目跳位"）。
 */
const orderByCode = computed(() => {
  const order = new Map<string, number>()
  for (const item of LIB_GROUPS.flatMap((g) => g.items)) {
    const m = /^(\d+)/.exec(item.code)
    if (m && !order.has(item.code)) order.set(item.code, Number(m[1]))
  }
  return order
})
const groups = computed<LibGroup[]>(() => {
  const sourceByCode = new Map<string, { code: string; name: string }>()
  for (const display of dict.snatchTypes) {
    const m = /^\[(\d+)\]\s*-\s*(.+)$/.exec(display)
    if (m) sourceByCode.set(m[1], { code: m[1], name: m[2].trim() })
  }
  const orderOf = (code: string): number => orderByCode.value.get(code) ?? Number.MAX_SAFE_INTEGER
  return LIB_GROUPS.map((group) => ({
    ...group,
    items: group.items
      .map((item) => {
        // 字典的稳定身份是编号；BROWSER/WECHAT/LOGIN 等独立前端入口保留原名。
        const source = sourceByCode.get(item.code)
        if (source) return { ...item, code: source.code, name: source.name, badge: item.badge ?? source.code }
        return item
      })
      // 字典没收录的（浏览器/公众号/登录/指标等）保持原相对顺序、排在组尾。
      .sort((a, b) => orderOf(a.code) - orderOf(b.code)),
  }))
})

const keyword = ref('')
const searchEl = ref<HTMLInputElement | null>(null)
const popEl = ref<HTMLElement | null>(null)

const filteredGroups = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return groups.value
  return groups.value
    .map((g) => ({ ...g, items: g.items.filter((it) => it.name.toLowerCase().includes(kw) || it.desc.toLowerCase().includes(kw)) }))
    .filter((g) => g.items.length)
})
const flatItems = computed(() => filteredGroups.value.flatMap((g) => g.items))
const activeIndex = ref(0)
watch(flatItems, () => { activeIndex.value = 0 })

function pick(it: LibItem) {
  // ⚠️ emit 载荷必须是模板字符串（it.template）：FlowBoard 的 onPickNode / pickNodeFromPalette 按
  // 字符串接收并传给 flow.insertAfter。曾改为发出整个条目对象，导致 TEMPLATE_TO_NODE[对象] 查不到、
  // 所有新增节点一律回落 web-list 种子（标题变成「公告列表抓取」、类型回到 90 网页抓取）。
  emit('pick', it.template)
}
function onDragStart(event: DragEvent, it: LibItem) {
  // 同上：拖拽载荷也是模板字符串，画布 onDrop 从 text/plain 读它再 insertAfter。
  emit('dragstart', event, it.template)
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
const style = ref<Record<string, string>>({ left: '0px', top: '0px' })
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
  <div ref="popEl" class="anp-pop" :class="{ compact: props.compact }" :style="style" @keydown="onKeydown" @click.stop>
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
          draggable="true"
          @click="pick(it)"
          @dragstart="onDragStart($event, it)"
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
.anp-pop.compact { width: 184px; max-height: min(58vh, 420px); }
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
.anp-item:active { cursor: grabbing; }
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
.compact .anp-item { gap: 7px; padding: 5px 7px; }
.compact .anp-item-icon { width: 24px; height: 24px; }
.compact .anp-item-text b { font-size: 11px; }
.anp-empty { padding: 24px 8px; text-align: center; font-size: 12px; color: var(--rc-faint); }
</style>
