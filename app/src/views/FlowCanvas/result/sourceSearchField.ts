/**
 * 源视图查询框的字段自动识别（2026-09-28 产品：「选择要点 2 下」「url 这种可以自动识别」）。
 *
 * 0917-11 把源 ID / 源名称 / 源 URL 并成「字段 ▾ ＋ 一个输入框」时刻意做成手动选字段，
 * 理由是猜错会静默漏结果（实测 `name=centec` 0 条、`sourceUrl=centec` 1 条）。
 * 现在改成**能明确判断的才自动**，说不准的（单个英文词）按名称查，查空了再提示改按 URL——
 * 见 SourceOverviewView 的 urlFallback。下拉框保留并跟着切，用户看得到按什么查，也能手动改。
 */
export type SourceSearchField = 'sourceIds' | 'name' | 'sourceUrl'

/** 纯数字，或用逗号 / 中文逗号 / 空白分隔的一串数字 */
const IDS = /^\d+(?:\s*[,，\s]\s*\d+)*$/
/** 明确的网址开头 */
const URL_PREFIX = /^(?:https?:\/\/|www\.)/i
/** 形如 `xxx.com`、`a.b.cn/path`：最后一段是 2 个以上字母的域名后缀；避免把「v2.0」这类当网址 */
const DOMAIN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i

export function detectSourceSearchField(text: string): SourceSearchField | null {
  const value = text.trim()
  if (!value) return null
  if (IDS.test(value)) return 'sourceIds'
  if (URL_PREFIX.test(value) || DOMAIN.test(value)) return 'sourceUrl'
  return 'name'
}

/**
 * 按名称没查到时，要不要提示「改按 URL 查」：只对**可能是网址片段**的输入——
 * 一个不含空白、全是可见 ASCII 的词（如 `centec`、`sanyoumed`）。含中文的肯定不是网址，不提示。
 */
export function mightBeUrlFragment(text: string): boolean {
  return /^[\x21-\x7e]+$/.test(text.trim())
}

/**
 * 源视图「查询」多条件（2026-09-28 产品：「改成和数据搜索一样」）。
 *
 * 每行 = 字段 ＋ 条件 ＋ 值，行与行之间是「并且」。后端 sourcePaged 的源 ID / 名称 / URL / 备注
 * 是四个独立参数，一起给取交集（实测 `name=盛科` 4 条、`sourceUrl=centec` 1 条、同时给 1 条），
 * 所以能并行；但**一个参数只能带一个值**——同一字段只能出现一行，也做不了「或者」。
 *
 * 条件口径都是后端现成的：
 * - 备注 非空 = `remark=%`、为空 = `remark=NULL`（2026-09-21 实测，站 12：8 + 5883 = 全部 5891）；
 * - 源 URL 非空 = `sourceUrl=NOT NULL`、为空 = `sourceUrl=NULL`（后端 2026-09-29 上线，不区分大小写，
 *   source-api.md §1.1）。实测站 12：全部 6028 = NULL 393 + NOT NULL 5635。
 *   ⚠️ 与备注的「非空」口径不同（备注是 `%`），每个字段各按后端约定发，见 NOT_EMPTY_VALUE。
 *   （09-28 那次测 `sourceUrl=NULL` 只 LIKE 到字面 "null"，是后端还没上线。）
 * - 流程 ID 等于 = `flowId`（0930-15，会后 Leon：「可以根据流程查有哪些源」）。2026-09-02 实测：
 *   flowId=1400330 得 46 条、与该流程 sourceCnt 一致，传不存在的得 0 条，不是静默忽略。
 *   只能手动选，不参与自动识别（纯数字一律按源 ID）。放最后，免得「＋」加行时先加出它来。
 */
export type SourceCondField = SourceSearchField | 'remark' | 'entryTypeId' | 'flowId' | 'defaultFlowId' | 'configId'
export type SourceCondOp = 'eq' | 'like' | 'notEmpty' | 'empty'

export interface SourceCondition {
  field: SourceCondField
  op: SourceCondOp
  value: string
}

export interface SourceCondOpOption {
  value: SourceCondOp
  label: string
  /** 后端暂不支持的条件：列出来但不能选 */
  unsupported?: string
}

