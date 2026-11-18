<script setup lang="ts">
// 库类型标签（1117 B）：表存在 MySQL 还是 ClickHouse。CK 用主色描边，MySQL 用中性灰；
// 未返回 dsKind 的老记录按 MYSQL 处理（与 legacyAdapters 的归一口径一致）。
import { computed } from 'vue'

const props = defineProps<{ kind?: string | null }>()

const isCk = computed(() => String(props.kind ?? '').toUpperCase() === 'CK')
</script>

<template>
  <span
    class="rc-storage-kind"
    :class="isCk ? 'is-ck' : 'is-mysql'"
    data-testid="storage-kind-tag"
    :title="isCk ? '存储在 ClickHouse' : '存储在 MySQL'"
  >{{ isCk ? 'CK' : 'MYSQL' }}</span>
</template>

<style scoped>
.rc-storage-kind {
  display: inline-block;
  flex: none;
  padding: 0 5px;
  border: 1px solid var(--rc-border);
  border-radius: 4px;
  color: var(--rc-muted);
  background: var(--rc-surface);
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  letter-spacing: 0.02em;
  vertical-align: middle;
  white-space: nowrap;
}
.rc-storage-kind.is-ck {
  border-color: var(--rc-primary);
  color: var(--rc-primary-ink);
  background: var(--rc-primary-bg);
}
</style>
