<script setup lang="ts">
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import type { DataTableMeta } from '../../api'
import { exportTableFields } from '@/utils/format/exportFields'

const props = defineProps<{ modelValue: boolean; tableMeta: DataTableMeta | null }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

/** 导出字段定义 xlsx（对齐旧平台 handleExcel 的列与命名；与数据详情抽屉共用一份逻辑） */
function onExportFields() {
  try {
    exportTableFields(props.tableMeta)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导出字段失败')
  }
}
</script>

<template>
  <el-drawer v-model="visible" title="表结构详情" size="640px" append-to-body>
    <template v-if="tableMeta">
      <dl class="rc-kv">
        <dt>表 ID</dt>
        <dd>{{ tableMeta.tableId }}</dd>
        <dt>表名称</dt>
        <dd>{{ tableMeta.name || '—' }}</dd>
        <dt>物理表名</dt>
        <dd>{{ tableMeta.tableName }}</dd>
        <dt>数据量</dt>
        <dd>{{ tableMeta.rowCount ?? '—' }}</dd>
        <dt>状态</dt>
        <dd>{{ tableMeta.state || '—' }}</dd>
        <dt>去重字段</dt>
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
      <div class="td-fields-head">
        <span class="dv-section">字段列表（{{ tableMeta.fields.length }}）</span>
        <button type="button" class="rc-btn sm" data-testid="export-fields" @click="onExportFields">
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path
              d="M8 1.5v9M4.5 8 8 11.5 11.5 8M2.5 12.5v1h11v-1"
              fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"
            />
          </svg>
          导出字段
        </button>
      </div>
      <el-table :data="tableMeta.fields" class="td-fields" style="width: 100%" size="small" border>
        <el-table-column prop="seq" label="排序" width="46" />
        <el-table-column prop="itemId" label="ID" width="76" show-overflow-tooltip />
        <el-table-column prop="prop" label="编码" width="96" show-overflow-tooltip />
        <el-table-column prop="desc" label="展示名" width="96" show-overflow-tooltip />
        <el-table-column prop="columnName" label="数据库列" width="64" />
        <el-table-column prop="type" label="类型" width="66" />
        <el-table-column prop="checkRule" label="校验" width="70" show-overflow-tooltip :formatter="(row: DataTableMeta['fields'][number]) => row.checkRule || '—'" />
        <el-table-column prop="width" label="列宽" width="64" />
        <el-table-column prop="preprocess" label="预处理" min-width="90" show-overflow-tooltip :formatter="(row: DataTableMeta['fields'][number]) => row.preprocess || '—'" />
      </el-table>
    </template>
  </el-drawer>
</template>

<style scoped>
.td-fields-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 18px 0 8px;
}
.dv-section {
  color: var(--rc-text);
  font-size: 13px;
  font-weight: 700;
}
</style>
