<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { dataApi, type DataTableMeta, type DataRow } from '../../api'
import { useUiStore } from '../../stores/ui'

const ui = useUiStore()

const tables = ref<DataTableMeta[]>([])
const activeTable = ref('')
const rows = ref<DataRow[]>([])
const selected = ref<DataRow | null>(null)
const loading = ref(false)
const page = ref(1)
const size = ref(20)
const total = ref(0)
const stats = reactive({ tables: 0, rows: 0, chars: 0, review: 0 })
const sql = ref('')
const query = reactive({ sourceId: '', dataId: '', parentId: '', state: '', nextFlag: '', min: '', max: '' })
const tab = ref<'data' | 'schema'>('data')

const currentTable = computed(() => tables.value.find((t) => t.tableId === activeTable.value) ?? null)

async function selectTable(id: string) {
  activeTable.value = id
  tab.value = 'data'
  const meta = await dataApi.tableMeta(id)
  if (meta) {
    const index = tables.value.findIndex((table) => table.tableId === id)
    if (index >= 0) tables.value[index] = meta
  }
  page.value = 1
  await loadRows()
}

async function loadRows() {
  if (!activeTable.value) return
  loading.value = true
  try {
    const result = await dataApi.rowQueryPaged({
      tableId: activeTable.value,
      sourceId: query.sourceId || undefined,
      dataId: query.dataId || undefined,
      parentId: query.parentId || undefined,
      state: query.state || undefined,
      nextFlag: query.nextFlag || undefined,
      min: query.min || undefined,
      max: query.max || undefined,
      sql: sql.value.trim() || undefined,
      page: page.value,
      size: size.value,
    })
    rows.value = result.list
    total.value = result.total
  } finally {
    loading.value = false
  }
  selected.value = rows.value[0] ?? null
}

async function runSql() {
  const fields = currentTable.value?.fields.map((f) => f.prop) ?? []
  const used = Array.from(sql.value.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*(=|>|<|>=|<=|like|LIKE)/g)).map((m) => m[1])
  const bad = used.filter((u) => !fields.includes(u))
  if (bad.length) {
    ElMessage.warning(`字段不在白名单或不存在：${bad.join('、')}（可切换「表结构」查看可用字段）`)
    return
  }
  page.value = 1
  await loadRows()
  ElMessage.success(sql.value.trim() ? '查询条件已应用' : '查询已刷新')
}

function parseMeta(s?: string) {
  if (s === 'parsed') return { cls: 'ok', text: '已解析' }
  if (s === 'failed') return { cls: 'err', text: '解析失败' }
  return { cls: 'muted', text: '无附件' }
}

onMounted(async () => {
  tables.value = await dataApi.tables()
  Object.assign(stats, {
    tables: tables.value.length,
    rows: tables.value.reduce((sum, table) => sum + table.rowCount, 0),
    chars: 0,
    review: 0,
  })
  if (tables.value[0]) await selectTable(tables.value[0].tableId)
  ui.registerAction('导出结果', () => ElMessage.info('导出结果：演示环境占位'))
  ui.registerAction('新建查询视图', () => ElMessage.info('新建查询视图：演示环境占位'))
})
onUnmounted(() => ui.clearActions())
</script>

