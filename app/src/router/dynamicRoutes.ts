import type { RouteRecordRaw, Router } from 'vue-router'
import type { NavGroup, NavMenu } from '@/api/menu'

// 自动扫描 views 下所有 .vue 文件
const viewModules = import.meta.glob('../views/**/*.vue')

// glob 键的小写索引：后端菜单里配的组件路径大小写不一定与磁盘一致（如 views/overview/index.vue），
// 精确匹配不到时用它兜底，避免因为一个字母大小写就让菜单点不进去。
const viewModulesByLowerKey = Object.keys(viewModules).reduce<Record<string, string>>((acc, key) => {
  acc[key.toLowerCase()] = key
  return acc
}, {})

/** 核心预置视图组件映射（强类型推导与快速加载） */
const KNOWN_VIEW_COMPONENTS: Record<string, () => Promise<unknown>> = {
  '/overview': () => import('../views/Overview/index.vue'),
  '/collect': () => import('../views/CollectAssets/index.vue'),
  '/canvas': () => import('../views/FlowCanvas/index.vue'),
  '/flows': () => import('../views/FlowCenter/index.vue'),
  '/rules': () => import('../views/RuleAssets/index.vue'),
  '/metrics': () => import('../views/MetricCenter/index.vue'),
  '/data': () => import('../views/DataView/index.vue'),
  '/files': () => import('../views/FileCenter/index.vue'),
  '/tasks': () => import('../views/RunRecords/index.vue'),
  '/sync': () => import('../views/DataSync/index.vue'),
  '/sync/create': () => import('../views/DataSync/TaskWizard.vue'),
  '/monitor': () => import('../views/Monitor/index.vue'),
  '/ai-chat': () => import('../views/TemplateConfig/AiChat/index.vue'),
  '/base-config': () => import('../views/TemplateConfig/BaseConfig/index.vue'),
  '/template-config': () => import('../views/TemplateConfig/index.vue'),
  '/system-config': () => import('../views/TemplateConfig/SystemConfig/index.vue'),
  '/auxiliary-tool': () => import('../views/AuxiliaryTool/index.vue'),
  '/settings': () => import('../views/Settings/index.vue'),
  '/user-permission': () => import('../views/Settings/UserPermission/index.vue'),
  '/menu-config': () => import('../views/Settings/MenuConfig/index.vue'),
}

/** 后端菜单下发的、可用于定位前端组件文件的字段 */
export interface ComponentSource {
  /** sys_menu.component_path，如 views/Overview/index.vue */
  componentPath?: string
  /** 备注；老库把组件路径写在这里，如 src/views/Overview/index.vue */
  remark?: string
}

/**
 * 把后端配置的前端组件文件路径规范化成 views 下的 glob 键（`../views/Xxx/index.vue`）。
 *
 * 后端「菜单配置」页的输入格式并不严格（placeholder 是 `views/Overview/index.vue`，老库 remark 里
 * 存的是 `src/views/...`），这里统一兼容：`views/`、`src/views/`、`@/views/`、`/views/` 前缀、
 * 反斜杠分隔符、只写到目录（`views/Overview`）、省略 `.vue` 后缀、大小写不一致。
 *
 * @returns 命中的 glob 键；文件不存在或路径不合法时返回 null（由调用方继续回退）
 */
