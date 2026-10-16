<script setup lang="ts">
// 实体改写编辑弹窗（1:1 对齐旧 ai-chat-view src/demo/modal/EntityRewriteConfigEditor.vue）。
//
// 旧口径：
// · 五个字段：实体名称（文本框）、替换类型（下拉，正则替换 / 简单替换）、替换内容（文本框）、
//   目标内容（文本框）、状态（单选 启用/禁用）；弹窗宽 800px。
// · 新增与修改是**同一个端点**（旧 editor 函数 → POST /poc/entity-rewrite-config，body 带 id 即更新），
//   由 api 层的 CRUD 工厂承担。
//
// 与旧版的有意偏差（旧版缺陷或项目约定，交付说明单列）：
// 1. 旧版提交不看校验：实体名称留空也能存进库。这里拦两个必填（实体名称 / 替换类型），同选表规则、sql 模板的先例。
// 2. 旧版 data() 里的新增默认值写的是 `replaceType: 'regular_replacement'`，而模板 v-model 绑的是 form.cleanType
//   （Editor.vue:23），两个字段名对不上 —— 结果是新增时「替换类型」压根没有默认值，同时往库里发了一个
//   没人认得的 replaceType。这里把默认值落到 cleanType 上（正则替换），replaceType 不再发（列定义见 EntityRewriteConfigList.vue:96-100）。
// 3. 旧版标题写死「编辑」（a-modal title="编辑"），新增时也显示编辑；这里按新增 / 编辑分别取标题（同其余基础配置弹窗）。
// 4. 旧版编辑时 `this.form = data` 把整行原样 POST 回去。这里不回传 createTime/updateTime（同其余模板域弹窗），
//   但**原样带回表单五个字段以外的所有列** —— 本域真实行还没抓到（186 分页回 500，见 api/endpoints.ts），
//   有没有 delFlag 之类的隐藏列未知；整行回传正是旧版把它们带回去的方式，未确认后端实现前不冒丢列的险
//   （选表规则的 tableId/type/delFlag、数据字典的 code/contentCode 同先例）。
// 5. 旧版状态的单选值是**数字** 0/1（列表用 row.status == 0 松散比较），本域 status 统一按字符串 '0'/'1' 走
//   （见 api/types/template.ts 的 TemplateRow），回填时先 String() 归一。
// 6. 旧版新增时 status 是 undefined（由后端兜底），这里显式发 '0' 启用；旧版取消一次后 form 被清成 {}，
//   下次打开新增连默认值都没了，这里每次 open 都重置成初始值。
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { entityRewriteConfigApi } from '@/api/templateConfig'
import type { EntityRewriteConfig } from '@/api/types/template'
import { ENTITY_REWRITE_CLEAN_TYPE_OPTIONS } from './options'

const emit = defineEmits<{ (e: 'saved', payload: { mode: 'add' | 'edit'; id?: number }): void }>()

const visible = ref(false)
const saving = ref(false)
const recordId = ref<number | undefined>()

const form = reactive({ entityName: '', cleanType: 'regular_replacement', content: '', targetContent: '', status: '0' })

const title = computed(() => (recordId.value == null ? '新增' : '编辑'))

/** 表单自己管 + 时间戳列，其余列编辑保存时原样带回（见文件头偏差 4） */
const OWNED_KEYS = ['id', 'createTime', 'updateTime', 'entityName', 'cleanType', 'content', 'targetContent', 'status']

/** 没有 UI 入口、但编辑保存时要原样带回的列 */
let passthrough: Record<string, unknown> = {}

function pickPassthrough(record?: EntityRewriteConfig | null): Record<string, unknown> {
  if (!record) return {}
  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (!OWNED_KEYS.includes(key) && value !== undefined) rest[key] = value
  }
  return rest
}

/** 打开弹窗：传 record = 编辑（带 id），不传 = 新增（落各字段初始值） */
function open(record?: EntityRewriteConfig | null) {
  recordId.value = record?.id == null ? undefined : Number(record.id)
  passthrough = pickPassthrough(record)
  form.entityName = record?.entityName == null ? '' : String(record.entityName)
  form.cleanType = record?.cleanType == null ? 'regular_replacement' : String(record.cleanType)
  form.content = record?.content == null ? '' : String(record.content)
  form.targetContent = record?.targetContent == null ? '' : String(record.targetContent)
  form.status = record?.status == null ? '0' : String(record.status)
  visible.value = true
}

function close() {
  visible.value = false
}

async function submit() {
  if (!form.entityName.trim()) {
    ElMessage.warning('请填写实体名称')
    return
  }
  if (!form.cleanType) {
    ElMessage.warning('请选择替换类型')
    return
  }
  const payload: Partial<EntityRewriteConfig> = {
    ...passthrough,
    entityName: form.entityName.trim(),
    cleanType: form.cleanType,
    content: form.content,
    targetContent: form.targetContent,
    status: form.status,
  }
  if (recordId.value != null) payload.id = recordId.value

  saving.value = true
  try {
    await entityRewriteConfigApi.save(payload)
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
    class="erc-edit-dialog"
  >
    <el-form class="erc-edit-form" label-width="90px" @submit.prevent>
      <el-form-item label="实体名称" required>
        <el-input v-model="form.entityName" placeholder="请输入" class="erc-field" />
      </el-form-item>
      <el-form-item label="替换类型" required>
        <el-select v-model="form.cleanType" placeholder="请选择" class="erc-field">
          <el-option v-for="option in ENTITY_REWRITE_CLEAN_TYPE_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="替换内容">
        <el-input v-model="form.content" placeholder="请输入" class="erc-field" />
      </el-form-item>
      <el-form-item label="目标内容">
        <el-input v-model="form.targetContent" placeholder="请输入" class="erc-field" />
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
:global(.erc-edit-dialog) {
  max-width: calc(100vw - 40px);
}
:global(.erc-edit-dialog .el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding-top: 8px;
}
.erc-edit-form :deep(.el-form-item) {
  margin-bottom: 14px;
}
.erc-edit-form :deep(.el-form-item__label) {
  font-size: 12px;
  color: var(--rc-text-2, #475569);
}
.erc-field {
  width: 100%;
}
</style>
