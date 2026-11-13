<script setup lang="ts">
// 新增 / 编辑队列校验配置 —— 1:1 迁移旧 data-view `src/page/config/modules/BaseEdit.vue`
// （QueueCheck.vue 里那两个 `<base-edit-modal ref="baseEdit|baseAdd">`）。
//
// 旧版行为逐条对齐：
//   · 表单体是「列定义驱动的描述表」：`a-descriptions bordered :column="4"`，每项占 `col.span` 格
//     （MQ_CHECK 的列 span 都是 2 或 4 → 半行 / 整行），label 右侧可带 tips 问号提示。
//   · 打开时（doEdit）先把**每个字段**置 null，再 `Object.assign(form, record)`——
//     所以编辑态提交体里除了表单字段，还带着记录上那些不在列里的原始字段（queueId / state /
//     lastMsg / lastRun / nextRun / createDt / updateDt …），由 addCallback / updateCallback 口径再删。
//   · 新增态（handleAdd）预填 `{ queueName: 查询框里的队列名, isDelete: 0 }`，其余字段按列定义置 null。
//   · 控件类型走旧 item.type：INT_BOOL → 是(1)/否(0) 下拉；缺省是普通文本输入。
//
// 有意偏差（都在交付说明里单列）：
//   1. 提交由本组件直接调 addQueueCheck / updateQueueCheck（旧版把回调抛给父组件 QueueCheck.vue 再调接口），
//      字段剔除口径不变，见 buildPayload。
//   2. 弹窗宽度：旧版 `document.body.clientWidth - 300`，这里用等价的 `calc(100vw - 300px)`，
//      省掉手动挂 resize 监听。
//   3. 模板里没有用 `v-model="form[key]"`：form 是动态键（`Record<string, unknown>`），直接 v-model
//      过不了 vue-tsc 的类型检查，改用 `:model-value` + `@update:model-value` 等价接线。
//   4. 列 label 后的问号：旧 BaseEdit 的判据是 `item.more`，而 MQ_CHECK 的列只配了 `tips`
//      （旧版 tips 仅当 input 的 placeholder 用）→ 旧弹窗里其实一个问号都不显示。
//      这里把 tips 同时用作 placeholder 与问号提示，属于信息增强，不改变提交内容。
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { addQueueCheck, updateQueueCheck } from '@/api/queueCheck'
import type { MqCheck } from '@/api'
import { addColumns, editColumns, type QueueColumn } from './columns'

defineOptions({ name: 'QueueEditDialog' })

const emit = defineEmits<{ (e: 'saved'): void }>()

const open = ref(false)
const loading = ref(false)
const isEdit = ref(false)
/** 旧：编辑弹窗 title 默认「编辑」，新增弹窗写死「新增数据」 */
const title = computed(() => (isEdit.value ? '编辑' : '新增数据'))

/** 当前列集：编辑 → editCols，新增 → addCols（旧 QueueCheck 的两个 computed） */
const columns = computed<QueueColumn[]>(() => (isEdit.value ? editColumns() : addColumns()))

const form = reactive<Record<string, unknown>>({})
/** 编辑时记录上「不属于任何列」的原样带回字段（旧 Object.assign(this.form, record) 的效果） */
const extra = ref<Record<string, unknown>>({})

/** 旧 doEdit：先按列把表单字段全部置 null（`this.$set(this.form, k.dataIndex, null)`） */
function resetForm() {
  Object.keys(form).forEach((key) => delete form[key])
  columns.value.forEach((col) => {
    form[col.dataIndex] = null
  })
}

const textVal = (key: string): string => (form[key] == null ? '' : String(form[key]))
function setVal(key: string, value: unknown) {
  form[key] = value
}

/**
 * 打开弹窗。
 * @param record  编辑态传原始行；不传 = 新增
 * @param prefill 新增态的预填字段（对应旧 `handleAdd` 里的 `param`）
 */
function openDialog(record?: MqCheck | null, prefill?: Record<string, unknown>) {
  isEdit.value = !!record
  const source = (record ?? {}) as Record<string, unknown>
  // 列里没有的字段原样带回（编辑态才有；新增态没有记录 → 空）
  const columnKeys = new Set(columns.value.map((c) => c.dataIndex))
  const rest: Record<string, unknown> = {}
  Object.keys(source).forEach((key) => {
    if (!columnKeys.has(key)) rest[key] = source[key]
  })
  extra.value = rest

  resetForm()
  Object.assign(form, source, prefill ?? {})
  open.value = true
}

