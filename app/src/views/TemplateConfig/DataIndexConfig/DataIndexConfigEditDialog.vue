<script setup lang="ts">
// 数据字典编辑弹窗（1:1 对齐旧 ai-chat-view `src/demo/modal/DataIndexConfigEditor.vue`）。
//
// 旧口径：
// · 四个字段：编码（code）、类型（type）、内容（content）、别名（alias），
//   前三项**恒置灰**（旧 :disabled="true"，新增和编辑都不可改），页面上唯一能填的就是「别名」；
//   这就是旧平台「新增」的真实形态 —— 字典项的 code/type/content 由数据索引同步那侧产出，
//   本页只负责给人看的别名，不是缺陷，1:1 保留；
// · 别名是 100 字以内的多行文本（旧 a-textarea :maxLength="100"）；
// · 状态选择（radio）在旧弹窗里整段注释掉了，新增时 status 恒为 '0'（启用）；
// · 新增 POST /poc/data-index-config、修改 POST /poc/data-index-config/update，**两个端点**（同 dic / question-dic 域）。
//
// 与旧版的有意偏差（旧版缺陷，交付说明单列）：
// 1. 旧版 doEdit 里 `this.form = data` 把**列表行对象本身**当表单，编辑到一半取消也会改脏表格里那一行；
//    这里把字段拷进独立表单，不碰行数据。
// 2. 旧版提交不看校验，别名留空也能存进库（存进去是一条既没编码也没别名、页面上无从辨识的字典项）；
//    这里「别名」必填直接拦下（同表模板、自动补全、数据索引同步的修正先例）。
// 3. 旧版编辑时把整行（含 createTime/updateTime/delFlag）原样 POST 回去；这里只提交别名 + id，
//    另外**原样带回 code / type / content / contentCode**：页面上这四项锁死不可改，不带回会被更新语句写成 null
//    （旧版发整行，恰好把它们带上了，行为等价）。
// 4. 旧组件的 name 写成了 'DicEditModal'（从自动补全弹窗复制过来的残留），这里用与本域一致的名字。
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { dataIndexConfigApi } from '@/api/templateConfig'
import type { DataIndexConfig } from '@/api/types/template'

const emit = defineEmits<{ (e: 'saved', payload: { mode: 'add' | 'edit'; id?: number }): void }>()

const visible = ref(false)
const saving = ref(false)
const recordId = ref<number | undefined>()

const form = reactive({ code: '', type: '', content: '', alias: '' })

const title = computed(() => (recordId.value == null ? '新增' : '编辑'))

/** 没有 UI 入口、但更新时要原样带回的字段（见文件头偏差 3） */
let passthrough: Pick<DataIndexConfig, 'contentCode'> = {}

/** 打开弹窗：传 record = 编辑（带 id），不传 = 新增（旧 doEdit('', false)） */
function open(record?: DataIndexConfig | null) {
  recordId.value = record?.id == null ? undefined : Number(record.id)
  passthrough = { contentCode: record?.contentCode ?? null }
  form.code = record?.code == null ? '' : String(record.code)
  form.type = record?.type == null ? '' : String(record.type)
  form.content = record?.content == null ? '' : String(record.content)
  form.alias = record?.alias == null ? '' : String(record.alias)
  visible.value = true
}

function close() {
  visible.value = false
}

async function submit() {
  if (!form.alias.trim()) {
    ElMessage.warning('请填写别名')
    return
  }
  const payload: Partial<DataIndexConfig> = {
    code: form.code,
    type: form.type,
    content: form.content,
    alias: form.alias,
    ...passthrough,
  }
  if (recordId.value == null) {
    // 旧新增弹窗的 form 初始值：状态恒为 '0'（启用），弹窗里没有状态选择入口
    payload.status = '0'
  } else {
    payload.id = recordId.value
  }

  saving.value = true
  try {
    await dataIndexConfigApi.save(payload)
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
    class="dic-edit-dialog"
  >
    <el-form class="dic-edit-form" label-width="70px" @submit.prevent>
      <el-form-item label="编码">
        <el-input v-model="form.code" disabled placeholder="" class="dic-field" />
      </el-form-item>
      <el-form-item label="类型">
        <el-input v-model="form.type" disabled placeholder="" class="dic-field" />
      </el-form-item>
      <el-form-item label="内容">
        <el-input v-model="form.content" disabled placeholder="" class="dic-field" />
      </el-form-item>
      <el-form-item label="别名" required>
        <el-input
          v-model="form.alias"
          type="textarea"
          :rows="3"
          :maxlength="100"
          placeholder="请输入"
          resize="vertical"
        />
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
:global(.dic-edit-dialog) {
  max-width: calc(100vw - 40px);
}
:global(.dic-edit-dialog .el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding-top: 8px;
}
.dic-edit-form :deep(.el-form-item) {
  margin-bottom: 14px;
}
.dic-edit-form :deep(.el-form-item__label) {
  font-size: 12px;
  color: var(--rc-text-2, #475569);
}
.dic-field {
  width: 100%;
}
</style>
