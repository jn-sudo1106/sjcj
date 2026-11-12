<script setup lang="ts">
// 运行记录抽屉（可复用实现）：列表层（一行一次正式运行）→ 单次详情层，自带返回。
//
// 对外接口（Lead 约定，集成时源维度列表 / 源内视图直接挂这个）：
//   props: { open, sourceId?, monitorId?, title? }
//   emits: ['close']
// 数据只走 listRuns：monitorId 优先，其次 sourceId；不读旧 paged-logs、不拿当前定义补历史。
//
// 服务端 listRuns 没有执行/数据/通知三维筛选，客户端只在已加载记录上筛；
// 因此按 200/页、最多 5 页加载，超出时底部显式提示「已加载 N / 共 M」，不静默截断。

import { computed, ref, watch } from 'vue'
import type { MonitorRunView } from '@/api/types/monitorCenter'
import { listRuns } from '@/api/monitorCenter'
import RunDetailPane from './RunDetailPane.vue'
import RunListPane from './RunListPane.vue'
import { SCOPE_NOTE, hasRunScope, runListQuery, type RunScope } from './runScope'

const props = defineProps<{
  open: boolean
  sourceId?: string
  monitorId?: string
  title?: string
  initialRun?: MonitorRunView | null
}>()

const emit = defineEmits<{ close: [] }>()

const RUN_PAGE_SIZE = 200
const RUN_MAX_PAGES = 5

const runs = ref<MonitorRunView[]>([])
const total = ref(0)
const truncated = ref(false)
const loading = ref(false)
const error = ref('')
const detail = ref<MonitorRunView | null>(null)

const scope = computed<RunScope>(() => ({
  sourceId: props.sourceId,
  monitorId: props.monitorId,
  monitorName: props.title,
}))

const scopeKey = computed(() => `${props.sourceId ?? ''}|${props.monitorId ?? ''}`)

const drawerTitle = computed(() => (props.title ? `运行记录 · ${props.title}` : '运行记录'))

// 打开期间连续切范围/刷新时，用 token 丢弃过期响应，避免旧结果覆盖新范围。
let loadToken = 0

async function load() {
  const token = ++loadToken
  const query = runListQuery(scope.value)
  if (!hasRunScope(scope.value)) {
    runs.value = []
    total.value = 0
    truncated.value = false
    loading.value = false
    error.value = '未指定运行范围（缺少当前检查项或当前源）'
    return
  }

  loading.value = true
  error.value = ''
  try {
    const first = await listRuns({ ...query, page: 1, size: RUN_PAGE_SIZE })
    if (token !== loadToken) return
    const loaded = [...first.list]
    let backendTotal = Number(first.total ?? loaded.length) || loaded.length

    for (let page = 2; page <= RUN_MAX_PAGES && loaded.length < backendTotal; page += 1) {
      const next = await listRuns({ ...query, page, size: RUN_PAGE_SIZE })
      if (token !== loadToken) return
      loaded.push(...next.list)
      backendTotal = Math.max(backendTotal, Number(next.total ?? 0) || 0)
      if (!next.list.length) break
    }

    runs.value = loaded
    total.value = backendTotal
    truncated.value = loaded.length < backendTotal
  } catch (err) {
    if (token !== loadToken) return
    runs.value = []
    total.value = 0
    truncated.value = false
    error.value = err instanceof Error ? err.message : '运行记录加载失败'
  } finally {
    if (token === loadToken) loading.value = false
  }
}

function openRun(run: MonitorRunView) {
  detail.value = run
}

function backToList() {
  detail.value = null
}

function onVisibleChange(visible: boolean) {
  if (!visible) emit('close')
}

watch(
  () => [props.open, props.sourceId, props.monitorId] as const,
  ([open]) => {
    if (!open) { loadToken += 1; loading.value = false; return }
    // 每次打开都回到列表层并重新拉取：运行记录会持续增长，留上次的详情/翻页没有意义。
    detail.value = props.initialRun ?? null
    void load()
  },
  { immediate: true },
)
</script>

<template>
  <el-drawer
    :model-value="open"
    :title="drawerTitle"
    class="monitor-runs-drawer"
    direction="rtl"
    size="min(1000px, 94vw)"
    destroy-on-close
    @update:model-value="onVisibleChange"
  >
    <div class="mr-shell">
      <RunListPane
        v-if="!detail"
        :key="scopeKey"
        :scope="scope"
        :runs="runs"
        :loading="loading"
        :error="error"
        :total="total"
        :truncated="truncated"
        @open="openRun"
        @refresh="load"
      />
      <RunDetailPane v-else :run="detail" @back="backToList" />
    </div>
    <div v-if="!detail && !loading" class="mr-foot">{{ SCOPE_NOTE }}；详情只读本次运行的冻结快照。</div>
  </el-drawer>
</template>

<style scoped>
.mr-shell { min-height: 200px; }
.mr-foot { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--rc-border-soft); font-size: 11px; color: var(--rc-faint); }
</style>
<style>
.monitor-runs-drawer .el-drawer__header { margin-bottom: 0; padding: 18px 20px; border-bottom: 1px solid var(--rc-border); color: var(--rc-text); font-size: 14px; font-weight: 600; }
.monitor-runs-drawer .el-drawer__body { padding: 16px 20px; overflow-x: hidden; }
</style>
