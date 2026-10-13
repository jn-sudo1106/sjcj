<script setup lang="ts">
// 编辑数据集 —— 1:1 迁移旧 data-view `src/page/config/modules/BaseEdit.vue`
// （DatasetList.vue 里的 `<base-edit-modal ref="datasetEdit" :cols="editCols" :callback="updateCallback">`）。
//
// 旧版行为逐条对齐：
//   · 表单体是「列定义驱动的描述表」：`a-descriptions bordered :column="4"`，每项占 `col.span` 格
//     （DATASET 的列 span 都是 2 或 4 → 半行 / 整行）。
//   · 打开时（doEdit）先把**每个列字段**置 null，再 `Object.assign(form, record)`——
//     所以提交体里除了表单字段，还带着记录上那些不在列里的原始字段（datasetId / measureCnt /
//     state / runCnt / successCnt / isDelete / ver / updateDt …），由 buildPayload 按旧
//     updateCallback 的口径再删 4 个。
//   · 控件类型走旧 item.type：DATASET 只用到 `cron`（定时）与缺省文本输入；
//     `textArea` / `readonly`（表单禁用）也按旧 BaseEdit 的分支实现，方便同目录复用。
//   · 弹窗宽度：旧版 `document.body.clientWidth - 300`，这里用等价的 `calc(100vw - 300px)`。
//
// 有意偏差（都在交付说明里单列）：
//   1. 提交由本组件直接调 updateDataSet（旧版把回调抛给父组件 DatasetList.vue 再调接口），
//      字段剔除口径不变，见 buildPayload。
//   2. 旧版确实没做前端必填拦截：BaseEdit 把 `:rules="{required:true}"` 挂在 <a-input> 上，而
//      a-form-model 的 validate() 只收集 a-form-model-item 包裹的控件——那个模板里根本没有
//      a-form-model-item（只有 a-descriptions-item），所以 `validate(valid => ...)` 结果恒为 true。
//      这里保持同样的「交给后端兜底」口径，不新增拦截。
//   3. 「定时」的图形编辑器复用 Monitor/sourceCheck 已迁移的 `SourceCronDialog.vue`
//      （旧版是 `modules/SourceCron.vue`，同一套 UI：常用定时 + cron 编辑器 + 测试 + 最近运行时间），
//      不重复实现一份。旧版双击输入框会把**表达式的值**当 key 传进 showCron，导致 `form[<表达式>]`
//      被写入（旧代码 bug）——这里不复制这个 bug，双击与「配定时」都按当前值打开。
//   4. 模板里没有用 `v-model="form[key]"`：form 是动态键（`Record<string, unknown>`），直接 v-model
//      过不了 vue-tsc 的类型检查，改用 `:model-value` + `@update:model-value` 等价接线。
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { updateDataSet } from '@/api/dataset'
import type { DatasetRow } from '@/api/dataset'
import SourceCronDialog from '@/views/Monitor/sourceCheck/SourceCronDialog.vue'
import { editColumns, type DatasetColumn } from './columns'

defineOptions({ name: 'DatasetEditDialog' })

const emit = defineEmits<{ (e: 'saved'): void }>()

/** 旧 `:cols="editCols"` —— 编辑字段表是静态的（该页没有新增弹窗） */
const columns: DatasetColumn[] = editColumns()

const open = ref(false)
const loading = ref(false)
/** 旧弹窗 title 默认「编辑」 */
const title = '编辑'
const form = reactive<Record<string, unknown>>({})

/** 旧 doEdit：先按列把表单字段全部置 null（`this.$set(this.form, k.dataIndex, null)`） */
function resetForm() {
  Object.keys(form).forEach((key) => delete form[key])
  columns.forEach((col) => {
    form[col.dataIndex] = null
  })
}

const textVal = (key: string): string => (form[key] == null ? '' : String(form[key]))
function setVal(key: string, value: unknown) {
  form[key] = value
}

/** 打开弹窗（旧 `doEdit(record)`）。新增态在这一页没有入口，所以只支持编辑。 */
function openDialog(record: DatasetRow) {
  resetForm()
  // 旧 `Object.assign(this.form, copy)`：记录上的**全部**字段进 form（含不在列里的）
  Object.assign(form, record as Record<string, unknown>)
  open.value = true
}

function closeDialog() {
  open.value = false
  resetForm()
}

/** 旧 `updateCallback(obj)`：剔除 4 个字段后提交 */
function buildPayload(): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...form }
  delete payload.lastRun
  delete payload.nextRun
  delete payload.updateDt
  delete payload.createDt
  return payload
}

async function onSubmit() {
  loading.value = true
  try {
    await updateDataSet(buildPayload())
    ElMessage.success('修改成功!')
    emit('saved')
    closeDialog()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '提交修改失败')
  } finally {
    loading.value = false
  }
}

// ---- 定时（旧 BaseEdit 的 `type === 'cron'` 分支 + SourceCron 弹窗）----
const cronOpen = ref(false)
/** 当前编辑的定时字段名（旧版 `curKey`） */
const cronKey = ref('')

function openCron(key: string) {
  cronKey.value = key
  cronOpen.value = true
}

/** 旧 `saveCron(obj)`：把编辑器结果写回表单字段 */
function onCronSubmit(cron: string) {
  if (cronKey.value) form[cronKey.value] = cron
}

defineExpose({ openDialog })
</script>

<template>
  <el-dialog
    v-model="open"
    :title="title"
    width="calc(100vw - 300px)"
    destroy-on-close
    :close-on-click-modal="false"
    append-to-body
    @close="closeDialog"
  >
    <el-descriptions border :column="4" size="small" class="de-desc">
      <el-descriptions-item
        v-for="col in columns"
        :key="col.dataIndex"
        :label="col.title"
        :span="col.span ?? 2"
      >
        <!-- 旧 BaseEdit 的控件分支：按 DATASET 实际用得到的类型保留 -->
        <el-input
          v-if="col.type === 'cron'"
          :model-value="textVal(col.dataIndex)"
          placeholder="请生成cron表达式"
          @dblclick="openCron(col.dataIndex)"
          @update:model-value="(v: string) => setVal(col.dataIndex, v)"
        >
          <template #append>
            <el-button @click="openCron(col.dataIndex)">配定时</el-button>
          </template>
        </el-input>
        <el-input
          v-else-if="col.type === 'textArea'"
          :model-value="textVal(col.dataIndex)"
          type="textarea"
          :rows="3"
          @update:model-value="(v: string) => setVal(col.dataIndex, v)"
        />
        <el-input
          v-else
          :model-value="textVal(col.dataIndex)"
          :placeholder="col.tips"
          :disabled="col.readonly"
          @update:model-value="(v: string) => setVal(col.dataIndex, v)"
        />
      </el-descriptions-item>
    </el-descriptions>

    <template #footer>
      <el-button @click="closeDialog">取消</el-button>
      <el-button type="primary" :loading="loading" @click="onSubmit">保存</el-button>
    </template>

    <SourceCronDialog v-model="cronOpen" :cron="textVal(cronKey)" @submit="onCronSubmit" />
  </el-dialog>
</template>

<style scoped>
/* 旧 a-descriptions size="small"：格子紧凑、label 灰字 */
.de-desc :deep(.el-descriptions__label) {
  width: 120px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.de-desc :deep(.el-descriptions__cell) {
  padding: 4px 8px;
}
</style>