function closeDialog() {
  open.value = false
  extra.value = {}
  resetForm()
}

/** 旧 addCallback / updateCallback 的字段剔除口径 */
function buildPayload(): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...extra.value, ...form }
  delete payload.createDt
  delete payload.updateDt
  if (isEdit.value) {
    delete payload.lastRun
    delete payload.nextRun
  }
  return payload
}

async function onSubmit() {
  // 旧版确实没做前端必填拦截：BaseEdit 把 `:rules="{required:true}"` 挂在 <a-input> 上，而
  // a-form-model 的 validate() 只收集 a-form-model-item 包裹的控件——那个模板里根本没有
  // a-form-model-item（只有 a-descriptions-item），所以 `validate(valid => ...)` 的结果恒为 true。
  // 这里保持同样的「交给后端兜底」口径，不新增拦截。
  const payload = buildPayload()
  loading.value = true
  try {
    if (isEdit.value) {
      await updateQueueCheck(payload)
    } else {
      await addQueueCheck(payload)
    }
    ElMessage.success('保存成功')
    emit('saved')
    closeDialog()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    loading.value = false
  }
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
    @close="closeDialog"
  >
    <el-form :model="form" label-position="right" @submit.prevent>
      <!-- 旧 a-descriptions bordered size="small" :column="4" -->
      <el-descriptions border :column="4" size="small" class="qe-desc">
        <el-descriptions-item
          v-for="col in columns"
          :key="col.dataIndex"
          :span="col.span ?? 2"
          :label="col.title"
        >
          <template v-if="col.tips" #label>
            <span class="qe-label">
              {{ col.title }}
              <el-tooltip :content="col.tips" placement="top-start">
                <span class="qe-tip">?</span>
              </el-tooltip>
            </span>
          </template>

          <!-- 旧 BaseEdit 的控件分支：按 MQ_CHECK 实际用得到的类型保留 -->
          <el-select
            v-if="col.type === 'INT_BOOL'"
            :model-value="form[col.dataIndex]"
            class="qe-ctl"
            @update:model-value="(v: unknown) => setVal(col.dataIndex, v)"
          >
            <el-option :value="1" label="是 (1)" />
            <el-option :value="0" label="否 (0)" />
          </el-select>
          <el-input
            v-else-if="col.type === 'textArea'"
            :model-value="textVal(col.dataIndex)"
            type="textarea"
            :rows="3"
            @update:model-value="(v: string) => setVal(col.dataIndex, v)"
          />
          <span v-else-if="col.type === 'span'" class="qe-span">{{ form[col.dataIndex] }}</span>
          <el-checkbox
            v-else-if="col.type === 'checkbox'"
            :model-value="!!form[col.dataIndex]"
            @update:model-value="(v: string | number | boolean) => setVal(col.dataIndex, !!v)"
          />
          <el-select
            v-else-if="col.type === 'SELECT'"
            :model-value="form[col.dataIndex]"
            class="qe-ctl"
            @update:model-value="(v: unknown) => setVal(col.dataIndex, v)"
          >
            <el-option v-for="opt in col.values ?? []" :key="String(opt.value)" :label="opt.text" :value="opt.value" />
          </el-select>
          <el-input
            v-else
            :model-value="textVal(col.dataIndex)"
            class="qe-ctl"
            :placeholder="col.tips"
            @update:model-value="(v: string) => setVal(col.dataIndex, v)"
          />
        </el-descriptions-item>
      </el-descriptions>
    </el-form>

    <template #footer>
      <el-button @click="closeDialog">取消</el-button>
      <el-button type="primary" :loading="loading" @click="onSubmit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 旧 a-descriptions size="small"：格子紧凑、label 灰字 */
.qe-desc :deep(.el-descriptions__label) {
  width: 120px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.qe-desc :deep(.el-descriptions__cell) {
  padding: 4px 8px;
}
.qe-ctl {
  width: 100%;
}
.qe-span {
  display: inline-block;
  padding: 0 4px;
  color: var(--rc-text, #0f172a);
}
.qe-label {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.qe-tip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border: 1px solid var(--rc-faint, #94a3b8);
  border-radius: 50%;
  color: var(--rc-faint, #94a3b8);
  font-size: 10px;
  line-height: 1;
  cursor: help;
}
</style>
