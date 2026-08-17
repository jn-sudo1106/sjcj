import type { DataTableMeta, DataRow, Paged } from '../types'
import { SOURCES } from './sources'

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
  // 与源 mainTable 对齐：让"点节点 → 取输出表数据"在结果视图能拉通
  {
    tableId: '2102157', tableName: 'sense_data.TB_ZFB_COMMENT', rowCount: 4501,
    fields: [
      { prop: 'feed_id-K1', type: 'string', desc: '评论 ID', sample: '17461063' },
      { prop: 'code-K2', type: 'string', desc: '基金代码', sample: '2017052400023003' },
      { prop: 'publish_time-K3', type: 'string', desc: '发布时间', sample: '2024-05-23 …' },
      { prop: 'time-K4', type: 'string', desc: '时间戳', sample: '1716428668' },
      { prop: 'content-K5', type: 'longtext', desc: '评论正文', sample: '后悔了，早知道就多买点…' },
      { prop: 'uid-K6', type: 'string', desc: '用户 ID', sample: '301287174_…' },
      { prop: 'fund-K9', type: 'string', desc: '基金名', sample: '004432-南方有色' },
      { prop: 'tags-K10', type: 'string', desc: '标签', sample: '20170' },
    ],
  },
  {
    tableId: '2102157_DETAIL', tableName: 'sense_data.TB_ZFB_COMMENT_DETAIL', rowCount: 4501,
    fields: [
      { prop: 'feed_id-K1', type: 'string', desc: '评论 ID', sample: '17461063' },
      { prop: 'parent_id', type: 'string', desc: '父 ID（列表）', sample: '17461063' },
      { prop: 'content-K5', type: 'longtext', desc: '正文', sample: '完整正文展开…' },
      { prop: 'file_id-K7', type: 'string', desc: '文件 ID', sample: '/comment/ori…' },
      { prop: 'date-K8', type: 'string', desc: '日期', sample: '2024-05-26' },
      { prop: 'fund-K9', type: 'string', desc: '基金名', sample: '004432-南方有色' },
      { prop: 'tags-K10', type: 'string', desc: '标签', sample: '20170' },
    ],
  },
  {
    tableId: '2101500', tableName: 'sense_data.TB_LANG_NOTICE', rowCount: 288,
    fields: [
      { prop: 'feed_id-K1', type: 'string', desc: '公告 ID', sample: 'LANG-01-0001' },
      { prop: 'title-K2', type: 'string', desc: '公告标题', sample: '多语种公告示例' },
      { prop: 'publish_time-K3', type: 'string', desc: '发布时间', sample: '2026-07-07 08:02' },
      { prop: 'url-K4', type: 'url', desc: '原文链接', sample: 'https://example.com/notice' },
      { prop: 'content-K5', type: 'longtext', desc: '正文', sample: '这是演示数据' },
    ],
  },
  {
    tableId: '2101500_DETAIL', tableName: 'sense_data.TB_LANG_NOTICE_DETAIL', rowCount: 288,
    fields: [
      { prop: 'feed_id-K1', type: 'string', desc: '公告 ID', sample: 'LANG-01-0001-D' },
      { prop: 'parent_id', type: 'string', desc: '父 ID（列表）', sample: 'LANG-01-0001' },
      { prop: 'publish_time-K3', type: 'string', desc: '发布时间', sample: '2026-07-07 08:02' },
      { prop: 'url-K4', type: 'url', desc: '原文链接', sample: 'https://example.com/notice' },
      { prop: 'content-K5', type: 'longtext', desc: '正文', sample: '这是演示详情数据' },
    ],
  },
  {
    tableId: '2100157', tableName: 'sense_data.TB_FUND_COMMENT', rowCount: 1817,
    fields: [
      { prop: 'feed_id-K1', type: 'string', desc: '评论 ID', sample: '8364949149' },
      { prop: 'fund-K9', type: 'string', desc: '基金名', sample: '004432-南方中证申万有色金属ETF联接A' },
      { prop: 'content-K5', type: 'longtext', desc: '正文', sample: '又跌那么多 牛市什么时候来…' },
      { prop: 'publish_time-K3', type: 'string', desc: '发布时间', sample: '2024-05-23 …' },
      { prop: 'tags-K10', type: 'string', desc: '标签', sample: '20170' },
    ],
  },
]