<template>
  <div class="dv-layout">
    <!-- 表列表 -->
    <div class="rc-card dv-tables">
      <div class="rc-card-head">
        <div>
          <div class="rc-card-title">数据表</div>
          <div class="rc-card-sub">落表验收对象</div>
        </div>
      </div>
      <div class="rc-tree dv-tables-scroll">
        <div
          v-for="t in tables"
          :key="t.tableId"
          class="rc-tree-row"
          :class="{ active: activeTable === t.tableId }"
          @click="selectTable(t.tableId)"
        >
          <span>{{ t.tableName.split('.').pop() }}</span>
          <span class="rc-count">{{ t.rowCount.toLocaleString() }}</span>
        </div>
      </div>
    </div>

    <!-- 数据 / 表结构 -->
    <div class="rc-card dv-main">
      <div class="rc-metric-grid dv-kpis">
        <div class="rc-metric"><span>可查看数据表</span><b>{{ stats.tables }}</b></div>
        <div class="rc-metric"><span>当前筛选记录</span><b>{{ total }}</b></div>
        <div class="rc-metric"><span>附件解析文本字数</span><b>{{ stats.chars.toLocaleString() }}</b></div>
        <div class="rc-metric"><span>待复核记录</span><b class="danger">{{ stats.review }}</b></div>
      </div>

      <div class="rc-toolbar wrap">
        <div class="rc-tabs dv-tabs">
          <span class="rc-tab-link" :class="{ active: tab === 'data' }" @click="tab = 'data'">实体数据</span>
          <span class="rc-tab-link" :class="{ active: tab === 'schema' }" @click="tab = 'schema'">表结构</span>
        </div>
        <span class="dv-spacer" />
        <el-input v-model="query.sourceId" clearable placeholder="源 ID" style="width: 120px" />
        <el-input v-model="query.dataId" clearable placeholder="数据 ID" style="width: 120px" />
        <el-input v-model="query.parentId" clearable placeholder="父 ID" style="width: 120px" />
        <el-select v-model="query.state" clearable placeholder="状态" style="width: 100px"><el-option label="完成" value="C" /><el-option label="处理中" value="L" /><el-option label="异常" value="E" /></el-select>
        <el-select v-model="query.nextFlag" clearable placeholder="后续" style="width: 100px"><el-option label="未处理" value="-1" /><el-option label="已处理" value="1" /></el-select>
      </div>
      <div class="rc-toolbar wrap dv-query-row">
        <el-input v-model="query.min" clearable placeholder="起始 ID" style="width: 120px" />
        <el-input v-model="query.max" clearable placeholder="终止 ID" style="width: 120px" />
        <el-input v-model="sql" placeholder="SQL 条件，如 pub_date = '2026-06-19'（字段需在白名单）" style="width: 320px" />
        <button class="rc-btn" type="button" @click="runSql">执行</button>
        <button class="rc-btn" type="button" @click="sql = ''; Object.assign(query, { sourceId: '', dataId: '', parentId: '', state: '', nextFlag: '', min: '', max: '' }); runSql()">重置</button>
      </div>

      <div v-loading="loading" class="rc-table-scroll dv-table">
        <table v-if="tab === 'data'" class="rc-data-table">
          <thead>
            <tr>
              <th style="width: 130px">数据 ID</th>
              <th style="width: 100px">来源</th>
              <th style="width: 80px">状态</th>
              <th v-for="field in currentTable?.fields || []" :key="field.prop">{{ field.desc || field.prop }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.dataId" :class="{ active: selected?.dataId === r.dataId }" @click="selected = r">
              <td>{{ r.dataId }}</td>
              <td>{{ r.sourceId }}</td>
              <td><span class="rc-status" :class="r.state === 'E' ? 'err' : r.state === 'L' ? 'warn' : 'ok'">{{ r.state || '—' }}</span></td>
              <td v-for="field in currentTable?.fields || []" :key="field.prop" class="muted">{{ r.values?.[field.prop] ?? '—' }}</td>
            </tr>
          </tbody>
        </table>

        <table v-else class="rc-data-table">
          <thead>
            <tr>
              <th style="width: 150px">字段</th>
              <th style="width: 90px">类型</th>
              <th>说明</th>
              <th>样例值</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in currentTable?.fields || []" :key="f.prop">
              <td>{{ f.prop }}</td>
              <td>{{ f.type }}</td>
              <td>{{ f.desc }}</td>
              <td class="muted">{{ f.sample || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="tab === 'data'" class="dv-pager">
        <el-pagination v-model:current-page="page" v-model:page-size="size" :total="total" :page-sizes="[20, 40, 100, 200]" layout="total, sizes, prev, pager, next, jumper" background small @current-change="loadRows" @size-change="page = 1; loadRows()" />
      </div>
    </div>

    <!-- 列值详情 -->
    <div class="rc-card dv-detail">
      <div class="rc-card-head">
        <div class="rc-card-title">列值详情</div>
      </div>
      <div v-if="selected" class="rc-detail">
        <div class="dv-d-title">{{ selected.title }}</div>
        <div class="dv-d-sub muted">{{ selected.dataId }}</div>

        <div class="dv-section">关联指针</div>
        <dl class="rc-kv">
          <dt>source_id</dt><dd>{{ selected.sourceId }}</dd>
          <dt>config_id</dt><dd>{{ selected.configId || '—' }}</dd>
          <dt>task_id</dt><dd>{{ selected.taskId || '—' }}</dd>
          <dt>run_id</dt><dd>{{ selected.runId || '—' }}</dd>
        </dl>

        <div class="dv-section">原始文件</div>
        <dl class="rc-kv">
          <dt>类型</dt><dd>{{ selected.fileType && selected.fileType !== '-' ? selected.fileType.toUpperCase() : '无附件' }}</dd>
          <dt>解析状态</dt>
          <dd><span class="rc-status" :class="parseMeta(selected.parseState).cls">{{ parseMeta(selected.parseState).text }}</span></dd>
        </dl>
        <button
          class="rc-btn dv-view"
          type="button"
          :disabled="!selected.fileType || selected.fileType === '-'"
          @click="ElMessage.info('查看原文：演示环境占位（HTML / PDF 归档）')"
        >
          查看原文
        </button>
        <div class="rc-mini-card">落表验收：核对 source/config/task/run 指针是否一致，确认数据真实落表。</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dv-layout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) 320px;
  gap: 12px;
}
.dv-tables, .dv-main, .dv-detail {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 168px);
  min-height: 560px;
}
.dv-tables-scroll {
  flex: 1;
  overflow: auto;
}
.rc-tree-row {
  cursor: pointer;
}
.dv-kpis {
  padding: 14px 16px;
  border-bottom: 1px solid var(--rc-border-soft);
}
.dv-tabs {
  border-bottom: 0;
  padding: 0;
  min-height: auto;
}
.dv-spacer {
  flex: 1;
}
.dv-table {
  flex: 1;
}
.dv-query-row { border-top: 1px solid var(--rc-border-soft); }
.dv-pager { display: flex; justify-content: flex-end; padding: 10px 16px; border-top: 1px solid var(--rc-border-soft); }
.rc-data-table tbody tr {
  cursor: pointer;
}
.dv-name {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--rc-primary-ink);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.dv-file {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--rc-indigo-bg);
  color: var(--rc-indigo);
  font-size: 11px;
  font-weight: 600;
}
.dv-d-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--rc-text);
}
.dv-d-sub {
  margin: 4px 0 4px;
  font-size: 12px;
}
.dv-section {
  margin: 16px 0 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--rc-text);
}
.dv-view {
  margin-top: 12px;
}

@media (max-width: 1240px) {
  .dv-layout {
    grid-template-columns: 1fr;
  }
  .dv-tables, .dv-main, .dv-detail {
    height: auto;
  }
}
</style>
