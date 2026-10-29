<script setup lang="ts">
// 向量表配置弹窗（1:1 对齐旧 ai-chat-view src/demo/modal/VectorMapping.vue，1015 迁入「基础配置 → 向量表管理」）。
// 新建 / 编辑 / 详情三态同一个表单：详情 = 旧版只读态（隐藏全部编辑控件、不发保存）。
//
// 旧口径：
// · 源表下拉（值 entryTypeId）选中后自动回填：备注=typeName、源表名=表名剥库前缀、
//   向量表表名=`源表名_VECTOR`，并按 entryTypeId 拉源表字段列表喂给列映射的「源列名」下拉；
// · 列映射固定三行 —— 编码/内容/别名（新建预置三行空映射，可删）；
// · 保存 POST /poc/vector/config，body {config, items}，config 带 id 即更新（旧 VectorApi.js:5）。
//
// 与旧版的有意偏差（旧版缺陷或项目约定，交付说明单列）：
// 1. 旧版编辑/详情先开弹窗、列映射 mapping/info 异步回填且不兜底：接口失败时弹窗里 items 是空的，
//    直接保存会把已有映射清掉。这里改为映射明细**取回成功才开弹窗**，失败提示后端 msg 且不开。
// 2. 旧版编辑时 `this.form.config = record`（引用整个列表行）整行回传；这里保留除编辑字段与
//    createTime/updateTime 外的全部键原样带回（同选表规则弹窗的 passthrough 口径），lastSync 也在带回之列。
// 3. 旧版新建默认匹配度是字符串 '0.60'，数字框统一收数字，这里默认 0.6（发出去是 0.6，后端同值）。
// 4. 旧版删除映射行按 JSON 串全等过滤（两行内容相同时会一起删掉），这里按行下标删，只删当前行。
// 5. 旧版必填校验由 a-form-model rules 承担且「源表」编辑态才校验得到（详情态控件隐藏后规则仍跑），
//    这里按项目弹窗口径手动校验、ElMessage.warning 文案照旧规则文案。
// 6. 「源表」下拉改为后端模糊搜索（同表模板「使用表范围」口径）：旧版一次拉全量再本地过滤，
//    但 entry-list 的 SQL 带 `limit 10`（DatabaseController.java:63，1028 定档保留，别去放大它），而 sense_db.cfg_entry_type 有效实体
//    1160 行——本地过滤只能在 ENTRY_TYPE_ID 最大的 10 张里挑，其余选不到；关键词交给后端 LIKE 才能覆盖全库。
// 7. 表名剥前缀不再写死 'sense_data.'：sense_db 的 TABLE_NAME 实测有三种库前缀
//    （sense_data.* 1227、sense_out.* 5、sense_test.* 3，见元数据执行计划 F6），只剥一种会把库名带进
//    vector_config.source_table，而该列约定是裸表名（同计划 A5），同步拼表名就错。
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Delete } from '@element-plus/icons-vue'
import { pocTableEntryList, pocTableFieldList, vectorConfigApi } from '@/api/templateConfig'
import type { EntityConfigField, PocTableEntry, VectorConfigPayload, VectorMappingItem, VectorTableConfig } from '@/api/types/template'

const emit = defineEmits<{ (e: 'saved', payload: { mode: 'add' | 'edit' }): void }>()

const visible = ref(false)
const readonly = ref(false)
const saving = ref(false)
const recordId = ref<number | undefined>()

/** 「源表」下拉数据源（后端 entry-list 按表名/类型名模糊筛，一次回 10 条；见文件头偏差 6） */
const sourceTables = ref<PocTableEntry[]>([])
const sourceLoading = ref(false)
/** 见过的源表按 entryTypeId 缓存：远程搜索会整页换掉选项，已选那张不能被换没后退回裸 id */
const sourceCache = new Map<number, PocTableEntry>()
/** 「源列名」下拉数据源（旧 entityItems，选源表后按 entryTypeId 拉） */
const sourceFields = ref<EntityConfigField[]>([])

const form = reactive({
  sourceTableId: undefined as number | string | undefined,
  sourceTable: '',
  name: '',
  comment: '',
  returnNum: 1 as number | undefined,
  matchDegree: 0.6 as number | undefined,
  dataIndexCode: '',
  preRule: '',
  dataClearRule: '',
})

const items = ref<VectorMappingItem[]>([])

/** 弹窗没有编辑入口、保存时要原样带回的列（见文件头偏差 2） */
let passthrough: Record<string, unknown> = {}

