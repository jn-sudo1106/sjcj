import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { readStoredToken, setUnauthorizedHandler } from '../api/auth'
import { useAuthStore } from '../stores/auth'
import { canAccess } from '../composables/usePermission'
import { loginRedirect } from './loginRedirect'
import { generateRoutesFromNav, addDynamicRoutes } from './dynamicRoutes'
import { setupNavPerf } from '../utils/navPerf'

const routes: RouteRecordRaw[] = [
  // 登录页无 AppShell，路径沿用旧系统 /user/login
  { path: '/user/login', component: () => import('../views/Login/index.vue'), meta: { public: true } },
  { path: '/403', component: () => import('../views/Error/403.vue'), meta: { public: true } },
  { path: '/404', component: () => import('../views/Error/404.vue'), meta: { public: true } },
  {
    path: '/',
    name: 'RootLayout',
    component: () => import('../layouts/AppShell.vue'),
    children: [
      { path: '', name: 'RootRedirect', redirect: '/overview' },
      { path: '/overview', component: () => import('../views/Overview/index.vue') },
      {
        path: '/canvas',
        component: () => import('../views/FlowCanvas/index.vue'),
        // 0707 优化·Phase4：siteId 是网站统一流程模板的合法入口（画布切换器/卡片主体/页签均可达），与 sourceId 并列放行
        beforeEnter: (to) => (to.query.sourceId || to.query.siteId || to.query.mode === 'new' ? true : '/collect'),
      },
      { path: '/collect', component: () => import('../views/CollectAssets/index.vue') },
      { path: '/flows', component: () => import('../views/FlowCenter/index.vue') },
      { path: '/rules', component: () => import('../views/RuleAssets/index.vue') },
      { path: '/metrics', component: () => import('../views/MetricCenter/index.vue') },
      { path: '/data', component: () => import('../views/DataView/index.vue') },
      { path: '/files', component: () => import('../views/FileCenter/index.vue') },
      { path: '/tasks', component: () => import('../views/RunRecords/index.vue') },
      { path: '/sync', component: () => import('../views/DataSync/index.vue') },
      { path: '/sync/create', component: () => import('../views/DataSync/TaskWizard.vue') },
      { path: '/monitor', component: () => import('../views/Monitor/index.vue') },
      { path: '/ai-chat', component: () => import('../views/TemplateConfig/AiChat/index.vue') },
      { path: '/base-config', component: () => import('../views/TemplateConfig/BaseConfig/index.vue') },
      { path: '/template-config', component: () => import('../views/TemplateConfig/index.vue') },
      { path: '/system-config', component: () => import('../views/TemplateConfig/SystemConfig/index.vue') },
      { path: '/auxiliary-tool', component: () => import('../views/AuxiliaryTool/index.vue') },
      { path: '/settings', component: () => import('../views/Settings/index.vue'), meta: { permission: 'settings' } },
      { path: '/user-permission', component: () => import('../views/Settings/UserPermission/index.vue'), meta: { permission: 'settings' } },
      { path: '/menu-config', component: () => import('../views/Settings/MenuConfig/index.vue'), meta: { permission: 'settings' } },
      // 兼容旧导航路径；监控中心的正式入口统一为 /monitor。
      { path: '/tools', redirect: (to) => ({ path: '/monitor', query: to.query }) },
      // 「运行记录」改名「任务中心」（0819 N4-2 / 0812 M3-11），路径随之从 /runs 改到
      // /tasks；旧链接（含各处已经发出去的 /runs?siteId=）仍要能用，故留重定向。
      { path: '/runs', redirect: (to) => ({ path: '/tasks', query: to.query }) },
    ],
  },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  // 画布内切视图 / 返回列表复用同一滚动容器：不重置的话新页面会停在旧的滚动位置，看起来像卡住
  scrollBehavior(_to, _from, savedPosition) {
    return savedPosition || { top: 0 }
  },
})

/**
 * 动态路由装配（幂等：装配成功后 `isRoutesLoaded` 置位，后续调用直接返回）。
 *
 * 2026-11-06 从「首次业务导航」里抽出来：装配要遍历全部菜单记录并逐条 addRoute（动 matcher），
 * 放在守卫里等于让用户第一次点菜单时同步承担这份成本。现在改为登录成功/应用冷启动时预热。
 *
 * 菜单还没到（老后端没这个接口 / 尚未登录）时不置 `isRoutesLoaded`，等下一次导航或预热再试；
 * 404 兜底路由与菜单无关，先注入（`hasRoute` 保证只加一次）。
 */
