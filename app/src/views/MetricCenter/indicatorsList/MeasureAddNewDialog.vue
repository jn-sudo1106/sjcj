<script setup lang="ts">
// 「指标-新」抽屉 —— 1:1 迁移旧 data-view `src/page/base/measure/MeasureAddNew.vue`。
//
// 入口：旧 DatasetList 的「指标-新」按钮 → `$refs.addMeasureNew.doEdit(sourceId, record, entryTypeId)`。
// 新平台由 indicatorDataset 跳到本页并带 `add=new`（见 index.vue 的 openMeasureAddNew）。
//
// 与「增加指标」(MeasureAdd) 的差别（逐条对照过两份旧文件）：
//   1. 顶部保留 源ID / 数据集 两枚 tag + 「加载指标配置样例」按钮；
//      中部保留 指标编码 / 指标名称 / 条件表达式 三个普通输入框；
//      **去掉**固定的 日期纬度 / 指标值1 / 指标值2 / 单位 四行，改成按「出表(outEntryType)的列」
//      动态渲染 N 行 —— 每行一个 `a-input-search` 直接编辑该列的 JSON。
//   2. `doEdit` **不把 record 合并进 form**（旧版那行是注释掉的），所以 form 从 `{}` 开始，
//      只有点「加载指标配置样例」才会填上标准字段。这里保持原样。
//
// ⚠️ 旧版有一处**没写完就收尾**的地方，必须说清楚（决定本文件的唯一实现差异）：
//   动态行编辑的是 `item.json`（outDataCols 上的字段），而 `handleSubmit` 提交的是 `this.form`——
//   两者从头到尾没有任何一处把它们接起来，所以旧版「指标-新」无论怎么填 JSON，**提交体里都不带这些值**。
//   旧文件里留着作者自己的 TODO：`// 使用this.outColumns的value属性增加到form字段中`。
//   本文件按这句注释把口子接上：提交前，把每一行**填过 JSON** 的 outDataCols 写回
//   `form[item.value] = item.json`（item.value 就是该列的 columnName），再接旧口径 addMeasure。
//   空行（没填 JSON）不写回，避免把一堆空键塞进请求体。
//   —— 这是本轮唯一一处「补齐旧版未完成的逻辑」，其余全部照抄。
//
// 其余有意偏差（与 MeasureAddDialog 同一批口径）：
//   · `queryEntryType` → `dataApi.tableMeta`，映射 `columnName / itemName(→desc)`。
//   · 旧 `doEdit` 里那两处硬编码的 `2101977`（`record.outEntryType || 2101977` 与
//     `loadEntryType(2101977, false)`）**原样保留**：这是旧版写死的「指标出表」表 ID，
//     换成别的常量或去掉兜底都会改变行为。想联调真实数据时，把 record 里的 outEntryType 带上即可
//     （注意第二处是写死的，旧版也不认 record.outEntryType —— 照抄）。
//   · `_` 开头的 replaceNull（null → undefined，JSON.stringify 会剔除该键）与
//     `int` 列存数字两处，与 MeasureAddDialog / shared/JsonDefDialog.vue 完全一致。
//   · 旧 `JSON.parse(item.json)` 空值会抛（不过本页作者自己加了 `if (text)` 保护，所以只有
//     非空才 parse，比 MeasureAdd 稳）；这里沿用同样的保护，非法 JSON 给可见提示。
import { reactive, ref } from 'vue'
import { ElMessage, ElNotification } from 'element-plus'
import { dataApi } from '@/api'
import { addMeasure, measurePaged, type MeasureRow } from '@/api/measure'
import JsonDefDialog from '../shared/JsonDefDialog.vue'
import { MEASURE_JSON_DIM } from './columns'

defineOptions({ name: 'MeasureAddNewDialog' })

const emit = defineEmits<{ (e: 'saved'): void }>()

/** 旧版写死的「指标出表」表 ID（两处都是这个常量，见文件头） */
const DEFAULT_OUT_ENTRY_TYPE = '2101977'

/** 一行「出表列」：对应 outEntryType 的一个字段 */
interface OutCol {
  /** 列的 columnName */
  value: string
  /** 列的中文名（旧 itemName → 新版 field.desc） */
  name: string
  /** 该列的 JSON 配置（旧版只存本地，不参与提交；本文件在提交前写回 form） */
  json: string
}

interface NewMeasureForm {
  measureCode?: string | null
  measureName?: string | null
  measureType?: string | null
  sourceId?: string | number | null
  datasetId?: string | number | null
  keyDef?: string | null
  dimDef?: string | null
  val1Def?: string | null
  val2Def?: string | null
  unitDef?: string | null
  [key: string]: unknown
}

const visible = ref(false)
const submitting = ref(false)
const entryTypeId = ref<string>('')
const datasetName = ref<string | undefined>(undefined)
/** 进表列（给 JsonSub 的 ENTRY_COLUMNS 下拉当候选） */
const dataCols = ref<{ value: string; name: string }[]>([])
/** 出表列（动态渲染成 N 行 JSON 编辑器） */
const outDataCols = ref<OutCol[]>([])

const form = reactive<NewMeasureForm>({})

const jsonDimRef = ref<InstanceType<typeof JsonDefDialog>>()

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

function setField(key: string, value: unknown) {
  form[key] = value
}

