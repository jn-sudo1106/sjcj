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
 *
 * 不吞异常：这里返回空数组会让页面看起来「一个数据组都没配」，与接口没通是两种完全不同的事，
 * 交给调用方决定怎么提示。mock 模式下未实现专属 handler 的端点会回 null，统一收敛成空列表。
 */
export async function fetchDataGroupList(params?: { keyword?: string; status?: number }): Promise<SysDataGroupItem[]> {
  const res = await request<SysDataGroupItem[]>(EP.list, params ?? {}, { method: 'GET' })
  return Array.isArray(res) ? res : []
}

/**
 * 获取数据组下拉选项 (后端已排除停用组)
 */
export async function fetchDataGroupOptions(): Promise<SysDataGroupOption[]> {
  const res = await request<SysDataGroupOption[]>(EP.options, {}, { method: 'GET' })
  return Array.isArray(res) ? res : []
}

/**
 * 获取数据组详情
 */
export async function fetchDataGroupDetail(id: number): Promise<SysDataGroupItem | null> {
  return await request<SysDataGroupItem>(EP.detail, { id }, { method: 'GET' })
}

/**
 * 新增或更新数据组
 *
 * update 走的是后端 selective 更新，但 groupCode 缺省会被校验逻辑补成空串再落库，
 * 所以改名必须把原编码一并带上。
 */
export async function saveDataGroup(form: SysDataGroupForm): Promise<Ack> {
  const url = form.id ? EP.update : EP.add
  return await request<Ack>(url, form as unknown as Record<string, unknown>, { method: 'POST' })
}

/**
 * 删除数据组（后端 @RequestParam，走 query 不走 JSON 体）
 */
export async function deleteDataGroup(id: number): Promise<Ack> {
  return await request<Ack>(EP.delete, { id }, { method: 'POST', paramsIn: 'query' })
}

/**
 * 切换数据组状态 (0-启用, 1-停用)
 */
export async function toggleDataGroupStatus(id: number, status: number): Promise<Ack> {
  return await request<Ack>(EP.status, { id, status }, { method: 'POST' })
}

/**
 * 查询指定数据组关联的角色ID列表
 */
export async function fetchDataGroupRoles(dataGroupId: number): Promise<number[]> {
  const res = await request<number[]>(EP.roles, { dataGroupId }, { method: 'GET' })
  return Array.isArray(res) ? res : []
}

/**
 * 为数据组绑定角色列表
 */
export async function bindRolesToDataGroup(dataGroupId: number, roleIds: number[]): Promise<Ack> {
  return await request<Ack>(EP.bindRoles, { dataGroupId, roleIds }, { method: 'POST' })
}

/**
 * 查询指定角色关联的数据组ID列表
 */
export async function fetchRoleDataGroups(roleId: number): Promise<number[]> {
  const res = await request<number[]>(EP.roleGroups, { roleId }, { method: 'GET' })
  return Array.isArray(res) ? res : []
}

/**
 * 为角色绑定数据组列表
 */
export async function bindDataGroupsToRole(roleId: number, dataGroupIds: number[]): Promise<Ack> {
  return await request<Ack>(EP.bindRoleGroups, { roleId, dataGroupIds }, { method: 'POST' })
}
