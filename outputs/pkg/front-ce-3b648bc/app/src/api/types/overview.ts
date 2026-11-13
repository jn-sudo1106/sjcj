// 总览域（P1-3 拆 8 域 · overview 域）
// 包含 WorkbenchSummary（工作台摘要）/ OverviewKpi（KPI 指标）/
//       OverviewSlice（占比/分布切片）/ OverviewTopSource（重点采集源）/
//       OverviewException（异常/待确认）/ OverviewPanoramaNode/Branch/Panorama（全景 3 件）/
//       OverviewSummary（总览聚合）/ TrendPoint（趋势点）
// 跨域被引用：几乎被所有上层 dashboard / cockpit 页面消费
// 跨域引用：RunState（OverviewTopSource.state / OverviewSlice.state 是 RunState | string）
// import type 严格模式

import type { RunState } from './common'

/** 工作台摘要项（首页摘要条） */
export interface WorkbenchSummary {
  label: string
  title?: string
  value?: string
  hint: string
  tone: string
}

/* ---------------- 采集资产总览（首页驾驶舱） ---------------- */

/** 总览 KPI —— 采集资产四类口径 + 运行 / 告警纳入 */
export interface OverviewKpi {
  sources: number // 采集源总数
  configs: number // 采集配置数
  tables: number // 实体表数
  params: number // 参数数
  successRate: string // 综合成功率，如 '98.6%'
  errorSources: number // 异常源数
  runningRuns: number // 运行中链路（纳入运行）
  alarms: number // 未恢复告警（纳入告警）
  newAssets7: number // 近 7 日新增资产
  /** KPI 同比/环比变化（后端未返回时前端 fallback 为空） */
  deltas?: Record<string, string>
}

/** 占比 / 分布通用切片（环形、柱状共用） */
export interface OverviewSlice {
  label: string
  value: number
  tone?: 'primary' | 'cyan' | 'indigo' | 'amber' | 'ok' | 'err' | 'muted'
  state?: RunState | string
}

/** 重点采集源行 */
export interface OverviewTopSource {
  sourceId: string
  name: string
  category: string
  state: RunState | string
  dataCount: number
  lastSuccessAt?: string
  /** 负责人（后端未返回时前端显示 '—'） */
  owner?: string
  /** 质量评分（后端未返回时前端显示 '—'） */
  qualityScore?: number
}

/** 异常 / 待确认条目（可下钻到采集资产源列表） */
export interface OverviewException {
  sourceId: string
  name: string
  kind: 'error' | 'external' | 'disabled' | 'alarm'
  text: string
  at?: string
}

/** 采集网站全景节点 —— 与采集资产分类树使用同一 categoryPath 口径 */
export interface OverviewPanoramaNode {
  id: string
  label: string
  total: number // 网站数
  sourceCount: number // 网站下源数
  error: number // 含异常源的网站数
}

/** 一级分类节点，children 为当前分类树的二级分支 */
export interface OverviewPanoramaBranch extends OverviewPanoramaNode {
  children: OverviewPanoramaNode[]
}

/** 采集网站全景聚合 */
export interface OverviewPanorama {
  total: number // 网站总数
  sourceCount: number // 源总数
  error: number // 异常网站数
  unclassified: number // 未进入任何一级分类的网站数
  branches: OverviewPanoramaBranch[]
}

/** 总览聚合返回（一次拉全，减少首屏请求） */
export interface OverviewSummary {
  kpi: OverviewKpi
  ecosystem: { sources: number; configs: number; tables: number; params: number }
  panorama: OverviewPanorama
  byCategory: OverviewSlice[] // 资产类型占比
  byCycle: OverviewSlice[] // 采集周期分布
  byState: OverviewSlice[] // 运行状态分布
  topSources: OverviewTopSource[]
  exceptions: OverviewException[]
  updatedAt: string // 总览更新时间
}

/** 采集任务趋势点 */
export interface TrendPoint {
  date: string // MM-DD
  snatch: number // 抓取量
  success: number // 成功量
}
