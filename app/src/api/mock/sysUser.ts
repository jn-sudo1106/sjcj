// 用户管理（SYS_USER）mock：给「系统设置 → 用户管理」在演示模式下留一份可点的数据。
//
// 与真实后端的差别：口令只记一条「已设置」标记，不落任何哈希（mock 不参与登录）。
// 服务端的四条规则在这里同样生效，好让演示环境也能撞到真实约束（见 api/sysUser.ts 文件头）：
//   · admin 只读、登录名不可改、新建账号自动落到 read 角色。
//   · 停用 = 失效 + 清空该用户角色；启用要求该用户已有角色（否则命中 Shiro 的空角色兜底）。
//   · 新建时没填组 ID，服务端会沿用创建人的组；mock 拿不到会话，兜底用 MOCK_CREATOR_GROUP。
import type { Paged } from '../types/common'
import {
  PROTECTED_LOGIN_NAME,
  STATUS_INVALID,
  STATUS_VALID,
  sysUserFormError,
  type SysUserRow,
} from '../sysUser'

interface MockUser {
  userId: number
  userLoginName: string
  userName: string
  userStatus: number
  groupId: number | null
  /** mock 里只存角色 ID（本页不维护角色，只在建号时自动落 read）；口令字段不落库 */
  roleIds: number[]
  creator: string | null
  createTime: string | null
  modifier: string | null
  updateTime: string | null
}

/** SYS_ROLE 的本系统既有角色：admin 只由管理员在后台数据库里维护 */
const ROLES = [
  { key: 1, name: 'admin' },
  { key: 2, name: 'read' },
]
const READ_ROLE_ID = 2
/** mock 没有会话，新建时创建人所在组用一个固定值顶替 */
const MOCK_CREATOR_GROUP = 100001

const SEED: MockUser[] = [
  {
    userId: 1, userLoginName: 'admin', userName: '系统管理员', userStatus: STATUS_VALID, groupId: 1,
    roleIds: [1], creator: 'system', createTime: '2024-01-08 09:12:00', modifier: null, updateTime: null,
  },
  {
    userId: 12, userLoginName: 'zhonghe', userName: '钟和', userStatus: STATUS_VALID, groupId: 100001,
    roleIds: [2], creator: 'admin', createTime: '2026-09-14 10:22:00', modifier: null, updateTime: null,
  },
  {
    userId: 13, userLoginName: 'haigang', userName: '海刚', userStatus: STATUS_VALID, groupId: 100001,
    roleIds: [2], creator: 'admin', createTime: '2026-10-01 15:41:00', modifier: 'zhonghe', updateTime: '2026-10-16 09:05:00',
  },
  // 失效账号：按规则停用时已清空角色，所以直接启用会被拒绝（演示启用闸门）
  {
    userId: 14, userLoginName: 'like', userName: '李可', userStatus: STATUS_INVALID, groupId: 100002,
    roleIds: [], creator: 'admin', createTime: '2026-08-30 11:02:00', modifier: 'admin', updateTime: '2026-10-20 17:30:00',
  },
  {
    userId: 15, userLoginName: 'wangxin', userName: '王欣', userStatus: STATUS_VALID, groupId: 100002,
    roleIds: [2], creator: 'admin', createTime: '2026-10-11 08:47:00', modifier: null, updateTime: null,
  },
]

const ROWS: MockUser[] = SEED.map((row) => ({ ...row, roleIds: [...row.roleIds] }))
let nextUserId = Math.max(...ROWS.map((row) => row.userId)) + 1

function roleName(roleIds: number[]): string {
  return roleIds.map((id) => ROLES.find((role) => role.key === id)?.name ?? `角色${id}`).join(',')
}

function toView(row: MockUser): SysUserRow {
  return {
    userId: row.userId,
    userLoginName: row.userLoginName,
    userName: row.userName,
    userStatus: row.userStatus,
    groupId: row.groupId,
    roleIds: row.roleIds.length ? row.roleIds.join(',') : null,
    roleNames: row.roleIds.length ? roleName(row.roleIds) : null,
    creator: row.creator,
    createTime: row.createTime,
    modifier: row.modifier,
    updateTime: row.updateTime,
    protectedAccount: row.userLoginName.toLowerCase() === PROTECTED_LOGIN_NAME,
  }
}

function find(id: unknown): MockUser {
  const row = ROWS.find((item) => item.userId === Number(id))
  if (!row) throw new Error(`用户不存在：${String(id)}`)
  return row
}

/** 内置 admin 不参与任何写操作（与后端 rejectProtected 同口径） */
function rejectProtected(row: MockUser): void {
  if (row.userLoginName.toLowerCase() === PROTECTED_LOGIN_NAME) {
    throw new Error('内置 admin 账号不允许在此修改')
  }
}

