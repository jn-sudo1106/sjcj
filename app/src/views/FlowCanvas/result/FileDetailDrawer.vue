<script setup lang="ts">
import { computed } from 'vue'
import type { FileResourceRecord } from '@/api'
import FilePreview from './components/FilePreview.vue'

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

// 预览入参（0819 N2-3）：站内预览只能走 K3（OSS 路径），K2 是源站原始外网地址、只用于
// 「原始地址」链接，K9「文本路径」在真实数据里整列为空——详见 utils/ossFile.ts 的说明。
const valueOf = (key: string) => {
  const v = props.file?.values?.[key]
  return v == null || v === '' ? '' : String(v)
}
const preview = computed(() => ({
  path: valueOf('K3'),
  name: valueOf('K6') || valueOf('K1'),
  ext: valueOf('K7'),
  size: valueOf('K4'),
  externalUrl: valueOf('K2'),
}))

const fields = computed(() => Object.entries(props.file?.values ?? {}).map(([key, value]) => ({
  key,
  label: fieldLabels[key] || key,
  value: key === 'K4' || key === 'K10' ? formatSize(value) : textOf(value),
})))
</script>

<template>
  <!-- 加宽到 720px：预览是这个抽屉的主角（会议 15:21"需要新做一个预览"），
       480px 下 Excel 表格几乎看不出内容 -->
  <el-drawer :model-value="modelValue" :with-header="false" size="720px" @update:model-value="emit('update:modelValue', $event)">
    <div v-if="file" class="ffd-detail">
      <div class="ffd-head">
        <div>
          <div class="ffd-title">{{ textOf(file.values.K6) !== '—' ? textOf(file.values.K6) : textOf(file.values.K1) }}</div>
          <div class="ffd-sub">数据 ID {{ file.dataId }}<template v-if="sourceName"> · 所属源 {{ sourceName }}</template></div>
        </div>
        <button class="rc-btn ghost" type="button" @click="emit('update:modelValue', false)">关闭</button>
      </div>
      <FilePreview
        class="ffd-preview"
        :path="preview.path"
        :name="preview.name"
        :ext="preview.ext"
        :size="preview.size"
        :external-url="preview.externalUrl"
      />

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
.ffd-preview { margin-bottom: 16px; }
.rc-btn.ghost { border-color: var(--rc-border); background: transparent; color: var(--rc-text-2); }
</style>
