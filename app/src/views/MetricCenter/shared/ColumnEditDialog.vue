<script setup lang="ts">
// 列驱动的表单弹窗 —— 1:1 迁移旧 data-view `src/page/config/modules/BaseEdit.vue`。
//
// 旧形态：`a-modal` + `a-descriptions bordered :column="4"`（每项占 `col.span` 格）+ 底部「确定 / 取消」，
// 表单内容由 `:cols` 完全驱动，同一个组件被「指标列表」「指标结果」「分类树」三处复用（只换 cols）。
//
// 旧版行为逐条对齐：
//   · 打开时（doEdit）先把**每个列字段**置 null，再 `Object.assign(form, record)`——
//     所以提交体里除了表单字段，还带着记录上那些不在列里的原始字段（measureId / updateDt / …），
//     由调用方在 callback 里按各自的旧 updateCallback 口径再删（旧 MeasureList 删 updateDt）。
//   · `type === 'json'` 的字段：加载时 prettyJson 缩进展开、提交前 compactJsonFields 校验并压缩，
//     非法 JSON 直接报错拦下（这条是旧版真实生效的校验，见 utils/jsonField.js）。
//   · `type === 'cron'` 走「输入框 + 配定时按钮」，图形编辑器复用 Monitor/sourceCheck 已迁移的
//     `SourceCronDialog.vue`（Monitor 组件允许跨文件夹引用，与 indicatorDataset/DatasetEditDialog 同口径）。
//   · `type === 'textArea' / 'span' / 'checkbox' / 'SELECT' / 'INT_BOOL' / 'TAGS'` 按旧分支实现。
//   · 弹窗宽度：旧版 `document.body.clientWidth - 300`，这里用等价的 `calc(100vw - 300px)`。
//
// 有意偏差：
//   1. 旧版确实**没有前端必填拦截**：BaseEdit 把 `:rules="{required:true}"` 挂在 `<a-input>` 上，
//      而 `a-form-model.validate()` 只收集 `a-form-model-item` 包裹的控件——模板里根本没有
//      a-form-model-item（只有 a-descriptions-item），所以 `validate(valid => ...)` 恒为 true。
//      这里保持「交给后端兜底」的口径，不新增拦截。
//   2. 旧版支持 6 个**远程下拉/子编辑器**分支（CONFIG / FLOW_ID / CATEGORY / ENTRY_TYPE / SOURCE_TYPE，
//      以及 CategoryInput 那个异步组件）。指标列表与指标结果用到的列集里一个都没有（已逐列核对
//      MEASURE / ENTRY_DETAIL / SOURCE 三组配置），所以这里把它们统一降级成普通输入框并在
//      控制台留一条告警；哪天真加了这类列，不会静默变成一个不能选的空文本框。
//   3. 旧的 `slot="label"`（标题 + 问号 tooltip）用 el-descriptions 的 `#label` 插槽等价替代。
//   4. 旧版「双击输入框」也会打开定时编辑器（且把表达式的值误当 key 传给 showCron，是旧代码 bug），
//      这里不复制该 bug，双击与按钮都按当前值打开。
import { reactive, ref } from 'vue'
import { ElMessage, ElNotification } from 'element-plus'
import { QuestionFilled } from '@element-plus/icons-vue'
import SourceCronDialog from '@/views/Monitor/sourceCheck/SourceCronDialog.vue'
import type { ColumnDef } from './types'
import { compactJsonFields, prettyJson } from './jsonDef'

defineOptions({ name: 'ColumnEditDialog' })

const props = withDefaults(defineProps<{
  /** 列定义（旧 `:cols`） */
  cols: ColumnDef[]
  /** 标题（旧 `title`，默认「编辑」） */
  title?: string
  /** 提交回调（旧 `callback`）。返回 Promise 表示提交请求；返回 `{cancelled:true}` 表示不提交 */
  callback?: (form: Record<string, unknown>) => Promise<unknown> | { cancelled: boolean } | undefined
  /** 快捷操作按钮（旧 `buttons`，本页两处页面都没用到） */
  buttons?: { name: string; type?: string; callback: () => void }[]
}>(), {
  title: '编辑',
  callback: undefined,
  buttons: () => [],
})

