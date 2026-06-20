<script setup lang="ts">
import { computed, ref } from 'vue'
import { LIB_GROUPS, type LibItem } from './flowModel'

const props = defineProps<{ collapsed: boolean }>()
const emit = defineEmits<{ 'update:collapsed': [value: boolean] }>()

const activeTemplate = ref('web')
const search = ref('')
const pillText: Record<string, string> = { p1: 'P1', p2: 'P2', plan: '规划中' }

const filteredGroups = computed(() => {
  const kw = search.value.trim().toLowerCase()
  if (!kw) return LIB_GROUPS
  return LIB_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((it) => `${it.name}${it.desc}${it.code}`.toLowerCase().includes(kw)),
  })).filter((g) => g.items.length)
})

function onDragStart(ev: DragEvent, item: LibItem) {
  if (!ev.dataTransfer) return
  ev.dataTransfer.setData('text/plain', item.template)
  ev.dataTransfer.effectAllowed = 'copy'
}
</script>

<template>
  <aside class="rc-node-library" :class="{ collapsed }">
    <div class="rc-panel-head">
      <div v-show="!collapsed" class="rc-panel-title">节点库</div>
      <button
        class="rc-node-toggle"
        type="button"
        :aria-label="collapsed ? '展开节点库' : '收起节点库'"
        @click="emit('update:collapsed', !props.collapsed)"
      >
        {{ collapsed ? '+' : '−' }}
      </button>
    </div>

    <div v-show="!collapsed" class="rc-left-body">
      <div class="rc-lib-search">
        <input v-model="search" type="text" placeholder="搜索节点（名称 / 编码 / 说明）" />
        <button v-if="search" class="rc-lib-clear" type="button" aria-label="清空" @click="search = ''">×</button>
      </div>

      <div v-for="g in filteredGroups" :key="g.title" class="rc-group">
        <div class="rc-group-title">{{ g.title }}</div>
        <button
          v-for="it in g.items"
          :key="it.template"
          class="rc-node-template"
          :class="{ active: activeTemplate === it.template, planned: it.planned }"
          draggable="true"
          type="button"
          @dragstart="onDragStart($event, it)"
          @click="activeTemplate = it.template"
        >
          <span class="rc-code">{{ it.code }}</span>
          <span class="rc-template-main">
            <span class="rc-template-name">{{ it.name }}</span>
            <span class="rc-template-desc">{{ it.desc }}</span>
          </span>
          <span class="rc-pill" :class="it.pill">{{ pillText[it.pill] }}</span>
        </button>
      </div>

      <div v-if="!filteredGroups.length" class="rc-lib-empty">无匹配节点</div>
    </div>
  </aside>
</template>

<style scoped>
.rc-node-library { background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); overflow: hidden; height: 100%; }
.rc-node-library.collapsed { padding: 7px 5px; }
.rc-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 42px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); }
.rc-node-library.collapsed .rc-panel-head { justify-content: center; padding: 0; min-height: auto; border-bottom: 0; }
.rc-panel-title { font-weight: 700; color: var(--rc-text); font-size: 13px; }
.rc-node-toggle { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: 0; background: transparent; color: var(--rc-muted); border-radius: 6px; font-size: 13px; line-height: 1; cursor: pointer; }
.rc-node-toggle:hover { background: #f8fafc; color: var(--rc-text); }
.rc-left-body { padding: 10px; overflow: auto; max-height: calc(100% - 42px); }
.rc-lib-search { position: relative; margin-bottom: 10px; }
.rc-lib-search input { width: 100%; height: 32px; padding: 0 26px 0 10px; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; outline: none; }
.rc-lib-search input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-lib-clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); width: 18px; height: 18px; border: 0; background: transparent; color: var(--rc-faint); font-size: 15px; line-height: 1; cursor: pointer; }
.rc-lib-clear:hover { color: var(--rc-text-2); }
.rc-lib-empty { padding: 24px 8px; text-align: center; color: var(--rc-faint); font-size: 12px; }
.rc-group { margin-top: 12px; }
.rc-group:first-child { margin-top: 0; }
.rc-group-title { display: flex; align-items: center; gap: 6px; margin: 0 0 6px; color: var(--rc-muted); font-size: 11px; font-weight: 700; }
.rc-group-title::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--rc-faint); }
.rc-node-template { position: relative; display: flex; align-items: center; gap: 8px; width: 100%; min-height: 38px; margin-bottom: 5px; padding: 7px 8px; border: 1px solid #eef2f7; background: #fff; border-radius: 7px; cursor: grab; text-align: left; }
.rc-node-template:hover { border-color: #bfdbfe; background: #fbfdff; }
.rc-node-template.active { border-color: var(--rc-primary); background: var(--rc-primary-bg); }
.rc-node-template:active { cursor: grabbing; }
.rc-node-template.planned { opacity: 0.62; }
.rc-code { min-width: 38px; height: 22px; border-radius: 5px; display: flex; align-items: center; justify-content: center; background: #f1f5f9; color: var(--rc-text-2); font-size: 10px; font-weight: 700; }
.rc-node-template.active .rc-code { background: #fff; color: var(--rc-primary-ink); }
.rc-template-main { min-width: 0; flex: 1; }
.rc-template-name { display: block; color: var(--rc-text); font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rc-template-desc { display: block; color: var(--rc-faint); font-size: 10px; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rc-pill { flex: none; font-size: 9px; line-height: 1; padding: 3px 5px; border-radius: 5px; border: 1px solid var(--rc-border); color: var(--rc-muted); background: #f8fafc; }
.rc-pill.p1 { color: var(--rc-ok); border-color: #bbf7d0; background: var(--rc-ok-bg); }
.rc-pill.p2 { color: var(--rc-warn); border-color: #fed7aa; background: var(--rc-warn-bg); }
.rc-pill.plan { color: var(--rc-faint); border-color: var(--rc-border); background: #f8fafc; }
</style>
