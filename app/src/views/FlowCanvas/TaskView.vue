<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useFlowStore } from '../../stores/flow'
import { useRuntimeStore } from '../../stores/runtime'
import { siteApi, type QueueStat, type Source, type TaskInst } from '../../api'
import { nodeTaskQueue } from './flowModel'
import CanvasHeader from './CanvasHeader.vue'

// 任务视图（0707 优化·Phase5·任务视图网站化）：不随编排对象切换，始终站在网站粒度——
// 队列汇总为第一层，行展开看该队列的任务明细（第二层，分页）；0706 Phase4 的节点粒度单表形态退役。
const flow = useFlowStore()
const runtime = useRuntimeStore()
const router = useRouter()

const siteId = computed(() => flow.sourceCtx?.siteId || flow.siteCtx?.siteId || '')

// 源筛选：从子源画布进入时预选该子源；网站模板进入不预选（=全部子源聚合）
const siteChildren = ref<Source[]>([])
const sourceFilter = ref(flow.sourceCtx?.sourceId ?? '')
async function loadSiteChildren() {
  siteChildren.value = siteId.value ? await siteApi.siteSources(siteId.value) : []
}

// 队列汇总（第一层）
const queueStats = ref<QueueStat[]>([])
const loadingQueues = ref(false)
async function loadQueueStats() {
  if (!siteId.value) {
    queueStats.value = []
    return
  }
  loadingQueues.value = true
  try {
    queueStats.value = await siteApi.siteQueueStats(siteId.value, sourceFilter.value || undefined)
  } finally {
    loadingQueues.value = false
  }
}
watch(siteId, () => { loadSiteChildren(); loadQueueStats() }, { immediate: true })
watch(sourceFilter, () => {
  loadQueueStats()
  expanded.value = new Set()
  Object.keys(detail).forEach((k) => delete detail[k])
})

// 试跑实时态上卷到队列（0707 §7.2）：当前画布节点若有实时状态，其所属队列的汇总状态优先展示实时值。
// 队列名解析必须跟 mock 的 mockSourceNodeRuns 同一套 fallback（节点自己的 taskCfg.queue → 源 configTopic → queue_配置ID），
// 否则大多数由 buildSourceSeed 生成的节点 taskCfg.queue 是模板占位值/空值，永远匹配不上聚合行的队列名，实时态形同虚设。
const fallbackQueue = computed(() => flow.sourceCfg?.configTopic || (flow.sourceCfg?.configId ? `queue_${flow.sourceCfg.configId}` : ''))
const liveQueueStates = computed<Record<string, 'L' | 'C' | 'E'>>(() => {
  const map: Record<string, 'L' | 'C' | 'E'> = {}
  flow.layout.nodes.forEach(({ id, cfg }) => {
    const live = runtime.nodeStates[id]
    const queue = nodeTaskQueue(cfg) || fallbackQueue.value
    if (!live || !queue) return
    if (!map[queue] || live === 'E' || (live === 'L' && map[queue] !== 'E')) map[queue] = live
  })
  return map
})

interface QueueRow {
  queue: string
  totalTasks: number
  processedTasks: number
  unprocessed: number
  state: 'L' | 'C' | 'E' | ''
}
const rows = computed<QueueRow[]>(() =>
  queueStats.value.map((q) => ({
    queue: q.queue,
    totalTasks: q.totalTasks,
    processedTasks: q.processedTasks,
    unprocessed: Math.max(0, q.totalTasks - q.processedTasks),
    state: (liveQueueStates.value[q.queue] ?? q.state ?? '') as QueueRow['state'],
  })),
)

// 队列任务明细（第二层，展开 + 分页 + 按状态过滤）
interface DetailState { rows: TaskInst[]; total: number; page: number; loading: boolean; stateFilter: string }
const DETAIL_SIZE = 10
const expanded = ref<Set<string>>(new Set())
const detail = reactive<Record<string, DetailState>>({})
function ensureDetail(queue: string): DetailState {
  return detail[queue] ?? (detail[queue] = { rows: [], total: 0, page: 1, loading: false, stateFilter: '' })
}
async function loadDetail(queue: string) {
  const d = ensureDetail(queue)
  d.loading = true
  try {
    const res = await siteApi.queueTaskPaged({
      siteId: siteId.value,
      queue,
      sourceId: sourceFilter.value || undefined,
      state: d.stateFilter || undefined,
      page: d.page,
      size: DETAIL_SIZE,
    })
    d.rows = res?.list ?? []
    d.total = res?.total ?? 0
  } finally {
    d.loading = false
  }
}
async function toggleExpand(queue: string) {
  const next = new Set(expanded.value)
  if (next.has(queue)) next.delete(queue)
  else {
    next.add(queue)
    if (!detail[queue]) await loadDetail(queue)
  }
  expanded.value = next
}
function detailPage(queue: string, delta: number) {
  const d = detail[queue]
  if (!d) return
  const maxPage = Math.max(1, Math.ceil(d.total / DETAIL_SIZE))
  d.page = Math.min(maxPage, Math.max(1, d.page + delta))
  loadDetail(queue)
}
function setDetailState(queue: string, state: string) {
  const d = detail[queue]
  if (!d) return
  d.stateFilter = state
  d.page = 1
  loadDetail(queue)
}

