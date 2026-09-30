// 把流程模板套到一个源上：**两个入口共用的唯一实现**（2026-09-22 抽出）。
//
// 抽它的起因是用户报「切换流程模板之后，所属流程应该也一并改掉吧」。查下去发现的不是
// 「flowId 忘了改」，而是**顶部下拉那条路整个不落库**：它走 `flow.applyTemplate`，
// 只在本地替换画布 + 往源上写 `templateId`/`templateVersion`，`flowId` 一个字没碰，
// 也不发任何请求。而 FlowBoard 空画布那张引导卡上的「从流程模板套用」早在 0903 Y8-C
// 就改走后端复制端点了——`FlowBoard.vue` 的注释甚至明写「不用 flow.applyTemplate 那套
// 前端逐个建节点的老路（Y8-20 作废）」。**作废的路还挂在最显眼的位置上**，这才是根因。
//
// H03 之后对齐的口径（0929）：
//   - 后端复制**只搬步骤行**，步骤的 CONFIG_ID 沿用模板的配置（ItemConfigService.doCopyFlowSteps
//     注释即设计声明：「复制流程=复制编排结构，步骤配置仍指向原配置」）——**模板与复制品共享配置**；
//   - 产品红线：**复制出来的 flow 的改动不得影响原 flow/模板**。由本文件在复制成功后调用
//     detachCopiedConfigs 立即把复制进来的步骤逐条复制配置并换绑（config/copyAll + stepModify），
//     之后各改各的（实现见 utils/flow/copiedConfigs.ts，0929 F2 落地）。
//   - 「追加不是替换」不变：copyTemplateSteps 只往目标流程里加步骤，不删现有的。
import { configApi, flowCenterApi, sourceApi, type Source } from '@/api'
import { validFlowIdOf } from '@/utils/flow/stepPersist'
import { detachCopiedConfigs, type DetachResult } from '@/utils/flow/copiedConfigs'
import { ElMessage } from 'element-plus'

export interface TemplateApplied {
  /** 套用后本源所属的流程 ID */
  flowId: string
  /** 后端回执原文（「复制成功，共复制 N 个步骤」之类），用来直接给用户看 */
  message: string
  /** true = 本源原来没有流程，这次新建了一条并绑上——只有这种情况所属流程会变 */
  createdFlow: boolean
  /** 配置去共享结果：复制进来的步骤是否已换绑独立配置（false 分支读取步骤失败时为 undefined） */
  detach?: DetachResult
}

export interface ApplyTemplateOptions {
  /** 配置去共享的逐条进度（大流程很慢，调用方应展示进度） */
  onProgress?: (done: number, total: number) => void
}

/** 配置去共享结果的用户提示（0929）：全部独立 / 部分失败仍共享，必须明示。 */
export function reportDetachResult(detach: DetachResult | undefined, sourceLabel = '模板') {
  if (!detach) return
  if (!detach.ok) {
    ElMessage.warning(detach.message || '配置独立失败，请核对')
    return
  }
  if (detach.remainShared > 0) {
    ElMessage.warning(`已为 ${detach.copied} 个节点复制独立配置；${detach.remainShared} 个节点配置复制失败，仍与${sourceLabel}共享，修改这些节点前请注意确认提示`)
  } else if (detach.copied > 0) {
    ElMessage.success(`已为 ${detach.copied} 个节点复制独立配置，与${sourceLabel}互不影响`)
  }
}

export async function applyTemplateToSource(
  templateFlowId: string,
  sourceId: string,
  knownFlowId?: string,
  sourceName?: string,
  opts: ApplyTemplateOptions = {},
): Promise<TemplateApplied> {
  // 列表接口不保证带 flowId，sourceDetail 一定带；查不到就按"没有流程"走新建那一路
  let targetFlowId = knownFlowId
  if (!targetFlowId) targetFlowId = (await sourceApi.sourceDetail(sourceId).catch(() => null))?.flowId

  if (targetFlowId) {
    // 追加场景：先尽力记下目标流程现有步骤，复制后只对**新进来**的步骤做配置去共享——
    // 绝不动目标流程原有步骤的配置（它们不来自模板）。快照失败**不影响复制主体**，
    // 只是不再自动去共享（below）。
    const before = await flowCenterApi.steps(targetFlowId, { withConfigDetails: false }).catch(() => null)
    const ack = await flowCenterApi.copyTemplateSteps(templateFlowId, targetFlowId)
    if (!ack || !ack.ok) throw new Error(ack?.message || '复制模板步骤失败')
    let detach: DetachResult | undefined
    if (before) {
      const after = (await flowCenterApi.steps(targetFlowId, { withConfigDetails: true }).catch(() => null)) ?? []
      const onlyStepIds = new Set(
        after.filter((s) => !before.some((b) => b.stepId === s.stepId)).map((s) => s.stepId),
      )
      if (onlyStepIds.size) {
        detach = await detachCopiedConfigs(targetFlowId, {
          onlyStepIds,
          sourceFlowRef: `模板流程 #${templateFlowId}`,
          onProgress: opts.onProgress,
        })
      }
    } else {
      // 复制前快照读不到：无法区分新旧步骤，宁可不自动换绑（避免动原有步骤），由前端提示手工核对。
      detach = { ok: false, message: '复制前未能读取目标流程步骤，新增节点配置未自动独立，请核对', copied: 0, remainShared: 0 }
    }
    return { flowId: targetFlowId, message: ack.message ?? '', createdFlow: false, detach }
  }

  const copied = await copyFlowToSource(templateFlowId, sourceId, sourceName, {
    sourceFlowRef: `模板流程 #${templateFlowId}`,
    onProgress: opts.onProgress,
  })
  return { ...copied, createdFlow: true }
}

/**
 * 把一条流程整条复制给源并换绑（画布「更换流程」、套用模板在源无流程时共用）。
 * 新流程名「源名-流程」；原流程不动，其他使用原流程的源不受影响。
 */
export async function copyFlowToSource(
  fromFlowId: string,
  sourceId: string,
  sourceName: string | undefined,
  opts: { sourceFlowRef: string; onProgress?: (done: number, total: number) => void },
): Promise<{ flowId: string; message: string; detach: DetachResult }> {
  // 顺序：复制 → 先换绑 → 再去共享。去共享是逐节点串行、可能很慢，先绑上源不让它等；
  // 去共享个别失败只登记残留共享（编辑前知情确认），不影响换绑结果。
  const flowId = await flowCenterApi.copy(fromFlowId, `${sourceName || sourceId}-流程`)
  const bound = await flowCenterApi.bindSources([sourceId], flowId)
  if (!bound.ok) {
    // 流程已经建出来了，只是没绑上。说清 ID，让用户能去流程中心手动关联——
    // 不要假装失败得干干净净，那会留下一条谁也不知道存在的流程。
    throw new Error(`已复制出流程 #${flowId}，但未能关联到本源（${bound.message || '原因未知'}），可在流程中心手动关联`)
  }
  const detach = await detachCopiedConfigs(flowId, opts)
  return { flowId, message: bound.message ?? '', detach }
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
