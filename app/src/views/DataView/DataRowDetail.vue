<script setup lang="ts">
// 抽屉（点整行 / 操作列「详情」）的内容体：只读展示一行（row + showItems + subsCnt），本身不套容器。
// 注意另一个入口「点 ENTRY_ID 链接」的居中弹窗**不用这一份**——它用 EntryRecordTable.vue，
// 复刻旧平台 RecordDetailComm 的「列 / 值」平铺表；两套口径刻意分开，不要合并。
// 自带动作的三处（任务实例 / 原始 JSON / 文件预览）实现都留在父组件里，这里只 emit——
// 否则同一套逻辑要在父组件和本组件各留一份，迟早改漏一处。
import { ElMessage } from 'element-plus'
import { copyToClipboard } from '@/utils/clipboard'
import { exportTableFields } from '@/utils/format/exportFields'
import { isOssFilePath } from '@/views/FlowCanvas/result/rowDetailFields'
import type { DataRow, DataTableMeta, EntryDetail } from '@/api'
import { upperDataText } from './upperData'

const props = defineProps<{
  data: EntryDetail
  tableMeta?: DataTableMeta | null
  /** 上层数据所在表的显示名（调用方能确定时才给），有了显示「来自 表名 #ID」并可点 */
  upperTableName?: string
}>()

const emit = defineEmits<{
  (e: 'open-task', row: DataRow): void
  (e: 'open-raw', row: DataRow): void
  (e: 'preview-file', path: string, field?: { prop?: string; columnName?: string; desc?: string }): void
  (e: 'open-upper', row: DataRow): void
}>()

function copyText(val: string, label?: string) {
  void copyToClipboard(val, label)
}

function copyDetailJson() {
  const payload: Record<string, unknown> = {
    ENTRY_ID: props.data.row.dataId,
    SOURCE_ID: props.data.row.sourceId,
    CREATE_DT: props.data.row.createDt,
    UPDATE_DT: props.data.row.updateDt,
  }
  for (const item of props.data.showItems || []) {
    const key = item.columnName || item.itemName || item.itemId || 'item'
    payload[key] = item.value
  }
  void copyToClipboard(JSON.stringify(payload, null, 2), '全部字段 JSON')
}

/** 详情里也能导出字段定义（与「表结构详情」共用同一份逻辑） */
function onExportDetailFields() {
  if (!props.tableMeta) {
    ElMessage.error('请先选择数据表')
    return
  }
  try {
    exportTableFields(props.tableMeta)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导出字段失败')
  }
}

/** showItems 只有列名，按列名回表结构取字段名 / 描述，再走同一套路径判据 */
function detailFileField(item: { columnName: string; itemName?: string; value: unknown }) {
  const value = item.value == null ? '' : String(item.value)
  if (!value) return null
  const meta = props.tableMeta?.fields?.find((f) => (f.columnName ?? f.prop) === item.columnName)
  const field = { prop: meta?.prop ?? item.columnName, columnName: item.columnName, desc: meta?.desc ?? item.itemName ?? '' }
  return isOssFilePath(field, value) ? field : null
}
</script>

