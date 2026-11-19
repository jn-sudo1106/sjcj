// 智能体对话建表：草稿协议、归一化、校验与落库组装。
//
// 设计：设计稿/设计方案/1118-智能体对话建源建表_开发设计方案_2026-11-18.md
// 智能体只出草稿，不碰写接口；用户在对话卡片里确认后，前端走与数据中心「新建表」相同的
// entryApi.entrySave → config/entryTypeAddAll 落库（生产写保护白名单、旧契约适配都复用）。
//
// 草稿来源（任一即可）：
//   1. 回答正文里的 ```table-draft 代码块（当前可用：前端在「建表模式」下给问题追加格式要求）
//   2. SSE 顶层 tableDraft / proposal.table 字段（后端草稿工具就绪后的正式契约，见设计文档第六节）
import { entryApi, type EntryField, type EntryType } from '@/api'
import { ENTRY_FIELD_DEFAULT_WIDTH } from '@/constants/entry'
import { storagePayload } from '@/utils/data/entryStorage'

/**
 * 与数据中心「数据表编辑」一致：旧平台 dataType 只有这三种（0828 表编辑迁移核对订正，
 * 自造的 url/number/date/json 已去掉）。智能体给的其他类型在归一化时映射进来。
 */
export const TABLE_DRAFT_FIELD_TYPES = ['string', 'text', 'longtext'] as const
export type TableDraftFieldType = (typeof TABLE_DRAFT_FIELD_TYPES)[number]

export interface TableDraftField {
  /** 字段编码（小写英文），落库为旧平台约定的「编码-列号」 */
  code: string
  /** 中文展示名 */
  desc: string
  type: TableDraftFieldType
  /** 去重字段 */
  dedup: boolean
}

export interface TableDraft {
  /** 表中文名 */
  name: string
  /** 物理表名 */
  tableName: string
  dsKind: 'MYSQL' | 'CK'
  /** 去重方式：源内 / 表内（同「数据表编辑」），缺省源内 */
  dedupMode?: 'source' | 'table'
  remark: string
  fields: TableDraftField[]
}

export type TableDraftStatus = 'pending' | 'creating' | 'created' | 'failed' | 'cancelled'

/** 挂在对话消息上的建表草稿状态 */
export interface TableDraftState {
  draft: TableDraft
  status: TableDraftStatus
  tableId?: string
  error?: string
}

/** 链接 / 数值 / 日期在旧平台都按 string 存；JSON、大段正文归 longtext */
const TYPE_ALIASES: Record<string, TableDraftFieldType> = {
  string: 'string', varchar: 'string', char: 'string', str: 'string', 字符串: 'string', 文本: 'string',
  url: 'string', link: 'string', 链接: 'string',
  number: 'string', int: 'string', integer: 'string', bigint: 'string', float: 'string', double: 'string',
  decimal: 'string', numeric: 'string', 数值: 'string', 数字: 'string',
  date: 'string', datetime: 'string', timestamp: 'string', time: 'string', 日期: 'string', 时间: 'string',
  text: 'text', 长文本: 'text',
  longtext: 'longtext', mediumtext: 'longtext', 大文本: 'longtext', 正文: 'longtext',
  json: 'longtext', object: 'longtext', array: 'longtext',
}

function str(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function normalizeFieldType(value: unknown): TableDraftFieldType {
  const key = str(value).toLowerCase().replace(/\(.*\)$/, '')
  return TYPE_ALIASES[key] ?? 'string'
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true' || value === '是'
}

/** 把智能体给的草稿（字段名有出入也认）归一成 TableDraft；连字段都没有返回 null */
export function normalizeTableDraft(raw: unknown): TableDraft | null {
  if (!raw || typeof raw !== 'object') return null
  const src = raw as Record<string, unknown>
  const nested = src.table ?? src.tableDraft ?? src.table_draft
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) return normalizeTableDraft(nested)

  const rawFields = src.fields ?? src.items ?? src.columns
  if (!Array.isArray(rawFields) || rawFields.length === 0) return null
  const fields: TableDraftField[] = rawFields
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => {
      const code = str(item.code ?? item.prop ?? item.itemCode ?? item.name ?? item.column)
      return {
        code,
        desc: str(item.desc ?? item.label ?? item.itemName ?? item.comment ?? item.title) || code,
        type: normalizeFieldType(item.type ?? item.dataType),
        dedup: truthy(item.dedup ?? item.uniqueKey ?? item.unique),
      }
    })
  if (!fields.length) return null

  const dsKind = /^(ck|clickhouse)$/i.test(str(src.dsKind ?? src.storage ?? src.db)) ? 'CK' : 'MYSQL'
  return {
    name: str(src.name ?? src.typeName ?? src.label ?? src.title),
    tableName: str(src.tableName ?? src.physicalTable ?? src.table_name),
    dsKind,
    dedupMode: /^(table|表内(去重)?)$/i.test(str(src.dedupMode ?? src.dedup_mode)) ? 'table' : 'source',
    remark: str(src.remark ?? src.description ?? src.comment),
    fields,
  }
}

