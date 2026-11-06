// 组级数据权限（行级）规则维护 —— 系统设置 → 数据权限设置。
//
// 后端契约：com.vanv.sys.controller.SysGroupResController，路径前缀 /api/v1/group-res（接口文档-组数据权限.md）。
// 链路 sys_user.GROUP_ID → 会话 → sys_group_res → AuthContext 的 IN / NOT IN 条件，所以配错会直接影响业务查询。
//
// ⚠️ 两套响应结构（client.ts 的 normalizeHttpPayload 都能吃，但调用方拿到的形状不同）：
//   · list  返回 Paged，code 是**数字** 0/-1 → 归一成 { list, total }
//   · 其余 6 个返回 RspResult，code 是**字符串** "0"/"-1" → data 是对象则透传，是标量则回 { ok, message, data }
// 其余要点：
//   1. groupId 必须 > 90000（内置组不走本表映射），否则 list 直接回 code:-1。
//   2. delete 的 ids 走 query string，不是 JSON body（与 comm-job 同款）。
//   3. preview 试算失败时 success 仍是 true，错误在 data.error，调用方必须读这个字段。
//   4. condType=STRUCT 时后端用 condJson 编译的结果覆盖 resCond；本轮前端只放 ID / SQL 两种，
//      condJson 的字段结构文档未给出，等后端补充契约再接。
import { request } from './client'
import type { Ack, Paged } from './types/common'

const EP = {
  list: 'group-res/list',
  detail: 'group-res/detail',
  add: 'group-res/add',
  modify: 'group-res/modify',
  delete: 'group-res/delete',
  meta: 'group-res/meta',
  preview: 'group-res/preview',
  groups: 'group-res/groups',
  groupOptions: 'group-res/group-options',
} as const

/** 只有大于这个值的用户组才走 sys_group_res 映射（≤90000 是系统内置组） */
export const GROUP_ID_FLOOR = 90000

export interface GroupResRule {
  id: number
  groupId: number
  /** ACCEPT-入选（可见范围）/ REJECT-排除范围，两者可共存 */
  action: string
  /** SOURCE / CATEGORY / CONFIG / ENTRY_TYPE / PARAM / GROUP，权威取值以 group-res/meta 为准 */
  resType: string
  /** ID / STRUCT / SQL */
  condType: string
  resCond: string | null
  condJson: string | null
  remarks: string | null
  /** 0-在用 / 1-已软删除 */
  isDelete: number
}

export interface GroupResField {
  field: string
  name: string
  /** num / str / date */
  type: string
  /** IN / = / > / < / >= / <= / LIKE */
  ops: string[]
  /** 取值控件建议：sourcePicker / categoryTree / text / date ... */
  valueFrom: string
}

export interface GroupResTypeMeta {
  key: string
  name: string
  baseTable: string
  idColumn: string
  fields: GroupResField[]
}

export interface GroupResOption {
  key: string
  name: string
}

/** meta 返回：resType / action / condType 枚举全部来自这里，前端不硬编码 */
export interface GroupResMeta {
  resTypes: GroupResTypeMeta[]
  actions: GroupResOption[]
  condTypes: GroupResOption[]
}

export interface GroupResPreview {
  compiledCond: string
  condType: string
  count: number
  sample: number[]
  /** 非空即试算失败（此时 success 仍是 true） */
  error: string | null
}

/** 写类接口 data 是标量（新增 id / 删除条数）时的回执形状 */
export type GroupResAck = Ack & { data?: number }

export interface GroupResQuery {
  /** 规则归属的用户组；不传即不带该 query 参数（文档写必填 >90000，是否放开由后端说了算） */
  groupId?: number
  resType?: string
  action?: string
  page?: number
  limit?: number
}

/** 新增 / 修改的入参：写成 type 别名（不是 interface）才能带隐式索引签名，直接喂给 request 的 params */
export type GroupResInput = {
  groupId: number
  action: string
  resType: string
  condType?: string
  resCond?: string
  condJson?: string
  remarks?: string
}

