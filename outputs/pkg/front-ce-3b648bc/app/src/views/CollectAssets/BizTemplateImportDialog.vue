<script setup lang="ts">
// 业务目录「按模板批量新增」（10-22）：勾一个源当模板，一行一条「源名称;URL」批量建源，
// 复用模板源的配置和流程（共用同一条流程），建完加入左侧选中的业务目录。见 importFromTemplateToBizDir。
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { isProductionCreateEnabled } from '@/api/client'
import { sourceApi } from '@/api'
import { importFromTemplateToBizDir, type TemplateImportResult } from '@/api/sourceDirs'
import type { Source } from '@/api/types'

const CREATE_DISABLED_MESSAGE = '当前环境未开启新建通道（VITE_SITE_CREATE_TARGET=production），无法新增源'

const props = defineProps<{
  templateId: string
  dirId: string
  dirLabel: string
}>()
const emit = defineEmits<{ close: []; saved: [] }>()

const visible = ref(true)
const template = ref<Source | null>(null)
const loadError = ref('')
const text = ref('')
const saving = ref(false)
const result = ref<TemplateImportResult | null>(null)
const createEnabled = isProductionCreateEnabled()
const canSubmit = computed(() => createEnabled && !!template.value && !saving.value && !!text.value.trim())

onMounted(async () => {
  try {
    template.value = await sourceApi.sourceDetail(props.templateId)
    if (!template.value) loadError.value = `模板源 #${props.templateId} 不存在`
  } catch (e) {
    loadError.value = `读取模板源失败：${(e as Error)?.message ?? String(e)}`
  }
})

function close() {
  visible.value = false
  emit('close')
}
async function submit() {
  if (!canSubmit.value || !template.value) return
  saving.value = true
  try {
    const r = await importFromTemplateToBizDir(template.value, text.value, props.dirId)
    if (!r.added.length && !r.failed.length) {
      ElMessage.warning('没有可导入的行，请检查「源名称;URL」格式')
      return
    }
    if (r.added.length) emit('saved')
    if (!r.failed.length && !r.partial.length) {
      ElMessage.success(`已新增 ${r.added.length} 条源${r.skipped ? `，跳过 ${r.skipped} 条` : ''}`)
      close()
      return
    }
    result.value = r
  } catch (e) {
    ElMessage.error(`导入失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="visible" :title="`按模板批量新增 · ${template?.name ?? `#${templateId}`}`" width="620px" append-to-body data-testid="biz-template-import" @update:model-value="(v: boolean) => { if (!v) close() }">
    <div class="bti-row"><span class="bti-k">模板源</span><b>{{ template ? `#${template.sourceId} ${template.name}` : (loadError || '读取中…') }}</b></div>
    <div class="bti-row"><span class="bti-k">加入目录</span><b class="bti-dir">{{ dirLabel }}</b></div>
    <textarea
      v-model="text"
      class="bti-textarea"
      rows="8"
      data-testid="biz-template-import-text"
      placeholder="一行一条，格式：源名称;URL（URL 可省略，省略时沿用模板源的 URL）&#10;波兰语公告;https://example.com/notice?lang=pl&#10;瑞典语公告;https://example.com/notice?lang=sv"
    />
    <div class="bti-hint">新源复用模板源的配置，归入模板源的网站；模板源属于来源组时，新源加入同组并使用组流程，否则共用模板源的流程。修改共用流程会一起生效；空行跳过</div>
    <div v-if="!createEnabled" class="bti-err">{{ CREATE_DISABLED_MESSAGE }}</div>
    <div v-if="result" class="bti-result" role="alert" data-testid="biz-template-import-result">
      <div>已新增 {{ result.added.length }} 条<template v-if="result.skipped">，跳过 {{ result.skipped }} 条</template>，失败 {{ result.failed.length }} 条</div>
      <div v-for="line in result.failed" :key="line" class="bti-err">未建出：{{ line }}</div>
      <div v-for="line in result.partial" :key="line" class="bti-warn">需手动补：{{ line }}</div>
    </div>
    <template #footer>
      <el-button @click="close">{{ result ? '关闭' : '取消' }}</el-button>
      <el-button type="primary" :loading="saving" :disabled="!canSubmit" data-testid="biz-template-import-ok" @click="submit">导入</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.bti-row { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; color: var(--rc-text); font-size: 13px; }
.bti-k { flex: none; width: 56px; color: var(--rc-muted); }
.bti-dir { color: #7c3aed; }
.bti-textarea { width: 100%; box-sizing: border-box; margin-top: 4px; padding: 10px 12px; border: 1px solid var(--rc-border); border-radius: 8px; font-size: 13px; line-height: 1.6; resize: vertical; }
.bti-textarea:focus { outline: none; border-color: var(--rc-primary); }
.bti-hint { margin-top: 6px; color: var(--rc-muted); font-size: 12px; }
.bti-result { margin-top: 10px; padding: 8px 10px; border-radius: 6px; background: var(--rc-surface-2, #f8fafc); font-size: 12.5px; max-height: 180px; overflow: auto; }
.bti-err { margin-top: 4px; color: var(--rc-error); font-size: 12px; overflow-wrap: anywhere; }
.bti-warn { margin-top: 4px; color: #b45309; font-size: 12px; overflow-wrap: anywhere; }
</style>
