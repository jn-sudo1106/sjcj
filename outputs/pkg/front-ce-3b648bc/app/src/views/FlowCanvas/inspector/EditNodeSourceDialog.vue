<script setup lang="ts">
// 编辑节点名称（0824-11 §1.2b）。不属于配置，底部「保存配置」不管它。
// 源名称和源地址在左侧「源详情」改（EditSourceDialog），不和节点名称混在一个弹窗里。
// 已落库步骤立刻走 item/next/stepModify；本地草稿等绑定配置后由自动保存落库。
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import { useStepWrite } from '@/views/FlowCanvas/canvas/useStepWrite'

const props = defineProps<{ open: boolean; nodeId: string }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const flow = useFlowStore()
const { persistNodeName } = useStepWrite()
const title = ref('')
const saving = ref(false)

watch(() => props.open, (v) => {
  if (!v) return
  title.value = flow.configs[props.nodeId]?.title ?? ''
})

function close() {
  emit('update:open', false)
}

async function onSave() {
  if (saving.value) return
  const name = title.value.trim()
  if (!name) {
    ElMessage.warning('节点名称不能为空')
    return
  }
  saving.value = true
  try {
    await persistNodeName(props.nodeId, name)
    close()
  } catch (e) {
    ElMessage.error(`保存失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="open" title="编辑节点名称" width="520px" :close-on-click-modal="false" @update:model-value="close">
    <div class="rc-field"><label>节点名称</label>
      <input v-model="title" class="rc-input" aria-label="节点名称" />
    </div>
    <template #footer>
      <button class="rc-btn" type="button" @click="close">取消</button>
      <button class="rc-btn primary" type="button" :disabled="saving" @click="onSave">
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 全局 .rc-field 是工具栏用的横向 pill（tokens.css:143，inline-flex + 边框 + 白底 + 34px 定高），
   面板/弹窗里用它必须先重置，否则输入框外面会再套一层框。口径同 CollectorSettings.vue。 */
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 14px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; }
.rc-field:last-of-type { margin-bottom: 0; }
</style>

