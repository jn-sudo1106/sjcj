// 用户动态菜单与权限导航（SYS_RESOURCE）—— 用户登录后获取可访问的菜单分组与权限码
// 后端契约：com.vanv.sys.controller.SysMenuController，路径前缀 /api/v1/sys/menu（bee-config）
import { request } from './client'

export interface NavTab {
  id: number
  key: string
  label: string
  permission: string
  order: number
  remark?: string
  /**
   * Tab 组件文件路径（sys_menu.component_path，如 `views/Settings/NodeTypeTab.vue`）。
   * 页面没有为该 key 准备 componentMap 时，useDynamicTabs 按它懒加载组件——
   * 后端新增页内 tab 只需配这一列，前端不用改代码。
   */
  componentPath?: string
}

export interface NavMenu {
  id: number
  key: string
  label: string
  path: string
  icon?: string
  permission?: string
  order: number
  tabs?: NavTab[]
  /**
   * 前端组件文件路径（sys_menu.component_path，与「菜单配置」页维护的是同一个字段），
   * 如 `views/Overview/index.vue`。动态路由装配以它为准，见 router/dynamicRoutes.ts。
   */
  componentPath?: string
  /**
   * 路由唯一英文名（sys_menu.route_name），作为 Vue Router 的 route.name。
   * 为空时前端回退到 `Route_<key>`。
   */
  routeName?: string
  /** 备注；老库把组件路径直接写在备注里（如 `src/views/Overview/index.vue`），装配时兼容读取 */
  remark?: string
}

export interface NavGroup {
  groupKey: string
  groupLabel: string
  order: number
  items: NavMenu[]
}

export interface UserNavData {
  permissions: string[]
  menuGroups: NavGroup[]
}

const EP = {
  userNav: 'sys/menu/user-nav',
} as const

/**
 * 获取当前登录用户的菜单树与权限码列表
 *
 * ⚠️ 首次业务导航会 await 它（守卫里加载会话）。client 的默认超时是 20s，后端这个接口没起来
 * 或者网关挂住时会把「第一次点菜单」拖成假死；这里给 3s 兜底，超时后走降级（保持旧菜单可用，
 * 不把整页卡住）。2026-11-06 首次点击卡顿优化。
 */
export function getUserNav(): Promise<UserNavData> {
  return request<UserNavData>(EP.userNav, {}, { method: 'GET', timeoutMs: 3000 })
}
