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
import { configApi, flowCenterApi, sourceApi, type Source } from '@/api'
import { validFlowIdOf } from '@/utils/flow/stepPersist'

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
  const detail = await sourceApi.sourceDetail(sourceId)
  if (!detail) return false
  // 0925 整体切 flowId：与 index.vue loadSourceFlow 同一口径——源已绑流程（flowId 为有效数字且非
  // '0' 哨兵）时按流程查（svg=true 自带真实根节点行，lastStep 已改写为根 ID），重载后与进入画布时
  // 同形状（孤儿「关联」修复与流程模板套用都走这里；否则源视角查询缺根行，重载会把挂根步骤误判成孤儿）。
  // 0927 P2-4：口径收敛到 stepPersist.validFlowIdOf（四处共用）。
  const flowId = validFlowIdOf(detail.flowId)
  const steps = flowId
    ? await flowCenterApi.steps(flowId, { withConfigDetails: false })
    : (await sourceApi.sourceSteps(sourceId, { withConfigDetails: false })) ?? []
  const { useFlowStore } = await import('@/stores/flow')
  useFlowStore().loadFromSource(detail, steps, null)
  return true
}

/**
 * 无源上下文时的画布重载（0926：流程工作区抽屉里的孤儿「关联」修复）。
 *
 * 与 FlowDetailDrawer 的 deriveFromFlowConfig 同一条路径：`configDetail` + 按流程查步骤
 * （svg=true 自带真实入口行）→ 用 stub Source 走 loadFromSource 重建画布，再纠正
 * `flow.flowId` 并清掉 stub 源上下文。区别是**保留步骤快照**（`clearSourceCtxKeepSteps`）——
 * 抽屉里连续修多个孤儿 / 改名仍然需要快照整包回写，全清之后下一次关联又会断。
 * 画布形状与刚进抽屉时一致（孤儿标记按响应重新推导，本次修好的自然消失）。
 */
export async function reloadFlowIntoCanvas(flowId: string): Promise<boolean> {
  const [config, steps] = await Promise.all([
    configApi.configDetail(flowId).catch(() => null),
    flowCenterApi.steps(flowId, { withConfigDetails: false }).catch(() => []),
  ])
  if (!steps?.length) return false
  const { rootStepForSource } = await import('@/views/FlowCanvas/canvas/flowModel')
  const stubSource: Source = {
    sourceId: '',
    name: config?.name || `流程 #${flowId}`,
    url: config?.url || '',
    configId: flowId,
    mainTable: config?.entryTypeId || '',
    owner: '',
    state: 'C',
  }
  const rootStep = steps.some((s) => s.isRoot) ? null : rootStepForSource(stubSource)
  const { useFlowStore } = await import('@/stores/flow')
  const flow = useFlowStore()
  flow.loadFromSource(stubSource, rootStep ? [rootStep, ...steps] : steps)
  flow.flowId = flowId
  // 0926：流程工作区形态——重载后节点写 / 自动保存按 flowId 锚定（与 FlowDetailDrawer 同口径）
  flow.setFlowIdMode(true)
  flow.setFlowName(config?.name || `流程 #${flowId}`)
  // 与 FlowDetailDrawer.deriveFromFlowConfig 同一收尾：清掉 stub 源上下文但**保留步骤快照**
  // （连续修多个孤儿 / 改名仍需快照整包回写）。
  flow.clearSourceCtxKeepSteps()
  flow.markSaved()
  return flow.main.length > 2
}
