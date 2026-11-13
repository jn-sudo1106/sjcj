<script setup lang="ts">
// 画布「监控视图」（源视角，与流程/数据/文件/任务平级的那一档）。
// 2026-09-28 改版：这一档原来只是当前选中节点的告警面板（AlertConfigPanel），
// 现在整体换成与「全部 · 监控视图」同款的两 Tab 容器（监控结果 / 监控配置），
// 接口调用也一致（sourceCheck 分页 + ck_source 分页），只是按当前源过滤：
//   · 起步带上 sourceCtx.sourceId，两个 Tab 都先只显示这个源的监控/配置；
//   · 用户仍可在「监控结果」里改选其他源（沿用容器内的 v-model 行为）。
// 旧的「选中节点 → 配该节点告警」入口不在这条路径上了；AlertConfigPanel 由编辑器弹窗承接。
import { computed } from 'vue'
import CanvasHeader from '@/views/FlowCanvas/shared/CanvasHeader.vue'
import SiteMonitorView from './SiteMonitorView.vue'
import { useFlowStore } from '@/stores/flow'

const flow = useFlowStore()
const siteId = computed(() => flow.sourceCtx?.siteId ?? '')
const sourceId = computed(() => flow.sourceCtx?.sourceId ?? '')
</script>

<template>
  <main class="mcv-shell">
    <CanvasHeader />
    <div class="mcv-body">
      <!-- key 带 sourceId：换源时整块重挂，两个 Tab 的列表/筛选回到该源初值，不残留上一个源的状态。 -->
      <SiteMonitorView
        v-if="sourceId"
        :key="sourceId"
        :site-id="siteId"
        :source-id="sourceId"
        class="mcv-monitor"
      />
      <div v-else class="mcv-empty">当前没有可监控的源，请先在流程视图选择一个数据采集源。</div>
    </div>
  </main>
</template>

<style scoped>
.mcv-shell { display: flex; flex-direction: column; height: 100%; overflow: hidden; background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); }
.mcv-body { flex: 1; min-height: 0; overflow: hidden; display: flex; }
.mcv-monitor { flex: 1; min-height: 0; }
.mcv-empty { padding: 40px 12px; margin: auto; color: var(--rc-faint); font-size: 12px; text-align: center; }
</style>
