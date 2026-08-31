<script setup lang="ts">
import { ref } from 'vue'
import { SOURCE_MARK_COLORS, normalizeIssueTag } from '@/utils/sourceMark'

defineProps<{
  selectedCount: number
  recentTags: string[]
}>()

const emit = defineEmits<{
  save: [payload: { tags: string[]; color: string }]
  clearTags: []
  clearColor: []
}>()

const tagSearch = ref('')
const draftTags = ref<string[]>([])
const draftColor = ref('')

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
  emit('save', { tags, color: draftColor.value })
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
      <span class="smp-label">最近使用</span>
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
      <span class="smp-label">颜色（可选）</span>
      <div class="smp-swatches">
        <button
          v-for="color in SOURCE_MARK_COLORS"
          :key="color.key"
          type="button"
          :class="{ selected: draftColor === color.key }"
          :aria-label="color.label"
          :title="color.label"
          :data-testid="`mark-color-${color.key}`"
          @click="draftColor = color.key"
        ><i :style="{ background: color.value }" /></button>
        <button type="button" class="smp-no-color" :class="{ selected: !draftColor }" data-testid="mark-color-none" @click="draftColor = ''">无颜色</button>
      </div>
    </div>
    <button class="smp-save" type="button" data-testid="mark-save" @click="save">保存（{{ selectedCount }}）</button>
    <div class="smp-footer">
      <button type="button" data-testid="mark-action-clear-tags" @click="emit('clearTags')">移除标签</button>
      <button type="button" data-testid="mark-action-clear-color" @click="emit('clearColor')">清除颜色标识</button>
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
.smp-swatches { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.smp-swatches button { display: grid; place-items: center; width: 23px; height: 23px; padding: 0; border: 1px solid #e3e8ef; border-radius: 50%; background: #fff; cursor: pointer; }
.smp-swatches button.selected { border-color: var(--rc-primary); box-shadow: 0 0 0 2px #dbeafe; }
.smp-swatches i { display: block; width: 13px; height: 13px; border-radius: 50%; }
.smp-no-color { width: auto !important; padding: 0 7px !important; border-radius: 5px !important; color: var(--rc-muted); font-size: 9px; }
.smp-save { width: calc(100% - 22px); height: 31px; margin: 0 11px 8px; border: 0; border-radius: 5px; background: var(--rc-primary); color: #fff; cursor: pointer; font-size: 12px; font-weight: 700; }
.smp-footer { display: flex; justify-content: space-between; gap: 8px; padding: 0 11px 10px; }
.smp-footer button { height: 22px; padding: 0; border: 0; background: transparent; color: var(--rc-muted); cursor: pointer; font-size: 11px; }
.smp-footer button:hover { color: var(--rc-primary); }
</style>
