<script setup lang="ts">
// 编辑参数源（0721 会议 T5/S4）：NodeInspector「参数配置」tab 的只读摘要点「编辑参数源」弹出，
// 复用加源那套 ParamSourceEditor 面板（非只读），保存走 sourceApi.sourceUpdate 落库，
// 再同步回写 flow.sourceCfg/sourceCtx，patchSource 内部会把改完的模板重新灌回首个采集节点。
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useFlowStore } from '../../stores/flow'
import { sourceApi } from '../../api'
import ParamSourceEditor, { type ParamSourceModel } from './ParamSourceEditor.vue'

const visible = defineModel<boolean>({ default: false })
const flow = useFlowStore()

const draft = ref<ParamSourceModel>({ baseUrl: '', urlTemplate: '', refs: [] })
const editorRef = ref<InstanceType<typeof ParamSourceEditor> | null>(null)

watch(visible, (open) => {
  if (!open) return
  const source = flow.sourceCfg
  draft.value = {
    baseUrl: source?.baseUrl ?? '',
    urlTemplate: source?.urlTemplate ?? '',
    refs: (source?.paramRefs ?? []).map((ref) => ({ ...ref })),
  }
}, { immediate: true })

function close() {
  visible.value = false
}

async function save() {
  const source = flow.sourceCfg
  if (!source) {
    close()
    return
  }
  if (!draft.value.baseUrl.trim()) {
    ElMessage.warning('请填写基础 url')
    return
  }
  if (!draft.value.refs.length) {
    ElMessage.warning('请至少添加一个参数')
    return
  }
  if (editorRef.value?.mismatchWarnings.length) {
    ElMessage.warning('存在同组值数不一致的分组，请先调整')
    return
  }
  const patch = {
    baseUrl: draft.value.baseUrl.trim(),
    urlTemplate: draft.value.urlTemplate,
    paramRefs: draft.value.refs.map((ref) => ({ ...ref })),
  }
  try {
    const res = await sourceApi.sourceUpdate({ ...source, ...patch })
    if (!res?.ok) {
      ElMessage.warning(res?.message || '保存失败，请重试')
      return
    }
    flow.patchSource(patch)
    flow.patchSourceCtx(patch)
    ElMessage.success(res.message || '参数子源已更新')
    close()
  } catch (error) {
    ElMessage.error(`保存失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
</script>

<template>
  <div v-if="visible" class="epsd-backdrop" @click.self="close">
    <div class="epsd-card">
      <div class="epsd-title">编辑参数子源</div>
      <ParamSourceEditor ref="editorRef" v-model="draft" />
      <div class="epsd-actions">
        <button class="rc-btn" type="button" @click="close">取消</button>
        <button class="rc-btn primary" type="button" data-testid="edit-param-source-save" @click="save">保存</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.epsd-backdrop { position: fixed; inset: 0; z-index: 91; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.28); }
.epsd-card { width: min(640px, calc(100vw - 48px)); max-height: calc(100vh - 60px); overflow-y: auto; background: #fff; border: 1px solid var(--rc-border); border-radius: 12px; padding: 16px; box-shadow: 0 24px 64px -22px rgba(15, 23, 42, 0.45); }
.epsd-title { font-size: 13px; font-weight: 800; color: var(--rc-text); margin-bottom: 10px; }
.epsd-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
</style>
