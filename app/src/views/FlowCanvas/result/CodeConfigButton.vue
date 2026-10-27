<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { Source } from '@/api'
import type { CodeConfigTarget } from '@/utils/flow/codeConfigTargets'
import SourceMqCodeTasks from './SourceMqCodeTasks.vue'
defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{ sources?: Source[]; buildTargets?: () => CodeConfigTarget[]; label?: string; disabled?: boolean; hideTrigger?: boolean }>(), { sources: () => [], label: '代码生成' })
const open = ref(false), busy = ref(false)
const targets = ref<CodeConfigTarget[]>([]), selectedSources = ref<Source[]>([])
function show() {
  if (props.disabled) return
  try {
    targets.value = props.buildTargets?.().map(target => ({ ...target, ...(target.entryIds ? { entryIds: [...target.entryIds] } : {}) })) ?? []
    selectedSources.value = props.sources.map(source => ({ ...source }))
    if (!targets.value.length && !selectedSources.value.length) throw new Error('请先选择源或数据')
    open.value = true
  } catch (e) { ElMessage.error(e instanceof Error ? e.message : String(e)) }
}
defineExpose({ show })
</script>
<template>
  <button v-if="!hideTrigger" v-bind="$attrs" class="rc-btn" type="button" :disabled="disabled" @click="show">{{ label }}</button>
  <el-drawer v-if="open" v-model="open" title="代码生成" size="min(760px, 96vw)" append-to-body destroy-on-close :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy">
    <SourceMqCodeTasks :sources="selectedSources" :targets="targets" @busy="busy = $event" />
  </el-drawer>
</template>
