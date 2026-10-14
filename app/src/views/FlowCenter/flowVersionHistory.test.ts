// 流程历史版本列表分组（2026-10-14）：样本按 217 流程 14010130 的真实版本行缩写
import { describe, expect, it } from 'vitest'
import type { FlowVersionOverview, FlowVersionRow } from '@/api'
import { groupVersions, shortTime, versionCutoff } from './flowVersionHistory'

const row = (versionId: string, over: Partial<FlowVersionRow> = {}): FlowVersionRow => ({
  versionId, flowVer: 1, ver: 1, state: 'C', isLock: 0, isDelete: 0, baseId: null, createBy: '资讯用户', ...over,
})
const ov: FlowVersionOverview = {
  enabled: true, curVer: 3, nextVer: 4, publishId: '1065', draftId: '1066',
  versions: [
    row('1066', { flowVer: 4, state: 'W', baseId: '1065', contentHash: 'be3a', createDt: '2026-10-13 19:05:05' }),
    row('1065', { flowVer: 3, baseId: '1047', contentHash: 'f795', publishDt: '2026-10-13 19:04:34', publishBy: '资讯用户' }),
    row('1063', { flowVer: 3, state: 'W', isDelete: -1, baseId: '1047', contentHash: '72b6', deleteDt: '2026-10-13 10:42:04', deleteBy: '资讯用户' }),
    row('1047', { flowVer: 2, baseId: '745', contentHash: '72b6', publishDt: '2026-10-11 01:51:01', publishBy: '资讯用户' }),
    row('1037', { flowVer: 2, state: 'W', isDelete: -1, baseId: '745', contentHash: '262e', deleteDt: '2026-10-10 20:00:00' }),
    row('745', { contentHash: '7304', publishDt: '2026-10-10 13:10:00' }),
    row('700', { isDelete: -1, deleteDt: '2026-10-12 09:00:00', deleteBy: '资讯用户' }),
  ],
}

describe('groupVersions', () => {
  it('草稿置顶，已发布按版本号倒序；运行中 / 编辑中标记；时间和人', () => {
    const { main } = groupVersions(ov)
    expect(main.map((i) => [i.title, i.tag])).toEqual([['草稿 v4', '编辑中'], ['v3', '运行中'], ['v2', ''], ['v1', '']])
    expect(main[0].meta).toBe('资讯用户 创建于 10-13 19:05')
    expect(main[1].meta).toBe('资讯用户 发布于 10-13 19:04')
  })

  it('已放弃草稿和已归档发布版进折叠组；与基线内容相同的草稿标「未修改」', () => {
    const { discarded } = groupVersions(ov)
    expect(discarded.map((i) => [i.row.versionId, i.tag, i.unchanged])).toEqual([
      ['1063', '已放弃', true],
      ['1037', '已放弃', false],
      ['700', '已归档', false],
    ])
    expect(discarded[0].meta).toBe('资讯用户 放弃于 10-13 10:42')
  })

  it('没有概览就是空列表', () => {
    expect(groupVersions(null)).toEqual({ main: [], discarded: [] })
  })
})

describe('versionCutoff', () => {
  it('发布版看发布时间，放弃的草稿看放弃时间', () => {
    expect(versionCutoff(ov.versions[3])).toBe('2026-10-11 01:51:01')
    expect(versionCutoff(ov.versions[2])).toBe('2026-10-13 10:42:04')
    expect(shortTime('2026-10-11 01:51:01')).toBe('10-11 01:51')
  })
})
