<script setup lang="ts">
import { computed } from 'vue'
import { RUNTIME_POLICY_FIELDS, formatRunPolicyValue, parseRunPolicy } from '@/utils/flow/runPolicy'

const props = defineProps<{ raw?: string }>()
const parsed = computed(() => parseRunPolicy(props.raw))
</script>

<template>
  <details class="runtime-policy" data-testid="runtime-policy-summary">
    <summary>运行策略 <span>只读</span></summary>
    <div class="runtime-policy-body">
      <div v-if="parsed.state === 'empty'" class="runtime-policy-empty">后端未返回运行策略。</div>
      <div v-else-if="parsed.state === 'invalid'" class="runtime-policy-empty">运行策略格式暂无法识别，原值已保留。</div>
      <template v-else>
        <dl class="runtime-policy-grid">
          <div v-for="field in RUNTIME_POLICY_FIELDS" :key="field.key">
            <dt>{{ field.label }}</dt>
            <dd :data-testid="`runtime-policy-${field.key}`">{{ formatRunPolicyValue(field.key, parsed.values[field.key]) }}</dd>
          </div>
        </dl>
        <p class="runtime-policy-help">数值为 -1 表示不限制。编辑能力待后端策略契约确认后开放。</p>
      </template>
    </div>
  </details>
</template>

<style scoped>
.runtime-policy { margin-top: 4px; }
.runtime-policy > summary { display: block; list-style: none; padding: 2px 0; color: var(--rc-muted); font-size: 11px; font-weight: 600; cursor: pointer; }
.runtime-policy > summary::-webkit-details-marker { display: none; }
.runtime-policy > summary::before { content: '▸ '; }
.runtime-policy[open] > summary::before { content: '▾ '; }
.runtime-policy > summary:hover { color: var(--rc-primary-ink); }
.runtime-policy > summary span { margin-left: 4px; color: var(--rc-faint); font-size: 9px; font-weight: 500; }
.runtime-policy-body { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--rc-border-soft); }
.runtime-policy-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 0; }
.runtime-policy-grid > div { min-width: 0; padding: 7px 8px; border: 1px solid var(--rc-border-soft); border-radius: 6px; background: #f8fafc; }
.runtime-policy-grid dt { color: var(--rc-faint); font-size: 9px; line-height: 1.35; }
.runtime-policy-grid dd { margin: 3px 0 0; color: var(--rc-text); font-size: 11px; font-weight: 600; overflow-wrap: anywhere; }
.runtime-policy-empty { padding: 9px 10px; border: 1px dashed var(--rc-border); border-radius: 7px; background: #f8fafc; color: var(--rc-faint); font-size: 10px; }
.runtime-policy-help { margin: 7px 0 0; color: var(--rc-faint); font-size: 9px; line-height: 1.5; }
</style>
