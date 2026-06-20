<script setup lang="ts">
import { Picture } from '@element-plus/icons-vue'

defineProps<{
  desc: string
  milestone: string
  kpis?: { value: string; label: string }[]
  planned?: string[]
  figma?: string
}>()
</script>

<template>
  <div class="rc-card">
    <div class="rc-card-head">
      <div>
        <div class="rc-card-title">页面规划</div>
        <div class="rc-card-sub">{{ desc }}</div>
      </div>
      <el-tag size="small" type="info" effect="plain">{{ milestone }}</el-tag>
    </div>

    <div v-if="kpis?.length" class="rc-metric-grid pp-metrics">
      <div v-for="k in kpis" :key="k.label" class="rc-metric">
        <span>{{ k.label }}</span>
        <b>{{ k.value }}</b>
      </div>
    </div>

    <div class="pp-body">
      <div class="pp-planned">
        <div class="pp-planned-title">本页将包含（对齐设计图 {{ figma ?? '—' }}）</div>
        <ul>
          <li v-for="item in planned ?? []" :key="item">{{ item }}</li>
        </ul>
      </div>
      <div class="pp-hint">
        <el-icon class="pp-hint-icon"><Picture /></el-icon>
        <div>
          <strong>{{ milestone }} 待实现</strong>
          <p>当前为 P0 外壳走查版：独立系统外壳、导航、主题已就位；本模块的表格 / 详情 / 交互将在对应里程碑按设计图补齐。</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pp-metrics {
  padding: 16px;
  border-bottom: 1px solid var(--rc-border-soft);
}

.pp-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 16px;
  padding: 16px;
}

.pp-planned-title {
  margin-bottom: 10px;
  color: var(--rc-text);
  font-size: 13px;
  font-weight: 700;
}

.pp-planned ul {
  margin: 0;
  padding-left: 0;
  list-style: none;
}

.pp-planned li {
  position: relative;
  padding: 8px 0 8px 18px;
  border-top: 1px solid var(--rc-border-soft);
  color: var(--rc-text-2);
  font-size: 13px;
}

.pp-planned li:first-child {
  border-top: 0;
}

.pp-planned li::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 14px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--rc-primary), var(--rc-cyan));
}

.pp-hint {
  display: flex;
  gap: 12px;
  padding: 14px;
  border: 1px solid #dbeafe;
  border-radius: var(--rc-radius);
  background: #f8fbff;
  height: fit-content;
}

.pp-hint-icon {
  flex: none;
  margin-top: 2px;
  color: var(--rc-primary);
  font-size: 20px;
}

.pp-hint strong {
  color: var(--rc-text);
  font-size: 13px;
}

.pp-hint p {
  margin: 6px 0 0;
  color: var(--rc-muted);
  font-size: 12px;
  line-height: 1.6;
}

@media (max-width: 1100px) {
  .pp-body {
    grid-template-columns: 1fr;
  }
}
</style>
