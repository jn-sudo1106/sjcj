<script setup lang="ts">
// 新增 / 修改监控（1:1 迁移旧 data-view `src/page/base/check/CheckAdd.vue`）。
//
// 旧版结构（挨条对齐，别随手删）：
//   数据源（可编辑） / 表名（下拉，来自 queryEntryTypesGroup） / 监控名
//   定时：[表达式输入框] + [定时]（开 SourceCron 弹窗）+ [延时]（AFTER:30）
//   检查项JSON：只读输入框 + [自定义配置]（切换「自定义告警配置」并回填）
//   自定义告警配置：时间类型 / 数量范围 / 时间表达 / 条件SQL / 自定义规则+验证 / 告警提示 /
//                   告警推送 / 告警方式 / （邮件时）更多收件人
//   说明：默认策略 + AFTER:30 的解释
//
// 旧版里 `handleEditJson`/`JsonSub`/`EntryDetailSimple`/`BaseEditModal` 都没进模板（死代码），
// 这里不迁。
//
// 与旧版的三处有意偏差（都是旧版缺陷，已在交付说明里单列）：
// 1. 旧版 数据源 改了不会重载表名下拉，这里 change 时重载；
// 2. 旧版 resetData 漏了 timeType、且会把 formSub 写成 `{}` 落进 checkConf，导致第 1 次新增和
//    第 2 次新增行为不一致；这里每次打开都从同一份默认值起步；
// 3. 旧版 handleSubmit 校验不过只弹提示、**不 return**，脏数据照样提交；这里直接拦截。
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { dataApi, type EntryType, type SourceCheck } from '@/api'
import { addSourceCheck, checkOneManual, updateSourceCheck } from '@/api/monitor'
import { summarizeCheckOne } from './checkOneSummary'
import SourceCronDialog from './SourceCronDialog.vue'

const props = defineProps<{
  sourceId: string
  /** 编辑态传入原始数据；不传 = 新增 */
  record?: SourceCheck | null
}>()
const emit = defineEmits<{
  (e: 'saved'): void
  (e: 'update', payload: Record<string, unknown>): void
  (e: 'add', payload: Record<string, unknown>): void
}>()

const DEFAULT_SCHEDULE = '0 0 6-22 * * ?'

interface CheckFields {
  id?: string
  sourceId: string
  tableName: string
  name: string
  schedule: string
  checkConf: string
  isDelete: number
}

/**
 * checkConf 的字段集合与顺序沿用旧 formSub（onResult/sourceIds 旧版从未赋值，省略）。
 * 可选字段声明成 `string | undefined`：旧版 formSub 这些字段的初值就是 undefined，
 * `JSON.stringify` 会把它们丢掉 —— 所以「什么都没配」落库的是
 * `{"timeType":"C","notifyOn":"error","notifyType":"mail"}`，而不是一串空串。
 */
interface CheckConf {
  timeType: string
  minSize?: string
  maxSize?: string
  startDt?: string
  endDt?: string
  cond?: string
  checkRule?: string
  checkMsg?: string
  notifyOn: string
  notifyType: string
  mailTo?: string
}

function emptyFields(): CheckFields {
  return {
    id: undefined,
    sourceId: props.sourceId || '',
    tableName: '',
    name: '',
    schedule: DEFAULT_SCHEDULE,
    checkConf: '',
    isDelete: 0,
  }
}
function emptyConf(): CheckConf {
  // 键的顺序照抄旧 formSub 的声明顺序：JSON.stringify 按插入顺序输出，
  // 这样落库的 checkConf 与旧平台逐字符一致（值 undefined 的键会被 stringify 丢掉）。
  return {
    timeType: 'C',
    minSize: undefined,
    maxSize: undefined,
    startDt: undefined,
    endDt: undefined,
    cond: undefined,
    checkRule: undefined,
    checkMsg: undefined,
    notifyOn: 'error',
    notifyType: 'mail',
    mailTo: undefined,
  }
}

const open = ref(false)
const loading = ref(false)
const subShow = ref(false)
const cronOpen = ref(false)
const isEdit = ref(false)
const title = computed(() => (isEdit.value ? '修改监控' : '新增监控'))

