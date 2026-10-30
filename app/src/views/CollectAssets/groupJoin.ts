/** 入组只调整归属，自有流程绑定保留，退组后恢复；按当前归属分批提交。 */
import { sourceGroupApi } from '@/api'

export const JOIN_CHECK_MAX = 200

export interface JoinCandidate {
  sourceId: string
  name: string
  sourceGroupId?: string | null
}
export interface JoinFailure {
  sourceId: string
  step: 'join'
  message: string
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export async function joinGroup(input: { groupId: string; sources: JoinCandidate[] }): Promise<{ joined: number; failures: JoinFailure[] }> {
  const failures: JoinFailure[] = []
  const byExpected = new Map<string | null, string[]>()
  for (const source of input.sources) {
    if (source.sourceGroupId === input.groupId) continue
    const key = source.sourceGroupId || null
    byExpected.set(key, [...(byExpected.get(key) ?? []), source.sourceId])
  }
  let joined = 0
  for (const [expected, sourceIds] of byExpected) {
    try {
      const result = await sourceGroupApi.changeMembers({ sourceIds, sourceGroupId: input.groupId, expectedSourceGroupId: expected })
      if (!result.ok) throw new Error(result.message || '加入来源组失败')
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
  const head = result.failures.slice(0, 3).map((f) => `${f.sourceId}（加入失败：${f.message}）`).join('；')
  const more = result.failures.length > 3 ? ` 等 ${result.failures.length} 个` : ''
  return `${result.joined ? `已加入 ${result.joined} 个源；` : ''}${head}${more}未加入`
}