export function ensureDynamicRoutes(): string[] {
  const auth = useAuthStore()
  if (auth.isRoutesLoaded) return auth.dynamicRouteNames
  try {
    if (auth.menuGroups && auth.menuGroups.length > 0) {
      const dynamicRoutes = generateRoutesFromNav(auth.menuGroups)
      auth.dynamicRouteNames = addDynamicRoutes(router, dynamicRoutes, 'RootLayout')
      auth.isRoutesLoaded = true
    }
    // 动态注入 404 兜底路由
    if (!router.hasRoute('CatchAllNotFound')) {
      router.addRoute({
        path: '/:pathMatch(.*)*',
        name: 'CatchAllNotFound',
        redirect: '/404',
      })
    }
  } catch (e) {
    console.warn('动态路由初始化异常:', e)
    auth.isRoutesLoaded = true
  }
  return auth.dynamicRouteNames
}

/**
 * 冷启动预热：已登录用户（刷新页面）在应用挂载时就把会话/菜单/动态路由准备好，
 * 别等第一次点侧栏才做。**不阻塞任何导航**：即使后端慢 10 秒，页面也已经按会话快照渲染出来了。
 */
export async function warmUpAuth(): Promise<void> {
  const auth = useAuthStore()
  if (!auth.isLoggedIn) return
  try {
    // 有快照也要校准一次：菜单/权限可能在别的会话里被改过（fetchInfo 内部单飞，守卫不会重复请求）
    await auth.fetchInfo()
  } catch {
    return
  }
  ensureDynamicRoutes()
}

/**
 * 会话恢复的「导航预算」（毫秒）。
 *
 * 背景（2026-11-06 实测）：后端 `/user-info.htm` 在部分环境要 10 秒才回，而这个 await 在
 * `beforeEach` 里 → 用户点一次菜单就卡 10 秒（`[perf] 守卫 9949ms · 首帧 166ms`）。
 * 会话/菜单属于「补充信息」而不是「渲染前提」：侧栏有本地 TABS 兜底、权限未加载时 canAccess 放行，
 * 所以这里给导航一个很短的预算，超时就先放行，请求继续在后台跑，落地后 Pinia 响应式补上。
 */
const SESSION_BUDGET_MS = 250

/** 在预算内等 promise；超预算返回 false（promise 仍继续在后台跑） */
async function withinBudget(task: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  const outcome = await Promise.race([task.then(() => true as const).catch(() => true as const), timeout])
  if (timer !== undefined) clearTimeout(timer)
  return outcome === true ? true : false
}

/** 后台发现会话真的失效时：清会话 + 回登录页（此时用户可能已经在页面上，弹窗由 401 处理器兜底） */
function fallbackToLogin(redirect: string): void {
  const auth = useAuthStore()
  void auth
    .logout()
    .catch(() => {})
    .finally(() => {
      if (router.currentRoute.value.path === '/user/login') return
      void router.push({ path: '/user/login', query: { redirect } })
    })
}

