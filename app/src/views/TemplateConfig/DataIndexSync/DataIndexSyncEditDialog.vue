<script setup lang="ts">
// 数据索引同步编辑弹窗（1:1 对齐旧 ai-chat-view `src/demo/modal/DataIndexSyncConfigEditor.vue`）。
//
// 旧口径：
// · 七个字段：同步名称（comment）、表/主题（tableName）、同步类型（type 下拉 0/1/2）、
//   列名（columnName）、同步内容（syncSql）、前置sql（beforeSql）、后置sql（afterSql）；
// · 「新增」可填全部字段，type 初始值固定 2（分词同步）并带 status '0'；
// · 「编辑」把 同步名称 / 表/主题 / 同步类型 三项**置灰**（旧 :disabled="isEditor"），
//   只允许改列名与三段 sql —— 这不是缺陷，同步目标（表 + 名称）定了索引就锁了，1:1 保留；
// · 新增 POST /poc/data-index-sync、修改 POST /poc/data-index-sync/update，**两个端点**（同 dic / question-dic 域）。
//
// 与旧版的有意偏差（旧版缺陷，交付说明单列）：
// 1. 旧版提交不看校验：同步名称、表/主题留空也能存进库，存进去的是一条点「同步」只会空跑的索引配置。
//    这里三个必填（同步名称 / 表/主题 / 同步内容）直接拦下（同 sql 模板、表模板、自动补全、问句改写的修正先例）。
// 2. 旧版编辑时 `this.form = data` 把整行（含 createTime/updateTime/lastSync/delFlag）原样 POST 回去；
//    这里只提交表单字段 + id，另外**原样带回 aliasColumn / codeColumn**：后端实体有这两列但旧页面没有入口，
//    不带回会被更新语句写成 null（旧版发整行，恰好把它们带上了，行为等价）。
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { dataIndexSyncApi } from '@/api/templateConfig'
import type { DataIndexSync } from '@/api/types/template'
import { DATA_INDEX_SYNC_DEFAULT_TYPE, DATA_INDEX_SYNC_TYPE_OPTIONS } from './options'

const emit = defineEmits<{ (e: 'saved', payload: { mode: 'add' | 'edit'; id?: number }): void }>()

const visible = ref(false)
const saving = ref(false)
const recordId = ref<number | undefined>()

const form = reactive({
  comment: '',
  tableName: '',
  type: DATA_INDEX_SYNC_DEFAULT_TYPE as number,
  columnName: '',
  syncSql: '',
  beforeSql: '',
  afterSql: '',
})

const title = computed(() => (recordId.value == null ? '新增' : '编辑'))
/** 旧口径：编辑态锁住同步名称 / 表/主题 / 同步类型 */
const isEditor = computed(() => recordId.value != null)

/** 没有 UI 入口、但更新时要原样带回的两列（见文件头偏差 2） */
let passthrough: Pick<DataIndexSync, 'aliasColumn' | 'codeColumn'> = {}

/** 打开弹窗：传 record = 编辑（带 id），不传 = 新增 */
function open(record?: DataIndexSync | null) {
  recordId.value = record?.id == null ? undefined : Number(record.id)
  passthrough = { aliasColumn: record?.aliasColumn ?? null, codeColumn: record?.codeColumn ?? null }
  form.comment = record?.comment == null ? '' : String(record.comment)
  form.tableName = record?.tableName == null ? '' : String(record.tableName)
  // 新增固定 2（旧 form 初始值）；编辑按行里的值（真实响应是数字，兼容字符串码值）
  form.type = record?.type == null ? DATA_INDEX_SYNC_DEFAULT_TYPE : Number(record.type)
  form.columnName = record?.columnName == null ? '' : String(record.columnName)
  form.syncSql = record?.syncSql == null ? '' : String(record.syncSql)
  form.beforeSql = record?.beforeSql == null ? '' : String(record.beforeSql)
  form.afterSql = record?.afterSql == null ? '' : String(record.afterSql)
  visible.value = true
}

function close() {
  visible.value = false
}

async function submit() {
  if (!form.comment.trim()) {
    ElMessage.warning('请填写同步名称')
    return
  }
  if (!form.tableName.trim()) {
    ElMessage.warning('请填写表/主题')
    return
  }
  if (!form.syncSql.trim()) {
    ElMessage.warning('请填写同步内容')
    return
  }
  const payload: Partial<DataIndexSync> = {
    comment: form.comment,
    tableName: form.tableName,
    type: form.type,
    columnName: form.columnName,
    syncSql: form.syncSql,
    beforeSql: form.beforeSql,
    afterSql: form.afterSql,
    ...passthrough,
  }
  if (recordId.value == null) {
    // 旧新增弹窗的 form 初始值：状态恒为 '0'（启用），列表没有启停入口
    payload.status = '0'
  } else {
    payload.id = recordId.value
  }

  saving.value = true
  try {
    await dataIndexSyncApi.save(payload)
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
    class="dis-edit-dialog"
  >
    <el-form class="dis-edit-form" label-width="90px" @submit.prevent>
      <el-form-item label="同步名称" required>
        <el-input v-model="form.comment" :disabled="isEditor" placeholder="请输入" class="dis-field" />
      </el-form-item>
      <el-form-item label="表/主题" required>
        <el-input v-model="form.tableName" :disabled="isEditor" placeholder="请输入" class="dis-field" />
      </el-form-item>
      <el-form-item label="同步类型" required>
        <el-select v-model="form.type" :disabled="isEditor" placeholder="请选择" class="dis-field">
          <el-option v-for="option in DATA_INDEX_SYNC_TYPE_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="列名">
        <el-input v-model="form.columnName" placeholder="请输入" class="dis-field" />
      </el-form-item>
      <el-form-item label="同步内容" required>
        <el-input v-model="form.syncSql" type="textarea" :rows="3" placeholder="请输入" resize="vertical" />
      </el-form-item>
      <el-form-item label="前置sql">
        <el-input v-model="form.beforeSql" type="textarea" :rows="3" placeholder="请输入" resize="vertical" />
      </el-form-item>
      <el-form-item label="后置sql">
        <el-input v-model="form.afterSql" type="textarea" :rows="3" placeholder="请输入" resize="vertical" />
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
   自定义 class 落在 .el-dialog 上但拿不到本组件的 scope 属性，必须走 :global（同 TableTemplateEditDialog）。 */
:global(.dis-edit-dialog) {
  max-width: calc(100vw - 40px);
}
:global(.dis-edit-dialog .el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding-top: 8px;
}
.dis-edit-form :deep(.el-form-item) {
  margin-bottom: 14px;
}
.dis-edit-form :deep(.el-form-item__label) {
  font-size: 12px;
  color: var(--rc-text-2, #475569);
}
.dis-field {
  width: 100%;
}
</style>
