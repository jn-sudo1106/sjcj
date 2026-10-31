import { reactive } from 'vue'
import { flowCenterApi, type FlowRecord } from '@/api'
import { drainQueue } from '@/utils/concurrency'

/**
 * 流程节点数（1030 会议议题 2）。流程列表接口不返回步骤，只能逐条读步骤计数：
 * 走画布同款 svg 步骤视图（`flowCenterApi.steps`），普通 nextConfigPaged 读的是 cs_item_config，
 * 版本模式下只有草稿的流程在那里查不到（10-30 186 实测）。
 * 最多 3 个并发；按流程 ID + 更新时间缓存，流程改过会重读；失败记 null，下次重试。
 * 新一次 load（翻页）作废上一次还没开始的读取，不让旧页的队列挤占当前页。
 */
const NODE_COUNT_CONCURRENCY = 3

export function useFlowNodeCounts() {
  /** undefined = 读取中，null = 读取失败 */
  const counts = reactive<Record<string, number | null>>({})
  const keys: Record<string, string> = {}
  /** 当前还没开始读的队列；新一次 load 先清空它，旧 worker 取不到就自然停下 */
  let pending: FlowRecord[] = []

  async function load(list: FlowRecord[]) {
    // 作废的放回去：当前页里也有的会在下面重新排队
    for (const f of pending.splice(0)) delete keys[f.id]
    const todo = list.filter((f) => keys[f.id] !== `${f.id}@${f.updatedAt ?? ''}`)
    for (const f of todo) {
      keys[f.id] = `${f.id}@${f.updatedAt ?? ''}`
      delete counts[f.id]
    }
    const queue = [...todo]
    pending = queue
    await drainQueue(queue, NODE_COUNT_CONCURRENCY, async (f) => {
      try {
        counts[f.id] = (await flowCenterApi.steps(f.id, { withConfigDetails: false })).length
      } catch {
        counts[f.id] = null
        delete keys[f.id]
      }
    })
  }

  return { counts, load }
}

/** 节点数单元格文案与提示 */
export function nodeCountText(counts: Record<string, number | null>, flowId: string): string {
  const n = counts[flowId]
  return n === null ? '—' : n == null ? '…' : String(n)
}
export function nodeCountTitle(counts: Record<string, number | null>, flowId: string): string {
  return counts[flowId] === null ? '节点数读取失败，刷新后重试' : flowId in counts ? '' : '读取中'
}
