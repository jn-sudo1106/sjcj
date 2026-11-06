import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchDataGroupList,
  fetchDataGroupOptions,
  fetchDataGroupDetail,
  saveDataGroup,
  deleteDataGroup,
  toggleDataGroupStatus,
  fetchDataGroupRoles,
  bindRolesToDataGroup,
  fetchRoleDataGroups,
  bindDataGroupsToRole,
} from './sysDataGroup'
import * as client from './client'

describe('sysDataGroup API', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('fetchDataGroupList 发起 GET 请求并返回数据组列表', async () => {
    const mockData = [
      { id: 90001, groupName: '只读分析数据组', groupCode: 'DATA_GROUP_READ', roleIds: [52], roleNames: ['read'] },
    ]
    vi.spyOn(client, 'request').mockResolvedValue(mockData)

    const res = await fetchDataGroupList({ keyword: '只读' })
    expect(res).toEqual(mockData)
    expect(client.request).toHaveBeenCalledWith('sys-data-group/list', { keyword: '只读' }, { method: 'GET' })
  })

  it('fetchDataGroupOptions 获取下拉选项', async () => {
    const mockOptions = [{ id: 90001, label: '只读分析数据组', code: 'DATA_GROUP_READ', disabled: false }]
    vi.spyOn(client, 'request').mockResolvedValue(mockOptions)

    const res = await fetchDataGroupOptions()
    expect(res).toEqual(mockOptions)
    expect(client.request).toHaveBeenCalledWith('sys-data-group/options', {}, { method: 'GET' })
  })

  it('saveDataGroup 新增时请求 /add，修改时请求 /update', async () => {
    const spy = vi.spyOn(client, 'request').mockResolvedValue({ success: true })

    await saveDataGroup({ groupName: '新数据组' })
    expect(spy).toHaveBeenCalledWith('sys-data-group/add', {}, { method: 'POST', body: { groupName: '新数据组' } })

    await saveDataGroup({ id: 100001, groupName: '更新数据组' })
    expect(spy).toHaveBeenCalledWith('sys-data-group/update', {}, { method: 'POST', body: { id: 100001, groupName: '更新数据组' } })
  })

  it('bindRolesToDataGroup 绑定角色至数据组', async () => {
    const spy = vi.spyOn(client, 'request').mockResolvedValue({ success: true })

    await bindRolesToDataGroup(100001, [52, 57])
    expect(spy).toHaveBeenCalledWith('sys-data-group/bind-roles', {}, {
      method: 'POST',
      body: { dataGroupId: 100001, roleIds: [52, 57] },
    })
  })

  it('bindDataGroupsToRole 绑定数据组至角色', async () => {
    const spy = vi.spyOn(client, 'request').mockResolvedValue({ success: true })

    await bindDataGroupsToRole(57, [90001, 90002])
    expect(spy).toHaveBeenCalledWith('sys-data-group/bind-role-groups', {}, {
      method: 'POST',
      body: { roleId: 57, dataGroupIds: [90001, 90002] },
    })
  })
})
