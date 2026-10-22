/**
 * 加入来源组前处理源自己的流程（1021-03，方案 设计稿/设计方案/1021-会议功能调整_开发设计方案_2026-10-21.md §2.3）。
 *
 * 口径：组内源只走组的流程。后端入组时**不清**源自己的绑定，入组后这些绑定既不生效、也改不了
 *（bindSourceFlows / changeFlowBatch 对组内源一律拒绝，10-21 186 实测），所以必须**先解绑、再入组**，顺序不能反。
 * 后端出「入组带解绑」接口之前是过渡版：逐个查 `sourceFlows`，逐个 `bindSourceFlows` 清空，再 `changeMembers`。
 *
 * - 已在别的组里的源（换组）不查也不解：它的自有绑定早就改不了，换组后照样不生效；
 * - 某个源解绑失败就不让它入组（否则它会带着解不掉的绑定进组），最后报出来；
 * - 一次最多查 JOIN_CHECK_MAX 个源：逐个请求，太多会很慢。
 */
import { sourceGroupApi, workflowBindingApi } from '@/api'

export const JOIN_CHECK_MAX = 200
const CONCURRENCY = 8

export interface JoinCandidate {
  sourceId: string
  name: string
  sourceGroupId?: string | null
}
export interface OwnFlowRow {
  sourceId: string
  name: string
  ownFlowIds: string[]
  ownDefaultFlowId?: string
}
export interface JoinFailure {
  sourceId: string
  step: 'unbind' | 'join'
  message: string
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function eachLimited<T>(items: T[], run: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) await run(items[next++])
  }))
}

/** 查勾选源里哪些有自己的流程（只查未入组的源）；某个源查失败就整体抛出，不当成没有流程 */
export async function findOwnFlows(sources: JoinCandidate[]): Promise<OwnFlowRow[]> {
  const independent = sources.filter((s) => !s.sourceGroupId)
  const found = new Map<string, OwnFlowRow>()
  await eachLimited(independent, async (source) => {
    const view = await workflowBindingApi.view(source.sourceId)
    if (view.ownFlowIds.length) {
      found.set(source.sourceId, { sourceId: source.sourceId, name: source.name, ownFlowIds: view.ownFlowIds, ownDefaultFlowId: view.ownDefaultFlowId })
    }
  })
  // 按勾选顺序返回，确认弹窗里的顺序和列表一致
  return independent.flatMap((s) => found.get(s.sourceId) ?? [])
}

/**
 * 先把 `unbindIds` 这些源自己的流程清空，再把 `sources` 里解绑成功（或本来就不用解）的源加入来源组。
 * changeMembers 一次只接受一个 expected，按源当前归属分批。
 */
export async function joinGroup(input: { groupId: string; sources: JoinCandidate[]; unbindIds: string[] }): Promise<{ joined: number; failures: JoinFailure[] }> {
  const failures: JoinFailure[] = []
  const unbindFailed = new Set<string>()
  await eachLimited(input.unbindIds, async (sourceId) => {
    try {
      await workflowBindingApi.save(sourceId, () => ({ flowIds: [], defaultFlowId: null }))
    } catch (error) {
      unbindFailed.add(sourceId)
      failures.push({ sourceId, step: 'unbind', message: messageOf(error) })
    }
  })
  const byExpected = new Map<string | null, string[]>()
  for (const source of input.sources) {
    if (unbindFailed.has(source.sourceId)) continue
    const key = source.sourceGroupId || null
    byExpected.set(key, [...(byExpected.get(key) ?? []), source.sourceId])
  }
  let joined = 0
  for (const [expected, sourceIds] of byExpected) {
    try {
      await sourceGroupApi.changeMembers({ sourceIds, sourceGroupId: input.groupId, expectedSourceGroupId: expected })
      joined += sourceIds.length
    } catch (error) {
      const message = messageOf(error)
      sourceIds.forEach((sourceId) => failures.push({ sourceId, step: 'join', message }))
    }
  }
  return { joined, failures }
}

/** 结果提示文案：全部成功 / 部分失败（列前几个源和原因） */
export function joinResultText(result: { joined: number; failures: JoinFailure[] }): string {
  if (!result.failures.length) return `已加入来源组 ${result.joined} 个源`
  const head = result.failures.slice(0, 3).map((f) => `${f.sourceId}（${f.step === 'unbind' ? '解除自有流程失败' : '加入失败'}：${f.message}）`).join('；')
  const more = result.failures.length > 3 ? ` 等 ${result.failures.length} 个` : ''
  return `${result.joined ? `已加入 ${result.joined} 个源；` : ''}${head}${more}未加入`
}
