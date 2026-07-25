<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { overviewApi, type OverviewSummary, type TrendPoint } from '@/api'
import { useUiStore } from '@/stores/ui'
import KpiPanel from './panels/KpiPanel.vue'
import TrendPanel from './panels/TrendPanel.vue'
import DistributionPanel from './panels/DistributionPanel.vue'
import AlertPanel from './panels/AlertPanel.vue'
import EmptyState from '@/components/EmptyState.vue'

const router = useRouter()
const ui = useUiStore()

const data = ref<OverviewSummary | null>(null)
const trend = ref<TrendPoint[]>([])
const days = ref(7)
const loading = ref(false)
const loadError = ref('')

async function loadSummary() {
  data.value = await overviewApi.summary()
}

async function loadTrend() {
  trend.value = await overviewApi.trend(days.value)
}

async function loadAll() {
  loading.value = true
  loadError.value = ''
  try {
    await Promise.all([loadSummary(), loadTrend()])
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : '数据加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function onUpdateDays(d: number) {
  days.value = d
  loadTrend()
}

const updatedAt = computed(() => data.value?.updatedAt ?? '-')

onMounted(async () => {
  await loadAll()
  ui.registerAction('刷新', async () => {
    await loadAll()
    ElMessage.success('已刷新采集资产总览')
  })
  ui.registerAction('导出', () => ElMessage.info('导出总览：演示环境占位'))
  ui.registerAction('新建采集', () => {
    router.push({ path: '/canvas', query: { mode: 'new' } })
  })
})

onUnmounted(() => ui.clearActions())
</script>

<template>
  <div v-loading="loading" class="ov">
    <EmptyState
      v-if="loadError"
      icon="!"
      title="加载失败"
      :text="loadError"
      action="重新加载"
      size="lg"
      class="ov-empty-wrap"
      @action="loadAll"
    />

    <template v-else-if="data">
      <div class="ov-intro">
        <div>实时掌握采集资产运行态势，提升数据采集稳定性与治理效率。</div>
        <div class="ov-fresh">
          <span>数据更新时间：{{ updatedAt }}</span>
        </div>
      </div>

      <KpiPanel :data="data" :trend="trend" />
      <DistributionPanel :data="data" />
      <TrendPanel :data="data" :trend="trend" @update-days="onUpdateDays" />
      <AlertPanel :data="data" />
    </template>
  </div>
</template>

<style scoped>
.ov {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.ov > * {
  flex: none;
}

.ov-intro {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  color: #334155;
  font-size: 13px;
  padding: 10px 16px;
  border-radius: 8px;
  background: linear-gradient(90deg, rgba(37, 99, 235, 0.04) 0%, rgba(6, 182, 212, 0.04) 100%);
  border: 1px solid rgba(37, 99, 235, 0.06);
}

.ov-fresh {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #64748b;
  font-size: 12px;
  white-space: nowrap;
}

.ov-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 60px 20px;
  text-align: center;
}

.ov-empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #fef2f2;
  color: #ef4444;
  font-size: 22px;
  font-weight: 800;
}

.ov-empty-title {
  margin-top: 8px;
  color: #0f1e46;
  font-size: 15px;
  font-weight: 700;
}

.ov-empty-text {
  color: #64748b;
  font-size: 13px;
}

.ov-empty-btn {
  margin-top: 12px;
  height: 34px;
  padding: 0 20px;
  border: 1px solid #2563eb;
  border-radius: 6px;
  background: #2563eb;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease, box-shadow 0.2s ease;
}

.ov-empty-btn:hover {
  background: #1d4ed8;
  box-shadow: 0 8px 18px rgba(37, 99, 235, 0.2);
}

@media (max-width: 720px) {
  .ov {
    height: auto;
    min-height: 0;
  }

  .ov-intro,
  .ov-fresh {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
