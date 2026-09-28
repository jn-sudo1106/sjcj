<script setup lang="ts">
// 监控视图容器（0916）：拆成「监控结果 / 监控配置」两个 Tab。
//   · 监控结果 = 0910 迁入的那张监控列表（SiteMonitorResultView）
//   · 监控配置 = ck_source 分页列表 + 新增/编辑弹窗（SiteMonitorConfigView 2026-09-18 改版，
//     弹窗里才是原「数据监控节点告警配置」编辑器）——源在弹窗编辑器里自己选，与本层无关。
//
// 选中的源提到这一层（v-model 传给「监控结果」）：在结果里挑了某个源，下次切回来还在；
// 「监控配置」也按这个源过滤（画布进来带上 sourceId prop → 起步就锁定当前源，
// 网站「全部」不传 → 起步为空、翻整表，直到用户在结果里选了源）。
//
// Tab 状态由 URL 上的 monitorTab 决定（SiteDetailView 解析后当 prop 传进来、变更再 emit 回去）：
// 本组件不碰 router，与 SiteDataView / SourceOverviewView 同一条约定——它们的测试都是裸挂载，
// 没装 router，为了一个初始值把测试树全绑上 router 不划算。
import { ref, watch } from 'vue'
import type { SiteMonitorTab } from '@/utils/url/workspaceRoute'
import SiteMonitorResultView from './SiteMonitorResultView.vue'
import SiteMonitorConfigView from './SiteMonitorConfigView.vue'

const props = withDefaults(defineProps<{ siteId: string; tab?: SiteMonitorTab; sourceId?: string }>(), { tab: 'result' })
const emit = defineEmits<{ 'update:tab': [tab: SiteMonitorTab] }>()

const tab = ref<SiteMonitorTab>(props.tab)
// 用 watch 而不是只读初值：地址栏前进/后退改的是同一个 query，组件不会重新挂载。
watch(() => props.tab, (next) => {
  tab.value = next
})
function pickTab(next: SiteMonitorTab) {
  if (tab.value === next) return
  tab.value = next
  emit('update:tab', next)
}

const selectedSourceId = ref(props.sourceId ?? '')
// 画布「监控视图」进来时带上当前源：两个 Tab 都按这个源过滤，用户仍可在此源之外改选。
watch(() => props.sourceId, (next) => {
  selectedSourceId.value = next ?? ''
})
// 换网站清掉选中的源：源 ID 属于上一个网站，留着两个 Tab 都会按错源去查/去配。
watch(() => props.siteId, () => {
  selectedSourceId.value = ''
})
</script>

<template>
  <main class="smv-shell">
    <div class="smv-tabs" role="tablist" aria-label="监控视图">
      <button
        class="smv-tab"
        :class="{ on: tab === 'result' }"
        type="button"
        role="tab"
        :aria-selected="tab === 'result'"
        data-testid="site-monitor-tab-result"
        @click="pickTab('result')"
      >监控结果</button>
      <button
        class="smv-tab"
        :class="{ on: tab === 'config' }"
        type="button"
        role="tab"
        :aria-selected="tab === 'config'"
        data-testid="site-monitor-tab-config"
        @click="pickTab('config')"
      >监控配置</button>
    </div>

    <SiteMonitorResultView
      v-if="tab === 'result'"
      v-model:source-id="selectedSourceId"
      :site-id="siteId"
      class="smv-body"
    />
    <SiteMonitorConfigView
      v-else
      :site-id="siteId"
      :source-id="selectedSourceId || undefined"
      class="smv-body"
    />
  </main>
</template>

<style scoped>
.smv-shell { display: flex; flex-direction: column; min-height: 0; flex: 1; background: #fff; }
/* Tab 条用下划线式：上面已经有一排胶囊切换器（源/数据/文件/监控视图），
   这里再来一排同款胶囊会分不清哪排是主层级。 */
.smv-tabs { display: flex; align-items: center; gap: 2px; padding: 0 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; }
.smv-tab { position: relative; height: 34px; padding: 0 12px; border: 0; background: transparent; color: var(--rc-text-2); font-size: 12.5px; font-weight: 600; cursor: pointer; }
.smv-tab:hover { color: var(--rc-primary-ink); }
.smv-tab.on { color: var(--rc-primary); }
.smv-tab.on::after { position: absolute; right: 10px; bottom: -1px; left: 10px; height: 2px; border-radius: 2px 2px 0 0; background: var(--rc-primary); content: ''; }
.smv-body { flex: 1; min-height: 0; }
</style>
