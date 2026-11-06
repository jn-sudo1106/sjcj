<script setup lang="ts">
// 系统设置 → 用户权限设置 → 角色管理（SYS_ROLE / SYS_ROLE_2_RES / SYS_RESOURCE / sys_group_res）
// 左右分栏交互：
//   左侧：展示角色列表（支持角色搜索、新建、编辑、删除与内置角色保护）。
//   右侧：展示选中角色对应的两大维度配置（Tab 页签切换）：
//     - 菜单 tab：全量系统资源/菜单树勾选与授权保存（功能权限）；
//     - 数据组 tab：展示该角色关联的数据组、成员分布与数据权限范围配置（数据权限）。
//
// admin 为系统超级管理员角色：SysMenuService 对 admin 直接下发全量菜单、数据组维度也天然穿透，
// 角色本身（名称/描述/状态/菜单授权）没有任何可编辑的业务意义，因此整角色只读：
// 列表的编辑入口置灰 + 弹窗入口二次拦截 + 右侧详情区整块 inert（含页签在内一律点不动、
// 也不能用键盘聚焦），并隐藏菜单树勾选框、全选/全不选/保存按钮与数据组的跳转配置入口。
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type ElTree } from 'element-plus'
import {
  ArrowRight,
  Check,
  Connection,
  Delete,
  Edit,
  Folder,
  FolderOpened,
  Lock,
  Plus,
  Search,
  View,
} from '@element-plus/icons-vue'
import {
  addSysRole,
  assignRoleResources,
  deleteSysRole,
  getRoleResourceIds,
  getSysResourceTree,
  listSysRoles,
  updateSysRole,
  type SysResourceTreeNode,
  type SysRoleRow,
} from '@/api/role'
import { listGroupIds } from '@/api/groupRes'
import { getGroupSourceScope, type GroupSourceScope } from '@/api/groupSourceScope'
import { pagedSysUser, type SysUserRow } from '@/api/sysUser'
import { groupName, readGroupNames } from '@/utils/groupNames'
import { useAuthStore } from '@/stores/auth'

defineOptions({ name: 'RolePermissionTab' })

const router = useRouter()
const auth = useAuthStore()

// ---- 右侧当前激活 Tab（菜单 / 数据组） ----
const activeRightTab = ref<'menu' | 'dataGroup'>('menu')

// ---- 左侧：角色列表 ----
const roles = ref<SysRoleRow[]>([])
const loadingRoles = ref(false)
const searchKeyword = ref('')
const selectedRole = ref<SysRoleRow | null>(null)

const filteredRoles = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  if (!kw) return roles.value
  return roles.value.filter(
    (r) =>
      r.roleName.toLowerCase().includes(kw) ||
      (r.roleRemark && r.roleRemark.toLowerCase().includes(kw)),
  )
})

// ---- 右侧：菜单权限树 ----
const resourceTree = ref<SysResourceTreeNode[]>([])
const loadingTree = ref(false)
const savingPermissions = ref(false)
const treeRef = ref<InstanceType<typeof ElTree> | null>(null)
const isAllExpanded = ref(true)

// ---- 右侧：数据组 ----
export interface RoleGroupItem {
  groupId: number
  groupName: string
  /** 该组中属于当前选中角色的用户列表 */
  members: SysUserRow[]
  /** 组源数据权限概况（accept/reject 源数） */
  scopeSummary?: {
    acceptSources: number
    acceptDirs: number
    rejectSources: number
  }
}

const allGroupIds = ref<number[]>([])
const allUsers = ref<SysUserRow[]>([])
const loadingGroups = ref(false)
const groupSearchKey = ref('')
const scopeCache = reactive<Record<number, GroupSourceScope>>({})

// 数据组详情弹窗
const groupDetailDialogVisible = ref(false)
const viewingGroup = ref<RoleGroupItem | null>(null)
const viewingScope = ref<GroupSourceScope | null>(null)

// ---- 角色弹窗表单 ----
const dialogVisible = ref(false)
const dialogTitle = ref('新增角色')
const submittingRole = ref(false)
const roleForm = reactive({
  roleId: undefined as number | undefined,
  roleName: '',
  roleRemark: '',
  roleStatus: 0,
})