<template>
  <div class="dv-detail-toolbar">
    <button class="rc-btn sm" type="button" data-testid="detail-copy-json" @click="copyDetailJson">
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path
          d="M5.5 2.5h6a1 1 0 0 1 1 1v6M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1 1-1Z"
          fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"
        />
      </svg>
      复制全部 JSON
    </button>
    <button class="rc-btn sm" type="button" data-testid="detail-export-fields" @click="onExportDetailFields">
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path
          d="M8 1.5v9M4.5 8 8 11.5 11.5 8M2.5 12.5v1h11v-1"
          fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"
        />
      </svg>
      导出字段
    </button>
  </div>
  <dl class="rc-kv">
    <dt class="dv-detail-dt">
      <span>ENTRY_ID</span>
      <button
        v-if="data.row.dataId"
        type="button"
        class="dv-copy-btn"
        title="复制 ENTRY_ID"
        data-testid="detail-copy-entry-id"
        @click="copyText(data.row.dataId, 'ENTRY_ID')"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path
            d="M5.5 2.5h6a1 1 0 0 1 1 1v6M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1 1-1Z"
            fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"
          />
        </svg>
      </button>
    </dt>
    <dd>{{ data.row.dataId || '—' }}</dd>
    <dt class="dv-detail-dt">
      <span>源 ID</span>
      <button
        v-if="data.row.sourceId"
        type="button"
        class="dv-copy-btn"
        title="复制 源 ID"
        data-testid="detail-copy-source-id"
        @click="copyText(data.row.sourceId, '源 ID')"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path
            d="M5.5 2.5h6a1 1 0 0 1 1 1v6M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1 1-1Z"
            fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"
          />
        </svg>
      </button>
    </dt>
    <dd>{{ data.row.sourceId || '—' }}</dd>
    <dt class="dv-detail-dt">
      <span>源名称</span>
      <button
        v-if="data.row.sourceName"
        type="button"
        class="dv-copy-btn"
        title="复制 源名称"
        data-testid="detail-copy-source-name"
        @click="copyText(data.row.sourceName, '源名称')"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path
            d="M5.5 2.5h6a1 1 0 0 1 1 1v6M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1 1-1Z"
            fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"
          />
        </svg>
      </button>
    </dt>
    <dd>{{ data.row.sourceName || '—' }}</dd>
    <dt class="dv-detail-dt">
      <span>文件ID</span>
      <button
        v-if="data.row.fileId"
        type="button"
        class="dv-copy-btn"
        title="复制 文件ID"
        data-testid="detail-copy-file-id"
        @click="copyText(data.row.fileId, '文件ID')"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path
            d="M5.5 2.5h6a1 1 0 0 1 1 1v6M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1 1-1Z"
            fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"
          />
        </svg>
      </button>
    </dt>
    <dd>{{ data.row.fileId || '—' }}</dd>
    <dt class="dv-detail-dt">
      <span>类型ID</span>
      <button
        v-if="data.row.entryTypeId"
        type="button"
        class="dv-copy-btn"
        title="复制 类型ID"
        data-testid="detail-copy-type-id"
        @click="copyText(data.row.entryTypeId, '类型ID')"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path
            d="M5.5 2.5h6a1 1 0 0 1 1 1v6M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1 1-1Z"
            fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"
          />
        </svg>
      </button>
    </dt>
    <dd>{{ data.row.entryTypeId || '—' }}</dd>
    <dt class="dv-detail-dt">
      <span>类型名</span>
      <button
        v-if="data.row.entryTypeName"
        type="button"
        class="dv-copy-btn"
        title="复制 类型名"
        data-testid="detail-copy-type-name"
        @click="copyText(data.row.entryTypeName, '类型名')"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path
            d="M5.5 2.5h6a1 1 0 0 1 1 1v6M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1 1-1Z"
            fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"
          />
        </svg>
      </button>
    </dt>
    <dd>{{ data.row.entryTypeName || '—' }}</dd>
    <dt>父ID</dt>
    <dd>
      <a
        v-if="upperTableName && upperDataText(data.row.parentId) !== '—'"
        class="dv-a"
        data-testid="detail-upper-link"
        @click="emit('open-upper', data.row)"
      >{{ upperDataText(data.row.parentId, upperTableName) }}</a>
      <span v-else data-testid="detail-upper">{{ upperDataText(data.row.parentId) }}</span>
    </dd>
    <dt>任务ID</dt>
    <dd>
      <a
        v-if="data.row.detailId"
        class="dv-a"
        data-testid="detail-open-task"
        @click="emit('open-task', data.row)"
      >{{ data.row.detailId }}</a>
      <span v-else>—</span>
    </dd>
    <dt>创建时间</dt>
    <dd>{{ data.row.createDt || '—' }}</dd>
    <dt>更新时间</dt>
    <dd>{{ data.row.updateDt || '—' }}</dd>
    <dt>版本</dt>
    <dd>{{ data.row.ver || '—' }}</dd>
    <dt>总次数</dt>
    <dd>{{ data.row.times || '—' }}</dd>
    <dt>序号</dt>
    <dd>{{ data.row.seq || '—' }}</dd>
    <dt>抓取日期</dt>
    <dd>{{ data.row.flag1 || '—' }}</dd>
    <dt>原始</dt>
    <dd>
      <a
        v-if="data.row.k0"
        class="dv-a"
        data-testid="detail-open-raw"
        @click="emit('open-raw', data.row)"
      >查看</a>
      <span v-else>—</span>
    </dd>
    <dt>子数据量</dt>
    <dd>{{ data.subsCnt ?? '—' }}</dd>
    <template v-for="item in data.showItems" :key="item.itemId ?? item.columnName">
      <dt class="dv-detail-dt">
        <span>{{ item.itemName || item.columnName }}</span>
        <button
          v-if="item.value !== undefined && item.value !== null && item.value !== ''"
          type="button"
          class="dv-copy-btn"
          :title="`复制 ${item.itemName || item.columnName}`"
          data-testid="detail-copy-item"
          @click="copyText(String(item.value), item.itemName || item.columnName)"
        >
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path
              d="M5.5 2.5h6a1 1 0 0 1 1 1v6M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1 1-1Z"
              fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"
            />
          </svg>
        </button>
      </dt>
      <dd v-if="detailFileField(item)">
        <button
          type="button"
          class="dv-file"
          data-testid="detail-file"
          :title="`预览 ${item.value}`"
          @click="emit('preview-file', String(item.value), detailFileField(item) ?? undefined)"
        >📄 {{ item.value }}</button>
      </dd>
      <dd v-else>{{ item.value ?? '—' }}</dd>
    </template>
  </dl>
  <!-- 技术字段（1021-05）：给开发排查用的原始值，默认收起 -->
  <details class="dv-tech" data-testid="detail-tech-fields">
    <summary>技术字段</summary>
    <dl class="rc-kv">
      <dt>PARENT_ID</dt>
      <dd data-testid="detail-tech-parent-id">{{ data.row.parentId || '—' }}</dd>
      <dt>CATEGORY_ID</dt>
      <dd>{{ data.row.categoryId || '—' }}</dd>
    </dl>
  </details>
