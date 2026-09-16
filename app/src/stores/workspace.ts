import { reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'

// 单写入口防抖：连续触发折叠到一次写入，sessionStorage 不必每个 keystroke 都重写
const PERSIST_DEBOUNCE_MS = 300

// 源详情工作区多页签（优化 0701 问题三 · 方案 B）：
// 点开多个源并存为可关闭页签，各页签独立保留浏览状态（视图/选中节点/过滤/页码），sessionStorage 恢复。

export interface SourceTab {
  sourceId: string
  name: string
}

export interface SourceTabSnapshot {
  /** 源详情视图（0706 Phase4；0711 R11 加文件）：流程（默认）/ 数据 / 文件（仅源态）/ 任务（仅网站态） */
  view?: 'flow' | 'data' | 'file' | 'task' | 'monitor-config'
  /** 网站页签内当前停留的编排对象（0710 会议 B3）：'site' = 统一流程模板，否则为源 sourceId；激活页签时恢复 */
  activeKey?: string
  /**
   * 该源所属网站（左侧源列表要它才能加载）。
   *
   * 为什么必须记在页签上：切页签时只有 sourceId，而 `source/sourceDetail` **实测返回 `siteId: null`**
   * （2026-08-28 生产验证），拿不到归属；URL 上的 siteId 又只有"从网站详情进来"那条路径才有。
   * 两个来源同时落空时，左侧源列表就会整块消失——页签快照是唯一能跨切换保住它的地方。
   */
  siteId?: string
  selectedNodeId?: string
  filters?: { dataId: string; parentId: string; state: string; sql: string; sourceFilter?: string }
  page?: number
}

/**
 * 网站页签（0915-02）：页签条上代表「某个网站的全部源」的那一项。
 *
 * 会上原话「你点个源，上面有 3 个 tab…**全部没有放在 tab 上**」——在此之前，
 * 网站聚合态既不在页签条里、页签条本身也不渲染（`index.vue` 用 `flow.sourceCtx` 当渲染条件），
 * 于是从"全部"点进某个源后，想回去只能先回网站列表再点一次网站。
 *
 * **可以有多个**（2026-09-16 修正）：初版只留一个、跟着当前网站走，但源页签本来就允许跨网站
 * （`SourceTabsBar.navTo` 特意带 `snap.siteId` 就是为此），于是点一下别的网站的源，
 * 上一个网站的「全部」连同它的快照一起没了，想回去只能从网站列表重来。
 * 既然源页签能跨站，网站上下文本来就不止一个。
 */
export interface SiteTab {
  siteId: string
  name: string
}

/** 网站页签的浏览状态：点源页签走开、再点回「全部」时要复现的现场。 */
export interface SiteTabSnapshot {
  /** 网站态停在哪个视图（source/data/file/task/monitor），点回「全部」时恢复 */
  view?: string
  /** 数据视图停在哪张表（0915-03）。不存就等于没回到原来的地方 */
  tableId?: string
  /** 数据视图的筛选条件（0915-03）——这是用户"好不容易查出来的那批" */
  filters?: { dataId: string; parentId: string; state: string; sql: string }
  /**
   * 「按条件查源」收窄出的命中源（0915-03）。
   *
   * 带 `key`（表 + 四个条件拼出的指纹）是因为这份名单**只对产生它的那套条件成立**：
   * 条件一改就必须重算，拿旧名单去查会少扫掉一批源，而页面上看不出任何异常。
   * 缓存它的理由是收窄一次的代价——6496 个源的网站实测要几十秒，回来一次等一次没法用。
   *
   * **不存已加载的数据行**：网站态是多源归并滚动加载，恢复"已加载 3000 条"要重放整个
   * 归并过程，代价远大于收益。回来后按条件重查首屏即可。
   */
  narrowed?: { key: string; sourceIds: string[]; totalHits: number | null }
}

/** 反查命中的一个源：`count` 来自 summaryEntryData 的分组计数（该源命中几条数据） */
export interface BackTraceHit {
  sourceId: string
  count: number
}

/** 产生这批命中的查询条件。点侧栏某个源进具体源数据视图时要原样带过去——
 *  侧栏写着「906 条」，进去看到的就得是那 906 条，否则这个数字是误导。 */
export interface BackTraceCondition {
  tableId: string
  sql?: string
  state?: string
  dataId?: string
  parentId?: string
}

/**
 * 页签总额度（2026-09-16 定）：**源页签与网站页签合计**不超过这个数。
 * 分开计数会让页签条最多排到 12+ 项，"多了也不好拉"——横向滚动找页签比重新打开还慢。
 */
export const MAX_WORKSPACE_TABS = 8
/** @deprecated 沿用旧名给既有引用，语义已变成"总额度"，新代码用 MAX_WORKSPACE_TABS */
export const MAX_SOURCE_TABS = MAX_WORKSPACE_TABS
const SS_KEY = 'rc-source-tabs'

interface PersistShape {
  tabs: SourceTab[]
  activeSourceId: string
  snapshots: Record<string, SourceTabSnapshot>
  /** 0915-02 新增。**老存档里没有这两个字段**，读取端必须容忍缺失——
   *  直接当必填解析会让升级前打开过页面的用户刷新后整排页签消失。 */
  siteTabs?: SiteTab[]
  siteSnapshots?: Record<string, SiteTabSnapshot>
}

function readPersisted(): PersistShape {
  try {
    const raw = sessionStorage.getItem(SS_KEY)
    if (raw) {
      const p = JSON.parse(raw) as PersistShape
      const tabs = Array.isArray(p.tabs)
        ? p.tabs.filter((t): t is SourceTab => !!t && typeof t.sourceId === 'string' && typeof t.name === 'string')
        : []
      const siteTabs = Array.isArray(p.siteTabs)
        ? p.siteTabs.filter((t): t is SiteTab => !!t && typeof t.siteId === 'string' && typeof t.name === 'string')
        : []
      return {
        tabs,
        activeSourceId: p.activeSourceId || '',
        snapshots: p.snapshots || {},
        siteTabs,
        siteSnapshots: p.siteSnapshots || {},
      }
    }
  } catch {
    /* 损坏的存储直接丢弃 */
  }
  return { tabs: [], activeSourceId: '', snapshots: {}, siteTabs: [], siteSnapshots: {} }
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const persisted = readPersisted()
  const tabs = ref<SourceTab[]>(persisted.tabs)
  const activeSourceId = ref<string>(persisted.activeSourceId)
  const snapshots = reactive<Record<string, SourceTabSnapshot>>(persisted.snapshots)
  const siteTabs = ref<SiteTab[]>(persisted.siteTabs ?? [])
  const siteSnapshots = reactive<Record<string, SiteTabSnapshot>>(persisted.siteSnapshots ?? {})
  // 分屏对比（0701 问题三 · 方案 C；0710 会议 B4 与页签解耦）：compareLeftId（左栏）/ compareSourceId（右栏）
  // 都是真实 sourceId，不要求对应已打开的页签——右栏按 id 直接加载，入口在源侧栏（同站 ⇔ + 全局选择器）。
  // 属临时查看态，不做 sessionStorage 持久化（刷新即退出对比，回到单栏）。
  const compareSourceId = ref<string>('')
  const compareLeftId = ref<string>('')
  /**
   * 按数据条件反查出的命中源（2026-09-09）：数据视图写入，源侧栏消费。
   *
   * 会上原话「就是要再加到左边最好」「因为我点一个源又要进去」——反查结果原来是跳到源视图，
   * 想挨个排查问题源就得在两个视图之间来回跳。改成写侧栏后，人留在数据视图里点着看。
   *
   * 带 siteId 是因为侧栏跟着网站走：切到别的网站，这批命中源就不适用了，得自动失效。
   * 与 compareSourceId 同属临时查看态，不做 sessionStorage 持久化（刷新即回到全部源）。
   */
  const backTraceHits = ref<{ siteId: string; hits: BackTraceHit[]; condition: BackTraceCondition } | null>(null)

  let persistTimer: ReturnType<typeof setTimeout> | null = null
  watch(
    [tabs, activeSourceId, () => snapshots, siteTabs, () => siteSnapshots],
    () => {
      if (persistTimer) clearTimeout(persistTimer)
      persistTimer = setTimeout(() => {
        sessionStorage.setItem(SS_KEY, JSON.stringify({
          tabs: tabs.value,
          activeSourceId: activeSourceId.value,
          snapshots,
          siteTabs: siteTabs.value,
          siteSnapshots,
        }))
        persistTimer = null
      }, PERSIST_DEBOUNCE_MS)
    },
    { deep: true },
  )

  /** 打开源页签：已开则激活；超出上限返回 false（调用方负责提示） */
  function open(sourceId: string, name: string): boolean {
    const exist = tabs.value.find((t) => t.sourceId === sourceId)
    if (exist) {
      if (name && exist.name !== name) exist.name = name
      activeSourceId.value = sourceId
      return true
    }
    // 超出上限时仍需切到该源，否则页签条会停在上一个活动页签上，与实际画布内容对不上
    if (tabs.value.length + siteTabs.value.length >= MAX_WORKSPACE_TABS) {
      activeSourceId.value = sourceId
      return false
    }
    tabs.value.push({ sourceId, name: name || sourceId })
    activeSourceId.value = sourceId
    return true
  }

  function activate(sourceId: string) {
    if (tabs.value.some((t) => t.sourceId === sourceId)) activeSourceId.value = sourceId
  }
  // 网站详情页（0714 会议 Task 3）：不是任何一个页签，进入前需要让出当前激活页签，
  // 否则页签条上旧页签仍判定为"已激活"，用户点它没反应（SourceTabsBar.onActivate 的早退判断）。
  function deactivate() {
    activeSourceId.value = ''
  }

  /** 关闭页签：关闭活动页签时激活右邻（无则左邻）；返回下一个活动 sourceId（'' 表示已无页签） */
  function close(sourceId: string): string {
    const idx = tabs.value.findIndex((t) => t.sourceId === sourceId)
    if (idx < 0) return activeSourceId.value
    tabs.value.splice(idx, 1)
    delete snapshots[sourceId]
    if (activeSourceId.value === sourceId) {
      const next = tabs.value[idx] ?? tabs.value[idx - 1]
      activeSourceId.value = next?.sourceId ?? ''
      // 关闭活动页签即离开当前对比上下文（0710 会议 B4：对比与页签解耦，仅此场景联动退出）
      exitCompare()
    }
    return activeSourceId.value
  }

  /**
   * 进入分屏对比（0710 会议 B4）：left/right 均为真实 sourceId（不能是 `site:` 伪 id），不要求已打开页签。
   * rightId 必填；leftId 缺省沿用当前 compareLeftId（对比中切换右栏的场景）。成功返回 true。
   */
  function enterCompare(rightId: string, leftId?: string): boolean {
    const left = leftId ?? compareLeftId.value
    if (!rightId || !left || rightId === left) return false
    if (rightId.startsWith('site:') || left.startsWith('site:')) return false
    compareLeftId.value = left
    compareSourceId.value = rightId
    return true
  }
  function exitCompare() {
    compareSourceId.value = ''
    compareLeftId.value = ''
  }

  /** 命中条数从多到少——问题最严重的源排最前，一眼看出先查谁。 */
  function setBackTraceHits(siteId: string, hits: BackTraceHit[], condition: BackTraceCondition) {
    backTraceHits.value = { siteId, hits: [...hits].sort((a, b) => b.count - a.count), condition }
  }
  function clearBackTraceHits() {
    backTraceHits.value = null
  }
  /** 侧栏取本网站的命中源；网站对不上（切过站了）当作没有。 */
  function backTraceHitsOf(siteId: string): BackTraceHit[] {
    const cur = backTraceHits.value
    return cur && cur.siteId === siteId ? cur.hits : []
  }
  /** 点侧栏命中源切进具体源时，把产生这批命中的条件一并带过去。 */
  function backTraceConditionOf(siteId: string): BackTraceCondition | null {
    const cur = backTraceHits.value
    return cur && cur.siteId === siteId && cur.hits.length ? cur.condition : null
  }

  /**
   * 待应用到具体源数据视图的条件（2026-09-09）。切源时放进来，ResultView 取走即清。
   *
   * **为什么不走 URL**：一开始是用 `cond*` query 传的，但具体源视图按 sourceId 做 key，
   * 源→源切换时会销毁重建，于是撞上竞态——旧实例先收到路由变化、填完条件顺手把 query
   * 抹掉，紧接着新实例挂载时 URL 上已经没有 `cond*` 了，筛选框就是空的。
   * 表现为「点第一个源好使，再点别的源条件就没了」。放 store 里没有这个先后问题。
   */
  const pendingSourceCondition = ref<BackTraceCondition | null>(null)
  function setPendingSourceCondition(cond: BackTraceCondition | null) {
    pendingSourceCondition.value = cond
  }
  /** 取走并清空——只应用一次，之后用户自己改的筛选不该被再次覆盖。 */
  function takePendingSourceCondition(): BackTraceCondition | null {
    const cur = pendingSourceCondition.value
    pendingSourceCondition.value = null
    return cur
  }

  /**
   * 记下当前网站页签（0915-02）。幂等：
   * - 换了网站 → 整体替换，并丢掉上一个网站的快照（它的视图状态对新网站没有意义）；
   * - 同一个网站 → 只在拿到更好的名字时更新文案。
   *
   * `name` 可缺省：深链直接进某个源时只有 siteId，名字要等 `site/detail` 回来才知道，
   * 那时再调一次本函数补上，别用 siteId 把已有的名字覆盖掉。
   */
  function ensureSiteTab(siteId: string, name?: string): boolean {
    if (!siteId) return false
    const exist = siteTabs.value.find((t) => t.siteId === siteId)
    if (exist) {
      // 名字只往"更好"的方向改：深链进源时只有 siteId，等 site/detail 回来才补得上真名，
      // 那之后再传 siteId 进来不能把真名盖回去。
      if (name && name !== siteId && exist.name !== name) exist.name = name
      return true
    }
    // 额度与源页签共用。满了就静默不建——它是路由变化时自动调的，弹提示会连着弹；
    // 用户关掉几个页签后再进这个网站，「全部」自然就回来了。
    if (tabs.value.length + siteTabs.value.length >= MAX_WORKSPACE_TABS) return false
    siteTabs.value.push({ siteId, name: name || siteId })
    return true
  }
  /** 关闭网站页签。该网站名下的源页签**不受影响**——它们各自快照里记着 siteId，照常能用。 */
  function closeSiteTab(siteId: string) {
    const idx = siteTabs.value.findIndex((t) => t.siteId === siteId)
    if (idx < 0) return
    siteTabs.value.splice(idx, 1)
    delete siteSnapshots[siteId]
  }
  function clearSiteTabs() {
    for (const t of siteTabs.value) delete siteSnapshots[t.siteId]
    siteTabs.value = []
  }
  function saveSiteSnapshot(siteId: string, patch: SiteTabSnapshot) {
    // 只给页签条上真实存在的网站记快照，避免额度满时写进一堆永远读不到的数据
    if (!siteId || !siteTabs.value.some((t) => t.siteId === siteId)) return
    siteSnapshots[siteId] = { ...siteSnapshots[siteId], ...patch }
  }
  function siteSnapshotOf(siteId: string): SiteTabSnapshot | undefined {
    return siteSnapshots[siteId]
  }

  /** 改源名称时只改页签文案，不激活、不新建页签（侧栏编辑当前源用） */
  function renameTab(sourceId: string, name: string) {
    const tab = tabs.value.find((t) => t.sourceId === sourceId)
    if (tab && name) tab.name = name
  }

  function saveSnapshot(sourceId: string, patch: SourceTabSnapshot) {
    if (!tabs.value.some((t) => t.sourceId === sourceId)) return
    snapshots[sourceId] = { ...snapshots[sourceId], ...patch }
  }

  function snapshotOf(sourceId: string): SourceTabSnapshot | undefined {
    return snapshots[sourceId]
  }

  return { tabs, activeSourceId, snapshots, siteTabs, siteSnapshots, compareSourceId, compareLeftId, backTraceHits, open, activate, deactivate, close, renameTab, saveSnapshot, snapshotOf, ensureSiteTab, closeSiteTab, clearSiteTabs, saveSiteSnapshot, siteSnapshotOf, enterCompare, exitCompare, setBackTraceHits, clearBackTraceHits, backTraceHitsOf, backTraceConditionOf, setPendingSourceCondition, takePendingSourceCondition }
})
