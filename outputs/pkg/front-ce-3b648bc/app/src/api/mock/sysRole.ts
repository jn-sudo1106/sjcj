// 角色与权限管理及动态菜单 Mock
import type { SysRoleRow, SysResourceTreeNode } from '../role'
import type { UserNavData } from '../menu'

interface MockRole {
  roleId: number
  roleName: string
  roleRemark: string
  roleStatus: number
  isSys: boolean
  userCount: number
  createTime: string
  modifierTime: string
}

let rolesStore: MockRole[] = [
  { roleId: 57, roleName: 'admin', roleRemark: '超级管理员（系统内置）', roleStatus: 0, isSys: true, userCount: 1, createTime: '2024-01-01 00:00:00', modifierTime: '2024-01-01 00:00:00' },
  { roleId: 52, roleName: 'read', roleRemark: '只读用户（系统内置）', roleStatus: 0, isSys: true, userCount: 3, createTime: '2024-01-01 00:00:00', modifierTime: '2024-01-01 00:00:00' },
  { roleId: 60, roleName: 'analyst', roleRemark: '数据分析专员', roleStatus: 0, isSys: false, userCount: 2, createTime: '2026-11-01 10:00:00', modifierTime: '2026-11-02 11:00:00' },
]

const roleResourceBindings: Record<number, number[]> = {
  57: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  52: [1, 2, 6, 7, 8, 9, 10],
  60: [1, 6, 7, 8],
}

let nextRoleId = 100

export function mockSysRoleList(): SysRoleRow[] {
  return rolesStore.map((r) => ({ ...r }))
}

export function mockSysRoleAdd(params?: Record<string, unknown>) {
  const roleName = String(params?.roleName ?? '').trim()
  const roleRemark = String(params?.roleRemark ?? '').trim()
  if (!roleName) throw new Error('角色名称不能为空')
  if (rolesStore.some((r) => r.roleName === roleName)) throw new Error(`角色已存在: ${roleName}`)
  const newRole: MockRole = {
    roleId: nextRoleId++,
    roleName,
    roleRemark,
    roleStatus: 0,
    isSys: false,
    userCount: 0,
    createTime: new Date().toISOString().replace('T', ' ').slice(0, 19),
    modifierTime: new Date().toISOString().replace('T', ' ').slice(0, 19),
  }
  rolesStore.push(newRole)
  return { ok: true, message: '新增角色成功', data: newRole.roleId }
}

export function mockSysRoleUpdate(params?: Record<string, unknown>) {
  const roleId = Number(params?.roleId)
  const role = rolesStore.find((r) => r.roleId === roleId)
  if (!role) throw new Error('角色不存在')
  if (params?.roleName) {
    const newName = String(params.roleName).trim()
    if (!role.isSys && newName !== role.roleName && rolesStore.some((r) => r.roleName === newName)) {
      throw new Error(`角色名已存在: ${newName}`)
    }
    if (!role.isSys) role.roleName = newName
  }
  if (params?.roleRemark !== undefined) role.roleRemark = String(params.roleRemark)
  if (params?.roleStatus !== undefined) {
    if (role.roleName === 'admin' && Number(params.roleStatus) === 1) throw new Error('超级管理员角色不可禁用')
    role.roleStatus = Number(params.roleStatus)
  }
  role.modifierTime = new Date().toISOString().replace('T', ' ').slice(0, 19)
  return { ok: true, message: '修改角色成功' }
}

export function mockSysRoleDelete(params?: Record<string, unknown>) {
  const roleId = Number(params?.roleId)
  const role = rolesStore.find((r) => r.roleId === roleId)
  if (!role) return { ok: true, message: '角色已删除' }
  if (role.isSys) throw new Error('系统内置角色不可删除')
  if (role.userCount > 0) throw new Error(`该角色下仍绑定有 ${role.userCount} 名用户，无法删除`)
  rolesStore = rolesStore.filter((r) => r.roleId !== roleId)
  delete roleResourceBindings[roleId]
  return { ok: true, message: '删除角色成功' }
}

