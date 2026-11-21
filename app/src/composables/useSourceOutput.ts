/**
 * 源产出统计的取数（1114 源产出监控 一期 A，方案 §3.2 / §3.4）。
 *
 * - 「产出」列和展开行共用一份结果：同一个源只取一次，展开时直接复用列上已取到的。
 * - 结果缓存 2 分钟，与后端 `queryStepDetail` 的 dataCache（expireAfterWrite 120s）一致——再早重取也只会拿到同一份。
 * - 批量取数并发 4（217 重点智库 65 个源实测 3.6 s @8 并发）：2026-11-19 从 8 降到 4，给用户操作留出浏览器连接
 *   （HTTP/1.1 每域只有 6 条，8 并发会把整页其他请求都挤在后面）。同一个源的并发请求合并成一个。
 * - 组件卸载后迟到的响应不再写入（代号守卫，同 FilePreview 的 loadSeq 写法）。
 */
import { onBeforeUnmount, shallowRef, triggerRef } from 'vue'
import { sourceApi, type SourceOutputTable } from '@/api'

export const SOURCE_OUTPUT_CACHE_MS = 120_000
export const SOURCE_OUTPUT_CONCURRENCY = 4

const cache = new Map<string, { at: number; tables: SourceOutputTable[] }>()
const inflight = new Map<string, Promise<SourceOutputTable[]>>()

/** 取一个源的输出表统计；2 分钟内复用缓存，force 时跳过缓存（「重试」） */
export function fetchSourceOutput(sourceId: string, options: { force?: boolean } = {}): Promise<SourceOutputTable[]> {
  const hit = cache.get(sourceId)
  if (!options.force && hit && Date.now() - hit.at < SOURCE_OUTPUT_CACHE_MS) return Promise.resolve(hit.tables)
  const running = inflight.get(sourceId)
  if (running) return running
  const task = sourceApi.queryStepDetail(sourceId)
    .then((tables) => {
      cache.set(sourceId, { at: Date.now(), tables })
      return tables
    })
    .finally(() => { inflight.delete(sourceId) })
  inflight.set(sourceId, task)
  return task
}

/** 测试用：清掉模块级缓存 */
export function clearSourceOutputCache() {
  cache.clear()
  inflight.clear()
}

export type SourceOutputEntry =
  | { status: 'loading' }
  | { status: 'ok'; tables: SourceOutputTable[]; at: number }
  | { status: 'error'; error: string }

/** 有限并发跑完一组任务（不因单个失败中断） */
export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await worker(item)
    }
  })
  await Promise.all(lanes)
}

export function useSourceOutput() {
  const entries = shallowRef(new Map<string, SourceOutputEntry>())
  let alive = true
  onBeforeUnmount(() => { alive = false })

  function set(sourceId: string, entry: SourceOutputEntry) {
    if (!alive) return
    entries.value.set(sourceId, entry)
    triggerRef(entries)
  }

  function entryOf(sourceId: string): SourceOutputEntry | undefined {
    return entries.value.get(sourceId)
  }

  function fresh(sourceId: string): boolean {
    const entry = entries.value.get(sourceId)
    if (!entry) return false
    if (entry.status === 'loading') return true
    return entry.status === 'ok' && Date.now() - entry.at < SOURCE_OUTPUT_CACHE_MS
  }

  /** 取一组源（已在取 / 2 分钟内取过的跳过；force 一律重取） */
  async function load(sourceIds: string[], options: { force?: boolean } = {}): Promise<void> {
    const todo = [...new Set(sourceIds.filter(Boolean))].filter((id) => options.force || !fresh(id))
    if (!todo.length) return
    for (const id of todo) set(id, { status: 'loading' })
    await runPool(todo, SOURCE_OUTPUT_CONCURRENCY, async (id) => {
      try {
        const tables = await fetchSourceOutput(id, options)
        set(id, { status: 'ok', tables, at: Date.now() })
      } catch (error) {
        set(id, { status: 'error', error: error instanceof Error ? error.message : String(error) })
      }
    })
  }

  return { entries, entryOf, load, retry: (sourceId: string) => load([sourceId], { force: true }) }
}
