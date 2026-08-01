<script setup lang="ts">
// 模块标题区（P3 收尾 · AppShell 拆分）
// 职责：面包屑 + 模块标题 + 顶部动作按钮
// 0711 R12：批量导入/批量操作已迁进网站详情子源侧栏，顶部只留"新建采集"
//   （AppShell 顶部按钮按路由硬编码，与页面是否 ui.registerAction 无关）
// 规则资产的「新建规则组/导入规则/发布校验」是规则 tab 专属（0721 会议 §六-1 参数迁入后新增的参数 tab 不需要）
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Files, Upload } from '@element-plus/icons-vue'
import { TABS } from '@/router/tabs'
import { useUiStore } from '@/stores/ui'
import { useFlowStore } from '@/stores/flow'
import { useActiveNavKey } from '@/composables/useActiveNavKey'

const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const flow = useFlowStore()

const activeKey = useActiveNavKey()

const current = computed(() => TABS.find((t) => t.key === activeKey.value) ?? TABS[0])

// 源详情 / 新建采集画布的标题与面包屑
const isSourceCanvas = computed(() => activeKey.value === 'collect' && route.path.startsWith('/canvas'))
// 网站详情页态下 sourceCtx/siteCtx 会同时非空（见 flow.ts setSiteDisplayCtx）
//   siteCtx 才是用户实际看到的对象，优先展示
const sourceCrumb = computed(() =>
  route.query.mode === 'new' ? '新建采集' : flow.siteCtx?.name || flow.sourceCtx?.name || '源详情',
)

const PRIMARY_ACTIONS: Record<string, string> = {
  overview: '新建采集',
  collect: '新建采集',
  rules: '发布校验',
  metrics: '口径校验',
  runs: '导出记录',
  tools: '导出报表',
}

const pageActions: Record<string, string[]> = {
  overview: ['刷新', '导出', '新建采集'],
  // 画布路由（含闸门/网站详情/子源详情）顶栏不放动作：保存/发起抓取都收在画布 Header
  canvas: [],
  collect: ['新建采集'],
  rules: ['新建规则组', '导入规则', '发布校验'],
  metrics: ['新建指标', '批量维护', '口径校验'],
  // 数据表页动作全部收在页内工具条（检索/工具条/批量条），顶栏不重复放
  data: [],
  runs: ['导出记录'],
  tools: ['刷新', '导出报表'],
}

// 页面动作按真实路由段取，而不是侧栏高亮键
const actionKey = computed(() => route.path.split('/')[1] || 'overview')

const activeActions = computed(() => {
  if (actionKey.value === 'rules' && route.query.tab === 'param') return []
  return pageActions[actionKey.value] ?? []
})

function firePageAction(action: string) {
  // 「新建采集」是采集资产的全局入口，不能依赖「网站列表」子页注册回调；
  // 否则切到参数/模板等二级页后旧组件卸载，顶栏按钮会变成空操作。
  if (action === '新建采集') {
    void router.push({ path: '/canvas', query: { mode: 'new' } })
    return
  }
  ui.fireAction(action)
}
</script>

<template>
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
        v-for="action in activeActions"
        :key="action"
        type="button"
        class="rc-action-btn"
        :class="{ primary: action === PRIMARY_ACTIONS[actionKey] }"
        @click="firePageAction(action)"
      >
        <el-icon v-if="action.includes('发布') || action.includes('导出')"><Upload /></el-icon>
        <el-icon v-else><Files /></el-icon>
        {{ action }}
      </button>
    </div>
  </div>
</template>

<style scoped>
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
</style>
