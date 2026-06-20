<script setup lang="ts">
import type { SourceCategory } from '../../api'

defineProps<{
  categories: SourceCategory[]
  modelValue: string
  allCount: number
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

function select(id: string) {
  emit('update:modelValue', id)
}
</script>

<template>
  <div class="rc-card ca-tree-card">
    <div class="rc-card-head">
      <div>
        <div class="rc-card-title">源分类</div>
        <div class="rc-card-sub">按业务大类 / 子类目检索</div>
      </div>
    </div>
    <div class="rc-tree ca-tree-scroll">
      <div class="rc-tree-row" :class="{ active: modelValue === '' }" @click="select('')">
        <span>全部源</span><span class="rc-count">{{ allCount }}</span>
      </div>
      <template v-for="g in categories" :key="g.id">
        <div class="rc-tree-row ca-grp" :class="{ active: modelValue === g.id }" @click="select(g.id)">
          <span>{{ g.name }}</span><span class="rc-count">{{ g.count }}</span>
        </div>
        <div
          v-for="c in g.children"
          :key="c.id"
          class="rc-tree-row indent"
          :class="{ active: modelValue === c.id }"
          @click="select(c.id)"
        >
          <span>{{ c.name }}</span><span class="rc-count">{{ c.count }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ca-tree-card {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 215px);
  min-height: 520px;
}
.ca-tree-scroll {
  flex: 1;
  overflow: auto;
}
.rc-tree-row {
  cursor: pointer;
}
.ca-grp {
  font-weight: 600;
  color: var(--rc-text);
}
</style>
