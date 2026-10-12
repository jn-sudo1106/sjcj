/**
 * 源列表「视图状态」（2026-10-12「我的视图」，方案 `设计稿/设计方案/1012-我的视图_开发设计方案_2026-10-12.md`）。
 *
 * 视图 = 用户自己保存的一套源列表查询：SourceOverviewView 的筛选条件 + 排序 + 每页条数 + 隐藏的列。
 * 存的是**条件**不是源 ID：之后新增的源只要符合条件，自动出现在视图里。
 * 后端只存取这段 JSON、不解析；`v` 是前端格式版本，以后条件栏改字段时由前端升级旧视图。
 */
import { issueTagForWrite } from '@/utils/sourceMark'
import {
  SOURCE_COND_FIELDS,
  sourceCondActive,
  sourceConditionParams,
  type SourceCondField,
  type SourceCondOp,
} from './sourceSearchField'
import type { SourceFilter } from './useSourceLaunch'

export type SourceStatusFilter = 'all' | 'C' | 'L' | 'E' | 'disabled'

export interface SourceListViewState {
  v: 1
  /** 查询条件行（字段 + 条件 + 值，行与行「并且」） */
  conditions: { field: SourceCondField; op: SourceCondOp; value: string }[]
  /** 网站：'' 不限，'-1' 未关联网站 */
  site: string
  /** 来源组：'' 不限 */
  sourceGroup: string
  status: SourceStatusFilter
  tag: string
  /** 数据量 ≤，'' = 不限（'0' 是有效条件） */
  countMax: string
  /** 排序字段（后端字段名，如 DATA_CNT），'' = 不排序 */
  sortField: string
  sortDirection: 'asc' | 'desc'
  pageSize: number
  /** 隐藏的列（HIDEABLE_SOURCE_COLUMNS 的 key） */
  hiddenColumns: string[]
  /**
   * 手选的源 ID 清单（2026-10-12 用户定 C：新建视图是空的，「添加源」手动挑）。
   * `null` / 缺省 = 条件视图（全部源按上面的条件筛，新增的源符合条件自动出现，「系统目录 → 另存为视图」存的就是这种）；
   * 数组 = 手选清单，**条件栏在这份清单里再筛一遍**（取交集）；空数组 = 还没添加源，不发请求直接空态。
   */
  scopeIds?: string[] | null
}

export function blankSourceListViewState(): SourceListViewState {
  return {
    v: 1,
    conditions: [{ field: 'sourceIds', op: 'eq', value: '' }],
    site: '',
    sourceGroup: '',
    status: 'all',
    tag: '',
    countMax: '',
    sortField: '',
    sortDirection: 'asc',
    pageSize: 20,
    hiddenColumns: [],
    scopeIds: null,
  }
}

/** 新建视图的初始状态：手选清单，一个源都没有 */
export function emptyManualViewState(): SourceListViewState {
  return { ...blankSourceListViewState(), scopeIds: [] }
}

/** 可在「显示设置」里隐藏的列；源 ID、源名称固定显示。groupOps 只在开了来源组能力的列表里有。 */
export const HIDEABLE_SOURCE_COLUMNS: { key: string; label: string; groupOps?: true }[] = [
  { key: 'site', label: '所属网站' },
  { key: 'sourceGroup', label: '来源组', groupOps: true },
  { key: 'defaultFlow', label: '默认流程', groupOps: true },
  { key: 'flowConfig', label: '流程配置', groupOps: true },
  { key: 'url', label: 'URL' },
  { key: 'mainTable', label: '主表' },
  { key: 'tags', label: '标签' },
  { key: 'dataCount', label: '数据' },
  { key: 'newIn', label: '新入' },
  { key: 'success', label: '成功' },
  { key: 'lastTask', label: '最近任务' },
  { key: 'lastSuccess', label: '最近成功' },
  { key: 'state', label: '状态' },
  { key: 'remark', label: '备注' },
]

