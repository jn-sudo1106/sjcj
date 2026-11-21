<script setup lang="ts">
// AppShell 主壳（P3 收尾 · AppShell 拆分）
// 职责：整体布局 + 3 个子组件拼装（TopBar / Sidebar / ModuleHead）+ 响应式 CSS
// 业务逻辑（账号下拉 / 侧栏导航 / 顶部动作）全部下沉到子组件
// plan §E.4 列的 AppThemeSwitcher 实际未实现（项目当前无主题切换功能），故只拆 3 个
import AppTopBar from './AppTopBar.vue'
import AppSidebar from './AppSidebar.vue'
import AppModuleHead from './AppModuleHead.vue'
import AiAskFloating from './AiAskFloating.vue'
// 批量提交作业条（Y4-3）：挂在布局层，切页签/跳路由都不消失
import LaunchJobBar from '@/components/LaunchJobBar.vue'
import { useUiStore } from '@/stores/ui'
import { useAuthStore } from '@/stores/auth'
import { useRoute, useRouter } from 'vue-router'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { syncSiteVisit } from '@/utils/siteRecents'
import { prefetchRoute } from '@/utils/prefetchRoute'
import { TABS } from '@/router/tabs'
import { canAccess } from '@/composables/usePermission'

const ui = useUiStore()
const auth = useAuthStore()

// 通用埋点：进入/离开网站时配对 ENTER/EXIT（EXIT 用于后端回填停留时长）。
// 只有画布页带 siteId；其它路由统一传 null，表示"不在某个网站上"。
// 放在布局层是因为它对整个应用生命周期只注册一次，且不依赖任何业务页面是否挂载。
const router = useRouter()
const route = useRoute()
const workspace = ref<HTMLElement | null>(null)
const askFullTarget = ref<HTMLElement | null>(null)
const isAskPage = computed(() => route.matched.some((record) => record.path === '/ai-chat'))

// KeepAlive 缓存键（2026-11-21 修 2806「源管理 ⇄ 任务中心点不开」）：下面 <component> 带了 v-if，
// 编译器会给 v-if 分支自动加 key: 0，KeepAlive 有 key 就按 key 缓存 → 所有页面共用键 0，
// 第一次进任务中心直接把源管理的缓存实例拿来 activate，报 ctx.deactivate is not a function，路由变了页面不换。
// 这里按组件类型给稳定键，和 KeepAlive 不带 key 时按 type 缓存的口径一致。
const viewKeys = new WeakMap<object, string>()
let viewKeySeq = 0
function viewKey(component: unknown): string | undefined {
  const type = (component as { type?: unknown } | null | undefined)?.type
  if (!type || (typeof type !== 'object' && typeof type !== 'function')) return undefined
  let key = viewKeys.get(type)
  if (!key) {
    key = `view-${++viewKeySeq}`
    viewKeys.set(type, key)
  }
  return key
}
const askPermission = computed(() => canAccess('ai-chat') &&
  canAccess(router.resolve('/ai-chat').meta.permission as string | undefined))
const showAsk = computed(() => auth.isLoggedIn && auth.info != null && askPermission.value)

watch(() => isAskPage.value && auth.isMenusLoaded && !askPermission.value, (denied) => {
  if (denied) void router.replace('/overview')
}, { immediate: true })

// 工作台仅保留纯色内容背景，顶栏、侧栏、面包屑及主区留白均复用平台布局。
// 其他显式 fullwidth 页面仍可隐藏侧栏/面包屑；下方模板对工作台单独保留。
// 所有页面滚动统一由 .rc-pane 承担；path 兜底兼容动态菜单覆盖 meta。
const isFullWidth = computed(() => route.meta.layout === 'fullwidth' || route.path === '/workbench')

router.afterEach((to) => {
  const siteId = to.path === '/canvas' ? String(to.query.siteId ?? '') || null : null
  syncSiteVisit(siteId)
})

// 首屏稳定后的空闲时段，按侧栏顺序预热前几个入口的页面 chunk：
// 把「第一次点某个菜单才下载」的等待摊到用户还没点击的时候。
const PREFETCH_LIMIT = 8
let idleHandle: number | undefined
let idleTimer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  // 单测环境不跑：避免后台定时器在用例结束后触发
  if (import.meta.env.MODE === 'test') return
  const paths: string[] = (
    auth.menuGroups.length > 0
      ? auth.menuGroups.flatMap((group) => group.items.map((item) => item.path))
      : TABS.map((tab) => tab.path)
  )
    .filter((path): path is string => !!path)
    .slice(0, PREFETCH_LIMIT)
  if (!paths.length) return

  let index = 0
  const step = () => {
    if (index >= paths.length) return
    prefetchRoute(router, paths[index])
    index += 1
    schedule()
  }
  const schedule = () => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    }
    if (typeof w.requestIdleCallback === 'function') {
      idleHandle = w.requestIdleCallback(step, { timeout: 3000 })
    } else {
      idleTimer = setTimeout(step, 800)
    }
  }
  schedule()
})

