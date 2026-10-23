<script setup lang="ts">
// 源选择器 —— 1:1 迁移旧 data-view `src/page/base/SourceSelect.vue`（组件名 DSourceSelect）。
//
// 旧形态（AntDV）：`a-input-group compact` = 「源下拉 + 源详情按钮」；下拉的 `dropdownRender`
// 在底部追加一行「+ 更多源...」，点开的是 `SourceListShow`（一个可搜索的源列表弹窗，
// 选中后把该行灌回 `sourceList` 并设为当前值）。
//
// 逐条对齐：
//   · `created`：选中值取 props.sid；列表为空时才请求 `getSourceSame(sid)`。
//   · `loadData`：第一行就是 `if (!this.sid) return` —— 没给 sid 既不请求、**也不动已有候选**。
//   · `handleChange(val,node)`：写回 value2 → `$emit('input')` + `$emit('change', record)`；
//     没有 record 时 emit change(null)。这里的 `record` 就是该 sourceId 在 `sourceList` 里的那一行
//     （旧版用 `curNode.key` 当下标取，本文件直接用 sourceId 在列表里找，语义一致、不依赖下拉内部下标）。
//   · `reloadSid(sid)`：父页 `watch $route.query` 时调用 —— 重新拉同站源列表并**主动选中** sid。
//   · `showDetail()`：没有选中值时 `$message.error('请先选择源ID')`。
//   · `handleSelected(rows)`：旧版是「清空列表 → push(rows) → value2 = rows[0].sourceId」，
//     等价于「把选中源补进候选列表并选中第一个」。
//
// 1014 修正（把此前偏离旧版的三处补回来；前两条与 Monitor/sourceCheck/SourceSelect.vue 同款写法）：
//   1. **源详情按钮**。旧版是 `<a-tooltip title="源详情">` 包一个 `shape="circle"` 的
//      `question-circle` 图标按钮；此前这里错用了链接图标（`Link`）且只有原生 title。
//      现换成「问号圆」图标 + tooltip。
//   2. **「更多源...」补 `@mousedown.prevent`**。旧版是 `@mousedown="e => e.preventDefault()"` + `@click`；
//      少了它，mousedown 会先让 el-select 失焦、把下拉关掉（表现成「点了没反应 / 要点两次」）。
//   3. **`change` 带出去的记录补回 `configId`**。旧版 `getSourceSame` 回来的是完整 Source 行，父页
//      `handleUploadData` 拿 `this.source.configId` 给「导入数据」弹窗兜底；新平台
//      `sourceApi.sourceSame` 只返回 `{sourceId, name}`（见 `sourceOptionFromLegacy`），那一级兜底
//      因此永远取不到值。现把「更多源」弹窗回来的完整行（含 `configId`）留在候选表里并原样 emit，
//      至少恢复「从更多源里选中」这条路径的兜底（从下拉里直接选的仍没有 configId，接口就没给）。
//
// 有意偏差：
//   1. 旧版靠 `$emit('input')` 实现 v-model；这里用 `defineModel`（Vue 3.4+）等价实现。
//   2. 旧版 `filterOption: true` 是 antd 默认的「按 label 过滤」，el-select 的 `filterable`
//      默认按 label 过滤，口径一致；旧版 `notFoundContent: null`（不显示空态）→ el-select 也无空态。
//   3. 详情按钮去掉了旧版的 HTML `title="详情"`：它和 tooltip「源详情」会叠成两层提示，
//      按 Monitor 那版只留 el-tooltip，另补 `aria-label` 保住无障碍。
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, QuestionFilled } from '@element-plus/icons-vue'
import { sourceApi, type Source } from '@/api'
import type { SourcePick } from '../shared/types'
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
const emit = defineEmits<{ (e: 'change', record: SourcePick | null): void }>()

const sourceList = ref<SourcePick[]>([])
const loading = ref(false)

const moreRef = ref<InstanceType<typeof MoreSourcesDialog>>()
const detailRef = ref<InstanceType<typeof SourceDetailDialog>>()

/** 当前选中的那一行（旧 `curNode.key` 取到的那条记录） */
const currentRecord = computed<SourcePick | null>(
  () => sourceList.value.find((item) => String(item.sourceId) === String(value.value ?? '')) ?? null,
)

async function loadData(sid?: string | number) {
  // 旧 `loadData`：没给 sid 直接 return —— 既不请求，也不清空已有候选
  if (sid === undefined || sid === null || sid === '') return
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

/** 旧 `reloadSid(sid)`：父页路由变化时重新拉列表并主动选中。没给 sid 时照旧直接返回。 */
async function reloadSid(sid?: string | number) {
  if (sid === undefined || sid === null || sid === '') return
  await loadData(sid)
  value.value = String(sid)
  emit('change', currentRecord.value)
}

function showDetail() {
  // 旧 `if (!this.curNode && !this.value2)`
  if (!currentRecord.value && !value.value) {
    ElMessage.error('请先选择源ID')
    return
  }
  detailRef.value?.open(String(value.value))
}

/** 旧 `handleSelected(rows)`：把选中的源补进候选并选中第一个。
 *  「更多源」弹窗回来的是完整 `Source`，这里把 `configId` 一起留下（候选表里唯一能拿到它的来源）。 */
function handleSelected(rows: Source[]): void {
  if (!rows.length) return
  const map = new Map(sourceList.value.map((item) => [String(item.sourceId), item]))
  rows.forEach((row) => map.set(String(row.sourceId), {
    sourceId: row.sourceId,
    name: row.name,
    configId: row.configId,
  }))
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
      <!-- 旧 dropdownRender 底部那一行（分隔线 + 「+ 更多源...」）。
           `@mousedown.prevent` 照抄旧版：少了它 mousedown 会先让 el-select 失焦关掉下拉。 -->
      <template #footer>
        <div class="ess-more" @mousedown.prevent @click="moreRef?.open()">
          <el-icon><Plus /></el-icon>
          <span>更多源...</span>
        </div>
      </template>
    </el-select>
    <!-- 旧 `<a-tooltip title="源详情">` + `shape="circle"` 的 question-circle 按钮 -->
    <el-tooltip v-if="detail" content="源详情" placement="top">
      <el-button
        :icon="QuestionFilled"
        circle
        aria-label="源详情"
        class="ess-detail-btn"
        @click="showDetail"
      />
    </el-tooltip>

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
.ess-detail-btn {
  flex: none;
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