const RESOURCE_TREE_SEED: SysResourceTreeNode[] = [
  {
    id: 1, parentId: 0, label: '首页', modelCode: 'group:home', level: 1, type: 0, order: 1,
    children: [
      { id: 2, parentId: 1, label: '采集资产总览', modelCode: 'overview', linkAddress: '/overview', level: 2, type: 1, order: 1, children: [] }
    ]
  },
  {
    id: 3, parentId: 0, label: '源工作区', modelCode: 'group:assets', level: 1, type: 0, order: 2,
    children: [
      { id: 4, parentId: 3, label: '源管理', modelCode: 'collect', linkAddress: '/collect', level: 2, type: 1, order: 1, children: [] }
    ]
  },
  {
    id: 5, parentId: 0, label: '流程与规则', modelCode: 'group:config', level: 1, type: 0, order: 3,
    children: [
      { id: 6, parentId: 5, label: '流程中心', modelCode: 'flows', linkAddress: '/flows', level: 2, type: 1, order: 1, children: [] },
      { id: 7, parentId: 5, label: '规则资产', modelCode: 'rules', linkAddress: '/rules', level: 2, type: 1, order: 2, children: [] },
      { id: 8, parentId: 5, label: '指标中心', modelCode: 'metrics', linkAddress: '/metrics', level: 2, type: 1, order: 3, children: [] },
    ]
  },
  {
    id: 9, parentId: 0, label: '全局数据', modelCode: 'group:ops', level: 1, type: 0, order: 4,
    children: [
      { id: 10, parentId: 9, label: '数据中心', modelCode: 'data', linkAddress: '/data', level: 2, type: 1, order: 1, children: [] },
      { id: 11, parentId: 9, label: '文件中心', modelCode: 'files', linkAddress: '/files', level: 2, type: 1, order: 2, children: [] },
    ]
  },
  {
    id: 12, parentId: 0, label: '运行与监控', modelCode: 'group:tools', level: 1, type: 0, order: 5,
    children: [
      { id: 13, parentId: 12, label: '任务中心', modelCode: 'tasks', linkAddress: '/tasks', level: 2, type: 1, order: 1, children: [] },
      { id: 14, parentId: 12, label: '数据同步', modelCode: 'sync', linkAddress: '/sync', level: 2, type: 1, order: 2, children: [] },
      { id: 15, parentId: 12, label: '监控中心', modelCode: 'monitor', linkAddress: '/monitor', level: 2, type: 1, order: 3, children: [] },
    ]
  },
  {
    id: 16, parentId: 0, label: '系统管理', modelCode: 'group:settings', level: 1, type: 0, order: 6,
    children: [
      { id: 17, parentId: 16, label: '系统设置', modelCode: 'settings', linkAddress: '/settings', level: 2, type: 1, order: 1, children: [] },
      {
        id: 18, parentId: 16, label: '用户权限设置', modelCode: 'user-permission', linkAddress: '/user-permission', level: 2, type: 1, order: 2,
        children: [
          { id: 19, parentId: 18, label: '角色权限管理', modelCode: 'settings:roles', level: 3, type: 2, order: 1, children: [] },
          { id: 20, parentId: 18, label: '用户管理', modelCode: 'settings:users', level: 3, type: 2, order: 2, children: [] },
          { id: 21, parentId: 18, label: '数据权限设置', modelCode: 'settings:dataPermission', level: 3, type: 2, order: 3, children: [] },
        ]
      }
    ]
  }
]

export function mockSysResourceTree(): SysResourceTreeNode[] {
  return JSON.parse(JSON.stringify(RESOURCE_TREE_SEED))
}

export function mockRoleResourceIds(params?: Record<string, unknown>): number[] {
  const roleId = Number(params?.roleId)
  return roleResourceBindings[roleId] ?? []
}

export function mockAssignRoleResources(params?: Record<string, unknown>) {
  const roleId = Number(params?.roleId)
  const resourceIds = (params?.resourceIds as number[]) ?? []
  roleResourceBindings[roleId] = [...resourceIds]
  return { ok: true, message: '保存角色资源分配成功' }
}

