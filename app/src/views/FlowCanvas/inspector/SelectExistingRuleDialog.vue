<script setup lang="ts">
// 选择已有规则（0805 恢复 D3 砍掉的能力，会议原话"新建是新建、选是选"——不再混进节点名称输入框，
// 单独一个按钮 + 弹窗，跟「＋ 新建表」是同一种交互习惯）。
// 只列当前登录账号自己的规则（ruleApi.orchestrationOwnRules 已按 userCode 过滤），
// 弹窗内的关键词框只是对这份已过滤列表做本地筛选，不再发新请求。
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ruleApi, type RuleOrchestrationItem } from '@/api'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [boolean]; select: [RuleOrchestrationItem] }>()

const loading = ref(false)
const rules = ref<RuleOrchestrationItem[]>([])
const keyword = ref('')

async function load() {
  loading.value = true
  try {
    rules.value = await ruleApi.orchestrationOwnRules()
  } catch (e) {
    ElMessage.error(`加载已有规则失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    loading.value = false
  }
}
watch(() => props.open, (v) => { if (v) { keyword.value = ''; void load() } })

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return rules.value
  return rules.value.filter((r) => r.name.toLowerCase().includes(kw) || r.describe.toLowerCase().includes(kw))
})

function close() {
  emit('update:open', false)
}
function onPick(rule: RuleOrchestrationItem) {
  emit('select', rule)
  close()
}
</script>

<template>
  <el-dialog :model-value="open" title="选择已有规则" width="560px" :close-on-click-modal="false" @update:model-value="close">
    <input v-model="keyword" class="serd-search" placeholder="按规则名称 / 描述筛选" />
    <div v-loading="loading" class="serd-list">
      <div v-if="!loading && !filtered.length" class="serd-empty">暂无可选规则</div>
      <button v-for="r in filtered" :key="r.ruleId" class="serd-row" type="button" @click="onPick(r)">
        <div class="serd-row-name">{{ r.name }}</div>
        <div v-if="r.describe" class="serd-row-desc">{{ r.describe }}</div>
      </button>
    </div>
    <template #footer>
      <button class="rc-btn" type="button" @click="close">取消</button>
    </template>
  </el-dialog>
</template>

<style scoped>
.serd-search { width: 100%; height: 32px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 6px; font-size: 13px; outline: none; box-sizing: border-box; margin-bottom: 10px; }
.serd-search:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.serd-list { max-height: 360px; overflow-y: auto; border: 1px solid var(--rc-border-soft); border-radius: 8px; min-height: 60px; }
.serd-empty { padding: 20px; text-align: center; color: var(--rc-faint); font-size: 12px; }
.serd-row { display: block; width: 100%; text-align: left; padding: 9px 12px; border: 0; border-top: 1px solid var(--rc-border-soft); background: #fff; cursor: pointer; }
.serd-row:first-child { border-top: 0; }
.serd-row:hover { background: var(--rc-primary-bg); }
.serd-row-name { color: var(--rc-text); font-size: 13px; font-weight: 600; }
.serd-row-desc { color: var(--rc-faint); font-size: 11px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-btn { display: inline-flex; align-items: center; justify-content: center; height: 32px; padding: 0 14px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text-2); font-size: 13px; cursor: pointer; }
.rc-btn:hover { border-color: #bfdbfe; }
</style>
