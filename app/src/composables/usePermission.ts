import { getActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

/**
 * 菜单权限的统一判断口（0924-02，会上原话「留个口子，后续做人员菜单权限控制」）。
 *
 * 权限控制规则：
 * 1. 没声明权限码的入口一律放行；
 * 2. **超级管理员（root / admin）拥有全量最高权限，什么都不校验**（见 auth.isSuperAdmin）；
 * 3. 动态菜单/权限码已加载完成时，校验是否在 auth.permissions 集合中；
 * 4. 菜单数据未加载、或加载失败（降级）时兜底放行，保证界面可用性不发生白屏。
 *
 * 权限码约定：一级模块用 TabMeta.key（如 `settings`），页内 tab 用 `模块:tab`
 * （如 `settings:roles` / `settings:users` / `settings:dataPermission`）。
 *
 * 注意与「只读 / 管理员」区分：那是写操作的门槛（auth.role === 'admin'），
 * 各页面自己判断，不走这里；这里只管"能不能看到这个入口"。
 */
export function canAccess(permission?: string): boolean {
  if (!permission) return true
  if (!getActivePinia()) return true
  const auth = useAuthStore()
  // root / admin：超级管理员不做任何校验（菜单、页内 tab、按钮入口全部放行）
  if (auth.isSuperAdmin) return true
  // menusLoadFailed：菜单接口挂了/没部署，此时 permissions 是空数组，但那是「未知」不是「零权限」。
  // 不能据此把侧栏和页内 tab 全藏掉（表现为「功能都消失了」），按规则 4 放行。
  if (auth.isMenusLoaded && !auth.menusLoadFailed) {
    return auth.permissions.includes(permission)
  }
  return true
}
