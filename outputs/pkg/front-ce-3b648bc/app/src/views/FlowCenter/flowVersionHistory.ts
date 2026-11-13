/**
 * 流程历史版本列表的分组 / 文案（2026-10-14，设计稿/设计方案/1014-流程历史版本查看_开发设计方案）。
 * 上面一组：当前草稿 + 已发布版本（版本号倒序）；下面折叠组：已放弃的草稿和已归档的发布版。
 */
import type { FlowVersionOverview, FlowVersionRow } from '@/api'

export interface VersionItem {
  row: FlowVersionRow
  title: string
  /** 状态标记：编辑中 / 运行中 / 已放弃 / 已归档 */
  tag: string
  /** 「资讯用户 发布于 10-11 01:51」 */
  meta: string
  /** 放弃的草稿和基线内容相同（什么都没改就放弃了） */
  unchanged: boolean
}

/** 「2026-10-11 01:51:01」→「10-11 01:51」 */
export const shortTime = (dt: string | null | undefined) => (dt ? dt.slice(5, 16) : '')

function metaOf(by: string | null | undefined, verb: string, dt: string | null | undefined): string {
  if (!dt) return ''
  return [by, `${verb}于 ${shortTime(dt)}`].filter(Boolean).join(' ')
}

export function groupVersions(ov: FlowVersionOverview | null | undefined): { main: VersionItem[]; discarded: VersionItem[] } {
  if (!ov) return { main: [], discarded: [] }
  const byId = new Map(ov.versions.map((v) => [v.versionId, v]))
  const main: VersionItem[] = []
  const discarded: VersionItem[] = []
  for (const row of ov.versions) {
    const draft = row.state === 'W'
    if (row.isDelete === 0) {
      main.push(draft
        ? { row, title: `草稿 v${row.flowVer}`, tag: '编辑中', meta: metaOf(row.createBy, '创建', row.createDt), unchanged: false }
        : { row, title: `v${row.flowVer}`, tag: row.versionId === ov.publishId ? '运行中' : '', meta: metaOf(row.publishBy, '发布', row.publishDt), unchanged: false })
    } else {
      const base = row.baseId ? byId.get(row.baseId) : undefined
      discarded.push({
        row,
        title: draft ? `草稿 v${row.flowVer}` : `v${row.flowVer}`,
        tag: draft ? '已放弃' : '已归档',
        meta: metaOf(row.deleteBy, draft ? '放弃' : '归档', row.deleteDt),
        unchanged: draft && !!row.contentHash && row.contentHash === base?.contentHash,
      })
    }
  }
  // 草稿置顶，其后已发布按版本号倒序；折叠组按版本 ID（创建先后）倒序
  main.sort((a, b) => Number(b.row.state === 'W') - Number(a.row.state === 'W') || b.row.flowVer - a.row.flowVer)
  discarded.sort((a, b) => Number(b.row.versionId) - Number(a.row.versionId))
  return { main, discarded }
}

/**
 * 历史版本的配置提示用的时间点：已发布版看发布时间，放弃 / 归档的看放弃时间，其余看最后修改。
 * 节点配置的修改时间晚于它，说明这份配置在该版本之后被改过（配置不随版本保存，217 实测）。
 */
export function versionCutoff(row: FlowVersionRow): string | null {
  if (row.isDelete !== 0 && row.state === 'W') return row.deleteDt ?? null
  return row.publishDt ?? row.deleteDt ?? null
}
