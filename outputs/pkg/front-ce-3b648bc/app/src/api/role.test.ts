import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./client', () => ({ request: vi.fn() }))

import { request } from './client'
import {
  listSysRoles,
  addSysRole,
  updateSysRole,
  deleteSysRole,
  getSysResourceTree,
  getRoleResourceIds,
  assignRoleResources,
} from './role'

describe('role API', () => {
  beforeEach(() => {
    vi.mocked(request).mockReset()
  })

  it('listSysRoles: GET sys-role/list', async () => {
    const mockRoles = [
      { roleId: 1, roleName: 'admin', roleStatus: 1, isSys: true, userCount: 2 },
    ]
    vi.mocked(request).mockResolvedValue(mockRoles)

    const res = await listSysRoles()
    expect(vi.mocked(request)).toHaveBeenCalledWith('sys-role/list', {}, { method: 'GET' })
    expect(res).toEqual(mockRoles)
  })

  it('addSysRole: POST sys-role/add', async () => {
    vi.mocked(request).mockResolvedValue({ success: true, code: '0', msg: '新增角色成功', data: 10 })

    const res = await addSysRole({ roleName: 'auditor', roleRemark: '审计' })
    expect(vi.mocked(request)).toHaveBeenCalledWith(
      'sys-role/add',
      { roleName: 'auditor', roleRemark: '审计' },
      { method: 'POST' }
    )
    expect(res.data).toBe(10)
  })

  it('updateSysRole: POST sys-role/update', async () => {
    vi.mocked(request).mockResolvedValue({ success: true, code: '0', msg: '修改角色成功' })

    const res = await updateSysRole({ roleId: 10, roleName: 'auditor_v2' })
    expect(vi.mocked(request)).toHaveBeenCalledWith(
      'sys-role/update',
      { roleId: 10, roleName: 'auditor_v2' },
      { method: 'POST' }
    )
    expect(res.success).toBe(true)
  })

  it('deleteSysRole: POST sys-role/delete', async () => {
    vi.mocked(request).mockResolvedValue({ success: true, code: '0', msg: '删除角色成功' })

    const res = await deleteSysRole(10)
    expect(vi.mocked(request)).toHaveBeenCalledWith(
      'sys-role/delete',
      { roleId: 10 },
      { method: 'POST' }
    )
    expect(res.success).toBe(true)
  })

  it('getSysResourceTree: GET sys-role/resource-tree', async () => {
    const mockTree = [{ id: 1, parentId: 0, label: '系统管理', modelCode: 'sys', level: 1, type: 0, order: 1 }]
    vi.mocked(request).mockResolvedValue(mockTree)

    const res = await getSysResourceTree()
    expect(vi.mocked(request)).toHaveBeenCalledWith('sys-role/resource-tree', {}, { method: 'GET' })
    expect(res).toEqual(mockTree)
  })

  it('getRoleResourceIds: GET sys-role/resource-ids', async () => {
    vi.mocked(request).mockResolvedValue([1, 2, 3])

    const res = await getRoleResourceIds(5)
    expect(vi.mocked(request)).toHaveBeenCalledWith(
      'sys-role/resource-ids',
      { roleId: 5 },
      { method: 'GET' }
    )
    expect(res).toEqual([1, 2, 3])
  })

  it('assignRoleResources: POST sys-role/assign-resources', async () => {
    vi.mocked(request).mockResolvedValue({ success: true, code: '0', msg: '保存角色授权成功' })

    const res = await assignRoleResources(5, [1, 2, 3])
    expect(vi.mocked(request)).toHaveBeenCalledWith(
      'sys-role/assign-resources',
      { roleId: 5, resourceIds: [1, 2, 3] },
      { method: 'POST' }
    )
    expect(res.success).toBe(true)
  })
})
