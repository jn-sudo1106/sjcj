<script setup lang="ts">
// 模块标题区（P3 收尾 · AppShell 拆分）
// 职责：面包屑 + 模块标题 + 顶部动作按钮
// 0711 R12：批量导入/批量操作已迁进网站详情源侧栏，顶部只留"新建采集"
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
const isSourceCanvas = computed(() => route.path.startsWith('/canvas'))
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
  monitor: '导出报表',
}

const pageActions: Record<string, string[]> = {
  overview: ['刷新', '导出', '新建采集'],
  // 画布路由（含闸门/网站详情/源详情）顶栏不放动作：保存/发起抓取都收在画布 Header
  canvas: [],
  collect: ['新建采集'],
  flows: ['新建流程'],
  rules: ['新建规则组', '导入规则', '发布校验'],
  metrics: ['新建指标', '批量维护', '口径校验'],
  // 数据表页动作全部收在页内工具条（检索/工具条/批量条），顶栏不重复放
  data: [],
  runs: ['导出记录'],
  monitor: ['刷新', '导出报表'],
  // 系统设置的新建 / 编辑都在页内工具条
  settings: [],
}

// 页面动作按真实路由段取，而不是侧栏高亮键
const actionKey = computed(() => route.path.split('/')[1] || 'overview')

const activeActions = computed(() => {
  if (actionKey.value === 'rules' && route.query.tab === 'param') return []
  return pageActions[actionKey.value] ?? []
})

// 面包屑跳转：首项固定回总览（'/' 本身就 redirect 到 /overview），中间项回当前模块列表页。
// 中间项只在画布路由下出现，此时 useActiveNavKey 已把 canvas 映射回 collect，
// current.path 就是 /collect——不需要再为画布单独判一次。
function goHome() {
  if (route.path === '/overview') return
  void router.push('/overview')
}
function goModule() {
  if (route.path === current.value.path) return
  void router.push(current.value.path)
}

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
  <!-- 全站不再有独立的大标题行（2026-08-21）：它的文字与紧邻上方的面包屑末项一字不差，
       白占一行。改为把面包屑的末项本身升为 h1——视觉上仍是面包屑，文档结构里仍有一级标题，
       无障碍与 SEO 语义不丢。动作按钮同时收到这一行，与面包屑平齐。
       整块高度由约 55px 降到约 24px。 -->
  <div class="rc-module-head">
    <!-- 面包屑各级可点回跳（2026-09-10 会上提）：在网站详情里点「采集资产」应当回到列表，
         此前三级全是死文本，唯一的退路是浏览器后退。末项是当前位置，保持不可点。 -->
    <nav class="rc-bc" aria-label="面包屑">
      <button type="button" class="rc-bc-link" @click="goHome">青龙智能采集中心</button>
      <span>/</span>
      <template v-if="isSourceCanvas">
        <button type="button" class="rc-bc-link" @click="goModule">{{ current.label }}</button>
        <span>/</span>
        <h1 aria-current="page">{{ sourceCrumb }}</h1>
      </template>
      <h1 v-else aria-current="page">{{ current.label }}</h1>
    </nav>
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
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 12px;
}

.rc-bc {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--rc-muted);
  font-size: 13px;
  min-width: 0;
}

/* 可点的前几级：外观必须与不可点的分隔符完全一致，只靠 hover 暴露可点性——
   常驻下划线会让面包屑看着像一行链接，比现在更吵。 */
.rc-bc-link {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  line-height: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.rc-bc-link:hover {
  color: var(--rc-primary);
  text-decoration: underline;
}

.rc-bc-link:focus-visible {
  outline: 2px solid var(--rc-primary);
  outline-offset: 2px;
  border-radius: 3px;
}

/* 末项（当前位置）高亮：它现在是 h1，样式上仍与面包屑其余部分一致，只是加重 */
.rc-bc > :last-child {
  color: var(--rc-primary-ink);
  font-weight: 700;
}

/* h1 只保留语义，外观完全跟随面包屑——不要浏览器默认的 2em 字号与上下 margin */
.rc-module-head h1 {
  margin: 0;
  font-size: inherit;
  line-height: inherit;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rc-module-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  flex: none;
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