/** 旧 loadEntryType(entryTypeId, inFlag)：inFlag=true → 进表列；false → 出表列 */
async function loadEntryType(id: string, inFlag: boolean) {
  if (!id) {
    if (inFlag) dataCols.value = []
    else outDataCols.value = []
    return
  }
  try {
    const meta = await dataApi.tableMeta(id)
    const cols = (meta?.fields ?? []).map((field) => ({
      value: String(field.columnName ?? ''),
      name: field.desc,
      json: undefined as string | undefined,
    }))
    if (inFlag) {
      dataCols.value = cols.map(({ value, name }) => ({ value, name }))
    } else {
      outDataCols.value = cols.map(({ value, name, json }) => ({ value, name, json: json ?? '' }))
    }
  } catch {
    ElNotification.error({ message: '获取信息失败' })
  }
}

/** 旧 doEdit(sourceId, record, entryTypeId) —— 注意旧版**没有** Object.assign(form, record) */
async function open(sourceId: string | number, record: Record<string, unknown>, id?: string | number) {
  entryTypeId.value = id == null ? '' : String(id)
  // 旧版只拿 datasetName 用于展示；outEntryType 取 record.outEntryType 兜底 2101977（第二处 load 是写死的）
  datasetName.value = record?.datasetName == null ? undefined : String(record.datasetName)
  form.sourceId = (record?.sourceId ?? sourceId ?? null) as string | number | null
  form.datasetId = (record?.datasetId ?? null) as string | number | null
  form.outEntryType = record?.outEntryType ?? DEFAULT_OUT_ENTRY_TYPE
  visible.value = true
  await Promise.all([
    loadEntryType(entryTypeId.value, true),
    // 与旧版一致：出表列用写死的常量，不看 record.outEntryType
    loadEntryType(DEFAULT_OUT_ENTRY_TYPE, false),
  ])
}

/** 旧 handleLoadOne：拉最新一条指标当样例；编码自增一位 */
async function handleLoadOne() {
  try {
    const res = await measurePaged({ pageNo: 1, pageSize: 1 })
    const last = (res.list ?? [])[0] as MeasureRow | undefined
    if (!last) {
      ElMessage.warning('没有可参考的指标样例')
      return
    }
    const copy: Record<string, unknown> = { ...last }
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

/** 旧 handleEditJson(item, key, date)：本页三处调用传的都是 date=false → json_dim 列集 */
function handleEditJson(item: OutCol) {
  const text = String(item.json ?? '').trim()
  let obj: unknown = {}
  if (text) {
    try {
      obj = JSON.parse(text)
    } catch (err) {
      ElMessage.error(`「${item.name}」不是合法的 JSON，无法打开编辑器：${errText(err)}`)
      return
    }
  }
  const replaceNull = (_k: string, value: unknown) => (value == null ? undefined : value)
  jsonDimRef.value?.open(
    (obj ?? {}) as Record<string, unknown>,
    '1. 例: from=30, to=3参数表示每次仅处理当天 30天前-3天前 时间段的数据',
    (out) => {
      item.json = JSON.stringify(out, replaceNull)
      return true
    },
  )
}

/** 旧 handleSubmit + 补齐作者 TODO（见文件头）：填过 JSON 的出表列写回 form[columnName] */
async function handleSubmit() {
  for (const item of outDataCols.value) {
    const json = String(item.json ?? '').trim()
    if (json) form[item.value] = json
  }
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
    class-name="man-drawer"
  >
    <div class="man-head">
      <el-tag type="primary" size="large">源ID: {{ form.sourceId }}</el-tag>
      <el-tag type="primary" size="large">数据集: {{ form.datasetId }} - {{ datasetName }}</el-tag>
      <span class="man-head-gap" />
      <el-button type="primary" @click="handleLoadOne">加载指标配置样例</el-button>
    </div>

    <el-form label-width="120px" class="man-form">
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

      <!-- 出表列：一行一个 JSON 编辑器（旧版 v-for="(item, idx) in outDataCols"） -->
      <el-form-item v-for="(item, idx) in outDataCols" :key="`${item.value}_${idx}`" :label="item.name">
        <el-input
          :model-value="item.json"
          placeholder='一般为date，如 {"cols":"K2","type":"date","clearRule":""}'
          @update:model-value="(v: string) => (item.json = v)"
          @keyup.enter="handleEditJson(item)"
        >
          <template #append>
            <el-button class="man-json-btn" @click="handleEditJson(item)">编辑JSON</el-button>
          </template>
        </el-input>
      </el-form-item>

      <el-form-item>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">Create</el-button>
        <el-button @click="handleCancel">Cancel</el-button>
      </el-form-item>
    </el-form>

    <!-- 旧版还注册了一个 `ref="jsonEditVal"`(:cols="jsonVal")，但本页三处 handleEditJson
         调用传的都是 date=false → 只会打开 jsonEditDim，值类那个从头到尾没被打开过（死代码），不迁。 -->
    <JsonDefDialog ref="jsonDimRef" :cols="MEASURE_JSON_DIM" :entry-cols="dataCols" />
  </el-drawer>
</template>

<style scoped>
.man-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.man-head-gap {
  flex: 1;
}
.man-form {
  padding-top: 6px;
}
.man-json-btn {
  border-color: #00a0e9;
  color: #00a0e9;
}
</style>
