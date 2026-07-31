<script setup lang="ts">
import { reactive, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { sourceApi, type Source } from '../../api'

const props = defineProps<{ modelValue: boolean; sourceId?: string }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const state = reactive<{ loading: boolean; source: Source | null }>({ loading: false, source: null })

watch(() => props.modelValue, async (v) => {
  if (!v) return
  if (!props.sourceId) {
    ElMessage.error('请先选择源ID')
    emit('update:modelValue', false)
    return
  }
  state.loading = true
  state.source = null
  try {
    state.source = await sourceApi.sourceDetail(props.sourceId)
  } catch (error) {
    ElMessage.error(`获取信息源详情失败${error instanceof Error ? error.message : String(error)}`)
  } finally {
    state.loading = false
  }
})
</script>

<template>
  <el-drawer :model-value="modelValue" title="源详情" size="480px" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <div v-loading="state.loading">
      <dl v-if="state.source" class="rc-kv">
        <dt>源 ID</dt>
        <dd>{{ state.source.sourceId }}</dd>
        <dt>名称</dt>
        <dd>{{ state.source.name }}</dd>
        <dt>URL</dt>
        <dd><a class="dv-a" :href="state.source.url" target="_blank" rel="noopener">{{ state.source.url }}</a></dd>
        <dt>主表</dt>
        <dd>{{ state.source.mainTable }}</dd>
        <dt>责任人</dt>
        <dd>{{ state.source.owner || '—' }}</dd>
        <dt>大类</dt>
        <dd>{{ state.source.category || '—' }}</dd>
        <dt>状态</dt>
        <dd>{{ state.source.state }}</dd>
        <dt>采集周期</dt>
        <dd>{{ state.source.cycle || '—' }}</dd>
        <dt>上次任务</dt>
        <dd>{{ state.source.lastTaskAt || '—' }}</dd>
        <dt>上次成功</dt>
        <dd>{{ state.source.lastSuccessAt || '—' }}</dd>
        <dt>数据量</dt>
        <dd>{{ state.source.dataCount ?? '—' }}</dd>
        <dt>备注</dt>
        <dd>{{ state.source.remark || '—' }}</dd>
      </dl>
    </div>
  </el-drawer>
</template>
