import { restoreTemplateDefaults } from './flowTemplates'
// 流程复制 / 重载的共用实现（2026-09-22 抽出）。
// 1008-08：「套用流程模板」整个功能去掉了（会上定的），`applyTemplateToSource()` 随之删除；
// 下面的历史说明里提到它的地方保留，只作来龙去脉。
//
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
import { configApi, flowCenterApi, sourceApi, type Source, type Step } from '@/api'
import { validFlowIdOf } from '@/utils/flow/stepPersist'
import { useFlowVersionStore } from '@/stores/flowVersion'
import { detachCopiedConfigs, type CopiedFlow, type DetachResult } from '@/utils/flow/copiedConfigs'
import { ElMessage } from 'element-plus'

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

/**
 * 把一条流程整条复制给源并换绑（画布「更换流程」「复制当前流程」共用）。
 * 新流程名「源名-流程」；原流程不动，其他使用原流程的源不受影响。
 * `reuseConfigs`（0930）：用户选了「复用原配置」，只复制步骤不做配置去共享。
 */
export async function copyFlowToSource(
  fromFlowId: string,
  sourceId: string,
  sourceName: string | undefined,
  opts: { sourceFlowRef: string; onProgress?: (done: number, total: number) => void; reuseConfigs?: boolean },
): Promise<CopiedFlow & { message: string }> {
  // 顺序：复制 → 先换绑 → 再去共享。去共享是逐节点串行、可能很慢，先绑上源不让它等；
  // 去共享个别失败只登记残留共享（编辑前知情确认），不影响换绑结果。
  const flowId = await flowCenterApi.copy(fromFlowId, `${sourceName || sourceId}-流程`)
  const bound = await flowCenterApi.bindSources([sourceId], flowId)
  if (!bound.ok) {
    // 流程已经建出来了，只是没绑上。说清 ID，让用户能去流程中心手动关联——
    // 不要假装失败得干干净净，那会留下一条谁也不知道存在的流程。
    throw new Error(`已复制出流程 #${flowId}，但未能关联到本源（${bound.message || '原因未知'}），可在流程中心手动关联`)
  }
  if (opts.reuseConfigs) return { flowId, message: bound.message ?? '' }
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
export async function reloadSourceIntoCanvas(sourceId: string, preferredFlowId?: string): Promise<boolean> {
  const detail = await sourceApi.sourceDetail(sourceId)
  if (!detail) return false
  // 0925 整体切 flowId：与 index.vue loadSourceFlow 同一口径——源已绑流程（flowId 为有效数字且非
  // '0' 哨兵）时按流程查（svg=true 自带真实根节点行，lastStep 已改写为根 ID），重载后与进入画布时
  // 同形状（孤儿「关联」修复与流程模板套用都走这里；否则源视角查询缺根行，重载会把挂根步骤误判成孤儿）。
  // 0927 P2-4：口径收敛到 stepPersist.validFlowIdOf（四处共用）。
  const flowId = validFlowIdOf(preferredFlowId ?? detail.flowId)
  // 流程版本（2026-10-10）：重载发生在编辑场景（关联 / 套模板 / 发布、放弃草稿后），有草稿读草稿
  const flowVersion = useFlowVersionStore()
  if (flowId) await flowVersion.load(flowId)
  const versionId = flowId ? flowVersion.viewVersionId : null
  const steps = flowId
    ? await flowCenterApi.steps(flowId, { withConfigDetails: false, ...(versionId ? { versionId } : {}) })
    : (await sourceApi.sourceSteps(sourceId, { withConfigDetails: false })) ?? []
  const defaults = await loadTemplateDefaults(flowId, steps)
  const { useFlowStore } = await import('@/stores/flow')
  const flow = useFlowStore()
  const sameSource = String(flow.sourceCtx?.sourceId ?? '') === String(sourceId)
  flow.loadFromSource(preferredFlowId
    ? { ...detail, flowId, primaryFlowId: validFlowIdOf(detail.flowId) || undefined }
    : detail, steps, null)
  restoreTemplateDefaults(flow.configs, defaults, true)
  // 定时 cron 在 job 表、sourceDetail 里恒为 null（见 index.vue backfillSourceSchedule）。loadFromSource
  // 重建了源上下文，进入画布时补的 cron 随之丢失，节点定时退回「每天」兜底显示（2026-10-27 发布 v3 后实测）。
  // sourceJob 不随重载清空，同一个源直接重新套回即可，不置脏。
  if (sameSource && flow.sourceJob?.schedule) flow.applySourceSchedule(flow.sourceJob.schedule)
  await backfillReloadedStepDetails(flow, steps)
  return true
}

export async function loadTemplateDefaults(flowId: string | undefined, steps: Step[]) {
  if (!flowId || !steps.some(step => !step.configId || step.configId === '0')) return
  try {
    return (await flowCenterApi.detail(flowId))?.definition
  } catch (error) {
    console.warn('[flow-template] 默认值读取失败', flowId, error)
  }
}

/**
 * 重载后补 configDetail（2026-10-27）：上面按 withConfigDetails=false 读步骤，configType 要靠这一轮补。
 * 进入画布时 index.vue 的 backfillStepDetails 会补，重载路径此前漏了——730 打标签 / 800 翻译这类
 * 步骤写的是 type='rule'，拿不到 configType 就被画成规则节点，选中后规则面板自动补字段把节点标脏，
 * 发起抓取被拦、点保存还会把共享配置覆盖成规则脚本（217 流程 14007240 发布后实测）。
 * 补充失败不影响已画出的流程，与 index.vue 同口径吞掉。
 */
async function backfillReloadedStepDetails(flow: { applyStepDetails: (steps: Step[]) => string[], selectedId: string, select: (id: string) => void }, steps: Step[]) {
  if (!steps.length) return
  try {
    const enriched = await sourceApi.stepConfigDetails(steps)
    const rebuilt = flow.applyStepDetails(enriched)
    if (rebuilt.includes(flow.selectedId)) flow.select(flow.selectedId)
  } catch {
    /* 节点仍可用，只是配置名 / 类型回落到模板默认值 */
  }
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
  const flowVersion = useFlowVersionStore()
  await flowVersion.load(flowId)
  const versionId = flowVersion.viewVersionId
  const [config, steps] = await Promise.all([
    configApi.configDetail(flowId).catch(() => null),
    flowCenterApi.steps(flowId, { withConfigDetails: false, ...(versionId ? { versionId } : {}) }).catch(() => []),
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
  const defaults = await loadTemplateDefaults(flowId, steps)
  const { useFlowStore } = await import('@/stores/flow')
  const flow = useFlowStore()
  flow.loadFromSource(stubSource, rootStep ? [rootStep, ...steps] : steps)
  restoreTemplateDefaults(flow.configs, defaults)
  flow.flowId = flowId
  // 0926：流程工作区形态——重载后节点写 / 自动保存按 flowId 锚定（与 FlowDetailDrawer 同口径）
  flow.setFlowIdMode(true)
  flow.setFlowName(config?.name || `流程 #${flowId}`)
  // 补 configType 要用 stub 源上下文，必须在 clearSourceCtxKeepSteps 之前
  await backfillReloadedStepDetails(flow, steps)
  // 与 FlowDetailDrawer.deriveFromFlowConfig 同一收尾：清掉 stub 源上下文但**保留步骤快照**
  // （连续修多个孤儿 / 改名仍需快照整包回写）。
  flow.clearSourceCtxKeepSteps()
  flow.markSaved()
  return flow.main.length > 2
}