const RESULT_SOURCE_TABLES = [
  { sourceId: '391007768', mainTable: '2102157', tableName: 'sense_data.TB_ZFB_COMMENT', label: '支付宝评论规则过滤', offset: 0 },
  { sourceId: '301287174', mainTable: '2100157', tableName: 'sense_data.TB_FUND_COMMENT', label: '004432-南方中证申万有色金属ETF联接A', offset: 100 },
  { sourceId: '301287169', mainTable: '2100157', tableName: 'sense_data.TB_FUND_COMMENT', label: '160517-博时中证银行', offset: 200 },
  { sourceId: '161725', mainTable: '2100160', tableName: 'sense_data.TB_TTFUND_COMMENT', label: '161725-招商中证白酒指数', offset: 300 },
  { sourceId: '005827', mainTable: '2100160', tableName: 'sense_data.TB_TTFUND_COMMENT', label: '005827-易方达蓝筹精选混合', offset: 400 },
  { sourceId: '110022', mainTable: '2100166', tableName: 'sense_data.TB_XUEQIU_COMMENT', label: '110022-易方达消费行业股票', offset: 500 },
  { sourceId: '600519', mainTable: '2101001', tableName: 'sense_data.TB_STOCK_NOTICE', label: '600519-贵州茅台-公司公告', offset: 600 },
  { sourceId: '000001', mainTable: '2101001', tableName: 'sense_data.TB_STOCK_NOTICE', label: '000001-平安银行-公司公告', offset: 700 },
  { sourceId: '600036', mainTable: '2101020', tableName: 'sense_data.TB_STOCK_QUOTE', label: '600036-招商银行-行情快照', offset: 800 },
  { sourceId: '000858', mainTable: '2101020', tableName: 'sense_data.TB_STOCK_QUOTE', label: '000858-五粮液-行情快照', offset: 900 },
  { sourceId: 'WB100231', mainTable: '2103300', tableName: 'sense_data.TB_WEIBO_FEED', label: '微博舆情-财经大V监控', offset: 1000 },
  { sourceId: 'WB100232', mainTable: '2103300', tableName: 'sense_data.TB_WEIBO_FEED', label: '微博舆情-基金话题聚合', offset: 1100 },
  { sourceId: 'NEWS5521', mainTable: '2103330', tableName: 'sense_data.TB_NEWS_FLASH', label: '新浪财经-要闻快讯', offset: 1200 },
  { sourceId: 'NEWS5522', mainTable: '2103330', tableName: 'sense_data.TB_NEWS_FLASH', label: '东方财富-7x24快讯', offset: 1300 },
]

function ensureTableMeta(tableId: string, tableName: string, detail = false) {
  if (TABLES.some((t) => t.tableId === tableId)) return
  TABLES.push({
    tableId,
    tableName,
    rowCount: 120,
    fields: detail
      ? [
          { prop: 'feed_id-K1', type: 'string', desc: '数据 ID', sample: '17461063' },
          { prop: 'parent_id', type: 'string', desc: '父 ID（列表）', sample: '17461063' },
          { prop: 'content-K5', type: 'longtext', desc: '详情正文', sample: '详情展开…' },
          { prop: 'date-K8', type: 'string', desc: '采集日期', sample: '2024-05-26' },
          { prop: 'fund-K9', type: 'string', desc: '对象名称', sample: '004432-南方有色' },
        ]
      : [
          { prop: 'feed_id-K1', type: 'string', desc: '数据 ID', sample: '17461063' },
          { prop: 'fund-K9', type: 'string', desc: '对象名称', sample: '004432-南方有色' },
          { prop: 'content-K5', type: 'longtext', desc: '内容', sample: '这是测试数据' },
          { prop: 'publish_time-K3', type: 'string', desc: '发布时间', sample: '2024-05-23 14:32' },
          { prop: 'tags-K10', type: 'string', desc: '标签', sample: '20170' },
        ],
  })
}

for (const source of RESULT_SOURCE_TABLES) {
  ensureTableMeta(source.mainTable, source.tableName)
  ensureTableMeta(`${source.mainTable}_DETAIL`, `${source.tableName}_DETAIL`, true)
}

// 历史 ROWS：/data 旧页继续读这份固定 schema 的 DataRow
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

