<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useSourceGroupsStore } from '@/stores/sourceGroups'
const props = defineProps<{ modelValue: boolean; sourceIds: string[]; fromGroup?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [] }>()
const groups = useSourceGroupsStore()
const targets = ref<string[]>([])
watch(() => props.modelValue, () => { targets.value = [] })
function save() {
  try {
    groups.assign(props.sourceIds, targets.value, props.fromGroup)
    ElMessage.success(props.fromGroup ? '已移动源分组关系' : '已加入分组')
    emit('saved')
    emit('update:modelValue', false)
  } catch (e) { ElMessage.error(e instanceof Error ? e.message : '本机保存失败') }
}
</script>
<template>
  <el-dialog :model-value="modelValue" :title="fromGroup ? '移动到分组' : '加入源分组'" width="480px" style="max-width: calc(100vw - 32px)" append-to-body @update:model-value="emit('update:modelValue', $event)">
    <p>已选 {{ sourceIds.length }} 个源，可选择多个目标分组。仅保存当前账号在本机的分组关系。</p>
    <el-select v-model="targets" multiple placeholder="选择分组" style="width: 100%">
      <el-option v-for="g in groups.options" :key="g.id" :label="g.label" :value="g.id" :disabled="g.id === fromGroup" />
    </el-select>
    <p v-if="!groups.groups.length">暂无个人分组，请先在「我的分组」中新建分组。</p>
    <template #footer><el-button @click="emit('update:modelValue', false)">取消</el-button><el-button type="primary" :disabled="!targets.length || !sourceIds.length" @click="save">保存</el-button></template>
  </el-dialog>
</template>