const DRAFT_FENCE = /```table-draft\s*\n?([\s\S]*?)```/i

/** 从回答正文取 ```table-draft 代码块里的草稿（取最后一个；流式未闭合不算） */
export function extractTableDraftFromText(text: string): TableDraft | null {
  if (!text || !/```table-draft/i.test(text)) return null
  const all = [...text.matchAll(new RegExp(DRAFT_FENCE.source, 'gi'))]
  for (let i = all.length - 1; i >= 0; i--) {
    const draft = normalizeTableDraft(parseDraftJson(all[i][1]))
    if (draft) return draft
  }
  return null
}

/** 先按标准 JSON 解析，失败再修一次括号；仍不行返回 null（继续找上一个代码块） */
function parseDraftJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    try {
      return JSON.parse(repairJsonBrackets(raw))
    } catch {
      return null
    }
  }
}

/**
 * 修模型手写 JSON 里常见的括号错位：数组用 `}` 收尾（186 实测：fields 数组写成 `  }\n}`）、
 * 去掉尾逗号、末尾缺的括号补齐。只动字符串之外的括号，字段内容不改。
 */
export function repairJsonBrackets(raw: string): string {
  const stack: string[] = []
  let out = ''
  let inString = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (inString) {
      out += ch
      if (ch === '\\') {
        out += raw[++i] ?? ''
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
    } else if (ch === '{' || ch === '[') {
      stack.push(ch === '{' ? '}' : ']')
      out += ch
    } else if (ch === '}' || ch === ']') {
      // 错位的收尾括号按栈顶期望的来；多余的收尾括号丢掉
      if (stack.length) out += stack.pop()
    } else {
      out += ch
    }
  }
  while (stack.length) out += stack.pop()
  return out.replace(/,(\s*[}\]])/g, '$1')
}

/** 渲染正文时去掉草稿代码块（由卡片承载）；流式中未闭合的块也一起藏掉，避免闪 JSON */
export function stripTableDraftBlock(text: string): string {
  if (!text) return text
  return text
    .replace(new RegExp(DRAFT_FENCE.source, 'gi'), '')
    .replace(/```table-draft[\s\S]*$/i, '')
    .trim()
}

/** SSE 事件载荷里的结构化草稿（后端草稿工具契约，顶层 tableDraft 或 proposal.table） */
export function tableDraftFromPayload(payload: unknown): TableDraft | null {
  if (!payload || typeof payload !== 'object') return null
  const src = payload as Record<string, unknown>
  const proposal = src.proposal as Record<string, unknown> | undefined
  const candidate = src.tableDraft ?? src.table_draft ?? proposal?.table
  return candidate ? normalizeTableDraft(candidate) : null
}

const TABLE_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const FIELD_CODE_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/

/** 提交前校验；返回问题列表，空数组才允许确认创建 */
export function validateTableDraft(draft: TableDraft): string[] {
  const errors: string[] = []
  if (!draft.name.trim()) errors.push('表名称必填')
  if (!draft.tableName.trim()) errors.push('物理表名必填')
  else if (!TABLE_NAME_RE.test(draft.tableName.trim())) errors.push('物理表名只能用字母、数字、下划线，且以字母开头')
  if (!draft.fields.length) errors.push('至少需要一个字段')
  draft.fields.forEach((field, index) => {
    const row = `第 ${index + 1} 个字段`
    if (!field.code.trim()) errors.push(`${row}编码为空`)
    else if (!FIELD_CODE_RE.test(field.code.trim())) errors.push(`${row}编码「${field.code}」只能用字母、数字、下划线`)
    if (!field.desc.trim()) errors.push(`${row}展示名为空`)
  })
  const codes = draft.fields.map((f) => f.code.trim().toLowerCase()).filter(Boolean)
  const dup = codes.find((code, i) => codes.indexOf(code) !== i)
  if (dup) errors.push(`字段编码重复：${dup}`)
  return errors
}

/**
 * 草稿 → entrySave 入参。口径与源上「新建数据表」（TableEditDialog）一致：
 * 物理列按 K1..Kn 顺序分配，属性存成旧平台约定的「编码-列号」，去重列由勾选字段的物理列拼出。
 */
export function tableDraftToEntry(draft: TableDraft): EntryType {
  const fields: EntryField[] = draft.fields.map((field, index) => {
    const columnName = `K${index + 1}`
    return {
      prop: `${field.code.trim()}-${columnName}`,
      desc: field.desc.trim(),
      type: field.type,
      required: false,
      width: ENTRY_FIELD_DEFAULT_WIDTH,
      dedup: field.dedup || undefined,
      columnName,
      seq: index + 1,
    }
  })
  return {
    tableId: '',
    name: draft.name.trim(),
    tableName: draft.tableName.trim(),
    remark: draft.remark.trim(),
    dedupMode: draft.dedupMode === 'table' ? 'table' : 'source',
    state: 'C',
    keyField: fields.filter((f) => f.dedup).map((f) => f.columnName).join(','),
    ...storagePayload({ dsKind: draft.dsKind }),
    fields,
  }
}

