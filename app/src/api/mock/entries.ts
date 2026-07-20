import type { Paged, EntryType } from '../types'

const ENTRIES: EntryType[] = [
  {
    tableId: '2102157', tableName: 'sense_data.TB_ZFB_COMMENT', rowCount: 4501, sourceId: '391007768',
    owner: 'dev_zhonghe', updatedAt: '2026-06-18 17:42', keyField: 'K1', state: 'AC',
    fields: [
      { prop: 'feed_id-K1', desc: '评论 ID', type: 'string', required: true, width: 160, dedup: true, columnName: 'K1' },
      { prop: 'code-K2', desc: '基金代码', type: 'string', required: true, width: 100, preprocess: 'trim', columnName: 'K2' },
      { prop: 'content-K5', desc: '评论正文', type: 'longtext', required: false, width: 320, preprocess: 'cleanHtml', columnName: 'K5' },
      { prop: 'publish_time-K3', desc: '发布时间', type: 'string', required: false, width: 160, columnName: 'K3' },
      { prop: 'uid-K6', desc: '用户 ID', type: 'string', required: false, width: 120, columnName: 'K6' },
    ],
  },
  {
    tableId: '2101001', tableName: 'sense_data.TB_STOCK_NOTICE', rowCount: 2210, sourceId: '600519',
    owner: 'dev_zhonghe', updatedAt: '2026-06-19 07:01', keyField: 'K1', state: 'AC',
    fields: [
      { prop: 'notice_id-K1', desc: '公告 ID', type: 'string', required: true, width: 160, dedup: true, columnName: 'K1' },
      { prop: 'title-K2', desc: '公告标题', type: 'text', required: true, width: 280, preprocess: 'trim', columnName: 'K2' },
      { prop: 'pub_date-K3', desc: '发布日期', type: 'string', required: true, width: 120, columnName: 'K3' },
      { prop: 'file_url-K4', desc: '原文链接', type: 'url', required: false, width: 220, columnName: 'K4' },
    ],
  },
  {
    tableId: '2101020', tableName: 'sense_data.TB_STOCK_QUOTE', rowCount: 88212, sourceId: '600036',
    owner: 'ops_chen', updatedAt: '2026-06-19 08:05', keyField: 'K1,K4', state: 'AC',
    fields: [
      { prop: 'code-K1', desc: '股票代码', type: 'string', required: true, width: 100, dedup: true, columnName: 'K1' },
      { prop: 'price-K2', desc: '最新价', type: 'string', required: true, width: 100, columnName: 'K2' },
      { prop: 'volume-K3', desc: '成交量', type: 'string', required: false, width: 120, columnName: 'K3' },
      { prop: 'ts-K4', desc: '时间戳', type: 'string', required: true, width: 160, dedup: true, columnName: 'K4' },
    ],
  },
  {
    tableId: '2103300', tableName: 'sense_data.TB_WEIBO_FEED', rowCount: 152300, sourceId: 'WB100231',
    owner: 'data_wang', updatedAt: '2026-06-19 08:00', keyField: 'K1', state: 'C',
    fields: [
      { prop: 'mid-K1', desc: '微博 ID', type: 'string', required: true, width: 160, dedup: true, columnName: 'K1' },
      { prop: 'text-K2', desc: '正文', type: 'longtext', required: false, width: 320, preprocess: 'cleanHtml', columnName: 'K2' },
      { prop: 'repost-K3', desc: '转发数', type: 'string', required: false, width: 100, columnName: 'K3' },
    ],
  },
]

// 旧 EntryTypeList 检索是 entryTypeId/name 两个独立框，无 enable 下拉（mock 未建模删除态，enable 透传不参与过滤）。
function matches(e: EntryType, p?: Record<string, unknown>): boolean {
  if (!p) return true
  const entryTypeId = String(p.entryTypeId ?? '').trim()
  if (entryTypeId && !e.tableId.includes(entryTypeId)) return false
  const name = String(p.name ?? '').trim().toLowerCase()
  if (name && ![e.tableName, e.name ?? ''].some((f) => f.toLowerCase().includes(name))) return false
  return true
}

export function mockEntryPaged(params?: Record<string, unknown>): Paged<EntryType> {
  const filtered = ENTRIES.filter((e) => matches(e, params))
  const page = Number(params?.page ?? 1)
  const size = Number(params?.size ?? 20)
  const start = (page - 1) * size
  return { total: filtered.length, list: filtered.slice(start, start + size) }
}

export function mockEntryDetail(params?: Record<string, unknown>): EntryType {
  return ENTRIES.find((e) => e.tableId === String(params?.tableId)) ?? ENTRIES[0]
}

// 新建 / 编辑表：按 tableId upsert，无 tableId 视为新建（内存 session 持久化）
let entrySeq = 1
export function cloneEntryStructure(tableId: string, sourceId: string): EntryType | null {
  const origin = ENTRIES.find((entry) => entry.tableId === tableId)
  if (!origin) return null
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const cloned: EntryType = {
    ...structuredClone(origin),
    tableId: `T${Date.now()}${entrySeq++}`,
    tableName: `${origin.tableName}_COPY_${entrySeq}`,
    sourceId,
    rowCount: 0,
    updatedAt: now,
  }
  ENTRIES.unshift(cloned)
  return cloned
}

export function mockSaveEntryType(params?: Record<string, unknown>): { tableId: string; message?: string } {
  const entry = params?.entry as EntryType | undefined
  if (!entry) return { tableId: '', message: '缺少表数据' }
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
  if (entry.tableId && ENTRIES.some((e) => e.tableId === entry.tableId)) {
    const idx = ENTRIES.findIndex((e) => e.tableId === entry.tableId)
    ENTRIES[idx] = { ...ENTRIES[idx], ...entry, updatedAt: now }
    return { tableId: entry.tableId, message: '表已更新（演示）' }
  }
  const tableId = entry.tableId || `T${Date.now().toString().slice(-6)}${entrySeq++}`
  ENTRIES.unshift({ ...entry, tableId, rowCount: entry.rowCount ?? 0, updatedAt: now })
  return { tableId, message: '表已创建（演示）' }
}
