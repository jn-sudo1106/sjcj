<script setup lang="ts">
// 源选择器 —— 迁移旧平台 DSourceSelect（`data-view/src/page/base/SourceSelect.vue`）。
//
// 旧形态三件套：
//   1. a-select 下拉里直接列出一批源（`getSourceSame(sid)` 填充），选中即 emit change(record)；
//   2. 下拉底部「更多源...」→ SourceListShow 弹窗（整表浏览/多选）—— 见同目录 SourceListDialog.vue；
//   3. 右侧问号按钮 → 源详情抽屉 —— 见同目录 SourceDetailDrawer.vue。
//
// 新平台用 `sourceApi.sourcePaged` 取首屏在用源填充下拉（旧 `getSourceSame` 的分组口径后端未提供，
// 这里退化为「在用源首屏」，并以「更多源...」弹窗作为全量检索入口，整体交互与旧版一致）。
//
// 本组件刻意落在 sourceCheck/ 内，不跨模块引用 DataView，保证模块自洽。
import { onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { QuestionFilled, Plus } from '@element-plus/icons-vue'
import { sourceApi, type Source } from '@/api'
import SourceListDialog from './SourceListDialog.vue'
import SourceDetailDrawer from './SourceDetailDrawer.vue'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [record: Source | null]
}>()

// ---- 下拉源列表 ----
const options = ref<Source[]>([])

/** 保证某个源在 options 里（外部回显 / 弹窗选中的源不在首屏列表时补进来，用于展示友好 label） */
function ensureOption(row: Source) {
  if (!options.value.some((s) => s.sourceId === row.sourceId)) options.value.unshift(row)
}

async function loadOptions() {
  try {
    const res = await sourceApi.sourcePaged({ page: 1, size: 100, enable: '0' })
    options.value = res.list
  } catch {
    options.value = []
  }
}
onMounted(() => void loadOptions())

// 外部回传的 modelValue 若不在候选里，单独查一次拿名字用于展示
watch(
  () => props.modelValue,
  async (id) => {
    if (!id) return
    if (options.value.some((s) => s.sourceId === id)) return
    try {
      const res = await sourceApi.sourcePaged({ sourceIds: [id], size: 1 })
      const row = res.list[0]
      if (row) ensureOption(row)
    } catch {
      /* 查不到就退化为只显示 ID */
    }
  },
  { immediate: true },
)

/** el-select 值变化：回写 sourceId 并抛出对应记录（空值 = 清除） */
function onUpdate(id: string) {
  if (!id) {
    emit('update:modelValue', '')
    emit('change', null)
    return
  }
  const record = options.value.find((s) => s.sourceId === id) ?? null
  emit('update:modelValue', id)
  emit('change', record)
}

// ---- 「更多源...」弹窗 ----
const moreOpen = ref(false)
function showMore() {
  moreOpen.value = true
}
/** 旧 DSourceSelect.handleSelected：取回选中行的第一个作为当前源 */
function onPicked(rows: Source[]) {
  const first = rows[0]
  if (!first) return
  ensureOption(first)
  emit('update:modelValue', first.sourceId)
  emit('change', first)
}

// ---- 源详情抽屉 ----
const detailOpen = ref(false)
const detailTargetId = ref('')
function showDetail() {
  if (!props.modelValue) {
    ElMessage.error('请先选择源ID')
    return
  }
  detailTargetId.value = props.modelValue
  detailOpen.value = true
}
</script>

<template>
  <div class="ss-wrap">
    <el-select
      :model-value="props.modelValue"
      filterable
      clearable
      placeholder="源ID"
      style="width: 200px"
      @update:model-value="onUpdate"
    >
      <el-option
        v-for="s in options"
        :key="s.sourceId"
        :value="s.sourceId"
        :label="`[${s.sourceId}]${s.name}`"
      />
      <!-- 下拉不填充全量源，只放「更多源...」入口，点开走整表选择弹窗 -->
      <template #footer>
        <div class="ss-more-footer" @mousedown.prevent="showMore">
          <el-icon><Plus /></el-icon> 更多源...
        </div>
      </template>
    </el-select>
    <el-tooltip content="源详情" placement="top">
      <el-button :icon="QuestionFilled" circle size="small" class="ss-detail-btn" @click="showDetail" />
    </el-tooltip>

    <SourceListDialog v-model="moreOpen" @selected="onPicked" />
    <SourceDetailDrawer v-model="detailOpen" :source-id="detailTargetId" />
  </div>
</template>

<style scoped>
.ss-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
}
.ss-detail-btn {
  flex: none;
}
/* el-select #footer 插槽内容 */
.ss-more-footer {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border-top: 1px solid var(--rc-border-soft, #e2e8f0);
  color: var(--rc-primary, #3b82f6);
  font-size: 12px;
  cursor: pointer;
}
.ss-more-footer:hover {
  background: var(--rc-primary-bg, #eff6ff);
}
</style>