</template>

<style scoped>
/* .dv-a 在本组件内要自带一份：父组件的 scoped 样式不会下渗到子组件，
   而「任务ID」「原始」这两处链接就在这份内容里。数值与 DataQueryTab 里的 .dv-a 保持一致。 */
.dv-a {
  color: var(--rc-primary-ink);
  cursor: pointer;
}
.dv-a:hover {
  text-decoration: underline;
}
.dv-detail-toolbar {
  margin-bottom: 12px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.dv-detail-toolbar .rc-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.dv-detail-dt {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.dv-copy-btn {
  border: 0;
  background: transparent;
  color: var(--rc-faint);
  padding: 1px 3px;
  border-radius: 3px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0.45;
  transition: opacity .12s, color .12s, background-color .12s;
}
.dv-detail-dt:hover .dv-copy-btn {
  opacity: 1;
}
.dv-copy-btn:hover {
  color: var(--rc-primary);
  background: var(--rc-primary-bg);
}
.dv-tech { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--rc-border-soft); }
.dv-tech summary { color: var(--rc-muted); font-size: 12px; cursor: pointer; }
.dv-tech .rc-kv { margin-top: 8px; }
.dv-file { max-width: 100%; padding: 0; border: 0; background: transparent; color: var(--rc-primary-ink); font: inherit; text-align: left; cursor: pointer; word-break: break-all; }
.dv-file:hover { text-decoration: underline; }
</style>
