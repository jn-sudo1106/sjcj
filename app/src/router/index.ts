import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { readStoredToken, setUnauthorizedHandler } from '../api/auth'
import { useAuthStore } from '../stores/auth'
import { canAccess } from '../composables/usePermission'

const routes: RouteRecordRaw[] = [
  // 登录页无 AppShell，路径沿用旧系统 /user/login
  { path: '/user/login', component: () => import('../views/Login/index.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('../layouts/AppShell.vue'),
    children: [
      { path: '', redirect: '/overview' },
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
      // 模板配置 → SQL模板配置（1013，旧 ai-chat-view「模板配置 / sql模板配置」）。
      // 走 /api/poc 独立服务，接口面见 api/templateConfig.ts，dev 代理见 vite.config.ts 的 '/api/poc'。
      { path: '/sql-template', component: () => import('../views/TemplateConfig/SqlTemplatePage.vue'), meta: { permission: 'sql-template' } },
      // 系统设置（0924-02）。meta.permission 与 TABS 里的同值，守卫经 canAccess 判断
      { path: '/settings', component: () => import('../views/Settings/index.vue'), meta: { permission: 'settings' } },
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

// 全站守卫：迁移旧 permission.js —— 业务路由默认需认证；有 Token 但角色未加载时先恢复用户，
// 失败则清理会话回登录页；已登录访问登录页跳 /overview。导出以便单测直接驱动。
export const authGuard = async (to: { meta: Record<string, unknown>; path: string; fullPath: string }) => {
  const auth = useAuthStore()
  // 旧 permission.js 每次路由跳转都 Vue.ls.get 重新检查 7 天本地过期；
  // store 里的内存 token 可能跨过过期线，以存储实际状态为准（过期时 readStoredToken 返回空并清键）
  if (auth.token && !readStoredToken()) auth.clear()
  if (to.meta.public) {
    if (auth.isLoggedIn && to.path === '/user/login') return '/overview'
    return true
  }
  if (!auth.isLoggedIn) {
    return { path: '/user/login', query: { redirect: to.fullPath } }
  }
  if (!auth.roles.length) {
    try {
      await auth.fetchInfo()
    } catch {
      await auth.logout()
      return { path: '/user/login', query: { redirect: to.fullPath } }
    }
  }
  // 菜单权限口子（0924-02）：没权限的入口连地址直达也拦住，回总览
  if (!canAccess(to.meta.permission as string | undefined)) return '/overview'
  return true
}

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
  if (sessionExpiredShown) return
  sessionExpiredShown = true
  const redirect = router.currentRoute.value.fullPath
  void ElMessageBox.alert('登录失效,请重新登录', '提示', {
    type: 'warning',
    confirmButtonText: '重新登录',
    showClose: false,
    closeOnClickModal: false,
    closeOnPressEscape: false,
  }).finally(() => {
    // 会话已死：不调 logout.htm（实测该接口此时返回 500，调用无意义），仅清本地状态
    useAuthStore().clear()
    void router.push({ path: '/user/login', query: { redirect } }).finally(() => {
      sessionExpiredShown = false
    })
  })
})
