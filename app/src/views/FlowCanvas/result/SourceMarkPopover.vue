<script setup lang="ts">
// 0831 F01：颜色标识整块下线（会上原话「颜色重复了、根本记不得哪个是哪个」），
// 这里只撤 UI——色板、清除颜色出口、save 里的 color 字段。
// 适配层 `sourceApi.setColor` / `colorFromLegacy` 保留，旧平台还在用 usedFlag。
import { ref } from 'vue'
import { normalizeIssueTag } from '@/utils/sourceMark'

defineProps<{
  selectedCount: number
  /** 标签候选。服务端 source/sourceTags 有值时用它，否则退回本机「最近使用」。
   *  只是输入辅助，不限制可输入范围——程序打的标签不一定在候选里。 */
  recentTags: string[]
}>()

const emit = defineEmits<{
  save: [payload: { tags: string[] }]
  clearTags: []
}>()

const tagSearch = ref('')
const draftTags = ref<string[]>([])

function chooseTag(tag: string) {
  draftTags.value = draftTags.value.includes(tag)
    ? draftTags.value.filter((item) => item !== tag)
    : [...draftTags.value, tag]
}

function addSearchTag() {
  const tag = normalizeIssueTag(tagSearch.value)
  if (!tag) return
  if (!draftTags.value.includes(tag)) draftTags.value = [...draftTags.value, tag]
  tagSearch.value = ''
}

function save() {
  const typed = normalizeIssueTag(tagSearch.value)
  const tags = typed && !draftTags.value.includes(typed) ? [...draftTags.value, typed] : [...draftTags.value]
  emit('save', { tags })
}
</script>

<template>
  <div class="smp" data-testid="source-mark-popover" @mousedown.stop>
    <div class="smp-body">
      <label class="smp-create">
        <input
          v-model="tagSearch"
          data-testid="mark-tag-search"
          placeholder="搜索或创建标签"
          @keydown.enter.prevent="addSearchTag"
        />
        <button type="button" aria-label="添加标签" data-testid="mark-tag-add" @click="addSearchTag">+</button>
      </label>
      <span class="smp-label">常用标签</span>
      <div class="smp-tags">
        <button
          v-for="tag in recentTags"
          :key="tag"
          type="button"
          :class="{ selected: draftTags.includes(tag) }"
          :data-testid="`mark-tag-${tag}`"
          @click="chooseTag(tag)"
        >{{ tag }}</button>
      </div>
    </div>
    <button class="smp-save" type="button" data-testid="mark-save" @click="save">保存（{{ selectedCount }}）</button>
    <div class="smp-footer">
      <!-- 「清空标签」而不是「移除标签」（0831 F02）：它把整批的标签全清掉，不是挑一个删。
           要挑着删得走行内的「标签与备注」弹窗。 -->
      <button type="button" data-testid="mark-action-clear-tags" @click="emit('clearTags')">清空标签</button>
    </div>
  </div>
</template>

<style scoped>
.smp { position: absolute; z-index: 20; top: 36px; left: 0; width: 276px; border: 1px solid #dce5f1; border-radius: 7px; background: #fff; box-shadow: 0 10px 26px rgba(15, 23, 42, .15); }
.smp-body { display: grid; gap: 9px; padding: 11px; }
.smp-create { display: flex; align-items: center; height: 31px; padding: 0 7px; border: 1px solid #dce5f1; border-radius: 5px; color: var(--rc-faint); }
.smp-create input { min-width: 0; flex: 1; border: 0; outline: 0; color: var(--rc-text-2); font-size: 11px; background: transparent; }
.smp-create button { width: 18px; height: 18px; padding: 0; border: 0; background: transparent; color: var(--rc-muted); cursor: pointer; font-size: 16px; line-height: 1; }
.smp-label { color: var(--rc-muted); font-size: 11px; font-weight: 700; }
.smp-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.smp-tags button { height: 25px; padding: 0 7px; border: 1px solid #dce5f1; border-radius: 4px; background: #f8fafc; color: var(--rc-muted); cursor: pointer; font-size: 10px; }
.smp-tags button.selected { border-color: #a9c2ff; background: #edf4ff; color: var(--rc-primary); }
.smp-save { width: calc(100% - 22px); height: 31px; margin: 0 11px 8px; border: 0; border-radius: 5px; background: var(--rc-primary); color: #fff; cursor: pointer; font-size: 12px; font-weight: 700; }
.smp-footer { display: flex; justify-content: flex-start; gap: 8px; padding: 0 11px 10px; }
.smp-footer button { height: 22px; padding: 0; border: 0; background: transparent; color: var(--rc-muted); cursor: pointer; font-size: 11px; }
.smp-footer button:hover { color: var(--rc-primary); }
</style>
