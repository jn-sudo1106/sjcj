/**
 * 节点配置自动保存的两件公共小事（1021-06，方案 §4.3 已在 186 实测）：
 *
 * 1. **同一个配置的保存排队**：updateConfig 的并发校验不是原子的、updateDt 只精确到秒，两次带同一个 updateDt
 *    同时提交都会成功、后写覆盖。所以手动保存和自动保存都走 `enqueueConfigSave`，同一 configId 串行。
 * 2. **切换编排对象前先把没存的节点配置存掉**：NodeInspector 挂载时登记 flusher，
 *    画布页切源 / 切流程前调 `flushNodeConfigs()`，存不掉的（共享配置、还没配置等）照旧留脏标由原逻辑提示。
 *    同一时间只有最后挂载的检查器响应 Ctrl/⌘+S，避免一次按键几个检查器一起保存（新节点会被建两份配置）。
 */
const queues = new Map<string, Promise<unknown>>()

export function enqueueConfigSave<T>(configId: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(configId) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(task)
  queues.set(configId, next)
  void next.finally(() => { if (queues.get(configId) === next) queues.delete(configId) }).catch(() => undefined)
  return next
}

// 同时可能挂着多个节点检查器（画布、流程详情抽屉、流程模板页）：按挂载顺序记成栈，
// 最后挂载、还没卸载的那个负责「切换前先存」和 Ctrl/⌘+S，卸载后交还给前一个。
const flushers: (() => Promise<void>)[] = []

/** NodeInspector 登记；返回注销函数（卸载时调用，只注销自己登记的那个） */
export function registerNodeConfigFlusher(fn: () => Promise<void>): () => void {
  flushers.push(fn)
  return () => {
    const index = flushers.lastIndexOf(fn)
    if (index >= 0) flushers.splice(index, 1)
  }
}

/** 这个检查器是不是当前在用的那个（只有它响应 Ctrl/⌘+S） */
export function isActiveNodeConfigFlusher(fn: () => Promise<void>): boolean {
  return flushers[flushers.length - 1] === fn
}

export async function flushNodeConfigs(): Promise<void> {
  const top = flushers[flushers.length - 1]
  if (top) await top()
}

/** 测试用：清掉排队状态（上一个用例挂着没结束的保存不能卡住下一个） */
export function resetNodeConfigAutosave() {
  queues.clear()
  flushers.length = 0
}
