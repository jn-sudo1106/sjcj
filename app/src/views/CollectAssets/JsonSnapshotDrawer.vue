<script setup lang="ts">
// 「保存时 JSON」抽屉（2026-11-09）：列出某个源每次入库保存的原始 JSON 快照。
//
// 来源是旧平台源列表行内「查询 → 保存时Json」（`SourceList.vue:606` → `JsonListShow.vue` → `JsonList.vue`），
// 0828 差异清单里当时标成「无对应物」没迁。这次按用户要求**不做工作区页签**，而是回到源列表加一列
// 「保存时 JSON」：点行内最右「操作」列的 ⋯ → 菜单「保存时JSON」开这个右侧抽屉
// （实体数据详情统一走 el-drawer，见 AGENTS.md 详情弹层约定）。
//
// 数据表是 tb_orifile_resource（GET /api/v1/fileJsonPaged），跟「文件」视图的 file_resource 是两份数据：
// 文件视图是产出的文件行，这里是「这条任务到底往哪张表存了什么」的最后一手证据，所以按任务 ID 查。
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { dataApi, fileApi, type JsonSnapshotRecord, type Source } from '@/api'

const props = defineProps<{ source: Source }>()
const emit = defineEmits<{ close: [] }>()

const rows = ref<JsonSnapshotRecord[]>([])
const total = ref(0)
const loading = ref(false)
const listError = ref('')
const page = ref(1)
const size = ref(20)
const taskId = ref('')
const state = ref('')
const reSaving = ref('')

function stateText(value?: string): string {
  if (value === 'C') return '初始'
  if (value === 'AC') return '被消重'
  return value || '—'
}

function formatSize(bytes?: number): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const emptyText = computed(() =>
  listError.value
    || (taskId.value.trim() ? '该任务没有保存 JSON 快照' : '该源还没有保存 JSON 快照'),
)

