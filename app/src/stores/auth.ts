import { defineStore } from 'pinia'
import {
  LOGIN_USERNAME_KEY,
  clearStoredToken,
  getInfo,
  login as apiLogin,
  logout as apiLogout,
  readLoginUsername,
  readStoredToken,
  writeStoredToken,
  type LoginParams,
  type UserInfo,
} from '../api/auth'
import { getUserNav, type NavGroup, type UserNavData } from '../api/menu'

/**
 * 超级管理员角色名（大小写不敏感）。
 *
 * root 是最高权限账号：**任何菜单/页内 tab/按钮都不做权限校验**（后端接口仍是最终边界）。
 * 老系统的 root 账号有时 roles 里只有 `root`、有时干脆只给普通角色，所以下面还会用登录名兜底。
 */
const SUPER_ADMIN_ROLES = new Set(['admin', 'root', 'superadmin', 'super_admin', 'super-admin'])
/** 登录名是 root 时同样视为超级管理员（roles 里没给 admin/root 的老账号也能兜住） */
const SUPER_ADMIN_LOGIN_NAMES = new Set(['root'])

// 单飞（in-flight 去重）：冷启动预热（App.vue 的 warmUpAuth）与首次导航守卫会同时问会话，
// 不去重就会把 /user-info.htm、/sys/menu/user-nav 各打两遍 —— 本来就是「第一次点菜单卡」的元凶之一。
// 失败后 clear 掉，下次导航仍可重试。
let infoInFlight: Promise<Awaited<ReturnType<typeof getInfo>>> | null = null
let navInFlight: Promise<UserNavData | null> | null = null

/**
 * 会话快照（sessionStorage）：把上次拿到的角色/权限/菜单存下来，刷新页面后**先按快照渲染**。
 *
 * 背景：`/user-info.htm` 在部分环境要 10 秒才回（2026-11-06 实测，见 router/index.ts 的导航预算）。
 * 有快照时守卫完全不用等网络：侧栏/页内 tab/写操作按钮一上来就是对的，后台再校准。
 * 只存会话信息（不含 token；token 另有存储），登出/清会话时一并删除。
 */
const SNAPSHOT_KEY = 'front-ce:auth-snapshot'
const SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60 * 1000

interface SessionSnapshot {
  at: number
  roles: string[]
  name: string
  avatar: string
  info: UserInfo | null
  permissions: string[]
  menuGroups: NavGroup[]
}

function readSnapshot(): SessionSnapshot | null {
  try {
    if (typeof sessionStorage === 'undefined') return null
    const raw = sessionStorage.getItem(SNAPSHOT_KEY)
    if (!raw) return null
    const snap = JSON.parse(raw) as SessionSnapshot
    if (!snap || typeof snap !== 'object') return null
    // 过期快照不用：角色/权限被改过的话，宁可先按「未知」渲染再等接口
    if (Date.now() - Number(snap.at || 0) > SNAPSHOT_MAX_AGE_MS) return null
    return snap
  } catch {
    return null
  }
}

function writeSnapshot(snap: SessionSnapshot): void {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap))
  } catch {
    // 存储不可用（隐私模式/配额满）：只是少了加速，不影响功能
  }
}

function clearSnapshot(): void {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(SNAPSHOT_KEY)
  } catch {
    // 同上
  }
}

