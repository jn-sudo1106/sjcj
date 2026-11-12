import { describe, expect, it, vi } from 'vitest'
import type { RouteRecordRaw } from 'vue-router'
import type { NavGroup, NavMenu } from '@/api/menu'
import { generateRoutesFromNav, resolveComponent, toViewComponentKey } from './dynamicRoutes'

// 动态路由装配的契约：path / 组件文件 / 路由名 / 标题 / 权限码全部以后端 sys/menu/user-nav
// 下发的菜单记录为准（数据源是「菜单配置」页维护的 SYS_RESOURCE），前端只把 componentPath
// 映射成 import() 懒加载函数。这组用例锁死「后端数据优先」这条口径。

let seq = 0
function item(patch: Partial<NavMenu> = {}): NavMenu {
  seq += 1
  return {
    id: seq,
    key: `menu-${seq}`,
    label: `菜单${seq}`,
    path: `/menu-${seq}`,
    order: 1,
    ...patch,
  }
}

function groups(...items: NavMenu[]): NavGroup[] {
  return [{ groupKey: 'g', groupLabel: '组', order: 1, items }]
}

function byPath(routes: RouteRecordRaw[], path: string) {
  return routes.find((r) => r.path === path)
}

describe('toViewComponentKey（后端 componentPath 规范化）', () => {
  it('兼容 views/ 、src/views/ 、@/views/ 、/views/ 前缀与反斜杠', () => {
    const expected = '../views/Overview/index.vue'
    expect(toViewComponentKey('views/Overview/index.vue')).toBe(expected)
    expect(toViewComponentKey('src/views/Overview/index.vue')).toBe(expected)
    expect(toViewComponentKey('@/views/Overview/index.vue')).toBe(expected)
    expect(toViewComponentKey('/views/Overview/index.vue')).toBe(expected)
    expect(toViewComponentKey('src\\views\\Overview\\index.vue')).toBe(expected)
  })

  it('只写到目录或省略 .vue 后缀时按 index.vue 补全', () => {
    expect(toViewComponentKey('views/Overview')).toBe('../views/Overview/index.vue')
    expect(toViewComponentKey('views/Overview/index')).toBe('../views/Overview/index.vue')
  })

  it('大小写不一致仍能命中磁盘上的真实文件', () => {
    expect(toViewComponentKey('views/overview/INDEX.vue')).toBe('../views/Overview/index.vue')
  })

  it('空值、非 views 路径、文件不存在一律返回 null', () => {
    expect(toViewComponentKey('')).toBeNull()
    expect(toViewComponentKey(undefined)).toBeNull()
    expect(toViewComponentKey('components/Foo.vue')).toBeNull()
    expect(toViewComponentKey('views/NotExist/index.vue')).toBeNull()
  })
})

