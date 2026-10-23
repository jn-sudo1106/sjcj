<script setup lang="ts">
// 「增加指标」抽屉 —— 1:1 迁移旧 data-view `src/page/base/measure/MeasureAdd.vue`。
//
// 入口：旧 DatasetList 的「增加指标」按钮 → `$refs.addMeasure.doEdit(sourceId, record, entryTypeId)`。
// 新平台由 indicatorDataset **原地**打开本组件（不再跳「指标列表」页签），
// 见 `../indicatorDataset/index.vue` 的 handleAddMeasure 与模板里的 `<MeasureAddDialog ref="addMeasureRef" />`。
//
// 旧形态（AntDV）：`a-drawer` width 900、**非模态**（`:mask="false"` + `:maskClosable="false"`）
// + `a-form-model`：顶部两枚蓝色 tag（源ID / 数据集）+「加载指标配置样例」按钮，
// 下面 指标编码 / 指标名称 / 条件表达式 / 日期纬度 / 指标值1 / 指标值2 / 单位 七个字段，
// 后四个字段是 `a-input-search`：输入框直接编辑 + 右侧「编辑…-JSON」按钮打开 JsonSub 子编辑器。
// 底部 Create / Cancel（**在内容区里**，不是抽屉 footer）。
//
// 逐条对齐的旧行为：
//   · doEdit 先把 form 重置成 10 个空字段，再 `Object.assign(form, record)` —— 所以提交体里
//     除了这 10 个字段，还带着数据集记录上的其余字段（datasetId / datasetName / entryTypeId /
//     enable / measureCnt / lastId …）。这是旧版真实发出的请求体，照抄。
//   · dataCols 来自 `queryEntryType(entryTypeId)`，给 JsonSub 的 ENTRY_COLUMNS 下拉当候选
//     （文案「列名 - 字段名」）。新平台对应 `dataApi.tableMeta` + `fields`，
//     映射 `columnName / itemName(→desc)`（见 api/legacyAdapters.ts 的 entryTypeToLegacy：
//     itemName 就是 field.desc，两者互为逆映射）。
//   · handleLoadOne：拉最新一条指标当样例，删掉 measureId / updateDt / datasetId / sourceId，
//     再把 measureCode 自增一位（`A00011` → `A00012`）。
//   · handleSubmit：旧版**没有前端必填拦截**（rules 挂在 a-input 上、validate() 收不到），
//     提交后立刻关抽屉（在 then 之前就 `this.visible = false`）；错误里含 `Duplicate entry`
//     时换成「【指标编码重复,请检查】」文案。三条都保留。
//
// 有意偏差：
//   1. `queryEntryType` 返回的 `res.data` → 新版 `dataApi.tableMeta` 直接返回扁平记录
//      （响应体里没有 curEntryType 包装层），取值口径见上。
//   2. 旧版 `JSON.parse(form[key])` 是裸调用：字段为空串（初始态就是空）时抛 SyntaxError、
//      JsonSub 打不开。这里由调用方把空值归一成 `{}` 再传（非空非法 JSON 仍原样报错）。
//   3. `JSON.stringify(out, replaceNull)` 里 replaceNull 把 null 变成 undefined（= 该键被剔除）
//      的写法保留；`int` 类型列改成存数字（见 shared/JsonDefDialog.vue 头注）。
//   4. 提示：`$notification.success` → `ElNotification.success`；失败文案同样保留
//      `失败:` 前缀（旧版这里是自己拼的，不像 confirmDanger 那样统一）。
import { reactive, ref } from 'vue'
import { ElMessage, ElNotification } from 'element-plus'
import { dataApi } from '@/api'
import { addMeasure, measurePaged, type MeasureRow } from '@/api/measure'
import JsonDefDialog from '../shared/JsonDefDialog.vue'
import { MEASURE_JSON_DIM, MEASURE_JSON_VAL } from './columns'

defineOptions({ name: 'MeasureAddDialog' })

const emit = defineEmits<{ (e: 'saved'): void }>()

const visible = ref(false)
const submitting = ref(false)
const curSource = ref<string | number>('')
const entryTypeId = ref<string>('')
const datasetName = ref<string | undefined>(undefined)
/** JsonSub 的 ENTRY_COLUMNS 候选：{value: columnName, name: itemName(desc)} */
const dataCols = ref<{ value: string; name: string }[]>([])

/** 旧 form 的 10 个字段。带索引签名：`doEdit` 里 `Object.assign(form, record)` 会把数据集
 *  记录上的其余字段（datasetName / entryTypeId / enable / measureCnt …）也一并带进提交体。 */
interface MeasureForm {
  measureCode: string | null
  measureName: string | null
  measureType: string | null
  sourceId: string | number | null
  datasetId: string | number | null
  keyDef: string | null
  dimDef: string | null
  val1Def: string | null
  val2Def: string | null
  unitDef: string | null
  [key: string]: unknown
}

