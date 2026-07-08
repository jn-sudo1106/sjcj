<script setup lang="ts">
import { computed, type Component } from 'vue'
import {
  Bell,
  Box,
  Clock,
  DataAnalysis,
  Document,
  Files,
  Histogram,
  Monitor,
  Odometer,
  QuestionFilled,
  Search,
  Upload,
  UserFilled,
  VideoPlay,
} from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import { TABS } from '../router/tabs'
import { useUiStore } from '../stores/ui'
import { useFlowStore } from '../stores/flow'
import companyLogo from '../assets/brand/company-logo.png'

const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const flow = useFlowStore()
// 源详情 / 新建源画布（/canvas?sourceId=X 或 /canvas?mode=new）逻辑上属于「采集资产」子页，侧栏高亮采集资产
const activeKey = computed(() => {
  const seg = route.path.split('/')[1] || 'overview'
  if (seg === 'canvas') return 'collect'
  return seg
})
const current = computed(() => TABS.find((t) => t.key === activeKey.value) ?? TABS[0])
// 源详情 / 新建采集画布的标题与面包屑：采集资产 / 源名或新建采集
const isSourceCanvas = computed(() => activeKey.value === 'collect' && route.path.startsWith('/canvas'))
const sourceCrumb = computed(() => (route.query.mode === 'new' ? '新建采集' : (flow.sourceCtx?.name || flow.siteCtx?.name || '源详情')))

const groupLabels = {
  home: '首页',
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
  })).filter((g) => g.items.length > 0),
)

const pageActions: Record<string, string[]> = {
  overview: ['刷新', '导出', '新建采集'],
  canvas: ['保存', '试跑', '发布'],
  collect: ['批量导入', '批量操作', '新建采集'],
  rules: ['新建规则组', '导入规则', '发布校验'],
  metrics: ['新建指标', '批量维护', '口径校验'],
  data: ['导出结果', '新建查询视图'],
  runs: ['导出记录'],
  tools: ['刷新', '导出报表'],
}
// 页面动作按真实路由段取，而不是侧栏高亮键（源详情画布仍要 保存/试跑/发布）
const actionKey = computed(() => route.path.split('/')[1] || 'overview')
const isGateCanvas = computed(() => route.path.startsWith('/canvas') && route.query.mode === 'new')
// 网站态（0707 优化·Phase4）：网站是流程模板，不实际运行，顶部动作收窄为仅「保存」（试跑/发布隐藏）
const isSiteCanvas = computed(() => route.path.startsWith('/canvas') && !!flow.siteCtx)
const activeActions = computed(() => {
  if (isGateCanvas.value) return []
  if (isSiteCanvas.value) return ['保存']
  return pageActions[actionKey.value] ?? pageActions.canvas
})

const navIcons: Record<string, Component> = {
  overview: Odometer,
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
          <img :src="companyLogo" alt="" />
        </span>
        <strong>青龙智能采集中心</strong>
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
              <span>青龙智能采集中心</span>
              <span>/</span>
              <span>{{ current.label }}</span>
              <template v-if="isSourceCanvas">
                <span>/</span>
                <span>{{ sourceCrumb }}</span>
              </template>
            </div>
            <h1>{{ isSourceCanvas ? sourceCrumb : current.label }}</h1>
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

.rc-brand-mark img {
  display: block;
  width: 30px;
  height: 30px;
  object-fit: contain;
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
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 20px 24px;
  overflow: hidden;
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

.rc-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

@media (max-width: 980px) {
  .rc-app {
    grid-template-rows: auto 1fr;
    height: auto;
    min-height: 100vh;
    overflow: auto;
  }

  .rc-topbar {
    height: auto;
    padding: 12px;
    flex-wrap: wrap;
  }

  .rc-brand {
    min-width: 0;
    flex: 1 1 auto;
  }

  .rc-global-search {
    order: 3;
    width: 100%;
    max-width: none;
  }

  .rc-top-actions {
    flex: none;
  }

  .rc-shell {
    grid-template-columns: 1fr;
    overflow: visible;
  }

  .rc-sidenav {
    position: static;
    width: auto;
    min-width: 0;
    max-width: none;
    height: auto;
    min-height: auto;
    max-height: none;
    border-right: 0;
    border-bottom: 1px solid var(--rc-border);
  }

  .rc-main {
    overflow: visible;
    padding: 18px 16px;
  }
}

@media (max-width: 560px) {
  .rc-brand strong {
    font-size: 14px;
  }

  .rc-user span:not(.rc-avatar) {
    display: none;
  }

  .rc-sidenav {
    padding: 12px;
  }

  .rc-nav-group + .rc-nav-group {
    margin-top: 12px;
  }

  .rc-nav-title {
    margin-top: 10px;
  }

  .rc-module-head {
    flex-direction: column;
    gap: 10px;
  }

  .rc-module-actions {
    justify-content: flex-start;
    padding-top: 0;
  }
}
</style>
