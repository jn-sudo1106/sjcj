<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { sourceGroupApi, type SourceGroup } from '@/api'

const selected = defineModel<string>({ default: '' })
const groups = ref<SourceGroup[]>([])
const keyword = ref('')
const loading = ref(false)
const error = ref('')
const matches = computed(() => {
  const query = keyword.value.trim().toLocaleLowerCase()
  return groups.value.filter(group => group.sourceGroupName.toLocaleLowerCase().includes(query))
})

async function load() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    groups.value = await sourceGroupApi.list()
  } catch (cause) {
    error.value = `来源组加载失败：${cause instanceof Error ? cause.message : String(cause)}`
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<template>
  <div class="sgf" :aria-busy="loading" data-testid="source-group-filter">
    <input v-model="keyword" class="sgf-search" placeholder="搜索来源组" aria-label="搜索来源组">
    <div class="sgf-tools">
      <span>共 {{ matches.length }} 个来源组</span>
      <button class="sgf-refresh" type="button" aria-label="刷新来源组" title="刷新来源组" :disabled="loading" @click="load"><Refresh /></button>
    </div>
    <button class="sgf-row" :class="{ on: !selected }" type="button" data-testid="source-group-all" @click="selected = ''">全部来源组</button>
    <div v-if="error" class="sgf-message error" role="alert">{{ error }}</div>
    <div v-else-if="loading && !groups.length" class="sgf-message">正在加载来源组…</div>
    <div v-else-if="!matches.length" class="sgf-message">{{ keyword.trim() ? '没有匹配的来源组' : '还没有来源组' }}</div>
    <div class="sgf-list">
      <button
        v-for="group in matches"
        :key="group.sourceGroupId"
        class="sgf-row"
        :class="{ on: selected === group.sourceGroupId }"
        type="button"
        :data-group-id="group.sourceGroupId"
        :aria-pressed="selected === group.sourceGroupId"
        :disabled="group.state !== 'ACTIVE'"
        :title="group.sourceGroupName"
        @click="selected = selected === group.sourceGroupId ? '' : group.sourceGroupId"
      ><span>{{ group.sourceGroupName }}</span><small v-if="group.state !== 'ACTIVE'">已停用</small></button>
    </div>
  </div>
</template>

<style scoped>
.sgf { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.sgf-search { flex: none; box-sizing: border-box; width: 100%; height: 30px; padding: 0 10px; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 13px; outline: none; }
.sgf-search:focus { border-color: var(--rc-primary); }
.sgf-tools { display: flex; align-items: center; justify-content: space-between; min-height: 28px; color: var(--rc-faint); font-size: 12px; }
.sgf-refresh { display: inline-grid; place-items: center; width: 24px; height: 24px; padding: 4px; border: 0; border-radius: 6px; background: none; color: var(--rc-faint); cursor: pointer; }
.sgf-refresh:hover { background: #f1f5f9; color: var(--rc-primary); }
.sgf-list { flex: 1; min-height: 0; overflow: auto; }
.sgf-row { display: flex; align-items: center; gap: 8px; width: 100%; height: 30px; flex: none; padding: 0 8px; border: 0; border-radius: 6px; background: none; color: var(--rc-text); font-size: 13px; text-align: left; cursor: pointer; }
.sgf-row > span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sgf-row:hover { background: #f1f5f9; }
.sgf-row.on { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.sgf-row:disabled { color: var(--rc-faint); cursor: default; }
.sgf-row small { flex: none; font-size: 11px; }
.sgf-message { padding: 10px 6px; color: var(--rc-faint); font-size: 12px; overflow-wrap: anywhere; }
.sgf-message.error { color: var(--rc-error); }
.sgf-refresh:disabled { opacity: .4; cursor: default; }
</style>