const isEditingRole = computed(() => roleForm.roleId !== undefined)

/** admin 为系统超级管理员角色（后端按角色名判定），该角色整体只读 */
function isAdminRole(role: Pick<SysRoleRow, 'roleName'> | null | undefined): boolean {
  return !!role && role.roleName.trim().toLowerCase() === 'admin'
}

const isAdminSelected = computed(() => isAdminRole(selectedRole.value))

onMounted(async () => {
  await Promise.all([loadTreeData(), loadRoles(), loadGroupAndUserData()])
})

async function loadTreeData() {
  loadingTree.value = true
  try {
    const res = await getSysResourceTree()
    resourceTree.value = Array.isArray(res) ? res : []
  } catch (e) {
    ElMessage.error(`获取权限资源树失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    loadingTree.value = false
  }
}

async function loadRoles(targetRoleId?: number) {
  loadingRoles.value = true
  try {
    const res = await listSysRoles()
    roles.value = Array.isArray(res) ? res : []

    // 默认高亮选中指定角色或第一个角色
    if (roles.value.length > 0) {
      const found = targetRoleId
        ? roles.value.find((r) => r.roleId === targetRoleId)
        : (selectedRole.value ? roles.value.find((r) => r.roleId === selectedRole.value?.roleId) : null)
      selectRole(found || roles.value[0]!)
    } else {
      selectedRole.value = null
    }
  } catch (e) {
    ElMessage.error(`获取角色列表失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    loadingRoles.value = false
  }
}

async function loadGroupAndUserData() {
  loadingGroups.value = true
  try {
    const [groupIds, userRes] = await Promise.all([
      listGroupIds().catch(() => [] as number[]),
      pagedSysUser({ limit: 1000 }).catch(() => ({ list: [], total: 0 })),
    ])
    allGroupIds.value = groupIds || []
    allUsers.value = userRes.list || []
  } catch (e) {
    console.error('加载数据组与用户数据失败:', e)
  } finally {
    loadingGroups.value = false
  }
}

async function selectRole(role: SysRoleRow) {
  selectedRole.value = role
  if (!role) return
  await loadRolePermissions(role.roleId)
}

async function loadRolePermissions(roleId: number) {
  loadingTree.value = true
  try {
    const ids = await getRoleResourceIds(roleId)
    await nextTick()
    if (treeRef.value) {
      const leafKeys = filterLeafKeys(resourceTree.value, new Set(ids || []))
      treeRef.value.setCheckedKeys(leafKeys)
    }
  } catch (e) {
    ElMessage.error(`获取角色已分配权限失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    loadingTree.value = false
  }
}

/** 递归提取已选的叶子节点 ID，防止父级全选覆盖 */
function filterLeafKeys(nodes: SysResourceTreeNode[], assignedIds: Set<number>): number[] {
  const result: number[] = []
  function dfs(list: SysResourceTreeNode[]) {
    for (const node of list) {
      if (!node.children || node.children.length === 0) {
        if (assignedIds.has(node.id)) {
          result.push(node.id)
        }
      } else {
        dfs(node.children)
      }
    }
  }
  dfs(nodes)
  return result
}

/** 展开/折叠全部节点 */
function toggleExpandAll() {
  isAllExpanded.value = !isAllExpanded.value
  if (!treeRef.value) return
  const nodes = treeRef.value.store._getAllNodes()
  for (const node of nodes) {
    node.expanded = isAllExpanded.value
  }
}

/** 全选/全不选权限 */
function toggleSelectAll(select: boolean) {
  if (!treeRef.value) return
  if (select) {
    const allIds: number[] = []
    function collectIds(list: SysResourceTreeNode[]) {
      for (const n of list) {
        allIds.push(n.id)
        if (n.children && n.children.length > 0) collectIds(n.children)
      }
    }
    collectIds(resourceTree.value)
    treeRef.value.setCheckedKeys(allIds)
  } else {
    treeRef.value.setCheckedKeys([])
  }
}

/** 保存当前角色的资源权限分配 */
async function handleSavePermissions() {
  if (!selectedRole.value) {
    ElMessage.warning('请先在左侧选择要授权的角色')
    return
  }
  if (isAdminSelected.value) {
    ElMessage.warning('admin 为系统超级管理员角色，不可编辑菜单权限')
    return
  }
  if (!treeRef.value) return

  savingPermissions.value = true
  try {
    const checkedKeys = treeRef.value.getCheckedKeys() as number[]
    const halfCheckedKeys = treeRef.value.getHalfCheckedKeys() as number[]
    const mergedIds = Array.from(new Set([...checkedKeys, ...halfCheckedKeys]))

    await assignRoleResources(selectedRole.value.roleId, mergedIds)
    ElMessage.success(`角色【${selectedRole.value.roleName}】菜单权限已成功保存`)

    await auth.fetchUserNav()
  } catch (e) {
    ElMessage.error(`保存权限失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    savingPermissions.value = false
  }
}

// ---- 数据组关联计算 ----
const roleGroupList = computed<RoleGroupItem[]>(() => {
  if (!selectedRole.value) return []
  const roleName = selectedRole.value.roleName
  const roleId = String(selectedRole.value.roleId)
  const localNames = readGroupNames()

  const keyword = groupSearchKey.value.trim().toLowerCase()

  return allGroupIds.value
    .map((gId) => {
      const name = localNames[String(gId)] || groupName(gId) || `用户组 ${gId}`
      // 找出属于该数据组且拥有当前角色的用户
      const members = allUsers.value.filter((u) => {
        if (u.groupId !== gId) return false
        if (u.roleNames?.split(',').includes(roleName)) return true
        if (u.roleIds?.split(',').includes(roleId)) return true
        return false
      })

      const cachedScope = scopeCache[gId]
      const scopeSummary = cachedScope
        ? {
            acceptSources: cachedScope.accept.sourceIds.length,
            acceptDirs: cachedScope.accept.dirIds.length,
            rejectSources: cachedScope.reject.sourceIds.length,
          }
        : undefined

      return {
        groupId: gId,
        groupName: name,
        members,
        scopeSummary,
      }
    })
    .filter((g) => {
      if (!keyword) return true
      return String(g.groupId).includes(keyword) || g.groupName.toLowerCase().includes(keyword)
    })
})

// 当切换到数据组 Tab 且选中了角色时，异步预取可见组的数据范围概况
watch(
  [activeRightTab, selectedRole],
  ([tab, role]) => {
    if (tab === 'dataGroup' && role) {
      void fetchVisibleScopes()
    }
  },
  { immediate: true },
)

async function fetchVisibleScopes() {
  const topGroups = allGroupIds.value.slice(0, 15)
  for (const gId of topGroups) {
    if (!scopeCache[gId]) {
      try {
        const scope = await getGroupSourceScope(gId)
        if (scope) scopeCache[gId] = scope
      } catch {
        // 忽略单项预取异常
      }
    }
  }
}

async function viewGroupScopeDetail(group: RoleGroupItem) {
  viewingGroup.value = group
  groupDetailDialogVisible.value = true
  if (scopeCache[group.groupId]) {
    viewingScope.value = scopeCache[group.groupId]
  } else {
    try {
      const scope = await getGroupSourceScope(group.groupId)
      scopeCache[group.groupId] = scope
      viewingScope.value = scope
    } catch (e) {
      ElMessage.error(`获取组 #${group.groupId} 数据范围失败`)
    }
  }
}

function navigateToDataPermission(groupId?: number) {
  groupDetailDialogVisible.value = false
  void router.replace({
    path: '/user-permission',
    query: { tab: 'data-permission', ...(groupId ? { groupId } : {}) },
  })
}

// ---- 角色 CRUD 弹窗 ----
function openAddRole() {
  dialogTitle.value = '新增角色'
  Object.assign(roleForm, {
    roleId: undefined,
    roleName: '',
    roleRemark: '',
    roleStatus: 0,
  })
  dialogVisible.value = true
}

function openEditRole(role: SysRoleRow) {
  if (isAdminRole(role)) {
    ElMessage.warning('admin 为系统超级管理员角色，不可编辑')
    return
  }
  dialogTitle.value = '编辑角色'
  Object.assign(roleForm, {
    roleId: role.roleId,
    roleName: role.roleName,
    roleRemark: role.roleRemark || '',
    roleStatus: role.roleStatus,
  })
  dialogVisible.value = true
}

async function handleSaveRole() {
  const name = roleForm.roleName.trim()
  if (!name) {
    ElMessage.warning('请输入角色名称')
    return
  }
  submittingRole.value = true
  try {
    if (isEditingRole.value) {
      await updateSysRole({
        roleId: roleForm.roleId,
        roleName: name,
        roleRemark: roleForm.roleRemark.trim(),
        roleStatus: roleForm.roleStatus,
      })
      ElMessage.success('角色更新成功')
      dialogVisible.value = false
      await loadRoles(roleForm.roleId)
    } else {
      const res = await addSysRole({
        roleName: name,
        roleRemark: roleForm.roleRemark.trim(),
        roleStatus: roleForm.roleStatus,
      })
      ElMessage.success('新增角色成功')
      dialogVisible.value = false
      const newRoleId = res.data
      await loadRoles(newRoleId)
    }
  } catch (e) {
    ElMessage.error(`保存角色失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    submittingRole.value = false
  }
}

async function handleDeleteRole(role: SysRoleRow) {
  if (role.isSys) {
    ElMessage.warning('系统内置角色不可删除')
    return
  }
  if (role.userCount > 0) {
    ElMessage.warning(`该角色仍绑定有 ${role.userCount} 名用户，请先调整用户角色`)
    return
  }
  try {
    await ElMessageBox.confirm(`确定要删除角色【${role.roleName}】吗？删除后将解除所有资源绑定且不可恢复。`, '确认删除', {
      type: 'warning',
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
    })
    await deleteSysRole(role.roleId)
    ElMessage.success('角色删除成功')
    await loadRoles()
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error(`删除失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

function getNodeTypeTag(type: number): { label: string; type: 'primary' | 'success' | 'warning' | 'info' | 'danger' } {
  switch (type) {
    case 0:
      return { label: '目录', type: 'info' }
    case 1:
      return { label: '菜单', type: 'primary' }
    case 2:
      return { label: 'Tab页', type: 'warning' }
    case 3:
      return { label: '按钮', type: 'success' }
    default:
      return { label: '资源', type: 'info' }
  }
}
</script>

<template>
  <div class="role-permission-layout" data-testid="settings-role-permission">
    <!-- 左侧：角色列表 -->
    <aside class="role-side-pane">
      <div class="pane-header">
        <div class="pane-title">
          <span>角色列表</span>
          <el-button type="primary" size="small" :icon="Plus" @click="openAddRole">新增角色</el-button>
        </div>
        <el-input
          v-model="searchKeyword"
          size="default"
          placeholder="搜索角色编码 / 描述..."
          clearable
          :prefix-icon="Search"
          class="role-search-input"
        />
      </div>

      <div v-loading="loadingRoles" class="role-list-scroll">
        <div
          v-for="r in filteredRoles"
          :key="r.roleId"
          class="role-card-item"
          :class="{ active: selectedRole?.roleId === r.roleId }"
          @click="selectRole(r)"
        >
          <div class="role-card-top">
            <span class="role-card-name">{{ r.roleName }}</span>
            <div class="role-card-tags">
              <el-tag v-if="r.isSys" size="small" type="info" effect="plain">内置</el-tag>
              <el-tag v-else size="small" type="primary" effect="plain">自定义</el-tag>
              <el-tag size="small" :type="r.roleStatus === 0 ? 'success' : 'danger'" effect="light">
                {{ r.roleStatus === 0 ? '正常' : '停用' }}
              </el-tag>
            </div>
          </div>
          <div class="role-card-desc" :title="r.roleRemark || '暂无描述'">
            {{ r.roleRemark || '暂无描述' }}
          </div>
          <div class="role-card-footer">
            <span class="role-user-count">已分配用户: <b>{{ r.userCount }}</b> 人</span>
            <div class="role-card-actions" @click.stop>
              <el-tooltip
                :content="isAdminRole(r) ? 'admin 为系统超级管理员角色，不可编辑' : '编辑角色'"
                placement="top"
              >
                <!-- disabled 按钮自身不派发鼠标事件，用 span 兜住 tooltip 的 hover -->
                <span class="role-action-trigger">
                  <el-button
                    link
                    type="primary"
                    size="small"
                    :icon="Edit"
                    :disabled="isAdminRole(r)"
                    data-testid="role-edit"
                    @click="openEditRole(r)"
                  />
                </span>
              </el-tooltip>
              <el-tooltip
                v-if="!r.isSys"
                :content="r.userCount > 0 ? `该角色仍有 ${r.userCount} 名关联用户，不可删除` : '删除角色'"
                placement="top"
              >
                <el-button
                  link
                  type="danger"
                  size="small"
                  :disabled="r.userCount > 0"
                  :icon="Delete"
                  @click="handleDeleteRole(r)"
                />
              </el-tooltip>
            </div>
          </div>
        </div>

        <el-empty v-if="!loadingRoles && filteredRoles.length === 0" description="未查找到匹配角色" :image-size="64" />
      </div>
    </aside>

    <!-- 右侧：选定角色的 菜单tab / 数据组tab；admin 整块只读且不可点击（含页签） -->
    <main class="role-detail-pane" :class="{ 'is-readonly': isAdminSelected }">
      <div class="role-detail-header">
        <div class="current-role-badge">
          <span class="label">当前角色：</span>
          <span v-if="selectedRole" class="role-highlight">
            【{{ selectedRole.roleName }}】
            <span class="sub-remark">{{ selectedRole.roleRemark || '' }}</span>
          </span>
          <span v-else class="role-none">请在左侧选择角色</span>
        </div>
      </div>

      <!-- admin：整块只读提示（放在 inert 区域之外，保证始终可读） -->
      <div v-if="isAdminSelected" class="role-readonly-band" data-testid="role-readonly-band">
        <el-icon :size="14"><Lock /></el-icon>
        <span>admin 为系统超级管理员角色，右侧区域整体只读：页签与配置均不可点击</span>
      </div>

      <!-- inert：admin 时右侧（含页签）既不可点击也不可聚焦 -->
      <el-tabs
        v-model="activeRightTab"
        class="role-right-tabs"
        :class="{ 'is-inert': isAdminSelected }"
        :inert="isAdminSelected ? '' : undefined"
        :data-testid="isAdminSelected ? 'role-readonly-tabs' : undefined"
      >
        <!-- 1. 菜单 tab -->
        <el-tab-pane label="菜单" name="menu">
          <div class="tab-pane-container">
            <div class="tree-pane-header">
              <span class="pane-subtitle">系统功能菜单与页面Tab权限</span>
              <div class="tree-actions">
                <el-button size="small" :icon="isAllExpanded ? Folder : FolderOpened" @click="toggleExpandAll">
                  {{ isAllExpanded ? '全部折叠' : '全部展开' }}
                </el-button>
                <!-- admin 只读：勾选/全选/授权保存整体不出现 -->
                <template v-if="!isAdminSelected">
                  <el-button size="small" :disabled="!selectedRole" @click="toggleSelectAll(true)">全选</el-button>
                  <el-button size="small" :disabled="!selectedRole" @click="toggleSelectAll(false)">全不选</el-button>
                  <el-button
                    type="primary"
                    size="small"
                    :icon="Check"
                    :loading="savingPermissions"
                    :disabled="!selectedRole"
                    @click="handleSavePermissions"
                  >
                    保存菜单权限
                  </el-button>
                </template>
              </div>
            </div>

            <div v-loading="loadingTree" class="tree-container">
              <el-tree
                ref="treeRef"
                :data="resourceTree"
                :show-checkbox="!isAdminSelected"
                node-key="id"
                :default-expand-all="true"
                :expand-on-click-node="false"
                :check-strictly="false"
                :props="{ label: 'label', children: 'children' }"
                class="custom-permission-tree"
              >
                <template #default="{ data }">
                  <div class="tree-node-content">
                    <el-tag size="small" :type="getNodeTypeTag(data.type).type" effect="light" class="node-type-tag">
                      {{ getNodeTypeTag(data.type).label }}
                    </el-tag>
                    <span class="node-label">{{ data.label }}</span>
                    <span v-if="data.linkAddress" class="node-path" :title="'对应路由: ' + data.linkAddress">
                      {{ data.linkAddress }}
                    </span>
                  </div>
                </template>
              </el-tree>
            </div>
          </div>
        </el-tab-pane>

        <!-- 2. 数据组 tab -->
        <el-tab-pane label="数据组" name="dataGroup">
          <div class="tab-pane-container data-group-pane">
            <div class="data-group-toolbar">
              <div class="toolbar-left">
                <el-input
                  v-model="groupSearchKey"
                  size="small"
                  placeholder="搜索数据组 ID / 组名称..."
                  clearable
                  :prefix-icon="Search"
                  style="width: 240px"
                />
              </div>
              <div v-if="!isAdminSelected" class="toolbar-right">
                <el-button size="small" :icon="Connection" @click="navigateToDataPermission()">
                  前往数据权限配置页
                </el-button>
              </div>
            </div>

            <!-- 超管特权提示 / 普通角色说明 -->
            <div v-if="isAdminSelected" class="group-alert-box">
              <el-alert
                title="超级管理员特权提示"
                description="admin 为系统超级管理员角色，系统底层天然穿透所有数据权限限制，拥有全平台所有数据组与采集源的全部访问与操作权限。"
                type="success"
                :closable="false"
                show-icon
              />
            </div>
            <div v-else class="group-alert-box">
              <el-alert
                title="数据组权限说明"
                description="数据组（GROUP_ID）控制采集源、分类目录及资产范围的数据可见性。下方列出各数据组中已分配该角色的成员及对应组的数据权限规则。"
                type="info"
                :closable="false"
                show-icon
              />
            </div>

            <!-- 数据组表格 -->
            <div v-loading="loadingGroups" class="group-table-wrap">
              <el-table :data="roleGroupList" stripe size="small" style="width: 100%" height="100%">
                <el-table-column prop="groupId" label="数据组 ID" width="110" align="center">
                  <template #default="{ row }">
                    <span class="group-id-badge">#{{ row.groupId }}</span>
                  </template>
                </el-table-column>
                <el-table-column prop="groupName" label="数据组名称" min-width="150" show-overflow-tooltip>
                  <template #default="{ row }">
                    <span class="group-name-text">{{ row.groupName }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="该角色在组内成员" min-width="180">
                  <template #default="{ row }">
                    <div v-if="row.members.length > 0" class="member-tag-list">
                      <el-tag
                        v-for="u in row.members.slice(0, 3)"
                        :key="u.userId"
                        size="small"
                        type="info"
                        effect="plain"
                      >
                        {{ u.userName || u.userLoginName }}
                      </el-tag>
                      <span v-if="row.members.length > 3" class="member-more-tag">
                        +{{ row.members.length - 3 }}人
                      </span>
                    </div>
                    <span v-else class="text-muted">暂无该角色用户</span>
                  </template>
                </el-table-column>
                <el-table-column label="数据权限规则概况" min-width="160">
                  <template #default="{ row }">
                    <div v-if="row.scopeSummary" class="scope-summary-text">
                      <span v-if="row.scopeSummary.acceptSources > 0 || row.scopeSummary.acceptDirs > 0" class="text-success">
                        已授权 {{ row.scopeSummary.acceptDirs }} 目录 / {{ row.scopeSummary.acceptSources }} 源
                      </span>
                      <span v-else class="text-muted">默认全可见</span>
                      <span v-if="row.scopeSummary.rejectSources > 0" class="text-danger">
                        (排除 {{ row.scopeSummary.rejectSources }} 源)
                      </span>
                    </div>
                    <span v-else class="text-muted">未限制</span>
                  </template>
                </el-table-column>
                <el-table-column label="操作" :width="isAdminSelected ? 110 : 170" align="center" fixed="right">
                  <template #default="{ row }">
                    <el-button link type="primary" size="small" :icon="View" @click="viewGroupScopeDetail(row)">
                      查看范围
                    </el-button>
                    <!-- admin 只读：不提供跳转到数据权限配置的写入口 -->
                    <el-button
                      v-if="!isAdminSelected"
                      link
                      type="primary"
                      size="small"
                      :icon="ArrowRight"
                      @click="navigateToDataPermission(row.groupId)"
                    >
                      配置规则
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </main>

    <!-- 角色新增/编辑弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="460px"
      destroy-on-close
      align-center
    >
      <el-form label-width="84px" class="role-form">
        <el-form-item label="角色名称" required>
          <el-input
            v-model="roleForm.roleName"
            placeholder="例如: analyst / dev_ops"
            :disabled="isEditingRole && selectedRole?.isSys"
          />
          <span v-if="isEditingRole && selectedRole?.isSys" class="form-tip">
            系统内置角色名称不可变更
          </span>
        </el-form-item>
        <el-form-item label="角色描述">
          <el-input
            v-model="roleForm.roleRemark"
            type="textarea"
            :rows="3"
            placeholder="简述该角色的职责与业务范围"
          />
        </el-form-item>
        <el-form-item label="角色状态">
          <el-radio-group v-model="roleForm.roleStatus" :disabled="isEditingRole && roleForm.roleName === 'admin'">
            <el-radio :value="0">启用</el-radio>
            <el-radio :value="1">停用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submittingRole" @click="handleSaveRole">保存</el-button>
      </template>
    </el-dialog>

    <!-- 数据组数据范围明细弹窗 -->
    <el-dialog
      v-model="groupDetailDialogVisible"
      :title="`数据组 #${viewingGroup?.groupId}（${viewingGroup?.groupName}）数据范围`"
      width="560px"
      destroy-on-close
      align-center
    >
      <div v-if="viewingGroup" class="group-detail-dialog-body">
        <div class="detail-item">
          <label>当前角色成员：</label>
          <div class="member-chip-list">
            <el-tag
              v-for="u in viewingGroup.members"
              :key="u.userId"
              size="small"
              type="info"
            >
              {{ u.userName }} ({{ u.userLoginName }})
            </el-tag>
            <span v-if="viewingGroup.members.length === 0" class="text-muted">本组暂无成员分配该角色</span>
          </div>
        </div>

        <el-divider />

        <div class="detail-item">
          <label>可见范围（ACCEPT）：</label>
          <div class="scope-info-box">
            <div>
              <b>已选目录 ID ({{ viewingScope?.accept.dirIds.length ?? 0 }} 个)：</b>
              <span>{{ viewingScope?.accept.dirIds.join(', ') || '未单独限制目录' }}</span>
            </div>
            <div style="margin-top: 6px">
              <b>已选单个源 ID ({{ viewingScope?.accept.sourceIds.length ?? 0 }} 个)：</b>
              <span>{{ viewingScope?.accept.sourceIds.join(', ') || '未单独限制源' }}</span>
            </div>
          </div>
        </div>

        <div class="detail-item" style="margin-top: 14px">
          <label>排除范围（REJECT）：</label>
          <div class="scope-info-box">
            <div>
              <b>排除目录 ID ({{ viewingScope?.reject.dirIds.length ?? 0 }} 个)：</b>
              <span>{{ viewingScope?.reject.dirIds.join(', ') || '无' }}</span>
            </div>
            <div style="margin-top: 6px">
              <b>排除单个源 ID ({{ viewingScope?.reject.sourceIds.length ?? 0 }} 个)：</b>
              <span>{{ viewingScope?.reject.sourceIds.join(', ') || '无' }}</span>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="groupDetailDialogVisible = false">关闭</el-button>
        <!-- admin 只读：不提供去配置规则的写入口 -->
        <el-button v-if="!isAdminSelected" type="primary" @click="navigateToDataPermission(viewingGroup?.groupId)">
          去配置完整规则
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.role-permission-layout {
  display: flex;
  height: 100%;
  gap: 16px;
  min-height: 0;
  overflow: hidden;
}

/* 左侧栏面板 */
.role-side-pane {
  width: 310px;
  min-width: 290px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.pane-header {
  padding: 14px 16px;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: #fafafa;
}

.pane-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
}

.role-search-input {
  width: 100%;
}

.role-list-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.role-card-item {
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 12px;
  cursor: pointer;
  background: #ffffff;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.role-card-item:hover {
  border-color: #93c5fd;
  box-shadow: 0 2px 6px rgba(59, 130, 246, 0.08);
}

.role-card-item.active {
  border-color: #3b82f6;
  background: #eff6ff;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.12);
}

.role-card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.role-card-name {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}

.role-card-tags {
  display: flex;
  gap: 4px;
}

.role-card-desc {
  font-size: 12px;
  color: #64748b;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-card-footer {
  margin-top: 4px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #94a3b8;
}

.role-user-count b {
  color: #334155;
}

.role-card-actions {
  display: flex;
  gap: 2px;
}

.role-card-actions .role-action-trigger {
  display: inline-flex;
  align-items: center;
}

/* 右侧主面板 */
.role-detail-pane {
  flex: 1;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.role-detail-header {
  padding: 12px 18px;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #fafafa;
}

.current-role-badge {
  display: flex;
  align-items: center;
  font-size: 13px;
  color: #64748b;
}

.current-role-badge .role-highlight {
  font-size: 14px;
  font-weight: 600;
  color: #2563eb;
}

.current-role-badge .sub-remark {
  font-size: 12px;
  color: #64748b;
  font-weight: normal;
  margin-left: 4px;
}

.current-role-badge .role-none {
  color: #94a3b8;
  font-style: italic;
}

/* admin 只读横幅：在 inert 区域之外，说明为什么整块点不动 */
.role-readonly-band {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 16px 0;
  padding: 6px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: #64748b;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

/* inert 兜底：老浏览器不支持 inert 时，右侧同样不接受鼠标交互；整体压暗提示不可操作 */
.role-right-tabs.is-inert {
  pointer-events: none;
  user-select: none;
  opacity: 0.72;
}

/* 右侧子 Tabs */
.role-right-tabs {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0 16px;
}

.role-right-tabs :deep(.el-tabs__header) {
  margin: 0 0 10px 0;
}

.role-right-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.role-right-tabs :deep(.el-tab-pane) {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.tab-pane-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* 菜单 Tab 树形工具栏 */
.tree-pane-header {
  padding: 8px 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.pane-subtitle {
  font-size: 13px;
  font-weight: 500;
  color: #475569;
}

.tree-actions {
  display: flex;
  gap: 8px;
}

.tree-container {
  flex: 1;
  overflow-y: auto;
  padding: 12px 4px;
}

.custom-permission-tree :deep(.el-tree-node__content) {
  height: 34px;
  border-radius: 4px;
}

.custom-permission-tree :deep(.el-tree-node__content:hover) {
  background: #f8fafc;
}

.tree-node-content {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.node-type-tag {
  font-size: 11px;
  padding: 0 4px;
  height: 20px;
  line-height: 18px;
}

.node-label {
  font-weight: 500;
  color: #1e293b;
}

.node-code {
  font-size: 12px;
  color: #94a3b8;
  font-family: monospace;
  background: #f1f5f9;
  padding: 1px 6px;
  border-radius: 4px;
}

.node-path {
  font-size: 11px;
  color: #a1a1aa;
}

/* 数据组 Tab 样式 */
.data-group-pane {
  gap: 10px;
}

.data-group-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0 2px 0;
}

.group-alert-box {
  margin-bottom: 4px;
}

.group-table-wrap {
  flex: 1;
  min-height: 0;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  overflow: hidden;
}

.group-id-badge {
  font-family: monospace;
  font-weight: 600;
  color: #3b82f6;
  background: #eff6ff;
  padding: 2px 6px;
  border-radius: 4px;
}

.group-name-text {
  font-weight: 500;
  color: #1e293b;
}

.member-tag-list {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.member-more-tag {
  font-size: 11px;
  color: #64748b;
  background: #f1f5f9;
  padding: 1px 4px;
  border-radius: 3px;
}

.scope-summary-text {
  font-size: 12px;
}

.text-success { color: #16a34a; }
.text-danger { color: #dc2626; }
.text-muted { color: #94a3b8; font-size: 12px; }

/* 弹窗样式 */
.form-tip {
  font-size: 12px;
  color: #94a3b8;
  margin-top: 4px;
}

.group-detail-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
}

.detail-item label {
  font-weight: 600;
  color: #334155;
  display: block;
  margin-bottom: 6px;
}

.member-chip-list {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.scope-info-box {
  background: #f8fafc;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
  font-size: 12px;
  color: #475569;
}
</style>