function blankForm(): MeasureForm {
  return {
    measureCode: null,
    measureName: null,
    measureType: null,
    sourceId: null,
    datasetId: null,
    keyDef: null,
    dimDef: null,
    val1Def: null,
    val2Def: null,
    unitDef: null,
  }
}

const form = reactive<MeasureForm>(blankForm())

/** 表单回写。模板里用 `:model-value` + 这个函数而不是 `v-model`：
 *  字段初值是 null（旧版就是 null，提交体里也照发 null），而 el-input 的 modelValue 只收
 *  string | number，直接 v-model 会带上 null 的类型。 */
function setField(key: string, value: unknown) {
  form[key] = value
}

const jsonDimRef = ref<InstanceType<typeof JsonDefDialog>>()
const jsonValRef = ref<InstanceType<typeof JsonDefDialog>>()

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** 旧 loadEntryType：拉表结构，装出 ENTRY_COLUMNS 下拉的候选列 */
async function loadEntryType(id: string) {
  if (!id) {
    dataCols.value = []
    return
  }
  try {
    const meta = await dataApi.tableMeta(id)
    dataCols.value = (meta?.fields ?? []).map((field) => ({
      value: String(field.columnName ?? ''),
      name: field.desc,
    }))
  } catch {
    ElNotification.error({ message: '获取信息失败' })
  }
}

/** 旧 doEdit(sourceId, record, entryTypeId)。
 *  三个入参都收 null/undefined：旧 DatasetList 传的是 `curRecord.sourceId`（数据集记录上该字段可能为空），
 *  旧 doEdit 也只是原样收下。 */
async function open(
  sourceId: string | number | null | undefined,
  record: Record<string, unknown>,
  id?: string | number | null,
) {
  curSource.value = sourceId ?? ''
  entryTypeId.value = id == null ? '' : String(id)
  datasetName.value = record?.datasetName == null ? undefined : String(record.datasetName)
  for (const key of Object.keys(form)) delete form[key]
  Object.assign(form, blankForm())
  Object.assign(form, record ?? {})
  visible.value = true
  void loadEntryType(entryTypeId.value)
}

/** 旧 handleLoadOne：拿最新一条指标当样例；编码自增一位，去掉主键与数据集相关字段 */
async function handleLoadOne() {
  try {
    const res = await measurePaged({ pageNo: 1, pageSize: 1 })
    const last = (res.list ?? [])[0] as MeasureRow | undefined
    if (!last) {
      ElMessage.warning('没有可参考的指标样例')
      return
    }
    const copy: Record<string, unknown> = { ...last }
    // 旧版删这四个（measureCnt 等其余字段保留 —— 数据集记录的键本来也不在这条样例上）
    delete copy.measureId
    delete copy.updateDt
    delete copy.datasetId
    delete copy.sourceId
    Object.assign(form, copy)
    const lastCode = String(last.measureCode ?? '')
    if (lastCode.length > 1) {
      form.measureCode = lastCode.substring(0, 1) + (parseInt(lastCode.substring(1), 10) + 1)
    }
  } catch (err) {
    ElNotification.error({ message: '加载样例失败:' + errText(err) })
  }
}

/** 旧 handleEditJson(key, date)：date=true → json_val 列集（数值类）；false → json_dim（日期类） */
function handleEditJson(key: string, date: boolean) {
  const raw = String(form[key] ?? '').trim()
  let obj: unknown = {}
  if (raw) {
    try {
      obj = JSON.parse(raw)
    } catch (err) {
      ElMessage.error(`「${key}」不是合法的 JSON，无法打开编辑器：${errText(err)}`)
      return
    }
  }
  // 旧版 replaceNull：把 null 变 undefined → JSON.stringify 会剔除该键
  const replaceNull = (_k: string, value: unknown) => (value == null ? undefined : value)
  const write = (out: Record<string, unknown>) => {
    form[key] = JSON.stringify(out, replaceNull)
    return true
  }
  if (date) {
    jsonValRef.value?.open((obj ?? {}) as Record<string, unknown>, 'json编辑-数值类', write)
  } else {
    jsonDimRef.value?.open(
      (obj ?? {}) as Record<string, unknown>,
      '1. 例: from=30, to=3参数表示每次仅处理当天 30天前-3天前 时间段的数据',
      write,
    )
  }
}

/** 旧 handleSubmit：addMeasure(form) → 立刻关抽屉 */
async function handleSubmit() {
  submitting.value = true
  try {
    const res = (await addMeasure({ ...form })) as { msg?: string; message?: string }
    ElNotification.success({ message: '增加指标成功,' + String(res?.msg ?? res?.message ?? '') })
    visible.value = false
    emit('saved')
  } catch (err) {
    const msg = String(errText(err))
    const text = msg.includes('Duplicate entry') ? '【指标编码重复,请检查】:\n' + msg : msg
    ElNotification.error({ message: '失败:' + text })
  } finally {
    submitting.value = false
  }
}