export function mockUserNav(): UserNavData {
  // 字段与后端 sys/menu/user-nav 契约 1:1：componentPath / routeName 就是「菜单配置」页维护的
  // component_path / route_name，动态路由装配以它们为准（见 router/dynamicRoutes.ts）。
  return {
    permissions: [
      'overview', 'collect', 'flows', 'rules', 'metrics', 'data', 'files', 'tasks', 'sync', 'monitor',
      'base-config', 'template-config', 'system-config', 'auxiliary-tool', 'settings',
      'settings:roles', 'settings:users', 'settings:dataPermission'
    ],
    menuGroups: [
      {
        groupKey: 'home', groupLabel: '首页', order: 1,
        items: [{
          id: 2, key: 'overview', label: '采集资产总览', path: '/overview', order: 1,
          componentPath: 'views/Overview/index.vue', routeName: 'Overview',
        }]
      },
      {
        groupKey: 'assets', groupLabel: '源工作区', order: 2,
        items: [{
          id: 4, key: 'collect', label: '源管理', path: '/collect', order: 1,
          componentPath: 'views/CollectAssets/index.vue', routeName: 'Collect',
          // 页内 tab（sys_menu menu_type=2）与后端 V3.6.0 种子数据一致
          tabs: [
            { id: 2101, key: 'source', label: '系统目录', permission: 'collect', order: 1, componentPath: 'views/CollectAssets/SourceTab.vue' },
            { id: 2102, key: 'personal', label: '我的分组', permission: 'collect', order: 2, componentPath: 'views/Settings/SourceGroupTab.vue' },
            { id: 2103, key: 'views', label: '我的视图', permission: 'collect', order: 3, componentPath: 'views/CollectAssets/MyViews.vue' },
            { id: 2104, key: 'favorite', label: '我的收藏', permission: 'collect', order: 4, componentPath: 'views/CollectAssets/SourceTab.vue' },
            { id: 2105, key: 'recent', label: '最近打开', permission: 'collect', order: 5, componentPath: 'views/CollectAssets/SourceTab.vue' },
          ],
        }]
      },
      {
        groupKey: 'config', groupLabel: '流程与规则', order: 3,
        items: [
          { id: 6, key: 'flows', label: '流程中心', path: '/flows', order: 1, componentPath: 'views/FlowCenter/index.vue', routeName: 'Flows' },
          {
            id: 7, key: 'rules', label: '规则资产', path: '/rules', order: 2,
            componentPath: 'views/RuleAssets/index.vue', routeName: 'Rules',
            tabs: [
              { id: 3201, key: 'rule', label: '规则', permission: 'rules', order: 1, componentPath: 'views/RuleAssets/RuleGroupPanel.vue' },
              { id: 3202, key: 'param', label: '参数中心', permission: 'rules', order: 2, componentPath: 'views/RuleAssets/ParamTab.vue' },
            ],
          },
          {
            id: 8, key: 'metrics', label: '指标中心', path: '/metrics', order: 3,
            componentPath: 'views/MetricCenter/index.vue', routeName: 'Metrics',
            tabs: [
              { id: 3301, key: 'indicatorDataset', label: '指标数据集', permission: 'metrics', order: 1, componentPath: 'views/MetricCenter/indicatorDataset/index.vue' },
              { id: 3302, key: 'indicatorsList', label: '指标列表', permission: 'metrics', order: 2, componentPath: 'views/MetricCenter/indicatorsList/index.vue' },
              { id: 3303, key: 'indicatorsResult', label: '指标结果', permission: 'metrics', order: 3, componentPath: 'views/MetricCenter/indicatorsResult/index.vue' },
            ],
          },
        ]
      },
      {
        groupKey: 'ops', groupLabel: '全局数据', order: 4,
        items: [
          {
            id: 10, key: 'data', label: '数据中心', path: '/data', order: 1,
            componentPath: 'views/DataView/index.vue', routeName: 'Data',
            tabs: [
              { id: 4101, key: 'query', label: '数据查询', permission: 'data', order: 1, componentPath: 'views/DataView/DataQueryTab.vue' },
              { id: 4102, key: 'entry', label: '表 ID 列表', permission: 'data', order: 2, componentPath: 'views/DataView/EntryTab.vue' },
            ],
          },
          { id: 11, key: 'files', label: '文件中心', path: '/files', order: 2, componentPath: 'views/FileCenter/index.vue', routeName: 'Files' },
        ]
      },
      {
        groupKey: 'tools', groupLabel: '运行与监控', order: 5,
        items: [
          {
            id: 13, key: 'tasks', label: '任务中心', path: '/tasks', order: 1,
            componentPath: 'views/RunRecords/index.vue', routeName: 'Tasks',
            tabs: [
              { id: 5101, key: 'collection', label: '采集任务', permission: 'tasks', order: 1, componentPath: 'views/FlowCanvas/result/TaskView.vue' },
              { id: 5102, key: 'code-generation', label: '代码生成', permission: 'tasks', order: 2, componentPath: 'views/RunRecords/CodeGenerationTasks.vue' },
            ],
          },
          {
            id: 14, key: 'sync', label: '数据同步', path: '/sync', order: 2,
            componentPath: 'views/DataSync/index.vue', routeName: 'Sync',
            tabs: [
              { id: 5201, key: 'tasks', label: '同步任务', permission: 'sync', order: 1, componentPath: 'views/DataSync/TaskListTab.vue' },
              { id: 5202, key: 'logs', label: '同步日志', permission: 'sync', order: 2, componentPath: 'views/DataSync/LogsTab.vue' },
              { id: 5203, key: 'sql', label: 'SQL 执行', permission: 'sync', order: 3, componentPath: 'views/DataSync/SqlTaskTab.vue' },
              { id: 5204, key: 'table', label: '建表 SQL', permission: 'sync', order: 4, componentPath: 'views/DataSync/SqlTaskTab.vue' },
              { id: 5205, key: 'connections', label: '环境配置', permission: 'sync', order: 5, componentPath: 'views/DataSync/ConnectionsTab.vue' },
            ],
          },
          {
            id: 15, key: 'monitor', label: '监控中心', path: '/monitor', order: 3,
            componentPath: 'views/Monitor/index.vue', routeName: 'Monitor',
            tabs: [
              { id: 5301, key: 'sourceCheck', label: '数据源告警', permission: 'monitor', order: 1, componentPath: 'views/Monitor/sourceCheck/index.vue' },
              { id: 5302, key: 'sourceIssues', label: '源问题', permission: 'monitor', order: 2, componentPath: 'views/Monitor/sourceIssues/SourceIssuesView.vue' },
              { id: 5303, key: 'queueCheck', label: '队列告警', permission: 'monitor', order: 3, componentPath: 'views/Monitor/queueCheck/index.vue' },
              { id: 5304, key: 'commJob', label: '自定义告警', permission: 'monitor', order: 4, componentPath: 'views/Monitor/commJob/index.vue' },
              { id: 5305, key: 'taskList', label: '任务实例', permission: 'monitor', order: 5, componentPath: 'views/Monitor/taskList/index.vue' },
              { id: 5306, key: 'taskStat', label: '任务统计', permission: 'monitor', order: 6, componentPath: 'views/Monitor/taskStat/index.vue' },
            ],
          },
        ]
      },
      {
        groupKey: 'settings', groupLabel: '系统管理', order: 6,
        items: [
          {
            id: 17, key: 'settings', label: '系统设置', path: '/settings', permission: 'settings', order: 1,
            componentPath: 'views/Settings/index.vue', routeName: 'Settings',
            tabs: [
              { id: 8101, key: 'node-type', label: '节点类型', permission: 'settings:nodeType', order: 1, componentPath: 'views/Settings/NodeTypeTab.vue' },
              { id: 8102, key: 'category', label: '分类目录', permission: 'settings:category', order: 2, componentPath: 'views/Settings/CategoryTab.vue' },
              { id: 8103, key: 'code-servers', label: '代码生成服务器', permission: 'settings:nodeType', order: 3, componentPath: 'views/Settings/CodeGenerationServersTab.vue' },
              { id: 8104, key: 'runners', label: '服务器', permission: 'settings:runners', order: 4, componentPath: 'views/Settings/ServerConfigurationsTab.vue' },
              { id: 8105, key: 'processors', label: '处理机', permission: 'settings:assignments', order: 5, componentPath: 'views/Settings/ProcessorProcessesTab.vue' },
              { id: 8106, key: 'code-repos', label: '代码仓库', permission: 'settings:releases', order: 6, componentPath: 'views/Settings/CodeRepositoryTab.vue' },
              { id: 8107, key: 'directory-layout', label: '部署配置', permission: 'settings:releases', order: 7, componentPath: 'views/Settings/DirectoryLayoutTab.vue' },
              { id: 8108, key: 'deployment-resources', label: '部署资源', permission: 'settings:assignments', order: 8, componentPath: 'views/Settings/DeploymentResourcesTab.vue' },
              { id: 8109, key: 'runtime-logs', label: '运行日志', permission: 'settings:assignments', order: 9, componentPath: 'views/Settings/RuntimeLogsTab.vue' },
              { id: 8110, key: 'releases', label: '程序版本', permission: 'settings:releases', order: 10, componentPath: 'views/Settings/ProgramVersionsTab.vue' },
            ],
          },
          {
            id: 18, key: 'user-permission', label: '用户权限设置', path: '/user-permission', permission: 'settings', order: 2,
            componentPath: 'views/Settings/UserPermission/index.vue', routeName: 'UserPermission',
            // 顺序与后端种子数据一致：数据权限设置 → 用户管理 → 角色权限管理
            tabs: [
              { id: 8201, key: 'data-permission', label: '数据权限设置', permission: 'settings:dataPermission', order: 1, componentPath: 'views/Settings/DataPermissionTab.vue' },
              { id: 8202, key: 'users', label: '用户管理', permission: 'settings:users', order: 2, componentPath: 'views/Settings/UserManagementTab.vue' },
              { id: 8203, key: 'roles', label: '角色权限管理', permission: 'settings:roles', order: 3, componentPath: 'views/Settings/UserPermission/RolePermissionTab.vue' },
            ]
          }
        ]
      }
    ]
  }
}
