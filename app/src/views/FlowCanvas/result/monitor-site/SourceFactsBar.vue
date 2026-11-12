<script setup lang="ts">
// 源信息条：源 / 网站 / 主表 / 检查项 / 最近检查 / 所选日期覆盖（1110 §3.1、原型说明 §四·一）。
//
// 只接收已算好的 summary（来自 sourceSummary.summarizeSource），最差事实也直接用它，
// 页面不自行拼状态判断；覆盖项固定占位，等 C07 源级聚合接口。
import { computed } from 'vue'
import type { MonitorSourceRow } from '@/api/types/monitorCenter'
import { sourceFacts, type SourceFactInput } from './monitorFacts'

const props = defineProps<{
  sourceId: string
  sourceName?: string
  siteId?: string
  siteName?: string
  mainTable?: string
  summary: MonitorSourceRow
}>()

const facts = computed(() => {
  const input: SourceFactInput = {
    sourceId: props.sourceId,
    sourceName: props.sourceName,
    siteId: props.siteId,
    siteName: props.siteName,
    mainTable: props.mainTable,
    summary: props.summary,
  }
  return sourceFacts(input)
})

const worst = computed(() => props.summary)
</script>

<template>
  <section class="sfb" aria-label="源监控信息">
    <div class="sfb-worst" data-testid="site-monitor-worst" :data-tone="worst.tone">
      <span class="sfb-worst-tag">最差事实</span>
      <strong class="sfb-worst-label">{{ worst.label }}</strong>
      <span class="sfb-worst-hint">口径同监控中心源列表</span>
    </div>
    <dl class="sfb-facts" data-testid="site-monitor-facts">
      <div v-for="item in facts" :key="item.key" class="sfb-fact" :data-testid="`site-monitor-fact-${item.key}`">
        <dt>{{ item.label }}</dt>
        <dd :title="item.title || item.value" :class="{ 'sfb-pending': item.key === 'coverage' }">
          {{ item.value }}
        </dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.sfb {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  padding: 12px;
  margin-bottom: 12px;
  border: 1px solid var(--rc-border);
  border-radius: 8px;
  background: var(--rc-surface);
  border-bottom: 1px solid var(--rc-border-soft, #eef1f5);
  white-space: nowrap;
  overflow: hidden;
}
.sfb-worst {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  flex: none;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--rc-border-soft, #eef1f5);
  background: var(--rc-bg-muted, #f7f9fc);
  font-size: 12px;
  line-height: 18px;
}
.sfb-worst-tag {
  color: var(--rc-muted);
  font-size: 11px;
}
.sfb-worst-label {
  font-weight: 600;
}
.sfb-worst-hint {
  color: var(--rc-muted);
  font-size: 11px;
  padding-left: 2px;
  border-left: 1px solid var(--rc-border-soft, #eef1f5);
}
.sfb-worst[data-tone='good'] .sfb-worst-label { color: var(--rc-ok); }
.sfb-worst[data-tone='bad'] .sfb-worst-label { color: var(--rc-error); }
.sfb-worst[data-tone='warn'] .sfb-worst-label { color: var(--rc-warn); }
.sfb-worst[data-tone='unknown'] .sfb-worst-label { color: var(--rc-text-2, #5b667a); }
.sfb-worst[data-tone='muted'] .sfb-worst-label { color: var(--rc-muted); }

.sfb-facts {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
  flex: 1;
  min-width: 0;
}
.sfb-fact {
  min-width: 0;
}
.sfb-fact dt {
  color: var(--rc-muted);
  font-size: 11px;
  line-height: 16px;
}
.sfb-fact dd {
  margin: 0;
  color: var(--rc-text);
  font-size: 12.5px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sfb-pending {
  color: var(--rc-muted);
}
@media (max-width: 1000px) { .sfb-facts { grid-template-columns: repeat(3, minmax(0, 1fr)); row-gap: 12px; } }
</style>