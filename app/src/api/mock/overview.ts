import type {
  OverviewSummary,
  OverviewSlice,
  OverviewTopSource,
  OverviewException,
  OverviewPanorama,
  OverviewPanoramaNode,
  TrendPoint,
  Source,
  SourceCategory,
  Site,
} from '../types'
import { mockSourcePaged, mockSourceStats, mockSourceCategories } from './sources'
import { mockSitePaged } from './sites'
import { mockConfigPaged } from './configs'
import { mockEntryPaged } from './entries'
import { mockParamPaged } from './params'
import { mockRunStats } from './runs'
import { mockAlarms } from './monitor'

// 总览聚合 mock —— 全部口径由各模块 mock 实时统计，保证与采集资产各列表页对账一致。
// 真接入时该端点可由 BFF 聚合，path 不变。

function allSources(): Source[] {
  return mockSourcePaged({ size: 999 }).list
}

function panoramaNode(id: string, label: string, sites: Site[]): OverviewPanoramaNode {
  return {
    id,
    label,
    total: sites.length,
    sourceCount: sites.reduce((sum, site) => sum + site.sourceCount, 0),
    error: sites.filter((site) => site.errorCount > 0).length,
  }
}

export function buildWebsitePanorama(sites: Site[], categories: SourceCategory[]): OverviewPanorama {
  const branches = categories.map((category) => {
    const branchSites = sites.filter((site) => site.categoryPath?.startsWith(category.id))
    const children = (category.children ?? []).map((child) =>
      panoramaNode(child.id, child.name, branchSites.filter((site) => site.categoryPath?.startsWith(child.id))),
    )
    const uncategorized = branchSites.filter(
      (site) => !(category.children ?? []).some((child) => site.categoryPath?.startsWith(child.id)),
    )
    if (uncategorized.length) {
      children.push(panoramaNode(`${category.id}/__unclassified__`, '未细分', uncategorized))
    }
    return {
      ...panoramaNode(category.id, category.name, branchSites),
      children,
    }
  })
  const unclassified = sites.filter(
    (site) => !categories.some((category) => site.categoryPath?.startsWith(category.id)),
  ).length

  return {
    total: sites.length,
    sourceCount: sites.reduce((sum, site) => sum + site.sourceCount, 0),
    error: sites.filter((site) => site.errorCount > 0).length,
    unclassified,
    branches,
  }
}

function sliceByCategory(): OverviewSlice[] {
  const tones: OverviewSlice['tone'][] = ['primary', 'cyan', 'indigo', 'amber', 'ok']
  return mockSourceCategories()
    .flatMap((c) => c.children ?? [])
    .map((c, i) => ({
      label: c.name,
      value: c.count ?? 0,
      tone: tones[i % tones.length],
    }))
}

function sliceByCycle(sources: Source[]): OverviewSlice[] {
  const order: { key: string; tone: OverviewSlice['tone'] }[] = [
    { key: '实时', tone: 'primary' },
    { key: '每日', tone: 'cyan' },
    { key: '每周', tone: 'indigo' },
    { key: '每月', tone: 'amber' },
  ]
  return order.map(({ key, tone }) => ({
    label: key,
    value: sources.filter((s) => s.cycle === key).length,
    tone,
  }))
}

function sliceByState(sources: Source[]): OverviewSlice[] {
  const active = sources.filter((s) => !s.disabled)
  return [
    { label: '成功', value: active.filter((s) => s.state === 'C').length, tone: 'ok' },
    { label: '运行中', value: active.filter((s) => s.state === 'L').length, tone: 'primary' },
    { label: '出错', value: active.filter((s) => s.state === 'E').length, tone: 'err' },
    { label: '已停用', value: sources.filter((s) => s.disabled).length, tone: 'muted' },
  ]
}

function topSources(sources: Source[]): OverviewTopSource[] {
  return [...sources]
    .sort((a, b) => (b.dataCount ?? 0) - (a.dataCount ?? 0))
    .slice(0, 6)
    .map((s) => ({
      sourceId: s.sourceId,
      name: s.name,
      category: s.categoryPath?.split('/').filter(Boolean).pop() || '—',
      state: s.disabled ? 'D' : s.state,
      dataCount: s.dataCount ?? 0,
      lastSuccessAt: s.lastSuccessAt,
    }))
}

function exceptions(sources: Source[]): OverviewException[] {
  const out: OverviewException[] = []
  for (const s of sources) {
    if (!s.disabled && s.state === 'E') {
      out.push({ sourceId: s.sourceId, name: s.name, kind: 'error', text: s.remark || '采集出错', at: s.lastTaskAt })
    } else if (s.externalChanged) {
      out.push({ sourceId: s.sourceId, name: s.name, kind: 'external', text: s.remark || '外部变更待确认', at: s.syncedAt })
    } else if (s.disabled) {
      out.push({ sourceId: s.sourceId, name: s.name, kind: 'disabled', text: s.remark || '已停用', at: s.lastTaskAt })
    }
  }
  return out
}

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function mockOverviewSummary(): OverviewSummary {
  const sources = allSources()
  const sites = mockSitePaged({ size: 999 }).list
  const categories = mockSourceCategories()
  const srcStats = mockSourceStats()
  const configs = mockConfigPaged({ size: 999 }).total
  const tables = mockEntryPaged({ size: 999 }).total
  const params = mockParamPaged({ size: 999 }).total
  const runStats = mockRunStats()
  const openAlarms = mockAlarms().filter((a) => a.level !== 'recover').length

  const active = sources.filter((s) => !s.disabled)
  const totalData = active.reduce((s, x) => s + (x.dataCount ?? 0), 0)
  const totalSuccess = active.reduce((s, x) => s + (x.successCount ?? 0), 0)
  const newAssets7 = sources.reduce((s, x) => s + (x.newInCount ?? 0), 0)
  const rate = totalData ? (totalSuccess / totalData) * 100 : 0

  return {
    kpi: {
      sources: srcStats.total,
      configs,
      tables,
      params,
      successRate: `${rate.toFixed(1)}%`,
      errorSources: srcStats.error,
      runningRuns: runStats.running,
      alarms: openAlarms,
      newAssets7,
    },
    ecosystem: { sources: srcStats.total, configs, tables, params },
    panorama: buildWebsitePanorama(sites, categories),
    byCategory: sliceByCategory(),
    byCycle: sliceByCycle(sources),
    byState: sliceByState(sources),
    topSources: topSources(sources),
    exceptions: exceptions(sources),
    updatedAt: nowText(),
  }
}

// 采集任务趋势 —— 近 N 天每日抓取量 / 成功量。
// mock 由源的当日规模派生一条平稳带噪声的序列；真接入由 task 事实表按日聚合。
export function mockOverviewTrend(params?: Record<string, unknown>): TrendPoint[] {
  const days = Number(params?.days ?? 30)
  const sources = allSources().filter((s) => !s.disabled)
  const base = sources.reduce((s, x) => s + (x.newInCount ?? 0), 0) * 30 + 800
  const out: TrendPoint[] = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const wave = Math.sin(i / 3.2) * 0.12 + Math.cos(i / 6.5) * 0.08
    const weekend = d.getDay() === 0 || d.getDay() === 6 ? 0.78 : 1
    const snatch = Math.round(base * (1 + wave) * weekend)
    const success = Math.round(snatch * (0.94 + (i % 5) * 0.011))
    out.push({ date: `${mm}-${dd}`, snatch, success })
  }
  return out
}
