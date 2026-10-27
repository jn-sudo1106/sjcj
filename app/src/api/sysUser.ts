// 用户管理（SYS_USER）—— 系统设置 → 用户管理。
//
// 后端契约：com.vanv.sys.controller.SysUserAdminController，路径前缀 /api/v1/sys-user（bee-config）。
// 表口径来自 SysUserMapper.xml 的 resultMap（10 列）+ SYS_USER_2_ROLE / SYS_ROLE 两张关系表；
// 仓库里没有 sys_user 的 DDL，列长度未核实，所以前端只校空值与字符形态，不校长度上限。
//
// 两套响应结构（client.ts 的 normalizeHttpPayload 都能吃）：
//   · list    返回 Paged，code 是数字 0 → 归一成 { list, total }
//   · 其余    返回 RspResult，code 是字符串 "0"/"-1" → data 是对象/数组则透传，标量则回 { ok, message, data }
//
// 必须留在服务端的四条规则（前端只做同口径预检，省一次往返，不是安全边界）：
//   1. 口令不落明文：新增与重置密码都传明文，服务端写 {p} + md5(登录名 + 明文)；出参永不含口令。
//   2. 停用 = 失效 + 解除该用户全部角色绑定；再启用前必须先补回角色，
//      因为 ShiroDbRealm 取不到角色时会兜底成 admin（空角色 = 超级管理员）。
//   3. 登录名创建后不可改：它参与口令哈希，改了等于把密码一起作废。
//   4. 新建账号由服务端自动绑一条 read（只读）角色，本页不提供任何角色维护入口——
//      要 admin 权限的账号由管理员直接改后台数据库的 SYS_USER_2_ROLE。
// 页面本身只对 admin 角色可见（见 views/Settings/index.vue 的 adminOnly 过滤）。
import { request } from './client'
import type { Ack, Paged } from './types/common'

const EP = {
  list: 'sys-user/list',
  detail: 'sys-user/detail',
  add: 'sys-user/add',
  update: 'sys-user/update',
  status: 'sys-user/update-status',
  password: 'sys-user/change-password',
} as const

/** SYS_USER.USER_STATUS：0-有效 / 1-失效（列是 BIGINT，没有物理删除） */
export const STATUS_VALID = 0
export const STATUS_INVALID = 1

/** 内置管理员账号：本页只读，编辑 / 停用 / 重置密码后端一律拒绝 */
export const PROTECTED_LOGIN_NAME = 'admin'

export interface SysUserRow {
  userId: number
  userLoginName: string
  userName: string
  userStatus: number
  groupId: number | null
  /** 已分配角色 ID，逗号分隔；无角色时为 null（此时启用会被后端拒绝） */
  roleIds: string | null
  /** 已分配角色名，逗号分隔 */
  roleNames: string | null
  creator: string | null
  createTime: string | null
  modifier: string | null
  updateTime: string | null
  protectedAccount: boolean
}

export interface SysUserQuery {
  loginName?: string
  userName?: string
  groupId?: number
  /** 空串 / undefined = 不按状态过滤 */
  userStatus?: number | ''
  page?: number
  limit?: number
}

/** 写类接口 data 是标量（新增 id / 状态回执）时的形状 */
export type SysUserAck = Ack & { data?: number }

/** 新增 / 修改入参：写成 type 别名（不是 interface）才能带隐式索引签名，直接喂给 request 的 params */
export type SysUserInput = {
  userId?: number
  userLoginName?: string
  userName: string
  /** 留空即由服务端沿用创建人（当前 admin）所在的组 */
  groupId?: number
  userPassword?: string
}

/** 表单校验入参（编辑态带上原登录名，用来判「登录名是否被改」） */
export interface SysUserFormCheck {
  loginName: string
  userName: string
  groupId: string
  password: string
  /** 编辑态的原登录名；新建时留空 */
  originLoginName?: string
}

export function pagedSysUser(query: SysUserQuery): Promise<Paged<SysUserRow>> {
  return request<Paged<SysUserRow>>(EP.list, {
    loginName: query.loginName || undefined,
    userName: query.userName || undefined,
    groupId: query.groupId,
    userStatus: query.userStatus === '' || query.userStatus === undefined ? undefined : query.userStatus,
    page: query.page ?? 1,
    limit: query.limit ?? 20,
  }, { method: 'GET' })
}

export function sysUserDetail(userId: number): Promise<SysUserRow | null> {
  return request<SysUserRow | null>(EP.detail, { userId }, { method: 'GET' })
}

/** 新增用户，data 为新 userId；服务端会自动给它绑一条只读（read）角色 */
export function addSysUser(input: SysUserInput): Promise<SysUserAck> {
  return request<SysUserAck>(EP.add, input, { method: 'POST' })
}

/** 修改用户（body 必须带 userId；登录名不可改） */
export function updateSysUser(input: SysUserInput & { userId: number }): Promise<SysUserAck> {
  return request<SysUserAck>(EP.update, input, { method: 'POST' })
}

/** 启用 / 停用：停用会连带解除该用户全部角色绑定 */
export function changeSysUserStatus(userId: number, status: number): Promise<SysUserAck> {
  return request<SysUserAck>(EP.status, { userId, status }, { method: 'POST' })
}

/** 重置密码：只把明文交给后端，前端不做哈希（口令哈希带登录名，口径由服务端统一） */
export function resetSysUserPassword(userId: number, password: string): Promise<SysUserAck> {
  return request<SysUserAck>(EP.password, { userId, password }, { method: 'POST' })
}

/**
 * 表单预检，与 SysUserAdminService 的校验同口径；返回第一条错误文案，通过校验返回 null。
 * 编辑态（originLoginName 有值）不要求初始密码——口令只能通过「重置密码」改。
 */
export function sysUserFormError(check: SysUserFormCheck): string | null {
  const loginName = check.loginName.trim()
  const editing = !!check.originLoginName
  if (!editing) {
    if (!loginName) return '请填写登录名'
    if (/\s/.test(loginName)) return '登录名不能包含空格'
    if (loginName.toLowerCase() === PROTECTED_LOGIN_NAME) return 'admin 是内置账号，不能在此创建'
    if (!check.password) return '请填写初始密码'
  }
  if (!check.userName.trim()) return '请填写用户名'
  if (!/^\d+$/.test(check.groupId.trim())) return '请填写所属组 ID（数字）'
  if (Number(check.groupId.trim()) <= 0) return '所属组 ID 必须大于 0'
  if (editing && loginName && loginName !== check.originLoginName) return '登录名创建后不可修改；需要换登录名请新建用户'
  return null
}

/** 状态开关要显示的文字 */
export function statusText(userStatus: number): string {
  return userStatus === STATUS_VALID ? '有效' : '失效'
}