/** 确认后真实建表；失败抛出后端原始报错（生产写保护、重名等），由卡片如实展示 */
export async function createTableFromDraft(
  draft: TableDraft,
  save: (entry: EntryType) => Promise<{ tableId: string; message: string }> = entryApi.entrySave,
): Promise<{ tableId: string; message: string }> {
  const errors = validateTableDraft(draft)
  if (errors.length) throw new Error(errors[0])
  const result = await save(tableDraftToEntry(draft))
  if (!result.tableId) throw new Error(`${result.message || '保存接口未返回表 ID'}，请到数据中心按物理表名确认是否已创建，勿重复提交`)
  return result
}

// ===== 「建表模式」：前端给问题追加格式要求，让现有智能体输出草稿 =====

/** 追加在用户原文后的分隔标记；历史记录回放时据此还原用户原文 */
export const TABLE_DRAFT_INSTRUCTION_MARKER = '<!-- table-draft-mode -->'

export function buildTableDraftPrompt(userText: string): string {
  return `${userText.trim()}

${TABLE_DRAFT_INSTRUCTION_MARKER}
【建表模式】请根据上面的需求设计一张采集数据表。只输出草稿，不要执行 SQL、不要查询数据、不要实际建表。
可以先用检索表的工具确认库里没有用途相同的表；如果已有，请在说明里指出表名。
先用一两句话说明设计思路，然后输出一个 \`\`\`table-draft 代码块，内容是一个 JSON 对象：
{"name":"表中文名","tableName":"物理表名，TB_ 开头的大写英文或拼音首字母","dsKind":"MYSQL 或 CK（用户提到 ClickHouse、CK、大数据量分析时用 CK，否则 MYSQL）","remark":"用途说明","fields":[{"code":"小写英文编码","desc":"中文名","type":"string|text|longtext","dedup":false}]}
要求：fields 不含 ENTRY_ID、创建时间等系统字段；code 只用小写字母、数字、下划线且不重复；能唯一标识一条数据的字段 dedup 设为 true（至少一个）；type 只有 string（短文本，链接/数值/日期也用它）、text、longtext（正文、JSON）三种。`
}

/** 历史回放：去掉建表模式追加的格式要求，只显示用户原文 */
export function stripTableDraftPrompt(text: string): string {
  if (!text) return text
  const idx = text.indexOf(TABLE_DRAFT_INSTRUCTION_MARKER)
  return idx >= 0 ? text.slice(0, idx).trim() : text
}

export function isTableDraftPrompt(text: string): boolean {
  return !!text && text.includes(TABLE_DRAFT_INSTRUCTION_MARKER)
}

// ===== 建表结果回传：既告诉智能体，也是历史回放时判定「草稿已建」的依据 =====

const CREATED_PREFIX = '【建表结果】'

/**
 * 回传消息带上用户最终确认的名称、存储类型和字段：用户可能在卡片里改过草稿，
 * 不带的话智能体会按自己最初的草稿复述（186 实测：卡片改成 MySQL，智能体仍说「CK 存储」）。
 */
export function formatTableCreatedMessage(draft: TableDraft, tableId: string): string {
  const storage = draft.dsKind === 'CK' ? 'CK' : 'MySQL'
  const fields = draft.fields.map((f) => `${f.code.trim()}（${f.desc.trim()}${f.dedup ? '，去重' : ''}）`).join('、')
  return `${CREATED_PREFIX}已创建数据表「${draft.name.trim()}」，物理表 ${draft.tableName.trim()}，表 ID ${tableId}，存储 ${storage}，字段 ${fields}。以上为用户在卡片中最终确认的版本，与之前的草稿不同时以此为准。`
}

export interface TableCreatedInfo {
  tableName: string
  tableId: string
  name?: string
  dsKind?: 'MYSQL' | 'CK'
}

export function parseTableCreatedMessage(text: string): TableCreatedInfo | null {
  if (!text?.startsWith(CREATED_PREFIX)) return null
  const m = /物理表\s+([A-Za-z0-9_]+)，表 ID\s+(\d+)/.exec(text)
  if (!m) return null
  const info: TableCreatedInfo = { tableName: m[1], tableId: m[2] }
  const name = /已创建数据表「([^」]+)」/.exec(text)?.[1]
  if (name) info.name = name
  const storage = /存储\s+(MySQL|CK)/i.exec(text)?.[1]
  if (storage) info.dsKind = /^ck$/i.test(storage) ? 'CK' : 'MYSQL'
  return info
}
