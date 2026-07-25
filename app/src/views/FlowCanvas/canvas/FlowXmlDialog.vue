<script setup lang="ts">
const props = withDefaults(defineProps<{
  open: boolean
  xml: string
  flowId: string
  canExport?: boolean
}>(), { canExport: false })

const emit = defineEmits<{ 'update:open': [value: boolean] }>()

function close(value: boolean) {
  emit('update:open', value)
}

function exportXml() {
  if (!props.canExport) return
  const blob = new Blob([props.xml], { type: 'application/xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${props.flowId}.xml`
  link.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <el-dialog
    :model-value="open"
    title="流程 XML"
    width="860px"
    :close-on-click-modal="false"
    @update:model-value="close"
  >
    <p v-if="!canExport" class="fxd-tip">当前流程尚未保存或存在校验问题，仅可查看 XML。</p>
    <textarea class="fxd-code" :value="xml" readonly aria-label="流程 XML" />
    <template #footer>
      <button class="rc-btn" type="button" @click="close(false)">关闭</button>
      <button data-testid="export-xml" class="rc-btn primary" type="button" :disabled="!canExport" @click="exportXml">导出 XML</button>
    </template>
  </el-dialog>
</template>

<style scoped>
.fxd-tip { margin: 0 0 10px; color: #b45309; font-size: 12px; }
.fxd-code { display: block; width: 100%; min-height: 460px; padding: 12px; box-sizing: border-box; border: 1px solid var(--rc-border); border-radius: 8px; background: #0f172a; color: #e2e8f0; font: 12px/1.6 var(--rc-mono, monospace); resize: vertical; }
.rc-btn { height: 30px; padding: 0 14px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text-2); cursor: pointer; }
.rc-btn.primary { margin-left: 8px; border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.rc-btn:disabled { opacity: .5; cursor: not-allowed; }
</style>