async function loadList() {
  loading.value = true
  listError.value = ''
  try {
    const result = await fileApi.jsonPaged({
      sourceId: props.source.sourceId,
      taskId: taskId.value.trim() || undefined,
      state: state.value || undefined,
      page: page.value,
      size: size.value,
    })
    rows.value = result.list
    total.value = result.total
  } catch (e) {
    listError.value = (e as Error).message || '查询保存时 JSON 失败'
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function runQuery() {
  page.value = 1
  void loadList()
}

function resetFilters() {
  taskId.value = ''
  state.value = ''
  page.value = 1
  void loadList()
}

function changePageSize(next: number) {
  size.value = next
  page.value = 1
  void loadList()
}

// 行内「重新保存」：旧 JsonList.vue 的 entryReSave(sourceId, jsonId)，新平台对应 dataApi.reSave。
// 写操作保留二次确认；生产后端由 client.ts 的写保护兜底（会给明确提示，不会静默失败）。
async function reSave(row: JsonSnapshotRecord) {
  if (!row.id) return
  try {
    await ElMessageBox.confirm(
      `把快照 #${row.id}（任务 ${row.taskId || '—'}）重新保存一次？后端会按这份原始 JSON 重新走一遍入库。`,
      '重新保存',
      { type: 'warning', confirmButtonText: '重新保存', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  const id = row.id
  reSaving.value = id
  try {
    const ack = await dataApi.reSave(row.sourceId || props.source.sourceId, id)
    ElMessage.success(ack?.message || '已提交重新保存')
    await loadList()
  } catch (e) {
    ElMessage.error((e as Error).message || '重新保存失败')
  } finally {
    reSaving.value = ''
  }
}

watch(() => props.source.sourceId, () => {
  taskId.value = ''
  state.value = ''
  page.value = 1
  void loadList()
}, { immediate: true })
</script>

<template>
  <el-drawer
    :model-value="true"
    :title="`保存时 JSON · ${source.name || source.sourceId}`"
    size="780px"
    append-to-body
    class="jsd-drawer"
    @close="emit('close')"
  >
    <div class="jsd-body" data-testid="json-snapshot-drawer">
      <p class="jsd-hint">
        该源每次入库保存的原始 JSON 快照（旧平台「保存时Json」）。按任务 ID 能查到某一条任务到底往哪张表存了什么；点「原始 JSON」在新窗口看全文。
      </p>
      <div class="jsd-filters">
        <el-input
          v-model="taskId"
          placeholder="任务 ID"
          clearable
          data-testid="json-task-filter"
          style="width: 180px"
          @keyup.enter="runQuery"
        />
        <el-select v-model="state" placeholder="状态（不限）" clearable style="width: 140px">
          <el-option label="初始" value="C" />
          <el-option label="被消重" value="AC" />
        </el-select>
        <el-button type="primary" @click="runQuery">查询</el-button>
        <el-button @click="resetFilters">清空</el-button>
        <span class="jsd-count">共 {{ total }} 份快照</span>
      </div>

      <el-table
        v-loading="loading"
        :data="rows"
        size="small"
        border
        data-testid="json-table"
        :empty-text="emptyText"
        class="jsd-table"
      >
        <el-table-column prop="id" label="快照 ID" width="108">
          <template #default="{ row }"><span class="jsd-mono">{{ row.id }}</span></template>
        </el-table-column>
        <el-table-column label="原始 JSON" min-width="230" show-overflow-tooltip>
          <template #default="{ row }">
            <a
              v-if="row.id"
              class="jsd-link"
              :href="fileApi.jsonReadUrl(row)"
              target="_blank"
              rel="noopener noreferrer"
              :title="row.storePath || row.showName || row.id"
              data-testid="json-open"
            >{{ row.showName || row.storePath || `快照 #${row.id}` }}</a>
            <span v-else class="jsd-soft">—</span>
          </template>
        </el-table-column>
        <el-table-column label="大小" width="96" align="right">
          <template #default="{ row }">{{ formatSize(row.fileSize) }}</template>
        </el-table-column>
        <el-table-column prop="taskId" label="任务 ID" width="126">
          <template #default="{ row }"><span class="jsd-mono">{{ row.taskId || '—' }}</span></template>
        </el-table-column>
        <el-table-column prop="realName" label="表 ID" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.realName || '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="88">
          <template #default="{ row }">{{ stateText(row.state) }}</template>
        </el-table-column>
        <el-table-column prop="createDt" label="保存时间" width="158">
          <template #default="{ row }"><span class="jsd-soft">{{ row.createDt || '—' }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="96" fixed="right">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              size="small"
              data-testid="json-resave"
              :disabled="reSaving === row.id"
              @click="reSave(row)"
            >{{ reSaving === row.id ? '提交中…' : '重新保存' }}</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="jsd-pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="size"
          :total="total"
          :page-sizes="[20, 40, 100, 200]"
          layout="total, sizes, prev, pager, next, jumper"
          background
          size="small"
          data-testid="json-pagination"
          @current-change="loadList"
          @size-change="changePageSize"
        />
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.jsd-body { display: flex; flex-direction: column; gap: 12px; height: 100%; }
.jsd-hint { margin: 0; color: var(--rc-faint); font-size: 12px; line-height: 1.7; }

.jsd-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 16px; border: 1px solid #f1f5f9; border-radius: 10px; background: #f8fafc; }
.jsd-count { margin-left: auto; color: var(--rc-muted); font-size: 12px; }

.jsd-table { flex: 1; min-height: 0; }
.jsd-mono { font-family: var(--rc-mono, monospace); }
.jsd-soft { color: #94a3b8; }
.jsd-link { color: #3b82f6; text-decoration: none; }
.jsd-link:hover { color: #2563eb; text-decoration: underline; }

.jsd-pager { display: flex; align-items: center; justify-content: flex-end; padding-top: 4px; }
</style>