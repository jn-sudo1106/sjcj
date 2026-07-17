import { defineStore } from 'pinia'
import {
  LOGIN_USERNAME_KEY,
  clearStoredToken,
  getInfo,
  login as apiLogin,
  logout as apiLogout,
  readStoredToken,
  writeStoredToken,
  type LoginParams,
  type UserInfo,
} from '../api/auth'

// 系统认证会话：迁移旧 Vuex store/modules/user.js 的 Login/GetInfo/Logout 三个 action。
// 角色按计划 §1.4 标准化为 admin | read 暴露给界面，按钮级权限另行立项。
export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: readStoredToken(),
    name: '',
    avatar: '',
    roles: [] as string[],
    info: null as UserInfo | null,
  }),

  getters: {
    isLoggedIn: (s) => !!s.token,
    // 旧 GetInfo：roles.indexOf('admin') !== -1 → 管理员，其余按只读
    role: (s): 'admin' | 'read' | '' => {
      if (!s.roles.length) return ''
      return s.roles.includes('admin') ? 'admin' : 'read'
    },
  },

  actions: {
    async login(params: LoginParams) {
      const res = await apiLogin(params)
      this.token = res.data.token
      writeStoredToken(this.token)
      const loginUsername = params.username || params.email || ''
      if (loginUsername) sessionStorage.setItem(LOGIN_USERNAME_KEY, loginUsername)
    },

    async fetchInfo() {
      const res = await getInfo()
      const roles = res.data && res.data.roles
      // 旧 GetInfo：无角色视为异常会话
      if (!roles || roles.length === 0) {
        throw new Error('getInfo: roles must be a non-null array !')
      }
      this.roles = roles
      this.name = res.data.name
      this.avatar = res.data.avatar
      this.info = res.data
      return res
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
      clearStoredToken()
      sessionStorage.removeItem(LOGIN_USERNAME_KEY)
    },
  },
})
