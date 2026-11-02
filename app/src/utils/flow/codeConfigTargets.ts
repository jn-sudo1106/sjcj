import type { DataRow, SendCodeConfigPayload } from '@/api'

/** 目标节点与数据上下文；实际节点配置 ID 由流程步骤解析，不再选择 MQ 派发配置。 */
export type CodeConfigTarget = Pick<SendCodeConfigPayload, 'sourceId' | 'stepId' | 'entryTypeId' | 'entryIds' | 'ver' | 'orchestration'> & { flowId?: string; name?: string; fromStepId?: string }

export function codeTargetForNode(sourceId: string, flowId: string | undefined, stepId?: string, ver?: string | null): CodeConfigTarget {
  if (!/^[1-9]\d*$/.test(sourceId) || !flowId || !/^[1-9]\d*$/.test(flowId)) throw new Error('请先加载已保存的源和流程')
  if (stepId !== undefined && !/^[1-9]\d*$/.test(stepId)) throw new Error('请先保存当前步骤，再进行代码生成')
  return { sourceId, flowId, ...(stepId ? { stepId } : {}), ...(ver ? { ver } : {}) }
}

/** 数据 ID 按真实所属源分组；缺少归属直接拒绝，避免把多个源的数据发给一个源。 */
export function codeTargetsForRows(rows: DataRow[], ids: string[], tableId: string, sourceId = '', context?: { flowId: string; ver?: string | null; stepId?: string }): CodeConfigTarget[] {
  if (!ids.length) throw new Error('请先勾选要生成代码的数据')
  const entryTypeId = Number(tableId)
  if (!Number.isSafeInteger(entryTypeId) || entryTypeId <= 0) throw new Error('当前数据表没有有效的 entryTypeId')
  const byId = new Map(rows.map(row => [row.dataId, row]))
  const groups = new Map<string, string[]>()
  for (const id of new Set(ids)) {
    const row = byId.get(id)
    if (!row) throw new Error(`选中的数据已不在当前列表：${id}`)
    const owner = row.sourceId || sourceId
    if (!/^[1-9]\d*$/.test(owner) || (context && sourceId && owner !== sourceId)) throw new Error(`数据 ${id} 缺少有效来源或不属于当前源`)
    groups.set(owner, [...(groups.get(owner) ?? []), id])
  }
  return [...groups].map(([owner, entryIds]) => ({
    ...(context ? codeTargetForNode(owner, context.flowId, context.stepId, context.ver) : { sourceId: owner }),
    entryTypeId, entryIds,
  }))
}