export const SOURCE_COND_FIELDS: { value: SourceCondField; label: string; placeholder: string; ops: SourceCondOpOption[] }[] = [
  { value: 'sourceIds', label: '源 ID', placeholder: '多个 ID 用换行或逗号分隔', ops: [{ value: 'eq', label: '等于' }] },
  { value: 'name', label: '源名称', placeholder: '源名称关键字', ops: [{ value: 'like', label: '包含' }] },
  {
    value: 'sourceUrl',
    label: '源 URL',
    placeholder: 'URL 关键字，如 centec',
    ops: [
      { value: 'like', label: '包含' },
      { value: 'notEmpty', label: '非空' },
      { value: 'empty', label: '为空' },
    ],
  },
  {
    value: 'remark',
    label: '备注',
    placeholder: '备注关键字',
    ops: [
      { value: 'like', label: '包含' },
      { value: 'notEmpty', label: '非空' },
      { value: 'empty', label: '为空' },
    ],
  },
  // 1022 会议：按表查源。sourcePaged 的 `entryTypeId`（source-api.md §1.1），匹配源的主表；
  // 只能手动选，不参与自动识别（纯数字一律按源 ID）。
  { value: 'entryTypeId', label: '主表 ID', placeholder: '表 ID，如 6200029', ops: [{ value: 'eq', label: '等于' }] },
  { value: 'flowId', label: '关联流程 ID', placeholder: '流程 ID，如 14009350', ops: [{ value: 'eq', label: '等于' }] },
  // 1008-04 默认流程筛选：sourcePaged 认 `defaultFlowId`（2026-10-09 实测：只匹配默认流程，
  // 与 flowId 的「任一生效关联」不同）。只能手动选，不参与自动识别；放最后。
  { value: 'defaultFlowId', label: '默认流程 ID', placeholder: '流程 ID，如 14009350', ops: [{ value: 'eq', label: '等于' }] },
  // 1104 按配置查源：旧平台源列表的「配置」筛选（`0828-源视图迁移核对` §1 记的缺口）。
  // source-api.md §1.1 的 SourceCond 生效字段含 `configId`（Long，后端内部反查主配置），
  // 用来查「这份配置被哪些源用」。只能手动选，不参与自动识别（纯数字一律按源 ID）；放最后。
  { value: 'configId', label: '配置 ID', placeholder: '配置 ID，如 1400765', ops: [{ value: 'eq', label: '等于' }] },
]

export function sourceCondFieldOf(field: SourceCondField) {
  return SOURCE_COND_FIELDS.find((f) => f.value === field)!
}

/**
 * 只能手动选、不参与「按输入内容自动识别」的字段。
 * 自动识别只认源 ID / 名称 / URL（见文件头）：纯数字一律算源 ID，这几个 ID 类字段和备注
 * 一旦插进来就会被自动改掉，静默漏结果；所以它们只从下拉里选，选完 `pinned` 生效。
 */
export const MANUAL_ONLY_COND_FIELDS: SourceCondField[] = ['remark', 'entryTypeId', 'flowId', 'defaultFlowId', 'configId']

/** 字段的默认条件：第一个后端支持的 */
export function defaultSourceCondOp(field: SourceCondField): SourceCondOp {
  return sourceCondFieldOf(field).ops.find((o) => !o.unsupported)!.value
}

/** 非空 / 为空不需要填值 */
export function sourceCondNeedsValue(op: SourceCondOp): boolean {
  return op === 'eq' || op === 'like'
}

/** 这一行会不会变成请求参数：要值的条件没填值，等于没有这一行 */
export function sourceCondActive(cond: SourceCondition): boolean {
  if (!sourceCondFieldOf(cond.field).ops.some((o) => o.value === cond.op && !o.unsupported)) return false
  return sourceCondNeedsValue(cond.op) ? !!cond.value.trim() : true
}

/** 「非空」各字段的后端约定：备注是 LIKE `%`（2026-09-21 实测），源 URL 是 `NOT NULL`（2026-09-29 上线） */
const NOT_EMPTY_VALUE: Partial<Record<SourceCondField, string>> = { remark: '%', sourceUrl: 'NOT NULL' }

export function sourceConditionParams(conds: SourceCondition[]): Partial<Record<SourceCondField, string>> {
  const params: Partial<Record<SourceCondField, string>> = {}
  for (const cond of conds) {
    if (!sourceCondActive(cond)) continue
    params[cond.field] = cond.op === 'notEmpty' ? (NOT_EMPTY_VALUE[cond.field] ?? '%')
      : cond.op === 'empty' ? 'NULL'
        : cond.field === 'sourceIds' ? cond.value.trim().split(/[，,\s]+/).filter(Boolean).join(',')
          : cond.value.trim()
  }
  return params
}
