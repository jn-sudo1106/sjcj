<script setup lang="ts">
import { computed } from 'vue'
import type { DataTableMeta } from '../../api'

const props = defineProps<{ modelValue: boolean; tableMeta: DataTableMeta | null }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

type TableField = DataTableMeta['fields'][number]
function fieldMeta(field: TableField) {
  return [
    `长度:${field.width ?? '—'}`,
    `必填:${field.required ? '是' : '否'}`,
    `去重:${field.dedup ? '是' : '否'}`,
    field.preprocess ? `预处理:${field.preprocess}` : '',
    field.checkRule ? `校验:${field.checkRule}` : '',
    field.sample ? `示例:${field.sample}` : '',
  ].filter(Boolean).join(' · ')
}
</script>

<template>
  <el-drawer v-model="visible" title="表结构详情" size="600px" append-to-body>
    <template v-if="tableMeta">
      <dl class="rc-kv">
        <dt>表 ID</dt>
        <dd>{{ tableMeta.tableId }}</dd>
        <dt>表名称</dt>
        <dd>{{ tableMeta.name || '—' }}</dd>
        <dt>物理表名</dt>
        <dd>{{ tableMeta.tableName }}</dd>
        <dt>数据量</dt>
        <dd>{{ tableMeta.rowCount }}</dd>
        <dt>状态</dt>
        <dd>{{ tableMeta.state || '—' }}</dd>
        <dt>去重列</dt>
        <dd>{{ tableMeta.keyField || '—' }}</dd>
        <dt>备注</dt>
        <dd>{{ tableMeta.remark || '—' }}</dd>
        <dt>更新时间</dt>
        <dd>{{ tableMeta.updatedAt || '—' }}</dd>
        <dt>记录变更</dt>
        <dd>{{ tableMeta.recFlag ?? '—' }}</dd>
        <dt>校验标识</dt>
        <dd>{{ tableMeta.checkFlag ?? '—' }}</dd>
        <dt>校验规则</dt>
        <dd>{{ tableMeta.checkRule || '—' }}</dd>
        <dt>核心参数</dt>
        <dd>{{ tableMeta.coreParam || '—' }}</dd>
      </dl>
      <div class="dv-section">字段列表（{{ tableMeta.fields.length }}）</div>
      <el-table :data="tableMeta.fields" class="td-fields" style="width: 100%" size="small" border>
        <el-table-column prop="seq" label="序号" width="42" />
        <el-table-column prop="itemId" label="字段ID" width="72" />
        <el-table-column prop="prop" label="字段编码" width="90" show-overflow-tooltip />
        <el-table-column prop="columnName" label="物理列名" width="58" />
        <el-table-column prop="desc" label="字段描述" width="90" show-overflow-tooltip />
        <el-table-column prop="type" label="类型" width="62" />
        <el-table-column label="属性" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ fieldMeta(row) }}</template>
        </el-table-column>
      </el-table>
    </template>
  </el-drawer>
</template>

<style scoped>
.dv-section {
  margin: 18px 0 8px;
  color: var(--rc-text);
  font-size: 13px;
  font-weight: 700;
}
</style>