const COLUMN_TYPE_LABELS: Record<string, string> = { '1': '编码', '2': '内容', '3': '别名' }

/** 旧新建预置的三行空映射（type '1'/'2'/'3'） */
function blankItems(): VectorMappingItem[] {
  return [{ type: '1' }, { type: '2' }, { type: '3' }]
}

function resetForm() {
  form.sourceTableId = undefined
  form.sourceTable = ''
  form.name = ''
  form.comment = ''
  form.returnNum = 1
  form.matchDegree = 0.6
  form.dataIndexCode = ''
  form.preRule = ''
  form.dataClearRule = ''
  passthrough = {}
  sourceFields.value = []
}

function fillFromRecord(record: VectorTableConfig) {
  form.sourceTableId = record.sourceTableId ?? undefined
  form.sourceTable = record.sourceTable == null ? '' : String(record.sourceTable)
  form.name = record.name == null ? '' : String(record.name)
  form.comment = record.comment == null ? '' : String(record.comment)
  form.returnNum = record.returnNum == null || record.returnNum === '' ? undefined : Number(record.returnNum)
  form.matchDegree = record.matchDegree == null || record.matchDegree === '' ? undefined : Number(record.matchDegree)
  form.dataIndexCode = record.dataIndexCode == null ? '' : String(record.dataIndexCode)
  form.preRule = record.preRule == null ? '' : String(record.preRule)
  form.dataClearRule = record.dataClearRule == null ? '' : String(record.dataClearRule)
  const { sourceTableId, sourceTable, name, comment, returnNum, matchDegree, dataIndexCode, preRule, dataClearRule, createTime, updateTime, ...rest } = record
  passthrough = rest
}

/** 列映射明细：取回成功才继续（见文件头偏差 1） */
async function loadItems(configId: number): Promise<boolean> {
  try {
    items.value = await vectorConfigApi.mappingInfo(configId)
    return true
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载列映射失败')
    return false
  }
}

/** 表名剥库前缀（sense_data./sense_out./sense_test.* → 裸表名；见文件头偏差 7） */
function bareTableName(tableName?: string | null): string {
  return String(tableName ?? '').split('.').pop() ?? ''
}

/** 选项文案沿用旧版 `表名[类型名]`，表名取剥前缀后的裸名 */
function sourceLabel(entry: PocTableEntry): string {
  return `${bareTableName(entry.tableName)}[${entry.typeName ?? ''}]`
}

/** 远程搜索结果与已选项合并：已选那张不在本次结果里时用缓存补回，标签不会退化成裸 entryTypeId */
function mergeSourceOptions(fresh: PocTableEntry[]) {
  for (const entry of fresh) {
    if (entry.entryTypeId != null) sourceCache.set(Number(entry.entryTypeId), entry)
  }
  const selectedId = form.sourceTableId == null ? undefined : Number(form.sourceTableId)
  const selected = selectedId == null || Number.isNaN(selectedId) ? undefined : sourceCache.get(selectedId)
  const inFresh = fresh.some((entry) => Number(entry.entryTypeId) === selectedId)
  sourceTables.value = selected && !inFresh ? [selected, ...fresh] : fresh
}

let sourceSeq = 0
async function searchSourceTables(name: string) {
  const seq = ++sourceSeq
  sourceLoading.value = true
  try {
    const list = await pocTableEntryList(name.trim())
    if (seq !== sourceSeq) return
    mergeSourceOptions(list)
  } catch (err) {
    if (seq !== sourceSeq) return
    sourceTables.value = []
    ElMessage.error(err instanceof Error ? err.message : '加载源表列表失败')
  } finally {
    if (seq === sourceSeq) sourceLoading.value = false
  }
}

/** 编辑入口：传 record = 编辑（带 id），不传 = 新建 */
async function open(record?: VectorTableConfig | null) {
  readonly.value = false
  resetForm()
  sourceCache.clear()
  recordId.value = record?.id == null ? undefined : Number(record.id)
  if (record) {
    fillFromRecord(record)
    if (!(await loadItems(Number(record.id)))) return
    // 已选源表先入缓存（列表行只有裸表名与备注），否则远程搜索换掉选项后这一项只剩数字 id
    if (record.sourceTableId != null) {
      sourceCache.set(Number(record.sourceTableId), {
        entryTypeId: Number(record.sourceTableId),
        tableName: form.sourceTable,
        typeName: form.comment,
      })
    }
    void searchSourceTables('')
    if (record.sourceTableId != null) {
      try {
        sourceFields.value = await pocTableFieldList(record.sourceTableId)
      } catch {
        sourceFields.value = []
      }
    }
  } else {
    items.value = blankItems()
    void searchSourceTables('')
  }
  visible.value = true
}

