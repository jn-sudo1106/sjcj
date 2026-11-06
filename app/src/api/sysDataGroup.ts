// 数据组与角色关联管理（sys_data_group / sys_role_data_group）API 封装
// 后端契约：com.vanv.sys.controller.SysDataGroupController，路径前缀 /api/v1/sys-data-group（bee-config）
import { request } from './client'
import type { Ack } from './types/common'

export interface SysDataGroupItem {
  id: number
  groupName: string
  groupCode: string
  orderNum: number
  status: number
  remark: string
  createBy: string
  createTime: string
  updateBy: string
  updateTime: string
  roleIds: number[]
  roleNames: string[]
  ruleCount: number
}

export interface SysDataGroupOption {
  id: number
  label: string
  code: string
  disabled: boolean
}

export interface SysDataGroupForm {
  id?: number
  groupName: string
  groupCode?: string
  orderNum?: number
  status?: number
  remark?: string
  roleIds?: number[]
}

const EP = {
  list: 'sys-data-group/list',
  options: 'sys-data-group/options',
  detail: 'sys-data-group/detail',
  add: 'sys-data-group/add',
  update: 'sys-data-group/update',
  delete: 'sys-data-group/delete',
  status: 'sys-data-group/status',
  roles: 'sys-data-group/roles',
  bindRoles: 'sys-data-group/bind-roles',
  roleGroups: 'sys-data-group/role-groups',
  bindRoleGroups: 'sys-data-group/bind-role-groups',
} as const

/**
 * 获取数据组列表 (包含关联角色信息)
 */
export async function fetchDataGroupList(params?: { keyword?: string; status?: number }): Promise<SysDataGroupItem[]> {
  try {
    return await request<SysDataGroupItem[]>(EP.list, params ?? {}, { method: 'GET' })
  } catch {
    return []
  }
}

/**
 * 获取数据组下拉选项
 */
export async function fetchDataGroupOptions(): Promise<SysDataGroupOption[]> {
  try {
    return await request<SysDataGroupOption[]>(EP.options, {}, { method: 'GET' })
  } catch {
    return []
  }
}

/**
 * 获取数据组详情
 */
export async function fetchDataGroupDetail(id: number): Promise<SysDataGroupItem | null> {
  return await request<SysDataGroupItem>(EP.detail, { id }, { method: 'GET' })
}

/**
 * 新增或更新数据组
 */
export async function saveDataGroup(form: SysDataGroupForm): Promise<Ack> {
  const url = form.id ? EP.update : EP.add
  return await request<Ack>(url, {}, { method: 'POST', body: form })
}

/**
 * 删除数据组
 */
export async function deleteDataGroup(id: number): Promise<Ack> {
  return await request<Ack>(EP.delete, { id }, { method: 'POST' })
}

/**
 * 切换数据组状态 (0-启用, 1-停用)
 */
export async function toggleDataGroupStatus(id: number, status: number): Promise<Ack> {
  return await request<Ack>(EP.status, {}, { method: 'POST', body: { id, status } })
}

/**
 * 查询指定数据组关联的角色ID列表
 */
export async function fetchDataGroupRoles(dataGroupId: number): Promise<number[]> {
  try {
    return await request<number[]>(EP.roles, { dataGroupId }, { method: 'GET' })
  } catch {
    return []
  }
}

/**
 * 为数据组绑定角色列表
 */
export async function bindRolesToDataGroup(dataGroupId: number, roleIds: number[]): Promise<Ack> {
  return await request<Ack>(EP.bindRoles, {}, { method: 'POST', body: { dataGroupId, roleIds } })
}

/**
 * 查询指定角色关联的数据组ID列表
 */
export async function fetchRoleDataGroups(roleId: number): Promise<number[]> {
  try {
    return await request<number[]>(EP.roleGroups, { roleId }, { method: 'GET' })
  } catch {
    return []
  }
}

/**
 * 为角色绑定数据组列表
 */
export async function bindDataGroupsToRole(roleId: number, dataGroupIds: number[]): Promise<Ack> {
  return await request<Ack>(EP.bindRoleGroups, {}, { method: 'POST', body: { roleId, dataGroupIds } })
}