function now(): string {
  const d = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function mockSysUserList(params?: Record<string, unknown>): Paged<SysUserRow> {
  const loginName = String(params?.loginName ?? '').trim()
  const userName = String(params?.userName ?? '').trim()
  const rawGroup = params?.groupId
  const hasGroup = rawGroup !== undefined && rawGroup !== null && rawGroup !== ''
  const groupId = Number(hasGroup ? rawGroup : 0)
  const rawStatus = params?.userStatus
  const hasStatus = rawStatus !== undefined && rawStatus !== null && rawStatus !== ''
  const userStatus = Number(rawStatus ?? -1)
  const page = Number(params?.page ?? 1)
  const limit = Number(params?.limit ?? 20)

  const list = ROWS.filter((row) => (!loginName || row.userLoginName.includes(loginName))
    && (!userName || row.userName.includes(userName))
    && (!hasGroup || row.groupId === groupId)
    && (!hasStatus || row.userStatus === userStatus))
  const from = (page - 1) * limit
  return { total: list.length, list: list.slice(from, from + limit).map(toView) }
}

export function mockSysUserDetail(params?: Record<string, unknown>): SysUserRow {
  return toView(find(params?.userId))
}

export function mockSysUserAdd(params?: Record<string, unknown>): { ok: boolean; message: string; data: number } {
  const loginName = String(params?.userLoginName ?? '').trim()
  const rawGroup = String(params?.groupId ?? '').trim()
  const invalid = sysUserFormError({
    loginName,
    userName: String(params?.userName ?? ''),
    groupId: rawGroup || String(MOCK_CREATOR_GROUP),
    password: String(params?.userPassword ?? ''),
  })
  if (invalid) throw new Error(invalid)
  if (ROWS.some((row) => row.userLoginName.toLowerCase() === loginName.toLowerCase())) {
    throw new Error(`登录名已存在：${loginName}`)
  }
  const userId = nextUserId++
  ROWS.push({
    userId,
    userLoginName: loginName,
    userName: String(params?.userName).trim(),
    userStatus: STATUS_VALID,
    groupId: Number(rawGroup || MOCK_CREATOR_GROUP),
    // 服务端建号时自动落到只读角色，admin 绑定只能由管理员改数据库
    roleIds: [READ_ROLE_ID],
    creator: 'admin',
    createTime: now(),
    modifier: null,
    updateTime: null,
  })
  return { ok: true, message: '新增成功', data: userId }
}

export function mockSysUserUpdate(params?: Record<string, unknown>): { ok: boolean; message: string } {
  const row = find(params?.userId)
  rejectProtected(row)
  const invalid = sysUserFormError({
    loginName: String(params?.userLoginName ?? row.userLoginName),
    userName: String(params?.userName ?? ''),
    groupId: String(params?.groupId ?? ''),
    password: '',
    originLoginName: row.userLoginName,
  })
  if (invalid) throw new Error(invalid)
  row.userName = String(params?.userName).trim()
  row.groupId = Number(params?.groupId)
  row.modifier = 'admin'
  row.updateTime = now()
  return { ok: true, message: '修改成功' }
}

export function mockSysUserStatus(params?: Record<string, unknown>): { ok: boolean; message: string } {
  const row = find(params?.userId)
  rejectProtected(row)
  const status = Number(params?.status)
  if (status !== STATUS_VALID && status !== STATUS_INVALID) throw new Error('状态只能是 0-有效 或 1-失效')
  if (status === STATUS_INVALID) {
    const unbound = row.roleIds.length
    row.roleIds = []
    row.userStatus = STATUS_INVALID
    row.modifier = 'admin'
    row.updateTime = now()
    return { ok: true, message: `已失效，并解除 ${unbound} 条角色绑定` }
  }
  // 空角色账号一旦有效就会被 Shiro 当成 admin，所以启用前必须先补回角色
  if (!row.roleIds.length) {
    throw new Error('该用户已没有角色（失效时按规则解绑了），直接启用会拿到管理员权限；请先在数据库补回角色绑定，再回来启用')
  }
  row.userStatus = STATUS_VALID
  row.modifier = 'admin'
  row.updateTime = now()
  return { ok: true, message: '已启用' }
}

export function mockSysUserPassword(params?: Record<string, unknown>): { ok: boolean; message: string } {
  const row = find(params?.userId)
  rejectProtected(row)
  const password = String(params?.password ?? '')
  if (!password) throw new Error('新密码不能为空')
  row.modifier = 'admin'
  row.updateTime = now()
  return { ok: true, message: '密码重置成功' }
}
