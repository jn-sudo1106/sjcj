import type { SysMenuTreeNode, SysMenuForm, SysMenuSortItem } from '../sysMenuConfig'

// 模拟老库历史数据与当前系统菜单树
export let mockResourceList: SysMenuTreeNode[] = [
  // 1. 首页 (Group: 1000)
  { id: 1000, parentId: 0, label: '首页', type: 0, linkAddress: '', modelCode: 'group:home', icon: 'HomeFilled', order: 1, status: 0, remark: '侧栏分组目录', children: [] },
  { id: 1100, parentId: 1000, label: '采集资产总览', type: 1, linkAddress: '/overview', modelCode: 'overview', icon: 'Odometer', order: 1, status: 0, remark: 'src/views/Overview/index.vue', children: [] },

  // 2. 源工作区 (Group: 2000)
  { id: 2000, parentId: 0, label: '源工作区', type: 0, linkAddress: '', modelCode: 'group:assets', icon: 'Folder', order: 2, status: 0, remark: '侧栏分组目录', children: [] },
  { id: 2100, parentId: 2000, label: '源管理', type: 1, linkAddress: '/collect', modelCode: 'collect', icon: 'Box', order: 1, status: 0, remark: 'src/views/CollectAssets/index.vue', children: [] },
  { id: 2101, parentId: 2100, label: '系统目录', type: 2, linkAddress: 'source', modelCode: 'collect:source', icon: '', order: 1, status: 0, remark: 'SourceTab.vue', children: [] },
  { id: 2102, parentId: 2100, label: '我的分组', type: 2, linkAddress: 'personal', modelCode: 'collect:personal', icon: '', order: 2, status: 0, remark: 'SourceGroupTab.vue', children: [] },
  { id: 2103, parentId: 2100, label: '我的视图', type: 2, linkAddress: 'views', modelCode: 'collect:views', icon: '', order: 3, status: 0, remark: 'MyViews.vue', children: [] },
  { id: 2200, parentId: 2000, label: '流程画布', type: 1, linkAddress: '/canvas', modelCode: 'canvas', icon: 'Connection', order: 2, status: 0, remark: 'src/views/FlowCanvas/index.vue', children: [] },

  // 3. 流程与规则 (Group: 3000)
  { id: 3000, parentId: 0, label: '流程与规则', type: 0, linkAddress: '', modelCode: 'group:config', icon: 'SetUp', order: 3, status: 0, remark: '侧栏分组目录', children: [] },
  { id: 3100, parentId: 3000, label: '流程中心', type: 1, linkAddress: '/flows', modelCode: 'flows', icon: 'Connection', order: 1, status: 0, remark: 'src/views/FlowCenter/index.vue', children: [] },
  { id: 3200, parentId: 3000, label: '规则资产', type: 1, linkAddress: '/rules', modelCode: 'rules', icon: 'Document', order: 2, status: 0, remark: 'src/views/RuleAssets/index.vue', children: [] },
  { id: 3300, parentId: 3000, label: '指标中心', type: 1, linkAddress: '/metrics', modelCode: 'metrics', icon: 'Histogram', order: 3, status: 0, remark: 'src/views/MetricCenter/index.vue', children: [] },

  // 6. 问数配置 (Group: 6000)
  { id: 6000, parentId: 0, label: '问数配置', type: 0, linkAddress: '', modelCode: 'group:template', icon: 'Management', order: 6, status: 0, remark: '侧栏分组目录', children: [] },
  { id: 6050, parentId: 6000, label: 'AI智能问数', type: 1, linkAddress: '/ai-chat', modelCode: 'ai-chat', icon: 'ChatDotRound', order: 0, status: 0, remark: 'src/views/TemplateConfig/AiChat/index.vue', children: [] },
  { id: 6100, parentId: 6000, label: '基础配置', type: 1, linkAddress: '/base-config', modelCode: 'base-config', icon: 'Grid', order: 1, status: 0, remark: 'src/views/TemplateConfig/BaseConfig/index.vue', children: [] },
  { id: 6200, parentId: 6000, label: '模板配置', type: 1, linkAddress: '/template-config', modelCode: 'template-config', icon: 'Tickets', order: 2, status: 0, remark: 'src/views/TemplateConfig/index.vue', children: [] },
  { id: 6300, parentId: 6000, label: '问数系统配置', type: 1, linkAddress: '/system-config', modelCode: 'system-config', icon: 'SetUp', order: 3, status: 0, remark: 'src/views/TemplateConfig/SystemConfig/index.vue', children: [] },

  // 8. 系统管理 (Group: 8000)
  { id: 8000, parentId: 0, label: '系统管理', type: 0, linkAddress: '', modelCode: 'group:settings', icon: 'Setting', order: 8, status: 0, remark: '侧栏分组目录', children: [] },
  { id: 8100, parentId: 8000, label: '系统设置', type: 1, linkAddress: '/settings', modelCode: 'settings', icon: 'Setting', order: 1, status: 0, remark: 'src/views/Settings/index.vue', children: [] },
  { id: 8200, parentId: 8000, label: '用户权限设置', type: 1, linkAddress: '/user-permission', modelCode: 'user-permission', icon: 'UserFilled', order: 2, status: 0, remark: 'src/views/Settings/UserPermission/index.vue', children: [] },
  { id: 8201, parentId: 8200, label: '数据权限设置', type: 2, linkAddress: 'data-permission', modelCode: 'settings:dataPermission', icon: '', order: 1, status: 0, remark: 'DataPermissionTab.vue', children: [] },
  { id: 8202, parentId: 8200, label: '用户管理', type: 2, linkAddress: 'users', modelCode: 'settings:users', icon: '', order: 2, status: 0, remark: 'UserManagementTab.vue', children: [] },
  { id: 8203, parentId: 8200, label: '角色权限管理', type: 2, linkAddress: 'roles', modelCode: 'settings:roles', icon: '', order: 3, status: 0, remark: 'RolePermissionTab.vue', children: [] },

  // 菜单配置自身
  { id: 8300, parentId: 8000, label: '菜单配置', type: 1, linkAddress: '/menu-config', modelCode: 'menu-config', icon: 'Menu', order: 3, status: 0, remark: 'src/views/Settings/MenuConfig/index.vue', children: [] },
  { id: 8301, parentId: 8300, label: '菜单树查询', type: 3, linkAddress: '', modelCode: 'sys:menu:list', icon: '', order: 1, status: 0, remark: '按钮权限', children: [] },
  { id: 8302, parentId: 8300, label: '菜单新增', type: 3, linkAddress: '', modelCode: 'sys:menu:add', icon: '', order: 2, status: 0, remark: '按钮权限', children: [] },
  { id: 8303, parentId: 8300, label: '菜单修改', type: 3, linkAddress: '', modelCode: 'sys:menu:edit', icon: '', order: 3, status: 0, remark: '按钮权限', children: [] },
  { id: 8304, parentId: 8300, label: '菜单删除', type: 3, linkAddress: '', modelCode: 'sys:menu:delete', icon: '', order: 4, status: 0, remark: '按钮权限', children: [] },

  // 老库残留测试数据
  { id: 900, parentId: 0, label: '用户管理 (老库残留)', type: 0, linkAddress: '', modelCode: 'legacy:users', icon: 'Setting', order: 9, status: 0, remark: '历史脏数据根节点', children: [] },
  { id: 901, parentId: 900, label: '用户导出', type: 1, linkAddress: '', modelCode: 'sys:user:export', icon: '', order: 1, status: 0, remark: '老库误标 res_type=1 的按钮', children: [] },
  { id: 902, parentId: 900, label: '用户修改', type: 1, linkAddress: '', modelCode: 'sys:user:edit', icon: '', order: 2, status: 0, remark: '老库误标 res_type=1 的按钮', children: [] },
  { id: 903, parentId: 900, label: '用户失效', type: 1, linkAddress: '', modelCode: 'sys:user:disable', icon: '', order: 3, status: 0, remark: '老库误标 res_type=1 的按钮', children: [] },
  { id: 904, parentId: 900, label: '批量失效', type: 1, linkAddress: '', modelCode: 'sys:user:batchDisable', icon: '', order: 4, status: 0, remark: '老库误标 res_type=1 的按钮', children: [] },
  { id: 905, parentId: 900, label: '分配角色', type: 1, linkAddress: '', modelCode: 'sys:user:assignRole', icon: '', order: 5, status: 0, remark: '老库误标 res_type=1 的按钮', children: [] },
  { id: 906, parentId: 900, label: '用户新增', type: 1, linkAddress: '', modelCode: 'sys:user:add', icon: '', order: 6, status: 0, remark: '老库误标 res_type=1 的按钮', children: [] },
]

