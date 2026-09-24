/**
 * 菜单权限的统一判断口（0924-02，会上原话「留个口子，后续做人员菜单权限控制」）。
 *
 * **现在恒放行**：人员菜单权限还没有设计，后端也没有"当前用户可见菜单 / 权限码"接口。
 * 先把判断收拢到这一个函数——侧栏过滤、路由守卫、页内 tab 都只问它——等权限做了，
 * 只改这里的实现（从 auth store 读用户的权限码集合），调用方一行不用动。
 *
 * 权限码约定：一级模块用 TabMeta.key（如 `settings`），页内 tab 用 `模块:tab`
 * （如 `settings:nodeType`）。没声明权限码的入口一律放行。
 *
 * 注意与「只读 / 管理员」区分：那是**写操作**的门槛（auth.role === 'admin'），
 * 各页面自己判断，不走这里；这里只管"能不能看到这个入口"。
 */
export function canAccess(permission?: string): boolean {
  void permission
  return true
}