function handleCancel() {
  visible.value = false
  emit('saved')
}

defineExpose({ open })
</script>

<template>
  <el-drawer
    v-model="visible"
    direction="rtl"
    size="900px"
    :modal="false"
    :close-on-click-modal="false"
    :destroy-on-close="true"
    class-name="mad-drawer"
  >
    <div class="mad-head">
      <el-tag type="primary" size="large">源ID: {{ form.sourceId }}</el-tag>
      <el-tag type="primary" size="large">数据集: {{ form.datasetId }} - {{ datasetName }}</el-tag>
      <span class="mad-head-gap" />
      <el-button type="primary" @click="handleLoadOne">加载指标配置样例</el-button>
    </div>

    <el-form label-width="90px" class="mad-form">
      <el-form-item label="指标编码">
        <el-input
          :model-value="String(form.measureCode ?? '')"
          placeholder="如: A00011, 一般全局唯一"
          @update:model-value="(v: string) => setField('measureCode', v)"
        />
      </el-form-item>

      <el-form-item label="指标名称">
        <el-input
          :model-value="String(form.measureName ?? '')"
          placeholder="指标名称"
          @update:model-value="(v: string) => setField('measureName', v)"
        />
      </el-form-item>

      <el-form-item label="条件表达式">
        <el-input
          :model-value="String(form.keyDef ?? '')"
          placeholder="匹配数据集相关字段条件,如 string.contains(K4, '环比涨跌') && K1 =='沈阳'"
          @update:model-value="(v: string) => setField('keyDef', v)"
        />
      </el-form-item>

      <el-form-item label="日期纬度">
        <el-input
          :model-value="String(form.dimDef ?? '')"
          placeholder='一般为date，如 {"cols":"K2","type":"date","clearRule":""}'
          @update:model-value="(v: string) => setField('dimDef', v)"
          @keyup.enter="handleEditJson('dimDef', false)"
        >
          <template #append>
            <el-button class="mad-json-btn" @click="handleEditJson('dimDef', false)">编辑日期纬度-JSON</el-button>
          </template>
        </el-input>
      </el-form-item>

      <el-form-item label="指标值1">
        <el-input
          :model-value="String(form.val1Def ?? '')"
          placeholder='一般为num，如 {"cols":"K3","type":"num","clearRule":""}'
          @update:model-value="(v: string) => setField('val1Def', v)"
          @keyup.enter="handleEditJson('val1Def', true)"
        >
          <template #append>
            <el-button class="mad-json-btn" @click="handleEditJson('val1Def', true)">编辑指标值1-JSON</el-button>
          </template>
        </el-input>
      </el-form-item>

      <el-form-item label="指标值2">
        <el-input
          :model-value="String(form.val2Def ?? '')"
          placeholder='范围型指标值，可能会有值1值2，一般为num，如 {"cols":"K4","type":"num","clearRule":""}'
          @update:model-value="(v: string) => setField('val2Def', v)"
          @keyup.enter="handleEditJson('val2Def', true)"
        >
          <template #append>
            <el-button class="mad-json-btn" @click="handleEditJson('val2Def', true)">编辑指标值2-JSON</el-button>
          </template>
        </el-input>
      </el-form-item>

      <el-form-item label="单位">
        <el-input
          :model-value="String(form.unitDef ?? '')"
          placeholder="单位（量纲）取值"
          @update:model-value="(v: string) => setField('unitDef', v)"
          @keyup.enter="handleEditJson('unitDef', true)"
        >
          <template #append>
            <!-- 旧版这个按钮的文案也是「编辑指标值2-JSON」（复制粘贴来的），1:1 保留 -->
            <el-button class="mad-json-btn" @click="handleEditJson('unitDef', true)">编辑指标值2-JSON</el-button>
          </template>
        </el-input>
      </el-form-item>

      <el-form-item>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">创建</el-button>
        <el-button @click="handleCancel">取消</el-button>
      </el-form-item>
    </el-form>

    <JsonDefDialog ref="jsonDimRef" :cols="MEASURE_JSON_DIM" :entry-cols="dataCols" />
    <JsonDefDialog ref="jsonValRef" :cols="MEASURE_JSON_VAL" :entry-cols="dataCols" />
  </el-drawer>
</template>

<style scoped>
.mad-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.mad-head-gap {
  flex: 1;
}
.mad-form {
  padding-top: 6px;
}
/* 旧版 enterButton 按钮的样式：蓝边蓝字 */
.mad-json-btn {
  border-color: #00a0e9;
  color: #00a0e9;
}
</style>
