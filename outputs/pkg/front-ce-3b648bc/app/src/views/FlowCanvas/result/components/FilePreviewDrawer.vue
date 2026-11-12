<script setup lang="ts">
// 文件预览抽屉（0819 N2，2026-08-21 按产品意见拆分）：点表格行即开，覆盖右侧约六成屏宽。
//
// 为什么与「详情」分开：预览的篇幅远大于字段列表——Excel 是整张表、PDF 可能几十页，
// 跟十来个 K 字段挤在同一个 480px 抽屉里，两边都施展不开。所以这里只放预览，
// 字段仍由行尾「详情」按钮开的 FileDetailDrawer 承担，各管各的。
//
// 用抽屉而不是左右分栏：文件表有 14 列，常驻分栏会把表格压到一半宽，两边都局促；
// 抽屉是覆盖式的，关掉就回到全宽列表。
import { computed } from 'vue'
import type { FileResourceRecord } from '@/api'
import FilePreview from './FilePreview.vue'

const props = defineProps<{
  modelValue: boolean
  file: FileResourceRecord | null
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const valueOf = (key: string) => {
  const v = props.file?.values?.[key]
  return v == null || v === '' ? '' : String(v)
}

// 站内预览只能走 K3（OSS 路径）；K2 是源站原始外网地址，只用于「原始地址」链接。
// 详见 utils/ossFile.ts 的通路说明。
const preview = computed(() => ({
  path: valueOf('K3'),
  name: valueOf('K6') || valueOf('K1'),
  ext: valueOf('K7'),
  size: valueOf('K4'),
  externalUrl: valueOf('K2'),
}))
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    :with-header="false"
    size="60%"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="file" class="fpd-body" data-testid="file-preview-drawer">
      <div class="fpd-head">
        <div class="fpd-title" :title="preview.name">{{ preview.name || '文件预览' }}</div>
        <button class="rc-btn ghost" type="button" @click="emit('update:modelValue', false)">关闭</button>
      </div>
      <FilePreview
        class="fpd-preview"
        :path="preview.path"
        :name="preview.name"
        :ext="preview.ext"
        :size="preview.size"
        :external-url="preview.externalUrl"
      />
    </div>
  </el-drawer>
</template>

<style scoped>
.fpd-body { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 18px; }
.fpd-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.fpd-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 700; color: var(--rc-text); }
/* 预览占满抽屉余下高度：这正是拆出来的目的，别再让它挤在固定的小框里 */
.fpd-preview { flex: 1; min-height: 0; }
.rc-btn.ghost { flex: none; border-color: var(--rc-border); background: transparent; color: var(--rc-text-2); }
</style>
