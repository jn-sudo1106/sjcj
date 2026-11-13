// @vitest-environment jsdom
// 0917-17 后半条：最近打开。跟收藏的区别是——有上限、有序、隐式记录。
// 2026-10-19 起从 localStorage 改为后端通用埋点（/api/v1/log-report/*），测试改成假后端。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { logReportApi } from '@/api'
import { recentSiteIds, recentLoaded, recordSiteVisit, recentRankOf, loadRecentSites } from './siteRecents'

const LEGACY_KEY = 'rc.site.recent'

/** 假后端：最近打开的网站 ID（最近在前）与是否成功 */
let serverRecent: string[] = []
let serverOk = true

beforeEach(() => {
  localStorage.clear()
  serverRecent = []
  serverOk = true
  recentSiteIds.value = []
  recentLoaded.value = false
  vi.restoreAllMocks()
  vi.spyOn(logReportApi, 'report').mockResolvedValue({ success: true, code: '0', msg: '操作成功', data: {} })
  vi.spyOn(logReportApi, 'recentRaw').mockImplementation(async () =>
    serverOk
      ? {
          success: true,
          code: '0',
          msg: '操作成功',
          data: serverRecent.map((id) => ({ contentId: id, contentTitle: null, createDt: '2026-10-19 10:00:00' })),
        }
      : { success: false, code: '-1', msg: '埋点上报失败', data: [] },
  )
})

describe('siteRecents', () => {
  it('记一次访问：最近的排最前', () => {
    recordSiteVisit('a')
    recordSiteVisit('b')
    expect(recentSiteIds.value).toEqual(['b', 'a'])
  })

  it('再次打开同一个网站：置顶而不是出现两次', () => {
    recordSiteVisit('a')
    recordSiteVisit('b')
    recordSiteVisit('a')
    expect(recentSiteIds.value).toEqual(['a', 'b'])
  })

  // 连着点同一个网站（从卡片进去又退回来再进）不该刷出一堆 ENTER
  it('已经在最前面时不重复置顶、也不再上报', () => {
    recordSiteVisit('a')
    const before = recentSiteIds.value
    recordSiteVisit('a')
    expect(recentSiteIds.value).toBe(before)
    expect(vi.mocked(logReportApi.report)).toHaveBeenCalledTimes(1)
  })

  it('最多留 10 条，最早的被挤掉', () => {
    for (let i = 1; i <= 12; i++) recordSiteVisit(`s${i}`)
    expect(recentSiteIds.value.length).toBe(10)
    expect(recentSiteIds.value[0]).toBe('s12')
    expect(recentSiteIds.value).not.toContain('s1')
    expect(recentSiteIds.value).not.toContain('s2')
  })

  it('空 ID 直接忽略，也不上报', () => {
    recordSiteVisit('')
    expect(recentSiteIds.value).toEqual([])
    expect(vi.mocked(logReportApi.report)).not.toHaveBeenCalled()
  })

  it('recentRankOf：越近越小，不在列表里排最后', () => {
    recordSiteVisit('a')
    recordSiteVisit('b')
    expect(recentRankOf('b')).toBe(0)
    expect(recentRankOf('a')).toBe(1)
    expect(recentRankOf('never')).toBe(10)
  })

  it('上报字段按通用埋点契约：SITE + ENTER + contentTitle', () => {
    recordSiteVisit('105', '某某网站')
    expect(logReportApi.report).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ENTER',
        contentType: 'SITE',
        contentId: '105',
        contentTitle: '某某网站',
      }),
    )
  })

  it('上报失败不影响本地置顶（埋点是尽力而为）', async () => {
    vi.mocked(logReportApi.report).mockRejectedValueOnce(new Error('网络炸了'))
    expect(() => recordSiteVisit('a', 'A 站')).not.toThrow()
    expect(recentSiteIds.value).toEqual(['a'])
    await Promise.resolve()
  })
})

describe('siteRecents · 从后端加载', () => {
  it('loadRecentSites：按后端顺序映射成 ID，并标记已加载', async () => {
    serverRecent = ['s3', 's1', 's2']
    await loadRecentSites()
    expect(recentSiteIds.value).toEqual(['s3', 's1', 's2'])
    expect(recentLoaded.value).toBe(true)
    expect(logReportApi.recentRaw).toHaveBeenCalledWith({ contentType: 'SITE', action: 'ENTER', limit: 10 })
  })

  it('loadRecentSites：后端给多了也只留 10 条', async () => {
    serverRecent = Array.from({ length: 15 }, (_, i) => `s${i + 1}`)
    await loadRecentSites()
    expect(recentSiteIds.value).toHaveLength(10)
    expect(recentSiteIds.value[0]).toBe('s1')
  })

  it('loadRecentSites：失败时保留现状，不当成空列表冲掉', async () => {
    recentSiteIds.value = ['keep-me']
    serverOk = false
    await loadRecentSites()
    expect(recentSiteIds.value).toEqual(['keep-me'])
    expect(recentLoaded.value).toBe(false)
  })

  it('loadRecentSites：成功为空说明确实没有，标记已加载', async () => {
    serverRecent = []
    await loadRecentSites()
    expect(recentSiteIds.value).toEqual([])
    expect(recentLoaded.value).toBe(true)
  })

  // 接口文档：RspResult 的 data「无数据时为 null」。null 不能当失败，否则空账号永远卡在「正在加载」
  it('loadRecentSites：success 但 data 为 null，也按「确实没有」处理', async () => {
    vi.mocked(logReportApi.recentRaw).mockResolvedValueOnce({
      success: true,
      code: '0',
      msg: '操作成功',
      data: null as unknown as [],
    })
    await loadRecentSites()
    expect(recentSiteIds.value).toEqual([])
    expect(recentLoaded.value).toBe(true)
  })

  it('首次成功加载后清掉旧 localStorage 键（不回填）', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(['old-1', 'old-2']))
    serverRecent = ['new-1']
    await loadRecentSites()
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
    // 旧记录不回填：列表只有后端返回的那条
    expect(recentSiteIds.value).toEqual(['new-1'])
  })
})
