// 组级数据权限（sys_group_res）mock：给「系统设置 → 数据权限设置」在演示模式下留一份可点的数据。
// 与真实后端的差别：preview 无法执行 SQL，只做黑名单预检；ID 条件的命中数/样例按填入的 ID 如实回。
import type { Paged } from '../types/common'
import type { GroupResMeta, GroupResPreview, GroupResRule } from '../groupRes'
import { GROUP_ID_FLOOR, idCondError, sqlCondError } from '../groupRes'

const SEED: GroupResRule[] = [
  {
    id: 15, groupId: 100001, action: 'ACCEPT', resType: 'SOURCE', condType: 'SQL',
    resCond: 'CATEGORY_ID IN (9009387,9009388)', condJson: null, remarks: '研发一组可见的源', isDelete: 0,
  },
  {
    id: 16, groupId: 100001, action: 'REJECT', resType: 'SOURCE', condType: 'ID',
    resCond: '430001300,430001301', condJson: null, remarks: '排除测试源', isDelete: 0,
  },
  {
    id: 17, groupId: 100002, action: 'ACCEPT', resType: 'CATEGORY', condType: 'ID',
    resCond: '9009387', condJson: null, remarks: '运营组只看活动目录', isDelete: 0,
  },
  {
    id: 18, groupId: 100002, action: 'ACCEPT', resType: 'CONFIG', condType: 'SQL',
    resCond: 'CREATE_DT >= 2026-01-01', condJson: null, remarks: null, isDelete: 0,
  },
]

const ROWS: GroupResRule[] = SEED.map((r) => ({ ...r }))
let nextId = Math.max(...ROWS.map((r) => r.id)) + 1

/** 枚举与列白名单照文档 §6；fields 只放各 resType 的主键列，真实清单以 /meta 返回为准 */
export const MOCK_GROUP_RES_META: GroupResMeta = {
  resTypes: [
    { key: 'SOURCE', name: '数据源', baseTable: 'cs_source', idColumn: 'SOURCE_ID', fields: [
      { field: 'SOURCE_ID', name: '数据源ID', type: 'num', ops: ['IN', '=', '>', '<', '>=', '<='], valueFrom: 'sourcePicker' },
      { field: 'CATEGORY_ID', name: '所属目录', type: 'num', ops: ['IN', '='], valueFrom: 'categoryTree' },
      { field: 'STATE', name: '状态', type: 'str', ops: ['=', 'IN'], valueFrom: 'text' },
      { field: 'TAGS', name: '标签', type: 'str', ops: ['LIKE'], valueFrom: 'text' },
      { field: 'CREATE_DT', name: '创建时间', type: 'date', ops: ['>', '<', '>=', '<='], valueFrom: 'date' },
    ] },
    { key: 'CATEGORY', name: '目录', baseTable: 'cfg_category', idColumn: 'CATEGORY_ID', fields: [
      { field: 'CATEGORY_ID', name: '目录ID', type: 'num', ops: ['IN', '='], valueFrom: 'categoryTree' },
    ] },
    { key: 'CONFIG', name: '配置', baseTable: 'cs_config', idColumn: 'CONFIG_ID', fields: [
      { field: 'CONFIG_ID', name: '配置ID', type: 'num', ops: ['IN', '='], valueFrom: 'configPicker' },
    ] },
    { key: 'ENTRY_TYPE', name: '实体类型', baseTable: 'cfg_entry_type', idColumn: 'ENTRY_TYPE_ID', fields: [
      { field: 'ENTRY_TYPE_ID', name: '实体类型ID', type: 'num', ops: ['IN', '='], valueFrom: 'entryTypePicker' },
    ] },
    { key: 'PARAM', name: '参数', baseTable: 'cfg_param', idColumn: 'PARAM_ID', fields: [
      { field: 'PARAM_ID', name: '参数ID', type: 'num', ops: ['IN', '='], valueFrom: 'text' },
    ] },
    { key: 'GROUP', name: '用户组', baseTable: 'sys_user', idColumn: 'GROUP_ID', fields: [
      { field: 'GROUP_ID', name: '用户组ID', type: 'num', ops: ['IN', '='], valueFrom: 'groupPicker' },
    ] },
  ],
  actions: [{ key: 'ACCEPT', name: '入选' }, { key: 'REJECT', name: '排除' }],
  condTypes: [{ key: 'ID', name: 'ID列表' }, { key: 'STRUCT', name: '结构化条件' }, { key: 'SQL', name: 'SQL条件' }],
}

