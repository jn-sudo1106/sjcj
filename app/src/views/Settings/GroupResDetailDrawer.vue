<script setup lang="ts">
// 系统设置 → 数据权限设置 → 规则详情（右侧抽屉，AGENTS.md 详情弹层约定）。
// 字段就是 sys_group_res 一行（接口文档-组数据权限.md §1），resCond 可能很长，保留换行并可滚动。
// STRUCT 规则把 condJson 渲染成人类可读条件行（字段中文名 + 操作符 + 值），resCond 标注为后端编译产物；
// SQL 存量规则已停止编辑（D2②），详情页给出只读提示。组 ID 显示「名称（ID）」（组名来自本机自录映射）。
import { computed } from 'vue'
import { parseCondJson, type GroupResMeta, type GroupResRule } from '@/api/groupRes'
import { groupLabel } from '@/utils/groupNames'

const props = defineProps<{ modelValue: boolean; rule: GroupResRule | null; meta: GroupResMeta | null }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

/** resType / action / condType 展示成 meta 里的中文名，取不到就回原始 key */
function optionName(list: { key: string; name: string }[] | undefined, key: string | null): string {
  if (!key) return '—'
  const hit = list?.find((o) => o.key === key)
  return hit ? `${hit.name}（${key}）` : key
}

const idColumn = computed(() => props.meta?.resTypes.find((t) => t.key === props.rule?.resType)?.idColumn ?? '')

/** condJson 的可读条件行：字段用白名单中文名，值原样展示；解析失败回空（照旧展示 JSON 原文） */
const condRows = computed(() => {
  if (props.rule?.condType !== 'STRUCT') return []
  const fields = props.meta?.resTypes.find((t) => t.key === props.rule?.resType)?.fields ?? []
  return parseCondJson(props.rule.condJson).map((item) => ({
    fieldName: fields.find((f) => f.field === item.field)?.name ?? item.field,
    field: item.field,
    op: item.op,
    values: item.values.join(', '),
  }))
})
</script>

<template>
  <el-drawer v-model="visible" :title="rule ? `数据权限规则 · ${rule.id}` : '数据权限规则'" size="460px">
    <dl v-if="rule" class="gr-detail">
      <dt>规则 ID</dt>
      <dd>{{ rule.id }}</dd>
      <dt>数据权限组</dt>
      <dd data-testid="group-res-detail-group">{{ groupLabel(rule.groupId) }}</dd>
      <dt>行为</dt>
      <dd>{{ optionName(meta?.actions, rule.action) }}</dd>
      <dt>内容类型</dt>
      <dd>{{ optionName(meta?.resTypes, rule.resType) }}</dd>
      <dt>命中列</dt>
      <dd>{{ idColumn || '—' }}</dd>
      <dt>条件类型</dt>
      <dd>
        {{ optionName(meta?.condTypes, rule.condType) }}
        <el-tag v-if="rule.condType === 'SQL'" type="warning" size="small" data-testid="group-res-detail-sql-readonly">已停止编辑</el-tag>
      </dd>
      <template v-if="rule.condType === 'STRUCT' && condRows.length">
        <dt>条件（AND）</dt>
        <dd class="gr-cond-rows" data-testid="group-res-detail-condrows">
          <div v-for="(row, i) in condRows" :key="i" class="gr-cond-row">
            <span class="gr-cond-field">{{ row.fieldName }}（{{ row.field }}）</span>
            <span class="gr-cond-op">{{ row.op }}</span>
            <span class="gr-cond-values">{{ row.values }}</span>
          </div>
        </dd>
        <dt>编译产物</dt>
        <dd class="gr-cond">{{ rule.resCond || '—' }}</dd>
      </template>
      <template v-else>
        <dt>条件内容</dt>
        <dd class="gr-cond">{{ rule.resCond || '—' }}</dd>
        <template v-if="rule.condJson">
          <dt>结构化条件</dt>
          <dd class="gr-cond">{{ rule.condJson }}</dd>
        </template>
      </template>
      <dt>备注</dt>
      <dd>{{ rule.remarks || '—' }}</dd>
      <dt>状态</dt>
      <dd>{{ rule.isDelete === 0 ? '在用' : '已删除' }}</dd>
    </dl>
  </el-drawer>
</template>

<style scoped>
.gr-detail { display: grid; grid-template-columns: 104px 1fr; gap: 10px 12px; margin: 0; font-size: 13px; }
.gr-detail dt { color: var(--rc-muted); }
.gr-detail dd { margin: 0; color: var(--rc-text); word-break: break-all; white-space: pre-wrap; }
.gr-cond { font-family: var(--rc-font-mono, ui-monospace, monospace); background: #f8fafc; border-radius: 6px; padding: 6px 8px; }
.gr-cond-rows { display: flex; flex-direction: column; gap: 4px; }
.gr-cond-row { display: flex; gap: 6px; align-items: baseline; background: #f8fafc; border-radius: 6px; padding: 4px 8px; }
.gr-cond-field { color: var(--rc-text); }
.gr-cond-op { font-family: var(--rc-font-mono, ui-monospace, monospace); color: var(--rc-muted); flex-shrink: 0; }
.gr-cond-values { font-family: var(--rc-font-mono, ui-monospace, monospace); word-break: break-all; }
</style>
