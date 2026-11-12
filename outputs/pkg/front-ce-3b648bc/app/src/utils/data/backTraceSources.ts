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
 * 取「这张表有哪些源」时的上限。0909 实测 `TB_CNEWS` 全集 8358 个，传 10000/20000/50000
 * 返回一致，说明已取全、没被截断；留一倍余量。
 *
 * 旧的 `DISTINCT_LIMIT = 1000`（"按条件反查"的截断线）已随旧兜底分支一起退役：那条路
 * 是拿 `entryDistinctSource` 的返回当命中源，而它压根不过滤，截不截断都没意义。
 */
const TABLE_SOURCES_LIMIT = 20000

export interface BackTraceResult {
  /** 命中的源 ID（有网站范围时已限定在该网站内） */
  sourceIds: string[]
  /** 每个源各命中几条 */
  hitCountBySource: Map<string, number>
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
 * ⚠️⚠️ **更狠的一条（2026-09-09 生产实测）：`entryDistinctSource` 根本不应用 `more` 条件。**
 * 给它一个精确到单个源的条件 `more=SOURCE_ID = '430003475'`，返回的是 **8349 个源**，
 * 即整张表的源；换成任何别的条件、乃至不给条件，返回的都是同一批。也就是说它回的
 * 从来不是"当前条件下的源"，而是"这张表有哪些源"。所以上面那条"分页一截"只说对了一半，
 * 真正的问题是它压根不过滤。
 *
 * 排查时容易被带偏的两点，写下来免得重走：
 *  1. **`limit` 才是控制返回条数的参数，不是 `size`。** 传 `limit=20` 会得到 20 条，
 *     看上去像是"条件命中 20 个源"，很容易误判成接口正常。
 *  2. 旧平台「工具 → 提取去重后源ID」弹窗里那二十来个 ID 就是这么来的（它的请求带
 *     `limit=20`）。**那个功能一直是坏的**——展示的从来不是当前条件下的源，而是这张表
 *     的前 20 个源。拿它的结果当基准对照会把人带沟里。
 *
 * 对照之下 `summaryEntryData` 是**认条件的**：同样给 `more=SOURCE_ID = '430003475'`，
 * 它精确返回 1 个源。所以 09-04 换接口不只是为了绕开截断，更是因为原接口根本不过滤。
 *
 * 正确做法：把网站的源**写进查询条件**，让服务端只在这批源里筛。
 * `sql` 最终落到旧字段 `more`（原样拼进 WHERE），所以可以追加 `SOURCE_ID IN (...)`。
 * 顺带用 `summaryEntryData` 按 `SOURCE_ID` 分组，一次请求就拿到「哪些源命中 + 各命中几条」，
 * 比 `distinctSource` 只回 ID 更有用，也不再有截断问题（一个网站的源数量有限）。
 *
 * 0909 实测的一组真实数字（测试网站0907 / `TB_CNEWS` / 6496 个源）：本函数算出候选 276 个源，
 * 逐源查完共 1900 条数据、实际来自 267 个源——多算 9 个（`summaryEntryData` 对含子查询的
 * 条件略偏宽），候选给多了只是白扫几个源，不会漏数据，方向上是安全的。
 *
 * @param scopedSourceIds 当前网站的源 ID 全集。**传了就按它限定**；不传才退回全表
 *   `distinctSource`——那种场景本来就没有网站范围可言（如全平台数据查看页）。
 *
 *   不传时（数据中心那条路）**范围就是这张表**：先不带条件问一次 `entryDistinctSource`
 *   拿到表的源全集，再走同一套精确收窄。0909 之前这里是直接把 `entryDistinctSource` 的
 *   返回当命中源用的，而它不应用条件，等于把"这张表的所有源"当成了"命中的源"。
 *   代价是请求数：表的源多时按 200 一组切，`TB_CNEWS` 这种 8358 个源要 42 个请求。
 */
export async function backTraceSources(query: RowQuery, scopedSourceIds?: string[]): Promise<BackTraceResult> {
  let scoped = scopedSourceIds ?? []
  if (!scoped.length) {
    // 没给源集合（数据中心那条路）：**范围就是这张表**——数据中心本来就是按表走的，
    // 不存在"全平台没有锚点"的问题，表的源全集就是天然的范围。
    //
    // 这里仍然用 `entryDistinctSource`，但用法变了：不再指望它"按条件反查"（实测它压根
    // 不过滤，见顶部），只拿它做一件它真能做的事——**给出这张表有哪些源**。不带条件请求，
    // 拿到全集后再走下面那套精确收窄，与有网站范围时同一条路径。
    scoped = await dataApi.distinctSource({ tableId: query.tableId, size: TABLE_SOURCES_LIMIT })
    if (!scoped.length) return { sourceIds: [], hitCountBySource: new Map() }
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
  return { sourceIds: [...counts.keys()], hitCountBySource: counts }
}
