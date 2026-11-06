import { computed, defineAsyncComponent, markRaw, watch, type Component } from 'vue'
import { getActivePinia } from 'pinia'
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { canAccess } from '@/composables/usePermission'
import { loadViewComponent } from '@/router/dynamicRoutes'
import type { NavTab } from '@/api/menu'

export interface DynamicTabItem {
  key: string
  label: string
  permission?: string
  order?: number
  comp?: Component
  remark?: string
  /** 后端下发的 Tab 组件文件路径（sys_menu.component_path），comp 缺省时按它懒加载 */
  componentPath?: string
  adminOnly?: boolean
  [key: string]: unknown
}

export interface UseDynamicTabsOptions {
  /** 页面内 Tab 对应的 Vue 组件映射字典 */
  componentMap?: Record<string, Component>
  /** 降级兜底 Tab 列表（当后端未配置或网络异常时使用） */
  fallbackTabs?: DynamicTabItem[]
  /** 历史/别名映射（例如 'assignments' -> 'runners'） */
  aliasMap?: Record<string, string>
  /** 强制指定的默认 Tab key（默认无此项时以排在首位的 Tab 为准） */
  defaultTabKey?: string
  /** 是否开启自动纠偏与 URL 规范化（默认为 true，若页面需要单独做复杂跨路由跳转可设为 false） */
  autoNormalizeQuery?: boolean
  /**
   * tab 切换写回的路由路径。缺省用当前 route.path；页面显式声明更稳
   * （菜单 path 与真实路由不完全一致、或组件被嵌套复用时都不会写错地址）。
   */
  path?: string
}

// 后端 componentPath → 异步组件实例缓存：tab 列表会随 computed 反复重算，
// 每次都新建 defineAsyncComponent 会让 <component :is> 当成新组件重新挂载（闪一下、状态丢）。
const asyncComponentCache = new Map<string, Component>()

/**
 * 按后端下发的 Tab 组件文件路径懒加载组件（sys_menu.component_path）。
 * 页面自己的 componentMap 优先——那里可以一个组件挂多个 tab、或需要固定传 props。
 */
function resolveTabComponent(componentPath?: string): Component | undefined {
  const loader = loadViewComponent(componentPath)
  if (!loader) return undefined
  const cacheKey = String(componentPath)
  const cached = asyncComponentCache.get(cacheKey)
  if (cached) return cached
  const comp = markRaw(
    defineAsyncComponent(loader as () => Promise<Component | { default: Component }>),
  )
  asyncComponentCache.set(cacheKey, comp)
  return comp
}

/**
 * 在页面的 componentMap 里找组件。
 *
 * 后端 sys_menu 的 Tab「动作 Key」是老库 perms/route_path 迁过来的，历史数据里出现过
 * `monitor:sourceCheck`、`monitor/sourceCheck` 这类带模块前缀的写法，直接按整串查不到组件，
 * 页面就成了「tab 栏在、内容区空白」（最难受的形态）。这里先按整串匹配，再按最后一段兜底。
 */
function lookupTabComponent(
  componentMap: Record<string, Component> | undefined,
  key: string,
): Component | undefined {
  if (!componentMap) return undefined
  if (componentMap[key]) return componentMap[key]
  const tail = String(key).split(/[:/.\\]/).filter(Boolean).pop()
  if (tail && tail !== key && componentMap[tail]) return componentMap[tail]
  return undefined
}

/**
 * 页内 tab 的 key 收口：后端 `sys_menu` 的 menu_type=2 记录里 key（link_address）可能为空，
 * 也可能两条 tab 用同一个 key（菜单配置里手填、或从旧库迁移时留空）。
 *
 * key 一旦重复/为空，页签就「点了没反应」：`selectTab` 会把它当成第一个 tab（为了保持地址干净
 * 而删掉 ?tab=），`router.replace` 于是变成同地址的冗余导航被 vue-router 直接丢掉，
 * 地址与内容都不动，看起来就是按钮坏了。这里按「原 key → id → 序号」补一个稳定且唯一的 key。
 */
