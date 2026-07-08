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
  /** 源详情三视图（0706 Phase4）：流程（默认）/ 数据 / 任务（=节点粒度运行记录，0707 澄清不单设"运行"） */
  view?: 'flow' | 'data' | 'task'
  selectedNodeId?: string
  filters?: { dataId: string; parentId: string; state: string; sql: string; sourceFilter?: string }
  page?: number
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
  // 分屏对比（0701 问题三 · 方案 C）：非空 = 正在把 activeSourceId（左栏）与该 sourceId（右栏）并排对比。
  // 属临时查看态，不做 sessionStorage 持久化（刷新即退出对比，回到单栏）。
  const compareSourceId = ref<string>('')

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
    if (tabs.value.length >= MAX_SOURCE_TABS) return false
    tabs.value.push({ sourceId, name: name || sourceId })
    activeSourceId.value = sourceId
    return true
  }

  function activate(sourceId: string) {
    if (tabs.value.some((t) => t.sourceId === sourceId)) activeSourceId.value = sourceId
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
    }
    // 对比态失效则自动退出：右栏源被关闭，或左右两栏因页签变动指向了同一个源
    if (compareSourceId.value && (compareSourceId.value === activeSourceId.value || !tabs.value.some((t) => t.sourceId === compareSourceId.value))) {
      compareSourceId.value = ''
    }
    return activeSourceId.value
  }

  /** 进入分屏对比：与 sourceId 必须是不同的、已打开的页签；成功返回 true */
  function enterCompare(sourceId: string): boolean {
    if (!sourceId || sourceId === activeSourceId.value) return false
    if (!tabs.value.some((t) => t.sourceId === sourceId)) return false
    compareSourceId.value = sourceId
    return true
  }
  function exitCompare() {
    compareSourceId.value = ''
  }

  function saveSnapshot(sourceId: string, patch: SourceTabSnapshot) {
    if (!tabs.value.some((t) => t.sourceId === sourceId)) return
    snapshots[sourceId] = { ...snapshots[sourceId], ...patch }
  }

  function snapshotOf(sourceId: string): SourceTabSnapshot | undefined {
    return snapshots[sourceId]
  }

  return { tabs, activeSourceId, snapshots, compareSourceId, open, activate, close, saveSnapshot, snapshotOf, enterCompare, exitCompare }
})