export const SOURCE_SORT_FIELDS: { value: string; label: string }[] = [
  { value: 'SOURCE_ID', label: '源 ID' },
  { value: 'DATA_CNT', label: '数据' },
  { value: 'LAST_RUN', label: '最近任务' },
  { value: 'LAST_SUCCESS', label: '最近成功' },
]

/** 空 / 非法 / 负数都当没填；`0` 要保留（"一条数据都没有的源"是个真条件） */
export function parseCountMax(raw: string | number | undefined): number | undefined {
  const text = String(raw ?? '').trim()
  if (!text) return undefined
  const n = Number(text)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/**
 * 视图状态 → sourcePaged 查询参数（不含页码，不含各页签的固定范围）。
 * 与 SourceOverviewView.currentQuery 同一口径：那边在此基础上叠加当前网站 / 页签范围。
 */
export function viewStateFilter(state: SourceListViewState): SourceFilter {
  const cond = sourceConditionParams(state.conditions)
  const sorted = !!state.sortField
  return {
    siteIds: state.site || undefined,
    sourceIds: cond.sourceIds,
    flowId: cond.flowId,
    sourceGroupId: state.sourceGroup || undefined,
    defaultFlowId: cond.defaultFlowId,
    name: cond.name,
    sourceUrl: cond.sourceUrl,
    state: state.status === 'all' || state.status === 'disabled' ? undefined : state.status,
    enable: state.status === 'disabled' ? '1' : state.status === 'all' ? undefined : '0',
    tags: state.tag ? [issueTagForWrite(state.tag)].filter(Boolean) : [],
    remark: cond.remark,
    count: parseCountMax(state.countMax),
    field: sorted ? state.sortField : undefined,
    sorted: sorted ? (state.sortDirection === 'asc' ? 1 : -1) : undefined,
    type: sorted ? (state.sortDirection === 'asc' ? 'ASC' : 'DESC') : undefined,
  }
}

/** 比较两份视图状态是否等价（判断「有未保存的修改」）：空条件行不算差异 */
export function sameViewState(a: SourceListViewState, b: SourceListViewState): boolean {
  const norm = (s: SourceListViewState) => JSON.stringify({
    ...s,
    conditions: s.conditions.filter(sourceCondActive).map((c) => ({ field: c.field, op: c.op, value: c.value.trim() })),
    countMax: String(s.countMax ?? '').trim(),
    hiddenColumns: [...s.hiddenColumns].sort(),
    scopeIds: s.scopeIds ? [...new Set(s.scopeIds)].sort() : null,
  })
  return norm(a) === norm(b)
}

const STATUS_LABEL: Record<SourceStatusFilter, string> = { all: '', C: '正常', L: '运行中', E: '异常', disabled: '已停用' }
const OP_LABEL: Record<SourceCondOp, string> = { eq: '等于', like: '包含', notEmpty: '非空', empty: '为空' }

/** 条件摘要（视图头部的小标签）。names 用来把网站 / 来源组 ID 换成名称。 */
export function describeViewState(state: SourceListViewState, names: { site?: (id: string) => string; group?: (id: string) => string } = {}): string[] {
  const parts: string[] = state.scopeIds ? [`手选 ${state.scopeIds.length} 个源`] : []
  parts.push(...state.conditions.filter(sourceCondActive).map((c) => {
    const label = SOURCE_COND_FIELDS.find((f) => f.value === c.field)?.label ?? c.field
    return c.op === 'notEmpty' || c.op === 'empty' ? `${label}${OP_LABEL[c.op]}` : `${label}${OP_LABEL[c.op]}「${c.value.trim()}」`
  }))
  if (state.site) parts.push(`网站 = ${state.site === '-1' ? '未关联网站' : names.site?.(state.site) || state.site}`)
  if (state.sourceGroup) parts.push(`来源组 = ${names.group?.(state.sourceGroup) || state.sourceGroup}`)
  if (state.status !== 'all') parts.push(`状态 = ${STATUS_LABEL[state.status]}`)
  if (state.tag) parts.push(`标签 = ${state.tag}`)
  const count = parseCountMax(state.countMax)
  if (count != null) parts.push(`数据量 ≤ ${count}`)
  return parts
}
