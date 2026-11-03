import { reactive } from 'vue'
import { flowCenterApi, type FlowDefinition, type FlowRecord } from '@/api'
import { drainQueue } from '@/utils/concurrency'

/**
 * 结构模板按画布定义计数，普通流程及完整流程模板按 svg 步骤视图计数。
 * 最多 3 个并发；按流程 ID + 更新时间缓存，流程改过会重读；失败记 null，下次重试。
 * 新一次 load（翻页）作废上一次还没开始的读取，不让旧页的队列挤占当前页。
 */
const NODE_COUNT_CONCURRENCY = 3
const keyOf = (flow: FlowRecord) => `${flow.id}@${flow.updatedAt ?? ''}:${!!flow.isTemplate}`

function structureNodeCount(definition: FlowDefinition): number {
  const nodes = new Set(definition.main.filter(id => id !== 'start' && id !== 'end' && definition.configs[id]))
  return nodes.size
}

interface CountRequest {
  flow: FlowRecord
  key: string
}

export function useFlowNodeCounts() {
  /** undefined = 读取中，null = 读取失败 */
  const counts = reactive<Record<string, number | null>>({})
  const requests = new Map<string, CountRequest>()
  /** 当前还没开始读的队列；新一次 load 先清空它，旧 worker 取不到就自然停下 */
  let pending: CountRequest[] = []

  function rememberTemplate(flow: FlowRecord) {
    if (!flow.definition?.structureOnly) return
    requests.set(flow.id, { flow, key: keyOf(flow) })
    counts[flow.id] = structureNodeCount(flow.definition)
  }

  async function load(list: FlowRecord[]) {
    // 作废的放回去：当前页里也有的会在下面重新排队
    for (const request of pending.splice(0)) {
      const { id } = request.flow
      if (requests.get(id) === request) requests.delete(id)
    }
    const queue: CountRequest[] = []
    for (const flow of list) {
      const key = keyOf(flow)
      if (requests.get(flow.id)?.key === key) continue
      const request = { flow, key }
      requests.set(flow.id, request)
      delete counts[flow.id]
      queue.push(request)
    }
    pending = queue
    await drainQueue(queue, NODE_COUNT_CONCURRENCY, async (request) => {
      const { flow } = request
      if (requests.get(flow.id) !== request) return
      try {
        if (flow.isTemplate && flow.definition?.structureOnly) {
          counts[flow.id] = structureNodeCount(flow.definition)
          return
        }
        const steps = await flowCenterApi.steps(flow.id, { withConfigDetails: false }).catch(error => {
          if (!flow.isTemplate) throw error
          return undefined
        })
        if (requests.get(flow.id) !== request) return
        // 结构模板也可能有一条未配置的技术根步骤，不能把它当成画布节点。
        if (flow.isTemplate && !steps?.some(step => !step.isRoot || (step.configId && step.configId !== '0'))) {
          const detail = await flowCenterApi.detail(flow.id).catch(() => null)
          if (requests.get(flow.id) !== request) return
          counts[flow.id] = detail?.definition.structureOnly ? structureNodeCount(detail.definition) : steps?.length ?? null
          if (!detail || (!detail.definition.structureOnly && !steps)) requests.delete(flow.id)
          return
        }
        counts[flow.id] = steps?.length ?? null
      } catch {
        if (requests.get(flow.id) !== request) return
        counts[flow.id] = null
        requests.delete(flow.id)
      }
    })
  }

  return { counts, load, rememberTemplate }
}

/** 节点数单元格文案与提示 */
export function nodeCountText(counts: Record<string, number | null>, flowId: string): string {
  const n = counts[flowId]
  return n === null ? '—' : n == null ? '…' : String(n)
}
export function nodeCountTitle(counts: Record<string, number | null>, flowId: string): string {
  return counts[flowId] === null ? '节点数读取失败，刷新后重试' : flowId in counts ? '' : '读取中'
}