/** 详情入口：同一表单的只读态（旧 showModal） */
async function openDetail(record: VectorTableConfig) {
  resetForm()
  readonly.value = true
  recordId.value = record?.id == null ? undefined : Number(record.id)
  fillFromRecord(record)
  if (!(await loadItems(Number(record.id)))) return
  visible.value = true
}

function close() {
  visible.value = false
}

// 旧 selectTableChange：按 entryTypeId 找回源表行，回填备注/源表名/向量表表名，并拉源表字段
async function onSourceTableChange(val: number | string | undefined) {
  if (val == null || val === '') return
  const selected = sourceTables.value.find((item) => Number(item.entryTypeId) === Number(val)) ?? sourceCache.get(Number(val))
  if (!selected) return
  form.sourceTableId = selected.entryTypeId as number
  form.comment = selected.typeName ?? ''
  const bareName = bareTableName(selected.tableName)
  form.sourceTable = bareName
  form.name = `${bareName}_VECTOR`
  try {
    sourceFields.value = await pocTableFieldList(selected.entryTypeId as number)
  } catch (err) {
    sourceFields.value = []
    ElMessage.error(err instanceof Error ? err.message : '加载源表字段失败')
  }
}

/** 旧 delItem 按 JSON 全等过滤会误删同内容行，这里按行下标删（见文件头偏差 4） */
function delItem(index: number) {
  items.value.splice(index, 1)
}

function validate(): string {
  if (form.sourceTableId == null || form.sourceTableId === '') return '请选择源表'
  if (!form.name.trim()) return '请填写向量表表名'
  if (!form.comment.trim()) return '请填写向量表备注'
  if (form.returnNum == null) return '请填写召回数'
  if (form.matchDegree == null) return '请填写匹配度'
  if (!form.dataIndexCode.trim()) return '请填写字典表类型'
  return ''
}