describe('generateRoutesFromNav（路由信息来自后端）', () => {
  it('组件由后端 componentPath 决定，前端没有内置映射的 path 也能装配', () => {
    const routes = generateRoutesFromNav(
      groups(
        item({
          key: 'custom',
          label: '自定义页面',
          path: '/custom-page',
          componentPath: 'views/Overview/index.vue',
          routeName: 'CustomPage',
          permission: 'custom',
        }),
      ),
    )

    const route = byPath(routes, '/custom-page')
    expect(route).toBeTruthy()
    // 路由名来自后端 route_name
    expect(route!.name).toBe('CustomPage')
    // 标题、权限码、组件路径都按后端下发值写入 meta
    expect(route!.meta).toMatchObject({
      title: '自定义页面',
      permission: 'custom',
      componentPath: 'views/Overview/index.vue',
    })
    expect(typeof route!.component).toBe('function')

    // 反证：同一条菜单拿掉后端 componentPath 就装配不出来（前端没有 /custom-page 的约定目录）
    expect(resolveComponent('/custom-page')).toBeNull()
  })

  it('后端 component_path 缺失时读取老库写在 remark 里的组件路径', () => {
    const routes = generateRoutesFromNav(
      groups(item({ path: '/legacy-page', remark: 'src/views/Overview/index.vue' })),
    )
    expect(byPath(routes, '/legacy-page')).toBeTruthy()
  })

  it('后端配置的组件文件不存在时回退前端内置映射，不因误配丢页面', () => {
    const routes = generateRoutesFromNav(
      groups(item({ key: 'overview', path: '/overview', componentPath: 'views/NotExist/index.vue' })),
    )
    expect(byPath(routes, '/overview')).toBeTruthy()
  })

  it('既没有后端组件路径、也没有内置映射与约定目录时，不生成路由（开发态提示具体菜单）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const routes = generateRoutesFromNav(groups(item({ key: 'ghost', label: '幽灵页', path: '/ghost-page' })))
    expect(byPath(routes, '/ghost-page')).toBeUndefined()
    // 后端配了菜单但前端没页面文件：装配期就说清是哪一条，避免「菜单点了没反应」无从排查
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('/ghost-page'))
    warn.mockRestore()
  })

  it('路由名缺省回退 Route_<key>，非法字符清洗，重名自动让位', () => {
    const routes = generateRoutesFromNav(
      groups(
        item({ key: 'a-page', path: '/a-page', componentPath: 'views/Overview/index.vue' }),
        item({ key: 'b-page', path: '/b-page', componentPath: 'views/Overview/index.vue', routeName: 'Dup Name' }),
        item({ key: 'c-page', path: '/c-page', componentPath: 'views/Overview/index.vue', routeName: 'Dup_Name' }),
      ),
    )

    expect(byPath(routes, '/a-page')!.name).toBe('Route_a_page')
    expect(byPath(routes, '/b-page')!.name).toBe('Dup_Name')
    // 与上一条重名 → 回退自身的 Route_<key>，不会互相覆盖
    expect(byPath(routes, '/c-page')!.name).toBe('Route_c_page')
  })

  it('同一个菜单标识挂了多个 path 时，兜底名也能收敛不重名', () => {
    const routes = generateRoutesFromNav(
      groups(
        item({ key: 'dup', path: '/x1', componentPath: 'views/Overview/index.vue' }),
        item({ key: 'dup', path: '/x2', componentPath: 'views/Overview/index.vue' }),
        item({ key: 'dup', path: '/x3', componentPath: 'views/Overview/index.vue' }),
      ),
    )

    expect(routes.map((r) => r.name)).toEqual(['Route_dup', 'Route_dup_2', 'Route_dup_3'])
  })

  it('外链 .htm 菜单跳过、重复 path 只装配一次', () => {
    const routes = generateRoutesFromNav([
      {
        groupKey: 'g',
        groupLabel: '组',
        order: 1,
        items: [
          item({ path: '/external.htm' }),
          item({ key: 'overview', path: '/overview' }),
          item({ key: 'overview2', path: '/overview' }),
        ],
      },
    ])
    expect(routes.map((r) => r.path)).toEqual(['/overview'])
  })

  it('画布入口参数校验与同步向导隐式子路由仍保留（前端专有约定）', () => {
    const routes = generateRoutesFromNav(
      groups(item({ key: 'canvas', path: '/canvas' }), item({ key: 'sync', path: '/sync' })),
    )

    const canvas = byPath(routes, '/canvas')!
    const beforeEnter = canvas.beforeEnter as (to: { query: Record<string, string> }) => unknown
    expect(beforeEnter({ query: {} })).toBe('/collect')
    expect(beforeEnter({ query: { sourceId: '1' } })).toBe(true)

    const syncCreate = byPath(routes, '/sync/create')!
    expect(syncCreate.meta).toMatchObject({ title: '新建同步任务', hidden: true })
    expect(typeof syncCreate.component).toBe('function')
  })
})

describe('resolveComponent', () => {
  it('后端 componentPath 优先于内置映射 / path 约定查找', () => {
    const fromBackend = resolveComponent('/overview', { componentPath: 'views/Settings/index.vue' })
    const builtin = resolveComponent('/overview')
    expect(typeof fromBackend).toBe('function')
    expect(typeof builtin).toBe('function')
    // 后端指定的文件与内置映射不是同一个组件工厂 → 后端配置生效
    expect(fromBackend).not.toBe(builtin)
    // 同一条配置多次解析结果稳定（懒加载工厂只建一次）
    expect(resolveComponent('/overview', { componentPath: 'views/Settings/index.vue' })).toBe(fromBackend)
  })

  it('没有后端配置时按内置映射 / path 约定命中', () => {
    expect(typeof resolveComponent('/overview')).toBe('function')
  })
})
