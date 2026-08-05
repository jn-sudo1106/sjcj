<script setup lang="ts">
// 脚本全文查看（L3 弹层，0801 方案 §6.6）：唯一默认大弹层，因窄栏代码区放不下脚本全文，会议 15:38 已拍板。
import { ElMessage } from 'element-plus'

const props = defineProps<{ open: boolean; title?: string; scriptPath?: string; script: string }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

function close() {
  emit('update:open', false)
}
async function copyScript() {
  try {
    await navigator.clipboard.writeText(props.script)
    ElMessage.success('已复制脚本内容')
  } catch {
    ElMessage.error('复制失败，请手动选中复制')
  }
}
</script>

<template>
  <el-dialog :model-value="open" :title="title || '脚本查看'" width="90vw" top="6vh" :close-on-click-modal="false" @update:model-value="close">
    <div class="rsd-path">{{ scriptPath || '未生成脚本路径' }}</div>
    <textarea class="rsd-code" readonly :value="script" />
    <template #footer>
      <button class="rc-btn" type="button" @click="copyScript">复制</button>
      <button class="rc-btn primary" type="button" @click="close">关闭</button>
    </template>
  </el-dialog>
</template>

<style scoped>
.rsd-path { color: var(--rc-faint); font-size: 12px; margin-bottom: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.rsd-code { width: 100%; height: 68vh; margin: 0; border: 1px solid #dbe3ee; border-radius: 8px; background: #0f172a; color: #dbeafe; font-size: 13px; line-height: 1.6; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 14px; outline: none; resize: none; box-sizing: border-box; }
.rc-btn { display: inline-flex; align-items: center; justify-content: center; height: 32px; padding: 0 14px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text-2); font-size: 13px; cursor: pointer; }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.rc-btn:hover { border-color: #bfdbfe; }
</style>
