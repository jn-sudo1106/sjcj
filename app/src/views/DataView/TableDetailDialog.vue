<script setup lang="ts">
import { computed } from 'vue'
import type { DataTableMeta } from '../../api'

const props = defineProps<{ modelValue: boolean; tableMeta: DataTableMeta | null }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})
</script>

<template>
  <el-dialog v-model="visible" title="表结构详情" width="720px">
    <template v-if="tableMeta">
      <dl class="rc-kv">
        <dt>表 ID</dt>
        <dd>{{ tableMeta.tableId }}</dd>
        <dt>物理表名</dt>
        <dd>{{ tableMeta.tableName }}</dd>
        <dt>数据量</dt>
        <dd>{{ tableMeta.rowCount }}</dd>
        <dt>状态</dt>
        <dd>{{ tableMeta.state || '—' }}</dd>
        <dt>去重列</dt>
        <dd>{{ tableMeta.keyField || '—' }}</dd>
      </dl>
      <el-table :data="tableMeta.fields" style="width: 100%; margin-top: 12px" size="small" max-height="420">
        <el-table-column prop="columnName" label="列名" width="90" />
        <el-table-column prop="desc" label="字段描述" />
        <el-table-column prop="type" label="类型" width="100" />
        <el-table-column prop="sample" label="示例值" width="160" />
        <el-table-column label="必填" width="70">
          <template #default="{ row }">{{ row.required ? '是' : '否' }}</template>
        </el-table-column>
      </el-table>
    </template>
  </el-dialog>
</template>
