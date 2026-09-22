// 把流程模板套到一个源上：**两个入口共用的唯一实现**（2026-09-22 抽出）。
//
// 抽它的起因是用户报「切换流程模板之后，所属流程应该也一并改掉吧」。查下去发现的不是
// 「flowId 忘了改」，而是**顶部下拉那条路整个不落库**：它走 `flow.applyTemplate`，
// 只在本地替换画布 + 往源上写 `templateId`/`templateVersion`，`flowId` 一个字没碰，
// 也不发任何请求。而 FlowBoard 空画布那张引导卡上的「从流程模板套用」早在 0903 Y8-C
// 就改走后端复制端点了——`FlowBoard.vue` 的注释甚至明写「不用 flow.applyTemplate 那套
// 前端逐个建节点的老路（Y8-20 作废）」。**作废的路还挂在最显眼的位置上**，这才是根因。
//
// H03 的口径是「把模板里那套配置**复制出一套新的**给本源，不是引用模板」，所以：
//   - 本源已有流程 → 步骤复制**进本源那条流程**，`flowId` 保持不变（这是对的：源没有
//     改换门庭，只是多了几个步骤。所属流程标签不变不是 bug）；
//   - 本源还没有流程 → 先 `copyFlow` 造一条，再 `bindSources` 绑上，此时 `flowId` 才变，
//     重载后所属流程自然显示出来。
//
// ⚠️ **后端这条是「追加」不是「替换」**：`copyTemplateSteps` 只往目标流程里加步骤，
// 不删现有的。所以调用方的确认文案必须说清"现有节点会保留"——顶部下拉原来的文案写的是
// 「当前 N 个节点会被替换」「复制并替换」，那是前端本地替换时代的话，已经不成立。
import { flowCenterApi, sourceApi } from '@/api'

export interface TemplateApplied {
  /** 套用后本源所属的流程 ID */
  flowId: string
  /** 后端回执原文（「复制成功，共复制 N 个步骤」之类），用来直接给用户看 */
  message: string
  /** true = 本源原来没有流程，这次新建了一条并绑上——只有这种情况所属流程会变 */
  createdFlow: boolean
}

export async function applyTemplateToSource(
  templateFlowId: string,
  sourceId: string,
  knownFlowId?: string,
  sourceName?: string,
): Promise<TemplateApplied> {
  // 列表接口不保证带 flowId，sourceDetail 一定带；查不到就按"没有流程"走新建那一路
  let targetFlowId = knownFlowId
  if (!targetFlowId) targetFlowId = (await sourceApi.sourceDetail(sourceId).catch(() => null))?.flowId

  if (targetFlowId) {
    const ack = await flowCenterApi.copyTemplateSteps(templateFlowId, targetFlowId)
    if (!ack.ok) throw new Error(ack.message || '复制模板步骤失败')
    return { flowId: targetFlowId, message: ack.message ?? '', createdFlow: false }
  }

  const newFlowId = await flowCenterApi.copy(templateFlowId, `${sourceName || sourceId}-流程`)
  const bound = await flowCenterApi.bindSources([sourceId], newFlowId)
  if (!bound.ok) {
    // 流程已经建出来了，只是没绑上。说清 ID，让用户能去流程中心手动关联——
    // 不要假装失败得干干净净，那会留下一条谁也不知道存在的流程。
    throw new Error(`已按模板复制出流程 #${newFlowId}，但未能关联到本源（${bound.message || '原因未知'}），可在流程中心手动关联`)
  }
  return { flowId: newFlowId, message: bound.message ?? '', createdFlow: true }
}

/**
 * 套完模板从后端重新读一遍画布。
 *
 * **必须重载，不能在本地拼**：步骤是后端建的，本地拼出来的 id 全是草稿 id，
 * 自动保存会把同一批步骤再建一遍（`FlowBoard.vue` 的老注释踩过这个坑）。
 * 沿用源视图进入画布时的同一条路径。
 */
export async function reloadSourceIntoCanvas(sourceId: string): Promise<boolean> {
  const [detail, steps] = await Promise.all([
    sourceApi.sourceDetail(sourceId),
    sourceApi.sourceSteps(sourceId, { withConfigDetails: false }),
  ])
  if (!detail) return false
  const { useFlowStore } = await import('@/stores/flow')
  useFlowStore().loadFromSource(detail, steps ?? [], null)
  return true
}