/** 规则列表（Paged → { list, total }） */
export function pagedGroupRes(query: GroupResQuery): Promise<Paged<GroupResRule>> {
  return request<Paged<GroupResRule>>(EP.list, {
    groupId: query.groupId,
    resType: query.resType || undefined,
    action: query.action || undefined,
    page: query.page ?? 1,
    limit: query.limit ?? 20,
  }, { method: 'GET' })
}

/** 规则详情 */
export function groupResDetail(id: number): Promise<GroupResRule | null> {
  return request<GroupResRule | null>(EP.detail, { id }, { method: 'GET' })
}

/** 配置元数据（resType / action / condType 枚举 + 各 resType 的可选列） */
export function groupResMeta(): Promise<GroupResMeta> {
  return request<GroupResMeta>(EP.meta, undefined, { method: 'GET' })
}

/**
 * 组 ID 候选（只读，admin）：来自 sys_user_group 表（兼容 SYS_USER 与 sys_group_res），后端已滤掉 ≤90000 的内置组，升序。
 */
export function listGroupIds(): Promise<number[]> {
  return request<number[]>(EP.groups, undefined, { method: 'GET' })
}

export interface GroupOptionItem {
  id: number
  label: string
  code?: string
  parentId?: number
}

/** 组候选选项（只读，含 ID、组名与编码，来自 sys_user_group 表） */
export async function listGroupOptions(): Promise<GroupOptionItem[]> {
  try {
    const res = await request<GroupOptionItem[]>(EP.groupOptions, undefined, { method: 'GET' })
    if (Array.isArray(res)) return res
    if (res && typeof res === 'object' && 'data' in res && Array.isArray((res as { data: unknown }).data)) {
      return (res as { data: GroupOptionItem[] }).data
    }
    return []
  } catch {
    return []
  }
}

/** 新增规则，data 为新记录 id */
export function addGroupRes(input: GroupResInput): Promise<GroupResAck> {
  return request<GroupResAck>(EP.add, input, { method: 'POST' })
}

/** 修改规则（body 必须带 id），data 为修改后的完整记录 */
export function modifyGroupRes(input: GroupResInput & { id: number }): Promise<GroupResRule> {
  return request<GroupResRule>(EP.modify, input, { method: 'POST' })
}

/** 批量删除（软删，POST ?ids=15,16；参数在 query 不在 body） */
export function deleteGroupRes(ids: number[]): Promise<GroupResAck> {
  return request<GroupResAck>(EP.delete, { ids: ids.join(',') }, { method: 'POST', paramsIn: 'query' })
}

/** 条件试算：保存前预检，命中数与样例在 data 里，失败原因在 data.error */
export function previewGroupRes(input: { resType: string; condType: string; resCond?: string; condJson?: string }): Promise<GroupResPreview> {
  return request<GroupResPreview>(EP.preview, input, { method: 'POST' })
}

/**
 * condType=ID：逗号分隔的数字列表，只允许数字（后端同规则）。
 * 返回错误文案，通过校验返回 null。
 */
export function idCondError(resCond: string): string | null {
  const text = resCond.replace(/\s+/g, '')
  if (!text) return '请填写 ID 列表'
  if (!/^\d+(,\d+)*$/.test(text)) return 'ID 列表只能是逗号分隔的数字'
  return null
}

/** SQL 片段里的禁止项（文档联调注意事项 §1，后端做同样的黑名单校验，原样落库不转换）。 */
const SQL_FORBIDDEN_PUNCT = [';', '--', '/*', '*/']
const SQL_FORBIDDEN_WORDS = ['union', 'insert', 'update', 'delete', 'drop', 'truncate', 'alter', 'create', 'exec', 'grant', 'revoke', 'into outfile']

