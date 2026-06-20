<script setup lang="ts">
import { computed, onMounted, ref, type Component } from 'vue'
import {
  Bell,
  Box,
  Clock,
  Connection,
  DataAnalysis,
  Document,
  Files,
  Histogram,
  Monitor,
  QuestionFilled,
  Search,
  Upload,
  UserFilled,
  VideoPlay,
} from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import { TABS } from '../router/tabs'
import CountUp from '../components/CountUp.vue'
import { useUiStore } from '../stores/ui'
import { workbenchApi, type WorkbenchSummary } from '../api'

const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const activeKey = computed(() => route.path.split('/')[1] || 'canvas')
const current = computed(() => TABS.find((t) => t.key === activeKey.value) ?? TABS[0])
const isCanvas = computed(() => activeKey.value === 'canvas')

const groupLabels = {
  workbench: '编排工作台',
  assets: '资产管理',
  ops: '运行与验收',
  tools: '运维工具',
} as const

const navGroups = computed(() =>
  Object.entries(groupLabels).map(([key, label]) => ({
    key,
    label,
    items: TABS.filter((t) => t.group === key),
  })),
)

const pageActions: Record<string, string[]> = {
  canvas: ['保存草稿', '试跑', '发布'],
  collect: ['批量导入', '批量操作', '新建采集源'],
  rules: ['新建规则组', '导入规则', '发布校验'],
  metrics: ['新建指标', '批量维护', '口径校验'],
  data: ['导出结果', '新建查询视图'],
  runs: ['导出记录'],
  tools: ['刷新', '导出报表'],
}
const activeActions = computed(() => pageActions[activeKey.value] ?? pageActions.canvas)

const summaries = ref<WorkbenchSummary[]>([])
onMounted(async () => {
  summaries.value = await workbenchApi.summary()
})

const navIcons: Record<string, Component> = {
  canvas: Connection,
  collect: Box,
  rules: Document,
  metrics: Histogram,
  data: DataAnalysis,
  runs: Clock,
  tools: Monitor,
}
</script>

<template>
  <div class="rc-app">
    <header class="rc-topbar">
      <div class="rc-brand">
        <span class="rc-brand-mark">
          <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
            <defs>
              <linearGradient id="brandg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#3b82f6" />
                <stop offset="1" stop-color="#06b6d4" />
              </linearGradient>
            </defs>
            <path d="M16 3 L28 10 L16 17 L4 10 Z" fill="#2563eb" />
            <path d="M4 10 L16 17 L16 30 L4 23 Z" fill="#1d4ed8" />
            <path d="M28 10 L28 23 L16 30 L16 17 Z" fill="url(#brandg)" />
          </svg>
        </span>
        <strong>万维数据采集中心</strong>
      </div>
      <div class="rc-global-search">
        <el-icon><Search /></el-icon>
        <span>搜索流程、节点、规则等</span>
      </div>
      <div class="rc-top-actions">
        <button class="rc-icon-btn" type="button" aria-label="帮助"><el-icon><QuestionFilled /></el-icon><span>帮助</span></button>
        <button class="rc-icon-btn rc-notice" type="button" aria-label="通知"><el-icon><Bell /></el-icon></button>
        <button class="rc-user" type="button">
          <span class="rc-avatar"><el-icon><UserFilled /></el-icon></span>
          <span>admin</span>
          <span class="rc-user-caret">⌄</span>
        </button>
      </div>
    </header>

    <div class="rc-shell">
      <aside class="rc-sidenav">
        <nav v-for="group in navGroups" :key="group.key" class="rc-nav-group" :aria-label="group.label">
          <div class="rc-nav-title">{{ group.label }}</div>
          <button
            v-for="t in group.items"
            :key="t.key"
            class="rc-nav-item"
            :class="{ active: t.key === activeKey }"
            type="button"
            @click="router.push(t.path)"
          >
            <span class="rc-nav-icon"><el-icon><component :is="navIcons[t.key]" /></el-icon></span>
            <span>{{ t.label }}</span>
          </button>
        </nav>
        <button class="rc-collapse" type="button">‹ 收起侧栏</button>
      </aside>

      <section class="rc-main">
        <div class="rc-module-head">
          <div>
            <div class="rc-bc">
              <span>万维数据采集中心</span>
              <span>/</span>
              <span>{{ current.label }}</span>
            </div>
            <h1>{{ current.label }}</h1>
          </div>
          <div class="rc-module-actions">
            <button
              v-for="(action, index) in activeActions"
              :key="action"
              type="button"
              class="rc-action-btn"
              :class="{ primary: index === activeActions.length - 1 }"
              @click="ui.fireAction(action)"
            >
              <el-icon v-if="action.includes('试跑')"><VideoPlay /></el-icon>
              <el-icon v-else-if="action.includes('发布') || action.includes('导出')"><Upload /></el-icon>
              <el-icon v-else><Files /></el-icon>
              {{ action }}
            </button>
          </div>
        </div>

        <div v-if="isCanvas" class="rc-summary-strip" aria-label="工作台摘要">
          <div v-for="item in summaries" :key="item.label" class="rc-summary-item">
            <div>
              <span class="rc-summary-label">{{ item.label }}</span>
              <strong v-if="item.title" class="rc-summary-title">{{ item.title }}</strong>
              <span v-else class="rc-summary-number"><b><CountUp :value="Number(item.value)" /></b>{{ item.hint }}</span>
              <span v-if="item.title" class="rc-summary-hint">{{ item.hint }}</span>
            </div>
            <span class="rc-summary-icon" :class="item.tone"><el-icon><Files /></el-icon></span>
          </div>
        </div>

        <main class="rc-pane">
          <router-view />
        </main>
      </section>
    </div>
  </div>
