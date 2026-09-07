<script setup lang="ts">
import { reactive, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { sourceApi, type Source } from '../../api'

const props = defineProps<{ modelValue: boolean; sourceId?: string }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const state = reactive<{ loading: boolean; source: Source | null }>({ loading: false, source: null })

// 只 watch modelValue 的话，抽屉已经打开时切换到另一个 sourceId（父级复用同一个抽屉实例，
// 只改 sourceId 不会让 modelValue 从 false→true）不会触发重新加载，导致内容空着——两个都要 watch。
watch([() => props.modelValue, () => props.sourceId], async ([open, sourceId]) => {
  if (!open) return
  if (!sourceId) {
    ElMessage.error('请先选择源ID')
    emit('update:modelValue', false)
    return
  }
  state.loading = true
  state.source = null
  try {
    state.source = await sourceApi.sourceDetail(sourceId)
  } catch (error) {
    ElMessage.error(`获取信息源详情失败${error instanceof Error ? error.message : String(error)}`)
  } finally {
    state.loading = false
  }
})
</script>

<template>
  <el-drawer :model-value="modelValue" title="源详情" size="640px" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <div v-loading="state.loading">
      <template v-if="state.source">
        <div class="dv-section">基本信息</div>
        <dl class="rc-kv rc-kv-wide">
          <dt>源 ID</dt>
          <dd>{{ state.source.sourceId }}</dd>
          <dt>名称</dt>
          <dd>{{ state.source.name }}</dd>
          <dt>URL</dt>
          <dd><a class="dv-a" :href="state.source.url" target="_blank" rel="noopener">{{ state.source.url }}</a></dd>
          <dt>配置 ID</dt>
          <dd>{{ state.source.configId || '—' }}</dd>
          <dt>主表</dt>
          <dd>{{ state.source.mainTable || '—' }}</dd>
          <dt>责任人</dt>
          <dd>{{ state.source.owner || '—' }}</dd>
          <dt>大类</dt>
          <dd>{{ state.source.category || '—' }}</dd>
          <dt>子类别</dt>
          <dd>{{ state.source.subCategory || '—' }}</dd>
          <dt>目录</dt>
          <dd>{{ state.source.dirId || '—' }}</dd>
          <dt>目录路径</dt>
          <dd>{{ state.source.categoryPath || '—' }}</dd>
          <dt>域</dt>
          <dd>{{ state.source.domain || '—' }}</dd>
          <dt>标签</dt>
          <dd>{{ state.source.tags?.join('、') || '—' }}</dd>
        </dl>

        <div class="dv-section">运行与数据</div>
        <dl class="rc-kv rc-kv-wide">
          <dt>状态</dt>
          <dd>{{ state.source.disabled ? '已停用' : state.source.state || '—' }}</dd>
          <dt>采集周期</dt>
          <dd>{{ state.source.cycle || '—' }}</dd>
          <dt>频率</dt>
          <dd>{{ state.source.freqTag || '—' }}</dd>
          <dt>断点续传</dt>
          <dd>{{ state.source.resume ? '是' : '否' }}</dd>
          <dt>登录配置</dt>
          <dd>{{ state.source.authConfig || '—' }}</dd>
          <dt>上次任务</dt>
          <dd>{{ state.source.lastTaskAt || '—' }}</dd>
          <dt>上次成功</dt>
          <dd>{{ state.source.lastSuccessAt || '—' }}</dd>
          <dt>数据量</dt>
          <dd>{{ state.source.dataCount ?? '—' }}</dd>
          <dt>最新</dt>
          <dd>{{ state.source.lastInsertAt || '—' }}</dd>
          <dt>定时</dt>
          <dd>{{ state.source.jobCount ?? '—' }}</dd>
          <dt>步骤</dt>
          <dd>{{ state.source.stepCount ?? '—' }}</dd>
          <dt>优先级</dt>
          <dd>{{ state.source.priority ?? '—' }}</dd>
        </dl>

        <div class="dv-section">配置与变更</div>
        <dl class="rc-kv rc-kv-wide">
          <dt>上次 URL</dt>
          <dd>{{ state.source.lastUrl || '—' }}</dd>
          <dt>核心参数</dt>
          <dd>{{ state.source.coreParam || '—' }}</dd>
          <dt>最后修改人</dt>
          <dd>{{ state.source.lastModifiedBy || '—' }}</dd>
          <dt>最近同步</dt>
          <dd>{{ state.source.syncedAt || '—' }}</dd>
          <dt>外部变更</dt>
          <dd>{{ state.source.externalChanged ? '待确认' : '—' }}</dd>
          <dt>版本</dt>
          <dd>{{ state.source.version ?? '—' }}</dd>
          <dt>日期</dt>
          <dd>{{ state.source.createdAt || '—' }}</dd>
          <dt>更新时间</dt>
          <dd>{{ state.source.updatedAt || '—' }}</dd>
          <dt>备注</dt>
          <dd>{{ state.source.remark || '—' }}</dd>
        </dl>
      </template>
    </div>
  </el-drawer>
</template>

<style scoped>
.rc-kv-wide {
  grid-template-columns: 68px 1fr 68px 1fr;
}
.dv-section {
  margin: 16px 0 8px;
  color: var(--rc-text);
  font-size: 13px;
  font-weight: 700;
}
</style>
