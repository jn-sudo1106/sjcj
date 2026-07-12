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
watch(filters, () => { page.value = 1; loadList() }, { deep: true })

function resetFilters() {
  filters.nodeId = ''
  filters.contentType = ''
  filters.state = ''
}
function prevPage() {
  if (page.value > 1) { page.value -= 1; loadList() }
}
function nextPage() {
  if (page.value * size < total.value) { page.value += 1; loadList() }
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
        <div class="fv-stats">
          <div class="fv-stat"><span>文件总数</span><b>{{ (stats?.total ?? 0).toLocaleString() }}</b></div>
          <div class="fv-stat"><span>总大小</span><b>{{ formatSize(stats?.totalSize ?? 0) }}</b></div>
          <div class="fv-stat"><span>失败数</span><b :class="{ danger: (stats?.failed ?? 0) > 0 }">{{ stats?.failed ?? 0 }}</b></div>
          <div class="fv-stat"><span>最近生成</span><b class="soft">{{ stats?.latestCreatedAt || '—' }}</b></div>
        </div>

        <div class="fv-filters">
          <select v-model="filters.nodeId" class="rc-select">
            <option value="">全部节点</option>
            <option v-for="s in steps" :key="s.stepId" :value="s.stepId">{{ s.name }}</option>
          </select>
          <select v-model="filters.contentType" class="rc-select">
            <option value="">全部类型</option>
            <option value="html">html</option>
            <option value="pdf">pdf</option>
            <option value="json">json</option>
          </select>
          <select v-model="filters.state" class="rc-select">
            <option value="">全部状态</option>
            <option value="C">成功</option>
            <option value="E">失败</option>
          </select>
          <button class="rc-btn" type="button" @click="resetFilters">清空筛选</button>
          <span class="fv-spacer" />
          <span class="muted">共 {{ total }} 个文件</span>
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
          <button class="rc-btn" type="button" :disabled="page <= 1" @click="prevPage">上一页</button>
          <span class="muted">第 {{ page }} 页</span>
          <button class="rc-btn" type="button" :disabled="page * size >= total" @click="nextPage">下一页</button>
        </div>
      </template>
    </div>
  </main>
</template>

<style scoped>
.fv-shell { background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); overflow: hidden; height: 100%; display: flex; flex-direction: column; }
.fv-body { flex: 1; overflow: auto; padding: 12px; }
.fv-empty-row { text-align: center; color: var(--rc-faint); font-size: 12px; padding: 28px 12px; }

.fv-stats { display: flex; gap: 20px; padding: 10px 4px 14px; border-bottom: 1px solid var(--rc-border-soft); margin-bottom: 10px; }
.fv-stat { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--rc-muted); }
.fv-stat b { font-size: 16px; font-weight: 800; color: var(--rc-text); }
.fv-stat b.danger { color: var(--rc-error); }
.fv-stat b.soft { font-size: 12px; font-weight: 600; color: var(--rc-text-2); }

.fv-filters { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.fv-spacer { flex: 1; }
.muted { color: var(--rc-faint); font-size: 12px; }

.fv-table { width: 100%; }
.fv-table th.num, .fv-table td.num { text-align: right; }
.fv-name { font-family: var(--rc-mono, monospace); font-size: 12px; }
.soft { color: var(--rc-text-2); font-size: 11px; }
.fv-op { margin-right: 8px; font-size: 12px; color: var(--rc-primary-ink); text-decoration: none; }
.fv-op:hover { text-decoration: underline; }

.fv-pager { display: flex; align-items: center; gap: 8px; justify-content: flex-end; margin-top: 8px; }
.fv-pager .rc-btn { height: 26px; padding: 0 10px; font-size: 11px; }
</style>