async function submit() {
  const message = validate()
  if (message) {
    ElMessage.warning(message)
    return
  }
  const config: VectorTableConfig = {
    ...(passthrough as VectorTableConfig),
    sourceTableId: form.sourceTableId,
    sourceTable: form.sourceTable,
    name: form.name.trim(),
    comment: form.comment.trim(),
    returnNum: form.returnNum,
    matchDegree: form.matchDegree,
    dataIndexCode: form.dataIndexCode,
    preRule: form.preRule,
    dataClearRule: form.dataClearRule,
  }
  if (recordId.value != null) config.id = recordId.value
  const payload: VectorConfigPayload = { config, items: items.value.map((item) => ({ ...item })) }

  saving.value = true
  try {
    await vectorConfigApi.save(payload)
    ElMessage.success('保存成功')
    visible.value = false
    emit('saved', { mode: recordId.value == null ? 'add' : 'edit' })
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}

defineExpose({ open, openDetail, close })
</script>

<template>
  <el-dialog
    v-model="visible"
    title="向量表配置"
    width="900px"
    top="6vh"
    append-to-body
    :close-on-click-modal="false"
    class="vce-dialog"
  >
    <el-form class="vce-form" label-width="110px" @submit.prevent>
      <el-form-item label="源表" required>
        <el-select
          v-if="!readonly"
          v-model="form.sourceTableId"
          filterable
          remote
          :remote-method="searchSourceTables"
          :loading="sourceLoading"
          loading-text="搜索中"
          no-match-text="无匹配数据表"
          placeholder="搜索表名或类型名"
          class="vce-field"
          @change="onSourceTableChange"
        >
          <el-option
            v-for="item in sourceTables"
            :key="String(item.entryTypeId)"
            :value="item.entryTypeId as number"
            :label="sourceLabel(item)"
          />
        </el-select>
        <span v-else class="vce-static">{{ form.sourceTable }}</span>
      </el-form-item>
      <el-form-item label="向量表表名" required>
        <el-input v-if="!readonly" v-model="form.name" class="vce-field" />
        <span v-else class="vce-static">{{ form.name }}</span>
      </el-form-item>
      <el-form-item label="向量表备注" required>
        <el-input v-if="!readonly" v-model="form.comment" class="vce-field" />
        <span v-else class="vce-static">{{ form.comment }}</span>
      </el-form-item>
      <el-form-item label="召回数" required>
        <el-input-number v-if="!readonly" v-model="form.returnNum" :min="1" class="vce-number" />
        <span v-else class="vce-static">{{ form.returnNum }}</span>
      </el-form-item>
      <el-form-item label="匹配度" required>
        <el-input-number v-if="!readonly" v-model="form.matchDegree" :min="0" :step="0.1" :precision="2" class="vce-number" />
        <span v-else class="vce-static">{{ form.matchDegree }}</span>
      </el-form-item>
      <el-form-item label="字典表类型" required>
        <el-input v-if="!readonly" v-model="form.dataIndexCode" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" class="vce-field" />
        <span v-else class="vce-static">{{ form.dataIndexCode }}</span>
      </el-form-item>
      <el-form-item label="预处理规则">
        <el-input v-if="!readonly" v-model="form.preRule" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" resize="vertical" class="vce-field" />
        <span v-else class="vce-static">{{ form.preRule }}</span>
      </el-form-item>
      <el-form-item label="数据清洗规则">
        <el-input v-if="!readonly" v-model="form.dataClearRule" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" resize="vertical" class="vce-field" />
        <span v-else class="vce-static">{{ form.dataClearRule }}</span>
      </el-form-item>

      <el-form-item label="列映射">
        <el-table :data="items" border size="small" class="vce-map-table">
          <el-table-column label="列类型" width="80" align="center">
            <template #default="{ row }">{{ COLUMN_TYPE_LABELS[String(row.type)] ?? row.type ?? '' }}</template>
          </el-table-column>
          <el-table-column label="源列名" min-width="200" align="center">
            <template #default="{ row }">
              <el-select v-if="!readonly" v-model="row.sourceColumn" filterable placeholder="请选择" size="small" class="vce-cell-field">
                <el-option
                  v-for="field in sourceFields"
                  :key="String(field.itemCode)"
                  :value="field.itemCode ?? ''"
                  :label="String(field.itemCode ?? '') + '[' + String(field.itemName ?? '') + ']'"
                />
              </el-select>
              <span v-else>{{ row.sourceColumn ?? '' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="改写后列名" width="150" align="center">
            <template #default="{ row }">
              <el-input v-if="!readonly" v-model.trim="row.targetColumn" size="small" />
              <span v-else>{{ row.targetColumn ?? '' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="取值列" width="150" align="center">
            <template #default="{ row }">
              <el-input v-if="!readonly" v-model.trim="row.valueColumn" size="small" />
              <span v-else>{{ row.valueColumn ?? '' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="改写规则" min-width="180" align="center">
            <template #default="{ row }">
              <el-input v-if="!readonly" v-model.trim="row.rule" size="small" />
              <span v-else>{{ row.rule ?? '' }}</span>
            </template>
          </el-table-column>
          <el-table-column v-if="!readonly" label="操作" width="60" align="center">
            <template #default="{ $index }">
              <el-icon class="vce-del-icon" title="删除" @click="delItem($index)"><Delete /></el-icon>
            </template>
          </el-table-column>
        </el-table>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button v-if="readonly" @click="close">关闭</el-button>
      <template v-else>
        <el-button @click="close">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 13.6 寸屏幕基线（AGENTS.md 弹窗适配 + 滚动容器约定）：el-dialog 是 append-to-body 的 teleport，
   自定义 class 落在 .el-dialog 上但拿不到本组件的 scope 属性，必须走 :global（同 MatchTableConfigEditDialog）。 */
:global(.vce-dialog) {
  max-width: calc(100vw - 40px);
}
:global(.vce-dialog .el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding-top: 8px;
}
.vce-form :deep(.el-form-item) {
  margin-bottom: 14px;
}
.vce-form :deep(.el-form-item__label) {
  font-size: 12px;
  color: var(--rc-text-2, #475569);
}
.vce-field {
  width: 100%;
}
.vce-number {
  width: 160px;
}
.vce-static {
  font-size: 13px;
  color: var(--rc-text, #0f172a);
  white-space: pre-wrap;
}
.vce-map-table {
  width: 100%;
}
.vce-cell-field {
  width: 100%;
}
.vce-del-icon {
  cursor: pointer;
  color: var(--rc-danger, #dc2626);
  font-size: 15px;
}
</style>
