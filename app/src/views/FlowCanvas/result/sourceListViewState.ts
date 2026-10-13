/**
 * 源列表「视图状态」（2026-10-12「我的视图」，方案 `设计稿/设计方案/1012-我的视图_开发设计方案_2026-10-12.md`）。
 *
 * SourceOverviewView 的筛选条件 + 排序 + 每页条数 + 隐藏的列。2026-10-13 目录版起「我的视图」只用其中的
 * 显示设置（隐藏列 / 排序 / 每页条数，见 sourceViews.ts 的 ViewDisplay），条件视图、另存为视图已撤掉。
 */
import { issueTagForWrite } from '@/utils/sourceMark'
import { sourceConditionParams, type SourceCondField, type SourceCondOp } from './sourceSearchField'
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
  }
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
