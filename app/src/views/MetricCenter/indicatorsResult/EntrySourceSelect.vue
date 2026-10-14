<script setup lang="ts">
// 源选择器 —— 1:1 迁移旧 data-view `src/page/base/SourceSelect.vue`（组件名 DSourceSelect）。
//
// 旧形态（AntDV）：`a-input-group compact` = 「源下拉 + 源详情按钮」；下拉的 `dropdownRender`
// 在底部追加一行「+ 更多源...」，点开的是 `SourceListShow`（一个可搜索的源列表弹窗，
// 选中后把该行灌回 `sourceList` 并设为当前值）。
//
// 逐条对齐：
//   · `created`：选中值取 props.sid；列表为空时才请求 `getSourceSame(sid)`。
//   · `handleChange(val,node)`：写回 value2 → `$emit('input')` + `$emit('change', record)`；
//     没有 record 时 emit change(null)。这里的 `record` 就是该 sourceId 在 `sourceList` 里的那一行
//     （旧版用 `curNode.key` 当下标取，本文件直接用 sourceId 在列表里找，语义一致、不依赖下拉内部下标）。
//   · `reloadSid(sid)`：父页 `watch $route.query` 时调用 —— 重新拉同站源列表并**主动选中** sid。
//   · `showDetail()`：没有选中值时 `$message.error('请先选择源ID')`。
//   · `handleSelected(rows)`：旧版是「清空列表 → push(rows) → value2 = rows[0].sourceId」，
//     等价于「把选中源补进候选列表并选中第一个」。
//
// 有意偏差：
//   1. `getSourceSame` → `sourceApi.sourceSame`（同站源列表，sourceId 可空）。新平台该接口返回的是
//      **精简的 `SourceOption`**（只有 `sourceId / name`，见 adapters 的 `sourceOptionFromLegacy`），
//      没有旧版 `SourceList` 记录上的 configId 等字段；`value/label` 取 `sourceId / name`
//      （旧版是 `sourceId / sourceName`）。⚠️ 因此 `change` 事件带出去的那行记录也只有这两个字段——
//      旧页拿它取 `configId` 兜底给「导入数据」弹窗的那条路在新平台取不到值（select 的候选项本身没有），
//      见 indicatorsResult/index.vue 的 handleUploadData 注释。
//   2. 旧版靠 `$emit('input')` 实现 v-model；这里用 `defineModel`（Vue 3.4+）等价实现。
//   3. 旧版 `filterOption: true` 是 antd 默认的「按 label 过滤」，el-select 的 `filterable`
//      默认按 label 过滤，口径一致；旧版 `notFoundContent: null`（不显示空态）→ el-select 也无空态。
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Link, Plus } from '@element-plus/icons-vue'
import { sourceApi, type Source, type SourceOption } from '@/api'
import MoreSourcesDialog from './MoreSourcesDialog.vue'
import SourceDetailDialog from './SourceDetailDialog.vue'

defineOptions({ name: 'EntrySourceSelect' })

const props = withDefaults(defineProps<{
  /** 初始选中的源（旧 `sid`） */
  sid?: string | number
  /** 是否显示「源详情」按钮（旧 `detail`，默认 true） */
  detail?: boolean
}>(), { sid: undefined, detail: true })

const value = defineModel<string | number | undefined>({ default: undefined })
const emit = defineEmits<{ (e: 'change', record: SourceOption | null): void }>()

const sourceList = ref<SourceOption[]>([])
const loading = ref(false)

const moreRef = ref<InstanceType<typeof MoreSourcesDialog>>()
const detailRef = ref<InstanceType<typeof SourceDetailDialog>>()

/** 当前选中的那一行（旧 `curNode.key` 取到的那条记录） */
const currentRecord = computed<SourceOption | null>(
  () => sourceList.value.find((item) => String(item.sourceId) === String(value.value ?? '')) ?? null,
)

async function loadData(sid?: string | number) {
  if (sid === undefined || sid === null || sid === '') {
    sourceList.value = []
    return
  }
  loading.value = true
  try {
    sourceList.value = await sourceApi.sourceSame(String(sid))
  } catch {
    // 旧版这里刻意静默（catch 里只有注释掉的 notification），保持不弹错
    sourceList.value = []
  } finally {
    loading.value = false
  }
}

function handleChange(val: string | number | undefined) {
  value.value = val
  emit('change', currentRecord.value)
}

/** 旧 `reloadSid(sid)`：父页路由变化时重新拉列表并主动选中 */
async function reloadSid(sid?: string | number) {
  await loadData(sid)
  if (sid === undefined || sid === null || sid === '') return
  value.value = String(sid)
  emit('change', currentRecord.value)
}

function showDetail() {
  if (!currentRecord.value && (value.value === undefined || value.value === '')) {
    ElMessage.error('请先选择源ID')
    return
  }
  detailRef.value?.open(String(value.value))
}

/** 旧 `handleSelected(rows)`：把选中的源补进候选并选中第一个。
 *  「更多源」弹窗回来的是完整 `Source`，这里只留 `sourceId / name`（`sourceSame` 的口径）。 */
function handleSelected(rows: Source[]): void {
  if (!rows.length) return
  const map = new Map(sourceList.value.map((item) => [String(item.sourceId), item]))
  rows.forEach((row) => map.set(String(row.sourceId), { sourceId: row.sourceId, name: row.name }))
  sourceList.value = [...map.values()]
  value.value = rows[0].sourceId
  emit('change', currentRecord.value)
}

onMounted(() => {
  void loadData(props.sid)
})

defineExpose({ reloadSid, loadData })
</script>

<template>
  <div class="ess-wrap">
    <el-select
      :model-value="value"
      class="ess-select"
      filterable
      clearable
      placeholder="源ID"
      :loading="loading"
      :no-data-text="''"
      @update:model-value="handleChange"
    >
      <el-option
        v-for="item in sourceList"
        :key="item.sourceId"
        :value="item.sourceId"
        :label="`[${item.sourceId}]${item.name}`"
      />
      <template #footer>
        <div class="ess-more" @click="moreRef?.open()">
          <el-icon><Plus /></el-icon>
          <span>更多源...</span>
        </div>
      </template>
    </el-select>
    <el-button v-if="detail" :icon="Link" title="源详情" @click="showDetail" />

    <MoreSourcesDialog ref="moreRef" @selected="handleSelected" />
    <SourceDetailDialog ref="detailRef" />
  </div>
</template>

<style scoped>
.ess-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
}
.ess-select {
  flex: 1;
  min-width: 0;
}
.ess-more {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-top: 1px solid var(--rc-border, #e2e8f0);
  color: var(--rc-primary, #2563eb);
  font-size: 13px;
  cursor: pointer;
}
.ess-more:hover {
  background: var(--rc-primary-soft, #eff6ff);
}
</style>
