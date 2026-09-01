<script setup lang="ts">
// 编辑源名称 / 源 URL。侧栏「源详情」只有 ~186px，长 URL 不适合行内改；
// 交互跟节点配置里「只读 + 编辑弹窗」同款（EditParamSourceDialog / EditNodeSourceDialog）。
// 源 ID 不可改。参数源的地址是 URL 模板，这里不让改，避免把 $PARAM$ 占位符改坏。
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { sourceApi, type Source } from '@/api'

const props = defineProps<{ open: boolean; source: Source | null }>()
const emit = defineEmits<{ 'update:open': [boolean]; saved: [Source] }>()

const name = ref('')
const url = ref('')
const saving = ref(false)
const isParam = computed(() => props.source?.kind === 'param')

watch(() => props.open, (open) => {
  if (!open || !props.source) return
  name.value = props.source.name
  url.value = isParam.value
    ? (props.source.urlTemplate || props.source.baseUrl || props.source.url || '')
    : (props.source.url || '')
}, { immediate: true })

function close() {
  emit('update:open', false)
}

async function onSave() {
  const current = props.source
  if (!current || saving.value) return
  const nextName = name.value.trim()
  if (!nextName) {
    ElMessage.warning('源名称不能为空')
    return
  }
  const nextUrl = url.value.trim()
  const updated: Source = isParam.value
    ? { ...current, name: nextName }
    : { ...current, name: nextName, url: nextUrl }
  saving.value = true
  try {
    const res = await sourceApi.sourceUpdate(updated)
    if (!res?.ok) {
      ElMessage.warning(res?.message || '保存失败，请重试')
      return
    }
    emit('saved', updated)
    ElMessage.success(res.message || '源信息已保存')
    close()
  } catch (error) {
    ElMessage.error(`保存失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="open" class="esd-backdrop" data-testid="edit-source-dialog" @click.self="close">
    <div class="esd-card">
      <div class="esd-title">编辑源</div>
      <div class="rc-field">
        <label>源名称</label>
        <input v-model="name" class="rc-input" aria-label="源名称" data-testid="edit-source-name" />
      </div>
      <div class="rc-field">
        <label>源 URL</label>
        <input
          v-model="url"
          class="rc-input"
          aria-label="源 URL"
          data-testid="edit-source-url"
          :disabled="isParam"
          :placeholder="isParam ? '参数源请在节点配置里编辑参数源' : '如 https://example.com/list'"
        />
        <div class="rc-help">
          {{ isParam
            ? '这是参数源：地址模板带 $PARAM$ 占位符，请到节点配置里用「编辑参数源」改。'
            : '源 URL 属于这条源，和节点配置里那份配置 URL 不是同一字段。' }}
        </div>
      </div>
      <div class="esd-actions">
        <button class="rc-btn" type="button" @click="close">取消</button>
        <button class="rc-btn primary" type="button" data-testid="edit-source-save" :disabled="saving" @click="onSave">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.esd-backdrop { position: fixed; inset: 0; z-index: 91; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.28); }
.esd-card { width: min(520px, calc(100vw - 48px)); background: #fff; border: 1px solid var(--rc-border); border-radius: 12px; padding: 16px; box-shadow: 0 24px 64px -22px rgba(15, 23, 42, 0.45); }
.esd-title { font-size: 13px; font-weight: 800; color: var(--rc-text); margin-bottom: 12px; }
.esd-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 14px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; box-sizing: border-box; }
.rc-input:disabled { background: #f8fafc; color: var(--rc-muted); }
.rc-help { color: var(--rc-faint); font-size: 10px; line-height: 1.5; margin-top: 6px; }
.rc-field:last-of-type { margin-bottom: 12px; }
</style>