</template>

<style scoped>
.rc-app {
  position: relative;
  display: grid;
  grid-template-rows: 56px 1fr;
  height: 100vh;
  min-height: 100vh;
  overflow: hidden;
  color: var(--rc-text);
}

.rc-app::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(38% 42% at 16% 12%, rgba(37, 99, 235, 0.1), transparent 70%),
    radial-gradient(36% 40% at 86% 16%, rgba(6, 182, 212, 0.12), transparent 72%),
    radial-gradient(42% 46% at 72% 92%, rgba(79, 70, 229, 0.08), transparent 74%);
  animation: rc-aurora-drift 24s ease-in-out infinite alternate;
}

.rc-topbar {
  position: relative;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  height: 56px;
  min-height: 56px;
  padding: 0 20px;
  border-bottom: 1px solid #e2e8f0;
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(12px);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.6) inset;
}

.rc-topbar::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(37, 99, 235, 0.55), rgba(6, 182, 212, 0.55), transparent);
  background-size: 50% 100%;
  background-repeat: no-repeat;
  animation: rc-sheen 7s linear infinite;
}

.rc-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 220px;
  flex: none;
}

.rc-brand strong {
  color: var(--rc-text);
  font-size: 15px;
  font-weight: 600;
}

.rc-brand-mark {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
}

.rc-brand-mark::before {
  content: '';
  position: absolute;
  inset: -4px;
  z-index: -1;
  border-radius: 12px;
  background: radial-gradient(circle, rgba(37, 99, 235, 0.3), transparent 68%);
  animation: rc-glow-pulse 3.8s ease-in-out infinite;
}

.rc-env {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  background: #eff6ff;
  color: #2563eb;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.rc-global-search {
  width: 360px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--rc-border);
  border-radius: 8px;
  background: rgba(248, 250, 252, 0.86);
  color: var(--rc-muted);
  font-size: 13px;
}

.rc-global-search:focus-within {
  border-color: #93c5fd;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.08);
  background: #fff;
}

.rc-top-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.rc-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--rc-text-2);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.rc-icon-btn span {
  display: none;
}

.rc-user {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--rc-text-2);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.rc-icon-btn:hover,
.rc-user:hover {
  background: #f8fafc;
  color: var(--rc-primary-ink);
}

.rc-notice {
  position: relative;
}

.rc-notice::after {
  content: '';
  position: absolute;
  top: 7px;
  right: 6px;
  width: 7px;
  height: 7px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: var(--rc-error);
}

.rc-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #dbeafe, #a5f3fc);
  color: var(--rc-primary);
}

.rc-user-caret {
  color: var(--rc-muted);
}

