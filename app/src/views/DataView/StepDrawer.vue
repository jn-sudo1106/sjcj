<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { sourceApi, type Step } from '../../api'

const props = defineProps<{
  modelValue: boolean
  sourceId?: string
  currentTableName?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; 'select-table': [string] }>()

const loading = ref(false)
const steps = ref<Step[]>([])

watch(() => props.modelValue, async (v) => {
  if (!v) return
  if (!props.sourceId) {
    ElMessage.error('查询栏中未指定源ID,无法展示步骤')
    emit('update:modelValue', false)
    return
  }
  loading.value = true
  try {
    steps.value = await sourceApi.sourceSteps(props.sourceId)
  } catch (error) {
    ElMessage.error(`步骤加载失败:${error instanceof Error ? error.message : String(error)}`)
  } finally {
    loading.value = false
  }
})

function onSelect(step: Step) {
  if (!step.outputTable) return
  ElMessage.info(`正在切换表..To-${step.outputTable}`)
  emit('select-table', step.outputTable)
}
</script>

<template>
  <el-drawer :model-value="modelValue" title="步骤列表" size="400px" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <div class="sp-legend">
      <span class="rc-mini-card">源:{{ sourceId }}</span>
    </div>
    <div v-loading="loading" class="sp-list">
      <div
        v-for="(step, i) in steps"
        :key="step.stepId"
        class="sp-card"
        :class="{ current: step.outputTable && step.outputTable === currentTableName, disabled: !step.enabled }"
        @click="onSelect(step)"
      >
        <p class="sp-title">{{ i + 1 }}. {{ step.name }}</p>
        <p class="sp-sub">输出表 {{ step.outputTable || '—' }}</p>
      </div>
      <div v-if="!loading && !steps.length" class="sp-empty">没有查询到步骤数据</div>
    </div>
  </el-drawer>
</template>

<style scoped>
.sp-legend {
  margin-bottom: 12px;
}
.sp-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sp-card {
  border: 0.5px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 10px;
  cursor: pointer;
}
.sp-card.current {
  background: var(--bg-accent);
}
.sp-card.disabled {
  opacity: 0.5;
}
.sp-title {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
}
.sp-sub {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
}
.sp-empty {
  color: var(--text-muted);
  font-size: 13px;
}
</style>
