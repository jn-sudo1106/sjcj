<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router'
import { Refresh } from '@element-plus/icons-vue'
import { sourceApi, sourceCheckApi, sourceGroupApi, type TaskInst, type SourceCheck } from '@/api'
import { useFlowStore } from '@/stores/flow'
import type { SourceWorkspaceView } from '@/utils/url/workspaceRoute'
import CanvasHeader from '../shared/CanvasHeader.vue'

const flow = useFlowStore()
const route = useRoute()
const router = useRouter()
const source = computed(() => flow.sourceCtx)
// 2026-10-12：「我的分组」改为全平台共用的来源组（只读），这里显示源所在的来源组
const groupName = ref('')
watch(() => source.value?.sourceGroupId, async (id) => {
  groupName.value = ''
  if (!id) return
  try {
    groupName.value = (await sourceGroupApi.list()).find(g => g.sourceGroupId === id)?.sourceGroupName ?? `#${id}`
  } catch {
    groupName.value = `#${id}`
  }
}, { immediate: true })
const tasks = ref<TaskInst[]>([])
const alerts = ref<SourceCheck[]>([])
const taskTotal = ref<number | null>(null)
const alertTotal = ref<number | null>(null)
const taskError = ref('')
const alertError = ref('')
const loading = ref(false)
let sequence = 0
const stateLabel = (state: string) => ({ L: '处理中', C: '完成', E: '出错' }[state] || state || '暂无状态')
const shortcuts: { view: SourceWorkspaceView; title: string; description: string }[] = [
  { view: 'flow', title: '流程', description: '查看节点、处理关系与配置' },
  { view: 'data', title: '数据', description: '查询结构化产出与数据详情' },
  { view: 'file', title: '文件', description: '查看、预览和下载产出文件' },
  { view: 'task', title: '任务', description: '检查执行记录与失败原因' },
  { view: 'monitor-config', title: '监控', description: '查看监控配置与检查情况' },
]
function open(view: SourceWorkspaceView) {
  const query: LocationQueryRaw = { ...route.query, view }
  // 概览快捷入口面向整个源，不沿用其他视图残留的节点/表筛选。
  delete query.nodeId
  delete query.tableId
  delete query.tab
  void router.push({ path: '/canvas', query })
}
async function load() {
  const id = source.value?.sourceId
  const request = ++sequence
  tasks.value = []; alerts.value = []
  taskTotal.value = null; alertTotal.value = null
  taskError.value = ''; alertError.value = ''
  if (!id) { loading.value = false; return }
  loading.value = true
  const results = await Promise.allSettled([
    sourceApi.sourceTaskPaged({ siteId: source.value?.siteId || '', sourceId: id, page: 1, size: 5 }),
    sourceCheckApi.paged({ sourceId: id, state: 'E', page: 1, size: 5 }),
  ])
  if (request !== sequence) return
  const [taskResult, alertResult] = results
  if (taskResult.status === 'fulfilled') {
    tasks.value = taskResult.value.list
    taskTotal.value = taskResult.value.total
  } else taskError.value = taskResult.reason instanceof Error ? taskResult.reason.message : '任务加载失败'
  if (alertResult.status === 'fulfilled') {
    alerts.value = alertResult.value.list
    alertTotal.value = alertResult.value.total
  } else alertError.value = alertResult.reason instanceof Error ? alertResult.reason.message : '告警加载失败'
  loading.value = false
}
watch(() => source.value?.sourceId, () => { void load() }, { immediate: true })
onBeforeUnmount(() => { sequence += 1 })
</script>

