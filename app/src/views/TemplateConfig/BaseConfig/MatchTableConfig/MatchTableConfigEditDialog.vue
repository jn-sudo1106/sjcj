<script setup lang="ts">
// 选表规则编辑弹窗（1:1 对齐旧 ai-chat-view src/demo/modal/MatchTableConfigEditor.vue）。
//
// 旧口径：
// · 四个字段：表名称（文本框）、选表类型（下拉，问句选表 / 向量选表）、匹配规则（文本域 3~8 行自适应）、
//   状态（单选 启用/禁用）；弹窗宽 800px。
// · 新增与修改是**同一个端点**（旧 editor 函数 → POST /poc/match-table-config，body 带 id 即更新），
//   与 chat-flow-step / question-dic 那种「新增/修改分两个端点」的域不同，由 api 层的 CRUD 工厂承担。
//
// 与旧版的有意偏差（旧版缺陷或项目约定，交付说明单列）：
// 1. 旧版提交不看校验：表名称留空也能存进库，存进去的是一条永远不会被选中的规则。
//    这里拦两个必填（表名称 / 选表类型），同 sql 模板、问句改写的修正先例。
// 2. 旧版编辑时 `this.form = data` 把整行原样 POST 回去。这里不回传 createTime/updateTime（同其余模板域弹窗），
//    但**原样带回 tableId / type / delFlag** 三列 —— 它们在真实行里都有值（2026-10-15 抓样 tableId=1042、type='0'、
//    delFlag='0'），页面既没入口也不能改，整行回传正是旧版把它们带回去的方式；
//    漏掉就等于赌后端的更新语句跳过 null，未确认后端实现前不冒这个险（数据字典的 code/contentCode 同先例）。
// 3. 旧版状态的单选值是**数字** 0/1（列表用 row.status == 0 松散比较），本域 status 统一按字符串
//    '0'/'1' 走（见 api/types/template.ts 的 TemplateRow），回填时先 String() 归一。
// 4. 旧版新增时 status 是 undefined（由后端兜底），这里显式发 '0' 启用，与问句改写 / 数据索引同步的新增口径一致；
//    旧版取消一次后 form 被清成 {}，下次打开新增连 selectionType 的默认值都没了，这里每次 open 都重置成初始值。
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { matchTableConfigApi } from '@/api/templateConfig'
import type { MatchTableConfig } from '@/api/types/template'
import { MATCH_TABLE_SELECTION_TYPE_OPTIONS } from './options'

const emit = defineEmits<{ (e: 'saved', payload: { mode: 'add' | 'edit'; id?: number }): void }>()

const visible = ref(false)
const saving = ref(false)
const recordId = ref<number | undefined>()

const form = reactive({ tableName: '', selectionType: 'text_selection', rule: '', status: '0' })

const title = computed(() => (recordId.value == null ? '新增' : '编辑'))

/** 没有 UI 入口、但编辑保存时要原样带回的列（见文件头偏差 2） */
let passthrough: Pick<MatchTableConfig, 'tableId' | 'type' | 'delFlag'> = {}

/** 打开弹窗：传 record = 编辑（带 id），不传 = 新增（落各字段初始值） */
function open(record?: MatchTableConfig | null) {
  recordId.value = record?.id == null ? undefined : Number(record.id)
  passthrough = { tableId: record?.tableId, type: record?.type, delFlag: record?.delFlag }
  form.tableName = record?.tableName == null ? '' : String(record.tableName)
  form.selectionType = record?.selectionType == null ? 'text_selection' : String(record.selectionType)
  form.rule = record?.rule == null ? '' : String(record.rule)
  form.status = record?.status == null ? '0' : String(record.status)
  visible.value = true
}

function close() {
  visible.value = false
}

async function submit() {
  if (!form.tableName.trim()) {
    ElMessage.warning('请填写表名称')
    return
  }
  if (!form.selectionType) {
    ElMessage.warning('请选择选表类型')
    return
  }
  const payload: Partial<MatchTableConfig> = {
    ...passthrough,
    tableName: form.tableName.trim(),
    selectionType: form.selectionType,
    rule: form.rule,
    status: form.status,
  }
  if (recordId.value != null) payload.id = recordId.value

  saving.value = true
  try {
    await matchTableConfigApi.save(payload)
    ElMessage.success('操作成功')
    visible.value = false
    emit('saved', { mode: recordId.value == null ? 'add' : 'edit', id: recordId.value })
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '操作失败')
  } finally {
    saving.value = false
  }
}

defineExpose({ open, close })
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="800px"
    top="6vh"
    append-to-body
    :close-on-click-modal="false"
    class="mtc-edit-dialog"
  >
    <el-form class="mtc-edit-form" label-width="90px" @submit.prevent>
      <el-form-item label="表名称" required>
        <el-input v-model="form.tableName" placeholder="请输入" class="mtc-field" />
      </el-form-item>
      <el-form-item label="选表类型" required>
        <el-select v-model="form.selectionType" placeholder="请选择" class="mtc-field">
          <el-option v-for="option in MATCH_TABLE_SELECTION_TYPE_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="匹配规则">
        <el-input v-model="form.rule" type="textarea" :rows="3" placeholder="请输入" resize="vertical" />
      </el-form-item>
      <el-form-item label="状态">
        <el-radio-group v-model="form.status">
          <el-radio value="0">启用</el-radio>
          <el-radio value="1">禁用</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 13.6 寸屏幕基线（AGENTS.md 弹窗适配 + 滚动容器约定）：el-dialog 是 append-to-body 的 teleport，
   自定义 class 落在 .el-dialog 上但拿不到本组件的 scope 属性，必须走 :global（同 QuestionDicEditDialog）。 */
:global(.mtc-edit-dialog) {
  max-width: calc(100vw - 40px);
}
:global(.mtc-edit-dialog .el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding-top: 8px;
}
.mtc-edit-form :deep(.el-form-item) {
  margin-bottom: 14px;
}
.mtc-edit-form :deep(.el-form-item__label) {
  font-size: 12px;
  color: var(--rc-text-2, #475569);
}
.mtc-field {
  width: 100%;
}
</style>
