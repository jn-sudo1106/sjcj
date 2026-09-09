// 按数据条件反查源（0903 H12 / Y2 → 0904 I01 改为直达）。
//
// 会上原话：「我把这些源的任务全部发一遍，但是我不知道有哪些源……你这个条件能带回去吗？」
// ——在数据视图里按条件筛出脏数据之后，需要知道**这批数据来自哪些源**，然后整批重发。
//
// ⚠️ **这是数据条件与源条件之间唯一存在的桥，而且只有「数据 → 源」一个方向。**
// 两套筛选字段完全不同（源：ID/名称/状态/标签/备注；数据：表/SQL/状态/时间），
// 不要试图做双向同步——反过来「源条件 → 数据条件」没有任何接口支撑，硬做只能靠前端拼 SQL，
// 那等于把用户没写过的条件混进他的查询里。
//
// **2026-09-05（Z1）从 BackTraceSourcesDialog.vue 抽出来。** 那个弹窗被 0904 I01 判退役：
// 「那你还不如把这个东西直接放到那个源列表」「你直接反向你不是直接跑两步？」
// ——中间那层"先弹窗看清单、再决定去哪"没人要，点一下就该落到源视图。
// 弹窗没了，但下面这套求命中源的算法是 09-04 六轮修复换来的，一个字都不能丢，所以抽成纯函数。
import { dataApi, type RowQuery } from '@/api'
import { stripTrailingSemicolon } from '@/utils/sqlCondition'

/** `SOURCE_ID IN (...)` 分组大小：整串最终拼进 SQL，太长会被网关/后端截断 */
const IN_CHUNK = 200
/**
 * 没有网站范围时的兜底上限。与 SiteDataView 的收窄逻辑取同一个值（实测 1000 不被后端截断）。
 * 实际请求**多要一条**：只有真的拿回 1001 条，才说明后面还有、结果不完整。
 * 要多少给多少地判「length >= 1000 就是截断」会在恰好 1000 个源时误报。
 */
export const DISTINCT_LIMIT = 1000

export interface BackTraceResult {
  /** 命中的源 ID（有网站范围时已限定在该网站内） */
  sourceIds: string[]
  /** 每个源各命中几条；走兜底分支（无网站范围）时为空 Map——那条路只回 ID */
  hitCountBySource: Map<string, number>
  /** 兜底分支下结果是否被上限截断 */
  truncated: boolean
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/**
 * 按条件反查命中的源。
 *
 * ⚠️ **不要用「全表捞 ID + 前端取交集」这条路**（2026-09-04 两次踩坑后重写）。
 * `entryDistinctSource` 不认 siteId，按表和条件搜全库；共用表（`TB_CNEWS` 这种）全平台
 * 命中源动辄上千，分页一截，本网站的源就可能整个不在返回里——表现成"数据列表里明明有
 * 920663 的行，反查却说命中 0 个源"。**上限调多大都堵不住这个漏，是做法本身错了。**
 *
 * 正确做法：把网站的源**写进查询条件**，让服务端只在这批源里筛。
 * `sql` 最终落到旧字段 `more`（原样拼进 WHERE），所以可以追加 `SOURCE_ID IN (...)`。
 * 顺带用 `summaryEntryData` 按 `SOURCE_ID` 分组，一次请求就拿到「哪些源命中 + 各命中几条」，
 * 比 `distinctSource` 只回 ID 更有用，也不再有截断问题（一个网站的源数量有限）。
 *
 * @param scopedSourceIds 当前网站的源 ID 全集。**传了就按它限定**；不传才退回全表
 *   `distinctSource`——那种场景本来就没有网站范围可言（如全平台数据查看页）。
 */
export async function backTraceSources(query: RowQuery, scopedSourceIds?: string[]): Promise<BackTraceResult> {
  const scoped = scopedSourceIds ?? []
  if (!scoped.length) {
    const ids = await dataApi.distinctSource({ ...query, size: DISTINCT_LIMIT + 1 })
    return {
      sourceIds: ids.slice(0, DISTINCT_LIMIT),
      hitCountBySource: new Map(),
      truncated: ids.length > DISTINCT_LIMIT,
    }
  }
  const counts = new Map<string, number>()
  // 削末尾分号必须在**这里**做，不能只靠 API 层（2026-09-09 生产实测）：下面把用户条件
  // 包成 `(条件) AND SOURCE_ID IN (...)` 之后，末尾字符已经是 `)`，buildLegacyMore 里
  // 那道清理就匹配不到了，分号被裹在括号中间 —— `LOWER(TRIM(k23));) AND SOURCE_ID IN (…)`。
  // 后端 SQL 解析不了，报的是一句误导人的「传到的条件含有非法注入风险」。
  // 普通查询没有这层包装，所以同一条件在数据列表里查得好好的，只有反查报错。
  const userSql = stripTrailingSemicolon(query.sql?.trim() ?? '')
  for (const group of chunk(scoped, IN_CHUNK)) {
    const inClause = `SOURCE_ID IN (${group.map((id) => `'${id}'`).join(',')})`
    const sql = userSql ? `(${userSql}) AND ${inClause}` : inClause
    const summary = await dataApi.summaryData({ ...query, sql, size: group.length }, ['SOURCE_ID'])
    // SummaryRow = { CNT, <分组列> }：分组列名就是 summaryFields 传进去的那个
    for (const row of summary) {
      const id = String(row.SOURCE_ID ?? '')
      if (id && id !== 'null') counts.set(id, row.CNT)
    }
  }
  return { sourceIds: [...counts.keys()], hitCountBySource: counts, truncated: false }
}