function percent(r: QueueRow): number {
  if (!r.totalTasks) return 0
  return Math.min(100, Math.round((r.processedTasks / r.totalTasks) * 100))
}
function stateText(s: string): string {
  return s === 'L' ? '运行中' : s === 'C' ? '完成' : s === 'E' ? '异常' : '空闲'
}
function stateClass(s: string): string {
  return s === 'L' ? 'run' : s === 'C' ? 'ok' : s === 'E' ? 'err' : 'muted'
}

// 明细行「任务配置」快捷入口：与该任务同源时直接切流程视图定位节点；跨源则先跳去那个源的画布
function goTaskConfig(t: TaskInst) {
  if (flow.sourceCtx?.sourceId === t.sourceId && t.node) {
    flow.select(t.node)
    flow.setActiveTab('task')
    const query = { ...router.currentRoute.value.query }
    delete query.view
    router.push({ path: '/canvas', query })
  } else {
    router.push({ path: '/canvas', query: { sourceId: t.sourceId } })
  }
}
</script>

<template>
  <main class="tv-shell">
    <CanvasHeader />
    <div class="tv-body">
      <div v-if="!siteId" class="tv-empty-row">该源未归属任何网站，任务视图暂不可用。</div>
      <template v-else>
        <div class="tv-filters">
          <el-select v-model="sourceFilter" class="tv-source-select" placeholder="全部子源" filterable clearable>
            <el-option v-for="s in siteChildren" :key="s.sourceId" :label="s.name" :value="s.sourceId" />
          </el-select>
          <span class="tv-spacer" />
          <span class="muted">{{ rows.length }} 个队列</span>
        </div>

        <table class="rc-data-table tv-table" v-loading="loadingQueues">
          <thead>
            <tr>
              <th style="width: 24px"></th>
              <th>队列</th>
              <th class="num">总任务数</th>
              <th class="num">未处理</th>
              <th class="progress-col">已处理数</th>
              <th>运行状态</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="r in rows" :key="r.queue">
              <tr class="tv-queue-row" @click="toggleExpand(r.queue)">
                <td><button class="tv-expand-btn" type="button" :class="{ open: expanded.has(r.queue) }">›</button></td>
                <td class="tv-queue-name">{{ r.queue }}</td>
                <td class="num">{{ r.totalTasks.toLocaleString() }}</td>
                <td class="num">{{ r.unprocessed.toLocaleString() }}</td>
                <td>
                  <div class="tv-progress">
                    <div class="tv-progress-bar"><i :style="{ width: percent(r) + '%' }" :class="{ err: r.state === 'E' }" /></div>
                    <span class="tv-progress-text">{{ r.processedTasks.toLocaleString() }} / {{ r.totalTasks.toLocaleString() }}</span>
                  </div>
                </td>
                <td><span class="rc-status" :class="stateClass(r.state)">{{ stateText(r.state) }}</span></td>
              </tr>
              <tr v-if="expanded.has(r.queue)" class="tv-detail-row">
                <td colspan="6">
                  <div class="tv-detail" @click.stop>
                    <div class="tv-detail-filters">
                      <button
                        v-for="s in [['', '全部'], ['C', '已处理'], ['L', '运行中'], ['E', '异常']]"
                        :key="s[0]"
                        type="button"
                        class="tv-detail-chip"
                        :class="{ active: (detail[r.queue]?.stateFilter ?? '') === s[0] }"
                        @click="setDetailState(r.queue, s[0])"
                      >{{ s[1] }}</button>
                      <span class="tv-spacer" />
                      <span class="muted">共 {{ detail[r.queue]?.total ?? 0 }} 条</span>
                    </div>
                    <table class="rc-data-table" v-loading="detail[r.queue]?.loading">
                      <thead>
                        <tr><th>任务 ID</th><th>所属源</th><th>节点</th><th>状态</th><th>更新时间</th><th></th></tr>
                      </thead>
                      <tbody>
                        <tr v-for="t in (detail[r.queue]?.rows ?? [])" :key="t.taskId">
                          <td>{{ t.taskId }}</td>
                          <td>{{ siteChildren.find((s) => s.sourceId === t.sourceId)?.name ?? t.sourceId }}</td>
                          <td>{{ t.taskName }}</td>
                          <td><span class="rc-status" :class="stateClass(t.state)">{{ stateText(t.state) }}</span></td>
                          <td class="tv-detail-time">{{ t.updatedAt || '—' }}</td>
                          <td class="tv-ops"><button class="rc-btn" type="button" @click="goTaskConfig(t)">任务配置</button></td>
                        </tr>
                        <tr v-if="!(detail[r.queue]?.rows ?? []).length && !detail[r.queue]?.loading">
                          <td colspan="6" class="tv-empty-row">该队列没有可展示的任务明细</td>
                        </tr>
                      </tbody>
                    </table>
                    <div class="tv-detail-pager">
                      <button class="rc-btn" type="button" :disabled="(detail[r.queue]?.page ?? 1) <= 1" @click="detailPage(r.queue, -1)">上一页</button>
                      <span class="muted">第 {{ detail[r.queue]?.page ?? 1 }} 页</span>
                      <button
                        class="rc-btn"
                        type="button"
                        :disabled="(detail[r.queue]?.page ?? 1) * DETAIL_SIZE >= (detail[r.queue]?.total ?? 0)"
                        @click="detailPage(r.queue, 1)"
                      >下一页</button>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
            <tr v-if="!rows.length && !loadingQueues">
              <td colspan="6" class="tv-empty-row">该网站还没有队列数据，回到流程视图配置节点任务队列后此处按队列展示运行记录。</td>
            </tr>
          </tbody>
        </table>
        <div class="tv-help">任务视图 = 网站下全部子源节点按队列汇总：任务从队列拉取 → 读输入表 → 处理 → 写输出表；展开队列查看任务明细，试跑期间队列状态与画布节点实时同步。</div>
      </template>
    </div>
  </main>
