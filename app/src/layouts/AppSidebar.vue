<script setup lang="ts">
// 侧栏导航（P3 收尾 · AppShell 拆分）
// 职责：按 group 分组的导航菜单 + 高亮 active 路由 + 收起侧栏按钮
// 源详情 / 新建源画布（/canvas?sourceId=X 或 /canvas?mode=new）逻辑上属于「采集资产」子页，侧栏高亮采集资产
import { computed, type Component } from 'vue'
import { useRouter } from 'vue-router'
import { Box, Clock, Connection, DataAnalysis, Document, Files, Histogram, Monitor, Odometer, Setting } from '@element-plus/icons-vue'
import { TABS } from '@/router/tabs'
import { useActiveNavKey } from '@/composables/useActiveNavKey'
import { useUiStore } from '@/stores/ui'
import { canAccess } from '@/composables/usePermission'

const router = useRouter()

const activeKey = useActiveNavKey()

const ui = useUiStore()

const groupLabels = {
  home: '首页',
  workbench: '编排工作台',
  assets: '资产管理',
  ops: '数据与运行',
  tools: '运维监控',
  intelligence: '智能能力',
  settings: '系统设置',
} as const

const navGroups = computed(() =>
  Object.entries(groupLabels)
    .map(([key, label]) => ({
      key,
      label,
      // 菜单权限口子（0924-02）：canAccess 现在恒放行，接入人员菜单权限后这里自动生效
      items: TABS.filter((t) => t.group === key && canAccess(t.permission)),
    }))
    .filter((g) => g.items.length > 0),
)

// 键必须与 TABS 的 key 一一对应：漏一个不会报错，只会渲染出一个空的 <el-icon> 占位方块。
// 2026-09-02 把 TAB key 从 'flow' 改成 'flows'（对齐 /flows 路径）时漏改这里，流程中心的图标
// 就这么没了。AppSidebar.test.ts 有一条用例锁死「每个 TAB 都有图标」。
const navIcons: Record<string, Component> = {
  overview: Odometer,
  collect: Box,
  flows: Connection,
  rules: Document,
  metrics: Histogram,
  data: DataAnalysis,
  files: Files,
  tasks: Clock,
  monitor: Monitor,
  settings: Setting,
}
</script>

<template>
  <aside class="rc-sidenav" :class="{ collapsed: ui.navCollapsed }">
    <nav v-for="group in navGroups" :key="group.key" class="rc-nav-group" :aria-label="group.label">
      <div class="rc-nav-title">{{ group.label }}</div>
      <el-tooltip
        v-for="t in group.items"
        :key="t.key"
        :content="t.label"
        placement="right"
        :show-after="120"
        :disabled="!ui.navCollapsed"
      >
        <button
          class="rc-nav-item"
          :class="{ active: t.key === activeKey }"
          type="button"
          @click="router.push(t.path)"
        >
          <span class="rc-nav-icon"
            ><el-icon><component :is="navIcons[t.key]" /></el-icon
          ></span>
          <span class="rc-nav-label">{{ t.label }}</span>
        </button>
      </el-tooltip>
    </nav>
    <button
      class="rc-collapse"
      type="button"
      :title="ui.navCollapsed ? '展开侧栏' : '收起侧栏'"
      @click="ui.toggleNavCollapsed()"
    >
      {{ ui.navCollapsed ? '›' : '‹ 收起侧栏' }}
    </button>
  </aside>
</template>

<style scoped>
.rc-sidenav {
  width: 184px;
  min-width: 184px;
  max-width: 184px;
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

/* 收起态：只留图标窄条 */
.rc-sidenav.collapsed {
  width: 64px;
  min-width: 64px;
  max-width: 64px;
  padding: 16px 8px;
}

.rc-sidenav.collapsed .rc-nav-title,
.rc-sidenav.collapsed .rc-nav-label {
  display: none;
}

.rc-sidenav.collapsed .rc-nav-item {
  justify-content: center;
  padding: 0;
}

.rc-sidenav.collapsed .rc-collapse {
  text-align: center;
  font-size: 16px;
}

@media (max-width: 980px) {
  /* 移动端侧栏本就是单列全宽，收起态无意义，强制展开显示 */
  .rc-sidenav.collapsed {
    width: auto;
    min-width: 0;
    max-width: none;
    padding: 16px 12px;
  }

  .rc-sidenav.collapsed .rc-nav-title,
  .rc-sidenav.collapsed .rc-nav-label {
    display: initial;
  }

  .rc-sidenav.collapsed .rc-nav-item {
    justify-content: flex-start;
    padding: 0 10px;
  }
}
</style>
