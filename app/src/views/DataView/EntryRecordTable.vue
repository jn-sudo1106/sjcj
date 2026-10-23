<script setup lang="ts">
// ENTRY_ID 弹窗的内容体：复刻旧平台 data-view 的 RecordDetailComm.vue。
// 那个组件的方法只有一句 —— showRecord(record) 把整行数据存进 this.fixRow，模板直接
//   <tr v-for="( a, b ) in fixRow"><td>{{ b }}</td><td>{{ a }}</td></tr>
// 把这条记录的所有「列 / 值」原样平铺成一张两列表格：不调接口、不做字段分组、不加工具栏。
//
// 与操作列「详情」用的 DataRowDetail.vue 是**两套口径**，刻意不复用：
//   抽屉（DataRowDetail）：中文标签分组 + showItems 中文名 + 复制 JSON / 导出字段工具栏
//   弹窗（本组件）        ：一张朴素的全字段键值表，列名用物理列名，与旧平台一致
//
// 只铺「系统字段 + showItems」两类，刻意不铺 row.values：entryDetail 响应的顶层杂项
// （all / saveSimple / tableConfig / multiItems …）不在 systemKeys 名单里、会漏进 values，
// 而真正带值的动态列 showItems 已经用 columnName（K1/K2…）给全了。
import { computed } from 'vue'
import type { DataRow, EntryDetail } from '@/api'
import { upperDataText } from './upperData'

const props = defineProps<{ data: EntryDetail }>()

/** 系统列：原始物理列名 → 行字段（顺序与 api/legacyAdapters.ts 的 systemKeys 对齐） */
const SYSTEM_COLUMNS: ReadonlyArray<readonly [string, keyof DataRow]> = [
  ['ENTRY_ID', 'dataId'],
  ['SOURCE_ID', 'sourceId'],
  ['CONFIG_ID', 'configId'],
  ['ENTRY_TYPE_ID', 'entryTypeId'],
  ['DETAIL_ID', 'detailId'],
  // 1021-05：-1 / -2 等内部值显示「—」，列名仍是 PARENT_ID（10-22 用户定）；原始值在详情抽屉「技术字段」里
  ['PARENT_ID', 'parentId'],
  ['CATEGORY_ID', 'categoryId'],
  ['STATE', 'state'],
  ['NEXT_FLAG', 'nextFlag'],
  ['CREATE_DT', 'createDt'],
  ['UPDATE_DT', 'updateDt'],
  ['K0', 'k0'],
  ['SEQ', 'seq'],
  ['TIMES', 'times'],
  ['FILE_ID', 'fileId'],
  ['SOURCE_NAME', 'sourceName'],
  ['ENTRY_TYPE_NAME', 'entryTypeName'],
  ['VER', 'ver'],
  ['FLAG1', 'flag1'],
]

function text(value: unknown): string {
  return value == null || value === '' ? '—' : String(value)
}

const entries = computed<Array<{ key: string; label: string; value: string }>>(() => {
  const list: Array<{ key: string; label: string; value: string }> = []
  for (const [label, field] of SYSTEM_COLUMNS) {
    const value = field === 'parentId' ? upperDataText(props.data.row.parentId) : text(props.data.row[field])
    list.push({ key: label, label, value })
  }
  for (const item of props.data.showItems || []) {
    const label = item.columnName || item.itemName || item.itemId || 'item'
    list.push({ key: `item-${item.itemId ?? label}`, label, value: text(item.value) })
  }
  return list
})
</script>

<template>
  <table class="dv-record-table" data-testid="record-columns-table">
    <thead>
      <tr>
        <th class="dv-record-k">列</th>
        <th class="dv-record-v">值</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="entry in entries" :key="entry.key">
        <td class="dv-record-k">{{ entry.label }}</td>
        <td class="dv-record-v">{{ entry.value }}</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.dv-record-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  color: var(--rc-text-2);
}
.dv-record-table th,
.dv-record-table td {
  border: 1px solid var(--rc-border);
  padding: 6px 10px;
  text-align: left;
  vertical-align: top;
  word-break: break-all;
  white-space: pre-wrap;
}
.dv-record-table thead th {
  background: var(--rc-border-soft);
  color: var(--rc-text);
  font-weight: 600;
}
.dv-record-table .dv-record-k {
  width: 168px;
  color: var(--rc-muted);
  white-space: nowrap;
  word-break: normal;
}
.dv-record-table tbody tr:hover td {
  background: var(--rc-primary-bg);
}
</style>
