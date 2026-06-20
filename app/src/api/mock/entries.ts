import type { Paged, EntryType } from '../types'

const ENTRIES: EntryType[] = [
  {
    tableId: '2102157', tableName: 'sense_data.TB_ZFB_COMMENT', rowCount: 4501, sourceId: '391007768',
    owner: 'dev_zhonghe', updatedAt: '2026-06-18 17:42',
    fields: [
      { prop: 'feed_id-K1', desc: '评论 ID', type: 'string', required: true, width: 160, dedup: true },
      { prop: 'code-K2', desc: '基金代码', type: 'string', required: true, width: 100, preprocess: 'trim' },
      { prop: 'content-K5', desc: '评论正文', type: 'longtext', required: false, width: 320, preprocess: 'cleanHtml' },
      { prop: 'publish_time-K3', desc: '发布时间', type: 'string', required: false, width: 160 },
      { prop: 'uid-K6', desc: '用户 ID', type: 'string', required: false, width: 120 },
    ],
  },
  {
    tableId: '2101001', tableName: 'sense_data.TB_STOCK_NOTICE', rowCount: 2210, sourceId: '600519',
    owner: 'dev_zhonghe', updatedAt: '2026-06-19 07:01',
    fields: [
      { prop: 'notice_id-K1', desc: '公告 ID', type: 'string', required: true, width: 160, dedup: true },
      { prop: 'title-K2', desc: '公告标题', type: 'text', required: true, width: 280, preprocess: 'trim' },
      { prop: 'pub_date-K3', desc: '发布日期', type: 'string', required: true, width: 120 },
      { prop: 'file_url-K4', desc: '原文链接', type: 'url', required: false, width: 220 },
    ],
  },
  {
    tableId: '2101020', tableName: 'sense_data.TB_STOCK_QUOTE', rowCount: 88212, sourceId: '600036',
    owner: 'ops_chen', updatedAt: '2026-06-19 08:05',
    fields: [
      { prop: 'code-K1', desc: '股票代码', type: 'string', required: true, width: 100, dedup: true },
      { prop: 'price-K2', desc: '最新价', type: 'string', required: true, width: 100 },
      { prop: 'volume-K3', desc: '成交量', type: 'string', required: false, width: 120 },
      { prop: 'ts-K4', desc: '时间戳', type: 'string', required: true, width: 160, dedup: true },
    ],
  },
  {
    tableId: '2103300', tableName: 'sense_data.TB_WEIBO_FEED', rowCount: 152300, sourceId: 'WB100231',
    owner: 'data_wang', updatedAt: '2026-06-19 08:00',
    fields: [
      { prop: 'mid-K1', desc: '微博 ID', type: 'string', required: true, width: 160, dedup: true },
      { prop: 'text-K2', desc: '正文', type: 'longtext', required: false, width: 320, preprocess: 'cleanHtml' },
      { prop: 'repost-K3', desc: '转发数', type: 'string', required: false, width: 100 },
    ],
  },
]

function matches(e: EntryType, p?: Record<string, unknown>): boolean {
  if (!p) return true
  const kw = String(p.keyword ?? '').trim().toLowerCase()
  if (kw && ![e.tableId, e.tableName].some((f) => f.toLowerCase().includes(kw))) return false
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