// 结果视图：按表批量生成动态列样例（每表 60 行，足够分页验证）
const ZFB_CONTENT = [
  '这是测试数据', '后悔了，早知道就多买点', '前段时间的铜价走势分析',
  '又跌那么多 牛市什么时候来', '有色复盘：指数还有空间', '[调皮] 刚刚抄底了一点',
  '今天加不加？', '光伏150万 不慌', '有色今天能加吗', '国际黄金昨晚回调',
  '铜涨空失败 重新观察', '大涨那天没跑', '5月23日 有色震荡', '铜价飙升 还能上吗',
  '[得意] 滴 学到了', '今日小幅回撤但不影响节奏', '基本面没变化 持有不动',
  '中长期还是看好的', '注意控制仓位', '不建议追高',
]
function genZfbRow(i: number): Record<string, unknown> {
  const idx = i % ZFB_CONTENT.length
  return {
    'feed_id-K1': `1746${1064 - i}`,
    'code-K2': `2017052400023${String(900 + i).padStart(3, '0')}`,
    'publish_time-K3': '2024-05-23 14:32',
    'time-K4': `${1716428668 - i * 137}`,
    'content-K5': ZFB_CONTENT[idx],
    'uid-K6': '301287174_…',
    'fund-K9': '004432-南方有色',
    'tags-K10': '20170',
  }
}
function genDetailRow(i: number): Record<string, unknown> {
  return {
    'feed_id-K1': `1746${1064 - i}`,
    parent_id: `1746${1064 - i}`,
    'content-K5': `${ZFB_CONTENT[i % ZFB_CONTENT.length]}（详情展开）`,
    'file_id-K7': '/comment/ori…',
    'date-K8': '2024-05-26',
    'fund-K9': '004432-南方有色',
    'tags-K10': '20170',
  }
}
function genFundRow(i: number): Record<string, unknown> {
  return {
    'feed_id-K1': `${8364949149 - i * 3}`,
    'fund-K9': '004432-南方中证申万有色金属ETF联接A',
    'content-K5': ZFB_CONTENT[(i + 3) % ZFB_CONTENT.length],
    'publish_time-K3': '2024-05-23 11 天前',
    'tags-K10': '20170',
  }
}
function genSourceRow(i: number, label: string): Record<string, unknown> {
  return {
    'feed_id-K1': `SRC-${String(i).padStart(5, '0')}`,
    'fund-K9': label,
    'content-K5': ZFB_CONTENT[i % ZFB_CONTENT.length],
    'publish_time-K3': '2024-05-23 14:32',
    'tags-K10': '20170',
  }
}
function genSourceDetailRow(i: number, label: string): Record<string, unknown> {
  const parentId = `SRC-${String(i).padStart(5, '0')}`
  return {
    'feed_id-K1': `${parentId}-D`,
    parent_id: parentId,
    'content-K5': `${ZFB_CONTENT[i % ZFB_CONTENT.length]}（详情展开）`,
    'date-K8': '2024-05-26',
    'fund-K9': label,
    'tags-K10': '20170',
  }
}
function genLangNoticeRow(i: number, langIndex: number): Record<string, unknown> {
  const id = `LANG-${String(langIndex).padStart(2, '0')}-${String(i + 1).padStart(4, '0')}`
  return {
    'feed_id-K1': id,
    'title-K2': `多语种公告示例 ${langIndex}-${i + 1}`,
    'publish_time-K3': '2026-07-07 08:02',
    'url-K4': `https://example.com/notice?lang=${langIndex}&id=${i + 1}`,
    'content-K5': '这是多语种演示数据',
  }
}
function genLangNoticeDetailRow(i: number, langIndex: number): Record<string, unknown> {
  const parentId = `LANG-${String(langIndex).padStart(2, '0')}-${String(i + 1).padStart(4, '0')}`
  return {
    'feed_id-K1': `${parentId}-D`,
    parent_id: parentId,
    'publish_time-K3': '2026-07-07 08:02',
    'url-K4': `https://example.com/notice?lang=${langIndex}&id=${i + 1}`,
    'content-K5': '这是多语种演示详情数据',
  }
}

const QUERY_ROWS: Record<string, DataRow[]> = {}
function buildRows(sourceId: string, n: number, gen: (i: number) => Record<string, unknown>): DataRow[] {
  return Array.from({ length: n }, (_, i): DataRow => {
    const v = gen(i)
    const dataId = String(v['feed_id-K1'])
    return {
      dataId,
      title: String(v['content-K5'] ?? dataId).slice(0, 40),
      summary: `${v['fund-K9'] ?? ''} · ${v['publish_time-K3'] ?? ''}`,
      sourceId,
      taskId: `TK-${dataId}`,
      runId: 'RUN-20260619-05',
      acceptState: i % 7 === 0 ? 'pending' : i % 11 === 0 ? 'rejected' : 'accepted',
      state: i % 13 === 0 ? 'E' : 'C',
      parentId: String(v.parent_id ?? ''),
      values: v,
    }
  })
}
for (const source of RESULT_SOURCE_TABLES) {
  const baseGen = source.mainTable === '2102157'
    ? (i: number) => genZfbRow(i + source.offset)
    : source.mainTable === '2100157'
      ? (i: number) => ({ ...genFundRow(i + source.offset), 'fund-K9': source.label })
      : (i: number) => genSourceRow(i + source.offset, source.label)
  const detailGen = source.mainTable === '2102157'
    ? (i: number) => genDetailRow(i + source.offset)
    : (i: number) => genSourceDetailRow(i + source.offset, source.label)
  QUERY_ROWS[source.mainTable] = [
    ...(QUERY_ROWS[source.mainTable] ?? []),
    ...buildRows(source.sourceId, 12, baseGen),
  ]
  const detailTable = `${source.mainTable}_DETAIL`
  QUERY_ROWS[detailTable] = [
    ...(QUERY_ROWS[detailTable] ?? []),
    ...buildRows(source.sourceId, 12, detailGen),
  ]
}
// 多语种演示网站的输出表属于前端种子数据，真实后端未必已注册；Mock 模式下仍提供完整结果视图样例。
for (let langIndex = 1; langIndex <= 24; langIndex += 1) {
  const sourceId = `site-lang-demo-${String(langIndex).padStart(2, '0')}`
  QUERY_ROWS['2101500'] = [
    ...(QUERY_ROWS['2101500'] ?? []),
    ...buildRows(sourceId, 12, (i) => genLangNoticeRow(i, langIndex)),
  ]
  QUERY_ROWS['2101500_DETAIL'] = [
    ...(QUERY_ROWS['2101500_DETAIL'] ?? []),
    ...buildRows(sourceId, 12, (i) => genLangNoticeDetailRow(i, langIndex)),
  ]
}

