<script setup lang="ts">
// 编辑节点名称 / 源 URL（0824-11 §1.2b）。
// 这两个字段不属于配置——底部「保存配置」不管它们。与其在面板里摆一个分组标题加内嵌保存按钮
// 把内部归属摊给用户看，不如沿用本文件里参数源那套已有交互：面板上只读展示，编辑收进弹窗，
// 弹窗自己落库（EditParamSourceDialog 同款）。
//
// 源 URL 走 source/updateSource 真落库；节点名称要走 item/next/stepModify，那个接口前端还没实现，
// 保存后如实提示，不假装存了。接口接上后这里补一次调用即可，交互不用改。
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { sourceApi } from '@/api'
import { useFlowStore } from '@/stores/flow'

const props = defineProps<{ open: boolean; nodeId: string; showUrl?: boolean }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const flow = useFlowStore()
const title = ref('')
const url = ref('')
const saving = ref(false)

watch(() => props.open, (v) => {
  if (!v) return
  title.value = flow.configs[props.nodeId]?.title ?? ''
  url.value = flow.sourceCfg?.url ?? ''
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
    if (name !== flow.configs[props.nodeId]?.title) flow.setTitle(props.nodeId, name)
    if (props.showUrl) flow.patchSource({ url: url.value.trim() })
    const source = flow.sourceCfg
    if (props.showUrl && source) {
      const res = await sourceApi.sourceUpdate(source)
      if (!res?.ok) {
        ElMessage.error(res?.message || '保存源信息失败')
        return
      }
      flow.patchSourceCtx({ url: source.url })
      ElMessage.success('源 URL 已保存；节点名称待步骤接口接入后落库')
    } else {
      ElMessage.success('已更新，节点名称待步骤接口接入后落库')
    }
    close()
  } catch (e) {
    ElMessage.error(`保存失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="open" title="编辑节点与源" width="520px" :close-on-click-modal="false" @update:model-value="close">
    <div class="rc-field"><label>节点名称</label>
      <input v-model="title" class="rc-input" aria-label="节点名称" />
    </div>
    <div v-if="showUrl" class="rc-field"><label>源 URL</label>
      <input v-model="url" class="rc-input" placeholder="如 https://example.com/list" aria-label="源 URL" />
      <div class="rc-help">源 URL 属于源，一个源一份；同一份配置被多个源复用时，各源的 URL 互不影响。</div>
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
.rc-help { color: var(--rc-faint); font-size: 10px; line-height: 1.5; margin-top: 6px; }
.rc-field:last-of-type { margin-bottom: 0; }
</style>