export function mockGroupResMeta(): GroupResMeta {
  return MOCK_GROUP_RES_META
}

export function mockGroupResList(params?: Record<string, unknown>): Paged<GroupResRule> {
  const raw = params?.groupId
  const hasGroup = raw !== undefined && raw !== null && raw !== ''
  const groupId = Number(hasGroup ? raw : 0)
  // 传了组 ID 就必须 >90000（内置组不走本表映射，与后端一致）；不传则跨组列出
  if (hasGroup && !(groupId > GROUP_ID_FLOOR)) throw new Error('groupId 必须大于 90000')
  const resType = String(params?.resType ?? '')
  const action = String(params?.action ?? '')
  const page = Number(params?.page ?? 1)
  const limit = Number(params?.limit ?? 20)
  const list = ROWS.filter((r) => r.isDelete === 0
    && (!hasGroup || r.groupId === groupId)
    && (!resType || r.resType === resType)
    && (!action || r.action === action))
  const from = (page - 1) * limit
  return { total: list.length, list: list.slice(from, from + limit).map((r) => ({ ...r })) }
}

export function mockGroupResDetail(params?: Record<string, unknown>): GroupResRule {
  const row = ROWS.find((r) => r.id === Number(params?.id) && r.isDelete === 0)
  if (!row) throw new Error('记录不存在')
  return { ...row }
}

export function mockGroupResAdd(params?: Record<string, unknown>): { ok: boolean; message: string; data: number } {
  const groupId = Number(params?.groupId ?? 0)
  if (!(groupId > GROUP_ID_FLOOR)) throw new Error('groupId 必须大于 90000')
  const id = nextId++
  ROWS.push({
    id,
    groupId,
    action: String(params?.action ?? 'ACCEPT'),
    resType: String(params?.resType ?? ''),
    condType: String(params?.condType ?? 'ID'),
    resCond: (params?.resCond as string) ?? null,
    condJson: (params?.condJson as string) ?? null,
    remarks: (params?.remarks as string) ?? null,
    isDelete: 0,
  })
  return { ok: true, message: '新增成功', data: id }
}

export function mockGroupResModify(params?: Record<string, unknown>): GroupResRule {
  const row = ROWS.find((r) => r.id === Number(params?.id) && r.isDelete === 0)
  if (!row) throw new Error('记录不存在')
  Object.assign(row, {
    action: String(params?.action ?? row.action),
    resType: String(params?.resType ?? row.resType),
    condType: String(params?.condType ?? row.condType),
    resCond: (params?.resCond as string) ?? row.resCond,
    condJson: (params?.condJson as string) ?? row.condJson,
    remarks: (params?.remarks as string) ?? row.remarks,
  })
  return { ...row }
}

export function mockGroupResDelete(params?: Record<string, unknown>): { ok: boolean; message: string; data: number } {
  const text = String(params?.ids ?? '')
  if (!text) throw new Error('ids 不能为空')
  const ids = text.split(',')
  if (ids.some((id) => !/^\d+$/.test(id.trim()))) throw new Error('ids 只能是逗号分隔的数字')
  let hit = 0
  for (const id of ids) {
    const row = ROWS.find((r) => r.id === Number(id) && r.isDelete === 0)
    if (row) { row.isDelete = 1; hit++ }
  }
  return { ok: true, message: `删除数量:${hit}`, data: hit }
}

/** 试算：mock 不连业务表，ID 条件按填入的 ID 如实回命中数，SQL 条件只做黑名单预检（命中数恒 0）。 */
export function mockGroupResPreview(params?: Record<string, unknown>): GroupResPreview {
  const condType = String(params?.condType ?? 'ID')
  const resCond = String(params?.resCond ?? '')
  const error = condType === 'SQL' ? sqlCondError(resCond) : condType === 'ID' ? idCondError(resCond) : null
  if (error) return { compiledCond: resCond, condType, count: 0, sample: [], error }
  if (condType === 'ID') {
    const ids = resCond.replace(/\s+/g, '').split(',').map(Number)
    return { compiledCond: ids.join(','), condType, count: ids.length, sample: ids.slice(0, 20), error: null }
  }
  return { compiledCond: resCond, condType, count: 0, sample: [], error: null }
}