const form = ref<CheckFields>(emptyFields())
const formSub = ref<CheckConf>(emptyConf())
/** 编辑时把 record 上非表单字段原样带回（旧 Object.assign(this.form, record) 的效果） */
const extra = ref<Record<string, unknown>>({})

// 子表单 → checkConf（旧版深度 watch formSub → JSON.stringify）
watch(
  formSub,
  (v) => {
    form.value.checkConf = JSON.stringify(v)
  },
  { deep: true },
)

// ---- 表名下拉：按源加载实体表（旧 loadEntryTypes） ----
const tableOptions = ref<EntryType[]>([])
const loadingTables = ref(false)
const loadedSourceId = ref('')

async function loadEntryTypes() {
  const sourceId = String(form.value.sourceId || '').trim()
  if (!sourceId) {
    tableOptions.value = []
    return
  }
  loadingTables.value = true
  try {
    const group = await dataApi.entryTypesGroup(sourceId)
    // 旧版：entryTypes = [].concat(data.list2).concat(data.list1)
    const list = [...group.list2, ...group.list1]
    tableOptions.value = list
    loadedSourceId.value = sourceId
    const sourceName = group.sourceName || sourceId
    if (list.length === 1) {
      if (!form.value.tableName) {
        form.value.tableName = list[0].tableName
        form.value.name = `${sourceName}-日增量`
      }
    } else if (list.length > 1) {
      // 旧版逐项找第一个 entryTypeId !== 999 的表做默认值（999 是虚拟表）
      for (const item of list) {
        if (!form.value.tableName && item.tableId !== '999') {
          form.value.tableName = item.tableName
          form.value.name = `${sourceName}-日增量`
        }
      }
    } else {
      ElMessage.error(`当前源没有对应的数据表：${sourceId}`)
    }
  } catch (error) {
    tableOptions.value = []
    ElMessage.error(`加载数据表失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    loadingTables.value = false
  }
}

/** 数据源被手改：清掉上一个源带出来的表名并重载（旧版不会重载，这里补上） */
function onSourceIdChange() {
  const next = String(form.value.sourceId || '').trim()
  if (!next || next === loadedSourceId.value) return
  form.value.tableName = ''
  void loadEntryTypes()
}

// ---- 自定义告警配置 ----
function showMore() {
  if (form.value.checkConf) {
    try {
      const parsed = JSON.parse(form.value.checkConf) as Partial<CheckConf>
      formSub.value = { ...formSub.value, ...parsed }
    } catch {
      ElMessage.warning('检查项JSON 不是合法 JSON，已保留原值，请手工修正')
    }
  }
  if (!formSub.value.notifyOn) formSub.value.notifyOn = 'error'
  if (!formSub.value.notifyType) formSub.value.notifyType = 'mail'
  subShow.value = !subShow.value
}

// ---- 定时 ----
function setAfter() {
  form.value.schedule = 'AFTER:30'
}
function onCronSubmit(cron: string) {
  form.value.schedule = cron
}

// ---- 规则验证（旧 checkOne） ----
const checkResult = ref<boolean | null>(null)
const checkResultMsg = ref('')
async function onCheckOne() {
  try {
    const res = await checkOneManual({
      checkConf: form.value.checkConf,
      name: form.value.name,
      tableName: form.value.tableName,
      sourceId: form.value.sourceId,
    })
    const detail = (res as { data?: unknown; message?: string })?.data
    checkResult.value = true
    const summary = summarizeCheckOne(detail ?? res)
    checkResultMsg.value = `规则校验->返回成功${summary ? `：${summary}` : ''}  上下文json：${JSON.stringify(detail ?? res)}`
  } catch (error) {
    checkResult.value = false
    checkResultMsg.value = `规则校验->返回失败：${error instanceof Error ? error.message : String(error)}`
  }
}

// ---- 打开 / 关闭 ----
function openDialog(record?: SourceCheck | null) {
  isEdit.value = !!record
  // 编辑：record 上的非表单字段原样带回；新增：reserve 空
  const { id, sourceId, tableName, name, schedule, checkConf, isDelete, ...rest } = (record ?? {}) as Record<
    string,
    unknown
  >
  extra.value = record ? rest : {}
  form.value = {
    id: id == null ? undefined : String(id),
    sourceId: String(sourceId ?? props.sourceId ?? ''),
    tableName: String(tableName ?? ''),
    name: String(name ?? ''),
    schedule: String(schedule ?? '') || DEFAULT_SCHEDULE,
    checkConf: String(checkConf ?? ''),
    isDelete: Number(isDelete ?? 0),
  }
  // 回填 checkConf → formSub（旧 doEdit：subShow=false，然后有 checkConf 就走 showMore 展开）
  const base = emptyConf()
  let expanded = false
  if (form.value.checkConf) {
    try {
      formSub.value = { ...base, ...(JSON.parse(form.value.checkConf) as Partial<CheckConf>) }
      expanded = true
    } catch {
      // JSON 不合法：留默认子表单，用户点「自定义配置」时再提示
      formSub.value = { ...base }
    }
  } else {
    formSub.value = { ...base }
  }
  subShow.value = expanded
  checkResult.value = null
  checkResultMsg.value = ''
  tableOptions.value = []
  loadedSourceId.value = ''
  open.value = true
  void loadEntryTypes()
}

function closeDialog() {
  open.value = false
  subShow.value = false
  form.value = emptyFields()
  formSub.value = emptyConf()
  checkResult.value = null
  checkResultMsg.value = ''
}

// ---- 提交 ----
async function onSubmit() {
  if (!form.value.sourceId || !form.value.checkConf) {
    ElMessage.error('处理失败，提交的信息缺失')
    return
  }
  // 旧 MonitorList.addCallback / updateCallback 的字段剔除口径
  const payload: Record<string, unknown> = { ...extra.value, ...form.value }
  delete payload.createDt
  delete payload.updateDt
  if (isEdit.value) {
    delete payload.lastRun
    delete payload.nextRun
  } else {
    delete payload.id
  }
  loading.value = true
  try {
    if (isEdit.value) {
      emit('update', payload)
      await updateSourceCheck(payload)
      ElMessage.success('修改成功')
    } else {
      emit('add', payload)
      await addSourceCheck(payload)
      ElMessage.success('新增成功')
    }
    emit('saved')
    closeDialog()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    loading.value = false
  }
}

// 对外暴露
defineExpose({ openDialog })
</script>

<template>
  <el-dialog v-model="open" :title="title" width="1000px" destroy-on-close :close-on-click-modal="false" @close="closeDialog">
    <el-form :model="form" label-width="130px" label-position="right" @submit.prevent>
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="数据源">
            <el-input v-model="form.sourceId" autocomplete="off" @change="onSourceIdChange" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="表名">
            <el-select
              v-model="form.tableName"
              v-loading="loadingTables"
              class="ce-full"
              placeholder="请选择表名"
              filterable
            >
              <el-option v-for="t in tableOptions" :key="t.tableId" :label="t.tableName" :value="t.tableName" />
              <template v-if="!tableOptions.length">
                <el-option disabled label="该源暂无可用表" value="" />
              </template>
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="监控名">
            <el-input v-model="form.name" autocomplete="off" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="定时">
            <div class="ce-cron">
              <el-input v-model="form.schedule" class="ce-cron-input" placeholder="请生成cron表达式" />
              <el-button @click="cronOpen = true">定时</el-button>
              <el-button @click="setAfter">延时</el-button>
            </div>
          </el-form-item>
        </el-col>
      </el-row>

      <el-row>
        <el-col :span="24">
          <el-form-item label="检查项JSON" label-width="130px">
            <div class="ce-json">
              <el-input v-model="form.checkConf" readonly disabled class="ce-json-input" />
              <el-button type="primary" @click="showMore">自定义配置</el-button>
            </div>
          </el-form-item>
        </el-col>
      </el-row>

      <!-- 自定义告警配置 -->
      <template v-if="subShow">
        <el-divider content-position="left">自定义告警配置</el-divider>

        <el-row>
          <el-col :span="24">
            <el-form-item label="时间类型(MySql)">
              <el-radio-group v-model="formSub.timeType">
                <el-radio-button value="C">按生成时间（新增量）</el-radio-button>
                <el-radio-button value="U">按变更时间（变化量）</el-radio-button>
                <el-radio-button value="M">按保存时间（保存量-含去重）</el-radio-button>
                <el-radio-button value="T">上次任务后有保存</el-radio-button>
              </el-radio-group>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="数量范围">
              <div class="ce-range">
                <el-input v-model="formSub.minSize" class="ce-range-num" placeholder="Minimum" />
                <span class="ce-sep">~</span>
                <el-input v-model="formSub.maxSize" class="ce-range-num" placeholder="Maximum" />
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="时间表达(MySql)">
              <div class="ce-range">
                <el-input v-model="formSub.startDt" class="ce-range-dt" placeholder="CURDATE()" />
                <span class="ce-sep">~</span>
                <el-input v-model="formSub.endDt" class="ce-range-dt" placeholder="NOW()" />
              </div>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row>
          <el-col :span="24">
            <el-form-item label="自定义条件SQL">
              <el-input
                v-model="formSub.cond"
                type="textarea"
                :rows="2"
                placeholder="支持sql语句，1. select需要返回(cnt、maxId)两字段; 2.条件语句片断,如state=='C'"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row>
          <el-col :span="24">
            <el-form-item label="自定义规则">
              <div class="ce-rule">
                <el-input
                  v-model="formSub.checkRule"
                  class="ce-rule-input"
                  placeholder="支持系统通用动态表达式脚本,env中有cnt与maxId两值，如 cnt > 100"
                />
                <el-button type="primary" @click="onCheckOne">验证</el-button>
              </div>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row v-if="checkResultMsg" class="ce-result-row">
          <el-col :span="24" class="ce-result">
            <el-alert
              :title="checkResultMsg"
              :type="checkResult ? 'success' : 'warning'"
              banner
              :closable="false"
            />
          </el-col>
        </el-row>

        <el-row>
          <el-col :span="24">
            <el-form-item label="告警提示">
              <el-input
                v-model="formSub.checkMsg"
                placeholder="支持使用脚本实现,env中有cnt与maxId两值，如'当日数量不对:'+cnt"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="告警推送">
              <el-select v-model="formSub.notifyOn" class="ce-full">
                <el-option label="校验失败时推送" value="error" />
                <el-option label="校验成功时推送" value="ok" />
                <el-option label="校验成功失败均推送" value="all" />
                <el-option label="均不发送(静默模式）" value="none" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="告警方式">
              <el-select v-model="formSub.notifyType" class="ce-full">
                <el-option label="邮件" value="mail" />
                <el-option label="钉钉（系统级钉钉机器人)" value="ding" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row v-if="formSub.notifyType === 'mail'">
          <el-col :span="24">
            <el-form-item label="更多收件人">
              <el-input
                v-model="formSub.mailTo"
                placeholder="支持更多收件人增加，以逗号分割，如为空则只推送系统默认收件人"
              />
            </el-form-item>
          </el-col>
        </el-row>
      </template>
    </el-form>

    <el-divider />
    <div class="ce-desc">
      <h4>说明</h4>
      <div>1. 默认策略：判断<span class="ce-red">当日无新增数据</span>即告警;</div>
      <div>2. 定时为<span class="ce-red">AFTER:30</span>表示<span class="ce-red">定时采集任务后30分钟</span>触校验;</div>
    </div>

    <template #footer>
      <el-button @click="closeDialog">取消</el-button>
      <el-button type="primary" :loading="loading" @click="onSubmit">保存</el-button>
    </template>
  </el-dialog>

  <SourceCronDialog v-model="cronOpen" :cron="form.schedule" @submit="onCronSubmit" />
</template>

<style scoped>
.ce-full {
  width: 100%;
}
.ce-cron,
.ce-json,
.ce-rule {
  display: flex;
  gap: 8px;
  width: 100%;
}
.ce-cron-input,
.ce-json-input,
.ce-rule-input {
  flex: 1;
  min-width: 0;
}
.ce-range {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}
.ce-range-num,
.ce-range-dt {
  flex: 1;
  min-width: 0;
}
.ce-range-num :deep(.el-input__inner),
.ce-range-dt :deep(.el-input__inner) {
  text-align: center;
}
.ce-sep {
  flex: none;
  color: var(--rc-faint, #94a3b8);
}
.ce-result-row {
  margin-top: -8px;
}
.ce-result {
  padding: 0 0 12px 130px;
}
.ce-desc {
  padding: 0 12px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
  line-height: 1.8;
}
.ce-desc h4 {
  margin: 0 0 4px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
  font-weight: 600;
}
.ce-red {
  color: var(--rc-error, #dc2626);
}
</style>
