import type { DataTableMeta, DataRow } from '../types'

const TABLES: DataTableMeta[] = [
  {
    tableId: 't-notice', tableName: 'sense_data.TB_STOCK_NOTICE', rowCount: 2210,
    fields: [
      { prop: 'notice_id', type: 'string', desc: '公告 ID', sample: 'N20260619001' },
      { prop: 'title', type: 'text', desc: '公告标题', sample: '关于2025年度利润分配的公告' },
      { prop: 'pub_date', type: 'string', desc: '发布日期', sample: '2026-06-19' },
      { prop: 'file_url', type: 'url', desc: '原文链接', sample: 'https://…/600519.pdf' },
    ],
  },
  {
    tableId: 't-comment', tableName: 'sense_data.TB_ZFB_COMMENT', rowCount: 4501,
    fields: [
      { prop: 'feed_id', type: 'string', desc: '评论 ID', sample: 'F88231' },
      { prop: 'fund_code', type: 'string', desc: '基金代码', sample: '161725' },
      { prop: 'content', type: 'longtext', desc: '评论正文', sample: '这只白酒基近期回撤…' },
      { prop: 'score', type: 'string', desc: '情感分', sample: '0.82' },
    ],
  },
  {
    tableId: 't-weibo', tableName: 'sense_data.TB_WEIBO_FEED', rowCount: 152300,
    fields: [
      { prop: 'mid', type: 'string', desc: '微博 ID', sample: 'WB100231-99' },
      { prop: 'text', type: 'longtext', desc: '正文', sample: '#财经# 今日要闻…' },
      { prop: 'repost', type: 'string', desc: '转发数', sample: '1280' },
    ],
  },
]

const ROWS: Record<string, DataRow[]> = {
  't-notice': [
    { dataId: 'N20260619001', title: '关于2025年度利润分配的公告', summary: '贵州茅台 / 分红', sourceId: '600519', configId: '80120', taskId: 'TK-99021', runId: 'RUN-20260619-07', acceptState: 'accepted', fileType: 'pdf', parseState: 'parsed' },
    { dataId: 'N20260619002', title: '第三季度业绩预告', summary: '平安银行 / 业绩', sourceId: '000001', configId: '80120', taskId: 'TK-99025', runId: 'RUN-20260619-07', acceptState: 'pending', fileType: 'pdf', parseState: 'failed' },
    { dataId: 'N20260619003', title: '关于回购股份的进展公告', summary: '招商银行 / 回购', sourceId: '600036', configId: '80120', taskId: 'TK-99031', runId: 'RUN-20260619-07', acceptState: 'accepted', fileType: 'html', parseState: 'parsed' },
    { dataId: 'N20260619004', title: '董事会决议公告', summary: '五粮液 / 治理', sourceId: '000858', configId: '80120', taskId: 'TK-99033', acceptState: 'rejected', fileType: 'pdf', parseState: 'parsed' },
  ],
  't-comment': [
    { dataId: 'F88231', title: '这只白酒基近期回撤明显', summary: '161725 / score 0.42', sourceId: '161725', configId: '70612', taskId: 'TK-70021', runId: 'RUN-20260619-05', acceptState: 'accepted', fileType: '-', parseState: 'none' },
    { dataId: 'F88232', title: '长期看好消费板块', summary: '110022 / score 0.88', sourceId: '110022', configId: '70770', taskId: 'TK-70044', runId: 'RUN-20260619-05', acceptState: 'accepted', fileType: '-', parseState: 'none' },
    { dataId: 'F88233', title: '点击领取广告福利', summary: '已被规则过滤', sourceId: '161725', configId: '70612', taskId: 'TK-70021', runId: 'RUN-20260619-05', acceptState: 'rejected', fileType: '-', parseState: 'none' },
  ],
  't-weibo': [
    { dataId: 'WB100231-99', title: '#财经# 今日大盘震荡', summary: 'repost 1280', sourceId: 'WB100231', configId: '90011', taskId: 'TK-90011', runId: 'RUN-20260619-06', acceptState: 'pending', fileType: '-', parseState: 'none' },
    { dataId: 'WB100232-12', title: '#基金# 白酒还能上车吗', summary: 'repost 430', sourceId: 'WB100232', configId: '90011', taskId: 'TK-90012', runId: 'RUN-20260619-06', acceptState: 'pending', fileType: '-', parseState: 'none' },
  ],
}

export function mockDataTables(): DataTableMeta[] {
  return TABLES
}
export function mockDataRows(params?: Record<string, unknown>): DataRow[] {
  return ROWS[String(params?.tableId ?? 't-notice')] ?? []
}
export function mockDataStats(): { tables: number; rows: number; chars: number; review: number } {
  const all = Object.values(ROWS).flat()
  return {
    tables: TABLES.length,
    rows: ROWS['t-notice'].length,
    chars: 8420,
    review: all.filter((r) => r.acceptState === 'pending').length,
  }
}