export function toViewComponentKey(componentPath?: string): string | null {
  const raw = (componentPath || '').trim()
  if (!raw) return null

  let normalized = raw.replace(/\\/g, '/').replace(/^@\//, '').replace(/^\.\//, '').replace(/^\/+/, '')
  // `src/views/...`、`web/src/views/...` 之类统一收敛到 `views/...`
  const viewsIndex = normalized.toLowerCase().indexOf('views/')
  if (viewsIndex > 0) normalized = normalized.slice(viewsIndex)
  if (!normalized.toLowerCase().startsWith('views/')) return null

  const trimmed = normalized.replace(/\/+$/, '')
  const candidates = [normalized]
  if (!/\.vue$/i.test(trimmed)) {
    candidates.push(`${trimmed}/index.vue`, `${trimmed}.vue`)
  }

  for (const candidate of candidates) {
    const key = `../${candidate}`
    if (viewModules[key]) return key
    const lowerKey = viewModulesByLowerKey[key.toLowerCase()]
    if (lowerKey) return lowerKey
  }
  return null
}

/**
 * 按后端配置的组件文件路径取懒加载函数。
 *
 * 供页内 tab（useDynamicTabs）复用同一套 views 约定解析：后端 sys_menu 的每个 menu_type=2
 * 记录都带 component_path，页面不必为每个 tab 提前写 componentMap。
 */
export function loadViewComponent(componentPath?: string): (() => Promise<unknown>) | null {
  const key = toViewComponentKey(componentPath)
  return key ? viewModules[key] : null
}

/**
 * 解析视图组件，优先级：
 * 1. 后端菜单下发的 componentPath（`sys_menu.component_path`，最权威）；
 * 2. 后端菜单的 remark（老库把组件路径写在备注里时的兼容）；
 * 3. 前端内置的核心视图映射（后两者都没配时的稳定兜底，省掉 glob 扫描）；
 * 4. path 约定式查找（如 /my-page → ../views/MyPage/index.vue 或 ../views/my-page/index.vue）。
 */
export function resolveComponent(
  path: string,
  source: ComponentSource = {},
): (() => Promise<unknown>) | null {
  for (const configuredPath of [source.componentPath, source.remark]) {
    const key = toViewComponentKey(configuredPath)
    if (key) return viewModules[key]
  }

  if (KNOWN_VIEW_COMPONENTS[path]) {
    return KNOWN_VIEW_COMPONENTS[path]
  }

  // 按 path 约定查找（如 /my-page → ../views/MyPage/index.vue 或 ../views/my-page/index.vue）
  const clean = path.replace(/^\//, '').toLowerCase()
  for (const candidate of [`../views/${clean}/index.vue`, `../views/${clean}.vue`]) {
    const key = viewModulesByLowerKey[candidate]
    if (key) return viewModules[key]
  }

  return null
}

/**
 * 路由 name：后端配置的 `route_name` 优先，未配置或与本次装配的记录重名时回退 `Route_<key>`。
 * Vue Router 的 name 必须是字符串且唯一（同名会被 addRoute 覆盖），所以这里统一清洗非法字符并去重。
 */
function resolveRouteName(item: NavMenu, routePath: string, usedNames: Set<string>): string {
  const fallback = `Route_${(item.key || routePath.slice(1)).replace(/[^a-zA-Z0-9_]/g, '_')}`
  const fromBackend = (item.routeName || '').trim().replace(/[^a-zA-Z0-9_]/g, '_')

  let name = fromBackend || fallback
  if (usedNames.has(name)) name = fallback
  // 兜底名也可能重复（同一个 key 挂了多个 path），用递增后缀保证一定收敛
  for (let suffix = 2; usedNames.has(name); suffix += 1) {
    name = `${fallback}_${suffix}`
  }

  usedNames.add(name)
  return name
}

/**
 * 将后端接口返回的 menuGroups 解析构建为 Vue Router 的 RouteRecordRaw 列表。
 *
 * 路由的 path / 组件文件 / 路由名 / 标题 / 图标 / 权限码 / 页内 tab 全部取自后端菜单记录
 * （`sys/menu/user-nav`，数据源是「菜单配置」页维护的 SYS_RESOURCE），前端只负责把
 * componentPath 映射成 import() 懒加载函数——后端新增菜单后不再需要改前端路由表。
 */
export function generateRoutesFromNav(menuGroups: NavGroup[]): RouteRecordRaw[] {
  const dynamicRoutes: RouteRecordRaw[] = []
  const seenPaths = new Set<string>()
  const usedNames = new Set<string>()

  for (const group of menuGroups) {
    for (const item of group.items) {
      if (!item.path || item.path.toLowerCase().endsWith('.htm')) continue
      const routePath = item.path.startsWith('/') ? item.path : `/${item.path}`
      if (seenPaths.has(routePath)) continue
      seenPaths.add(routePath)

      const component = resolveComponent(routePath, {
        componentPath: item.componentPath,
        remark: item.remark,
      })
      if (!component) {
        // 后端配了菜单但前端没有对应页面文件：不生成路由（侧栏仍会显示该菜单，点进去落 404）。
        // 开发态打出具体是哪一条、配的是什么路径，避免「菜单点了没反应」无从排查。
        if (import.meta.env.DEV) {
          console.warn(
            `[router] 菜单「${item.label}」(${routePath}) 未找到前端组件文件：` +
              `${item.componentPath || item.remark || '未配置 componentPath'}`,
          )
        }
        continue
      }

      const routeRecord: RouteRecordRaw = {
        path: routePath,
        name: resolveRouteName(item, routePath, usedNames),
        component,
        meta: {
          title: item.label,
          icon: item.icon,
          permission: item.permission,
          group: group.groupKey,
          order: item.order,
          tabs: item.tabs || [],
          // 记一份后端下发的组件路径，排查「菜单点不进去」时能直接从路由上看到配置值
          componentPath: item.componentPath,
        },
      }

      // 画布特例：校验合法入口参数
      if (routePath === '/canvas') {
        routeRecord.beforeEnter = (to) =>
          to.query.sourceId || to.query.siteId || to.query.mode === 'new' ? true : '/collect'
      }

      dynamicRoutes.push(routeRecord)

      // 同步模块特例：挂载任务向导隐式子路由
      if (routePath === '/sync') {
        const syncCreateName = usedNames.has('Route_sync_create')
          ? 'Route_sync_create_hidden'
          : 'Route_sync_create'
        usedNames.add(syncCreateName)
        dynamicRoutes.push({
          path: '/sync/create',
          name: syncCreateName,
          component: KNOWN_VIEW_COMPONENTS['/sync/create'],
          meta: {
            title: '新建同步任务',
            permission: item.permission,
            hidden: true,
          },
        })
      }
    }
  }

  return dynamicRoutes
}

/**
 * 将解析出的动态路由注入到 Vue Router，并返回已注入的路由 name 集合
 */
export function addDynamicRoutes(router: Router, routes: RouteRecordRaw[], parentName = 'RootLayout'): string[] {
  const addedNames: string[] = []

  for (const route of routes) {
    const routeName = String(route.name || '')
    if (router.hasRoute(routeName)) {
      router.removeRoute(routeName)
    }

    if (router.hasRoute(parentName)) {
      router.addRoute(parentName, route)
    } else {
      router.addRoute(route)
    }

    if (routeName) {
      addedNames.push(routeName)
    }
  }

  return addedNames
}

/**
 * 登出或重置时清理已注入的动态路由
 */
export function resetDynamicRoutes(router: Router, addedNames: string[]) {
  for (const name of addedNames) {
    if (router.hasRoute(name)) {
      router.removeRoute(name)
    }
  }
}
