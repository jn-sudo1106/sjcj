// 流程复制·配置去共享（0929 F2 落地）。
//
// 后端语义（bee-top ItemConfigService.doCopyFlowSteps:787-790）：copyFlow / copyTemplateSteps 只复制
// cs_item_config 步骤行，步骤的 CONFIG_ID **沿用源流程/模板的配置**（「复制流程=复制编排结构，步骤配置
// 仍指向原配置」是后端明确的设计声明）。也就是说：不改的话，复制品里改某节点配置 = 直接改源流程/模板
// 的配置，所有使用者一起变。
//
// 产品语义（0929 对齐）：
//   场景一：想改原来流程的某个节点 → 直接改，所有使用该流程的源/复制品一并生效（共享是默认意图）；
//   场景二：想改但不想影响其它使用者 → **显式复制一个流程**，在复制品上改。
//   红线：复制出来的 flow 的改动，不得影响原 flow 的配置。
//
// 本模块在「复制动作」发生时立即兑现红线：复制/套用成功后，把复制进来的步骤逐个
// `config/copyAll` 复制一份独立配置并换绑（步骤行 CONFIG_ID → 新配置），之后各改各的。
// 换绑失败仍共享的步骤登记到 localStorage：用户在复制品里编辑该配置前必须知情确认
// （确认 = 该修改会影响模板/原流程，责任移交用户）。
import { configApi, flowCenterApi, itemApi } from '@/api'
import type { Step } from '@/api/types/source'
import { validFlowIdOf } from '@/utils/flow/stepPersist'

// ---------------------------------------------------------------- 残留登记

/** 复制时换绑失败的共享配置登记（局部存储；仅用于编辑前的知情确认）。 */
export interface DetachFailure {
  configId: string
  flowId: string
  /** 共享来源的展示名（模板/原流程）；拿不到名字时只有 #id。 */
  sourceFlowRef: string
  failedAt: number
}

const STORAGE_KEY = 'flow.detachFailures.v1'

