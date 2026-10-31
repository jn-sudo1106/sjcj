/**
 * 改共用流程前的守卫（10-29，设计稿/设计方案/1029-共用流程保存提示_开发设计方案_2026-10-29.md）。
 *
 * 孙总：「改一个源的流程保存的时候就提示用户，让用户自己决定改动的影响范围」。源画布上真正影响别的源的
 * 只有两处——节点配置不进版本，一保存就全体生效；画布结构写在草稿里，发布才生效。所以只在
 * 「保存节点配置」和「发布」两处问，画布照旧实时保存。流程被多个源共用、本页还没确认过时弹窗：
 * 取消 / 复制为本源专用 / 保存（发布）。选过保存后同一源同一流程本页不再问。
 *
 * 具体实现（查几个源在用、弹窗、复制换绑）由源流程页签 SourceWorkflowTabs 登记；没有登记（流程工作区、
 * 模板页等不在源画布上）时一律放行。
 */
export type SharedFlowAction = 'save' | 'publish'

/** 复制为本源专用后，把没保存的节点配置写到复制出的新配置上（原 configId → 新 configId） */
export type CarryConfigs = (configMap: Record<string, string>) => Promise<void>

export interface SharedFlowGuard {
  /** 当前流程被多个源共用且本页还没确认（源数还没查到也算）：这时节点配置不自动保存 */
  pending(): boolean
  /** 弹窗询问；true = 用户选了保存 / 发布，可以写；false = 取消，或已复制为本源专用（画布已切走） */
  ask(action: SharedFlowAction, carry?: CarryConfigs): Promise<boolean>
}

let guard: SharedFlowGuard | undefined

/** SourceWorkflowTabs 挂载时登记；返回注销函数（只注销自己登记的那个） */
export function registerSharedFlowGuard(impl: SharedFlowGuard): () => void {
  guard = impl
  return () => {
    if (guard === impl) guard = undefined
  }
}

export function sharedFlowPending(): boolean {
  return guard?.pending() ?? false
}

export async function confirmSharedFlowWrite(action: SharedFlowAction, carry?: CarryConfigs): Promise<boolean> {
  if (!guard?.pending()) return true
  return guard.ask(action, carry)
}

/** 本页已确认「保存到共用流程」的 源ID:流程ID；刷新页面后清空，重新询问 */
export const confirmedSharedFlows = new Set<string>()
