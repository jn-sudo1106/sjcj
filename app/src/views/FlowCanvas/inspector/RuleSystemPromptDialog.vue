<script setup lang="ts">
// 编辑系统提示词（L3 弹层，0801 方案 §6.6/拍板 #14）：保持旧系统的独立弹窗形态，不用折叠 textarea——
// 173 的 systemPrompt 约 25 行且含 minio 工具约定，折叠在 372px 窄栏里没法编辑。
import { ref, watch } from 'vue'

const props = defineProps<{ open: boolean; modelValue: string }>()
const emit = defineEmits<{ 'update:open': [boolean]; 'update:modelValue': [string] }>()

// 本地草稿：取消不应该污染已保存的系统提示词，只有点「保存」才提交
const draft = ref(props.modelValue)
watch(() => props.open, (v) => { if (v) draft.value = props.modelValue })

function close() {
  emit('update:open', false)
}
function save() {
  emit('update:modelValue', draft.value)
  close()
}
</script>

<template>
  <el-dialog :model-value="open" title="编辑系统提示词" width="720px" :close-on-click-modal="false" @update:model-value="close">
    <textarea v-model="draft" class="rspd-textarea" placeholder="描述生成脚本时应遵循的约束，如入口函数签名、禁止访问外部网络等" />
    <template #footer>
      <button class="rc-btn" type="button" @click="close">取消</button>
      <button class="rc-btn primary" type="button" @click="save">保存</button>
    </template>
  </el-dialog>
</template>

<style scoped>
.rspd-textarea { width: 100%; height: 50vh; margin: 0; border: 1px solid #dbe3ee; border-radius: 8px; background: #fff; color: var(--rc-text); font-size: 13px; line-height: 1.6; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 12px; outline: none; resize: vertical; box-sizing: border-box; }
.rspd-textarea:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-btn { display: inline-flex; align-items: center; justify-content: center; height: 32px; padding: 0 14px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text-2); font-size: 13px; cursor: pointer; }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.rc-btn:hover { border-color: #bfdbfe; }
</style>