<template>
  <section class="source-summary" aria-label="源概览">
    <CanvasHeader />
    <div v-if="source" class="summary-body">
      <div class="summary-heading"><div><h2>源概览</h2><p>查看当前源的配置、运行与产出情况</p></div><el-button :icon="Refresh" circle :loading="loading" aria-label="刷新运行与告警" title="刷新运行与告警" @click="load" /></div>
      <div class="summary-metrics">
        <article><span>源状态</span><strong>{{ source.disabled ? '已停用' : '已启用' }}</strong><small>最近运行：{{ stateLabel(source.state) }}</small></article>
        <article><span>数据产出</span><strong>{{ source.dataCount ?? '—' }}</strong><small>源数据量 · 未提供时显示 —</small></article>
        <article><span>任务记录</span><strong>{{ taskTotal ?? '—' }}</strong><small>{{ loading ? '正在加载' : taskError ? '暂时无法获取' : '当前源任务总数' }}</small></article>
        <article><span>异常检查</span><strong>{{ alertTotal ?? '—' }}</strong><small>{{ loading ? '正在加载' : alertError ? '暂时无法获取' : '状态为告警的检查项' }}</small></article>
      </div>
      <article class="summary-panel">
        <h3>基本信息</h3>
        <dl>
          <div><dt>源名称</dt><dd>{{ source.name }}</dd></div><div><dt>源 ID</dt><dd>{{ source.sourceId }}</dd></div>
          <div><dt>所属平台</dt><dd>{{ source.siteName || source.siteId || '未关联平台' }}</dd></div>
          <div><dt>我的分组</dt><dd>{{ source.sourceGroupId ? groupName || '…' : '未加入分组' }}<small>全平台共用的分组（来源组），在系统设置维护</small></dd></div>
          <div><dt>当前流程 ID</dt><dd>{{ source.flowId || '未绑定流程' }}</dd></div><div><dt>负责人</dt><dd>{{ source.owner || '—' }}</dd></div>
          <div class="wide"><dt>采集入口</dt><dd>{{ source.url || '—' }}</dd></div>
          <div><dt>最近任务</dt><dd>{{ source.lastTaskAt || '—' }}</dd></div><div><dt>最近成功</dt><dd>{{ source.lastSuccessAt || '—' }}</dd></div>
          <div><dt>最近数据写入</dt><dd>{{ source.lastInsertAt || '—' }}</dd></div><div><dt>采集周期</dt><dd>{{ source.cycle || '—' }}</dd></div>
        </dl>
      </article>
      <nav class="summary-links" aria-label="源工作视图"><button v-for="item in shortcuts" :key="item.view" type="button" @click="open(item.view)"><strong>{{ item.title }} →</strong><span>{{ item.description }}</span></button></nav>
      <div class="summary-details">
        <article class="summary-panel" :aria-busy="loading">
          <h3>任务摘要 <button type="button" @click="open('task')">查看全部任务 →</button></h3>
          <p v-if="taskError" role="alert" class="summary-error">{{ taskError }}<button type="button" @click="load">重试</button></p>
          <p v-else-if="loading">正在加载任务…</p><p v-else-if="!tasks.length">暂无任务记录</p>
          <ul v-else><li v-for="task in tasks" :key="task.taskId"><strong>{{ task.taskName || task.taskId }}</strong><span>{{ stateLabel(task.state) }}</span><small>{{ task.updatedAt || task.createdAt || '—' }}</small></li></ul>
          <small>展示任务列表前 5 条；完整记录及执行详情请进入任务视图。</small>
        </article>
        <article class="summary-panel" :aria-busy="loading">
          <h3>异常告警 <button type="button" @click="open('monitor-config')">查看监控 →</button></h3>
          <p v-if="alertError" role="alert" class="summary-error">{{ alertError }}<button type="button" @click="load">重试</button></p>
          <p v-else-if="loading">正在加载告警…</p><p v-else-if="!alerts.length">暂无异常检查记录</p>
          <ul v-else><li v-for="alert in alerts" :key="alert.id"><strong>{{ alert.name }}</strong><span>{{ alert.lastMsg || '检查异常' }}</span><small>{{ alert.lastRun || '—' }}</small></li></ul>
          <small>无异常记录不代表所有采集任务均已完成。</small>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.source-summary { display: flex; flex-direction: column; min-height: 0; }
.summary-body { flex: 1; min-height: 0; overflow: auto; padding: 16px; background: var(--rc-bg); }
.summary-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
h2, h3, p { margin: 0; } h2 { font-size: 18px; } h3 { font-size: 14px; margin-bottom: 14px; }
.summary-heading p, small, dt { color: var(--rc-muted); font-size: 12px; } .summary-heading p { margin-top: 6px; }
.summary-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.summary-metrics article, .summary-panel { background: var(--rc-surface); border: 1px solid var(--rc-border); border-radius: var(--rc-radius); padding: 16px; }
.summary-metrics span, .summary-metrics strong, .summary-metrics small { display: block; }
.summary-metrics span { font-size: 12px; color: var(--rc-muted); }.summary-metrics strong { font-size: 23px; margin: 10px 0; }
dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin: 0; } dd { margin: 5px 0 0; font-size: 13px; overflow-wrap: anywhere; } dd small { display: block; margin-top: 5px; }.wide { grid-column: 1 / -1; }
.summary-links { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 16px 0; }
.summary-links button { text-align: left; padding: 14px; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); background: var(--rc-surface); cursor: pointer; }.summary-links strong { color: var(--rc-primary); }.summary-links span { display: block; margin-top: 8px; color: var(--rc-muted); font-size: 12px; }
.summary-details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.summary-panel h3 { display: flex; justify-content: space-between; gap: 8px; }.summary-panel button { border: 0; background: transparent; color: var(--rc-primary); cursor: pointer; font-size: 12px; }
ul { list-style: none; padding: 0; margin: 0; } li { display: grid; gap: 5px; padding: 10px 0; border-bottom: 1px solid var(--rc-border-soft); overflow-wrap: anywhere; font-size: 13px; }.summary-panel > small { display: block; margin-top: 12px; }.summary-error { color: var(--rc-error); overflow-wrap: anywhere; }
@media (max-width: 1100px) { .summary-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }.summary-details { grid-template-columns: 1fr; } }
@media (max-width: 650px) { dl { grid-template-columns: 1fr; }.summary-body { padding: 10px; } }
</style>