function uniqueTabKeys(list: { key?: unknown; id?: number }[]): string[] {
  const used = new Set<string>()
  return list.map((t, i) => {
    const raw = String(t.key ?? '').trim()
    const candidates = [raw, t.id === undefined || t.id === null ? '' : `tab-${t.id}`, `tab-${i + 1}`]
    let key = candidates.find((c) => !!c && !used.has(c)) || `tab-${i + 1}`
    for (let n = 2; used.has(key); n += 1) key = `tab-${i + 1}-${n}`
    used.add(key)
    return key
  })
}

/**
 * 页面内部页签 (res_type = 2) 统一动态化 Composable
 * 支持：后端动态数据拉取、角色权限码过滤、排序控制、URL query 自动归一化与防越权
 */
export function useDynamicTabs(options: UseDynamicTabsOptions = {}) {
  let route: ReturnType<typeof useRoute> | undefined
  let router: ReturnType<typeof useRouter> | undefined

  try {
    route = useRoute()
  } catch {
    // 单元测试或非组件上下文无 router injection
  }

  try {
    router = useRouter()
  } catch {
    // 单元测试或非组件上下文无 router injection
  }

  // 没有 pinia（组件单测直接 mount、或非 app 上下文）时不取 store：
  // 与 canAccess 的兜底口径一致——菜单权限未加载就一律放行，别让整页白屏。
  const auth = getActivePinia() ? useAuthStore() : null

  // 1. 动态加载当前菜单项下的全部 Tabs
  const rawTabs = computed<DynamicTabItem[]>(() => {
    // 优先从路由 meta.tabs 中读取
    const metaTabs = (route?.meta?.tabs as NavTab[] | undefined) || []
    if (metaTabs.length > 0) {
      const keys = uniqueTabKeys(metaTabs)
      const items = metaTabs.map((t, i) => {
        // 页面 componentMap 优先；没有的话按后端下发的 component_path 懒加载，
        // 这样后端在「菜单配置 → 页内 Tab」新增一条就能直接显示，前端不用改代码。
        const comp =
          lookupTabComponent(options.componentMap, t.key) ??
          // key 被补过（为空/重复）时也再按补出来的 key 找一次，兼容页面 componentMap 用本地键名兜底
          lookupTabComponent(options.componentMap, keys[i]) ??
          resolveTabComponent(t.componentPath)
        if (!comp && import.meta.env.DEV) {
          // 别让它静默变空白：把后端实际下发的 key / component_path 打出来，方便对齐配置
          console.warn(
            `[tabs] 页内 tab「${t.label}」找不到组件（后端 key=${t.key}，component_path=${t.componentPath || '未配置'}）`,
          )
        }
        if (keys[i] !== String(t.key ?? '').trim() && import.meta.env.DEV) {
          console.warn(
            `[tabs] 页内 tab「${t.label}」的 key 为空或与其它 tab 重复（后端 key=${JSON.stringify(t.key)}），` +
              `已按 id/序号补成 ${keys[i]}；请在「菜单配置」里补一个唯一 key`,
          )
        }
        return {
          key: keys[i],
          label: t.label,
          permission: t.permission,
          order: t.order ?? 0,
          remark: t.remark,
          componentPath: t.componentPath,
          comp,
        }
      })
      // 后端配的这些 tab 一条都解析不到组件（component_path 没配/文件已删）时，
      // 整页退回页面本地的 fallbackTabs——否则就是「页签栏在、内容区全空」的死页面。
      if (items.some((item) => item.comp) || !options.fallbackTabs?.length) return items
      if (import.meta.env.DEV) {
        console.warn('[tabs] 后端下发的页内 tab 均未解析到组件，已退回页面本地 fallbackTabs')
      }
    }

    // 兜底使用页面传入的 fallbackTabs
    return (options.fallbackTabs || []).map((t) => ({
      ...t,
      comp: t.comp || lookupTabComponent(options.componentMap, t.key),
    }))
  })

  // 2. 权限过滤与升序排序
  //
  // ⚠️ 兜底（2026-11-06）：页内 tab 的细粒度权限码（`sql-template` / `param-config` / `entity-config`…）
  // 目前后端菜单里普遍没配，`canAccess` 在「菜单已加载」时会严格校验 → 整页 tab 一个都不剩、
  // 内容区空白，用户看到的就是「tab 页打不开」（数据同步 / 问数系统配置 / 模板配置 / 基础配置 都踩过）。
  // 规则：过滤后为空但本来有 tab，就退回「未被权限码拦下的全部 tab」，只保留 adminOnly 的约束。
  const tabs = computed<DynamicTabItem[]>(() => {
    const all = rawTabs.value.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const superAdmin = auth?.isSuperAdmin ?? false
    const visible = all.filter((t) => {
      if (!canAccess(t.permission)) return false
      if (t.adminOnly && !superAdmin) return false
      return true
    })
    if (visible.length > 0 || all.length === 0) return visible

    const asFallback = all.filter((t) => !(t.adminOnly && !superAdmin))
    if (asFallback.length === 0) return visible
    if (import.meta.env.DEV) {
      console.warn(
        `[tabs] ${all.length} 个页内 tab 全被权限码过滤（当前账号 ${auth?.permissions.length ?? 0} 个权限码），` +
          '已回退为显示全部，避免整页空白；请到「菜单配置」补齐页内 Tab 的权限码',
      )
    }
    return asFallback
  })

  // 3. 当前激活的 Tab
  const activeTab = computed<DynamicTabItem | undefined>(() => {
    if (!tabs.value.length) return undefined

    let key = String(route?.query?.tab ?? '')
    if (options.aliasMap && options.aliasMap[key]) {
      key = options.aliasMap[key]
    }

    if (key) {
      const matched = tabs.value.find((t) => t.key === key)
      if (matched) return matched
    }

    if (options.defaultTabKey) {
      const defaultMatched = tabs.value.find((t) => t.key === options.defaultTabKey)
      if (defaultMatched) return defaultMatched
    }

    return tabs.value[0]
  })

  // 4. 当前激活的组件
  const currentComponent = computed<Component | undefined>(() => activeTab.value?.comp)

  // 5. 自动纠偏与 URL 规范化（避免手动输入不存在或未授权的 ?tab=xxx 停留在无效状态）
  //
  // 纠偏只作用于本页自己的地址：被 AppShell 的 KeepAlive 缓存下来的页面实例，它的 watch 不会随
  // deactivate 停掉，若不加这层判断，它会在别的页面上用自己那份 tab 表把 ?tab= 改掉（数据同步点
  // 页签「闪一下没切过去」就是这么来的）。
  const ownPath = options.path ?? route?.path
  if (options.autoNormalizeQuery !== false && route && router) {
    watch(
      () => route?.query?.tab,
      (tab) => {
        if (ownPath && route.path !== ownPath) return
        const activeKey = activeTab.value?.key
        if (!activeKey) return

        // 若命中了历史别名，直接定向到标准 key
        if (options.aliasMap && tab && options.aliasMap[String(tab)]) {
          const canonicalKey = options.aliasMap[String(tab)]
          void router.replace({
            path: options.path || route.path,
            query: { ...(route.query || {}), tab: canonicalKey },
          })
          return
        }

        // 如果当前 tab 非法或无权限，归一到合法激活项
        if (tab != null && tab !== activeKey && tab !== '') {
          const isFirst = activeKey === tabs.value[0]?.key
          const nextQuery: LocationQueryRaw = { ...(route.query || {}) }
          if (isFirst) {
            delete nextQuery.tab
          } else {
            nextQuery.tab = activeKey
          }
          void router.replace({
            path: options.path || route.path,
            query: nextQuery,
          })
        }
      },
      { immediate: true },
    )
  }

  // 6. 统一的切换 Tab 方法
  function selectTab(key: string, extraQuery: LocationQueryRaw = {}) {
    if (!router || !route) return
    const isFirst = key === tabs.value[0]?.key
    const nextQuery: LocationQueryRaw = { ...(route.query || {}), ...extraQuery }
    if (isFirst) {
      delete nextQuery.tab
    } else {
      nextQuery.tab = key
    }
    void router.replace({
      path: options.path || route.path,
      query: nextQuery,
    })
  }

  return {
    tabs,
    activeTab,
    currentComponent,
    selectTab,
  }
}
