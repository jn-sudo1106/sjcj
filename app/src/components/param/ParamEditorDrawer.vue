<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { paramApi, type Param, type ParamInput } from '@/api'

const props = defineProps<{ modelValue: boolean; param?: Param | null; paramId?: string }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [param: Param]
  created: [param: Param]
}>()

const draft = reactive({
  name: '',
  group: '',
  kind: 'list' as Param['kind'],
  valuesInput: '',
  defaultValue: '',
  dateExpr: '$CUR_DATE,-1,yyyy-MM-dd',
  seqStart: '1',
  seqEnd: '10',
  seqStep: '1',
  databaseQuery: '',
})

const isEdit = computed(() => !!props.param)
const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

function resetDraft(param?: Param | null) {
  draft.name = param?.name ?? ''
  draft.group = param?.group ?? ''
  draft.kind = param?.kind ?? 'list'
  draft.valuesInput = (param?.values ?? []).join('\n')
  draft.defaultValue = param?.defaultValue ?? ''
  draft.dateExpr = param?.dateExpr ?? '$CUR_DATE,-1,yyyy-MM-dd'
  draft.seqStart = String(param?.seq?.start ?? 1)
  draft.seqEnd = String(param?.seq?.end ?? 10)
  draft.seqStep = String(param?.seq?.step ?? 1)
  draft.databaseQuery = param?.databaseQuery ?? ''
}
watch(() => props.modelValue, (open) => { if (open) resetDraft(props.param) })
watch(() => props.param, (param) => { if (props.modelValue) resetDraft(param) })

function values(): string[] {
  return draft.valuesInput.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean)
}

function seq() {
  return { start: Number(draft.seqStart), end: Number(draft.seqEnd), step: Number(draft.seqStep) }
}

function validSequence() {
  const value = seq()
  return Number.isFinite(value.start) && Number.isFinite(value.end) && Number.isFinite(value.step)
    && value.step > 0 && value.end >= value.start
}

async function submit() {
  if (!draft.name.trim()) {
    ElMessage.warning('请填写参数名称')
    return
  }
  const hasListValues = draft.kind === 'list'
  if (hasListValues && !values().length) {
    ElMessage.warning('请至少填写一个候选取值')
    return
  }
  if ((draft.kind === 'date' || draft.kind === 'date_sequence') && !draft.dateExpr.trim()) {
    ElMessage.warning('请填写日期表达式')
    return
  }
  if ((draft.kind === 'sequence' || draft.kind === 'date_sequence') && !validSequence()) {
    ElMessage.warning('请填写有效的序列范围')
    return
  }
  if (draft.kind === 'database' && !draft.databaseQuery.trim()) {
    ElMessage.warning('请填写数据库查询定义')
    return
  }
  // G9（0717 参数方案）：对齐旧 ParamEdit「数据提交确认」交互
  try {
    await ElMessageBox.confirm('是否确认提交数据？', '数据提交确认', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }

  const input: ParamInput = {
    name: draft.name.trim(),
    // 分组 ID 输入框已下线（0721 会议结论5：语义迁到参数源拼接侧的分组，不再是参数自身属性）；
    // 新建参数不再传这个字段（§六-3 拍板：不传）。编辑态时 draft.group 是从旧数据原样回填、没有可编辑入口，
    // 照原样带回去，不会把老参数已有的分组值悄悄清空。
    group: draft.group.trim() || undefined,
    kind: draft.kind,
    values: hasListValues ? values() : undefined,
    defaultValue: draft.defaultValue.trim() || undefined,
    dateExpr: draft.kind === 'date' || draft.kind === 'date_sequence' ? draft.dateExpr.trim() : undefined,
    seq: draft.kind === 'sequence' || draft.kind === 'date_sequence' ? seq() : undefined,
    databaseQuery: draft.kind === 'database' ? draft.databaseQuery.trim() : undefined,
    tableName: props.param?.tableName,
    colName: props.param?.colName,
  }
  try {
    const result = isEdit.value
      ? await paramApi.paramUpdate({ ...input, paramId: props.param!.paramId })
      : await paramApi.paramCreate({ ...input, paramId: props.paramId || undefined })
    if (!result?.ok || !result.param) {
      ElMessage.warning(result?.message || '保存失败，请重试')
      return
    }
    ElMessage.success(result.message || '参数已保存')
    visible.value = false
    emit('saved', result.param)
    if (!isEdit.value) emit('created', result.param)
  } catch (error) {
    ElMessage.error(`保存失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="isEdit ? '编辑参数' : '新建参数'" width="640px" append-to-body>
    <div class="ped-body">
      <div v-if="isEdit" class="rc-field"><label>参数 ID</label><input class="rc-input" :value="param!.paramId" disabled /></div>
      <div class="rc-field"><label>参数名称</label><input v-model="draft.name" class="rc-input" placeholder="例如：懂车帝-级别参数" /></div>
      <div class="rc-field"><label>参数类型</label>
        <select v-model="draft.kind" class="rc-select">
          <option value="list">列表</option>
          <option value="date">日期</option>
          <option value="sequence">序列</option>
          <option value="date_sequence">日期序列</option>
          <option value="database">数据库</option>
        </select>
      </div>
      <div v-if="draft.kind === 'list'" class="rc-field"><label>值定义（逗号或换行分隔）</label>
        <textarea v-model="draft.valuesInput" class="rc-input ped-textarea" rows="4" placeholder="SUV, 轿车, MPV" />
      </div>
      <div v-if="draft.kind === 'date' || draft.kind === 'date_sequence'" class="rc-field"><label>日期表达式</label><input v-model="draft.dateExpr" class="rc-input" placeholder="$CUR_DATE,-1,yyyy-MM-dd" /></div>
      <div v-if="draft.kind === 'sequence' || draft.kind === 'date_sequence'" class="ped-seq">
        <div class="rc-field"><label>起始值</label><input v-model="draft.seqStart" class="rc-input" inputmode="numeric" /></div>
        <div class="rc-field"><label>结束值</label><input v-model="draft.seqEnd" class="rc-input" inputmode="numeric" /></div>
        <div class="rc-field"><label>步长</label><input v-model="draft.seqStep" class="rc-input" inputmode="numeric" /></div>
      </div>
      <div v-if="draft.kind === 'database'" class="rc-field"><label>数据库查询定义</label><textarea v-model="draft.databaseQuery" class="rc-input ped-textarea" rows="3" placeholder="SELECT value FROM ..." /></div>
      <div class="rc-field"><label>默认值</label><input v-model="draft.defaultValue" class="rc-input" placeholder="未设置时按来源类型的首个生成值回退" /></div>
    </div>
    <template #footer><div class="ped-foot"><button class="rc-btn" type="button" @click="visible = false">取消</button><button class="rc-btn primary" type="button" @click="submit">保存</button></div></template>
  </el-dialog>
</template>

<style scoped>
.ped-body { display: flex; flex-direction: column; }
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 12px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input, .rc-select { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; box-sizing: border-box; }
.rc-input:focus, .rc-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-input:disabled { background: #f8fafc; color: var(--rc-faint); }
.ped-textarea { resize: vertical; font-family: inherit; }
.ped-seq { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.ped-foot { display: flex; justify-content: flex-end; gap: 8px; }
</style>