// 全站守卫：迁移旧 permission.js —— 业务路由默认需认证；有 Token 但角色未加载时先恢复用户，
// 失败则清理会话回登录页；已登录访问登录页跳 /overview。导出以便单测直接驱动。
export const authGuard = async (to: { meta: Record<string, unknown>; path: string; fullPath: string }) => {
  const auth = useAuthStore()
  // 旧 permission.js 每次路由跳转都 Vue.ls.get 重新检查 7 天本地过期；
  // store 里的内存 token 可能跨过过期线，以存储实际状态为准（过期时 readStoredToken 返回空并清键）
  if (auth.token && !readStoredToken()) auth.clear()
  if (to.meta.public) {
    if (auth.isLoggedIn && to.path === '/user/login') return '/overview'
    if (to.path === '/user/login') {
      const redirect = new URLSearchParams(to.fullPath.split('?').slice(1).join('?')).get('redirect')
      if (redirect && loginRedirect(redirect) !== redirect) return { path: '/user/login', query: { redirect: loginRedirect(redirect) } }
    }
    return true
  }
  if (!auth.isLoggedIn) {
    return { path: '/user/login', query: { redirect: to.fullPath } }
  }

  // 会话恢复（getInfo 与菜单接口在 store 里并行、且单飞——与冷启动预热共用同一个请求）
  const t0 = performance.now()
  const sessionTask: Promise<unknown> | null = !auth.roles.length
    ? auth.fetchInfo()
    : !auth.isMenusLoaded
      ? auth.fetchUserNav()
      : null

  if (sessionTask) {
    const settledInTime = await withinBudget(sessionTask, SESSION_BUDGET_MS)
    if (!settledInTime) {
      // 后端慢：先放行，别让点击卡在网络上；失败在后台兜底跳登录
      void sessionTask
        .then(() => ensureDynamicRoutes())
        .catch(() => fallbackToLogin(to.fullPath))
      if (import.meta.env.DEV) {
        console.warn(`[nav] 会话恢复超过 ${SESSION_BUDGET_MS}ms，先放行 ${to.path}（后台继续，落地后再补齐菜单）`)
      }
      return true
    }
    try {
      await sessionTask
    } catch {
      await auth.logout()
      return { path: '/user/login', query: { redirect: to.fullPath } }
    }
  }

  // 动态路由装配与注册（幂等；正常情况已在登录/冷启动阶段完成）
  ensureDynamicRoutes()
  if (sessionTask && import.meta.env.DEV) {
    console.warn(
      `[nav] 会话/菜单恢复 ${Math.round(performance.now() - t0)}ms · 动态路由 ${auth.dynamicRouteNames.length} 条`,
    )
  }

  // 根路径定向到用户有权限的第一个菜单
  if (to.path === '/') {
    const firstMenuPath = auth.menuGroups?.[0]?.items?.[0]?.path || '/overview'
    return firstMenuPath
  }

  // 菜单权限口子（0924-02）：没权限的入口连地址直达也拦住，回总览
  if (!canAccess(to.meta.permission as string | undefined)) return '/overview'
  return true
}

// 开发态导航性能打点（必须注册在业务守卫之前，才能量到完整耗时；见 utils/navPerf.ts）
setupNavPerf(router)

router.beforeEach(authGuard)

/** 按需加载的页面文件取不到（各浏览器报法不同）。 */
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(msg)
}

// 0930-08：部署是 rsync --delete，旧版本的页面文件会被删掉。部署前就开着的标签页再点一个
// 还没加载过的页面（会上是 2806 的「系统设置」），取的是已删的旧文件，路由静默失败、看着就是"点不开"。
// 遇到这种错误整页刷新到目标地址，拿新版本的文件。10 秒内同一地址只刷一次，防止真坏了时无限刷新。
router.onError((err, to) => {
  if (!isChunkLoadError(err)) return
  const key = `chunk-reload:${to.fullPath}`
  try {
    const last = Number(sessionStorage.getItem(key) || 0)
    if (Date.now() - last < 10_000) return
    sessionStorage.setItem(key, String(Date.now()))
  } catch {
    // sessionStorage 不可用时照样刷新
  }
  window.location.hash = to.fullPath
  window.location.reload()
})

// 会话失效统一处理（计划 §12）：401（S3）与服务端会话死后的 302→logout.htm（S1）都收敛到这里。
// 有意偏离旧系统的静默报错行为（旧 request.js 401 拦截只弹通知、SPA 内业务请求报错不自动登出，
// 见 §12.1）——改为弹窗要求重新登录。单飞门闩防止并发请求重复弹窗；旧实现靠整页 reload 复位，
// 新 SPA 在弹窗流程结束后复位。弹窗无关闭/ESC 出口：会话已死，留在当前页没有意义。
let sessionExpiredShown = false
setUnauthorizedHandler(() => {
  if (router.currentRoute.value.path === '/user/login') return
  if (sessionExpiredShown) return
  sessionExpiredShown = true
  const redirect = loginRedirect(router.currentRoute.value.fullPath)
  void ElMessageBox.alert('登录失效,请重新登录', '提示', {
    type: 'warning',
    confirmButtonText: '重新登录',
    showClose: false,
    closeOnClickModal: false,
    closeOnPressEscape: false,
  }).finally(() => {
    // 会话已死：不调 logout.htm（实测该接口此时返回 500，调用无意义），仅清本地状态
    sessionExpiredShown = false
    const auth = useAuthStore()
    auth.clear()
    void router.push({ path: '/user/login', query: { redirect } })
  })
})
