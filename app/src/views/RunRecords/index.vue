<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { runApi, type RunRow, type RunNode } from '../../api'
import { useUiStore } from '../../stores/ui'
import { useRuntimeStore } from '../../stores/runtime'

const ui = useUiStore()
const runtime = useRuntimeStore()
const route = useRoute()

const mockRuns = ref<RunRow[]>([])
const runs = computed(() => [...runtime.runs, ...mockRuns.value]) // 试跑产生的 run 叠加在 mock 之上
const selected = ref<RunRow | null>(null)
const nodes = ref<RunNode[]>([])
const nodesLoading = ref(false)
const stats = reactive({ completed: 0, failed: 0, running: 0, ruleHits: 0 })

async function selectRun(r: RunRow) {
  selected.value = r
  nodes.value = []
  nodesLoading.value = true
  try {
    nodes.value = runtime.runNodes[r.runId] ?? (await runApi.runNodes(r.runId))
  } finally {
    nodesLoading.value = false
  }
}

function stMeta(s: string) {
  if (s === 'C') return { cls: 'ok', text: '完成' }
  if (s === 'E') return { cls: 'err', text: '失败' }
  if (s === 'L') return { cls: 'run', text: '处理中' }
  return { cls: 'muted', text: '未知' }
}

onMounted(async () => {
  mockRuns.value = await runApi.runs()
  Object.assign(stats, await runApi.runStats())
  const queryState = Array.isArray(route.query.state) ? route.query.state[0] : route.query.state
  const first = (queryState ? runs.value.find((r) => r.state === queryState) : null)
    ?? runs.value.find((r) => r.state === 'C')
    ?? runs.value[0]
  if (first) await selectRun(first)
  ui.registerAction('导出记录', () => ElMessage.info('导出记录：演示环境占位'))
})
onUnmounted(() => ui.clearActions())
</script>

<template>
  <div class="rr-layout">
    <!-- run 列表 -->
    <div class="rc-card rr-list">
      <div class="rc-card-head">
        <div>
          <div class="rc-card-title">运行记录</div>
          <div class="rc-card-sub">按 run_id 追溯一次运行</div>
        </div>
      </div>
      <div class="rr-list-scroll">
        <button
          v-for="r in runs"
          :key="r.runId"
          class="rr-item"
          :class="{ active: selected?.runId === r.runId }"
          type="button"
          @click="selectRun(r)"
        >
          <div class="rr-item-top">
            <strong>{{ r.runId }}</strong>
            <span class="rc-status" :class="stMeta(r.state).cls">{{ stMeta(r.state).text }}</span>
          </div>
          <div class="muted rr-item-flow">{{ r.flow }}</div>
          <div class="muted">{{ r.startedAt }} · {{ r.owner }}</div>
        </button>
      </div>
    </div>

    <!-- run 详情 -->
    <div class="rc-card rr-main">
      <div class="rc-metric-grid rr-kpis">
        <div class="rc-metric"><span>完成节点</span><b class="success">{{ stats.completed }}</b></div>
        <div class="rc-metric"><span>失败 / 待重试</span><b class="danger">{{ stats.failed }}</b></div>
        <div class="rc-metric"><span>处理中</span><b>{{ stats.running }}</b></div>
        <div class="rc-metric"><span>规则命中</span><b>{{ stats.ruleHits }}</b></div>
      </div>

      <div v-if="selected" v-loading="nodesLoading" class="rr-body">
        <div class="rr-head">
          <div>
            <div class="rr-title">{{ selected.runId }}</div>
            <div class="muted">{{ selected.flow }} · {{ selected.startedAt }} → {{ selected.finishedAt || '进行中' }}</div>
          </div>
          <span class="rc-status" :class="stMeta(selected.state).cls">{{ stMeta(selected.state).text }}</span>
        </div>

        <div class="rr-section">节点状态时间线</div>
        <div class="rr-timeline">
          <div v-for="n in nodes" :key="n.nodeId" class="rr-tl-item">
            <span class="rr-dot" :class="stMeta(n.state).cls" />
            <div class="rr-tl-body">
              <div class="rr-tl-name">{{ n.name }} <span class="rc-status" :class="stMeta(n.state).cls">{{ stMeta(n.state).text }}</span></div>
              <div class="muted">{{ n.input || '—' }} → {{ n.output || '—' }}</div>
            </div>
          </div>
          <div v-if="!nodes.length && !nodesLoading" class="muted rr-empty">该 run 暂无节点明细</div>
        </div>

        <div class="rr-section">逐节点任务 · 关联指针</div>
        <div class="rc-table-scroll">
          <table class="rc-data-table">
            <thead>
              <tr>
                <th>节点</th>
                <th style="width: 76px">状态</th>
                <th>产物</th>
                <th style="width: 130px">失败处理</th>
                <th style="width: 110px">ext_task</th>
                <th style="width: 120px">ext_trace</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="n in nodes" :key="n.nodeId">
                <td>{{ n.name }}</td>
                <td><span class="rc-status" :class="stMeta(n.state).cls">{{ stMeta(n.state).text }}</span></td>
                <td>{{ n.output || '—' }}</td>
                <td>{{ n.failAction || '—' }}</td>
                <td>{{ n.extTaskId || '—' }}</td>
                <td>{{ n.extTraceId || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="rc-mini-card">跨系统追溯：ext_task / ext_trace / skill_run 为审计入口，二期跳转外部系统定位原始文件与落表结果。</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rr-layout {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 12px;
}
.rr-list, .rr-main {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 168px);
  min-height: 560px;
}
.rr-list-scroll {
  flex: 1;
  overflow: auto;
  padding: 10px;
}
.rr-item {
  display: block;
  width: 100%;
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius);
  background: #fff;
  text-align: left;
  cursor: pointer;
}
.rr-item:first-child {
  margin-top: 0;
}
.rr-item.active {
  border-color: var(--rc-primary);
  box-shadow: var(--rc-glow-blue);
}
.rr-item-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}
.rr-item-top strong {
  font-size: 13px;
  color: var(--rc-text);
}
.rr-item-flow {
  margin-bottom: 2px;
}
.rr-kpis {
  padding: 14px 16px;
  border-bottom: 1px solid var(--rc-border-soft);
}
.rr-body {
  flex: 1;
  overflow: auto;
  padding: 16px;
}
.rr-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}
.rr-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--rc-text);
}
.rr-section {
  margin: 16px 0 10px;
  font-size: 13px;
  font-weight: 700;
  color: var(--rc-text);
}
.rr-timeline {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-left: 4px;
}
.rr-tl-item {
  display: flex;
  gap: 12px;
  padding-bottom: 14px;
  border-left: 2px solid var(--rc-border);
  margin-left: 5px;
  padding-left: 16px;
  position: relative;
}
.rr-tl-item:last-child {
  border-left-color: transparent;
  padding-bottom: 0;
}
.rr-dot {
  position: absolute;
  left: -7px;
  top: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid #fff;
}
.rr-dot.ok { background: var(--rc-ok); }
.rr-dot.err { background: var(--rc-error); }
.rr-dot.run { background: var(--rc-primary); }
.rr-dot.muted { background: var(--rc-faint); }
.rr-tl-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--rc-text);
  margin-bottom: 2px;
}
.rr-empty {
  padding: 8px 0;
}

@media (max-width: 1240px) {
  .rr-layout {
    grid-template-columns: 1fr;
  }
  .rr-list, .rr-main {
    height: auto;
  }
}
</style>