function loadFailures(): DetachFailure[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as DetachFailure[]
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function saveFailures(list: DetachFailure[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // 存储不可用（隐私模式/配额）时降级为不登记：仅失去知情确认，不影响主链路。
  }
}

export function registerDetachFailure(configId: string, flowId: string, sourceFlowRef: string) {
  const list = loadFailures().filter((f) => f.configId !== configId || f.flowId !== flowId)
  list.push({ configId, flowId, sourceFlowRef, failedAt: Date.now() })
  saveFailures(list)
}

/** configId 是否登记为「复制时未换绑、仍与来源共享」的配置。flowId 提供时**只**按 (configId, flowId) 精确匹配。 */
export function detachFailureFor(configId: string, flowId?: string): DetachFailure | undefined {
  const list = loadFailures()
  if (flowId) return list.find((f) => f.configId === configId && f.flowId === flowId)
  return list.find((f) => f.configId === configId)
}

/** 清除登记。flowId 提供时只清该流程名下这一条；缺省保持按 configId 全清（兼容旧调用）。 */
export function clearDetachFailure(configId: string, flowId?: string) {
  const list = loadFailures().filter((f) => flowId
    ? f.configId !== configId || f.flowId !== flowId
    : f.configId !== configId)
  saveFailures(list)
}

/**
 * 编辑共享配置前的知情确认：登记命中时弹确认，用户确认后清除登记并放行。
 * 返回 true = 可以继续保存；false = 用户取消（调用方应中止）。
 * flowId 传当前画布所属流程：命中与清除都按 (configId, flowId) 精确匹配，
 * 避免同一配置在另一条流程里的登记被误清（复制失败场景可能同时存在于多个复制品）。
 */
export async function assertConfigWritable(configId: string, flowId?: string): Promise<boolean> {
  const failure = detachFailureFor(configId, flowId)
  if (!failure) return true
  const { ElMessageBox } = await import('element-plus')
  try {
    await ElMessageBox.confirm(
      `该节点配置 #${configId} 仍与${failure.sourceFlowRef}共享（复制流程时配置复制未成功）。\n`
      + '保存将**修改共享配置**，影响该流程及所有使用它的源。确定继续？',
      '修改共享配置',
      { type: 'warning', confirmButtonText: '仍要修改', cancelButtonText: '取消' },
    )
    clearDetachFailure(configId, flowId)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- 去共享

export interface DetachResult {
  ok: boolean
  message?: string
  /** 成功复制并换绑的步骤数 */
  copied: number
  /** 换绑失败、仍与来源共享的步骤数（已登记知情确认） */
  remainShared: number
}

export interface DetachOptions {
  /** 只处理这些 stepId（追加场景：只换绑模板新复制进来的步骤，不动目标流程原有步骤） */
  onlyStepIds?: Set<string>
  /** 进度回调（done/total）；串行逐条复制，大流程会很慢，调用方应展示进度 */
  onProgress?: (done: number, total: number) => void
  /** 来源流程展示名，失败登记用（"模板「xx」" / "流程 #478"） */
  sourceFlowRef?: string
}

/** 复制进来的步骤里，值得换绑的行：真实步骤 + 真实配置。虚拟起点/无配置草稿跳过。 */
function detachableCandidates(steps: Step[], onlyStepIds?: Set<string>): Step[] {
  return steps.filter((s) => {
    if (!/^\d+$/.test(s.stepId)) return false
    const cid = String(s.configId ?? '').trim()
    if (!/^\d+$/.test(cid)) return false
    if (onlyStepIds && !onlyStepIds.has(s.stepId)) return false
    return true
  })
}

/**
 * 把步骤的共享配置逐条复制并换绑，使目标流程与来源互不影响。
 *
 * - 串行执行：copyConfigAndLocate 用「前后 nameLike 差集」定位新配置，并发同前缀复制会互相干扰；
 * - **同一 configId 只复制一份**：源流程里多个步骤共用同一配置（cs_item_config 多行指向同一
 *   cs_config 是常态），复制品内这些步骤换绑到**同一个**新配置——结构与源一致（共用仍共用），
 *   也避免同内容配置复制出 N 份；
 * - 普通步骤走 stepModify 整包（保留步骤行其余字段）；真实根节点走 rootConfigUpdate 最小集；
 * - 任一步失败不中断：登记为残留共享，由 assertConfigWritable 在下次编辑时拦截确认。
 */
export async function detachCopiedConfigs(
  targetFlowId: string,
  opts: DetachOptions = {},
): Promise<DetachResult> {
  const sourceFlowRef = opts.sourceFlowRef || `流程 #${targetFlowId} 的来源`
  const steps = await flowCenterApi
    .steps(targetFlowId, { withConfigDetails: true })
    .catch(() => null)
  if (!steps) {
    return { ok: false, message: '读取步骤失败：未能复制配置，复制出的节点仍与来源共享配置', copied: 0, remainShared: 0 }
  }
  const candidates = detachableCandidates(steps, opts.onlyStepIds)
  if (!candidates.length) return { ok: true, copied: 0, remainShared: 0 }

  /** 源 configId → 已复制出的新 configId（本次去共享内复用） */
  const clonedBySource = new Map<string, string>()
  let copied = 0
  let remainShared = 0

  for (let i = 0; i < candidates.length; i++) {
    const step = candidates[i]!
    opts.onProgress?.(i, candidates.length)
    const sourceConfigId = step.configId!
    const flowId = validFlowIdOf(step.flowId) || targetFlowId
    let newConfigId = clonedBySource.get(sourceConfigId)
    if (!newConfigId) {
      const name = step.configName?.trim() || step.name?.trim() || `配置-${sourceConfigId}`
      const cloned = await configApi.copyConfigAndLocate(sourceConfigId, name).catch(() => null)
      if (!cloned || !cloned.ok || !cloned.configId) {
        remainShared++
        registerDetachFailure(sourceConfigId, targetFlowId, sourceFlowRef)
        continue
      }
      newConfigId = cloned.configId
      clonedBySource.set(sourceConfigId, newConfigId)
    }
    const ack = step.isRoot
      ? await itemApi.rootConfigUpdate(step.stepId, newConfigId, flowId).catch(() => null)
      : await itemApi.stepModify({ ...step, configId: newConfigId }).catch(() => null)
    if (!ack || (typeof ack === 'object' && 'ok' in ack && !(ack as { ok?: boolean }).ok)) {
      remainShared++
      registerDetachFailure(sourceConfigId, targetFlowId, sourceFlowRef)
      continue
    }
    copied++
  }
  opts.onProgress?.(candidates.length, candidates.length)
  return { ok: true, copied, remainShared }
}

// ---------------------------------------------------------------- 本地拼装路径去共享

export interface InPlaceDetachOptions {
  /** 画布当前流程 id（失败登记用；空白画布可能为空，空则按 configId 全局命中） */
  flowId?: string
  /** 来源展示名，如「模板「xxx」」；失败登记时告知用户共享的是谁 */
  sourceFlowRef?: string
}

/**
 * 本地拼装路径（智能推荐套模板 / 空白画布建流程）专属去共享（0929 F2 红线补漏）。
 *
 * 这类路径把模板定义整体 clone 进画布 store（store 的 load 深拷贝），节点 configId 仍是
 * 模板的真实配置 id，从未走过 detachCopiedConfigs 的「复制后换绑」——本地编辑保存时就会
 * 直接写模板配置、所有用该模板的源一起变，正好踩中 F2 红线。
 *
 * 做法：对画布里每个仍指向来源配置的节点执行 config/copyAll 复制一份（与 detachCopiedConfigs
 * 共用 copyConfigAndLocate 的串行与「同一 configId 只复制一份」语义），拿到新配置 id 后**就地换绑**
 * 画布 store 里的 configId——画布下一次落库（applyTemplateToSource 的步骤同步）按新 id 重建步骤行，
 * 从此与模板互不影响。失败不中断：登记知情确认，由 assertConfigWritable 在编辑时拦截。
 */
export async function detachConfigsInPlace(
  configs: Record<string, { configId?: unknown; title?: string }>,
  opts: InPlaceDetachOptions = {},
): Promise<DetachResult> {
  const sourceFlowRef = opts.sourceFlowRef || '来源流程'
  const targets = Object.entries(configs).filter(([, cfg]) => /^\d+$/.test(String(cfg?.configId ?? '').trim()))
  if (!targets.length) return { ok: true, copied: 0, remainShared: 0 }

  /** 源 configId → 复制出的新 configId（同内容配置只复制一份，供多节点共用） */
  const clonedBySource = new Map<string, string>()
  let copied = 0
  let remainShared = 0
  for (const [, cfg] of targets) {
    const sourceConfigId = String(cfg!.configId).trim()
    let newConfigId = clonedBySource.get(sourceConfigId)
    if (!newConfigId) {
      const name = cfg?.title?.trim() || `配置-${sourceConfigId}`
      const cloned = await configApi.copyConfigAndLocate(sourceConfigId, name).catch(() => null)
      if (!cloned || !cloned.ok || !cloned.configId) {
        remainShared++
        // 空白画布/未落库时 flowId 为空：登记退化为按 configId 全局命中（与 NodeInspector 同口径）
        registerDetachFailure(sourceConfigId, opts.flowId ?? '', sourceFlowRef)
        continue
      }
      newConfigId = cloned.configId
      clonedBySource.set(sourceConfigId, newConfigId)
    }
    cfg!.configId = newConfigId
    copied++
  }
  return { ok: true, copied, remainShared }
}