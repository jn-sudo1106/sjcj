// 数据中心「选择源」弹窗的查询参数（1021-05，设计方案 §5.1）：跟源管理源列表同一口径，
// 同一筛选下两边 sourcePaged 的参数一样、总数一样。参数直接复用源管理的 viewStateFilter，
// 不在这里另拼一份——以前弹窗自己拼（默认只看在用、分类不含子级、根上混着 -1 / -2 两棵树），所以数对不上。
import {
  blankSourceListViewState,
  viewStateFilter,
  type SourceStatusFilter,
} from '@/views/FlowCanvas/result/sourceListViewState'
import { defaultSourceCondOp } from '@/views/FlowCanvas/result/sourceSearchField'
import { scopedSourceIds } from '@/views/FlowCanvas/result/sourceScope'
import type { SourceFilter } from '@/views/FlowCanvas/result/useSourceLaunch'

/**
 * 状态筛选：源管理的五项（全部 / 正常 / 运行中 / 异常 / 已停用）原样保留，另加「在用」（只看启停 = 在用）。
 * 源管理里正常 / 运行中 / 异常本来就带 enable=0，即只看在用源里的运行状态。
 */
export type PickerStatus = SourceStatusFilter | 'enabled'

export interface PickerFilter {
  /** 源 ID，可多个（逗号 / 空格分隔） */
  sourceIds: string
  name: string
  sourceUrl: string
  /** 网站：'' 不限，'-1' 未关联网站 */
  site: string
  /** 来源组：'' 不限 */
  sourceGroup: string
  status: PickerStatus
  /** 数据量 ≤，'' 不限 */
  countMax: string
}

/** 左侧目录范围：系统目录给分类 ID（已含子级），业务目录给目录里的源 ID；都不给 = 不按目录筛 */
export interface PickerDirScope {
  categoryIds?: string[]
  sourceIds?: string[]
}

export function blankPickerFilter(): PickerFilter {
  return { sourceIds: '', name: '', sourceUrl: '', site: '', sourceGroup: '', status: 'all', countMax: '' }
}

/** 返回的 sourceIds === '' 表示目录范围里一个都对不上，调用方直接给空列表、不发请求（同源管理） */
export function pickerSourceQuery(filter: PickerFilter, dir: PickerDirScope = {}): SourceFilter {
  const base = viewStateFilter({
    ...blankSourceListViewState(),
    conditions: [
      { field: 'sourceIds', op: 'eq', value: filter.sourceIds.split(/[，,\s]+/).filter(Boolean).join(',') },
      { field: 'name', op: defaultSourceCondOp('name'), value: filter.name },
      { field: 'sourceUrl', op: defaultSourceCondOp('sourceUrl'), value: filter.sourceUrl },
    ],
    site: filter.site,
    sourceGroup: filter.sourceGroup,
    status: filter.status === 'enabled' ? 'all' : filter.status,
    countMax: filter.countMax,
  })
  return {
    ...base,
    ...(filter.status === 'enabled' ? { enable: '0' } : {}),
    sourceIds: scopedSourceIds(dir.sourceIds, base.sourceIds),
    ...(dir.categoryIds?.length ? { categorys: dir.categoryIds.join(',') } : {}),
  }
}
