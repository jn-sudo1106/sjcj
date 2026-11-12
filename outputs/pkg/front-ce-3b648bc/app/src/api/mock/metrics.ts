import type { Dataset, Measure } from '../types'

const DATASETS: Dataset[] = [
  { datasetId: 'ds-announce', name: '公告明细数据集', sourceTable: 'sense_data.TB_STOCK_NOTICE', fields: ['notice_id', 'title', 'pub_date', 'stock_code', 'content'], updatedAt: '2026-06-19 07:10', state: 'ready' },
  { datasetId: 'ds-fund-comment', name: '基金评论数据集', sourceTable: 'sense_data.TB_ZFB_COMMENT', fields: ['feed_id', 'fund_code', 'content', 'score', 'create_time'], updatedAt: '2026-06-19 06:40', state: 'ready' },
  { datasetId: 'ds-weibo', name: '微博舆情数据集', sourceTable: 'sense_data.TB_WEIBO_FEED', fields: ['mid', 'uid', 'text', 'repost', 'create_time'], updatedAt: '2026-06-19 08:00', state: 'building' },
  { datasetId: 'ds-quote', name: '行情快照数据集', sourceTable: 'sense_data.TB_STOCK_QUOTE', fields: ['code', 'price', 'volume', 'ts'], updatedAt: '2026-06-19 08:06', state: 'ready' },
  { datasetId: 'ds-news', name: '财经新闻数据集', sourceTable: 'sense_data.TB_NEWS_FLASH', fields: ['news_id', 'title', 'source', 'pub_time'], updatedAt: '2026-06-18 22:00', state: 'stale' },
]

const MEASURES: Measure[] = [
  { measureId: 'm-notice-cnt', name: '公告日新增量', datasetId: 'ds-announce', caliber: 'COUNT(notice_id) GROUP BY pub_date', cycle: '每日', owner: 'data_wang', canvasRefs: 2, gate: 'pass' },
  { measureId: 'm-notice-cover', name: '公告覆盖股票数', datasetId: 'ds-announce', caliber: 'COUNT(DISTINCT stock_code)', cycle: '每日', owner: 'data_wang', canvasRefs: 0, gate: 'pass' },
  { measureId: 'm-comment-senti', name: '评论情感均分', datasetId: 'ds-fund-comment', caliber: 'AVG(score)', cycle: '每日', owner: 'dev_liang', canvasRefs: 1, gate: 'warn' },
  { measureId: 'm-comment-cnt', name: '评论日活跃量', datasetId: 'ds-fund-comment', caliber: 'COUNT(feed_id)', cycle: '实时', owner: 'dev_liang', canvasRefs: 0, gate: 'pass' },
  { measureId: 'm-weibo-hot', name: '微博话题热度', datasetId: 'ds-weibo', caliber: 'SUM(repost)', cycle: '实时', owner: 'data_wang', canvasRefs: 0, gate: 'fail' },
  { measureId: 'm-quote-vol', name: '成交量分钟聚合', datasetId: 'ds-quote', caliber: 'SUM(volume) GROUP BY minute', cycle: '实时', owner: 'ops_chen', canvasRefs: 0, gate: 'pass' },
  { measureId: 'm-news-cnt', name: '新闻日发布量', datasetId: 'ds-news', caliber: 'COUNT(news_id)', cycle: '每日', owner: 'data_wang', canvasRefs: 0, gate: 'warn' },
  { measureId: 'm-quote-amp', name: '行情振幅', datasetId: 'ds-quote', caliber: '(MAX-MIN)/MIN', cycle: '实时', owner: 'ops_chen', canvasRefs: 0, gate: 'pass' },
]

export function mockDatasets(): Dataset[] {
  return DATASETS
}
export function mockMeasures(params?: Record<string, unknown>): Measure[] {
  const datasetId = String(params?.datasetId ?? '')
  return datasetId ? MEASURES.filter((m) => m.datasetId === datasetId) : MEASURES
}
export function mockMetricStats(): { datasets: number; measures: number; canvasRefs: number; sqlPending: number } {
  return {
    datasets: DATASETS.length,
    measures: MEASURES.length,
    canvasRefs: MEASURES.reduce((s, m) => s + m.canvasRefs, 0),
    sqlPending: MEASURES.filter((m) => m.gate !== 'pass').length,
  }
}
