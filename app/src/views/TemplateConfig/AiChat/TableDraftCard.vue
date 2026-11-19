<script setup lang="ts">
// 智能体对话建表的确认卡片：展示智能体给出的表草稿，用户可直接改，确认后由页面调 entrySave 落库。
// 卡片只负责编辑和校验，不发请求；状态（创建中/已创建/失败/已取消）由父级写回 TableDraftState。
// 设计：设计稿/设计方案/1118-智能体对话建源建表_开发设计方案_2026-11-18.md
import { computed, ref, watch } from 'vue'
import {
  TABLE_DRAFT_FIELD_TYPES,
  validateTableDraft,
  type TableDraft,
  type TableDraftState,
} from '@/utils/aiChat/tableDraft'

const props = withDefaults(defineProps<{
  state: TableDraftState
  /** 对话正在流式响应时禁止确认，避免和下一轮回传消息打架 */
  disabled?: boolean
}>(), {
  disabled: false,
})

const emit = defineEmits<{
  (e: 'confirm', draft: TableDraft): void
  (e: 'cancel'): void
}>()

const TYPE_LABELS: Record<string, string> = {
  string: '字符串',
  text: '文本',
  longtext: '长文本',
  url: '链接',
  number: '数值',
  date: '日期',
  json: 'JSON',
}

const form = ref<TableDraft>(cloneDraft(props.state.draft))
const touched = ref(false)

watch(() => props.state.draft, (draft) => {
  form.value = cloneDraft(draft)
  touched.value = false
})

function cloneDraft(draft: TableDraft): TableDraft {
  return { ...draft, fields: draft.fields.map((f) => ({ ...f })) }
}

const editable = computed(() => props.state.status === 'pending' || props.state.status === 'failed')
const errors = computed(() => validateTableDraft(form.value))
const dedupCount = computed(() => form.value.fields.filter((f) => f.dedup).length)

function addField() {
  form.value.fields.push({ code: '', desc: '', type: 'string', dedup: false })
}

function removeField(index: number) {
  form.value.fields.splice(index, 1)
}

function onConfirm() {
  touched.value = true
  if (errors.value.length || props.disabled) return
  emit('confirm', cloneDraft(form.value))
}
</script>

