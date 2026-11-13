// 角色与权限管理（SYS_ROLE / SYS_ROLE_2_RES / SYS_RESOURCE）—— 系统设置 → 用户权限设置 → 角色权限管理
// 后端契约：com.vanv.sys.controller.SysRoleAdminController，路径前缀 /api/v1/sys-role（bee-config）
import { request } from './client'
import type { Ack } from './types/common'

export interface RoleAck extends Ack {
  success?: boolean
  code?: string
  msg?: string
  data?: unknown
}

export interface SysRoleRow {
  roleId: number
  roleName: string
  roleRemark?: string
  roleStatus: number
  isSys: boolean
  userCount: number
  createTime?: string
  modifierTime?: string
}

export type SysRoleForm = {
  roleId?: number
  roleName: string
  roleRemark?: string
  roleStatus?: number
}

export interface SysResourceTreeNode {
  id: number
  parentId: number
  label: string
  modelCode: string
  linkAddress?: string
  level: number
  /** 0-目录(DIR), 1-菜单(MENU), 2-页内标签(TAB), 3-按钮(BUTTON) */
  type: number
  icon?: string
  order: number
  remark?: string
  children?: SysResourceTreeNode[]
}

export interface AssignRoleForm {
  roleId: number
  resourceIds: number[]
}

const EP = {
  list: 'sys-role/list',
  add: 'sys-role/add',
  update: 'sys-role/update',
  delete: 'sys-role/delete',
  resourceTree: 'sys-role/resource-tree',
  resourceIds: 'sys-role/resource-ids',
  assignResources: 'sys-role/assign-resources',
} as const

/**
 * 获取全量角色列表
 */
export function listSysRoles(): Promise<SysRoleRow[]> {
  return request<SysRoleRow[]>(EP.list, {}, { method: 'GET' })
}

/**
 * 新增角色
 */
export function addSysRole(form: SysRoleForm): Promise<RoleAck & { data?: number }> {
  return request<RoleAck & { data?: number }>(EP.add, form, { method: 'POST' })
}

/**
 * 修改角色
 */
export function updateSysRole(form: SysRoleForm): Promise<RoleAck> {
  return request<RoleAck>(EP.update, form, { method: 'POST' })
}

/**
 * 删除角色（内置角色 admin/read 不可删；已绑定用户的角色不可删）
 */
export function deleteSysRole(roleId: number): Promise<RoleAck> {
  return request<RoleAck>(EP.delete, { roleId }, { method: 'POST' })
}

/**
 * 获取全量系统资源权限树（供勾选授权）
 */
export function getSysResourceTree(): Promise<SysResourceTreeNode[]> {
  return request<SysResourceTreeNode[]>(EP.resourceTree, {}, { method: 'GET' })
}

/**
 * 获取角色已分配的资源 ID 集合
 */
export function getRoleResourceIds(roleId: number): Promise<number[]> {
  return request<number[]>(EP.resourceIds, { roleId }, { method: 'GET' })
}

/**
 * 保存角色资源分配
 */
export function assignRoleResources(roleId: number, resourceIds: number[]): Promise<RoleAck> {
  return request<RoleAck>(EP.assignResources, { roleId, resourceIds }, { method: 'POST' })
}