</template>

<style scoped>
.tv-shell { background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); overflow: hidden; height: 100%; display: flex; flex-direction: column; }
.tv-body { flex: 1; overflow: auto; padding: 12px; }
.tv-filters { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.tv-source-select { width: 200px; }
.tv-source-select :deep(.el-select__wrapper) { min-height: 30px; }
.tv-spacer { flex: 1; }
.muted { color: var(--rc-faint); font-size: 12px; }

.tv-table { width: 100%; }
.tv-table th.num, .tv-table td.num { text-align: right; }
.tv-table th.progress-col { min-width: 200px; }
.tv-queue-row { cursor: pointer; }
.tv-queue-row:hover { background: #f8fafc; }
.tv-queue-name { font-size: 12px; font-weight: 700; color: var(--rc-text); font-family: var(--rc-mono, monospace); }
.tv-expand-btn { border: 0; background: transparent; color: var(--rc-muted); font-size: 13px; cursor: pointer; width: 20px; transition: transform 0.15s; }
.tv-expand-btn.open { transform: rotate(90deg); }

.tv-progress { display: flex; align-items: center; gap: 8px; }
.tv-progress-bar { flex: 1; min-width: 90px; height: 6px; border-radius: 999px; background: #eef2f7; overflow: hidden; }
.tv-progress-bar i { display: block; height: 100%; border-radius: 999px; background: var(--rc-primary); transition: width 0.3s; }
.tv-progress-bar i.err { background: var(--rc-error); }
.tv-progress-text { flex: none; font-size: 11px; color: var(--rc-muted); font-family: var(--rc-mono, monospace); white-space: nowrap; }

.tv-detail-row td { padding: 0; border-bottom: 1px solid var(--rc-border-soft); }
.tv-detail { background: #f8fafc; padding: 12px; cursor: default; }
.tv-detail-filters { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.tv-detail-chip { height: 24px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 999px; background: #fff; color: var(--rc-text-2); font-size: 11px; cursor: pointer; }
.tv-detail-chip:hover { border-color: #bfdbfe; }
.tv-detail-chip.active { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; font-weight: 700; }
.tv-detail-time { font-family: var(--rc-mono, monospace); font-size: 11px; color: var(--rc-faint); }
.tv-detail-pager { display: flex; align-items: center; gap: 8px; justify-content: flex-end; margin-top: 8px; }
.tv-detail-pager .rc-btn { height: 26px; padding: 0 10px; font-size: 11px; }

.tv-empty-row { text-align: center; color: var(--rc-faint); font-size: 12px; padding: 28px 12px; }
.tv-ops { text-align: right; }
.tv-ops .rc-btn { height: 26px; padding: 0 9px; font-size: 11px; }
.tv-help { margin-top: 10px; color: var(--rc-faint); font-size: 11px; line-height: 1.6; }
</style>
