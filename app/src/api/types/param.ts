// 参数域（P1-3 拆 8 域 · param 域）
// 包含 ParamKind（参数来源类型）/ Param（参数定义）/ ParamValue（参数取值）/
//       ParamInput（参数编辑入参，Omit 派生）
// 跨域被引用：collect.Config.paramRefs: string[]（只引 ID，不引类型）
// 跨域引用：无（plan §C.1 备注「Param 引用 Source」已过时——
//               Param.paramSourceRefs 是 inline { sourceId; sourceName }[]，不直接引 Source 类型）
// 无外部 import。

/** 参数来源类型：与原系统参数列表一致。 */
export type ParamKind = 'list' | 'date' | 'sequence' | 'date_sequence' | 'database'

/** 参数定义：全局管理，节点只保存 paramId 绑定关系。 */
export interface Param {
  paramId: string
  name: string
  group?: string
  kind: ParamKind
  values?: string[] // 列表或数据库预览值
  defaultValue?: string
  dateExpr?: string // $CUR_DATE,偏移,格式
  seq?: { start: number; end: number; step: number }
  databaseQuery?: string
  valueDef?: string // 旧平台原始 valueDef 字段，仅用于列表页"值定义"列展示；list/date 类型后端不落此字段
  tableName?: string
  colName?: string
  valueItems?: ParamValue[]
  usedBy?: number // 被多少配置引用（旧平台口径，与下面的参数源绑定是两回事，不要混用）
  owner?: string
  updatedAt?: string
  /** 参数源绑定关系（0721 会议 T6）：这个参数被哪些参数源引用，mock 从 Source.paramRefs 实时派生，不单独持久化避免脏读 */
  paramSourceRefs?: { sourceId: string; sourceName: string }[]
}

export interface ParamValue {
  valueId: string
  seq: number
  value: string
}

export type ParamInput = Omit<Param, 'paramId' | 'usedBy' | 'updatedAt'> & { paramId?: string }
