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
  view?: 'flow' | 'data' | 'file' | 'task'
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

export const MAX_SOURCE_TABS = 8
const SS_KEY = 'rc-source-tabs'

interface PersistShape {
  tabs: SourceTab[]
  activeSourceId: string
  snapshots: Record<string, SourceTabSnapshot>
}

function readPersisted(): PersistShape {
  try {
    const raw = sessionStorage.getItem(SS_KEY)
    if (raw) {
      const p = JSON.parse(raw) as PersistShape
      const tabs = Array.isArray(p.tabs)
        ? p.tabs.filter((t): t is SourceTab => !!t && typeof t.sourceId === 'string' && typeof t.name === 'string')
        : []
      return { tabs, activeSourceId: p.activeSourceId || '', snapshots: p.snapshots || {} }
    }
  } catch {
    /* 损坏的存储直接丢弃 */
  }
  return { tabs: [], activeSourceId: '', snapshots: {} }
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const persisted = readPersisted()
  const tabs = ref<SourceTab[]>(persisted.tabs)
  const activeSourceId = ref<string>(persisted.activeSourceId)
  const snapshots = reactive<Record<string, SourceTabSnapshot>>(persisted.snapshots)
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
    [tabs, activeSourceId, () => snapshots],
    () => {
      if (persistTimer) clearTimeout(persistTimer)
      persistTimer = setTimeout(() => {
        sessionStorage.setItem(SS_KEY, JSON.stringify({ tabs: tabs.value, activeSourceId: activeSourceId.value, snapshots }))
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
    if (tabs.value.length >= MAX_SOURCE_TABS) {
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

  return { tabs, activeSourceId, snapshots, compareSourceId, compareLeftId, backTraceHits, open, activate, deactivate, close, renameTab, saveSnapshot, snapshotOf, enterCompare, exitCompare, setBackTraceHits, clearBackTraceHits, backTraceHitsOf, backTraceConditionOf, setPendingSourceCondition, takePendingSourceCondition }
})
