<script setup lang="ts">
import { computed } from 'vue'
import type { FileResourceRecord } from '@/api'

const props = defineProps<{
  modelValue: boolean
  file: FileResourceRecord | null
  sourceName?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const fieldLabels: Record<string, string> = {
  K1: '文件名', K2: '文件链接', K3: '文件路径', K4: '文件大小', K5: 'MD5',
  K6: '展示名', K7: '扩展名', K8: '文本文件', K9: '文本路径', K10: '文本大小',
}

function textOf(value: unknown): string {
  return value == null || value === '' ? '—' : String(value)
}

function formatSize(value: unknown): string {
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return textOf(value)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const fields = computed(() => Object.entries(props.file?.values ?? {}).map(([key, value]) => ({
  key,
  label: fieldLabels[key] || key,
  value: key === 'K4' || key === 'K10' ? formatSize(value) : textOf(value),
})))
</script>

<template>
  <!-- 只列字段，宽度回到 480px：预览已拆到独立的宽抽屉（FilePreviewDrawer，点行即开），
       两者篇幅差太多，挤在一起谁也施展不开（2026-08-21 产品意见） -->
  <el-drawer :model-value="modelValue" :with-header="false" size="480px" @update:model-value="emit('update:modelValue', $event)">
    <div v-if="file" class="ffd-detail">
      <div class="ffd-head">
        <div>
          <div class="ffd-title">{{ textOf(file.values.K6) !== '—' ? textOf(file.values.K6) : textOf(file.values.K1) }}</div>
          <div class="ffd-sub">数据 ID {{ file.dataId }}<template v-if="sourceName"> · 所属源 {{ sourceName }}</template></div>
        </div>
        <button class="rc-btn ghost" type="button" @click="emit('update:modelValue', false)">关闭</button>
      </div>
      <dl class="rc-kv">
        <dt>状态</dt><dd>{{ file.state || '—' }}</dd>
        <dt>更新时间</dt><dd>{{ file.updateDt || '—' }}</dd>
        <dt>生成时间</dt><dd>{{ file.createDt || '—' }}</dd>
        <template v-for="field in fields" :key="field.key">
          <dt>{{ field.label }}</dt><dd>{{ field.value }}</dd>
        </template>
      </dl>
    </div>
  </el-drawer>
</template>

<style scoped>
.ffd-detail { padding: 18px; }
.ffd-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.ffd-title { font-size: 14px; font-weight: 700; color: var(--rc-text); }
.ffd-sub { margin-top: 3px; color: var(--rc-faint); font-size: 11px; }
.rc-btn.ghost { border-color: var(--rc-border); background: transparent; color: var(--rc-text-2); }
</style>