<template>
  <div class="td-card" :class="state.status" data-testid="table-draft-card">
    <div class="td-head">
      <span class="td-title"><span class="td-dot" />建表草稿</span>
      <span v-if="state.status === 'pending'" class="td-hint">核对后点「确认创建」才会真正建表，可直接修改</span>
      <span v-else-if="state.status === 'creating'" class="td-hint">正在创建…</span>
      <span v-else-if="state.status === 'created'" class="td-status ok" data-testid="table-draft-created">已创建</span>
      <span v-else-if="state.status === 'failed'" class="td-status err">创建失败，可修改后重试</span>
      <span v-else class="td-status muted">已取消</span>
    </div>

    <div class="td-grid">
      <label class="td-field">
        <span>表名称</span>
        <el-input v-model="form.name" size="small" :disabled="!editable" data-testid="table-draft-name" />
      </label>
      <label class="td-field">
        <span>物理表名</span>
        <el-input v-model="form.tableName" size="small" :disabled="!editable" data-testid="table-draft-table-name" />
      </label>
      <label class="td-field">
        <span>存储类型</span>
        <el-select v-model="form.dsKind" size="small" :disabled="!editable" data-testid="table-draft-ds-kind">
          <el-option label="MySQL" value="MYSQL" />
          <el-option label="ClickHouse（CK）" value="CK" />
        </el-select>
      </label>
      <label class="td-field td-wide">
        <span>说明</span>
        <el-input v-model="form.remark" size="small" :disabled="!editable" />
      </label>
    </div>

    <div class="td-table-wrap">
      <table class="td-table">
        <thead>
          <tr>
            <th class="td-col-idx">#</th>
            <th>字段编码</th>
            <th>展示名</th>
            <th class="td-col-type">类型</th>
            <th class="td-col-dedup">去重</th>
            <th v-if="editable" class="td-col-op" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(field, index) in form.fields" :key="index" data-testid="table-draft-field-row">
            <td class="td-col-idx">{{ index + 1 }}</td>
            <td><el-input v-model="field.code" size="small" :disabled="!editable" /></td>
            <td><el-input v-model="field.desc" size="small" :disabled="!editable" /></td>
            <td class="td-col-type">
              <el-select v-model="field.type" size="small" :disabled="!editable">
                <el-option v-for="t in TABLE_DRAFT_FIELD_TYPES" :key="t" :label="TYPE_LABELS[t]" :value="t" />
              </el-select>
            </td>
            <td class="td-col-dedup"><el-checkbox v-model="field.dedup" :disabled="!editable" /></td>
            <td v-if="editable" class="td-col-op">
              <el-button link size="small" type="danger" @click="removeField(index)">删除</el-button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="editable" class="td-row-actions">
      <el-button link size="small" type="primary" data-testid="table-draft-add-field" @click="addField">+ 添加字段</el-button>
      <span class="td-hint">共 {{ form.fields.length }} 个字段，去重字段 {{ dedupCount }} 个；物理列按 K1、K2… 顺序分配</span>
    </div>

    <ul v-if="editable && touched && errors.length" class="td-errors" data-testid="table-draft-errors">
      <li v-for="err in errors" :key="err">{{ err }}</li>
    </ul>
    <div v-if="state.status === 'failed' && state.error" class="td-errors" data-testid="table-draft-error">{{ state.error }}</div>

    <div v-if="state.status === 'created'" class="td-result" data-testid="table-draft-result">
      表 ID <strong>{{ state.tableId }}</strong>，物理表 {{ form.tableName }}
      <router-link :to="{ path: '/data', query: { tab: 'entry', entryTypeId: state.tableId } }" class="td-link">在数据中心查看</router-link>
    </div>

    <div v-if="editable" class="td-actions">
      <el-button size="small" data-testid="table-draft-cancel" @click="emit('cancel')">取消</el-button>
      <el-button
        size="small"
        type="primary"
        :disabled="disabled"
        data-testid="table-draft-confirm"
        @click="onConfirm"
      >
        {{ state.status === 'failed' ? '重新创建' : '确认创建' }}
      </el-button>
    </div>
    <div v-else-if="state.status === 'creating'" class="td-actions">
      <el-button size="small" type="primary" loading>创建中</el-button>
    </div>
  </div>
</template>

<style scoped>
.td-card {
  margin-top: 10px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: #f8fafc;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.td-card.created { border-color: #bbf7d0; background: #f6fef9; }
.td-card.cancelled { opacity: 0.75; }

.td-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 13px; color: #334155; }
.td-title { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
.td-dot { width: 6px; height: 6px; border-radius: 50%; background: #3b82f6; }
.td-hint { font-size: 12px; color: #94a3b8; }
.td-status { font-size: 12px; }
.td-status.ok { color: #16a34a; }
.td-status.err { color: #dc2626; }
.td-status.muted { color: #94a3b8; }

.td-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 12px; }
.td-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #64748b; min-width: 0; }
.td-wide { grid-column: 1 / -1; }

.td-table-wrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; }
.td-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.td-table th { background: #f8fafc; color: #475569; font-weight: 600; text-align: left; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
.td-table td { padding: 4px 8px; border-bottom: 1px solid #f1f5f9; }
.td-table tr:last-child td { border-bottom: none; }
.td-col-idx { width: 32px; color: #94a3b8; }
.td-col-type { width: 110px; }
.td-col-dedup { width: 48px; text-align: center; }
.td-col-op { width: 52px; }

.td-row-actions { display: flex; align-items: center; gap: 12px; }
.td-errors { margin: 0; padding: 8px 12px 8px 26px; border-radius: 6px; background: #fef2f2; color: #b91c1c; font-size: 12px; line-height: 1.6; }
div.td-errors { padding-left: 12px; }
.td-result { font-size: 13px; color: #166534; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.td-link { color: var(--el-color-primary); text-decoration: none; }
.td-link:hover { text-decoration: underline; }
.td-actions { display: flex; justify-content: flex-end; gap: 8px; }

@media (max-width: 720px) {
  .td-grid { grid-template-columns: 1fr; }
}
</style>