.rc-shell {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 220px 1fr;
  min-height: 0;
  overflow: hidden;
}

.rc-sidenav {
  width: 220px;
  min-width: 220px;
  max-width: 220px;
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px 12px;
  overflow: auto;
  border-right: 1px solid var(--rc-border);
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(12px);
  box-shadow: 8px 0 24px rgba(15, 23, 42, 0.03);
}

.rc-nav-group + .rc-nav-group {
  margin-top: 18px;
}

.rc-nav-title {
  margin: 16px 8px 8px;
  color: var(--rc-muted);
  font-size: 12px;
  font-weight: 500;
}

.rc-nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 40px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--rc-text-2);
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}

.rc-nav-item:hover {
  background: rgba(248, 250, 252, 0.92);
  color: var(--rc-primary);
}

.rc-nav-item.active {
  background: linear-gradient(90deg, rgba(246, 250, 255, 0.96) 0%, rgba(236, 254, 255, 0.72) 100%);
  color: var(--rc-primary);
  box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.08);
}

.rc-nav-item.active::after {
  content: '';
  position: absolute;
  right: 0;
  top: 8px;
  width: 3px;
  height: 24px;
  border-radius: 999px;
  background: linear-gradient(180deg, #2563eb 0%, #06b6d4 100%);
  background-size: 100% 200%;
  animation: rc-flow-line 2.6s linear infinite;
}

.rc-nav-icon {
  display: inline-flex;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  color: currentColor;
  transition: filter 0.2s ease;
}

.rc-nav-item.active .rc-nav-icon {
  filter: drop-shadow(0 0 5px rgba(37, 99, 235, 0.5));
}

.rc-collapse {
  margin-top: auto;
  border: 0;
  background: transparent;
  color: var(--rc-muted);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.rc-main {
  min-width: 0;
  min-height: 0;
  padding: 20px 24px;
  overflow: auto;
  background: transparent;
}

.rc-module-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 16px;
}

.rc-bc {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--rc-muted);
  font-size: 13px;
  margin-bottom: 6px;
}

.rc-bc span:last-child {
  color: var(--rc-primary-ink);
  font-weight: 700;
}

.rc-module-head h1 {
  margin: 8px 0 0;
  color: var(--rc-text);
  font-size: 20px;
  line-height: 28px;
  font-weight: 700;
}

.rc-module-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 22px;
}

.rc-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 13px;
  border: 1px solid #d5e2f2;
  border-radius: var(--rc-radius-sm);
  background: #fff;
  color: var(--rc-text-2);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.rc-action-btn.primary {
  border-color: var(--rc-primary);
  background: var(--rc-primary);
  color: #fff;
  box-shadow: 0 8px 18px rgba(37, 99, 235, 0.16);
}

.rc-summary-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin: 4px 0 12px;
}

.rc-summary-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 64px;
  padding: 12px 18px;
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius);
  background: #fff;
  box-shadow: var(--rc-shadow);
}

.rc-summary-label {
  display: block;
  margin-bottom: 6px;
  color: var(--rc-muted);
  font-size: 12px;
  font-weight: 700;
}

.rc-summary-title {
  display: block;
  color: var(--rc-text);
  font-size: 13px;
}

.rc-summary-hint {
  display: block;
  margin-top: 3px;
  color: var(--rc-muted);
  font-size: 12px;
}

.rc-summary-number {
  color: var(--rc-text-2);
  font-size: 13px;
}

.rc-summary-number b {
  margin-right: 4px;
  color: var(--rc-text);
  font-size: 20px;
}

.rc-summary-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--rc-primary-bg);
  color: var(--rc-primary);
}

.rc-summary-icon.error {
  background: var(--rc-error-bg);
  color: var(--rc-error);
}

.rc-summary-icon.warn {
  background: var(--rc-warn-bg);
  color: #f97316;
}

.rc-pane {
  min-width: 0;
}

@media (max-width: 980px) {
  .rc-topbar {
    height: auto;
    padding: 12px;
  }

  .rc-shell {
    grid-template-columns: 1fr;
  }

  .rc-sidenav {
    position: static;
    min-height: auto;
    max-height: none;
  }

  .rc-summary-strip {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