// 系统认证会话：迁移旧 Vuex store/modules/user.js 的 Login/GetInfo/Logout 三个 action。
// 角色按计划 §1.4 标准化为 admin | read 暴露给界面，自定义角色及动态菜单权限由 permissions 与 menuGroups 支持。
export const useAuthStore = defineStore('auth', {
  state: () => {
    // 刷新页面时先用上次的快照渲染（慢接口也不再挡住任何一次点击）
    const snap = readSnapshot()
    return {
      token: readStoredToken(),
      name: snap?.name ?? '',
      avatar: snap?.avatar ?? '',
      roles: snap?.roles ?? [],
      info: snap?.info ?? null,
      /** 登录名（root 用它判定超级管理员；刷新后从 sessionStorage 还原） */
      loginUsername: readLoginUsername(),
      menuGroups: snap?.menuGroups ?? [],
      permissions: snap?.permissions ?? [],
      isMenusLoaded: !!snap,
      /** 菜单接口失败/未部署：permissions 为空只是「未知」，不是「零权限」（见 canAccess 规则 4） */
      menusLoadFailed: false,
      isRoutesLoaded: false,
      dynamicRouteNames: [] as string[],
      /** 本次登录的会话标识：只用来给 AppShell 的 KeepAlive 换 key（登录/登出才变），避免首次拿到 user 信息就重建页面 */
      sessionKey: '',
    }
  },

  getters: {
    isLoggedIn: (s) => !!s.token,
    /**
     * 超级管理员（root / admin）：**什么都不校验**。
     * 判定顺序：roles 里出现 admin/root/superadmin → 登录名是 root → 用户信息里的 name 是 root。
     */
    isSuperAdmin: (s): boolean => {
      const roles = (s.roles || []).map((role) => String(role).trim().toLowerCase())
      if (roles.some((role) => SUPER_ADMIN_ROLES.has(role))) return true
      const loginName = String(s.loginUsername || '').trim().toLowerCase()
      if (SUPER_ADMIN_LOGIN_NAMES.has(loginName)) return true
      const displayName = String(s.name || '').trim().toLowerCase()
      return SUPER_ADMIN_LOGIN_NAMES.has(displayName)
    },
    // 旧 GetInfo：roles.indexOf('admin') !== -1 → 管理员，其余按只读。
    // 2026-11-06：root（超级管理员）同样按 admin 暴露给界面，让他照常拿到全部写操作入口。
    role(): 'admin' | 'read' | '' {
      if (this.isSuperAdmin) return 'admin'
      if (!this.roles.length) return ''
      return 'read'
    },
    /** 所有已分配角色的原始集合（支持自定义角色识别） */
    rawRoles: (s) => s.roles,
    /**
     * 页面缓存分区键（AppShell 的 `<KeepAlive :key>`）。
     * 以前直接用 `auth.info?.id`：首次 fetchInfo 后才从 undefined 变成真实 id，key 一变
     * KeepAlive 就整体替换，刚挂载的页面被销毁重建（首屏接口白打一遍）。
     * 改成「登录时确定的会话标识」，刷新页面稳定、只换账号时才换分区。
     */
    cacheKey: (s) => s.sessionKey || (s.token ? 'session' : 'anonymous'),
  },

  actions: {
    async login(params: LoginParams) {
      const res = await apiLogin(params)
      this.token = res.data.token
      writeStoredToken(this.token)
      // 每次登录给一个新的缓存分区（换账号不串页面状态）；刷新页面时保持空串，走 getter 的稳定值
      this.sessionKey = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      const loginUsername = params.username || params.email || ''
      if (loginUsername) sessionStorage.setItem(LOGIN_USERNAME_KEY, loginUsername)
      // root 的判定要用登录名（老账号 roles 里可能没给 admin/root）
      this.loginUsername = loginUsername
    },

    /** 用户信息落库（fetchInfo / prefetchSession 共用） */
    applyUserInfo(data: UserInfo) {
      this.roles = data.roles || []
      this.name = data.name
      this.avatar = data.avatar
      this.info = data
      this.persistSnapshot()
    },

    /** 菜单数据落库（成功/失败都标记 isMenusLoaded，避免每次导航重试；失败单独记在 menusLoadFailed 上） */
    applyUserNav(nav: UserNavData | null) {
      if (nav) {
        this.permissions = nav.permissions || []
        this.menuGroups = nav.menuGroups || []
        this.menusLoadFailed = false
        this.persistSnapshot()
      } else {
        this.menusLoadFailed = true
      }
      this.isMenusLoaded = true
    },

    /** 把当前会话写进快照（下次刷新先用它渲染，不必等接口） */
    persistSnapshot() {
      // 角色还没到（或会话已失效）时不写：避免存下「零角色/零权限」的假快照
      if (!this.token || !this.roles.length) return
      writeSnapshot({
        at: Date.now(),
        roles: this.roles,
        name: this.name,
        avatar: this.avatar,
        info: this.info,
        permissions: this.permissions,
        menuGroups: this.menuGroups,
      })
    },

    /**
     * 拉取用户菜单与权限码（单飞：并发调用只会发一个请求）。
     * 失败返回 null 并把 menusLoadFailed 置位 —— canAccess 据此放行，不把「未知」当「零权限」。
     */
    async fetchUserNav(): Promise<UserNavData | null> {
      if (navInFlight) return navInFlight
      navInFlight = getUserNav()
        .then((nav) => {
          this.applyUserNav(nav ?? null)
          return nav ?? null
        })
        .catch(() => {
          // 动态菜单异常时优雅降级，标记已加载避免死循环
          this.applyUserNav(null)
          return null
        })
        .finally(() => {
          navInFlight = null
        })
      return navInFlight
    },

    /**
     * 恢复当前登录用户（旧 GetInfo + 新菜单接口，**并行**）。
     * 之前是 getInfo 完成后再串行 await fetchUserNav，首次导航要多等一个 RTT；
     * 两个接口互不依赖，这里一次并发打完。单飞保证守卫与冷启动预热不会重复请求。
     */
    async fetchInfo() {
      if (infoInFlight) return infoInFlight
      infoInFlight = (async () => {
        const [res, nav] = await Promise.all([getInfo(), this.fetchUserNav()])
        const roles = res.data && res.data.roles
        // 旧 GetInfo：无角色视为异常会话
        if (!roles || roles.length === 0) {
          throw new Error('getInfo: roles must be a non-null array !')
        }
        this.applyUserInfo(res.data)
        // 并发期间 fetchUserNav 已经把菜单写进 store；这里不再等待第二次
        void nav
        return res
      })().finally(() => {
        infoInFlight = null
      })
      return infoInFlight
    },

    /**
     * 登录成功后**后台预热**会话与菜单（不阻塞跳转）。
     * 守卫里会 await 同一批 in-flight 请求（单飞），所以用户感知不到重复等待。
     */
    async prefetchSession(): Promise<void> {
      if (this.roles.length && this.isMenusLoaded) return
      try {
        if (!this.roles.length) {
          await this.fetchInfo()
        } else if (!this.isMenusLoaded) {
          await this.fetchUserNav()
        }
      } catch {
        // 预热失败不影响登录跳转：守卫会按原有逻辑（清会话 / 回登录页）处理
      }
    },

    // 旧 Logout：接口无论成功与否都清理本地会话（logout.htm 无会话时返回 500，见计划 §1.5.7）
    async logout() {
      try {
        await apiLogout()
      } catch {
        /* 与旧代码一致：忽略登出接口失败 */
      } finally {
        this.clear()
      }
    },

    clear() {
      this.token = ''
      this.name = ''
      this.avatar = ''
      this.roles = []
      this.info = null
      this.menuGroups = []
      this.permissions = []
      this.isMenusLoaded = false
      this.menusLoadFailed = false
      this.isRoutesLoaded = false
      this.dynamicRouteNames = []
      this.sessionKey = ''
      this.loginUsername = ''
      infoInFlight = null
      navInFlight = null
      clearSnapshot()
      clearStoredToken()
      sessionStorage.removeItem(LOGIN_USERNAME_KEY)
    },
  },
})