export function buildMockTree(items: SysMenuTreeNode[]): SysMenuTreeNode[] {
  const map = new Map<number, SysMenuTreeNode>()
  items.forEach((item) => {
    map.set(item.id, { ...item, children: [] })
  })

  const roots: SysMenuTreeNode[] = []
  map.forEach((node) => {
    if (!node.parentId || !map.has(node.parentId)) {
      roots.push(node)
    } else {
      map.get(node.parentId)!.children!.push(node)
    }
  })

  const sortNodes = (nodes: SysMenuTreeNode[]) => {
    nodes.sort((a, b) => (a.order || 0) - (b.order || 0) || a.id - b.id)
    nodes.forEach((n) => {
      if (n.children && n.children.length > 0) {
        sortNodes(n.children)
      }
    })
  }

  sortNodes(roots)
  return roots
}

export function handleMockSaveMenu(form: SysMenuForm): void {
  if (form.id) {
    const idx = mockResourceList.findIndex((i) => i.id === form.id)
    if (idx !== -1) {
      mockResourceList[idx] = {
        ...mockResourceList[idx],
        label: form.name,
        type: form.type,
        parentId: form.parentId,
        linkAddress: form.linkAddress,
        modelCode: form.modelCode,
        icon: form.icon,
        order: form.order ?? 1,
        status: form.status ?? 0,
        remark: form.remark,
        // 动态路由装配依赖这两列（见 router/dynamicRoutes.ts），mock 保存时必须一起落库，
        // 否则「菜单配置」改完组件路径，前端的表现和真实后端不一致。
        componentPath: form.componentPath,
        routeName: form.routeName,
      }
    }
  } else {
    const maxId = Math.max(...mockResourceList.map((i) => i.id), 9100)
    mockResourceList.push({
      id: maxId + 1,
      parentId: form.parentId,
      label: form.name,
      type: form.type,
      linkAddress: form.linkAddress,
      modelCode: form.modelCode,
      icon: form.icon,
      order: form.order ?? 1,
      status: form.status ?? 0,
      remark: form.remark,
      componentPath: form.componentPath,
      routeName: form.routeName,
      children: [],
    })
  }
}

export function handleMockDeleteMenu(id: number): void {
  const toDelete = new Set<number>()
  const collect = (curId: number) => {
    toDelete.add(curId)
    mockResourceList.filter((i) => i.parentId === curId).forEach((child) => collect(child.id))
  }
  collect(id)
  mockResourceList = mockResourceList.filter((i) => !toDelete.has(i.id))
}

export function handleMockCleanLegacy(): { updatedCount: number; message: string } {
  const legacyIds = [901, 902, 903, 904, 905, 906]
  let count = 0
  mockResourceList.forEach((item) => {
    if (legacyIds.includes(item.id)) {
      item.type = 3
      item.parentId = 8202
      item.icon = ''
      count++
    }
  })
  mockResourceList = mockResourceList.filter((i) => i.id !== 900)
  return { updatedCount: count, message: `已成功清洗规范化 ${count} 条历史按钮权限记录` }
}

export function handleMockSortMenu(items: SysMenuSortItem[]): void {
  if (!Array.isArray(items)) return
  items.forEach((item) => {
    const target = mockResourceList.find((i) => i.id === item.id)
    if (target) {
      if (item.order !== undefined) target.order = item.order
      if (item.parentId !== undefined) target.parentId = item.parentId
    }
  })
}
