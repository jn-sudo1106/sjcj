<script setup lang="ts">
// 系统设置 → 数据权限设置 → 规则详情（右侧抽屉，AGENTS.md 详情弹层约定）。
// 字段就是 sys_group_res 一行（接口文档-组数据权限.md §1），resCond 可能很长，保留换行并可滚动。
import { computed } from 'vue'
import type { GroupResMeta, GroupResRule } from '@/api/groupRes'

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
</script>

<template>
  <el-drawer v-model="visible" :title="rule ? `数据权限规则 · ${rule.id}` : '数据权限规则'" size="460px">
    <dl v-if="rule" class="gr-detail">
      <dt>规则 ID</dt>
      <dd>{{ rule.id }}</dd>
      <dt>用户组 ID</dt>
      <dd>{{ rule.groupId }}</dd>
      <dt>行为</dt>
      <dd>{{ optionName(meta?.actions, rule.action) }}</dd>
      <dt>内容类型</dt>
      <dd>{{ optionName(meta?.resTypes, rule.resType) }}</dd>
      <dt>命中列</dt>
      <dd>{{ idColumn || '—' }}</dd>
      <dt>条件类型</dt>
      <dd>{{ optionName(meta?.condTypes, rule.condType) }}</dd>
      <dt>条件内容</dt>
      <dd class="gr-cond">{{ rule.resCond || '—' }}</dd>
      <dt>结构化条件</dt>
      <dd class="gr-cond">{{ rule.condJson || '—' }}</dd>
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
</style>