/**
 * condType=SQL：前端按单词边界预检（`UPDATE_DT` 这类列名不会误判，但条件值里的
 * `delete` / `update` 单词会被后端拦），提前报出来省一次往返。
 */
export function sqlCondError(resCond: string): string | null {
  const text = resCond.trim()
  if (!text) return '请填写 SQL 条件片段'
  const hitPunct = SQL_FORBIDDEN_PUNCT.find((token) => text.includes(token))
  if (hitPunct) return `SQL 条件不允许包含 ${hitPunct}`
  const lower = text.toLowerCase()
  const hitWord = SQL_FORBIDDEN_WORDS.find((word) => new RegExp(`\\b${word.replace(' ', '\\s+')}\\b`).test(lower))
  if (hitWord) return `SQL 条件包含非法关键字：${hitWord}`
  return null
}

// ---- STRUCT（结构化条件）----
// 契约见《接口文档-biz_type与组数据权限.md》§2.2：condJson = [{ field, op, values }]，元素间 AND；
// 提交时 resCond 留空，由后端 GroupResFieldMeta.compile 编译。以下校验逐条对齐后端 compile/literal
// 的报错口径（含"第 N 项"序号），前端先拦一次省往返。

/** condJson 数组的一个条件行 */
export interface GroupResCondItem {
  field: string
  op: string
  values: string[]
}

/** 解析 condJson；空串 / null / 非法 JSON / 非数组一律回 []（详情回显容错，不抛） */
export function parseCondJson(condJson: string | null | undefined): GroupResCondItem[] {
  if (!condJson || !condJson.trim()) return []
  try {
    const raw: unknown = JSON.parse(condJson)
    if (!Array.isArray(raw)) return []
    return raw
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item) => ({
        field: typeof item.field === 'string' ? item.field : '',
        op: typeof item.op === 'string' ? item.op : '',
        values: Array.isArray(item.values)
          ? item.values.filter((v): v is string | number => v !== null && v !== undefined).map(String)
          : [],
      }))
  } catch {
    return []
  }
}

/** 序列化成提交用的 condJson；空白值先剔除（与后端 compileItem 的 trim+skip 同口径） */
export function stringifyCondJson(items: GroupResCondItem[]): string {
  const cleaned = items.map((item) => ({
    field: item.field.trim(),
    op: item.op.trim(),
    values: item.values.map((v) => v.trim()).filter(Boolean),
  }))
  return JSON.stringify(cleaned)
}

/**
 * STRUCT 条件行预检，对齐后端 §2.10 / GroupResFieldMeta.compileItem：
 * field 在白名单、op 在该字段 ops、values 非空、num 字段值必须纯数字、非 IN 只允许 1 个值。
 * 返回错误文案，通过返回 null。
 */
export function condItemsError(items: GroupResCondItem[], fields: GroupResField[] | undefined): string | null {
  if (!items.length) return '请至少添加一个条件'
  for (let i = 0; i < items.length; i++) {
    const seq = `第 ${i + 1} 项`
    const item = items[i]
    const field = item.field.trim()
    const op = item.op.trim()
    if (!field) return `${seq}缺少字段`
    if (!op) return `${seq}缺少操作符`
    const metaField = fields?.find((f) => f.field === field)
    if (!metaField) return `${seq}的字段 ${field} 不在可选列中`
    if (!metaField.ops.includes(op)) return `${seq}的字段 ${field} 不支持操作符 ${op}`
    const values = item.values.map((v) => v.trim()).filter(Boolean)
    if (!values.length) return `${seq}的字段 ${field} 的值不能为空`
    if (op !== 'IN' && values.length !== 1) return `${seq}的字段 ${field} 在操作符 ${op} 下只能有一个值`
    if (metaField.type === 'num') {
      const bad = values.find((v) => !/^-?\d+$/.test(v))
      if (bad !== undefined) return `${seq}的字段 ${field} 需要一个数字值，实际为: ${bad}`
    }
  }
  return null
}
