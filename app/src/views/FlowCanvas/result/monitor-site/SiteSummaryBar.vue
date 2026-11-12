<script setup lang="ts">
// 网站视图监控摘要（1110 原型说明 §四·二）：7 项口径与全局源列表一致。
//
// 7 项都需要服务端按授权范围聚合（C07）。当前接口只能拿到「当前页」监控记录，
// 前端不拿它推算整站结果——统一显示「—（需服务端聚合）」，绝不用 0 冒充。
import { SITE_SUMMARY_ITEMS, SITE_SUMMARY_NOTE, COVERAGE_PLACEHOLDER } from './monitorFacts'

defineProps<{
  siteName?: string
}>()
</script>

<template>
  <section class="ssb" data-testid="site-monitor-site-summary" aria-label="网站监控摘要">
    <div class="ssb-head">
      <strong>网站监控摘要</strong>
      <span v-if="siteName" class="ssb-site">{{ siteName }}</span>
    </div>
    <dl class="ssb-items">
      <div v-for="item in SITE_SUMMARY_ITEMS" :key="item" class="ssb-item" :data-testid="`site-monitor-site-summary-${item}`">
        <dt>{{ item }}</dt>
        <dd class="ssb-pending">{{ COVERAGE_PLACEHOLDER }}</dd>
      </div>
    </dl>
    <p class="ssb-note" data-testid="site-monitor-site-summary-note">{{ SITE_SUMMARY_NOTE }}</p>
  </section>
</template>

<style scoped>
.ssb {
  padding: 6px 4px 8px;
  border-bottom: 1px solid var(--rc-border-soft, #eef1f5);
}
.ssb-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12.5px;
  line-height: 18px;
  white-space: nowrap;
}
.ssb-head strong {
  color: var(--rc-text-1, #1f2937);
  font-weight: 600;
}
.ssb-site {
  color: var(--rc-text-3, #8a94a6);
  font-size: 11.5px;
}
.ssb-items {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 10px;
  margin: 4px 0 0;
}
.ssb-item {
  min-width: 0;
}
.ssb-item dt {
  color: var(--rc-text-3, #8a94a6);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ssb-item dd {
  margin: 0;
  font-size: 12.5px;
  line-height: 18px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ssb-pending {
  color: var(--rc-text-3, #8a94a6);
}
.ssb-note {
  margin: 4px 0 0;
  color: var(--rc-text-3, #8a94a6);
  font-size: 11px;
  line-height: 16px;
}
</style>