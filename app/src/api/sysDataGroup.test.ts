import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  bindDataGroupsToRole,
  bindRolesToDataGroup,
  deleteDataGroup,
  fetchDataGroupDetail,
  fetchDataGroupList,
  fetchDataGroupOptions,
  fetchDataGroupRoles,
  fetchRoleDataGroups,
  saveDataGroup,
  toggleDataGroupStatus,
} from './sysDataGroup'
import { LIVE_ENDPOINTS } from './endpoints'
import * as client from './client'

describe('sysDataGroup API', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('数据权限组端点全部登记为 live（漏登记会被 mock 接管，页面拿不到库里的组）', () => {
    for (const path of [
      'sys-data-group/list',
      'sys-data-group/options',
      'sys-data-group/detail',
      'sys-data-group/add',
      'sys-data-group/update',
      'sys-data-group/delete',
      'sys-data-group/status',
      'sys-data-group/roles',
      'sys-data-group/bind-roles',
      'sys-data-group/role-groups',
      'sys-data-group/bind-role-groups',
    ]) {
      expect(LIVE_ENDPOINTS.has(path), path).toBe(true)
    }
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

  it('mock 占位回 null 时列表收敛为空数组，不抛给调用方', async () => {
    vi.spyOn(client, 'request').mockResolvedValue(null as never)

    expect(await fetchDataGroupList()).toEqual([])
    expect(await fetchDataGroupOptions()).toEqual([])
    expect(await fetchDataGroupRoles(100001)).toEqual([])
    expect(await fetchRoleDataGroups(57)).toEqual([])
  })

  it('接口失败时把错误抛给调用方，不静默当空列表', async () => {
    vi.spyOn(client, 'request').mockRejectedValue(new Error('502 Bad Gateway'))
    await expect(fetchDataGroupList()).rejects.toThrow('502 Bad Gateway')
  })

  it('fetchDataGroupOptions 获取下拉选项', async () => {
    const mockOptions = [{ id: 90001, label: '只读分析数据组', code: 'DATA_GROUP_READ', disabled: false }]
    vi.spyOn(client, 'request').mockResolvedValue(mockOptions)

    const res = await fetchDataGroupOptions()
    expect(res).toEqual(mockOptions)
    expect(client.request).toHaveBeenCalledWith('sys-data-group/options', {}, { method: 'GET' })
  })

  it('fetchDataGroupDetail 按 query 传 id', async () => {
    const spy = vi.spyOn(client, 'request').mockResolvedValue({ id: 100001, groupName: '运维支撑数据组' })

    await fetchDataGroupDetail(100001)
    expect(spy).toHaveBeenCalledWith('sys-data-group/detail', { id: 100001 }, { method: 'GET' })
  })

  it('saveDataGroup 新增走 /add、修改走 /update，表单在 JSON 体里', async () => {
    const spy = vi.spyOn(client, 'request').mockResolvedValue({ ok: true, message: '操作成功' })

    await saveDataGroup({ groupName: '新数据组', groupCode: 'DATA_GROUP_NEW' })
    expect(spy).toHaveBeenCalledWith(
      'sys-data-group/add',
      { groupName: '新数据组', groupCode: 'DATA_GROUP_NEW' },
      { method: 'POST' },
    )

    await saveDataGroup({ id: 100001, groupName: '更新数据组', groupCode: 'DATA_GROUP_OPS' })
    expect(spy).toHaveBeenCalledWith(
      'sys-data-group/update',
      { id: 100001, groupName: '更新数据组', groupCode: 'DATA_GROUP_OPS' },
      { method: 'POST' },
    )
  })

  it('deleteDataGroup 走 query（后端是 @RequestParam，不是 @RequestBody）', async () => {
    const spy = vi.spyOn(client, 'request').mockResolvedValue({ ok: true, message: '操作成功' })

    await deleteDataGroup(100001)
    expect(spy).toHaveBeenCalledWith('sys-data-group/delete', { id: 100001 }, { method: 'POST', paramsIn: 'query' })
  })

  it('toggleDataGroupStatus 把 id 与 status 放进 JSON 体', async () => {
    const spy = vi.spyOn(client, 'request').mockResolvedValue({ ok: true, message: '操作成功' })

    await toggleDataGroupStatus(100001, 1)
    expect(spy).toHaveBeenCalledWith('sys-data-group/status', { id: 100001, status: 1 }, { method: 'POST' })
  })

  it('bindRolesToDataGroup 绑定角色至数据组', async () => {
    const spy = vi.spyOn(client, 'request').mockResolvedValue({ ok: true, message: '操作成功' })

    await bindRolesToDataGroup(100001, [52, 57])
    expect(spy).toHaveBeenCalledWith(
      'sys-data-group/bind-roles',
      { dataGroupId: 100001, roleIds: [52, 57] },
      { method: 'POST' },
    )
  })

  it('bindDataGroupsToRole 绑定数据组至角色', async () => {
    const spy = vi.spyOn(client, 'request').mockResolvedValue({ ok: true, message: '操作成功' })

    await bindDataGroupsToRole(57, [90001, 90002])
    expect(spy).toHaveBeenCalledWith(
      'sys-data-group/bind-role-groups',
      { roleId: 57, dataGroupIds: [90001, 90002] },
      { method: 'POST' },
    )
  })
})
