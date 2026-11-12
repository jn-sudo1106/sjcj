<script setup lang="ts">
// 表改写编辑弹窗（1:1 对齐旧 ai-chat-view src/demo/modal/ReplaceTableConfigEditor.vue）。
//
// 旧口径：
// · 四个字段：表名称（文本框）、替换表名称（文本框）、替换类型（下拉，旧平台只有 unionall 一项）、
//   状态（单选 启用/禁用）；弹窗宽 800px。
// · 新增与修改是**同一个端点**（旧 editor 函数 → POST /poc/replace-table-config，body 带 id 即更新），
//   与 question-dic / chat-flow-step 那种「新增/修改分两个端点」的域不同，由 api 层的 CRUD 工厂承担。
//
// 与旧版的有意偏差（旧版缺陷或项目约定，交付说明单列）：
// 1. 旧版提交不看校验：表名称与替换表都留空也能存进库，存进去的是一条谁也不会命中、或把表换成空的改写规则。
//    这里拦两个必填（表名称 / 替换表名称），同选表规则配置、sql 模板、问句改写的修正先例。
// 2. 旧版编辑时 `this.form = data` 把整行原样 POST 回去。这里不回传 createTime/updateTime（同其余模板域弹窗），
//    但**原样带回 delFlag** —— 2026-10-15 在 186 抓样的真实行带这一列（恒 '0'），页面既没入口也不能改，
//    整行回传正是旧版把它带回去的方式；漏掉就等于赌后端的更新语句跳过 null（选表规则配置的 tableId/type/delFlag 同先例）。
// 3. 旧版状态的单选值是**数字** 0/1（列表用 row.status == 0 松散比较），本域 status 统一按字符串
//    '0'/'1' 走（见 api/types/template.ts 的 TemplateRow），回填时先 String() 归一。
// 4. 旧版新增时 status 是 undefined（由后端兜底），这里显式发 '0' 启用，与选表规则配置的新增口径一致；
//    旧版取消一次后 form 被清成 {}，下次打开新增连 replaceType 的默认值都没了，这里每次 open 都重置成初始值。
// 5. 旧版表单里声明的是 `name` 而输入框绑的是 `form.tableName`（ReplaceTableConfigEditor.vue:18、58-65 两个名字），
//    实体与列表列都是 tableName，这里统一按 tableName 提交（实测后端认的就是它）。
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { replaceTableConfigApi } from '@/api/templateConfig'
import type { ReplaceTableConfig } from '@/api/types/template'
import { REPLACE_TABLE_TYPE_OPTIONS } from './options'

const emit = defineEmits<{ (e: 'saved', payload: { mode: 'add' | 'edit'; id?: number }): void }>()

const visible = ref(false)
const saving = ref(false)
const recordId = ref<number | undefined>()

const form = reactive({ tableName: '', replaceTableName: '', replaceType: 'unionall', status: '0' })

const title = computed(() => (recordId.value == null ? '新增' : '编辑'))

/** 没有 UI 入口、但编辑保存时要原样带回的列（见文件头偏差 2） */
let passthrough: Pick<ReplaceTableConfig, 'delFlag'> = {}

/** 打开弹窗：传 record = 编辑（带 id），不传 = 新增（落各字段初始值） */
function open(record?: ReplaceTableConfig | null) {
  recordId.value = record?.id == null ? undefined : Number(record.id)
  passthrough = { delFlag: record?.delFlag }
  form.tableName = record?.tableName == null ? '' : String(record.tableName)
  form.replaceTableName = record?.replaceTableName == null ? '' : String(record.replaceTableName)
  form.replaceType = record?.replaceType == null ? 'unionall' : String(record.replaceType)
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
  if (!form.replaceTableName.trim()) {
    ElMessage.warning('请填写替换表名称')
    return
  }
  const payload: Partial<ReplaceTableConfig> = {
    ...passthrough,
    tableName: form.tableName.trim(),
    replaceTableName: form.replaceTableName.trim(),
    replaceType: form.replaceType,
    status: form.status,
  }
  if (recordId.value != null) payload.id = recordId.value

  saving.value = true
  try {
    await replaceTableConfigApi.save(payload)
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
    class="rtc-edit-dialog"
  >
    <el-form class="rtc-edit-form" label-width="100px" @submit.prevent>
      <el-form-item label="表名称" required>
        <el-input v-model="form.tableName" placeholder="请输入" class="rtc-field" />
      </el-form-item>
      <el-form-item label="替换表名称" required>
        <el-input v-model="form.replaceTableName" placeholder="请输入替换表名称" class="rtc-field" />
      </el-form-item>
      <el-form-item label="替换类型" required>
        <el-select v-model="form.replaceType" placeholder="请选择" class="rtc-field">
          <el-option v-for="option in REPLACE_TABLE_TYPE_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
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
   自定义 class 落在 .el-dialog 上但拿不到本组件的 scope 属性，必须走 :global（同 MatchTableConfigEditDialog）。 */
:global(.rtc-edit-dialog) {
  max-width: calc(100vw - 40px);
}
:global(.rtc-edit-dialog .el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding-top: 8px;
}
.rtc-edit-form :deep(.el-form-item) {
  margin-bottom: 14px;
}
.rtc-edit-form :deep(.el-form-item__label) {
  font-size: 12px;
  color: var(--rc-text-2, #475569);
}
.rtc-field {
  width: 100%;
}
</style>
