<script setup lang="ts">
// JSON 子表单弹窗 —— 1:1 迁移旧 data-view `src/page/config/modules/JsonSub.vue`。
//
// 旧形态：`a-modal`（宽 1200）+ `a-descriptions bordered :column="4"`，由 `:cols` 驱动。
// 与 BaseEdit 的区别就三点，迁移时保持：
//   1. `doEdit(data, remark, callback)` 的第三个参数是**回调**（BaseEdit 是提交前固定调一次 props.callback）；
//      回调返回真值才关弹窗（`if (ret) this.visible = false`）。
//   2. 多一个 `entryCols` prop：`type === 'ENTRY_COLUMNS'` 的列渲染成下拉，候选是「数据集的列」
//      （选项文案 `value - name`，即「列名 - 字段名」）。
//   3. `type === 'int'` 渲染成数字输入框（BaseEdit 没有这个分支）。
// 它被「增加指标」（旧 MeasureAdd）与「指标-新」（旧 MeasureAddNew）用来编辑 指标纬度 / 指标值 JSON。
//
// 有意偏差：
//   1. 调用方（旧 MeasureAdd.handleEditJson）里是裸 `JSON.parse(text)`，字段为空串时会抛
//      SyntaxError、弹窗直接打不开（旧版 placeholder 描述的初始态就是空）。这里由调用方把
//      空值归一成 `{}` 再传进来，非空的非法 JSON 仍然原样抛——不静默吞掉真实的格式错误。
//   2. 旧版同样**没有前端必填拦截**（`a-form-model.validate` 收不到这些控件的 rules），
//      这里保持一致，交给后端兜底。
//   3. `CONFIG` / `ENTRY_TYPE` 两个远程下拉分支降级为普通输入框并留控制台告警：
//      MEASURE.json_dim / json_val 的列集里没有这两个类型（已逐列核对）。
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { ColumnDef } from './types'

defineOptions({ name: 'JsonDefDialog' })

const props = withDefaults(defineProps<{
  /** 列定义（旧 `:cols`） */
  cols: ColumnDef[]
  /** 数据集可选列（旧 `:entryCols`，`[{value, name}]`） */
  entryCols?: { value: string; name: string }[]
  /** 标题（旧 `title`，默认「JSON编辑生成」） */
  title?: string
}>(), {
  entryCols: () => [],
  title: 'JSON编辑生成',
})

const visible = ref(false)
const form = reactive<Record<string, unknown>>({})
const remark = ref<string | undefined>(undefined)
let callback: ((form: Record<string, unknown>) => unknown) | undefined

const warned = new Set<string>()
function warnUnsupported(col: ColumnDef) {
  if (warned.has(col.dataIndex)) return
  warned.add(col.dataIndex)
  console.warn(`[JsonDefDialog] 列「${col.title}」用了 ${String(col.type)} 类型的远程下拉，已降级为普通输入框（本列集不含该类型）`)
}

function open(data: Record<string, unknown>, tip?: string, cb?: (form: Record<string, unknown>) => unknown) {
  for (const key of Object.keys(form)) delete form[key]
  props.cols.forEach((col) => { form[col.dataIndex] = null })
  Object.assign(form, data)
  remark.value = tip
  callback = cb
  visible.value = true
}

function close() {
  visible.value = false
}

function onInput(col: ColumnDef, value: unknown) {
  form[col.dataIndex] = value
}

function onSubmit() {
  if (!callback) {
    ElMessage.warning('该弹窗未绑定回调，内容不会回写')
    return
  }
  const ret = callback(form)
  if (ret) visible.value = false
}

defineExpose({ open })
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="1200px"
    destroy-on-close
    class-name="rc-dialog jdd-dialog"
    :close-on-click-modal="false"
  >
    <el-descriptions :column="4" border size="small">
      <el-descriptions-item v-for="col in cols" :key="col.dataIndex" :label="col.title" :span="col.span">
        <el-input
          v-if="col.type === 'textArea'"
          :model-value="String(form[col.dataIndex] ?? '')"
          type="textarea"
          @update:model-value="(v: string) => onInput(col, v)"
        />

        <div v-else-if="col.type === 'span'" class="jdd-span">{{ form[col.dataIndex] }}</div>

        <el-checkbox
          v-else-if="col.type === 'checkbox'"
          :model-value="Boolean(form[col.dataIndex])"
          @update:model-value="(v: boolean | string | number) => onInput(col, Boolean(v))"
        />

        <el-select
          v-else-if="col.type === 'INT_BOOL'"
          :model-value="form[col.dataIndex] as never"
          @update:model-value="(v: unknown) => onInput(col, v)"
        >
          <el-option :value="1" label="是 (1)" />
          <el-option :value="0" label="否 (0)" />
        </el-select>

        <el-select
          v-else-if="col.type === 'SELECT'"
          :model-value="form[col.dataIndex] as never"
          @update:model-value="(v: unknown) => onInput(col, v)"
        >
          <el-option v-for="(opt, i) in col.values" :key="i" :value="opt.value" :label="opt.text" />
        </el-select>

        <!-- ENTRY_COLUMNS：候选是数据集的列，文案「列名 - 字段名」 -->
        <el-select
          v-else-if="col.type === 'ENTRY_COLUMNS'"
          :model-value="form[col.dataIndex] as never"
          @update:model-value="(v: unknown) => onInput(col, v)"
        >
          <el-option v-for="(opt, i) in entryCols" :key="i" :value="opt.value" :label="`${opt.value} - ${opt.name}`" />
        </el-select>

        <el-input
          v-else-if="col.type === 'int'"
          :model-value="String(form[col.dataIndex] ?? '')"
          type="number"
          @update:model-value="(v: string) => onInput(col, v === '' ? null : Number(v))"
        />

        <el-input
          v-else-if="col.type && ['CONFIG', 'ENTRY_TYPE'].includes(col.type)"
          :model-value="String(form[col.dataIndex] ?? '')"
          @update:model-value="(v: string) => onInput(col, v)"
          @vue:mounted="warnUnsupported(col)"
        />

        <el-input
          v-else
          :model-value="String(form[col.dataIndex] ?? '')"
          :placeholder="col.tips"
          @update:model-value="(v: string) => onInput(col, v)"
        />
      </el-descriptions-item>
    </el-descriptions>

    <template v-if="remark">
      <el-divider />
      <div class="jdd-remark">
        <h4>说明</h4>
        <span>{{ remark }}</span>
      </div>
    </template>

    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" @click="onSubmit">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.jdd-span {
  text-align: center;
}
.jdd-remark {
  padding: 0 10px;
  color: rgba(0, 0, 0, 0.45);
}
.jdd-remark h4 {
  margin: 0 0 4px;
  font-size: 12px;
}
</style>
