<script setup lang="ts">
// 文件视图（0711 R11）：仅子源态展示（用户口径"文件视图只有源才有"），网站态不出现该视图。
// 展示该子源每个抓取节点产出的原始文件：统计（总数/总大小/失败数/最近生成时间）+ 可筛选列表。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useFlowStore } from '../../stores/flow'
import { fileApi, sourceApi, type RawFile, type RawFileStats, type Step } from '../../api'
import CanvasHeader from './CanvasHeader.vue'

const flow = useFlowStore()
const sourceId = computed(() => flow.sourceCtx?.sourceId ?? '')

const steps = ref<Step[]>([])
const stats = ref<RawFileStats | null>(null)
const rows = ref<RawFile[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const size = 20
const filters = reactive({ nodeId: '', contentType: '', state: '' })
const dateRange = ref<[string, string] | null>(null)

async function loadSteps() {
  try {
    steps.value = sourceId.value ? await sourceApi.sourceSteps(sourceId.value) : []
  } catch (e) {
    ElMessage.warning('加载步骤映射失败')
    steps.value = []
  }
}
async function loadStats() {
  try {
    stats.value = sourceId.value ? await fileApi.fileStats(sourceId.value) : null
  } catch (e) {
    ElMessage.warning('加载统计信息失败')
    stats.value = null
  }
}
async function loadList() {
  if (!sourceId.value) {
    rows.value = []
    total.value = 0
    return
  }
  loading.value = true
  try {
    const res = await fileApi.filePaged({
      sourceId: sourceId.value,
      nodeId: filters.nodeId || undefined,
      contentType: filters.contentType || undefined,
      state: (filters.state || undefined) as '' | 'C' | 'E' | undefined,
      dateFrom: dateRange.value?.[0] || undefined,
      dateTo: dateRange.value?.[1] || undefined,
      page: page.value,
      size,
    })
    rows.value = res?.list ?? []
    total.value = res?.total ?? 0
  } finally {
    loading.value = false
  }
}
function nodeName(nodeId: string): string {
  return steps.value.find((s) => s.stepId === nodeId)?.name ?? nodeId
}

watch(sourceId, async () => {
  page.value = 1
  await Promise.allSettled([loadSteps(), loadStats(), loadList()])
}, { immediate: true })
watch([filters, dateRange], () => { page.value = 1; loadList() }, { deep: true })

function resetFilters() {
  filters.nodeId = ''
  filters.contentType = ''
  filters.state = ''
  dateRange.value = null
}
function handleCurrentChange(val: number) {
  page.value = val
  loadList()
}
function stateMeta(s: RawFile['state']) {
  return s === 'E' ? { cls: 'err', text: '失败' } : { cls: 'ok', text: '成功' }
}
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <main class="fv-shell">
    <CanvasHeader />
    <div class="fv-body">
      <div v-if="!sourceId" class="fv-empty-row">文件视图仅在子源详情下可用。</div>
      <template v-else>


        <div class="fv-filters">
          <el-select v-model="filters.nodeId" placeholder="全部节点" clearable style="width: 150px">
            <el-option label="全部节点" value="" />
            <el-option v-for="s in steps" :key="s.stepId" :label="s.name" :value="s.stepId" />
          </el-select>
          <el-select v-model="filters.contentType" placeholder="全部类型" clearable style="width: 130px">
            <el-option label="全部类型" value="" />
            <el-option label="html" value="html" />
            <el-option label="pdf" value="pdf" />
            <el-option label="json" value="json" />
          </el-select>
          <el-select v-model="filters.state" placeholder="全部状态" clearable style="width: 130px">
            <el-option label="全部状态" value="" />
            <el-option label="成功" value="C" />
            <el-option label="失败" value="E" />
          </el-select>
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            format="YYYY-MM-DD"
            value-format="YYYY-MM-DD"
            style="width: 280px"
          />
          <el-button type="primary" @click="resetFilters" plain>清空筛选</el-button>
          <span class="fv-spacer" />
          <span class="muted">
            共 {{ total }} 个文件 <span v-if="stats?.totalSize" style="margin-left: 4px;">({{ formatSize(stats?.totalSize ?? 0) }})</span>
            <span v-if="(stats?.failed ?? 0) > 0" style="color: #ef4444; margin-left: 8px;">(失败 {{ stats?.failed }})</span>
          </span>
        </div>

        <table class="rc-data-table fv-table" v-loading="loading">
          <thead>
            <tr>
              <th>文件名</th>
              <th style="width: 110px">节点</th>
              <th style="width: 70px">类型</th>
              <th style="width: 90px" class="num">大小</th>
              <th style="width: 70px">状态</th>
              <th style="width: 150px">生成时间</th>
              <th style="width: 110px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in rows" :key="f.fileId">
              <td class="fv-name">{{ f.fileName }}</td>
              <td>{{ nodeName(f.nodeId) }}</td>
              <td>{{ f.contentType }}</td>
              <td class="num">{{ formatSize(f.size) }}</td>
              <td><span class="rc-status" :class="stateMeta(f.state).cls">{{ stateMeta(f.state).text }}</span></td>
              <td class="soft">{{ f.createdAt }}</td>
              <td>
                <a v-if="f.viewUrl" class="fv-op" :href="f.viewUrl" target="_blank" rel="noopener">查看</a>
                <a v-if="f.downloadUrl" class="fv-op" :href="f.downloadUrl" target="_blank" rel="noopener">下载</a>
                <span v-if="!f.viewUrl && !f.downloadUrl" class="muted">—</span>
              </td>
            </tr>
            <tr v-if="!rows.length && !loading">
              <td colspan="7" class="fv-empty-row">没有匹配的文件</td>
            </tr>
          </tbody>
        </table>
        <div class="fv-pager">
          <el-pagination
            background
            layout="prev, pager, next"
            :current-page="page"
            :page-size="size"
            :total="total"
            @current-change="handleCurrentChange"
          />
        </div>
      </template>
    </div>
  </main>
</template>

<style scoped>
.fv-shell { 
  background: linear-gradient(145deg, #fafcff 0%, #ffffff 100%); 
  border: 1px solid var(--rc-border); 
  border-radius: 12px; 
  overflow: hidden; 
  height: 100%; 
  display: flex; 
  flex-direction: column;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
}
.fv-body { flex: 1; overflow: auto; padding: 20px 24px; animation: fadeIn 0.4s cubic-bezier(0.4, 0, 0.2, 1); }
.fv-empty-row { text-align: center; color: var(--rc-faint); font-size: 13px; padding: 40px 12px; }

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}



.fv-filters { 
  display: flex; 
  align-items: center; 
  gap: 12px; 
  margin-bottom: 16px;
  background: #f8fafc;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid #f1f5f9;
}
.fv-spacer { flex: 1; }
.muted { color: #94a3b8; font-size: 13px; }

.fv-table { width: 100%; border-collapse: separate; border-spacing: 0; }
.fv-table th { background: #f8fafc; color: #475569; font-weight: 600; padding: 12px 16px; font-size: 13px; border-bottom: 2px solid #e2e8f0; text-align: left; }
.fv-table td { padding: 14px 16px; border-bottom: 1px solid #f1f5f9; transition: background 0.2s; vertical-align: middle; }
.fv-table tbody tr:hover td { background: #fdfefe; }
.fv-table th.num, .fv-table td.num { text-align: right; }

.fv-name { font-family: var(--rc-mono, monospace); font-size: 13px; color: #334155; }
.soft { color: #94a3b8; font-size: 12px; }

.rc-status { padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; display: inline-block; }
.rc-status.ok { background: rgba(34, 197, 94, 0.1); color: #16a34a; border: 1px solid rgba(34, 197, 94, 0.2); }
.rc-status.err { background: rgba(239, 68, 68, 0.1); color: #dc2626; border: 1px solid rgba(239, 68, 68, 0.2); }

.fv-op { margin-right: 12px; font-size: 13px; color: #3b82f6; text-decoration: none; font-weight: 500; transition: color 0.2s; }
.fv-op:hover { color: #2563eb; text-decoration: underline; }

.fv-pager { display: flex; align-items: center; justify-content: flex-end; margin-top: 16px; }
</style>
