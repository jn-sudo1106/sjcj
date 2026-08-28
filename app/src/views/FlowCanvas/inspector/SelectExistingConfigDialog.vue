<script setup lang="ts">
// 选择已有配置（0824-00 §5.3 / §6.1）。数据源和旧平台的「本步骤使用配置」下拉一致：
// 旧 ConfigSelect.vue 用 item/next/configs/same 按源查同资源配置，合并顺序 [...list2, ...list1]，
// 展示 `[configId] - configName`——这里照搬，免得同一个源在新旧平台看到的候选顺序不一样。
// 候选按节点类别兼容过滤（0824-01 §7：只允许选类别兼容的配置）；关键词框只做本地筛选，不再发请求。
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { configApi, type Config } from '@/api'

const props = defineProps<{ open: boolean; sourceId?: string; currentConfigId?: string; configType?: string }>()
const emit = defineEmits<{ 'update:open': [boolean]; select: [Config] }>()

const loading = ref(false)
const configs = ref<Config[]>([])
const keyword = ref('')

async function load() {
  if (!props.sourceId) {
    configs.value = []
    return
  }
  loading.value = true
  try {
    configs.value = await configApi.sameConfigs(props.sourceId, props.currentConfigId)
  } catch (e) {
    ElMessage.error(`加载同资源配置失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    loading.value = false
  }
}
watch(() => props.open, (v) => { if (v) { keyword.value = ''; void load() } })

// 类别兼容：configType 就是旧平台的「抓取类型」（90 网页抓取等）。候选里没有类型的不过滤掉——
// 旧接口 list1/list2 的精简对象不一定带 configType，宁可多列也不要把可选项藏了。
const compatible = computed(() =>
  configs.value.filter((c) => props.configType === undefined || c.configType === undefined || c.configType === props.configType),
)
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return compatible.value
  return compatible.value.filter((c) => c.name.toLowerCase().includes(kw) || c.configId.includes(kw))
})

function close() {
  emit('update:open', false)
}
function onPick(config: Config) {
  emit('select', config)
  close()
}
</script>

<template>
  <el-dialog :model-value="open" title="选择已有配置" width="600px" :close-on-click-modal="false" @update:model-value="close">
    <input v-model="keyword" class="secd-search" placeholder="按配置 ID / 名称筛选" />
    <div v-loading="loading" class="secd-list">
      <div v-if="!loading && !sourceId" class="secd-empty">当前不是源画布，无法按源查同资源配置。</div>
      <div v-else-if="!loading && !filtered.length" class="secd-empty">暂无可选配置</div>
      <button
        v-for="c in filtered"
        :key="c.configId"
        class="secd-row"
        type="button"
        :class="{ current: c.configId === currentConfigId }"
        @click="onPick(c)"
      >
        <div class="secd-row-main">
          <span class="secd-id">#{{ c.configId }}</span>
          <span class="secd-name">{{ c.name }}</span>
          <span v-if="c.configId === currentConfigId" class="secd-tag">当前</span>
        </div>
        <div class="secd-row-sub">
          <span v-if="c.domain">{{ c.domain }}</span>
          <span v-if="c.topic">队列 {{ c.topic }}</span>
          <span v-if="c.entryTypeId">输出表 {{ c.entryTypeId }}</span>
        </div>
      </button>
    </div>
    <div class="rc-help">选中后只改本节点引用的配置，配置正文不会被改写；流程会进入未保存状态，需再点「保存流程」。</div>
  </el-dialog>
</template>

<style scoped>
.secd-search { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; margin-bottom: 10px; }
.secd-list { max-height: 46vh; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
.secd-empty { color: var(--rc-faint); font-size: 12px; padding: 18px 0; text-align: center; }
.secd-row { text-align: left; border: 1px solid var(--rc-border); border-radius: 8px; background: #fff; padding: 8px 10px; cursor: pointer; }
.secd-row:hover { border-color: var(--rc-primary); background: var(--rc-primary-bg); }
.secd-row.current { border-color: var(--rc-primary); }
.secd-row-main { display: flex; align-items: center; gap: 8px; }
.secd-id { font-size: 11px; font-weight: 700; color: var(--rc-text-2); font-variant-numeric: tabular-nums; }
.secd-name { font-size: 12px; font-weight: 600; color: var(--rc-text); }
.secd-tag { font-size: 10px; color: var(--rc-primary-ink); background: var(--rc-primary-bg); border-radius: 4px; padding: 1px 5px; }
.secd-row-sub { display: flex; gap: 10px; margin-top: 3px; color: var(--rc-faint); font-size: 10px; }
</style>