const emit = defineEmits<{ (e: 'refresh'): void }>()

const visible = ref(false)
const confirmLoading = ref(false)
const form = reactive<Record<string, unknown>>({})
const remark = ref<string | undefined>(undefined)
/** 弹窗宽度：旧版按 `document.body.clientWidth - 300` 算，等价写成 CSS */
const width = 'calc(100vw - 300px)'

/** 已经告警过的列类型，避免同一列每次渲染都刷控制台 */
const warned = new Set<string>()
function warnUnsupported(col: ColumnDef) {
  if (warned.has(col.dataIndex)) return
  warned.add(col.dataIndex)
  console.warn(`[ColumnEditDialog] 列「${col.title}」用了 ${String(col.type)} 类型的远程下拉，已降级为普通输入框（本页列集不含该类型）`)
}

function open(data: Record<string, unknown>, tip?: string) {
  // 旧 doEdit：先清空所有列字段，再整体合并记录
  for (const key of Object.keys(form)) delete form[key]
  props.cols.forEach((col) => { form[col.dataIndex] = null })
  // json 字段加载时格式化成缩进形式，方便阅读与修改
  const copy: Record<string, unknown> = { ...data }
  props.cols.filter((col) => col.type === 'json').forEach((col) => {
    copy[col.dataIndex] = prettyJson(copy[col.dataIndex])
  })
  Object.assign(form, copy)
  remark.value = tip
  visible.value = true
}

function close() {
  visible.value = false
}

function onInput(col: ColumnDef, value: unknown) {
  form[col.dataIndex] = value
}

async function onSubmit() {
  // json 字段：保存前校验合法性，合法则压缩存储
  const jsonErr = compactJsonFields(props.cols, form)
  if (jsonErr) {
    ElNotification.error({ message: jsonErr })
    return
  }
  const ret = props.callback?.(form)
  if (ret && typeof ret === 'object' && 'cancelled' in ret && ret.cancelled) return
  if (ret && typeof (ret as Promise<unknown>).then === 'function') {
    confirmLoading.value = true
    try {
      await ret
      ElNotification.success({ message: '修改成功!' })
      visible.value = false
      emit('refresh')
    } catch (err) {
      ElNotification.error({ message: `提交修改失败${err instanceof Error ? err.message : String(err)}` })
    } finally {
      confirmLoading.value = false
    }
    return
  }
  // 没有回调（旧版 jsonEditDim / jsonEditVal 就是这个形态：`<base-edit-modal :cols="...">` 不传 callback）
  // —— 旧版这时既不关弹窗也不提示，等价于「点了没反应」。这里给一条明确提示，不做静默。
  ElMessage.warning('该弹窗未绑定提交回调，内容不会保存')
}

/* 定时（type === 'cron'）：旧版 curKey 记当前列，saveCron 回写 */
const cronVisible = ref(false)
const cronKey = ref<string>('')
function openCron(key: string) {
  cronKey.value = key
  cronVisible.value = true
}
function onCronSubmit(cron: string) {
  form[cronKey.value] = cron
  cronVisible.value = false
}