// 演示环境无源分组数据：main（默认选中表）留空，全部表放进 list1（UI 上对应「main」分组标签），
// list2/list3 留空（entryTypeGroupFromLegacy 按此形状消化）
export function mockEntryTypesGroup(): { main?: string; list1: DataTableMeta[]; list2: []; list3: [] } {
  return { list1: TABLES, list2: [], list3: [] }
}
export function mockDataRows(params?: Record<string, unknown>): DataRow[] {
  return ROWS[String(params?.tableId ?? 't-notice')] ?? []
}
export function mockDataTableMeta(params?: Record<string, unknown>): DataTableMeta | null {
  const id = String(params?.tableId ?? '')
  return TABLES.find((t) => t.tableId === id) ?? null
}
export function mockDataRowQueryPaged(params?: Record<string, unknown>): Paged<DataRow> {
  const tableId = String(params?.tableId ?? '')
  const all = QUERY_ROWS[tableId] ?? []
  const dataId = String(params?.dataId ?? '').trim()
  const parentId = String(params?.parentId ?? '').trim()
  const states = String(params?.state ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  const sourceId = String(params?.sourceId ?? '').trim()
  const sql = String(params?.sql ?? '').trim()
  // 网站粒度查询（0707 优化·Phase5）：圈定该网站下全部源；sourceId 再在此范围内进一步收窄
  const siteId = String(params?.siteId ?? '').trim()
  const siteSourceIds = siteId ? new Set(SOURCES.filter((s) => s.siteId === siteId).map((s) => s.sourceId)) : null
  const filtered = all.filter((r) => {
    if (dataId && !r.dataId.includes(dataId)) return false
    if (parentId && r.parentId !== parentId) return false
    if (states.length && !states.includes(r.state ?? '')) return false
    if (siteSourceIds && !siteSourceIds.has(r.sourceId)) return false
    if (sourceId && r.sourceId !== sourceId) return false
    if (sql && !JSON.stringify(r.values ?? {}).includes(sql)) return false
    return true
  })
  const page = Math.max(1, Number(params?.page ?? 1))
  const size = Math.max(1, Number(params?.size ?? 20))
  const start = (page - 1) * size
  return { total: filtered.length, list: filtered.slice(start, start + size) }
}
// 结果视图行编辑（Phase 4.4）：只改内存态 values，不改 dataId/state 等系统字段
export function mockDataRowUpdate(params?: Record<string, unknown>): { message?: string; row?: DataRow } {
  const tableId = String(params?.tableId ?? '')
  const dataId = String(params?.dataId ?? '')
  const values = (params?.values ?? {}) as Record<string, unknown>
  const row = (QUERY_ROWS[tableId] ?? []).find((r) => r.dataId === dataId)
  if (!row) return { message: '未找到该行数据' }
  row.values = { ...row.values, ...values }
  return { message: '行数据已保存（演示）', row }
}

/** 旧 UploadData 的 Excel 上传端点。演示环境仅校验并回执文件信息，不解析本地二进制内容。 */
export function mockEntryDataUpload(params?: Record<string, unknown>): { success: boolean; message: string } {
  const fileName = String(params?.fileName ?? '').trim()
  const tableId = String(params?.tableId ?? '').trim()
  const sourceId = String(params?.sourceId ?? '').trim()
  const configId = String(params?.configId ?? '').trim()
  if (!fileName || !/\.(xlsx?|xls)$/i.test(fileName)) return { success: false, message: '仅支持 Excel 文件（.xls、.xlsx）' }
  if (!tableId || !sourceId || !configId) return { success: false, message: '表 ID、源 ID、配置 ID 均为必填项' }
  return { success: true, message: `已接收 ${fileName}，将导入表 ${tableId}（本地演示不解析文件内容）` }
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