onBeforeUnmount(() => {
  const w = window as Window & { cancelIdleCallback?: (id: number) => void }
  if (idleHandle !== undefined && typeof w.cancelIdleCallback === 'function') w.cancelIdleCallback(idleHandle)
  if (idleTimer !== undefined) clearTimeout(idleTimer)
})
</script>

<template>
  <div class="rc-app" :class="{ 'rc-app--full': isFullWidth }">
    <AppTopBar />

    <div
      ref="workspace"
      class="rc-shell"
      :class="{ 'rc-shell--full': isFullWidth && route.path !== '/workbench', 'nav-collapsed': ui.navCollapsed && (!isFullWidth || route.path === '/workbench') }"
    >
      <AppSidebar v-if="!isFullWidth || route.path === '/workbench'" />

      <section class="rc-main" :class="{ 'rc-main--full': isFullWidth && route.path !== '/workbench' }">
        <AppModuleHead v-if="!isFullWidth || route.path === '/workbench'" />

        <main class="rc-pane">
          <!-- 两种展示位置共用一个问数实例，切换时只移动 DOM。 -->
          <div v-show="isAskPage" ref="askFullTarget" class="rc-ask-full" />
          <router-view v-slot="{ Component }">
            <!-- key 用「登录会话标识」而不是 auth.info?.id：后者首次 fetchInfo 才从 undefined 变真实值，
                 key 一变 KeepAlive 就整体替换，刚挂载的页面被销毁重建（首屏接口白打一遍） -->
            <KeepAlive :key="auth.cacheKey" :include="['CollectAssets', 'TaskCenter']"><component :is="Component" v-if="!isAskPage" :key="viewKey(Component)" /></KeepAlive>
          </router-view>
        </main>
      </section>
    </div>

    <LaunchJobBar />
    <AiAskFloating
      v-if="showAsk"
      :key="`${auth.cacheKey}:${auth.info?.id}`"
      :full="isAskPage"
      :full-target="askFullTarget"
      :workspace="workspace"
      :user-id="auth.info?.id ?? null"
    />
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

/* 必须 > .rc-topbar 的 z-index(20)：rc-shell 自身建立层叠上下文后，内部任何 fixed 弹窗/弹层
   （如 SiteSourceSwitcher 的加源弹窗、EditParamSourceDialog、节点右键菜单等）无论自己 z-index 开多高，
   都会被限制在这个上下文内比较，赢不过同级的顶部导航栏——曾导致弹窗被顶栏遮住。 */
.rc-shell {
  position: relative;
  z-index: 21;
  display: grid;
  grid-template-columns: 184px 1fr;
  min-height: 0;
  overflow: hidden;
}

.rc-shell.nav-collapsed {
  grid-template-columns: 64px 1fr;
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

.rc-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.rc-ask-full {
  height: 100%;
}

/* ---------- 全宽布局（opt-in：route.meta.layout='fullwidth' 或 path='/workbench'） ---------- */
.rc-app--full {
  grid-template-rows: 56px 1fr;
  /* 设计稿工作台画布是纯色 #f5f8fe，不用标准页的极光渐变底 */
  background: #f5f8fe;
}

/* 全宽页去掉标准页的极光光斑（::before），保证画布干净、不与内容层抢视觉 */
.rc-app--full::before {
  display: none;
}

.rc-shell--full {
  grid-template-columns: minmax(0, 1fr);
}

/* 全宽页自己负责内容内边距（零内边距，页面里再排版），滚动只留在 .rc-pane 一处 */
.rc-main--full {
  padding: 0;
}

@media (max-width: 980px) {
  .rc-app {
    grid-template-rows: auto 1fr;
    height: auto;
    min-height: 100vh;
    overflow: auto;
  }

  /* 全宽页在窄屏也保持「顶栏 + 单一主区滚动」，避免页面滚动和主区滚动叠加 */
  .rc-app.rc-app--full {
    grid-template-rows: 56px 1fr;
    height: 100vh;
    min-height: 100vh;
    overflow: hidden;
  }

  .rc-shell,
  .rc-shell.nav-collapsed {
    grid-template-columns: 1fr;
    overflow: visible;
  }

  .rc-main {
    overflow: visible;
    padding: 18px 16px;
  }
}

@media (max-width: 560px) {
  .rc-main {
    padding: 16px 12px;
  }
}
</style>
