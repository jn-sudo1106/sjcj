import type { FlowDefinition } from '@/api'
import { typeLabel } from './flowVariants'

/**
 * 流程模板的只读结构预览（1117 方案 §7 二期「结构只读预览」）。
 *
 * 数据来自模板自身的画布定义（`flowDetail.flowConf`），不依赖尚未上线的 C02 `templateMetas`：
 * 主链按 `main` 顺序去掉开始 / 结束端点；不在主链上的节点算分支节点，只给数量与名称。
 */
export interface StructureChainNode {
  id: string
  label: string
  /** 节点类型名，如「网页抓取」；类型码缺失时为空串（不显示），标题也缺失时标题用「未知类型」 */
  typeLabel: string
  kind: 'capture' | 'rule'
}

export interface StructureChain {
  nodes: StructureChainNode[]
  branchNodes: StructureChainNode[]
}

const ENDPOINTS = new Set(['start', 'end'])

function toNode(definition: FlowDefinition, id: string): StructureChainNode {
  const config = definition.configs[id]
  const code = String(config?.configType ?? '').trim()
  const type = code ? typeLabel(code) : ''
  return {
    id,
    label: config?.title?.trim() || type || typeLabel('?'),
    typeLabel: type,
    kind: config?.collect ? 'capture' : 'rule',
  }
}

/** 定义里没有任何节点（如完整流程模板没存 flowConf）时返回 null，由调用方退回文字版结构。 */
export function templateStructureChain(definition: FlowDefinition | null | undefined): StructureChain | null {
  if (!definition?.configs || !Array.isArray(definition.main)) return null
  const mainIds = definition.main.filter((id) => !ENDPOINTS.has(id) && definition.configs[id])
  const onMain = new Set(mainIds)
  const branchIds = Object.keys(definition.configs).filter((id) => !ENDPOINTS.has(id) && !onMain.has(id))
  if (!mainIds.length) return null
  return {
    nodes: mainIds.map((id) => toNode(definition, id)),
    branchNodes: branchIds.map((id) => toNode(definition, id)),
  }
}