defineExpose({ open })
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    :width="width"
    destroy-on-close
    class-name="rc-dialog ced-dialog"
    :close-on-click-modal="false"
  >
    <div v-if="buttons.length" class="ced-quick">
      <span>快捷操作：</span>
      <el-button
        v-for="(item, index) in buttons"
        :key="index"
        size="small"
        style="margin-left: 12px"
        @click="item.callback"
      >{{ item.name }}</el-button>
    </div>

    <el-descriptions :column="4" border size="small">
      <el-descriptions-item v-for="col in cols" :key="col.dataIndex" :span="col.span">
        <template #label>
          <span>{{ col.title }}</span>
          <el-tooltip v-if="col.more" placement="top" :content="col.more">
            <el-icon class="ced-question"><QuestionFilled /></el-icon>
          </el-tooltip>
        </template>

        <!-- 定时（cron）：输入框 + 配定时 -->
        <el-input
          v-if="col.type === 'cron'"
          :model-value="String(form[col.dataIndex] ?? '')"
          placeholder="请生成cron表达式"
          @update:model-value="(v: string) => onInput(col, v)"
        >
          <template #append>
            <el-button @click="openCron(col.dataIndex)">配定时</el-button>
          </template>
        </el-input>

        <el-input
          v-else-if="col.type === 'textArea'"
          :model-value="String(form[col.dataIndex] ?? '')"
          type="textarea"
          :rows="4"
          @update:model-value="(v: string) => onInput(col, v)"
        />

        <div v-else-if="col.type === 'span'" class="ced-span">{{ form[col.dataIndex] }}</div>

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

        <el-input
          v-else-if="col.type === 'json'"
          :model-value="String(form[col.dataIndex] ?? '')"
          type="textarea"
          :rows="8"
          @update:model-value="(v: string) => onInput(col, v)"
        />

        <!-- TAGS：旧 a-select mode="tags" + tokenSeparators [';','；',',','，']，options 是预置标签 -->
        <el-select
          v-else-if="col.type === 'TAGS'"
          multiple
          filterable
          allow-create
          default-first-option
          style="width: 100%"
          :reserve-keyword="false"
          :placeholder="col.tips || '输入标签后回车添加，多个以 ; 分隔'"
          :model-value="(form[col.dataIndex] as never) ?? []"
          @update:model-value="(v: unknown) => onInput(col, v)"
        >
          <el-option v-for="t in (col.values ?? [])" :key="String(t.value)" :value="t.value" :label="t.text" />
        </el-select>

        <!-- CONFIG / FLOW_ID / CATEGORY / ENTRY_TYPE / SOURCE_TYPE：本页列集不含，降级为输入框 -->
        <el-input
          v-else-if="col.type && ['CONFIG', 'FLOW_ID', 'CATEGORY', 'ENTRY_TYPE', 'SOURCE_TYPE'].includes(col.type)"
          :model-value="String(form[col.dataIndex] ?? '')"
          :disabled="col.readonly"
          @update:model-value="(v: string) => onInput(col, v)"
          @vue:mounted="warnUnsupported(col)"
        />

        <el-input
          v-else
          :model-value="String(form[col.dataIndex] ?? '')"
          :placeholder="col.tips"
          :disabled="col.readonly"
          @update:model-value="(v: string) => onInput(col, v)"
        />
      </el-descriptions-item>
    </el-descriptions>

    <template v-if="remark">
      <el-divider />
      <div class="ced-remark">
        <h4>说明</h4>
        <span>{{ remark }}</span>
      </div>
    </template>

    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :loading="confirmLoading" @click="onSubmit">确定</el-button>
    </template>

    <!-- 定时编辑器（旧版是 <source-cron ref="cronModal" :callback="saveCron">） -->
    <SourceCronDialog v-model="cronVisible" :cron="String(form[cronKey] ?? '')" @submit="onCronSubmit" />
  </el-dialog>
</template>

<style scoped>
.ced-quick {
  margin-bottom: 12px;
  font-size: 13px;
  color: #606266;
}
.ced-question {
  margin-left: 4px;
  color: #909399;
  vertical-align: -2px;
}
.ced-span {
  text-align: center;
}
.ced-remark {
  padding: 0 10px;
  color: rgba(0, 0, 0, 0.45);
}
.ced-remark h4 {
  margin: 0 0 4px;
  font-size: 12px;
}
</style>
