<script setup lang="ts">
import type { RuleGroup } from '../../api'

interface GateSummary {
  syntaxFail: number
  referenceWarn: number
  batchTestPassRate: number
  pendingCount: number
}

defineProps<{
  groups: RuleGroup[]
  modelValue: string
  allCount: number
  gate: GateSummary
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()
</script>

<template>
  <div class="ra-left">
    <div class="rc-card ra-grp">
      <div class="rc-card-head">
        <div>
          <div class="rc-card-title">规则组</div>
          <div class="rc-card-sub">按阶段聚合表达式</div>
        </div>
      </div>
      <div class="rc-tree ra-grp-scroll">
        <div class="rc-tree-row" :class="{ active: modelValue === '' }" @click="emit('update:modelValue', '')">
          <span>全部规则</span><span class="rc-count">{{ allCount }}</span>
        </div>
        <div
          v-for="g in groups"
          :key="g.id"
          class="rc-tree-row"
          :class="{ active: modelValue === g.id }"
          @click="emit('update:modelValue', g.id)"
        >
          <span>{{ g.name }} <i class="ra-stage">{{ g.stage }}</i></span>
          <span class="rc-count">{{ g.count }}</span>
        </div>
      </div>
    </div>

    <div class="rc-card ra-gate">
      <div class="rc-card-head">
        <div class="rc-card-title">发布门禁</div>
      </div>
      <div class="ra-gate-body">
        <div class="ra-gate-row">
          <span>语法检查</span>
          <span class="rc-status" :class="gate.syntaxFail ? 'err' : 'ok'">
            {{ gate.syntaxFail ? gate.syntaxFail + ' 项未通过' : '通过' }}
          </span>
        </div>
        <div class="ra-gate-row">
          <span>共享配置引用</span>
          <span class="rc-status" :class="gate.referenceWarn ? 'warn' : 'ok'">
            {{ gate.referenceWarn ? gate.referenceWarn + ' 项告警' : '通过' }}
          </span>
        </div>
        <div class="ra-gate-col">
          <div class="ra-gate-rowtop"><span>批量测试通过率</span><b>{{ gate.batchTestPassRate }}%</b></div>
          <el-progress :percentage="gate.batchTestPassRate" :stroke-width="8" :show-text="false" />
        </div>
        <div class="ra-gate-note">{{ gate.pendingCount }} 条规则 evaluate 待接口，批测 / 发布暂为待接口态。</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ra-left {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: calc(100vh - 168px);
  min-height: 560px;
}
.ra-grp {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.ra-grp-scroll {
  flex: 1;
  overflow: auto;
}
.rc-tree-row {
  cursor: pointer;
}
.ra-stage {
  margin-left: 4px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--rc-indigo-bg);
  color: var(--rc-indigo);
  font-size: 11px;
  font-style: normal;
}
.ra-gate {
  flex: none;
}
.ra-gate-body {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ra-gate-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--rc-text-2);
}
.ra-gate-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ra-gate-rowtop {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--rc-text-2);
}
.ra-gate-rowtop b {
  color: var(--rc-text);
}
.ra-gate-note {
  color: var(--rc-muted);
  font-size: 12px;
  line-height: 1.55;
}
</style>
